#!/bin/sh
# Footstrap theme self-update.
#
# Downloads the latest GitHub release package for THIS theme and installs it with
# the platform package manager: apk on 25.12+, opkg on 24.10. The repo and the
# GitHub API endpoint are hard-coded here and the script takes only two fixed
# keywords, so the LuCI `file.exec` call that triggers it (ACL-gated to this exact
# path) has no injection surface — it can only ever install this theme's own
# signed-by-nobody release, over HTTPS, when an authenticated admin asks for it.
#
# WHY IT DAEMONISES. The install runs far longer than either timeout on the RPC
# path: LuCI's rpc.js aborts the XHR after `rpctimeout` (20 s by default) and
# rpcd kills the exec'd process after `rpcd.@rpcd[0].timeout` (30 s). A
# synchronous run therefore reported "XHR request timed out" even when it
# succeeded — and worse, rpcd could kill apk mid-install. So the foreground call
# only spawns a detached worker and returns at once; the client polls `status`.
#
# Protocol (stdout, one line):
#   <no args>  -> STARTED | RUNNING            (spawn worker / already running)
#   status     -> RUNNING | OK | ERR: <reason> | IDLE
#   check      -> v<tag> | ERR: <reason>       (latest release, cached)
# Exit code is 0 for all of the above except a failed spawn; the client reads the
# keyword, not the code.

# rpcd hands the exec'd process an environment the CALLER can set, so nothing
# here may be resolved through an inherited PATH.
PATH=/usr/sbin:/usr/bin:/sbin:/bin
export PATH

# All state lives in /var/run (a symlink to /tmp/run), NOT in /tmp itself.
# /tmp is 1777: any local unprivileged process can pre-create a predictable path
# there as a symlink, and root's `cp`, `chmod`, `curl -o` and `>` then write
# through it to a file of the attacker's choosing (CWE-377). /var/run is
# root-owned 0755, so an unprivileged process cannot create the names below at
# all and the race does not exist. It is tmpfs either way, so the "a reboot
# re-checks" property of the cache is unchanged.
WD=/var/run/footstrap-update
STATUS="$WD/status"
WORKER="$WD/run.sh"
CACHE="$WD/latest"
LOCK="$WD/lock"		# a DIRECTORY: mkdir is the atomic test-and-set (see the "" branch)

mkdir -p "$WD" 2>/dev/null && chmod 700 "$WD" 2>/dev/null || {
	echo "ERR: cannot create $WD"; exit 1
}

# How long a `check` result stays good. GitHub allows 60 unauthenticated API
# calls per hour per source IP; without a cache every page load would spend one.
#
# 5 minutes, not an hour: the cache is only refreshed by this timer, so its TTL
# is exactly how long a freshly published release stays invisible. An hour meant
# the badge could lag a release by most of an hour with no way to tell whether
# the check was broken or merely stale. At 300 s the worst case is 12 calls per
# hour even if the admin sits reloading the page, well inside the 60-call budget
# — and the browser memoises the answer for the page load on top of that.
CACHE_TTL=300

REPO="VizzleTF/luci-theme-footstrap"
API="https://api.github.com/repos/${REPO}/releases/latest"

# fetch <url> <max-seconds> [outfile]   — stdout when no outfile.
#
# curl is NOT on a stock OpenWrt router: the base image ships `uclient-fetch`, and
# curl is a separately-installed package (verified on the dev router:
# `/usr/bin/curl is owned by curl-8.19.0-r2`). This script hard-required it, so on
# any router that had not installed curl by hand BOTH the update badge and the
# Update button died with "ERR: cannot reach the GitHub release API" — reproduced
# by moving /usr/bin/curl aside. uclient-fetch is the fallback, exactly as
# install.sh already does it.
#
# Every fetch is BOUNDED. Without a timeout a stalled connection leaves
# STATUS=RUNNING and a live $WORKER behind forever, and that pair is exactly what
# the "" branch reads as "a run is already in progress" — the button would wedge
# until a reboot.
#
# The certificate is always verified, and the scheme is pinned to https on the
# redirect too: the release asset hops to objects.githubusercontent.com, and
# without --proto-redir a redirect to plain http:// would be followed — handing an
# on-path attacker the package that is about to be installed as root.
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

