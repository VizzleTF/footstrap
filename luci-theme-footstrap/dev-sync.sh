#!/bin/sh
# Залить тему footstrap (sidebar + top-nav варианты) на роутер (ssh router).
# Регистрирует темы, НЕ активирует.
set -e

R="${1:-router}"
N=footstrap
D="$(cd "$(dirname "$0")" && pwd)"

# cascade.css is generated from styles/ + pages/ and is not in git. --dev keeps
# the comments so the file on the router still reads like the source.
"$D"/build-css.sh "$D/htdocs/luci-static/$N/cascade.css" --dev

ssh "$R" "mkdir -p /usr/share/ucode/luci/template/themes/$N \
	/usr/share/ucode/luci/template/themes/$N-top \
	/www/luci-static/$N \
	/www/luci-static/resources/view/status/include"

# sidebar templates (+ partials/) + top-nav templates
scp -q  "$D"/ucode/template/themes/$N/*.ut      "$R":/usr/share/ucode/luci/template/themes/$N/
ssh "$R" "mkdir -p /usr/share/ucode/luci/template/themes/$N/partials"
scp -q  "$D"/ucode/template/themes/$N/partials/*.ut "$R":/usr/share/ucode/luci/template/themes/$N/partials/
scp -q  "$D"/ucode/template/themes/$N-top/*.ut  "$R":/usr/share/ucode/luci/template/themes/$N-top/

# shared static (cascade.css, fonts, logo) + menu renderers (+ shared common)
scp -qr "$D"/htdocs/luci-static/$N/*                     "$R":/www/luci-static/$N/
scp -q  "$D"/htdocs/luci-static/resources/menu-$N-common.js "$R":/www/luci-static/resources/
# stamp the git-derived version into the deployed common.js (the packaged build
# does the same in the Makefile) so the Appearance popover shows a real version
# and the update check works on the dev router.
FS_V="$(git -C "$D" describe --tags --always 2>/dev/null | sed 's/^v//')"
# if-form, not `[ -n ] && ssh`: under `set -e` a failed &&-list aborts the whole
# sync when git describe yields nothing (e.g. a copied tree without .git).
# Also refuse a tag with sed/shell-special characters instead of interpolating it.
if [ -n "$FS_V" ] && expr "$FS_V" : '[0-9A-Za-z._-]*$' >/dev/null; then
	ssh "$R" "sed -i \"s#const FS_VERSION = '[^']*'#const FS_VERSION = '$FS_V'#\" /www/luci-static/resources/menu-$N-common.js"
fi
scp -q  "$D"/htdocs/luci-static/resources/menu-$N.js        "$R":/www/luci-static/resources/
scp -q  "$D"/htdocs/luci-static/resources/menu-$N-top.js    "$R":/www/luci-static/resources/
scp -q  "$D"/htdocs/luci-static/resources/fs-select.js      "$R":/www/luci-static/resources/
scp -q  "$D"/htdocs/luci-static/resources/view/status/include/05_${N}_overview_layout.js \
	"$R":/www/luci-static/resources/view/status/include/

# self-update backend: the exec script + its rpcd ACL (file.exec of that one path)
ssh "$R" "mkdir -p /usr/libexec /usr/share/rpcd/acl.d"
scp -q  "$D"/root/usr/libexec/footstrap-selfupdate.sh          "$R":/usr/libexec/
scp -q  "$D"/root/usr/share/rpcd/acl.d/luci-theme-footstrap.json "$R":/usr/share/rpcd/acl.d/
ssh "$R" "chmod +x /usr/libexec/footstrap-selfupdate.sh; /etc/init.d/rpcd reload 2>/dev/null; rm -f /tmp/luci-indexcache*"

ssh "$R" "
# Both layouts serve the same assets, so $N-top is a symlink to the one real
# media dir. -n is load-bearing: without it a re-run sees the existing
# symlink-to-directory as a directory and drops the new link INSIDE it
# (luci-static/footstrap/footstrap-top).
cd /www/luci-static
ln -sfn $N $N-top
# The six pre-consolidation variant names are gone. Sweep any left by an older
# run of this script, or the router keeps serving a theme LuCI no longer lists.
#
# rm -rf, not rm -f: the legacy variants are DIRECTORIES (/www/luci-static/
# footstrap-dark/, and the matching template dirs). `rm -f` refuses to remove a
# directory, the error was swallowed by 2>/dev/null, and this block runs without
# set -e — so the sweep silently did nothing and the router went on serving media
# for a theme that is no longer in luci.themes. Every path here is a literal built
# from $N; there is no glob and no user input.
rm -rf $N/$N $N-top/$N-top $N-dark $N-light $N-top-dark $N-top-light
cd /usr/share/ucode/luci/template/themes
rm -rf $N/$N $N-top/$N-top $N-dark $N-light $N-top-dark $N-top-light
touch /lib/apk/db/installed
rm -f /tmp/luci-indexcache*"

# register the theme entries by running the package's own uci-defaults script —
# it is the single source of truth (two layout entries; dark/light and palette
# are client-side toggles now). PKG_UPGRADE=1 keeps it from touching the active
# theme on a fresh router.
scp -q "$D"/root/etc/uci-defaults/30_luci-theme-footstrap "$R":/tmp/30_luci-theme-footstrap
ssh "$R" "PKG_UPGRADE=1 sh /tmp/30_luci-theme-footstrap; rm -f /tmp/30_luci-theme-footstrap /tmp/luci-indexcache*"

echo "synced to $R (sidebar + top-nav registered, active theme unchanged)"
