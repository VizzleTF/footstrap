#!/bin/sh
# Footstrap theme self-update backend (ships in luci-app-footstrap-updater, NOT in the theme).
#
# Downloads the latest GitHub release packages for the Footstrap theme and installs them with apk
# (25.12+) or opkg (24.10). It installs BOTH the theme (luci-theme-footstrap) and this updater
# (luci-app-footstrap-updater), so the updater never lags the theme it drives. Repo and API endpoint
# are hard-coded and only fixed keywords are accepted, so the ACL-gated LuCI `file.exec` that
# triggers it has no injection surface.
#
# But note WHAT the ACL gates: file.exec matches the command PATH only — `params` and `env` are the
# caller's. So the keyword is not limited to the two the client sends (`__run` is the privileged
# worker entrypoint — see that branch), and the environment is not ours either: PATH and the loader
# variables are pinned below, because LD_PRELOAD on /bin/sh is code execution as root for anyone
# holding this ACL.
#
# WHY IT DAEMONISES. The install outlives both RPC timeouts — rpc.js aborts the XHR after
# `rpctimeout` (20 s), rpcd kills the exec'd process after `rpcd.@rpcd[0].timeout` (30 s) — so a
# synchronous run reported "XHR request timed out" even when it succeeded, and rpcd could kill apk
# mid-install. The foreground call only spawns a detached worker; the client polls `status`.
#
# Protocol (stdout, one line):
#   <no args>  -> STARTED | RUNNING            (spawn worker / already running)
#   status     -> RUNNING | OK | ERR: <reason> | IDLE
#   check      -> v<tag> | ERR: <reason>       (latest release, cached)
# The client reads the KEYWORD, not the exit code: `check` exits 1 when the API is unreachable, and
# an unknown argument exits 1, while the rest exit 0.

# The CALLER sets this process's environment (above), so nothing may be resolved through an inherited
# PATH — nor through the dynamic loader, which PATH does not cover: /bin/sh is not setuid, so it
# honours LD_PRELOAD/LD_LIBRARY_PATH, and this ACL becomes arbitrary code as root. The proxy variables
# go too: they would redirect the fetch through a host of the caller's choosing.
PATH=/usr/sbin:/usr/bin:/sbin:/bin
export PATH
unset LD_PRELOAD LD_LIBRARY_PATH LD_AUDIT IFS http_proxy https_proxy HTTP_PROXY HTTPS_PROXY all_proxy ALL_PROXY

# State in /var/run (a symlink to /tmp/run), NOT in /tmp. /tmp is 1777: a local unprivileged process
# can pre-create a predictable name there as a symlink, and root's `cp`, `chmod`, `-o` and `>` then
# write through it to a file of the attacker's choosing (CWE-377). /var/run is root-owned 0755, so
# the names below cannot be pre-created. Still tmpfs, so a reboot re-checks.
WD=/var/run/footstrap-update
STATUS="$WD/status"
WORKER="$WD/run.sh"
CACHE="$WD/latest"		# the "ts tag" meta line
APIJSON="$WD/api.json"		# the full releases/latest answer; feeds both `check` (tag) and `notes` (body)
LOCK="$WD/lock"		# a DIRECTORY: mkdir is the atomic test-and-set (see the "" branch)

mkdir -p "$WD" 2>/dev/null && chmod 700 "$WD" 2>/dev/null || {
	echo "ERR: cannot create $WD"; exit 1
}

# How long a `check` result stays good. GitHub allows 60 unauthenticated API calls per hour per source
# IP; without a cache every page load spends one. 5 minutes, not an hour: the TTL is exactly how long
# a freshly published release stays invisible, and an hour let the badge lag a release by most of one.
# Worst case at 300 s is 12 calls/hour even with the admin reloading — well inside the 60-call budget.
CACHE_TTL=300

REPO="VizzleTF/luci-theme-footstrap"
API="https://api.github.com/repos/${REPO}/releases/latest"

