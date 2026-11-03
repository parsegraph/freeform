"""Real subprocess checks: cancellation cannot leave build descendants running."""
import importlib.util
import io
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import tempfile
import time
import unittest
from unittest.mock import patch

MODULE = Path(__file__).resolve().parents[1] / 'deploy/vpn/build-artifact.py'
spec = importlib.util.spec_from_file_location('builder', MODULE)
builder = importlib.util.module_from_spec(spec)
spec.loader.exec_module(builder)


class BuilderTrustTests(unittest.TestCase):
    def test_root_and_worker_frozen_installs_keep_inherited_ca_trust(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            source = root / "checkout"
            source.mkdir()
            package = {"dependencies": {"parsegraph": "8.2.1"}}
            (source / "package.json").write_text(json.dumps(package))
            for sub in (".", "occluder", "textrenderer"):
                (source / sub).mkdir(exist_ok=True)
                (source / sub / "yarn.lock").write_text("unchanged fixture lock")
            installed = source / "node_modules/parsegraph"
            installed.mkdir(parents=True)
            (installed / "package.json").write_text(json.dumps({"version": "8.2.1"}))
            for name in ("index.html", "occluder.js", "textrenderer.js", "examples/sample.json", "examples/sample.lisp"):
                file = source / "build" / name
                file.parent.mkdir(parents=True, exist_ok=True)
                file.write_text("/freeform/static/fixture" if name == "index.html" else "fixture")
            ca_file = root / "VPN certificate.pem"
            ca_file.write_text("test CA bundle")
            installs = []
            real_run_process = builder.run_process

            def run(command, *, cwd, env, log, timeout=600):
                if command[:2] == ["yarn", "install"]:
                    installs.append(Path(cwd).relative_to(source).as_posix())
                    self.assertIn("--frozen-lockfile", command)
                    self.assertIn("--non-interactive", command)
                    self.assertEqual(env["NODE_EXTRA_CA_CERTS"], str(ca_file))
                    self.assertNotIn("NODE_TLS_REJECT_UNAUTHORIZED", env)
                    # Execute a real child with the exact environment assigned
                    # to each Yarn installation, without accessing a registry.
                    return real_run_process([sys.executable, "-c", (
                        "import os; from pathlib import Path; "
                        "assert Path(os.environ['NODE_EXTRA_CA_CERTS']).read_text() == 'test CA bundle'"
                    )], cwd=cwd, env=env, log=log, timeout=timeout)
                return 0

            def output(command, **kwargs):
                if command[:2] == ["git", "rev-parse"]:
                    return "a" * 40
                if command[:2] == ["git", "status"]:
                    return b""
                return "test-version"

            artifact = root / "artifact"
            with patch.object(builder, "__file__", str(source / "deploy/vpn/build-artifact.py")), \
                    patch.object(builder.signal, "signal"), \
                    patch.object(builder.subprocess, "check_output", side_effect=output), \
                    patch.object(builder, "run_process", side_effect=run), \
                    patch.object(sys, "argv", ["build-artifact.py", "--artifact-dir", str(artifact)]), \
                    patch.dict(os.environ, {"NODE_EXTRA_CA_CERTS": str(ca_file)}, clear=True), \
                    patch.object(sys, "stdout", io.StringIO()):
                builder.main()
            self.assertEqual(installs, [".", "occluder", "textrenderer"])
            self.assertEqual(json.loads((artifact / "acceptance.json").read_text())["build"], "passed")


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