# The package is downloaded from a URL read out of the API answer and then handed
# to `apk add --allow-untrusted` as root. Pin the host, so a malformed or tampered
# response cannot point that install at an arbitrary server.
# @mirror gh/asset-host
asset_host_ok() {
	case "$1" in
		https://github.com/*|https://objects.githubusercontent.com/*|https://release-assets.githubusercontent.com/*) return 0 ;;
	esac
	return 1
}
# @endmirror

do_update() {
	if command -v apk >/dev/null 2>&1; then
		EXT="apk"; TMP="$WD/pkg.apk"
		install_pkg() { apk add --allow-untrusted "$1"; }
	elif command -v opkg >/dev/null 2>&1; then
		EXT="ipk"; TMP="$WD/pkg.ipk"
		install_pkg() { opkg install "$1"; }
	else
		echo "ERR: no apk or opkg found" > "$STATUS"; return 1
	fi

	# pick the .apk / .ipk asset URL from the latest release, and the sha256 GitHub
	# publishes for THAT asset (matched on the URL, not on list position)
	json="$WD/release.json"
	fetch "$API" 20 "$json" || { echo "ERR: cannot reach the GitHub release API" > "$STATUS"; return 1; }
	url="$(jsonfilter -i "$json" -e '@.assets[*].browser_download_url' 2>/dev/null | grep -E "\.${EXT}\$" | head -1)"
	[ -n "$url" ] || { echo "ERR: no .${EXT} asset in latest release" > "$STATUS"; rm -f "$json"; return 1; }
	asset_host_ok "$url" || { echo "ERR: asset from an unexpected host" > "$STATUS"; rm -f "$json"; return 1; }
	digest="$(jsonfilter -i "$json" -e "@.assets[@.browser_download_url=\"$url\"].digest" 2>/dev/null | head -1)"
	rm -f "$json"

	fetch "$url" 600 "$TMP" || { echo "ERR: download failed" > "$STATUS"; return 1; }
	[ -s "$TMP" ] || { echo "ERR: empty download" > "$STATUS"; rm -f "$TMP"; return 1; }

	# apk is called with --allow-untrusted, i.e. with no package signature to fall
	# back on — so this sha256 is the only integrity check the update has. It rides
	# the same TLS channel as the URL, so it does not defend against a compromised
	# api.github.com; what it does defend against is a truncated or tampered
	# download from the asset CDN, which is a DIFFERENT host. Refuse on a mismatch:
	# installing a package whose bytes we cannot account for is the one thing this
	# script must never do.
	if [ -n "$digest" ]; then
		want="${digest#sha256:}"
		got="$(sha256sum "$TMP" 2>/dev/null | cut -d' ' -f1)"
		[ -n "$got" ] && [ "$want" = "$got" ] || {
			echo "ERR: checksum mismatch, refusing to install" > "$STATUS"
			rm -f "$TMP"; return 1
		}
	fi

	out="$(install_pkg "$TMP" 2>&1)"; rc=$?
	rm -f "$TMP"
	# drop the LuCI menu/dispatch + module caches so the new theme is served at once
	rm -f /tmp/luci-indexcache* 2>/dev/null
	rm -rf /tmp/luci-modulecache 2>/dev/null

	# The protocol is one line; apk's failure output is many. Flatten and cap it.
	[ "$rc" = 0 ] || {
		reason="$(printf '%s' "$out" | tr '\n\t' '  ' | tail -c 200)"
		echo "ERR: install failed: ${reason}" > "$STATUS"; return 1
	}
	echo "OK" > "$STATUS"
}

