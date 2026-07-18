# Theme updates: the check and the self-update

How the theme learns about a new release and how it installs it in one click. The
code sits in three places, and that split is deliberate — see below. The working
invariants (fail-closed, the trust chain, why the worker daemonises) are also in
CLAUDE.md in condensed form; this doc is the whole picture, from the button press
to the page reload.

## Where it lives, and why it is a separate package

The theme itself has no update check. Everything to do with updating is split out
into a **separate, optional package, `luci-app-footstrap-updater`**: its own
`Makefile`, its own `dev-sync.sh`, its own directory. It installs three things on
the router:

- `htdocs/luci-static/resources/fs-update.js` — the client: the GitHub check plus
  the installer trigger, hosted in the Appearance popover;
- `root/usr/libexec/footstrap-selfupdate.sh` — the ACL-gated backend: fetch the
  release, verify the signature, install the package;
- `root/usr/share/rpcd/acl.d/…json` + `release.pub` — the `file.exec` grant for
  that one script, and the public key the signature is checked against.

Why separate, not folded into the theme: **no theme module may statically require
`fs-update`**. LuCI modules wire up through `L.require`, and a missing dependency is
a `DependencyError` that would take out the whole chrome. A router without the
updater is an ordinary state: the theme loads `fs-update` at runtime with
`L.require('fs-update')`, resolves it to `null` on failure, and simply draws no
update controls. The version (from `fs-version.js`, which is the theme's) always
shows; the Update controls only when the updater is installed.

The router↔updater seam is inverted for the same reason: `fs-router.js` exports
`onNavigate(fn)`, and `fs-update.js` registers its `cancel` there. The router never
names the optional module — that would be a `DependencyError` again.

## The update check (the badge)

The **router** asks GitHub, not the browser. The reason is plain: a LAN client
often has no route to the internet, while the router does. It also keeps the check
off the user's own IP (GitHub's anonymous rate limit is 60 calls per hour per IP)
and sidesteps CORS.

The flow: `fs-update.js` calls `footstrap-selfupdate.sh check`, which returns one
line — `v0.9.3` on success, or `ERR: …` when the API is unreachable. The JS compares
it against the installed version (`ver.VERSION`) and lights the dot/badge when the
release is newer. Failure is silent: no answer from the API means no badge, and the
version still shows.

The backend caches two files in `/var/run/footstrap-update/` for **5 minutes**
(`CACHE_TTL=300`): `latest` (the `ts tag` meta line) and `api.json` (the full
`releases/latest` answer, so `notes` can read the release body without a second API
call). It is a trade: the TTL is exactly how long a fresh
release stays invisible. An hour (the first version) lagged the badge by most of a
release; 5 minutes is at worst 12 calls an hour even with the admin hammering F5,
well inside the budget of 60. The JS memoises the result on top of that, once per
page load.

The cache lives in `/var/run` (a symlink to `/tmp/run`), not `/tmp`. `/tmp` is
1777: an unprivileged local process can pre-create a predictable name there as a
symlink, and root's `cp`/`chmod`/`>` then write through it into a file of the
attacker's choosing (CWE-377). `/var/run` is root-owned 0755, so the names cannot
be forged. Still tmpfs, so a reboot clears the cache and the check runs again.

## The one-click install

The Update button runs the backend through `fs.exec` (the ACL grants exec of that
one fixed path, the arguments are literals, no user input reaches the script). What
follows is the least obvious part.

**Why the backend daemonises.** The install outlives both RPC timeouts: `rpc.js`
aborts the XHR after `rpctimeout` (20 s), and `rpcd` kills the exec'd process after
its own `timeout` (30 s). A synchronous run reported "XHR request timed out" even
when it succeeded, and rpcd could kill `apk` mid-install. So the foreground call
only spawns a detached worker and returns `STARTED`; the client polls `status`
until it flips to `OK` or `ERR:`.

The protocol is one line on stdout:

```
<no args>  -> STARTED | RUNNING        spawn worker / already running
status     -> RUNNING | OK | ERR: … | IDLE
check      -> v<tag> | ERR: …          latest release tag, cached
notes      -> <release body> | ""      the release notes, cached (multi-line)
```

