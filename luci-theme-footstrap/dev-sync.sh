#!/bin/sh
# Залить тему footstrap на роутер (ssh router).
# ОДНА тема, одна запись в luci.themes; раскладка (sidebar/top) — клиентская
# настройка в поповере Appearance, а не запись темы. Регистрирует, НЕ активирует.
set -e

R="${1:-router}"
N=footstrap
D="$(cd "$(dirname "$0")" && pwd)"

# cascade.css is generated from the four styles/ dirs (styles, base, theme, pages) and is
# not in git. --dev keeps the comments so the file on the router still reads like the source.
"$D"/build-css.sh "$D/htdocs/luci-static/$N/cascade.css" --dev

ssh "$R" "mkdir -p /usr/share/ucode/luci/template/themes/$N \
	/www/luci-static/$N \
	/www/luci-static/resources/view/status/include"

# the ONE template (+ partials/). Sidebar and top bar are the same markup now,
# morphed by :root[data-layout] — there is no second theme dir to copy.
scp -q  "$D"/ucode/template/themes/$N/*.ut      "$R":/usr/share/ucode/luci/template/themes/$N/
ssh "$R" "mkdir -p /usr/share/ucode/luci/template/themes/$N/partials"
scp -q  "$D"/ucode/template/themes/$N/partials/*.ut "$R":/usr/share/ucode/luci/template/themes/$N/partials/

# shared static (cascade.css, fonts, logo)
scp -qr "$D"/htdocs/luci-static/$N/* "$R":/www/luci-static/$N/

# EVERY resource JS, by glob — not by name.
#
# This used to list the four files individually (menu-*-common, menu-*, fs-select, fs-fit),
# which meant a FIFTH one would be added to the tree, shipped by the package (luci.mk copies
# htdocs/ wholesale) and silently never reach the dev router — so it would be tested only
# after a release. The package deploys by directory; so does this.
scp -q  "$D"/htdocs/luci-static/resources/*.js "$R":/www/luci-static/resources/
scp -q  "$D"/htdocs/luci-static/resources/view/status/include/*.js \
	"$R":/www/luci-static/resources/view/status/include/

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

# the translation catalogue, which the PACKAGE compiles in Build/Compile. po2lmo is a host
# tool from luci-base and is not on a dev machine by default, so this is best-effort: with it
# on $PATH the router gets the current catalogue, without it the strings stay English and the
# sync still succeeds. (Build it once from the pinned luci commit: cc -o po2lmo po2lmo.c
# lib/lmo.c lib/plural_formula.c — see luci-upstream.pin.) Same basename as the package uses.
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

# self-update backend: the exec script + its rpcd ACL (file.exec of that one path)
ssh "$R" "mkdir -p /usr/libexec /usr/share/rpcd/acl.d"
scp -q  "$D"/root/usr/libexec/footstrap-selfupdate.sh          "$R":/usr/libexec/
scp -q  "$D"/root/usr/share/rpcd/acl.d/luci-theme-footstrap.json "$R":/usr/share/rpcd/acl.d/
ssh "$R" "chmod +x /usr/libexec/footstrap-selfupdate.sh; /etc/init.d/rpcd reload 2>/dev/null; rm -f /tmp/luci-indexcache*"

ssh "$R" "
# Sweep every pre-consolidation name, INCLUDING $N-top: the top bar is not a theme
# any more, so its media symlink and its template dir must go, or the router keeps
# serving a theme LuCI no longer lists (and a stale mediaurlbase pointing at it
# would still render).
#
# rm -rf, not rm -f: these are DIRECTORIES (/www/luci-static/footstrap-dark/, and
# the matching template dirs) — and $N-top is a SYMLINK to a directory, which rm -rf
# removes as the link, not its target. \`rm -f\` refuses to remove a directory, the
# error was swallowed by 2>/dev/null, and this block runs without set -e, so the
# sweep silently did nothing. Every path here is a literal built from \$N; there is
# no glob and no user input.
cd /www/luci-static
rm -rf $N/$N $N-top $N-dark $N-light $N-top-dark $N-top-light
cd /usr/share/ucode/luci/template/themes
rm -rf $N/$N $N-top $N-dark $N-light $N-top-dark $N-top-light
touch /lib/apk/db/installed
rm -f /tmp/luci-indexcache*"

# register the theme entries by running the package's own uci-defaults script —
# it is the single source of truth (ONE entry, luci.themes.Footstrap; layout,
# dark/light and palette are all client-side toggles now). PKG_UPGRADE=1 keeps it from touching the active
# theme on a fresh router.
scp -q "$D"/root/etc/uci-defaults/30_luci-theme-footstrap "$R":/tmp/30_luci-theme-footstrap
ssh "$R" "PKG_UPGRADE=1 sh /tmp/30_luci-theme-footstrap; rm -f /tmp/30_luci-theme-footstrap /tmp/luci-indexcache*"

echo "synced to $R (single Footstrap theme registered, active theme unchanged)"
