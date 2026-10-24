# Freeform on fritolaptop

The VPN editor is served at `https://parsegraph.fritonet.home.arpa/freeform/`.
It has its own rootless Podman container, `parsegraph-freeform`, owned by
`dafrito`. Host nginx proxies `/freeform/` to `127.0.0.1:4351`; the container
listens on port 8080. The website remains independently deployed on port 4350.
Freeform is a static browser application. Public rooms are disabled, and no
Node server or writable application volume is needed at runtime.

The first deployment is manual. A Git push stores source; it does not deploy
Freeform. There is no Freeform receive hook or background deployment worker yet.
The existing GitHub workflow deploys to production when branch `freeform` is
pushed there, so this VPN deployment uses only the `fritolaptop` remote.

## Source and build

Commit the selected changes, including the exact `parsegraph@7.0.1` dependency
and lockfile, without collecting unrelated work. Push the reviewed commit to
`fritolaptop:repo/freeform.git` and record its full Git SHA. Build that commit in
a disposable, host-local checkout on fritolaptop, never through SSHFS or from an
actively edited working directory. Use Node 22 and Yarn Classic 1.22.22.

Run the committed builder from that clean checkout under a memory-limited user
scope. Give every attempt a fresh name and artifact directory:

```sh
FREEFORM_ATTEMPT=$(date -u +%Y%m%dT%H%M%SZ)
FREEFORM_REVISION=$(git rev-parse HEAD)
systemd-run --user --scope --unit="freeform-build-${FREEFORM_ATTEMPT}" \
  -p MemoryMax=3G -p MemorySwapMax=1G \
  python3 deploy/vpn/build-artifact.py \
  --artifact-dir "/home/dafrito/var/parsegraph-freeform/artifacts/${FREEFORM_ATTEMPT}"
```

The builder refuses a dirty checkout, an existing artifact directory, or a
non-exact Parsegraph dependency. It installs all three frozen Yarn lockfiles,
checks the installed library version, runs app tests serially and Python
deployment tests, then runs `yarn build:deploy`. That script builds both workers
before the app. Each command has a ten-minute deadline with process-group
cleanup. Node heaps are limited to 2 GiB; the scope bounds the complete build.
App tests use `CI=true`. Existing ESLint build warnings remain visible in logs
instead of becoming errors; actual build failures still stop the attempt.

The app build uses `PUBLIC_URL=/freeform` and disables source maps. The builder
verifies the required assets, writes `build/deploy-revision.json` containing the
source `revision` and installed `parsegraph` version, and retains `build/`,
`freeform.tgz`, per-command logs, and `acceptance.json` with tool versions and
archive/file hashes. This creates an artifact; it does not start a container or
change host nginx. A failed attempt remains available for diagnosis; retry with
a new attempt name.

`public/occluder.js` and `public/textrenderer.js` are generated, ignored files;
a plain app build in a fresh checkout will not create them. The JSON/Lisp sample
files live under `public/examples/`. Preserve the `/freeform/` prefix when serving
the artifact, including workers, samples, and the revision marker.

## Runtime and activation

Assemble a minimal image context containing only the tested `build/` directory
and `deploy/container/nginx.conf`, then build with
`deploy/container/Containerfile` and `SOURCE_REVISION=<full Git SHA>`. The base
image is pinned to the same official nginx digest as the website:

```text
docker.io/library/nginx@sha256:0985e772fb9f729e6fa0980da05fca5d9c468e870eed43071545afa9d2e27d94
```

Record the source SHA, artifact hash, resulting image ID, and prior deployed
image/Quadlet. Validate nginx inside the image and run a temporary candidate
container with the same read-only filesystem, `/tmp` tmpfs, dropped capabilities,
and loopback-only port binding as the live service. Check its HTTP responses
before replacing the live service.

The deployment installer must replace `Image=@IMAGE_ID@` in
`deploy/quadlet/parsegraph-freeform.container` with that tested immutable
`sha256:<64 hex digits>` image ID. Install the result as
`~/.config/containers/systemd/parsegraph-freeform.container`, preserving the
previous Quadlet for rollback. Then, as `dafrito`:

```sh
systemctl --user daemon-reload
systemctl --user restart parsegraph-freeform.service
systemctl --user status parsegraph-freeform.service
loginctl show-user dafrito -p Linger
```

`Linger=yes` lets the user manager run after logout and start at boot. The
Quadlet's `WantedBy=default.target` supplies boot activation. Do not enable or
edit the generated `.service`; edit the `.container` source instead.

## HTTPS route and browser check

After the candidate and live upstream checks pass, use the reviewed route
installer from the same source checkout. Its default mode checks and prints the
proposed change; applying it requires root because it edits host nginx:

```sh
python3 deploy/vpn/install-route.py --revision "$FREEFORM_REVISION"
sudo python3 deploy/vpn/install-route.py --revision "$FREEFORM_REVISION" --apply
```

The revision must be the full 40-character Git SHA. The installer checks the
upstream marker and essential routes before adding `/freeform` and `/freeform/`
to the existing HTTPS server. It retains a root-only backup at
`/etc/nginx/freeform-route-backups/parsegraph-<SHA256-original-config>.conf`,
validates nginx before reload, and restores the prior configuration if activation
fails. The `deploy/vpn/nginx-locations.conf` snippet documents the two locations;
`proxy_pass` has no URI suffix, so it preserves `/freeform/`.

Retain the same locations in the maintained
`parsegraph-site/deploy/vpn/parsegraph.conf` template: the older TLS installer
can otherwise discard this mount. Keep the existing root website route and
certificate. No DNS, certificate, or firewall change is needed; port 4351 stays
bound only to loopback.

Verify the upstream and HTTPS endpoint:

- `/freeform?sample=json` returns a relative 308 redirect to
  `/freeform/?sample=json`, retaining its query string.
- `/freeform/`, both worker scripts, both example files, and referenced hashed
  JS/CSS return 200 with the correct content types.
- `/freeform/deploy-revision.json` reports the selected full source revision and
  installed Parsegraph version through both loopback and HTTPS.
- Container `/`, unknown files, and dotfile paths return 404. Unknown assets must
  never receive the app's HTML as a successful fallback.
- Responses revalidate with `Cache-Control: no-cache`; the unversioned workers
  must not be cached as immutable assets.

In a browser on the VPN, open `?sample=proportion_v1`, then the JSON and Lisp
samples. Check visible labels, pan/zoom, refresh, and a small edit/undo or
import/export round-trip. Confirm workers load under `/freeform/` without errors.
The Back action returns to the larger website at `/`.

## Operation and rollback

```sh
journalctl --user -u parsegraph-freeform.service -n 80 --no-pager
podman inspect --format '{{.State.Health.Status}}' parsegraph-freeform
systemctl --user restart parsegraph-freeform.service
```

For rollback, restore the saved previous Quadlet containing its immutable image
ID, run `daemon-reload` and restart, then repeat upstream and HTTPS checks. Keep
that previous image locally until the replacement is verified. A restart can
briefly interrupt requests. On the first deployment, there is no prior image;
undoing activation means stopping the new service and removing its host proxy
locations, with nginx validation before reload. The website's container stays
independent throughout.

Future automation includes a receive hook, a serialized build queue, automatic
recovery, retention, and consolidated status reporting. Production deployment is
a separate release decision; this VPN setup does not publish to EC2.