# The release public key, shipped BY THIS PACKAGE. Read from disk rather than embedded, so the key
# travels with the code that trusts it: a key rotation is then one file in one release, and the router
# that installs that release is the one that starts trusting the new key. install.sh is the one place
# that has to carry a second copy — it runs from `curl | sh`, before any package exists — and CI fails
# if the two ever differ.
PUBKEY=/usr/share/luci-app-footstrap-updater/release.pub

# fetch <url> <max-seconds> [outfile]   — stdout when no outfile.
#
# curl is NOT on a stock OpenWrt router — the base image ships `uclient-fetch`, curl is a separately-
# installed package (dev router: `/usr/bin/curl is owned by curl-8.19.0-r2`). This script hard-required
# it, so on a stock router BOTH the update badge and the Update button died with "ERR: cannot reach the
# GitHub release API" (reproduced by moving /usr/bin/curl aside). Falling back keeps the dep list at
# +luci-base (+luci-theme-footstrap).
#
# Every fetch is BOUNDED: without a timeout a stalled connection leaves STATUS=RUNNING and a live
# $WORKER behind forever — what the "" branch reads as "a run is in progress" — so the button wedges
# until a reboot.
#
# The certificate is always verified. Never add a `-k` / `--no-check-certificate` fallback: a failed
# verification IS the MITM case, and ca-bundle is in OpenWrt's DEFAULT_PACKAGES, so the insecure path
# buys nothing.
#
# BE PRECISE ABOUT WHAT SURVIVES A REDIRECT, because the asset genuinely hops to
# objects.githubusercontent.com and -L has to follow it:
#   - the scheme pin (--proto-redir '=https') exists ONLY on the curl branch. uclient-fetch is tried
#     FIRST and is the only downloader on a stock router (curl is not in the default package set —
#     that is why this fallback chain exists at all), and it has no such flag: it follows up to 10
#     redirects, and an absolute Location: is re-parsed from scratch, so http:// would be followed.
#   - asset_host_ok() pins the host of the INITIAL request only; no backend pins the host across a
#     redirect, and -L is cross-host by design.
# So on the path a stock router actually takes, the ed25519 signature checked below is the ONE layer
# that survives a redirect. That is sound — it is what makes the package trustworthy, and the package
# manager installs --allow-untrusted regardless (it holds no key of ours) — but do not read this
# channel as more than "a verified-certificate delivery of the release metadata".
# @mirror gh/fetch
fetch() {
	_u="$1"; _t="$2"; _o="$3"
	if command -v uclient-fetch >/dev/null 2>&1; then
		if [ -n "$_o" ]; then uclient-fetch -T "$_t" -qO "$_o" "$_u" 2>/dev/null
		else uclient-fetch -T "$_t" -qO- "$_u" 2>/dev/null; fi
		return $?
	fi
	if command -v curl >/dev/null 2>&1; then
		if [ -n "$_o" ]; then
			curl -fsSL --proto =https --proto-redir =https --connect-timeout 10 --max-time "$_t" -o "$_o" "$_u" 2>/dev/null
		else
			curl -fsSL --proto =https --proto-redir =https --connect-timeout 10 --max-time "$_t" "$_u" 2>/dev/null
		fi
		return $?
	fi
	if command -v wget >/dev/null 2>&1; then
		_s=''
		wget --help 2>&1 | grep -q -- '--https-only' && _s='--https-only'
		if [ -n "$_o" ]; then wget -q $_s -T "$_t" -O "$_o" "$_u"
		else wget -q $_s -T "$_t" -O- "$_u"; fi
		return $?
	fi
	return 1
}
# @endmirror

# The URL comes out of the API answer and the file it names is handed to `apk add --allow-untrusted`
# as root. Pin the host, so a malformed or tampered response cannot point that install at an arbitrary
# server.
# @mirror gh/asset-host
asset_host_ok() {
	case "$1" in
		https://github.com/*|https://objects.githubusercontent.com/*|https://release-assets.githubusercontent.com/*) return 0 ;;
	esac
	return 1
}
# @endmirror

