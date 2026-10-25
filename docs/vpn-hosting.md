# Freeform on fritolaptop

The VPN editor is served at `https://parsegraph.fritonet.home.arpa/freeform/`.
It has its own rootless Podman container, `parsegraph-freeform`, owned by
`dafrito`. Host nginx proxies `/freeform/` to `127.0.0.1:4351`; the container
listens on port 8080. The website remains independently deployed on port 4350.
Freeform is a static browser application. Public rooms are disabled, and no
Node server or writable application volume is needed at runtime.

The VPN deployment follows pushes to the `freeform` branch of
`fritolaptop:repo/freeform.git`. The receive hook queues a revision and returns;
a systemd user worker builds, tests, and deploys it asynchronously. A successful
Git push means the repository accepted the commit, not that deployment passed.
Other branches and branch deletion do not request deployment.

The existing GitHub workflow still deploys to production when branch `freeform`
is pushed to GitHub. Use the `fritolaptop` remote for this VPN pipeline. It does
not change that production workflow or require production credentials.

## Deploy a change

Commit the selected Freeform changes, then push the deployment branch:

```sh
git push fritolaptop freeform
```

The worker checks out the exact requested commit in a fresh directory on
fritolaptop. It runs the committed `deploy/vpn/build-artifact.py`, which installs
all three frozen Yarn lockfiles, runs application and deployment tests, builds
both workers and the app for `/freeform`, and produces a versioned artifact.
Builds stay on the host, not the MacBook or SSHFS. The service limits the complete
worker to 3 GiB of memory and 1 GiB of swap; Node heaps are limited to 2 GiB.

Before deployment, the controller verifies the acceptance report, revision,
archive and file hashes. It packages the tested output using separately installed
container templates, tests a candidate on an ephemeral loopback port, then
updates the live Quadlet to the immutable image ID. Both loopback and trusted
HTTPS must serve the expected revision, bytes, and content types. Workers retain
revalidation caching, and missing assets return real 404s.

Only one deployment worker runs at a time. New pushes replace the pending
request. The worker checks the latest request and current branch head before
starting the candidate and again before activation; an obsolete build is marked
`superseded`. A build or candidate failure leaves the current runtime intact.
Activation failure restores the previous Quadlet and deployment record. A
journal lets the next worker recover an interrupted activation. Restarts and
rollback can briefly interrupt requests; this is not a zero-downtime rollout.

## Status, logs, and retries

Run these on fritolaptop as `dafrito`, without sudo:

```sh
python3 ~/var/parsegraph-freeform/ops/deploy/vpn/pipeline.py \
  --config ~/.config/parsegraph-freeform/pipeline.json status
systemctl --user status parsegraph-freeform-deploy.service
journalctl --user -u parsegraph-freeform-deploy.service -n 100 --no-pager
```

The worker is a oneshot, so it is normally inactive between deployments.
Status distinguishes `building`, `deployed`, `failed`, and `superseded` attempts.
`~/.local/state/parsegraph-freeform/pipeline/deployment.json` is authoritative for
the automated runtime. The earlier `~/.local/state/parsegraph-freeform/deployment.json`
is the historical manual deployment receipt, retained when automation adopts it.

Pipeline state also holds `request.json`, `status.json`, per-attempt `records/`,
controller `logs/`, and retained `artifacts/`. Build logs and the acceptance report
are retained with the artifact. The default retention is 20 records/logs and five
artifact sets, with deployed/recovery state protected. Successful runtime images
remain available for rollback; prune old images deliberately after checking they
are no longer referenced. Disposable source checkouts are removed after attempts.

A failed attempt is not rebuilt every minute. Fix and push a new commit, or
explicitly retry the current deployment branch after resolving a host problem:

```sh
python3 ~/var/parsegraph-freeform/ops/deploy/vpn/pipeline.py \
  --config ~/.config/parsegraph-freeform/pipeline.json retry
```

The path watcher wakes the worker on a changed request. A timer checks every
60 seconds as a fallback and after boot. To pause new scheduling:

```sh
systemctl --user disable --now parsegraph-freeform-deploy.path parsegraph-freeform-deploy.timer
```

Let an active worker finish before changing deployment files or running a manual
build/activation. Stopping the watchers does not cancel an active worker. Resume
with `systemctl --user enable --now parsegraph-freeform-deploy.path parsegraph-freeform-deploy.timer`.

## Install or upgrade the pipeline

The running Freeform service and HTTPS route must already be healthy. From a
reviewed host-local Freeform checkout, install as `dafrito` without sudo:

```sh
python3 deploy/vpn/install-pipeline.py \
  --ca-file ~/.local/state/parsegraph-site/tls/parsegraph.xpc1go2t/ca.crt.pem
```

The installer checks the existing deployment receipt, artifact hashes, immutable
Quadlet and running image, and both HTTP/HTTPS routes before enabling automation.
On first installation it adopts the actual currently deployed manual revision as
the rollback baseline; it does not assume the initial release is still current.
It refuses an active `freeform-build-*.scope`, a running pipeline worker, or an
unfinished activation journal. Finish any other deployment and its handover first.

The installer writes the hook in `~/repo/freeform.git/hooks/post-receive`, config
in `~/.config/parsegraph-freeform/pipeline.json`, and controller/container files
under `~/var/parsegraph-freeform/ops/deploy/`. User units are named
`parsegraph-freeform-deploy.service`, `.path`, and `.timer`. It preserves unrelated
hooks, custom Git hook paths, edited configuration and unrecognized controller
files instead of silently replacing them. It enables the watchers but does not
queue a deployment itself; push or explicitly retry afterward.

Controller and container template upgrades require this separate reviewed
installation. A pushed application commit does not replace the controller that
is executing it. Build scripts do execute as `dafrito`, with that account's
filesystem access, so this pipeline is for trusted pushes to `freeform`, not
untrusted pull-request branches. The website's pipeline and runtime are separate.

## Manual artifact build

Commit the selected changes, including the exact `parsegraph@7.1.0` dependency
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
`yarn start` and `yarn build` now build both automatically using the root app's
installed webpack. `yarn build:workers` rebuilds them independently, and
`yarn build:deploy` uses the same complete production build. The JSON/Lisp sample
files live under `public/examples/`. Preserve the `/freeform/` prefix when serving
the artifact, including workers, samples, and the revision marker.

## Manual runtime and activation

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

## Runtime operation and rollback

```sh
journalctl --user -u parsegraph-freeform.service -n 80 --no-pager
podman inspect --format '{{.State.Health.Status}}' parsegraph-freeform
systemctl --user restart parsegraph-freeform.service
```

For a code rollback, revert the unwanted change in Git and push the new commit
through the same pipeline. For an operational rollback, pause scheduling and
wait for the worker to finish, restore the previous immutable image in the
Quadlet, then run `daemon-reload`, restart and verify loopback/HTTPS. Restore the
matching full record from `pipeline/artifacts/<attempt>/deployment.json` to
`pipeline/deployment.json` too, so future recovery refers to the runtime you
restored. For the original adopted manual deployment, the first successful
pipeline record also retains its complete rollback fields in `previous`.
Resolve the intended branch head and pending request before resuming scheduling;
otherwise an already queued build can reapply an unwanted revision. Keep the previous image until its
replacement is verified. A restart can briefly interrupt requests.

The website remains independent. Production release automation and modernization
of the older GitHub workflows are separate work; this VPN pipeline does not
publish to EC2 or run those workflows.