case "$1" in
check)
	# The router asks GitHub, not the browser: a LAN client often has no route to
	# the internet, and a browser fetch is also subject to CORS and to the user's
	# own rate limit. Cached in /var/run (tmpfs, root-owned — see the CWE-377 note in the header;
	# deliberately NOT /tmp), so a reboot re-checks.
	now=$(date +%s)
	if [ -f "$CACHE" ]; then
		read -r ts tag < "$CACHE"
		# A truncated or corrupt cache (full tmpfs) leaves ts empty or non-numeric,
		# and an arithmetic error is FATAL in ash: the script would die here and
		# `check` would answer with an empty string instead of ERR:. Force a miss.
		case "$ts" in ''|*[!0-9]*) ts=0 ;; esac
		if [ -n "$tag" ] && [ $((now - ts)) -lt "$CACHE_TTL" ]; then
			echo "$tag"; exit 0
		fi
	fi

	tag="$(fetch "$API" 10 | jsonfilter -e '@.tag_name' 2>/dev/null)"
	[ -n "$tag" ] || { echo "ERR: cannot reach the GitHub release API"; exit 1; }
	echo "$now $tag" > "$CACHE"
	echo "$tag"
	exit 0
	;;
status)
	[ -f "$STATUS" ] && cat "$STATUS" || echo "IDLE"
	exit 0
	;;
__run)
	do_update
	rm -f "$WORKER"
	rmdir "$LOCK" 2>/dev/null
	exit 0
	;;
"")
	# A worker that died (rebooted, OOM-killed) would leave RUNNING behind and
	# wedge the button forever. The worker removes its own staged copy when it
	# finishes, so RUNNING without that copy means the run is stale — retry.
	if [ "$(cat "$STATUS" 2>/dev/null)" = "RUNNING" ] && [ -f "$WORKER" ]; then
		echo "RUNNING"; exit 0
	fi

	# ...but that test is not the whole story: read-then-write is not atomic, so two
	# RPCs arriving together BOTH read "not running" and BOTH spawned a worker — two
	# concurrent `apk add` runs on the same package. Reproduced by firing the script
	# twice at once: two workers, two installs.
	#
	# mkdir IS atomic — it fails if the name exists — so it is the lock. The subtle
	# part is RECLAIMING a lock whose worker was killed (OOM) and never cleaned up.
	# Do NOT decide that from $STATUS/$WORKER: those are written AFTER the mkdir, so
	# a second caller arriving in between sees a held lock with no evidence behind it,
	# calls it stale, steals it — and we are back to two installs. That was the first
	# attempt, and the router duly spawned two workers.
	#
	# The lock's own MTIME is the evidence, and it is set by the atomic mkdir itself,
	# so there is no window. A lock younger than any plausible run is a live run (the
	# client gives up after 300 s and a theme install takes seconds); older than that,
	# its worker is gone and the lock is ours to take.
	if ! mkdir "$LOCK" 2>/dev/null; then
		if [ -n "$(find "$LOCK" -maxdepth 0 -mmin +10 2>/dev/null)" ]; then
			rmdir "$LOCK" 2>/dev/null
			mkdir "$LOCK" 2>/dev/null || { echo "RUNNING"; exit 0; }
		else
			echo "RUNNING"; exit 0
		fi
	fi
	echo "RUNNING" > "$STATUS"

	# The package we are about to install overwrites this very script. Run the
	# worker from a copy so the shell keeps reading a file nobody replaces.
	cp "$0" "$WORKER" && chmod 755 "$WORKER" || {
		rmdir "$LOCK" 2>/dev/null
		echo "ERR: cannot stage worker" > "$STATUS"; echo "ERR: cannot stage worker"; exit 1
	}

	# Detach. rpcd reads the exec'd process's stdout until EOF, and it hands the
	# child more than the three standard descriptors (fd 3 and 9..12 — its own
	# ucode sources). Redirecting 0/1/2 is therefore NOT enough: a surviving
	# grandchild that still holds any of those keeps rpcd waiting until its 30 s
	# timeout, which is exactly what made the RPC call time out. start-stop-daemon
	# -b closes everything for us; where it is missing, close the strays by hand.
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