# Pick the asset by package NAME, not by extension. `grep "\.apk$" | head -n1` — what this did — takes
# whichever asset GitHub lists first, and the API sorts assets BY NAME: in v0.8.4, when the release
# still carried separate luci-i18n-footstrap-<lang> packages, that was a 6 KB catalogue installed in
# place of the theme (issue #6). Releases hold ONE package per format per NAME now; the name match is
# the fix for the next such mistake.
#
# `[-_]` is the separator both naming schemes use and is what keeps the two names apart (apk:
# `name-1.2.3-r1.apk`, ipk: `name_1.2.3-r1_all.ipk`); anchoring on `/` in front stops a repo or tag
# containing the package name from matching.
#
# @mirror gh/asset-urls
asset_urls() {		# <json> <package-name> -> every matching asset URL, one per line
	jsonfilter -i "$1" -e '@.assets[*].browser_download_url' 2>/dev/null \
		| grep -E "/$2[-_][^/]*\.$EXT\$" || true
}
asset_digest() {	# <json> <url> -> the sha256 GitHub publishes for THAT asset
	# matched on the URL rather than on list position — the two `assets[*]` lists
	# happen to be parallel today, but nothing promises it
	jsonfilter -i "$1" -e "@.assets[@.browser_download_url=\"$2\"].digest" 2>/dev/null | head -n1
}
sig_url() {		# <json> <package-url> -> the detached signature published for THAT package
	# Looked UP in the asset list, never derived by appending ".sig" to the URL: a derived URL
	# is a URL nobody published, and it would send the fetch after a file the release does not
	# claim to have. -Fx = whole line, literal.
	jsonfilter -i "$1" -e '@.assets[*].browser_download_url' 2>/dev/null | grep -Fx "$2.sig" || true
}
# @endmirror

# NOT @mirror'd: install.sh installs one known release and never sums asset sizes, so this has no
# twin. Used only by the free-space preflight below.
asset_size() {		# <json> <url> -> the byte size GitHub publishes for THAT asset (empty if none)
	jsonfilter -i "$1" -e "@.assets[@.browser_download_url=\"$2\"].size" 2>/dev/null | head -n1
}

# usign is on EVERY OpenWrt image — base-files depends on it — so verifying the release signature costs
# no new runtime dependency (see LUCI_DEPENDS in the Makefile: the curl lesson). The key is the
# package's own; it is not added to /etc/apk/keys, so nothing this package does makes footstrap a trust
# anchor for the router's package manager at large.
# @mirror gh/verify-sig
verify_sig() {		# <file> <sigfile> <pubkey-file> -> 0 iff the signature is ours and intact
	command -v usign >/dev/null 2>&1 || return 2
	usign -V -q -m "$1" -x "$2" -p "$3"
}
# @endmirror

