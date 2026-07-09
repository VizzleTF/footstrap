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
scp -q  "$D"/htdocs/luci-static/resources/menu-$N.js        "$R":/www/luci-static/resources/
scp -q  "$D"/htdocs/luci-static/resources/menu-$N-top.js    "$R":/www/luci-static/resources/
scp -q  "$D"/htdocs/luci-static/resources/fs-select.js      "$R":/www/luci-static/resources/
scp -q  "$D"/htdocs/luci-static/resources/view/status/include/05_${N}_overview_layout.js \
	"$R":/www/luci-static/resources/view/status/include/

ssh "$R" "
# media symlinks (dark/light + top share the footstrap assets dir)
cd /www/luci-static
ln -sf $N $N-dark; ln -sf $N $N-light
ln -sf $N $N-top; ln -sf $N $N-top-dark; ln -sf $N $N-top-light
# template symlinks (dark/light reuse base templates per layout)
cd /usr/share/ucode/luci/template/themes
ln -sf $N $N-dark; ln -sf $N $N-light
ln -sf $N-top $N-top-dark; ln -sf $N-top $N-top-light
touch /lib/apk/db/installed
rm -f /tmp/luci-indexcache*"

# register the theme entries by running the package's own uci-defaults script —
# it is the single source of truth (two layout entries; dark/light and palette
# are client-side toggles now). PKG_UPGRADE=1 keeps it from touching the active
# theme on a fresh router.
scp -q "$D"/root/etc/uci-defaults/30_luci-theme-footstrap "$R":/tmp/30_luci-theme-footstrap
ssh "$R" "PKG_UPGRADE=1 sh /tmp/30_luci-theme-footstrap; rm -f /tmp/30_luci-theme-footstrap /tmp/luci-indexcache*"

echo "synced to $R (sidebar + top-nav registered, active theme unchanged)"
