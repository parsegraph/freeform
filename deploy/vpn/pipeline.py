#!/usr/bin/env python3
"""Host-installed Freeform VPN controller; pushes queue builds, never run them."""
import argparse
import contextlib
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import signal
import ssl
import subprocess
import sys
import tarfile
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid


def clean_env():
    # Hooks inherit GIT_DIR, GIT_WORK_TREE, quarantine, and config overrides.
    return {**{key: value for key, value in os.environ.items() if not key.startswith("GIT_")},
            "PYTHONDONTWRITEBYTECODE": "1"}


def sha256_file(path):
    digest = hashlib.sha256()
    with open(path, "rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def read_json(path, default=None):
    try:
        return json.loads(Path(path).read_text())
    except FileNotFoundError:
        return default


def atomic_write(path, data):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, name = tempfile.mkstemp(prefix="." + path.name + ".", dir=path.parent)
    try:
        with os.fdopen(fd, "w") as stream:
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(name, path)
        directory = os.open(path.parent, os.O_RDONLY)
        try:
            os.fsync(directory)
        finally:
            os.close(directory)
    finally:
        if os.path.exists(name):
            os.unlink(name)


def write_json(path, value):
    atomic_write(path, json.dumps(value, indent=2) + "\n")


@contextlib.contextmanager
def lock(path, blocking=True):
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    with open(path, "a") as stream:
        try:
            fcntl.flock(stream, fcntl.LOCK_EX | (0 if blocking else fcntl.LOCK_NB))
        except BlockingIOError:
            yield False
            return
        try:
            yield True
        finally:
            fcntl.flock(stream, fcntl.LOCK_UN)


class Pipeline:
    def __init__(self, config):
        self.config = config
        self.state = Path(config["state_dir"])
        self.state.mkdir(parents=True, exist_ok=True)
        self.log = None
        self.timeout = config.get("command_timeout", 600)
        self.health_timeout = config.get("health_timeout", 45)
        self.ref = config.get("ref", "refs/heads/freeform")
        if self.ref != "refs/heads/freeform":
            raise ValueError("Only refs/heads/freeform may deploy this VPN editor")

    def run(self, args, cwd=None, timeout=None):
        if self.log:
            self.log.write("\n$ " + " ".join(map(str, args)) + "\n")
            self.log.flush()
        # Separate process group lets command timeouts terminate npm/podman children.
        with tempfile.TemporaryFile(mode="w+") as output:
            proc = subprocess.Popen(list(map(str, args)), cwd=cwd, env=clean_env(),
                                    stdout=output, stderr=subprocess.STDOUT, text=True,
                                    start_new_session=True)
            try:
                proc.wait(timeout=timeout or self.timeout)
            except BaseException:
                try:
                    os.killpg(proc.pid, signal.SIGTERM)
                except ProcessLookupError:
                    pass
                try:
                    # The builder needs up to five seconds to stop its own
                    # separately grouped Yarn/Node children before exiting.
                    proc.wait(timeout=10)
                except subprocess.TimeoutExpired:
                    os.killpg(proc.pid, signal.SIGKILL)
                    proc.wait()
                raise
            finally:
                output.seek(0)
                result = output.read()
                if self.log:
                    self.log.write(result)
                    self.log.flush()
            if proc.returncode:
                raise RuntimeError(f"Command failed ({proc.returncode}): {' '.join(map(str, args))}\n{result[-4000:]}")
            return result.strip()

    def head(self):
        revision = self.run(["git", "--git-dir", self.config["bare_repo"], "rev-parse", "--verify", self.ref + "^{commit}"])
        if not re.fullmatch(r"[0-9a-f]{40,64}", revision):
            raise RuntimeError("Freeform branch did not resolve to a full commit ID")
        return revision

    def enqueue(self, lines=None, retry=False):
        if not retry:
            updates = [line.split() for line in lines]
            if not any(len(row) == 3 and row[2] == self.ref and
                       re.fullmatch(r"[0-9a-fA-F]{40,64}", row[1]) and set(row[1]) != {"0"}
                       for row in updates):
                return None
        with lock(self.state / "queue.lock"):
            # Read the actual ref, not the event's new SHA: concurrent hook delivery
            # may be reordered after refs have already been updated.
            revision = self.head()
            current = read_json(self.state / "request.json")
            if current and current["revision"] == revision and not retry:
                return current
            request = {"id": uuid.uuid4().hex, "revision": revision, "requested_at": time.time()}
            write_json(self.state / "request.json", request)
            return request

    def current(self, request):
        with lock(self.state / "queue.lock"):
            latest = read_json(self.state / "request.json")
            return latest and latest["id"] == request["id"] and self.head() == request["revision"]

    def record(self, request, phase, **details):
        status = dict(request, phase=phase, updated_at=time.time(), **details)
        write_json(self.state / "status.json", status)
        write_json(self.state / "records" / (request["id"] + ".json"), status)
        return status

    def verify(self, base_url, manifest=None, revision=None):
        base_url = base_url.rstrip("/")
        if urllib.parse.urlsplit(base_url).path != "/freeform":
            raise ValueError("Freeform must be checked at its /freeform prefix")
        context = ssl.create_default_context(cafile=self.config.get("ca_file")) if base_url.startswith("https:") else None
        class NoRedirect(urllib.request.HTTPRedirectHandler):
            def redirect_request(self, *args, **kwargs):
                return None
        opener = urllib.request.build_opener(NoRedirect(), urllib.request.HTTPSHandler(context=context))
        def fetch(relative):
            url = base_url + "/" + urllib.parse.quote(relative, safe="/")
            try:
                response = opener.open(url, timeout=5)
            except urllib.error.HTTPError as error:
                response = error
            with response:
                body = response.read(64 * 1024 * 1024 + 1)
                if len(body) > 64 * 1024 * 1024:
                    raise RuntimeError(f"Unexpectedly large response: {url}")
                return response.code, response.headers, body
        status, headers, body = fetch("")
        if status != 200 or headers.get_content_type() != "text/html" or not body:
            raise RuntimeError(f"{base_url} returned {status}")
        if manifest:
            for relative, expected in manifest.items():
                status, headers, body = fetch(relative)
                if status != 200 or hashlib.sha256(body).hexdigest() != expected["sha256"]:
                    raise RuntimeError(f"Asset verification failed: {base_url}/{relative}")
                if expected["mime"] and headers.get_content_type() != expected["mime"]:
                    raise RuntimeError(f"Incorrect MIME for {relative}: {headers.get_content_type()}")
                if headers.get("X-Content-Type-Options") != "nosniff":
                    raise RuntimeError(f"Missing nosniff header: {relative}")
                if headers.get("Cache-Control") != "no-cache":
                    raise RuntimeError(f"Unversioned files must revalidate: {relative}")
        if revision:
            status, headers, body = fetch("deploy-revision.json")
            if status != 200 or json.loads(body).get("revision") != revision:
                raise RuntimeError("Served revision differs from candidate")
        for relative in ("__freeform_missing_page__", "static/__missing__.js", "admin/", "api/", ".git/config"):
            if fetch(relative)[0] != 404:
                raise RuntimeError(f"Expected real 404 for {relative}")
        try:
            redirect = opener.open(base_url + "?sample=proportion_v1", timeout=5)
        except urllib.error.HTTPError as error:
            redirect = error
        with redirect:
            expected = base_url + "/?sample=proportion_v1"
            location = urllib.parse.urljoin(base_url, redirect.headers.get("Location", ""))
            if redirect.code != 308 or location != expected:
                raise RuntimeError("Freeform redirect must preserve the query and origin")

    def wait_healthy(self, base_url, manifest=None, revision=None):
        deadline = time.monotonic() + self.health_timeout
        while True:
            try:
                self.verify(base_url, manifest, revision)
                return
            except (OSError, ValueError, RuntimeError) as error:
                if time.monotonic() >= deadline:
                    raise RuntimeError(f"Health check failed for {base_url}: {error}") from error
                time.sleep(1)

    def manifest(self, directory):
        mimes = {".html": "text/html", ".css": "text/css", ".js": "text/javascript",
                 ".mjs": "text/javascript", ".json": "application/json", ".parsegraph": "application/json",
                 ".txt": "text/plain", ".lisp": "text/plain", ".svg": "image/svg+xml",
                 ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".ico": "image/x-icon",
                 ".gif": "image/gif", ".webp": "image/webp", ".woff": "font/woff", ".woff2": "font/woff2"}
        result = {}
        for path in sorted(directory.rglob("*")):
            if path.is_symlink():
                raise RuntimeError(f"Symlinks are not allowed in distribution: {path}")
            if path.is_file():
                result[str(path.relative_to(directory))] = {
                    "sha256": sha256_file(path), "mime": mimes.get(path.suffix)}
        required = {"index.html", "deploy-revision.json", "occluder.js", "textrenderer.js",
                    "examples/sample.json", "examples/sample.lisp"}
        if not required.issubset(result):
            raise RuntimeError("Distribution is missing the app, revision marker, workers, or samples")
        return result

    def artifact(self, directory, revision):
        """Check the builder receipt against actual files and every archive member."""
        report = read_json(directory / "acceptance.json")
        if not isinstance(report, dict) or report.get("revision") != revision or report.get("tests") != "passed" or report.get("build") != "passed":
            raise RuntimeError("Builder receipt is incomplete or names a different revision")
        if report.get("publicUrl") != "/freeform" or not re.fullmatch(r"\d+\.\d+\.\d+", report.get("parsegraph", "")):
            raise RuntimeError("Builder receipt has an invalid public path or package version")
        manifest = self.manifest(directory / "build")
        if report.get("files") != {name: item["sha256"] for name, item in manifest.items()}:
            raise RuntimeError("Artifact file hashes differ from builder receipt")
        marker = read_json(directory / "build/deploy-revision.json", {})
        if marker.get("revision") != revision or marker.get("parsegraph") != report["parsegraph"]:
            raise RuntimeError("Artifact revision marker differs from builder receipt")
        archive = directory / "freeform.tgz"
        digest = sha256_file(archive)
        if report.get("archiveSha256") != digest:
            raise RuntimeError("Artifact archive hash differs from builder receipt")
        seen = set()
        with tarfile.open(archive, "r:gz") as tar:
            for member in tar:
                if not member.isfile() or member.name not in manifest or member.name in seen:
                    raise RuntimeError("Unexpected archive member: " + member.name)
                seen.add(member.name)
                with tar.extractfile(member) as stream:
                    entry_digest = hashlib.sha256()
                    for chunk in iter(lambda: stream.read(1024 * 1024), b""):
                        entry_digest.update(chunk)
                if entry_digest.hexdigest() != manifest[member.name]["sha256"]:
                    raise RuntimeError("Archive content differs from checked files: " + member.name)
        if seen != set(manifest):
            raise RuntimeError("Archive is missing checked files")
        return manifest, {"path": str(archive), "sha256": digest}, report

    def reload(self):
        self.run(["systemctl", "--user", "daemon-reload"])
        self.run(["systemctl", "--user", "restart", self.config["service_name"]])

    def restore(self, recovery):
        atomic_write(self.config["quadlet_file"], recovery["previous_quadlet"])
        self.reload()
        previous = recovery.get("previous_deployment") or {}
        manifest = previous.get("manifest")
        revision = previous.get("revision") if manifest and "deploy-revision.json" in manifest else None
        self.wait_healthy(self.config["local_url"], manifest, revision)
        self.wait_healthy(self.config["public_url"], manifest, revision)
        write_json(self.state / "deployment.json", previous)

    def recover(self):
        recovery_path = self.state / "activation.json"
        recovery = read_json(recovery_path)
        if not recovery:
            return
        deployed = read_json(self.state / "deployment.json", {})
        if deployed.get("id") != recovery["request"]["id"]:
            self.restore(recovery)
            self.record(recovery["request"], "failed", error="Interrupted activation rolled back; retry explicitly")
        else:
            self.record(recovery["request"], "deployed", image=deployed["image"], artifact=deployed.get("artifact"))
        recovery_path.unlink()
        self.cleanup_attempt(recovery["request"], remove_image=True)

    def activate(self, request, image, manifest, artifact, provenance=None):
        if not self.current(request):
            raise RuntimeError("Request superseded immediately before activation")
        path = Path(self.config["quadlet_file"])
        if path.is_symlink():
            raise RuntimeError("Refusing a symlink Quadlet")
        previous = path.read_text()
        if len(re.findall(r"^Image=.+$", previous, flags=re.MULTILINE)) != 1:
            raise RuntimeError("Expected exactly one Image= in existing Quadlet")
        recovery = {"request": request, "previous_quadlet": previous,
                    "previous_deployment": read_json(self.state / "deployment.json", {})}
        write_json(self.state / "activation.json", recovery)
        updated = re.sub(r"^Image=.+$", "Image=" + image, previous, flags=re.MULTILINE)
        try:
            atomic_write(path, updated)
            self.reload()
            self.wait_healthy(self.config["local_url"], manifest, request["revision"])
            self.wait_healthy(self.config["public_url"], manifest, request["revision"])
            prior = recovery["previous_deployment"]
            previous_summary = {key: prior[key] for key in ("id", "revision", "image", "artifact", "manifest", "deployed_at") if key in prior}
            deployed = dict(request, image=image, manifest=manifest, artifact=artifact, deployed_at=time.time(), previous=previous_summary,
                            **(provenance or {}))
            write_json(self.state / "artifacts" / request["id"] / "deployment.json", deployed)
            write_json(self.state / "deployment.json", deployed)
        except BaseException:
            self.restore(recovery)
            (self.state / "activation.json").unlink()
            raise
        (self.state / "activation.json").unlink()

    def build(self, request):
        build_root = Path(self.config["build_root"])
        build_root.mkdir(parents=True, exist_ok=True)
        workspace = Path(tempfile.mkdtemp(prefix="build-" + request["id"] + "-", dir=build_root))
        name = "parsegraph-freeform-candidate-" + request["id"]
        image = "localhost/parsegraph-freeform:" + request["revision"] + "-" + request["id"]
        image_id = None
        deployed = False
        try:
            source = workspace / "source"
            self.run(["git", "clone", "--no-checkout", "--no-hardlinks", self.config["bare_repo"], source])
            self.run(["git", "checkout", "--detach", request["revision"]], cwd=source)
            artifact_dir = self.state / "artifacts" / request["id"]
            self.run(["python3", "deploy/vpn/build-artifact.py", "--artifact-dir", artifact_dir], cwd=source,
                     timeout=self.config.get("build_timeout", 2400))
            manifest, artifact, receipt = self.artifact(artifact_dir, request["revision"])
            package = read_json(source / "package.json")
            if package.get("dependencies", {}).get("parsegraph") != receipt["parsegraph"]:
                raise RuntimeError("Built package version differs from the committed dependency")
            write_json(artifact_dir / "manifest.json", manifest)
            context = workspace / "context"
            context.mkdir()
            shutil.copytree(artifact_dir / "build", context / "build")
            # systemd UMask=0077 protects operational records; static files must
            # nevertheless be readable by nginx's unprivileged container UID.
            (context / "build").chmod(0o755)
            for entry in (context / "build").rglob("*"):
                if entry.is_symlink():
                    raise RuntimeError("Symlinks are not allowed in distribution")
                entry.chmod(0o755 if entry.is_dir() else 0o644)
            for filename in ("Containerfile", "nginx.conf"):
                shutil.copyfile(Path(self.config["container_dir"]) / filename, context / filename)
                (context / filename).chmod(0o644)
            bases = re.findall(r"^FROM ([^\s]+@sha256:[0-9a-f]{64})\s*$", (context / "Containerfile").read_text(), re.MULTILINE)
            if len(bases) != 1:
                raise RuntimeError("Installed Containerfile must pin exactly one base image digest")
            self.run(["podman", "build", "--pull=never", "--build-arg",
                      "SOURCE_REVISION=" + request["revision"], "-t", image, context])
            image_id = self.run(["podman", "image", "inspect", "--format", "{{.Id}}", image])
            if re.fullmatch(r"[0-9a-f]{64}", image_id):
                image_id = "sha256:" + image_id
            if not re.fullmatch(r"sha256:[0-9a-f]{64}", image_id):
                raise RuntimeError("Expected content-addressed image ID")
            provenance = {"image_tag": image, "nginx_image": bases[0], "parsegraph": receipt["parsegraph"],
                          "acceptance": str(artifact_dir / "acceptance.json"),
                          "controller_sha256": hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
                          "container_files": {filename: hashlib.sha256((context / filename).read_bytes()).hexdigest()
                                              for filename in ("Containerfile", "nginx.conf")}}
            if not self.current(request):
                return "superseded", {"image": image, "artifact": artifact}
            self.run(["podman", "run", "--detach", "--name", name, "--pull=never", "--read-only", "--read-only-tmpfs=false",
                      "--tmpfs", "/tmp:rw,nosuid,nodev,noexec,size=16m,mode=1777", "--cap-drop=all",
                      "--security-opt=no-new-privileges", "--publish", "127.0.0.1::8080", image_id])
            address = self.run(["podman", "port", name, "8080/tcp"])
            if not re.fullmatch(r"127\.0\.0\.1:[0-9]+", address):
                raise RuntimeError("Candidate must bind a single loopback port")
            self.wait_healthy("http://" + address + "/freeform", manifest, request["revision"])
            if not self.current(request):
                return "superseded", {"image": image, "artifact": artifact}
            self.activate(request, image_id, manifest, artifact, provenance)
            deployed = True
            return "deployed", {"image": image_id, "image_tag": image, "artifact": artifact,
                                "deployment_record": str(artifact_dir / "deployment.json")}
        finally:
            try:
                self.run(["podman", "rm", "--force", "--ignore", name])
                configured = re.findall(r"^Image=(.+)$", Path(self.config["quadlet_file"]).read_text(), flags=re.MULTILINE)
                if not deployed and image not in configured and image_id not in configured:
                    self.run(["podman", "image", "rm", "--ignore", image])
            except Exception as error:
                if self.log:
                    self.log.write(f"Candidate cleanup: {error}\n")
            shutil.rmtree(workspace)

    def cleanup_attempt(self, request, remove_image=False):
        """Only clean this controller's recorded attempt; retain configured images."""
        ident = request["id"]
        if not re.fullmatch(r"[0-9a-f]{32}", ident) or not re.fullmatch(r"[0-9a-f]{40,64}", request["revision"]):
            raise RuntimeError("Invalid recorded attempt ID")
        self.run(["podman", "rm", "--force", "--ignore", "parsegraph-freeform-candidate-" + ident])
        if remove_image:
            tag = "localhost/parsegraph-freeform:" + request["revision"] + "-" + ident
            configured = re.findall(r"^Image=(.+)$", Path(self.config["quadlet_file"]).read_text(), re.MULTILINE)
            deployment = read_json(self.state / "deployment.json", {})
            try:
                ident_image = self.run(["podman", "image", "inspect", "--format", "{{.Id}}", tag])
                if re.fullmatch(r"[0-9a-f]{64}", ident_image):
                    ident_image = "sha256:" + ident_image
            except RuntimeError:
                ident_image = None  # No image was built, or inspection failed.
            if ident_image and deployment.get("id") != ident and tag not in configured and ident_image not in configured and ident_image != deployment.get("image"):
                # Do not force deletion: a surviving running container also protects it.
                self.run(["podman", "image", "rm", "--ignore", tag])
        for workspace in Path(self.config["build_root"]).glob("build-" + ident + "-*"):
            if workspace.is_symlink():
                raise RuntimeError("Refusing symlink build workspace")
            shutil.rmtree(workspace)

    def prune(self):
        protected = set()
        for item in (read_json(self.state / "deployment.json", {}),
                     read_json(self.state / "request.json", {}),
                     read_json(self.state / "status.json", {})):
            protected.update(value for value in (item.get("id"), item.get("previous", {}).get("id")) if value)
        recovery = read_json(self.state / "activation.json", {})
        protected.update(item["id"] for item in (recovery.get("request", {}), recovery.get("previous_deployment", {})) if "id" in item)
        for directory, keep in (("records", self.config.get("keep_records", 20)),
                                ("logs", self.config.get("keep_records", 20)),
                                ("artifacts", self.config.get("keep_artifacts", 5))):
            path = self.state / directory
            if not path.exists():
                continue
            items = sorted((item for item in path.iterdir() if not item.is_symlink()
                            and re.fullmatch(r"[0-9a-f]{32}(?:\.(?:json|log))?", item.name)),
                           key=lambda p: p.stat().st_mtime, reverse=True)
            for item in items[max(1, keep):]:
                if item.name.split(".", 1)[0] in protected:
                    continue
                if item.is_dir():
                    shutil.rmtree(item)
                else:
                    item.unlink()

    def worker(self):
        with lock(self.state / "worker.lock", blocking=False) as acquired:
            if not acquired:
                return
            self.recover()
            interrupted = read_json(self.state / "status.json", {})
            if interrupted.get("phase") == "building":
                committed = read_json(self.state / "deployment.json", {})
                if committed.get("id") == interrupted.get("id"):
                    self.record(interrupted, "deployed", image=committed["image"], artifact=committed.get("artifact"))
                    interrupted = {}
            if interrupted.get("phase") == "building":
                # A systemd timeout/reboot killed the previous worker. Do not
                # silently retry a failing build every minute; clean and report.
                self.cleanup_attempt(interrupted, remove_image=True)
                self.record(interrupted, "failed", error="Worker interrupted; retry explicitly")
            while True:
                with lock(self.state / "queue.lock"):
                    request = read_json(self.state / "request.json")
                if not request:
                    return
                status = read_json(self.state / "status.json", {})
                if status.get("id") == request["id"] and status.get("phase") in ("deployed", "failed", "superseded"):
                    return
                try:
                    if not self.current(request):
                        self.record(request, "superseded")
                        continue
                except Exception as error:
                    self.record(request, "failed", error=str(error))
                    continue
                (self.state / "logs").mkdir(exist_ok=True)
                logfile = self.state / "logs" / (request["id"] + ".log")
                with open(logfile, "a", buffering=1) as self.log:
                    self.record(request, "building", log=str(logfile))
                    try:
                        phase, details = self.build(request)
                        self.record(request, phase, log=str(logfile), **details)
                    except Exception as error:
                        self.log.write(f"\nFAILED: {error}\n")
                        self.record(request, "failed", log=str(logfile), error=str(error))
                        if (self.state / "activation.json").exists():
                            raise RuntimeError("Activation recovery is incomplete; refusing newer work until recovery succeeds") from error
                    finally:
                        self.log = None
                self.prune()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", required=True)
    parser.add_argument("command", choices=("enqueue", "retry", "worker", "status"))
    args = parser.parse_args()
    pipeline = Pipeline(read_json(args.config))
    if args.command in ("enqueue", "retry"):
        request = pipeline.enqueue(sys.stdin if args.command == "enqueue" else None, retry=args.command == "retry")
        if request:
            print("Queued " + request["revision"] + " (" + request["id"] + ")")
    elif args.command == "worker":
        pipeline.worker()
    else:
        print(json.dumps({"request": read_json(pipeline.state / "request.json"),
                          "status": read_json(pipeline.state / "status.json"),
                          "deployment": read_json(pipeline.state / "deployment.json")}, indent=2))


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
