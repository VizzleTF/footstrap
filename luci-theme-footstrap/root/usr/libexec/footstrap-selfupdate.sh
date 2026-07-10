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

STATUS=/tmp/footstrap-update.status
WORKER=/tmp/footstrap-update-run.sh
CACHE=/tmp/footstrap-latest

# how long a `check` result stays good. GitHub allows 60 unauthenticated API
# calls per hour per source IP; without a cache every page load would spend one.
CACHE_TTL=3600

REPO="VizzleTF/luci-theme-footstrap"
API="https://api.github.com/repos/${REPO}/releases/latest"

do_update() {
	if command -v apk >/dev/null 2>&1; then
		EXT="apk"; TMP="/tmp/footstrap-update.apk"
		install_pkg() { apk add --allow-untrusted "$1"; }
	elif command -v opkg >/dev/null 2>&1; then
		EXT="ipk"; TMP="/tmp/footstrap-update.ipk"
		install_pkg() { opkg install "$1"; }
	else
		echo "ERR: no apk or opkg found" > "$STATUS"; return 1
	fi

	# pick the .apk / .ipk asset URL from the latest release
	url="$(curl -fsSL "$API" 2>/dev/null | jsonfilter -e '@.assets[*].browser_download_url' 2>/dev/null | grep -E "\.${EXT}\$" | head -1)"
	[ -n "$url" ] || { echo "ERR: no .${EXT} asset in latest release" > "$STATUS"; return 1; }

	# -L: follow the release->objects.githubusercontent.com redirect
	curl -fsSL -o "$TMP" "$url" 2>/dev/null || { echo "ERR: download failed" > "$STATUS"; return 1; }
	[ -s "$TMP" ] || { echo "ERR: empty download" > "$STATUS"; rm -f "$TMP"; return 1; }

	out="$(install_pkg "$TMP" 2>&1)"; rc=$?
	rm -f "$TMP"
	# drop the LuCI menu/dispatch + module caches so the new theme is served at once
	rm -f /tmp/luci-indexcache* 2>/dev/null
	rm -rf /tmp/luci-modulecache 2>/dev/null

	[ "$rc" = 0 ] || { echo "ERR: install failed: ${out}" > "$STATUS"; return 1; }
	echo "OK" > "$STATUS"
}

case "$1" in
check)
	# The router asks GitHub, not the browser: a LAN client often has no route to
	# the internet, and a browser fetch is also subject to CORS and to the user's
	# own rate limit. Cached in /tmp (tmpfs), so a reboot re-checks.
	now=$(date +%s)
	if [ -f "$CACHE" ]; then
		read -r ts tag < "$CACHE"
		if [ -n "$tag" ] && [ $((now - ts)) -lt "$CACHE_TTL" ] 2>/dev/null; then
			echo "$tag"; exit 0
		fi
	fi

	tag="$(curl -fsSL --max-time 10 "$API" 2>/dev/null | jsonfilter -e '@.tag_name' 2>/dev/null)"
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
	exit 0
	;;
"")
	# A worker that died (rebooted, OOM-killed) would leave RUNNING behind and
	# wedge the button forever. The worker removes its own staged copy when it
	# finishes, so RUNNING without that copy means the run is stale — retry.
	if [ "$(cat "$STATUS" 2>/dev/null)" = "RUNNING" ] && [ -f "$WORKER" ]; then
		echo "RUNNING"; exit 0
	fi
	echo "RUNNING" > "$STATUS"

	# The package we are about to install overwrites this very script. Run the
	# worker from a copy so the shell keeps reading a file nobody replaces.
	cp "$0" "$WORKER" && chmod 755 "$WORKER" || {
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
