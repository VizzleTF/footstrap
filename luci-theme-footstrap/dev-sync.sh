#!/bin/sh
# Залить тему footstrap (sidebar + top-nav варианты) на роутер (ssh router).
# Регистрирует темы, НЕ активирует.
set -e

R="${1:-router}"
N=footstrap
D="$(cd "$(dirname "$0")" && pwd)"

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
[ -n "$FS_V" ] && ssh "$R" "sed -i \"s#const FS_VERSION = '[^']*'#const FS_VERSION = '$FS_V'#\" /www/luci-static/resources/menu-$N-common.js"
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
# -n is load-bearing: without it, a re-run sees the existing symlink-to-directory
# as a directory and drops the new link INSIDE it (themes/footstrap/footstrap).
# media symlinks (dark/light + top share the footstrap assets dir)
cd /www/luci-static
rm -f $N/$N $N-top/$N-top 2>/dev/null   # clean up strays left by an older run
ln -sfn $N $N-dark; ln -sfn $N $N-light
ln -sfn $N $N-top; ln -sfn $N $N-top-dark; ln -sfn $N $N-top-light
# template symlinks (dark/light reuse base templates per layout)
cd /usr/share/ucode/luci/template/themes
rm -f $N/$N $N-top/$N-top 2>/dev/null
ln -sfn $N $N-dark; ln -sfn $N $N-light
ln -sfn $N-top $N-top-dark; ln -sfn $N-top $N-top-light
touch /lib/apk/db/installed
rm -f /tmp/luci-indexcache*"

# register the theme entries by running the package's own uci-defaults script —
# it is the single source of truth (two layout entries; dark/light and palette
# are client-side toggles now). PKG_UPGRADE=1 keeps it from touching the active
# theme on a fresh router.
scp -q "$D"/root/etc/uci-defaults/30_luci-theme-footstrap "$R":/tmp/30_luci-theme-footstrap
ssh "$R" "PKG_UPGRADE=1 sh /tmp/30_luci-theme-footstrap; rm -f /tmp/30_luci-theme-footstrap /tmp/luci-indexcache*"

echo "synced to $R (sidebar + top-nav registered, active theme unchanged)"
