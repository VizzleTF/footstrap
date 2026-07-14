#!/bin/sh
# Incremental deploy of luci-theme-footstrap to the dev router.
#
#   deploy.sh [file ...]      # scp given repo-relative files to their router paths
#   deploy.sh                 # scp all changed-vs-HEAD runtime files (git)
#   deploy.sh --all           # scp every runtime file (templates + static + menu + include)
#
# Always bumps the cache-bust token and clears the dispatch cache so a plain
# F5 reloads. Does NOT change the active theme or re-register themes.
set -e

R="${FOOTSTRAP_SSH:-router}"
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)/luci-theme-footstrap"
cd "$ROOT"

# cascade.css is generated and untracked, so `git diff` can never report it. Rebuild
# when a source file is newer, then let collect() treat it as any other runtime file.
CSS=htdocs/luci-static/footstrap/cascade.css
if [ ! -f "$CSS" ] || [ -n "$(find styles -name '*.css' -newer "$CSS" 2>/dev/null)" ]; then
	./build-css.sh "$ROOT/$CSS" --dev
fi

# map repo-relative path -> absolute router path
dest() {
	case "$1" in
		htdocs/luci-static/*) echo "/www/luci-static/${1#htdocs/luci-static/}" ;;
		ucode/*)              echo "/usr/share/ucode/luci/${1#ucode/}" ;;
		root/*)               echo "/${1#root/}" ;;
		*) return 1 ;;
	esac
}

# Discover by GLOB/directory, NEVER by a hand-written list of names — root/ was missing
# here: dest() always knew how to map root/* to /*, but nothing ever handed it one (both
# branches searched htdocs/ and ucode/template only). Editing footstrap-selfupdate.sh or
# its rpcd ACL and deploying therefore did NOTHING, silently, and the router kept running
# the old backend. The package ships root/ (luci.mk installs it to /), so this must too.
collect() {
	if [ "$1" = "--all" ]; then
		find htdocs/luci-static ucode/template root -type f \
			\( -name '*.css' -o -name '*.js' -o -name '*.ut' -o -name '*.woff2' \
			   -o -name '*.svg' -o -name '*.png' -o -name '*.sh' -o -name '*.json' \
			   -o -path 'root/etc/uci-defaults/*' \)
	elif [ $# -gt 0 ]; then
		printf '%s\n' "$@"
	else
		# changed vs HEAD (staged + unstaged), runtime dirs only.
		# styles/ is source, not runtime: a change there means ship cascade.css.
		{
			git -C "$ROOT/.." diff --name-only HEAD -- \
				luci-theme-footstrap/htdocs/luci-static luci-theme-footstrap/ucode/template \
				luci-theme-footstrap/root 2>/dev/null \
				| sed 's#^luci-theme-footstrap/##'
			git -C "$ROOT/.." diff --quiet HEAD -- luci-theme-footstrap/styles 2>/dev/null || echo "$CSS"
		} | sort -u
	fi
}

FILES="$(collect "$@")"
[ -n "$FILES" ] || { echo "nothing changed to deploy (use --all to force)"; }

n=0
backend=0
for f in $FILES; do
	[ -f "$f" ] || continue
	d="$(dest "$f")" || { echo "skip (unmapped): $f"; continue; }
	ssh "$R" "mkdir -p '$(dirname "$d")'"
	scp -q "$f" "$R:$d"
	# scp does not preserve the exec bit, and these have to arrive executable
	case "$d" in /usr/libexec/*|/etc/uci-defaults/*) ssh "$R" "chmod +x '$d'" ;; esac
	# an acl.d change only takes effect once rpcd re-reads the directory (SIGHUP)
	case "$d" in /usr/share/rpcd/acl.d/*|/usr/libexec/*) backend=1 ;; esac
	echo "→ $d"
	n=$((n+1))
done

[ "$backend" = 1 ] && ssh "$R" '/etc/init.d/rpcd reload' && echo "rpcd reloaded (ACL/backend changed)"
# BOTH caches, as postinst does — a stale module cache after replacing theme JS is the case
# that bites. touch bumps pkgs_update_time, i.e. the ?v= cache-bust, so a plain F5 reloads.
ssh "$R" 'touch /lib/apk/db/installed; rm -f /tmp/luci-indexcache*; rm -rf /tmp/luci-modulecache'
echo "deployed $n file(s) to $R; cache bumped (F5 reloads). Active theme unchanged."
