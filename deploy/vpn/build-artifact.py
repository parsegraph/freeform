#!/usr/bin/env python3
"""Build and test a clean, committed Freeform checkout on the deployment host."""

import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import signal
import shutil
import subprocess
import tarfile


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--artifact-dir", type=Path, required=True)
    args = parser.parse_args()
    source = Path(__file__).resolve().parents[2]
    output = args.artifact_dir.resolve()
    if output == source or source in output.parents:
        parser.error("Keep artifacts outside the source checkout")
    revision = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=source, text=True).strip()
    if subprocess.check_output(["git", "status", "--porcelain", "--untracked-files=all"], cwd=source):
        parser.error("Build from a clean, committed checkout")
    package = json.loads((source / "package.json").read_text())
    if not re.fullmatch(r"\d+\.\d+\.\d+", package["dependencies"]["parsegraph"]):
        parser.error("The deployment requires an exact stable Parsegraph registry version")
    output.mkdir(parents=True, exist_ok=False)
    logs = output / "logs"
    logs.mkdir()
    env = dict(os.environ, NODE_OPTIONS="--max-old-space-size=2048",
               PUBLIC_URL="/freeform", GENERATE_SOURCEMAP="false", PYTHONDONTWRITEBYTECODE="1")

    def run(label, command, directory=source, extra=None):
        print(f"{label}: {' '.join(command)}", flush=True)
        with (logs / f"{label}.log").open("w") as log:
            process = subprocess.Popen(command, cwd=directory, env={**env, **(extra or {})},
                                       stdout=log, stderr=subprocess.STDOUT, start_new_session=True)
            try:
                result = process.wait(timeout=600)
            except subprocess.TimeoutExpired:
                os.killpg(process.pid, signal.SIGKILL)
                process.wait()
                raise RuntimeError(f"{label} timed out; process group stopped; see {logs / (label + '.log')}")
        if result:
            raise RuntimeError(f"{label} failed; see {logs / (label + '.log')}")

    lockfiles = [source / sub / "yarn.lock" for sub in (".", "occluder", "textrenderer")]
    locks_before = [path.read_bytes() for path in lockfiles]
    for name, sub in (("install", "."), ("install-occluder", "occluder"), ("install-textrenderer", "textrenderer")):
        run(name, ["yarn", "install", "--frozen-lockfile", "--non-interactive", "--network-timeout", "60000"], source / sub)
    if [path.read_bytes() for path in lockfiles] != locks_before:
        raise RuntimeError("Locked installation changed a lockfile")
    installed = json.loads((source / "node_modules/parsegraph/package.json").read_text())
    if installed["version"] != package["dependencies"]["parsegraph"]:
        raise RuntimeError("Installed Parsegraph does not match the pinned dependency")
    run("tests", ["yarn", "test", "--watchAll=false", "--runInBand"], extra={"CI": "true"})
    run("deployment-tests", ["python3", "-m", "unittest", "discover", "-s", "tests", "-p", "*_test.py"])
    # This legacy app has existing ESLint warnings. Keep them visible in the
    # build log; tests still run with CI=true and failures stop publication.
    run("build", ["yarn", "build:deploy"], extra={"CI": "false"})
    if subprocess.check_output(["git", "status", "--porcelain", "--untracked-files=all"], cwd=source):
        raise RuntimeError("Build changed tracked source or produced unignored files")
    build = source / "build"
    required = ("index.html", "occluder.js", "textrenderer.js", "examples/sample.json", "examples/sample.lisp")
    for filename in required:
        if not (build / filename).is_file() or not (build / filename).stat().st_size:
            raise RuntimeError(f"Missing build output: {filename}")
    if '/freeform/static/' not in (build / "index.html").read_text():
        raise RuntimeError("Build did not use the /freeform asset base")
    (build / "deploy-revision.json").write_text(json.dumps({"revision": revision, "parsegraph": installed["version"]}) + "\n")
    shutil.copytree(build, output / "build")
    archive = output / "freeform.tgz"
    with tarfile.open(archive, "w:gz") as tar:
        for path in sorted(build.rglob("*")):
            if path.is_file():
                tar.add(path, arcname=path.relative_to(build), recursive=False)
    report = {
        "revision": revision, "parsegraph": installed["version"], "publicUrl": "/freeform",
        "tests": "passed", "build": "passed", "source": str(source),
        "node": subprocess.check_output(["node", "--version"], text=True).strip(),
        "yarn": subprocess.check_output(["yarn", "--version"], text=True).strip(),
        "archiveSha256": hashlib.sha256(archive.read_bytes()).hexdigest(),
        "files": {str(path.relative_to(build)): hashlib.sha256(path.read_bytes()).hexdigest()
                  for path in sorted(build.rglob("*")) if path.is_file()},
    }
    (output / "acceptance.json").write_text(json.dumps(report, indent=2) + "\n")
    print(f"Verified artifact: {output}\nSource revision: {revision}", flush=True)


if __name__ == "__main__":
    main()