# Download ONE asset, verify it, install it.
# Writes ERR: to $STATUS and returns non-zero on any failure. $1 = url, $2 = release json.
#
# TWO checks, and they answer DIFFERENT attackers:
#
#  - the ed25519 SIGNATURE is the real one. The sha256 below cannot stand alone, and the reason is
#    specific: GitHub COMPUTES `@.assets[*].digest` from the bytes that were uploaded. Anyone who can
#    replace a release asset — a leaked PAT with write scope, no CI run needed — gets the digest
#    recomputed for them, and the checksum then verifies the attacker's package happily. The signing
#    key is not in the repository and cannot be read back out of GitHub, so a replaced asset fails
#    here.
#  - the sha256 still earns its place: it catches a tampered or TRUNCATED download from the asset CDN
#    (objects.githubusercontent.com — a different host from api.github.com) with a clearer failure than
#    a signature mismatch. It does NOT survive usign's absence — nothing does: a missing usign is rc=2
#    below and refuses, which is the correct behaviour.
#
# Both fail CLOSED. A missing digest, a missing .sig asset, no usign on the box: all refuse. The `if [
# -n "$digest" ]` shape this once had fails OPEN — a renamed field, a predicate that stops resolving,
# an absent tool, all leave the variable empty, and it installed with no integrity check at all while
# reporting OK. Bytes we cannot account for, we do not hand to root.
fetch_verify_install() {
	url="$1"; json="$2"
	pkg="$WD/pkg.$EXT"
	sig="$pkg.sig"

	asset_host_ok "$url" || { echo "ERR: asset from an unexpected host" > "$STATUS"; return 1; }

	fetch "$url" 600 "$pkg" || { echo "ERR: download failed" > "$STATUS"; return 1; }
	[ -s "$pkg" ] || { echo "ERR: empty download" > "$STATUS"; rm -f "$pkg"; return 1; }

	digest="$(asset_digest "$json" "$url")"
	want="${digest#sha256:}"
	case "$want" in
		[0-9a-fA-F][0-9a-fA-F]*) ;;
		*) echo "ERR: release lists no sha256 for the asset, refusing to install" > "$STATUS"
		   rm -f "$pkg"; return 1 ;;
	esac
	got="$(sha256sum "$pkg" 2>/dev/null | cut -d' ' -f1)"
	[ -n "$got" ] && [ "$want" = "$got" ] || {
		echo "ERR: checksum mismatch, refusing to install" > "$STATUS"
		rm -f "$pkg"; return 1
	}

	# Two DIFFERENT faults, reported apart: "the release publishes no signature" points at the release,
	# "from an unexpected host" is what an attack looks like, and one message for both sent the admin
	# after the wrong one. Only the FIRST can fire today — sig_url() matches `$url.sig` with grep -Fx,
	# and $url passed asset_host_ok above, so the host of a found signature is already pinned by
	# construction. The check stays anyway, and not as decoration: it is what holds the day sig_url()
	# stops deriving the URL from an already-checked one (taking any asset whose name ends in .sig would
	# be an ordinary-looking refactor). Both fail closed.
	surl="$(sig_url "$json" "$url")"
	[ -n "$surl" ] || {
		echo "ERR: release publishes no signature for the package, refusing to install" > "$STATUS"
		rm -f "$pkg"; return 1
	}
	asset_host_ok "$surl" || {
		echo "ERR: package signature offered from an unexpected host, refusing to install" > "$STATUS"
		rm -f "$pkg"; return 1
	}
	fetch "$surl" 60 "$sig" && [ -s "$sig" ] || {
		echo "ERR: cannot download the package signature" > "$STATUS"
		rm -f "$pkg" "$sig"; return 1
	}
	verify_sig "$pkg" "$sig" "$PUBKEY"; rc=$?
	rm -f "$sig"
	[ "$rc" = 0 ] || {
		case "$rc" in
			2) echo "ERR: usign is missing, cannot verify the package signature" > "$STATUS" ;;
			*) echo "ERR: BAD SIGNATURE — the package is not the one we published" > "$STATUS" ;;
		esac
		rm -f "$pkg"; return 1
	}

	out="$(install_pkg "$pkg" 2>&1)"; rc=$?
	rm -f "$pkg"
	# The protocol is one line; apk's failure output is many. Flatten and cap it.
	[ "$rc" = 0 ] || {
		reason="$(printf '%s' "$out" | tr '\n\t' '  ' | tail -c 200)"
		echo "ERR: install failed: ${reason}" > "$STATUS"; return 1
	}
}

