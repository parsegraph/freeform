import fcntl
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("freeform_installer", ROOT / "deploy/vpn/install-pipeline.py")
installer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(installer)
REVISION = "b" * 40
IMAGE = "sha256:" + "c" * 64


class InstallerTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.home = Path(self.temp.name)
        self.ca = self.home / "ca.pem"
        self.ca.write_text("public certificate")
        self.quadlet = self.home / ".config/containers/systemd/parsegraph-freeform.container"
        self.quadlet.parent.mkdir(parents=True)
        self.quadlet.write_text("[Container]\nImage=" + IMAGE + "\n")
        self.hook = self.home / "repo/freeform.git/hooks/post-receive"
        self.hook.parent.mkdir(parents=True)
        self.state = self.home / ".local/state/parsegraph-freeform/pipeline"
        self.config = self.home / ".config/parsegraph-freeform/pipeline.json"
        self.manual_record = self.state.parent / "deployment.json"
        self.manual_record.parent.mkdir(parents=True)
        self.artifact = self.home / "artifacts/manual"
        (self.artifact / "build").mkdir(parents=True)
        files = {
            "index.html": "<html>Freeform</html>",
            "deploy-revision.json": json.dumps({"revision": REVISION, "parsegraph": "7.0.1"}),
            "occluder.js": "self.onmessage = () => {};",
            "textrenderer.js": "self.onmessage = () => {};",
        }
        self.manifest = {}
        for name, content in files.items():
            path = self.artifact / "build" / name
            path.write_text(content)
            self.manifest[name] = {"sha256": hashlib.sha256(path.read_bytes()).hexdigest(), "mime": None}
        self.archive = self.artifact / "freeform.tgz"
        self.archive.write_bytes(b"verified archive fixture")
        digest = hashlib.sha256(self.archive.read_bytes()).hexdigest()
        self.acceptance = {"revision": REVISION, "tests": "passed", "build": "passed",
                           "files": {name: data["sha256"] for name, data in self.manifest.items()},
                           "archiveSha256": digest}
        (self.artifact / "acceptance.json").write_text(json.dumps(self.acceptance))
        self.manual_record.write_text(json.dumps({
            "status": "deployed", "revision": REVISION, "image": IMAGE,
            "artifact": str(self.artifact), "archiveSha256": digest,
        }))
        self.calls = []
        self.health = []
        self.manual_scope = ""
        self.running_image = IMAGE
        self.custom_hooks = False
        self.health_failure = False
        self.mutate_during_health = False

    def command(self, args, **kwargs):
        self.calls.append((args, kwargs))
        if "core.hooksPath" in args:
            return subprocess.CompletedProcess(args, 0 if self.custom_hooks else 1, "", "")
        return subprocess.CompletedProcess(args, 0, "", "")

    def output(self, args, **kwargs):
        self.calls.append((args, kwargs))
        if "--is-bare-repository" in args:
            return "true\n"
        if args[:2] == ["podman", "inspect"]:
            return self.running_image + "\n"
        if "list-units" in args:
            return self.manual_scope
        raise AssertionError("Unexpected subprocess: " + repr(args))

    def pipeline(self, source, config):
        case = self
        class VerifiedPipeline:
            def manifest(self, directory):
                actual = {}
                for path in directory.rglob("*"):
                    if path.is_file():
                        actual[str(path.relative_to(directory))] = {
                            "sha256": hashlib.sha256(path.read_bytes()).hexdigest(), "mime": None}
                return actual
            def verify(self, url, manifest, revision):
                case.health.append((url, manifest, revision))
                if url.startswith("https:"):
                    if case.health_failure:
                        raise RuntimeError("HTTPS baseline mismatch")
                    if case.mutate_during_health:
                        case.quadlet.write_text(case.quadlet.read_text() + "# concurrent deployment\n")
        return VerifiedPipeline()

    def install(self):
        with patch.object(installer.os, "geteuid", return_value=1000), \
             patch.object(installer.shutil, "which", return_value="/usr/bin/tool"), \
             patch.object(installer.subprocess, "check_output", side_effect=self.output), \
             patch.object(installer.subprocess, "run", side_effect=self.command), \
             patch.object(installer, "load_pipeline", side_effect=self.pipeline):
            installer.install(ROOT / "deploy", self.home, self.ca)

    def assert_no_schedule_changes(self):
        self.assertFalse(self.hook.exists())
        self.assertFalse(self.config.exists())
        self.assertFalse(any(args[:3] == ["systemctl", "--user", "stop"] for args, _ in self.calls))
        self.assertFalse(any("enable" in args for args, _ in self.calls))

    def test_installs_hook_limits_and_validated_current_baseline_without_queueing(self):
        manual_before = self.manual_record.read_bytes()
        self.install()
        self.assertEqual(self.manual_record.read_bytes(), manual_before)
        self.assertEqual(self.hook.stat().st_mode & 0o777, 0o755)
        self.assertIn("ops/deploy/vpn/pipeline.py", self.hook.read_text())
        self.assertIn(" enqueue\n", self.hook.read_text())
        config = json.loads(self.config.read_text())
        self.assertEqual(config["ref"], "refs/heads/freeform")
        self.assertEqual(config["bare_repo"], str(self.home / "repo/freeform.git"))
        self.assertEqual(config["public_url"], "https://parsegraph.fritonet.home.arpa/freeform")
        deployed = json.loads((self.state / "deployment.json").read_text())
        self.assertEqual(deployed["revision"], REVISION)
        self.assertEqual(deployed["image"], IMAGE)
        self.assertEqual(deployed["manifest"], self.manifest)
        self.assertEqual(deployed["artifact"]["path"], str(self.archive))
        self.assertFalse((self.state / "request.json").exists())
        self.assertEqual([entry[0] for entry in self.health], [config["local_url"], config["public_url"]])
        unit = (self.home / ".config/systemd/user/parsegraph-freeform-deploy.service").read_text()
        for setting in ("MemoryMax=3G", "MemorySwapMax=1G", "KillMode=control-group", "TimeoutStartSec=50min"):
            self.assertIn(setting, unit)
        self.assertIn(["systemctl", "--user", "enable", "--now", "parsegraph-freeform-deploy.path",
                       "parsegraph-freeform-deploy.timer"], [args for args, _ in self.calls])

    def test_reinstall_preserves_pipeline_baseline_and_old_manual_record(self):
        self.install()
        current = self.state / "deployment.json"
        record = json.loads(current.read_text())
        record["id"] = "successful-pipeline-attempt"
        current.write_text(json.dumps(record))
        before = current.read_bytes()
        # Once adopted, the historical manual receipt is no longer authoritative.
        self.manual_record.write_text('{"status":"old manual receipt"}')
        self.install()
        self.assertEqual(current.read_bytes(), before)

    def test_preserves_unrelated_hook(self):
        self.hook.write_text("#!/bin/sh\nexit 42\n")
        with self.assertRaisesRegex(RuntimeError, "unrelated"):
            self.install()
        self.assertIn("exit 42", self.hook.read_text())
        self.assertFalse(self.config.exists())
        self.assertFalse(any("enable" in args for args, _ in self.calls))

    def test_refuses_symlink_hook(self):
        target = self.home / "keep"
        target.write_text("keep me")
        self.hook.symlink_to(target)
        with self.assertRaisesRegex(RuntimeError, "symlink"):
            self.install()
        self.assertEqual(target.read_text(), "keep me")

    def test_refuses_custom_hooks_path(self):
        self.custom_hooks = True
        with self.assertRaisesRegex(RuntimeError, "core.hooksPath"):
            self.install()
        self.assert_no_schedule_changes()

    def test_refuses_operator_edited_configuration(self):
        self.config.parent.mkdir(parents=True)
        self.config.write_text('{"custom":"configuration"}')
        with self.assertRaisesRegex(RuntimeError, "Existing config differs"):
            self.install()
        self.assertEqual(self.config.read_text(), '{"custom":"configuration"}')
        self.assertFalse(self.hook.exists())

    def test_does_not_upgrade_while_worker_runs(self):
        self.state.mkdir(parents=True)
        with (self.state / "worker.lock").open("a") as stream:
            fcntl.flock(stream, fcntl.LOCK_EX | fcntl.LOCK_NB)
            with self.assertRaisesRegex(RuntimeError, "deployment is running"):
                self.install()
        self.assert_no_schedule_changes()

    def test_waits_for_manual_build_handover(self):
        self.manual_scope = "freeform-build-perf.scope loaded active running\n"
        with self.assertRaisesRegex(RuntimeError, "manual Freeform build"):
            self.install()
        self.assert_no_schedule_changes()

    def test_refuses_interrupted_activation(self):
        self.state.mkdir(parents=True)
        (self.state / "activation.json").write_text("{}")
        with self.assertRaisesRegex(RuntimeError, "Interrupted activation"):
            self.install()
        self.assert_no_schedule_changes()

    def test_rejects_running_image_mismatch_before_writes(self):
        self.running_image = "sha256:" + "d" * 64
        with self.assertRaisesRegex(RuntimeError, "Running Freeform container"):
            self.install()
        self.assert_no_schedule_changes()

    def test_rejects_tampered_archive_or_files_before_writes(self):
        original = self.archive.read_bytes()
        self.archive.write_bytes(b"changed archive")
        with self.assertRaisesRegex(RuntimeError, "archive hash"):
            self.install()
        self.archive.write_bytes(original)
        (self.artifact / "build/occluder.js").write_text("changed worker")
        with self.assertRaisesRegex(RuntimeError, "file hashes"):
            self.install()
        self.assert_no_schedule_changes()

    def test_requires_https_health_before_installation(self):
        self.health_failure = True
        with self.assertRaisesRegex(RuntimeError, "HTTPS baseline"):
            self.install()
        self.assert_no_schedule_changes()

    def test_detects_concurrent_manual_deployment_before_changes(self):
        self.mutate_during_health = True
        with self.assertRaisesRegex(RuntimeError, "deployment changed during preflight"):
            self.install()
        self.assert_no_schedule_changes()

    def test_preserves_manually_edited_installed_controller(self):
        self.install()
        controller = self.home / "var/parsegraph-freeform/ops/deploy/vpn/pipeline.py"
        controller.write_text("# operator edit\n")
        with self.assertRaisesRegex(RuntimeError, "Installed controller file changed"):
            self.install()
        self.assertEqual(controller.read_text(), "# operator edit\n")

    def test_git_hook_environment_does_not_leak_into_commands(self):
        with patch.dict(os.environ, {"GIT_DIR": "/unrelated.git", "GIT_WORK_TREE": "/wrong"}):
            self.install()
        self.assertTrue(self.calls)
        for _, options in self.calls:
            self.assertNotIn("GIT_DIR", options["env"])
            self.assertNotIn("GIT_WORK_TREE", options["env"])


if __name__ == "__main__":
    unittest.main()
