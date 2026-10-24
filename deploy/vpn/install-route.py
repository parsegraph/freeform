#!/usr/bin/env python3
"""Mount the verified Freeform container in the existing Parsegraph HTTPS vhost.

Defaults to a read-only preflight and diff. On fritolaptop, apply with:
  sudo python3 deploy/vpn/install-route.py --revision FULL_COMMIT --apply
"""

import argparse
import difflib
import fcntl
import hashlib
import http.client
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import tempfile


CONFIG = Path("/etc/nginx/conf.d/parsegraph.conf")
BACKUPS = Path("/etc/nginx/freeform-route-backups")
LOCK = Path("/run/lock/parsegraph-freeform-route.lock")
HOST = "parsegraph.fritonet.home.arpa"
ORIGINAL = """# Managed by parsegraph-site TLS installer; changes belong in the source template.
server {
    listen 80;
    server_name parsegraph.fritonet.home.arpa;
    return 308 https://parsegraph.fritonet.home.arpa$request_uri;
}

server {
    listen 443 ssl;
    server_name parsegraph.fritonet.home.arpa;

    ssl_certificate /etc/nginx/certs/parsegraph.fritonet.home.arpa.crt.pem;
    ssl_certificate_key /etc/nginx/private/parsegraph.fritonet.home.arpa.key.pem;
    ssl_protocols TLSv1.2 TLSv1.3;

    access_log /var/log/nginx/parsegraph.access.log;
    error_log /var/log/nginx/parsegraph.error.log;

    location / {
        proxy_pass http://127.0.0.1:4350;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
"""
ROUTES = """    # Managed by Freeform deploy/vpn/install-route.py.
    location = /freeform {
        return 308 /freeform/$is_args$args;
    }

    location /freeform/ {
        proxy_pass http://127.0.0.1:4351;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

"""
DESIRED = ORIGINAL.replace("    location / {", ROUTES + "    location / {", 1)


def run(*command):
    subprocess.run(command, check=True, stdin=subprocess.DEVNULL, timeout=30)


def read_regular(path):
    descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    with os.fdopen(descriptor, "rb") as source:
        info = os.fstat(source.fileno())
        if not stat.S_ISREG(info.st_mode):
            raise RuntimeError(f"Expected a regular file: {path}")
        return source.read(), info


def current_config():
    contents, info = read_regular(CONFIG)
    if contents not in (ORIGINAL.encode(), DESIRED.encode()):
        raise RuntimeError("nginx configuration differs from the reviewed original or Freeform mount; review it instead of overwriting it")
    return contents, info


def fetch(path):
    connection = http.client.HTTPConnection("127.0.0.1", 4351, timeout=5)
    try:
        connection.request("GET", path, headers={"Host": HOST})
        response = connection.getresponse()
        body = response.read(8 * 1024 * 1024 + 1)
        if len(body) > 8 * 1024 * 1024:
            raise RuntimeError(f"Unexpectedly large upstream response: {path}")
        return response.status, dict(response.getheaders()), body
    finally:
        connection.close()


def verify_upstream(revision):
    expected = {
        "/freeform/": {"text/html"},
        "/freeform/deploy-revision.json": {"application/json"},
        "/freeform/occluder.js": {"text/javascript", "application/javascript"},
        "/freeform/textrenderer.js": {"text/javascript", "application/javascript"},
        "/freeform/examples/sample.json": {"application/json"},
        "/freeform/examples/sample.lisp": {"text/plain"},
    }
    for path, types in expected.items():
        status, headers, body = fetch(path)
        headers = {key.lower(): value for key, value in headers.items()}
        mime = headers.get("content-type", "").split(";")[0].strip()
        if status != 200 or mime not in types or not body:
            raise RuntimeError(f"Upstream check failed for {path}: HTTP {status}, Content-Type {mime!r}")
        if path.endswith("deploy-revision.json") and json.loads(body).get("revision") != revision:
            raise RuntimeError("Freeform upstream source revision does not match the requested revision")
    status, headers, _ = fetch("/freeform?sample=proportion_v1")
    headers = {key.lower(): value for key, value in headers.items()}
    if status != 308 or headers.get("location") != "/freeform/?sample=proportion_v1":
        raise RuntimeError("Freeform redirect must retain its query string")
    if fetch("/freeform/static/missing-deployment-check.js")[0] != 404:
        raise RuntimeError("Missing Freeform assets must return 404")