# Free-space preflight — a UX safety net, NOT a security gate, and it FAILS OPEN. An install that runs
# out of room mid-`apk add` leaves /www/luci-static/footstrap half-written (the worst failure on an
# 8-16 MB device). Sum the sizes the API publishes for the assets we will fetch and check both
# filesystems the update touches BEFORE the first byte is downloaded.
#
# Fails OPEN on purpose: a missing @.size or an unreadable df must NOT block a legitimate,
# correctly-signed update — space is not a security property (contrast the fail-CLOSED trust chain
# below, where a missing digest or signature refuses). Worst case without this check is the
# pre-existing behaviour: apk fails and the client shows its error.
# check_space <json> <url>...  -> 0 = enough (or unknown); 1 = short (writes ERR to $STATUS)
check_space() {
	_j="$1"; shift
	_need=0; _max=0
	for _u in "$@"; do
		_s="$(asset_size "$_j" "$_u")"
		case "$_s" in ''|*[!0-9]*) return 0 ;; esac	# size unknown -> skip the check (fail open)
		_need=$((_need + _s))
		[ "$_s" -gt "$_max" ] && _max="$_s"
	done
	_need_kb=$((_need / 1024 + 1))
	_max_kb=$((_max / 1024 + 1))
	# download lands in $WD (tmpfs = RAM), one package at a time (each rm'd after its install);
	# install unpacks into the root overlay (flash), ~2x the compressed size. 512 KB margin each.
	_tmp="$(df -k "$WD" 2>/dev/null | awk 'NR==2{print $4}')"
	_root="$(df -k / 2>/dev/null | awk 'NR==2{print $4}')"
	case "$_tmp" in ''|*[!0-9]*) _tmp=0 ;; esac
	case "$_root" in ''|*[!0-9]*) _root=0 ;; esac
	if [ "$_tmp" -gt 0 ] && [ "$_tmp" -lt $((_max_kb + 512)) ]; then
		echo "ERR: not enough RAM to download the update (~${_max_kb} KB needed, ${_tmp} KB free in /var/run)" > "$STATUS"
		return 1
	fi
	if [ "$_root" -gt 0 ] && [ "$_root" -lt $((_need_kb * 2 + 512)) ]; then
		echo "ERR: not enough free space to install the update (~$((_need_kb * 2)) KB needed, ${_root} KB free)" > "$STATUS"
		return 1
	fi
	return 0
}

do_update() {
	if command -v apk >/dev/null 2>&1; then
		EXT="apk"
		install_pkg() { apk add --allow-untrusted "$1"; }
	elif command -v opkg >/dev/null 2>&1; then
		EXT="ipk"
		install_pkg() { opkg install "$1"; }
	else
		echo "ERR: no apk or opkg found" > "$STATUS"; return 1
	fi

	json="$WD/release.json"
	fetch "$API" 20 "$json" || { echo "ERR: cannot reach the GitHub release API" > "$STATUS"; return 1; }

	# Install the THEME (essential) and THIS updater (optional). Named separately, never by a bare
	# `\.$EXT$` glob: since v0.8.4 a release with more than one same-format asset is a trap for a
	# self-updater that picks by extension (issue #6), so each package is resolved by its own name.
	#
	# The theme is required — its absence is a broken release and a hard failure. The updater is
	# OPTIONAL, and the word means what it says in BOTH directions: a release older than this split has
	# no updater asset (skipped), AND a present updater whose install fails is NON-FATAL once the theme
	# is in (see the refresh below). When the updater asset installs cleanly it is installed too, so
	# this updater never lags the theme it drives.
	#
	# ORDER: theme first, updater second. The updater package overwrites THIS running script — which is
	# why the worker runs from a staged copy ($WORKER, see the "" branch) that nobody replaces.
	theme_url="$(asset_urls "$json" luci-theme-footstrap | head -1)"
	[ -n "$theme_url" ] || {
		echo "ERR: no luci-theme-footstrap .${EXT} asset in latest release" > "$STATUS"
		rm -f "$json"; return 1
	}
	updater_url="$(asset_urls "$json" luci-app-footstrap-updater | head -1)"

	# Both URLs resolved: check free space ONCE, before any download, so a short device fails with a
	# clear cause instead of a half-written tree. The updater arg is omitted when the release carries
	# no updater asset (pre-split releases).
	check_space "$json" "$theme_url" ${updater_url:+"$updater_url"} || { rm -f "$json"; return 1; }

	fetch_verify_install "$theme_url" "$json" || { rm -f "$json"; return 1; }

	# The theme (the essential package) is now on disk. A failing updater refresh must NOT strand it
	# behind stale caches: fetch_verify_install installs NOTHING on a verify failure — the old,
	# already-verified updater stays intact and retries next time — so a present-but-failing updater is
	# a success for the update as a whole, not a failure that reports ERR and skips the reload. It once
	# did `|| { return 1; }`, which left the new theme on disk while status=ERR, the LuCI caches
	# undropped and the client refusing to reload: the update looked failed and the new theme never
	# visibly applied. Re-assert RUNNING so a poll landing between the transient ERR fetch_verify_install
	# wrote and the OK below never sees it.
	if [ -n "$updater_url" ]; then
		fetch_verify_install "$updater_url" "$json" || echo "RUNNING" > "$STATUS"
	fi
	rm -f "$json"

	# drop the LuCI menu/dispatch + module caches so the new theme is served at once
	rm -f /tmp/luci-indexcache* 2>/dev/null
	rm -rf /tmp/luci-modulecache 2>/dev/null

	echo "OK" > "$STATUS"
}

