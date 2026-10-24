#!/usr/bin/env python3
"""Install the rootless Freeform VPN deployment hook and background worker."""
import argparse
import fcntl
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import shlex
import shutil
import subprocess
import sys
import tempfile

MARKER = "Managed by parsegraph-freeform VPN deployment"
REF = "refs/heads/freeform"


def write(path, data, mode=0o600):
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.is_symlink():
        raise RuntimeError(f"Refusing symlink destination: {path}")
    fd, name = tempfile.mkstemp(prefix="." + path.name + ".", dir=path.parent)
    try:
        with os.fdopen(fd, "wb") as stream:
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
        os.chmod(name, mode)
        os.replace(name, path)
    finally:
        if os.path.exists(name):
            os.unlink(name)


def check_owned(path, content):
    if path.is_symlink():
        raise RuntimeError(f"Refusing symlink destination: {path}")
    if path.exists() and path.read_bytes() != content and MARKER.encode() not in path.read_bytes():
        raise RuntimeError(f"Refusing to overwrite unrelated file: {path}")


def load_pipeline(source, config):
    spec = importlib.util.spec_from_file_location("freeform_pipeline_install", source / "vpn/pipeline.py")
    module = importlib.util.module_from_spec(spec)
    previous = sys.dont_write_bytecode
    try:
        sys.dont_write_bytecode = True
        spec.loader.exec_module(module)
    finally:
        sys.dont_write_bytecode = previous
    return module.Pipeline(config)


def immutable_image(value):
    if not re.fullmatch(r"sha256:[0-9a-f]{64}", value or ""):
        raise RuntimeError("Existing Freeform runtime must use an immutable sha256 image ID")
    return value


def ensure_no_manual_build(env):
    active = subprocess.check_output(
        ["systemctl", "--user", "list-units", "--type=scope", "--state=active",
         "--no-legend", "--plain", "freeform-build-*.scope"], env=env, text=True).strip()
    if active:
        raise RuntimeError("A manual Freeform build scope is active; finish its deployment handover first")


def baseline(pipeline, home, config, env):
    """Verify and, on first install, adopt the existing manual deployment."""
    current = Path(config["state_dir"]) / "deployment.json"
    if current.is_symlink():
        raise RuntimeError("Refusing symlink deployment record")
    initial = not current.exists()
    record_path = home / ".local/state/parsegraph-freeform/deployment.json" if initial else current
    record = json.loads(record_path.read_text())
    revision = record.get("revision")
    if not re.fullmatch(r"[0-9a-f]{40,64}", revision or ""):
        raise RuntimeError("Existing deployment must identify its full source revision")
    image = immutable_image(record.get("image"))
    quadlet = Path(config["quadlet_file"])
    configured = re.findall(r"^Image=(.+)$", quadlet.read_text(), re.MULTILINE)
    if configured != [image]:
        raise RuntimeError("Existing Quadlet differs from the recorded deployment image")
    subprocess.run(["systemctl", "--user", "is-active", "--quiet", config["service_name"]], env=env, check=True)
    actual = subprocess.check_output(["podman", "inspect", "--format", "{{.Image}}", "parsegraph-freeform"], env=env, text=True).strip()
    if not actual.startswith("sha256:"):
        actual = "sha256:" + actual
    if actual != image:
        raise RuntimeError("Running Freeform container differs from the recorded image")
    if initial:
        if record.get("status") != "deployed":
            raise RuntimeError("Finish and verify the manual HTTPS deployment before installing automation")
        artifact = Path(record["artifact"])
        acceptance = json.loads((artifact / "acceptance.json").read_text())
        if (acceptance.get("revision") != revision or acceptance.get("tests") != "passed"
                or acceptance.get("build") != "passed"):
            raise RuntimeError("Manual artifact has no matching successful acceptance report")
        manifest = pipeline.manifest(artifact / "build")
        if {name: item["sha256"] for name, item in manifest.items()} != acceptance.get("files"):
            raise RuntimeError("Manual artifact file hashes differ from its acceptance report")
        archive = artifact / "freeform.tgz"
        digest = hashlib.sha256(archive.read_bytes()).hexdigest()
        if digest != acceptance.get("archiveSha256") or digest != record.get("archiveSha256"):
            raise RuntimeError("Manual artifact archive hash differs from its deployment record")
        record = dict(record, id="bootstrap-" + revision[:12], manifest=manifest,
                      artifact={"path": str(archive), "sha256": digest})
    elif not record.get("manifest"):
        raise RuntimeError("Existing pipeline deployment has no verified manifest")
    pipeline.verify(config["local_url"], record["manifest"], revision)
    pipeline.verify(config["public_url"], record["manifest"], revision)
    return record, initial