The client reads the **keyword, not the exit code** — except `notes`, whose whole
stdout is the payload (see below).

**The lock is `mkdir`.** Two RPCs arriving together must not both start an install.
Read-then-write is not atomic: a status check followed by a spawn both read "not
running" and both fired two concurrent `apk add` on the same package (reproduced).
`mkdir` is atomic — it fails if the name exists — so it *is* the lock. There is no
pre-check in front of it: one used to sit there and wedged the button for good if
the worker was SIGKILLed mid-`apk add` (OOM on a 128 MB router), because both
signals then stayed true forever. A stale lock is reclaimed from its **mtime**
(older than 10 minutes → the worker is dead), never from `$STATUS`/`$WORKER`: those
are written *after* the `mkdir`, so a second caller arriving in the gap would
otherwise judge the lock stale and steal it — two installs again.

**The worker runs from a staged copy.** The packages we install overwrite this very
script. So the foreground call copies `$0` to `$WORKER` (in `/var/run`, where no
package writes) and runs the install from there — the shell keeps reading a file
nobody replaces. Detaching is via `start-stop-daemon -b` where present, otherwise by
closing the stray descriptors by hand (rpcd hands the child more than 0/1/2 — fd 3
and 9..12, its own ucode sources; an unclosed one holds rpcd to its 30 s).

**`__run` is guarded.** It is the privileged worker entrypoint, and it is
**reachable over RPC**: the `file.exec` ACL matches only the command path, `params`
are free. Any session holding the ACL could call `__run` directly — which would run
`do_update` in the foreground and **without the lock**. So the worker checks
`[ "$0" = "$WORKER" ]`: the one legitimate caller is the spawn that `exec`s
`$WORKER`. An RPC caller names the installed path and gets `ERR: unknown argument`.

What it installs: **the theme AND the updater itself**, each by package name
(`luci-theme-footstrap`, `luci-app-footstrap-updater`), never by a bare
`\.$EXT$`. The theme is required — its absence in a release is a hard fail. The
updater is **optional in both directions**: a release older than the split does not
carry it (skipped), *and* a present updater whose install fails is **non-fatal once
the theme is in**. `fetch_verify_install` installs nothing on a verify failure, so a
bad/tampered/short updater asset leaves the old, already-verified updater intact to
retry next time — the theme is the point of the update, and it succeeded, so the run
still finalises (drops caches, writes `OK`, the client reloads) instead of reporting
a failure that would strand the freshly-installed theme behind stale caches. (It once
did `|| return 1` here, which left the new theme on disk while `status=ERR` and the
caches undropped: the update looked failed and the new theme never visibly applied.)
The order is theme first, updater second — the updater package overwrites the running
script, which is why the worker runs from a copy.

Once done, the script drops the LuCI caches (`/tmp/luci-indexcache*`,
`/tmp/luci-modulecache`) and writes `OK`. The client sees `OK`, waits 1.2 s, and
calls `location.reload()`.

## What the confirm dialog shows before you commit

The button no longer installs blind. Between the click and the download, the confirm
dialog carries three things, so the admin decides with the same information a manual
`opkg`/`apk` upgrade would give: **which versions**, **what changed**, and **whether
the release flags a breaking change**.

