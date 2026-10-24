import importlib.util
import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch


spec = importlib.util.spec_from_file_location("route", Path(__file__).parents[1] / "deploy/vpn/install-route.py")
route = importlib.util.module_from_spec(spec)
spec.loader.exec_module(route)
REVISION = "a" * 40


class RouteTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.config = Path(self.directory.name) / "parsegraph.conf"
        self.config.write_text(route.ORIGINAL)
        config = patch.object(route, "CONFIG", self.config)
        config.start()
        self.addCleanup(config.stop)

    def test_mount_preserves_tls_site_proxy_and_queries(self):
        self.assertEqual(route.DESIRED.count(route.ROUTES), 1)
        self.assertEqual(route.DESIRED.replace(route.ROUTES, ""), route.ORIGINAL)
        self.assertIn("return 308 /freeform/$is_args$args;", route.ROUTES)
        self.assertIn("proxy_pass http://127.0.0.1:4351;", route.ROUTES)

    def test_refuses_unrelated_change_and_symlink(self):
        self.config.write_text(route.ORIGINAL + "# unrelated edit\n")
        with self.assertRaisesRegex(RuntimeError, "differs"):
            route.current_config()
        self.config.unlink()
        target = Path(self.directory.name) / "target"
        target.write_text(route.ORIGINAL)
        self.config.symlink_to(target)
        with self.assertRaises(OSError):
            route.current_config()

    def response(self, path):
        if path.startswith("/freeform?"):
            return 308, {"Location": "/freeform/?sample=proportion_v1"}, b""
        if "missing-deployment-check" in path:
            return 404, {}, b""
        if path.endswith(".json"):
            return 200, {"Content-Type": "application/json"}, json.dumps({"revision": REVISION}).encode()
        if path.endswith(".js"):
            return 200, {"Content-Type": "text/javascript"}, b"self.onmessage = () => {};"
        if path.endswith(".lisp"):
            return 200, {"Content-Type": "text/plain"}, b"(square 5)"
        return 200, {"Content-Type": "text/html; charset=utf-8"}, b"<!doctype html>"

    def test_upstream_requires_exact_revision_and_worker_mime(self):
        with patch.object(route, "fetch", side_effect=self.response):
            route.verify_upstream(REVISION)
            with self.assertRaisesRegex(RuntimeError, "revision"):
                route.verify_upstream("b" * 40)
        def bad_worker(path):
            return (200, {"Content-Type": "text/html"}, b"fallback") if path.endswith("occluder.js") else self.response(path)
        with patch.object(route, "fetch", side_effect=bad_worker):
            with self.assertRaisesRegex(RuntimeError, "occluder"):
                route.verify_upstream(REVISION)

    def test_installed_route_is_idempotent_after_health_check(self):
        self.config.write_text(route.DESIRED)
        with patch.object(route, "verify_upstream") as health, patch.object(route, "run") as run, patch.object(route, "preserve_backup") as backup:
            route.install(REVISION)
            health.assert_called_once_with(REVISION)
            run.assert_not_called()
            backup.assert_not_called()

    def exercise_failure(self, fail_reload):
        calls = []
        syntax_calls = 0
        failed = False
        def run(*command):
            nonlocal syntax_calls, failed
            calls.append(command)
            if command == ("nginx", "-t"):
                syntax_calls += 1
            fail_here = command == ("systemctl", "reload", "nginx") if fail_reload else command == ("nginx", "-t") and syntax_calls == 2
            if fail_here and not failed:
                failed = True
                raise subprocess.CalledProcessError(1, command)
        original = self.config.read_bytes()
        with patch.object(route, "verify_upstream"), patch.object(route, "preserve_backup", return_value=Path(self.directory.name) / "backup"), patch.object(route, "run", side_effect=run):
            with self.assertRaisesRegex(RuntimeError, "original nginx configuration restored"):
                route.install(REVISION)
        self.assertEqual(self.config.read_bytes(), original)
        self.assertEqual(calls.count(("systemctl", "reload", "nginx")), 2 if fail_reload else 0)

    def test_syntax_failure_restores_without_reload(self):
        self.exercise_failure(False)

    def test_reload_failure_restores_and_reloads_prior_config(self):
        self.exercise_failure(True)


if __name__ == "__main__":
    unittest.main()