def replace_config(contents, info):
    descriptor, name = tempfile.mkstemp(prefix=".freeform-route-", dir=CONFIG.parent)
    try:
        with os.fdopen(descriptor, "wb") as destination:
            os.fchmod(destination.fileno(), stat.S_IMODE(info.st_mode))
            os.fchown(destination.fileno(), info.st_uid, info.st_gid)
            destination.write(contents)
            destination.flush()
            os.fsync(destination.fileno())
        os.replace(name, CONFIG)
    finally:
        Path(name).unlink(missing_ok=True)


def preserve_backup(contents):
    BACKUPS.mkdir(mode=0o700, exist_ok=True)
    info = BACKUPS.lstat()
    if not stat.S_ISDIR(info.st_mode) or info.st_uid != 0 or stat.S_IMODE(info.st_mode) & 0o077:
        raise RuntimeError(f"Backup directory must be root-owned and private: {BACKUPS}")
    backup = BACKUPS / ("parsegraph-" + hashlib.sha256(contents).hexdigest() + ".conf")
    try:
        descriptor = os.open(backup, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    except FileExistsError:
        if read_regular(backup)[0] != contents:
            raise RuntimeError(f"Existing backup has unexpected contents: {backup}")
    else:
        with os.fdopen(descriptor, "wb") as destination:
            destination.write(contents)
            destination.flush()
            os.fsync(destination.fileno())
    return backup


def install(revision):
    original, info = current_config()
    verify_upstream(revision)
    if original == DESIRED.encode():
        print("Freeform route is already installed; upstream checks passed.")
        return
    run("systemctl", "is-active", "--quiet", "nginx")
    run("nginx", "-t")
    backup = preserve_backup(original)
    print(f"Persistent nginx backup: {backup}", flush=True)
    # Refuse a concurrent edit since the preflight; the lock covers this installer.
    if read_regular(CONFIG)[0] != original:
        raise RuntimeError("nginx configuration changed during preflight")
    changed = False
    reload_attempted = False
    try:
        replace_config(DESIRED.encode(), info)
        changed = True
        run("restorecon", str(CONFIG))
        run("nginx", "-t")
        reload_attempted = True
        run("systemctl", "reload", "nginx")
    except Exception as failure:
        if changed:
            try:
                replace_config(original, info)
                run("restorecon", str(CONFIG))
                run("nginx", "-t")
                if reload_attempted:
                    run("systemctl", "reload", "nginx")
            except Exception as recovery:
                raise RuntimeError(f"Installation failed: {failure}; recovery also failed: {recovery}; backup retained at {backup}") from failure
        raise RuntimeError(f"Installation failed; original nginx configuration restored: {failure}") from failure
    print(f"Installed https://{HOST}/freeform/ for revision {revision}")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--revision", required=True, help="Expected full Git commit in the running Freeform deployment marker")
    parser.add_argument("--apply", action="store_true", help="Install and reload nginx; requires sudo")
    args = parser.parse_args()
    if not re.fullmatch(r"[0-9a-f]{40}", args.revision):
        parser.error("--revision must be a full lowercase 40-character Git commit")
    if args.apply:
        if os.geteuid() != 0:
            parser.error("--apply requires sudo on fritolaptop")
        descriptor = os.open(LOCK, os.O_WRONLY | os.O_CREAT | os.O_NOFOLLOW | os.O_NONBLOCK, 0o600)
        with os.fdopen(descriptor, "wb") as lock:
            info = os.fstat(lock.fileno())
            if not stat.S_ISREG(info.st_mode) or info.st_uid != 0:
                raise RuntimeError("Installer lock must be a root-owned regular file")
            fcntl.flock(lock, fcntl.LOCK_EX)
            install(args.revision)
    else:
        contents, _ = current_config()
        verify_upstream(args.revision)
        print("".join(difflib.unified_diff(contents.decode().splitlines(True), DESIRED.splitlines(True), fromfile=str(CONFIG), tofile=str(CONFIG) + " (proposed)")), end="")
        print("Preflight passed. Re-run with sudo and --apply to install." )


if __name__ == "__main__":
    main()
