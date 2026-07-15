#!/bin/sh
# Залить тему footstrap на роутер (ssh router).
# ОДНА тема, одна запись в luci.themes; раскладка (sidebar/top) — клиентская
# настройка в поповере Appearance, а не запись темы. Регистрирует, НЕ активирует.
set -e

R="${1:-router}"
N=footstrap
D="$(cd "$(dirname "$0")" && pwd)"

# cascade.css is generated from styles/ and is not in git. --dev keeps the comments so the
# file on the router still reads like the source.
"$D"/build-css.sh "$D/htdocs/luci-static/$N/cascade.css" --dev

ssh "$R" "mkdir -p /usr/share/ucode/luci/template/themes/$N \
	/www/luci-static/$N \
	/www/luci-static/resources/view/status/include"

# the ONE template (+ partials/). Sidebar and top bar are the same markup, morphed by
# :root[data-layout] — there is no second theme dir to copy.
scp -q  "$D"/ucode/template/themes/$N/*.ut      "$R":/usr/share/ucode/luci/template/themes/$N/
ssh "$R" "mkdir -p /usr/share/ucode/luci/template/themes/$N/partials"
scp -q  "$D"/ucode/template/themes/$N/partials/*.ut "$R":/usr/share/ucode/luci/template/themes/$N/partials/

# shared static (cascade.css, fonts, logo)
scp -qr "$D"/htdocs/luci-static/$N/* "$R":/www/luci-static/$N/

# EVERY resource JS, by GLOB — never by name. This used to list the four files
# individually, so a FIFTH would be shipped by the package (luci.mk copies htdocs/
# wholesale) yet silently never reach the dev router — first tested after a release.
scp -q  "$D"/htdocs/luci-static/resources/*.js "$R":/www/luci-static/resources/
scp -q  "$D"/htdocs/luci-static/resources/view/status/include/*.js \
	"$R":/www/luci-static/resources/view/status/include/

# stamp the git-derived version into the deployed fs-update.js (the package does the same in
# Build/Prepare) so the popover shows a real version and the update check works here. The FILE NAME
# is part of the contract: FS_VERSION lives in fs-update.js and moving it means changing both seds.
FS_V="$(git -C "$D" describe --tags --always 2>/dev/null | sed 's/^v//')"
# if-form, not `[ -n ] && ssh`: under set -e a failed &&-list aborts the whole sync when git
# describe yields nothing (a copied tree without .git). expr refuses a tag with
# sed/shell-special characters rather than interpolating it.
if [ -n "$FS_V" ] && expr "$FS_V" : '[0-9A-Za-z._-]*$' >/dev/null; then
	ssh "$R" "sed -i \"s#const FS_VERSION = '[^']*'#const FS_VERSION = '$FS_V'#\" /www/luci-static/resources/fs-update.js"
fi

# The catalogue, which the PACKAGE compiles in Build/Prepare. po2lmo is a luci-base host tool,
# absent from a dev machine by default, so this is best-effort: without it the strings stay
# English and the sync still succeeds. (Build it once from the pinned luci commit: cc -o po2lmo
# po2lmo.c lib/lmo.c lib/plural_formula.c.) Same basename as the package — see the Makefile.
if command -v po2lmo >/dev/null 2>&1; then
	ssh "$R" "mkdir -p /usr/lib/lua/luci/i18n"
	for po in "$D"/i18n/*/*.po; do
		[ -e "$po" ] || continue
		lang="$(basename "$(dirname "$po")")"
		po2lmo "$po" "/tmp/footstrap-theme.$lang.lmo"
		scp -q "/tmp/footstrap-theme.$lang.lmo" "$R":/usr/lib/lua/luci/i18n/
		rm -f "/tmp/footstrap-theme.$lang.lmo"
	done
else
	echo "  (po2lmo not found — skipping the translation catalogue; strings stay English)"
fi

# root/usr -> /usr as a TREE, never as a list of names. luci.mk installs root/ wholesale, so a
# file named here one-by-one is a file that ships in the package and silently never reaches the
# dev router — first noticed after a release. This directory now carries three unrelated things
# (the self-update backend, its rpcd ACL, the release public key), and the next one must arrive
# for free. tar, not `scp -r`, because scp's merge semantics on an existing /usr are ambiguous.
tar -C "$D/root" -cf - usr | ssh "$R" "tar -C / -xf -"
ssh "$R" "chmod +x /usr/libexec/footstrap-selfupdate.sh; /etc/init.d/rpcd reload 2>/dev/null; rm -f /tmp/luci-indexcache*"

ssh "$R" "
# Sweep every pre-consolidation name, INCLUDING $N-top: the top bar is not a theme any more,
# so a stale mediaurlbase pointing at its media dir would still render a theme LuCI no longer
# lists.
#
# rm -rf, not rm -f: these are DIRECTORIES (and $N-top a SYMLINK to one, which rm -rf removes
# as the link, not its target). \`rm -f\` refuses a directory, 2>/dev/null swallowed the error
# and this block runs without set -e — so the sweep silently did nothing. Every path is a
# literal built from \$N: no glob, no user input.
cd /www/luci-static
rm -rf $N/$N $N-top $N-dark $N-light $N-top-dark $N-top-light
cd /usr/share/ucode/luci/template/themes
rm -rf $N/$N $N-top $N-dark $N-light $N-top-dark $N-top-light
touch /lib/apk/db/installed
rm -f /tmp/luci-indexcache*"

# Register by running the package's own uci-defaults script — the single source of truth
# (ONE entry, luci.themes.Footstrap; layout, mode and palette are client-side toggles).
# PKG_UPGRADE=1 forces its upgrade branch, so the dev router's active theme is left alone.
scp -q "$D"/root/etc/uci-defaults/30_luci-theme-footstrap "$R":/tmp/30_luci-theme-footstrap
ssh "$R" "PKG_UPGRADE=1 sh /tmp/30_luci-theme-footstrap; rm -f /tmp/30_luci-theme-footstrap /tmp/luci-indexcache*"

echo "synced to $R (single Footstrap theme registered, active theme unchanged)"