**Versions (`current → latest`).** The dialog heads with `vX → vY`, read from
`ver.VERSION` (installed, the theme's own) and the `latest` the check already
resolved. No extra call — the check memo is reused.

**Release notes.** `fs-update.js` asks the backend for `notes`, which returns the
GitHub release body (the text `tools/release-notes.sh` generated from
`CHANGELOG.md`). It rides the **same cached API answer** the check fetched: `check`
now saves the full `releases/latest` JSON to `$WD/api.json`, and both `check`
(tag) and `notes` (`@.body`) read from it — one API call feeds both. If the JSON is
absent (notes asked before any check), `notes` fetches once.

The notes are **untrusted display text and rendered as a text node only** — never as
markup. This is the one string in this flow that is shown *before* the signature is
verified: it arrives over TLS from the API but carries no `usign` proof, so treating
it as data (a `<pre>`, capped in length, `textContent`) is deliberate, not
incidental. A compromised release could put anything in the body; it must not be able
to put anything in the DOM.

**Breaking-change warning.** A coloured banner appears above the notes when the
release looks like it needs care before updating. The signal is the notes text, and
the maintainer controls it through the changelog wording (docs/21): the banner fires
when the body carries a `### Removed` or `### Security` heading, or the word
`breaking` (case-insensitive). It is **advisory** — it does not block the update, it
tells the admin to read the notes first. There is deliberately no version-jump
heuristic: this is 0.x software, where by semver a minor bump may break, so a
"major bump = breaking" rule would either never fire (major stays 0) or, inverted to
minor, fire on nearly every release. An explicit signal the changelog author sets is
the only one that carries real meaning.

## Free-space preflight

An install that runs out of room mid-`apk add` leaves `/www/luci-static/footstrap`
half-written — the worst failure mode on an 8–16 MB device. Before the first
download, the worker sums the sizes the API publishes for the assets it will fetch
(`@.assets[*].size`) and checks two filesystems with `df -k`:

- the **download** lands in `$WD` (`/var/run`, a tmpfs → RAM): require the largest
  single asset plus a margin;
- the **install** unpacks into the root overlay (flash): require roughly twice the
  compressed size plus a margin.

Too little on either → `ERR: not enough …`, reported before a single byte is
downloaded, so the admin sees a clear cause instead of a truncated tree.

This preflight is a **UX safety net, and it fails OPEN**: if the API omits an asset
size, or `df` cannot read a filesystem, the check is skipped and the install
proceeds. That is the opposite of the trust chain's fail-closed rule, and on
purpose — space is not a security property. The signature and the checksum are the
gates that must fail closed; a missing size must not be able to stop a legitimate,
correctly-signed update. Worst case, without the preflight, is the pre-existing
behaviour: `apk` fails and the client shows its error.

## Why the install no longer logs you out

`postinst`/`postrm` run `rpcd reload`, not `restart`. rpcd holds sessions in
memory: `restart` would drop every LuCI user, including the admin who just clicked
Update. `reload` sends SIGHUP, which re-reads `/usr/share/rpcd/acl.d/*` — refreshing
the `file.exec` grants is the only thing the package needs from rpcd (verified on a
live router: delete our ACL, `reload`, and `session access` for the script flips
from `true` to `false`).

The JS still keeps a "session expired" branch. If a stale session arrives after the
installer ran, the package **did** install (postinst runs last), and "sign in
again" is the right answer whatever killed the session: a hand-rolled `rpcd
restart`, a `luci-base` upgrade alongside, a reboot.

## The trust chain — the heart of it

`install.sh` (piped from the internet into `sh` **as root**) and
`footstrap-selfupdate.sh` both hand the downloaded package to the manager with
`--allow-untrusted`. The flag means **apk/opkg holds no key of ours**, not that the
bytes are unverified. Verifying them is these scripts' own job. Three layers:

1. **A verified TLS channel.** Never `-k` / `--no-check-certificate`, and never as a
   "retry" after the verified attempt fails — a failure *is* the MITM case, and
   `ca-bundle` is in OpenWrt's `DEFAULT_PACKAGES`, so the insecure path buys
   nothing. But be exact about the reach: the release asset hops to
   `objects.githubusercontent.com`, and `-L` has to follow it. The scheme pin
   (`--proto-redir '=https'`) exists only on the `curl` branch; `uclient-fetch` —
   tried first, and the only downloader on a stock router (curl is not in the
   default set) — has no such flag. The host pin covers the initial request only. On
   the path a stock router actually takes, **the signature is the one layer that
   survives a redirect**. That is by design.

2. **An ed25519 signature over the package** (`usign`) — this is the link that
   actually holds. The sha256 cannot stand alone, and the reason is exact: GitHub
   **computes** `@.assets[*].digest` from the bytes that were uploaded. Anyone who
   can replace a release asset (a leaked write-scoped PAT, no CI involved) gets the
   digest recomputed for them, and the checksum then verifies the **attacker's**
   package. The signing key is a GitHub Actions secret, is in no branch, and cannot
   be read back out — the same swap fails the signature. Proven on the router
   end-to-end: asset replaced + digest recomputed → sha256 passes, `ERR: BAD
   SIGNATURE`.

3. **The sha256 GitHub publishes for the asset.** It earns its place below the
   signature: it catches a tampered or truncated download from the asset CDN (a
   different host from `api.github.com`) with a clearer failure. It does **not**
   "remain if usign is absent" — nothing does: a missing usign is a refusal (rc=2).

Everything fails **closed**. A missing digest, a missing `.sig` asset, no usign on
the box — all refuse. The `if [ -n "$digest" ]` shape it once had fails **open**: a
renamed field or an absent tool empties the variable, and the install proceeds with
no check at all, reporting OK. `install.sh` alone has an override
(`FOOTSTRAP_ALLOW_UNVERIFIED=1`) for pinning a release older than the key; a
signature that is **present and wrong** is never overridable — that is not a missing
check, it is a failed one.

**Why usign, not the package manager's own signature.** `apk verify` checks against
`/etc/apk/keys` — trusting footstrap's key there would make the theme a trust anchor
for **everything** the router installs. opkg (24.10) cannot verify a standalone
`.ipk` at all. `usign` is on **every** OpenWrt image (`base-files` depends on it),
covers both formats with one mechanism, and its key authorises nothing but this
package.

The key lives in two places, and neither copy can go:
`luci-app-footstrap-updater/…/release.pub` (the self-updater reads it) and an
**embedded copy in `install.sh`** — that one runs from `curl | sh` before any
package exists. One key signs both the theme and the updater. A divergence cannot be
caught by any test (the installer would just reject every release with `BAD
SIGNATURE`, which looks exactly like the attack), so CI compares the two copies on
every run.

## No extra dependencies — `+luci-base` is the whole list

`footstrap-selfupdate.sh` once hard-required `curl`, which is **not** in OpenWrt's
default set (the base image ships `uclient-fetch`). On a stock router the badge and
the button both died with `ERR: cannot reach the GitHub release API` (reproduced by
moving `/usr/bin/curl` aside). `fetch()` now falls back to `uclient-fetch`.
`jsonfilter`, `sha256sum` and `usign` are in the base image, so they need no dep
either. Do not add a runtime dep for a convenience tool; fall back instead.

The two scripts — `install.sh` and `footstrap-selfupdate.sh` — **cannot share a
file**: the installer runs from `curl | sh` before the package that would hold a
library exists. So their `fetch()`, host allowlist, asset/signature lookup and
`verify_sig()` are pinned with `@mirror` (`gh/fetch`, `gh/asset-host`,
`gh/asset-urls`, `gh/verify-sig`); `npm run mirror` keeps the copies byte-identical.
Not ceremony: they had already drifted three ways.

## The two flows at a glance

Check:

```
fs-update.js  --fs.exec-->  selfupdate.sh check  --cache <5m?-->  cat latest
                                                 --else-------->  GET api.github.com → api.json → tag_name → latest
              <--v0.9.3 | ERR:--
compare with ver.VERSION → badge
```

Confirm (on button press, before install):

```
fs-update.js  --fs.exec notes-->  selfupdate.sh notes  --cached api.json?-->  jsonfilter @.body
              <--release body (text)--
dialog: "vCUR → vLAT"  +  [breaking? warning banner]  +  <pre> notes </pre>  +  Cancel / Update
```

Install:

```
Update button → Update (in dialog)
  --fs.exec (no args)-->  mkdir lock → cp $0 $WORKER → spawn $WORKER __run → "STARTED"
                          worker: GET release.json
                                  preflight: sum asset sizes vs df (tmpfs + overlay) → ERR if short
                                  theme:   fetch → sha256 → usign → apk/opkg add
                                  updater: same (optional)
                                  drop LuCI caches → "OK"
  --poll fs.exec status every 2s-->  RUNNING… → OK
  OK → wait 1.2s → location.reload()
```

## See also

- CLAUDE.md — the "update CHECK / self-update", "trust chain" and "Package /
  registration" sections carry the invariants in condensed form.
- [docs/14](14-spa-router.md) — the SPA router and `onNavigate`, through which the
  updater cancels its poll on navigation.
- [docs/13](13-ci-build-distribution.md) — how a release is signed and published
  (the other side of the trust chain the self-updater verifies).
