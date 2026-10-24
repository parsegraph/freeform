"""Real subprocess checks: cancellation cannot leave build descendants running."""
import importlib.util
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import tempfile
import time
import unittest

MODULE = Path(__file__).resolve().parents[1] / 'deploy/vpn/build-artifact.py'
spec = importlib.util.spec_from_file_location('builder', MODULE)
builder = importlib.util.module_from_spec(spec)
spec.loader.exec_module(builder)


@unittest.skipUnless(sys.platform.startswith('linux'), 'Requires Linux process state inspection')
class BuilderCancellationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.ready = self.root / 'descendant'
        self.group = self.root / 'group'
        self.addCleanup(self.cleanup_group)
        descendant = (
            'import os,signal,time; from pathlib import Path; '
            'signal.signal(signal.SIGTERM, signal.SIG_IGN); '
            f'Path({str(self.ready)!r}).write_text(str(os.getpid())); time.sleep(60)'
        )
        self.command = [sys.executable, '-c', (
            'import os,subprocess,sys,time; from pathlib import Path; '
            f'Path({str(self.group)!r}).write_text(str(os.getpgrp())); '
            f'subprocess.Popen([sys.executable,"-c",{descendant!r}]); time.sleep(60)'
        )]

    def cleanup_group(self):
        if self.group.exists():
            try:
                os.killpg(int(self.group.read_text()), signal.SIGKILL)
            except ProcessLookupError:
                pass

    def wait_ready(self):
        deadline = time.monotonic() + 5
        while not self.ready.exists():
            if time.monotonic() > deadline:
                self.fail('Test descendant did not start')
            time.sleep(0.02)

    def assert_descendant_stopped(self):
        self.wait_ready()
        proc = Path('/proc') / self.ready.read_text() / 'stat'
        deadline = time.monotonic() + 5
        while proc.exists():
            try:
                if proc.read_text().rsplit(')', 1)[1].split()[0] == 'Z':
                    return  # Exited and awaiting init's reap, not running.
            except FileNotFoundError:
                return
            if time.monotonic() > deadline:
                self.fail('Build descendant survived cancellation')
            time.sleep(0.02)

    def test_deadline_kills_a_descendant_that_ignores_term(self):
        with (self.root / 'log').open('w') as log:
            with self.assertRaises(subprocess.TimeoutExpired):
                builder.run_process(self.command, cwd=self.root, env=os.environ.copy(), log=log, timeout=2)
        self.assert_descendant_stopped()

    def test_controller_sigterm_stops_descendants(self):
        harness = (
            'import importlib.util,os,signal,sys; '
            f's=importlib.util.spec_from_file_location("builder",{str(MODULE)!r}); '
            'b=importlib.util.module_from_spec(s); s.loader.exec_module(b); '
            'signal.signal(signal.SIGTERM,b.interrupted); '
            f'b.run_process({self.command!r},cwd={str(self.root)!r},env=os.environ.copy(),log=sys.stdout,timeout=60)'
        )
        with (self.root / 'log').open('w') as log:
            process = subprocess.Popen([sys.executable, '-c', harness], stdout=log, stderr=log)
            try:
                self.wait_ready()
                process.send_signal(signal.SIGTERM)
                self.assertNotEqual(process.wait(timeout=10), 0)
                self.assert_descendant_stopped()
            finally:
                if process.poll() is None:
                    process.kill()
                    process.wait()


if __name__ == '__main__':
    unittest.main()