def install(source, home, ca_file):
    if os.geteuid() == 0:
        raise RuntimeError("Run this as dafrito, without sudo")
    for name in ("python3", "git", "node", "npm", "yarn", "podman", "systemctl"):
        if not shutil.which(name):
            raise RuntimeError(f"Required command unavailable: {name}")
    env = {key: value for key, value in os.environ.items() if not key.startswith("GIT_")}
    env["PYTHONDONTWRITEBYTECODE"] = "1"
    repo = home / "repo/freeform.git"
    ops = home / "var/parsegraph-freeform/ops/deploy"
    state = home / ".local/state/parsegraph-freeform/pipeline"
    config_path = home / ".config/parsegraph-freeform/pipeline.json"
    quadlet = home / ".config/containers/systemd/parsegraph-freeform.container"
    units = home / ".config/systemd/user"
    if not ca_file.is_file() or not quadlet.is_file() or quadlet.is_symlink():
        raise RuntimeError("Install and verify the Freeform runtime and HTTPS route first")
    if subprocess.check_output(["git", "--git-dir", str(repo), "rev-parse", "--is-bare-repository"], env=env, text=True).strip() != "true":
        raise RuntimeError("Expected a bare Freeform repository")
    hooks_path = subprocess.run(["git", "--git-dir", str(repo), "config", "--get", "core.hooksPath"], env=env, text=True, capture_output=True)
    if hooks_path.returncode != 1:
        raise RuntimeError("Custom core.hooksPath is configured or Git lookup failed; integrate existing hooks explicitly")
    subprocess.run(["git", "--git-dir", str(repo), "rev-parse", "--verify", REF + "^{commit}"], env=env, check=True, stdout=subprocess.DEVNULL)
    config = {
        "bare_repo": str(repo), "ref": REF, "state_dir": str(state),
        "build_root": str(home / "var/parsegraph-freeform/builds"),
        "container_dir": str(ops / "container"), "quadlet_file": str(quadlet),
        "service_name": "parsegraph-freeform.service",
        "local_url": "http://127.0.0.1:4351/freeform",
        "public_url": "https://parsegraph.fritonet.home.arpa/freeform",
        "ca_file": str(ca_file),
        "command_timeout": 600, "build_timeout": 2400, "health_timeout": 45,
        "keep_records": 20, "keep_artifacts": 5,
    }
    if config_path.is_symlink() or (config_path.exists() and json.loads(config_path.read_text()) != config):
        raise RuntimeError(f"Existing config differs; review before reinstalling: {config_path}")
    hook = ("#!/bin/sh\n# " + MARKER + "\nexec /usr/bin/python3 " +
            shlex.quote(str(ops / "vpn/pipeline.py")) + " --config " +
            shlex.quote(str(config_path)) + " enqueue\n").encode()
    hook_path = repo / "hooks/post-receive"
    check_owned(hook_path, hook)
    pending = {}
    for suffix in ("service", "path", "timer"):
        filename = "parsegraph-freeform-deploy." + suffix
        data = (source / "vpn" / filename).read_text().replace("/home/dafrito", str(home)).encode()
        if MARKER.encode() not in data:
            data = ("# " + MARKER + "\n").encode() + data
        check_owned(units / filename, data)
        pending[units / filename] = data
    files = {relative: (source / relative).read_bytes() for relative in (
        "vpn/pipeline.py", "vpn/install-pipeline.py", "container/Containerfile", "container/nginx.conf")}
    # On upgrades, preserve manually edited controller files rather than silently
    # overwriting them. A source-identical file is safe on an interrupted install.
    installation_path = state / "installation.json"
    previous = json.loads(installation_path.read_text()) if installation_path.exists() else {}
    for relative, data in files.items():
        target = ops / relative
        if target.is_symlink():
            raise RuntimeError(f"Refusing symlink destination: {target}")
        if target.exists() and target.read_bytes() != data:
            old_hash = previous.get("source_sha256", {}).get(relative)
            if hashlib.sha256(target.read_bytes()).hexdigest() != old_hash:
                raise RuntimeError(f"Installed controller file changed; review before replacing: {target}")
    state.mkdir(parents=True, exist_ok=True, mode=0o700)
    with (state / "worker.lock").open("a") as worker_lock:
        try:
            fcntl.flock(worker_lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise RuntimeError("A deployment is running; wait before upgrading the controller")
        if (state / "activation.json").exists():
            raise RuntimeError("Interrupted activation needs recovery with the installed controller first")
        ensure_no_manual_build(env)
        baseline_path = state / "deployment.json"
        if not baseline_path.exists():
            baseline_path = home / ".local/state/parsegraph-freeform/deployment.json"
        baseline_before = baseline_path.read_bytes()
        quadlet_before = quadlet.read_bytes()
        pipeline = load_pipeline(source, config)
        deployed, initial = baseline(pipeline, home, config, env)
        ensure_no_manual_build(env)
        if baseline_path.read_bytes() != baseline_before or quadlet.read_bytes() != quadlet_before:
            raise RuntimeError("Existing deployment changed during preflight; retry after its handover completes")
        # Do all input, ownership and live checks before altering scheduling.
        watchers = ["parsegraph-freeform-deploy.path", "parsegraph-freeform-deploy.timer"]
        for name in watchers:
            subprocess.run(["systemctl", "--user", "stop", name], check=False, env=env)
        for relative, data in files.items():
            write(ops / relative, data, 0o644)
        write(config_path, (json.dumps(config, indent=2) + "\n").encode())
        if initial:
            write(state / "deployment.json", (json.dumps(deployed, indent=2) + "\n").encode())
        for path, data in pending.items():
            write(path, data, 0o644)
        write(hook_path, hook, 0o755)
        record = {"config": config, "source_sha256": {
            name: hashlib.sha256(data).hexdigest() for name, data in files.items()}}
        write(installation_path, (json.dumps(record, indent=2) + "\n").encode())
        subprocess.run(["systemctl", "--user", "daemon-reload"], check=True, env=env)
        subprocess.run(["systemctl", "--user", "enable", "--now", *watchers], check=True, env=env)
    print("Installed freeform-branch post-receive hook and enabled deployment path/timer.")
    print("Config: " + str(config_path))
    print("Installation did not queue a deployment. Push freeform, or explicitly retry current freeform:")
    print("python3 " + shlex.quote(str(ops / "vpn/pipeline.py")) + " --config " +
          shlex.quote(str(config_path)) + " retry")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--ca-file", required=True, type=Path, help="Persistent public CA PEM used for HTTPS verification")
    args = parser.parse_args()
    install(Path(__file__).resolve().parent.parent, Path.home(), args.ca_file.resolve())
