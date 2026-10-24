"""Python stdlib tests: git queue behavior, lifecycle failures, and HTTP contract."""
import concurrent.futures
from contextlib import contextmanager
import hashlib
import http.server
import importlib.util
import io
import json
import os
from pathlib import Path
import subprocess
import tempfile
import tarfile
import threading
import unittest
from unittest.mock import patch

MODULE = Path(__file__).resolve().parents[1] / "deploy" / "vpn" / "pipeline.py"
spec = importlib.util.spec_from_file_location("pipeline", MODULE)
pipeline = importlib.util.module_from_spec(spec)
spec.loader.exec_module(pipeline)
REV = "a" * 40
NEW = "b" * 40
IMAGE = "sha256:" + "c" * 64


def make_artifact(directory, revision=REV):
    build = directory / "build"
    build.mkdir(parents=True)
    entries = {"index.html": "home", "occluder.js": "self.onmessage=()=>{};",
               "textrenderer.js": "self.onmessage=()=>{};", "examples/sample.json": "{}",
               "examples/sample.lisp": "(square 5)",
               "deploy-revision.json": json.dumps({"revision": revision, "parsegraph": "7.0.1"})}
    for name, contents in entries.items():
        path = build / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(contents)
    archive = directory / "freeform.tgz"
    with tarfile.open(archive, "w:gz") as tar:
        for name in entries:
            tar.add(build / name, arcname=name)
    pipeline.write_json(directory / "acceptance.json", {
        "revision": revision, "parsegraph": "7.0.1", "publicUrl": "/freeform",
        "tests": "passed", "build": "passed", "archiveSha256": pipeline.sha256_file(archive),
        "files": {name: pipeline.sha256_file(build / name) for name in entries}})


class FakePipeline(pipeline.Pipeline):
    def __init__(self, config):
        super().__init__(config)
        self.revision = REV
        self.calls = []
        self.health_calls = []
        self.failure = None
        self.before_candidate = None
        self.after_builder = None
        self.on_public_failure = None
        self.checkout_revision = REV
        self.activation_checks = 0
        self.copied_modes = None

    def head(self):
        if self.revision is None:
            raise RuntimeError("freeform does not exist")
        return self.revision

    def run(self, args, cwd=None, timeout=None):
        args = list(map(str, args))
        self.calls.append(args)
        if self.failure == args:
            raise RuntimeError("injected command failure")
        if args[:2] == ["git", "clone"]:
            Path(args[-1]).mkdir()
        if args[:2] == ["git", "checkout"]:
            self.checkout_revision = args[-1]
        if args[:2] == ["python3", "deploy/vpn/build-artifact.py"]:
            if self.failure == "builder":
                raise RuntimeError("injected builder failure")
            make_artifact(Path(args[-1]), self.checkout_revision)
            pipeline.write_json(Path(cwd) / "package.json", {"dependencies": {"parsegraph": "7.0.1"}})
            if self.after_builder:
                self.after_builder(Path(args[-1]))
        if args[:2] == ["podman", "build"]:
            context = Path(args[-1])
            self.copied_modes = {str(p.relative_to(context)): p.stat().st_mode & 0o777
                                 for p in context.rglob("*")}
        if args[:3] == ["podman", "image", "inspect"]:
            return IMAGE
        if args[:2] == ["podman", "run"] and self.before_candidate:
            self.before_candidate()
        if args[:2] == ["podman", "port"]:
            return "127.0.0.1:54321"
        return ""

    def wait_healthy(self, url, manifest=None, revision=None):
        self.health_calls.append((url, revision))
        if self.failure == "public" and url == self.config["public_url"] and revision:
            if self.on_public_failure:
                self.on_public_failure()
            raise RuntimeError("public health failed")


class PipelineTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.config = {
            "bare_repo": str(self.root / "repo.git"), "state_dir": str(self.root / "state"),
            "build_root": str(self.root / "builds"), "container_dir": str(self.root / "templates"),
            "quadlet_file": str(self.root / "site.container"), "service_name": "site.service",
            "local_url": "http://127.0.0.1:4351/freeform", "public_url": "https://example.invalid/freeform",
            "nginx_image": "docker.io/library/nginx@sha256:" + "d" * 64,
        }
        Path(self.config["container_dir"]).mkdir()
        (Path(self.config["container_dir"]) / "Containerfile").write_text("FROM " + self.config["nginx_image"] + "\n")
        (Path(self.config["container_dir"]) / "nginx.conf").write_text("nginx.conf")
        Path(self.config["quadlet_file"]).write_text("[Container]\nImage=localhost/previous\n")
        self.p = FakePipeline(self.config)

    def tearDown(self):
        self.temp.cleanup()

    def request(self):
        return self.p.enqueue([f"{'0' * 40} {REV} refs/heads/freeform\n"])

    def status(self):
        return pipeline.read_json(self.p.state / "status.json")

    def test_non_freeform_delete_and_malformed_updates_do_not_queue(self):
        for line in (f"{REV} {NEW} refs/heads/feature", f"{REV} {NEW} refs/heads/main", f"{REV} {'0' * 40} refs/heads/freeform",
                     "malformed", f"{REV} bad refs/heads/freeform"):
            self.assertIsNone(self.p.enqueue([line]))
        self.assertFalse((self.p.state / "request.json").exists())

    def test_hook_uses_current_ref_not_stale_event(self):
        self.p.revision = NEW
        request = self.request()
        self.assertEqual(request["revision"], NEW)
        duplicate = self.request()
        self.assertEqual(duplicate["id"], request["id"])
        self.assertNotEqual(self.p.enqueue(retry=True)["id"], request["id"])

    def test_success_validates_candidate_local_and_https_then_retains_provenance(self):
        self.request()
        mask = os.umask(0o077)
        try:
            self.p.worker()
        finally:
            os.umask(mask)
        self.assertEqual(self.status()["phase"], "deployed")
        self.assertEqual([url for url, rev in self.p.health_calls],
                         ["http://127.0.0.1:54321/freeform", self.config["local_url"], self.config["public_url"]])
        deployment = pipeline.read_json(self.p.state / "deployment.json")
        self.assertEqual(deployment["image"], IMAGE)
        self.assertEqual(deployment["nginx_image"], self.config["nginx_image"])
        self.assertEqual(set(deployment["container_files"]), {"Containerfile", "nginx.conf"})
        self.assertEqual(self.p.copied_modes["build/deploy-revision.json"], 0o644)
        self.assertEqual(self.p.copied_modes["build"], 0o755)
        self.assertEqual(self.p.copied_modes["nginx.conf"], 0o644)
        self.assertEqual(list(Path(self.config["build_root"]).iterdir()), [])
        calls = len(self.p.calls)
        self.p.worker()
        self.assertEqual(len(self.p.calls), calls)

    def test_test_failure_does_not_touch_service_and_is_not_retried(self):
        self.request()
        self.p.failure = "builder"
        self.p.worker()
        self.assertEqual(self.status()["phase"], "failed")
        self.assertFalse(any(call[0] == "systemctl" for call in self.p.calls))
        self.assertIn("Image=localhost/previous", Path(self.config["quadlet_file"]).read_text())
        calls = len(self.p.calls)
        self.p.worker()
        self.assertEqual(len(self.p.calls), calls)
        self.p.enqueue(retry=True)
        self.p.failure = None
        self.p.worker()
        self.assertEqual(self.status()["phase"], "deployed")

    def test_public_failure_restores_previous_quadlet_and_service(self):
        self.request()
        self.p.failure = "public"
        pipeline.write_json(self.p.state / "deployment.json", {"revision": "initial-without-marker"})
        self.p.worker()
        self.assertEqual(self.status()["phase"], "failed")
        self.assertIn("Image=localhost/previous", Path(self.config["quadlet_file"]).read_text())
        self.assertEqual(sum(call[:3] == ["systemctl", "--user", "restart"] for call in self.p.calls), 2)
        self.assertEqual(self.p.health_calls[-1], (self.config["public_url"], None))
        self.assertFalse((self.p.state / "activation.json").exists())

    def test_obsolete_build_never_activates(self):
        self.request()
        self.p.before_candidate = lambda: setattr(self.p, "revision", NEW)
        self.p.worker()
        self.assertEqual(self.status()["phase"], "superseded")
        self.assertFalse(any(call[0] == "systemctl" for call in self.p.calls))

    def test_new_push_coalesces_older_build_and_deploys_only_latest(self):
        first = self.request()
        def newer_push(_):
            self.p.after_builder = None
            self.p.revision = NEW
            self.request()
        self.p.after_builder = newer_push
        self.p.worker()
        old = pipeline.read_json(self.p.state / "records" / (first["id"] + ".json"))
        self.assertEqual(old["phase"], "superseded")
        self.assertEqual(self.status()["phase"], "deployed")
        self.assertEqual(self.status()["revision"], NEW)
        self.assertEqual(sum(call[:3] == ["systemctl", "--user", "restart"] for call in self.p.calls), 1)

    def test_failed_receipt_never_builds_an_image_or_activates(self):
        self.request()
        def invalidate(directory):
            receipt = pipeline.read_json(directory / "acceptance.json")
            receipt["build"] = "failed"
            pipeline.write_json(directory / "acceptance.json", receipt)
        self.p.after_builder = invalidate
        self.p.worker()
        self.assertEqual(self.status()["phase"], "failed")
        self.assertFalse(any(call[:2] == ["podman", "build"] or call[0] == "systemctl" for call in self.p.calls))

    def test_failed_rollback_blocks_newer_request_and_preserves_journal(self):
        first = self.request()
        self.p.failure = "public"
        self.p.on_public_failure = lambda: self.p.enqueue(retry=True)
        with patch.object(self.p, "restore", side_effect=RuntimeError("rollback unavailable")):
            with self.assertRaisesRegex(RuntimeError, "recovery is incomplete"):
                self.p.worker()
        self.assertEqual(pipeline.read_json(self.p.state / "activation.json")["request"]["id"], first["id"])
        self.assertNotEqual(pipeline.read_json(self.p.state / "request.json")["id"], first["id"])
        self.assertEqual(sum(call[:2] == ["git", "clone"] for call in self.p.calls), 1)

    def test_pruning_preserves_live_previous_and_unmanaged_artifacts(self):
        active, previous = "1" * 32, "2" * 32
        expired, newest = "3" * 32, "4" * 32
        self.p.config.update(keep_records=1, keep_artifacts=1)
        pipeline.write_json(self.p.state / "deployment.json", {"id": active, "previous": {"id": previous}})
        for index, ident in enumerate((active, previous, expired, newest)):
            for directory, suffix in (("records", ".json"), ("logs", ".log"), ("artifacts", "")):
                path = self.p.state / directory / (ident + suffix)
                path.parent.mkdir(parents=True, exist_ok=True)
                if directory == "artifacts": path.mkdir()
                else: path.write_text("retained evidence")
                os.utime(path, (100 + index, 100 + index))
        unmanaged = self.p.state / "artifacts/operator-note"
        unmanaged.write_text("keep")
        self.p.prune()
        for ident in (active, previous, newest):
            self.assertTrue((self.p.state / "artifacts" / ident).exists())
            self.assertTrue((self.p.state / "records" / (ident + ".json")).exists())
        self.assertFalse((self.p.state / "artifacts" / expired).exists())
        self.assertTrue(unmanaged.exists())

    def test_artifact_rejects_stale_archive_even_with_updated_archive_checksum(self):
        directory = self.root / "candidate"
        make_artifact(directory)
        self.p.artifact(directory, REV)
        archive = directory / "freeform.tgz"
        with tarfile.open(archive, "w:gz") as tar:
            entry = tarfile.TarInfo("index.html")
            entry.size = 5
            tar.addfile(entry, io.BytesIO(b"stale"))
        receipt = pipeline.read_json(directory / "acceptance.json")
        receipt["archiveSha256"] = pipeline.sha256_file(archive)
        pipeline.write_json(directory / "acceptance.json", receipt)
        with self.assertRaisesRegex(RuntimeError, "Archive content differs"):
            self.p.artifact(directory, REV)

    def test_missing_worker_or_changed_file_rejects_artifact(self):
        directory = self.root / "candidate"
        make_artifact(directory)
        (directory / "build/index.html").write_text("different")
        with self.assertRaisesRegex(RuntimeError, "file hashes"):
            self.p.artifact(directory, REV)
        (directory / "build/occluder.js").unlink()
        with self.assertRaisesRegex(RuntimeError, "missing"):
            self.p.artifact(directory, REV)

    def test_deleted_freeform_is_terminal_failure(self):
        self.request()
        self.p.revision = None
        self.p.worker()
        self.assertEqual(self.status()["phase"], "failed")
        self.assertIn("freeform does not exist", self.status()["error"])
        self.p.worker()
        self.assertEqual(self.status()["phase"], "failed")

    def test_queue_lock_serializes_concurrent_hooks(self):
        with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
            requests = list(pool.map(lambda _: self.request(), range(30)))
        self.assertEqual(len({request["id"] for request in requests}), 1)
        self.assertEqual(pipeline.read_json(self.p.state / "request.json")["revision"], REV)

    def test_worker_lock_excludes_second_worker(self):
        self.request()
        with pipeline.lock(self.p.state / "worker.lock"):
            self.p.worker()
        self.assertEqual(self.p.calls, [])
        self.assertIsNone(self.status())

    def test_activation_recovery_rolls_back_before_new_work(self):
        request = self.request()
        previous = Path(self.config["quadlet_file"]).read_text()
        pipeline.write_json(self.p.state / "activation.json", {
            "request": request, "previous_quadlet": previous, "previous_deployment": {}})
        Path(self.config["quadlet_file"]).write_text("[Container]\nImage=broken\n")
        self.p.record(request, "building")
        self.p.worker()
        self.assertEqual(self.status()["phase"], "failed")
        self.assertEqual(Path(self.config["quadlet_file"]).read_text(), previous)
        self.assertFalse(any(call[0] == "python3" for call in self.p.calls))

    def test_committed_activation_is_reconciled_without_rebuilding(self):
        request = self.request()
        pipeline.write_json(self.p.state / "deployment.json", dict(request, image=IMAGE))
        pipeline.write_json(self.p.state / "activation.json", {
            "request": request, "previous_quadlet": "old", "previous_deployment": {}})
        self.p.record(request, "building")
        self.p.worker()
        self.assertEqual(self.status()["phase"], "deployed")
        self.assertFalse(any(call[0] in ("git", "python3", "systemctl") for call in self.p.calls))

    def test_interrupted_build_is_cleaned_and_needs_explicit_retry(self):
        request = self.request()
        old = Path(self.config["build_root"]) / ("build-" + request["id"] + "-leftover")
        old.mkdir(parents=True)
        (old / "large-dependency").write_text("leftover")
        self.p.record(request, "building")
        self.p.worker()
        self.assertEqual(self.status()["phase"], "failed")
        self.assertFalse(old.exists())
        self.assertFalse(any(call[0] == "python3" for call in self.p.calls))

    def test_interrupted_cleanup_preserves_configured_immutable_image(self):
        request = self.request()
        Path(self.config["quadlet_file"]).write_text("[Container]\nImage=" + IMAGE + "\n")
        self.p.cleanup_attempt(request, remove_image=True)
        self.assertFalse(any(call[:3] == ["podman", "image", "rm"] for call in self.p.calls))

    def test_real_git_resolves_head_despite_dirty_hook_environment(self):
        repo = Path(self.config["bare_repo"])
        environment = pipeline.clean_env()
        subprocess.run(["git", "init", "--bare", str(repo)], env=environment, check=True, capture_output=True)
        tree = subprocess.run(["git", "--git-dir", str(repo), "mktree"], input="", text=True,
                              capture_output=True, check=True, env=environment).stdout.strip()
        env = dict(environment, GIT_AUTHOR_NAME="Test", GIT_AUTHOR_EMAIL="test@example.invalid",
                   GIT_COMMITTER_NAME="Test", GIT_COMMITTER_EMAIL="test@example.invalid")
        commit = subprocess.run(["git", "--git-dir", str(repo), "commit-tree", tree, "-m", "test"],
                                text=True, capture_output=True, check=True, env=env).stdout.strip()
        subprocess.run(["git", "--git-dir", str(repo), "update-ref", "refs/heads/freeform", commit],
                       env=environment, check=True)
        actual = pipeline.Pipeline(self.config)
        with patch.dict(os.environ, {"GIT_DIR": "/missing/repo", "GIT_WORK_TREE": "/missing/tree",
                                    "GIT_CONFIG_COUNT": "1", "GIT_CONFIG_KEY_0": "not valid", "GIT_CONFIG_VALUE_0": "bad"}):
            self.assertEqual(actual.head(), commit)
            self.assertFalse(any(key.startswith("GIT_") for key in pipeline.clean_env()))

    def test_http_checks_hashes_mime_revision_headers_and_missing_routes(self):
        payloads = {"/freeform/": ("text/html", b"home"), "/freeform/index.html": ("text/html", b"home"),
                    "/freeform/occluder.js": ("text/javascript", b"worker"),
                    "/freeform/examples/sample.lisp": ("text/plain", b"(square 5)"),
                    "/freeform/deploy-revision.json": ("application/json", ('{"revision":"' + REV + '"}').encode())}
        controls = {"cache": "no-cache", "redirect": "/freeform/?sample=proportion_v1"}
        class Handler(http.server.BaseHTTPRequestHandler):
            def do_GET(self):
                if self.path == "/freeform?sample=proportion_v1":
                    self.send_response(308)
                    self.send_header("Location", controls["redirect"])
                    self.end_headers()
                    return
                entry = payloads.get(self.path)
                self.send_response(200 if entry else 404)
                self.send_header("Content-Type", entry[0] if entry else "text/html")
                self.send_header("X-Content-Type-Options", "nosniff")
                self.send_header("Cache-Control", controls["cache"])
                self.end_headers()
                self.wfile.write(entry[1] if entry else b"missing")

            def log_message(self, *args):
                pass
        server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        actual = pipeline.Pipeline(self.config)
        base = "http://127.0.0.1:" + str(server.server_port) + "/freeform"
        manifest = {route[len("/freeform/"):]: {"mime": mime, "sha256": hashlib.sha256(body).hexdigest()}
                    for route, (mime, body) in payloads.items() if route != "/freeform/"}
        try:
            actual.verify(base, manifest, REV)
            payloads["/freeform/occluder.js"] = ("text/html", b"worker")
            with self.assertRaisesRegex(RuntimeError, "MIME"):
                actual.verify(base, manifest, REV)
            payloads["/freeform/occluder.js"] = ("text/javascript", b"changed")
            with self.assertRaisesRegex(RuntimeError, "Asset verification"):
                actual.verify(base, manifest, REV)
            payloads["/freeform/occluder.js"] = ("text/javascript", b"worker")
            controls["cache"] = "public, max-age=31536000"
            with self.assertRaisesRegex(RuntimeError, "revalidate"):
                actual.verify(base, manifest, REV)
            controls["cache"] = "no-cache"
            controls["redirect"] = "/freeform/"
            with self.assertRaisesRegex(RuntimeError, "preserve the query"):
                actual.verify(base, manifest, REV)
            controls["redirect"] = "/freeform/?sample=proportion_v1"
            payloads["/freeform/api/"] = ("text/html", b"bad fallback")
            with self.assertRaisesRegex(RuntimeError, "real 404"):
                actual.verify(base, manifest, REV)
        finally:
            server.shutdown()
            server.server_close()
            thread.join()


if __name__ == "__main__":
    unittest.main()