case "$1" in
check)
	# The router asks GitHub, not the browser: a LAN client often has no route to the internet, and a
	# browser fetch is subject to CORS and to the user's own rate limit. Cached in /var/run (root-owned
	# tmpfs — see the CWE-377 note above), so a reboot re-checks. The full API answer is saved to
	# $APIJSON so `notes` can read the release body from the SAME fetch — one API call feeds both.
	now=$(date +%s)
	if [ -f "$CACHE" ] && [ -f "$APIJSON" ]; then
		read -r ts tag < "$CACHE"
		# A truncated cache (full tmpfs) leaves ts empty or non-numeric, and an arithmetic error is
		# FATAL in ash: the script would die here and `check` would answer with an empty string instead
		# of ERR:. Force a miss.
		case "$ts" in ''|*[!0-9]*) ts=0 ;; esac
		if [ -n "$tag" ] && [ $((now - ts)) -lt "$CACHE_TTL" ]; then
			echo "$tag"; exit 0
		fi
	fi

	fetch "$API" 10 "$APIJSON" || { echo "ERR: cannot reach the GitHub release API"; exit 1; }
	tag="$(jsonfilter -i "$APIJSON" -e '@.tag_name' 2>/dev/null)"
	[ -n "$tag" ] || { echo "ERR: cannot reach the GitHub release API"; exit 1; }
	echo "$now $tag" > "$CACHE"
	echo "$tag"
	exit 0
	;;
notes)
	# The GitHub release body, for the confirm dialog (versions + notes + breaking-change banner). It
	# rides the cached $APIJSON that `check` already saved — no extra API call in the common path,
	# where the badge (a `check`) has just been shown. Only if the cache is absent does it fetch once.
	#
	# The OUTPUT IS THE PAYLOAD, not a keyword: the client reads the whole stdout as untrusted display
	# text and renders it as a text node (never markup) — it is shown BEFORE the signature is verified.
	# Best-effort: any failure yields an empty body, and the dialog simply omits the notes.
	[ -f "$APIJSON" ] || fetch "$API" 10 "$APIJSON" >/dev/null 2>&1
	[ -f "$APIJSON" ] && jsonfilter -i "$APIJSON" -e '@.body' 2>/dev/null
	exit 0
	;;
status)
	[ -f "$STATUS" ] && cat "$STATUS" || echo "IDLE"
	exit 0
	;;
__run)
	# The privileged worker entrypoint, and it is REACHABLE OVER RPC: the file.exec ACL matches the
	# command PATH only and `params` are free, so any session holding the ACL can call __run directly.
	# That would run do_update in the FOREGROUND and WITHOUT $LOCK — racing a normal spawn into two
	# concurrent `apk add` on the same package (the bug the lock below fixes) — and rpcd would kill it
	# at its 30 s timeout, possibly mid-install, leaving /www/luci-static/footstrap half written.
	#
	# The staged copy is the only legitimate caller: the spawn below execs "$WORKER", so that is what
	# $0 must be. An RPC caller names the installed path and gets nothing.
	[ "$0" = "$WORKER" ] || { echo "ERR: unknown argument"; exit 1; }
	do_update
	rm -f "$WORKER"
	rmdir "$LOCK" 2>/dev/null
	exit 0
	;;
"")
	# Two RPCs arriving together must not both start an install: read-then-write is not atomic, so a
	# status check followed by a spawn had both callers read "not running" and both spawn a worker —
	# two concurrent `apk add` on the same package (reproduced by firing this twice). mkdir is atomic
	# (it fails if the name exists), so it IS the lock.
	#
	# THE LOCK IS THE STATE, and nothing else may decide it:
	#  - No pre-check in front of the mkdir. One used to sit there ("$STATUS says RUNNING and the staged
	#    $WORKER exists → RUNNING") and it wedged the Update button for good: a worker SIGKILLed
	#    mid-`apk add` (OOM on a 128 MB router) leaves both true FOREVER, since only the worker's own
	#    exit clears them, so every later click answered RUNNING, the client polled its 300 s and
	#    reported "timed out waiting for the installer" — until a reboot. It also returned before the
	#    stale-lock reclaim written for exactly that OOM case. It loses nothing: a live run holds the
	#    lock, so mkdir fails and the answer is RUNNING anyway.
	#  - RECLAIM a lock whose worker was OOM-killed from its MTIME, never from $STATUS/$WORKER: those are
	#    written AFTER the mkdir, so a second caller arriving in between sees a held lock with no
	#    evidence behind it, calls it stale and steals it — two installs again (the first attempt; the
	#    router duly spawned two workers). The mtime is set by the atomic mkdir itself, so there is no
	#    window: younger than any plausible run = live (the client gives up after 300 s, an install
	#    takes seconds); older = its worker is gone.
	if ! mkdir "$LOCK" 2>/dev/null; then
		if [ -n "$(find "$LOCK" -maxdepth 0 -mmin +10 2>/dev/null)" ]; then
			rmdir "$LOCK" 2>/dev/null
			mkdir "$LOCK" 2>/dev/null || { echo "RUNNING"; exit 0; }
		else
			echo "RUNNING"; exit 0
		fi
	fi
	echo "RUNNING" > "$STATUS"

	# The packages we are about to install overwrite this very script. Run the worker from a copy so
	# the shell keeps reading a file nobody replaces.
	cp "$0" "$WORKER" && chmod 755 "$WORKER" || {
		rmdir "$LOCK" 2>/dev/null
		echo "ERR: cannot stage worker" > "$STATUS"; echo "ERR: cannot stage worker"; exit 1
	}

	# Detach. rpcd reads the exec'd process's stdout until EOF and hands the child more than the three
	# standard descriptors (fd 3 and 9..12 — its own ucode sources), so redirecting 0/1/2 is NOT enough:
	# a grandchild still holding any of them keeps rpcd waiting to its 30 s timeout — the RPC timeout we
	# are here to avoid. start-stop-daemon -b closes everything; where it is missing, close the strays
	# by hand.
	if command -v start-stop-daemon >/dev/null 2>&1; then
		start-stop-daemon -S -b -x "$WORKER" -- __run
	else
		(
			exec 3>&- 4>&- 5>&- 6>&- 7>&- 8>&- 9>&- 10>&- 11>&- 12>&- 2>/dev/null
			setsid "$WORKER" __run </dev/null >/dev/null 2>&1 &
		) &
	fi
	echo "STARTED"
	exit 0
	;;
*)
	echo "ERR: unknown argument"
	exit 1
	;;
esac
