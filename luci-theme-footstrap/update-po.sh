#!/bin/sh
# Regenerate po/templates/footstrap.pot from the theme sources and merge it into every
# po/<lang>/footstrap.po. Run it after adding or changing ANY _('…') string.
#
#   ./update-po.sh            rescan, merge, report what is still untranslated
#   ./update-po.sh --check    change nothing; fail if the .pot is stale or a string is
#                             untranslated. This is the CI gate.
#
# WHY THIS EXISTS AT ALL. The theme's strings were wrapped in _() from the start, but
# there was no po/ directory — and luci.mk derives LUCI_LANGUAGES from `po/*`, so no
# language package was ever built. Every _() therefore fell through to its English
# msgid: the Appearance popover said "Palette"/"Rounding"/"Cats" on a LuCI running in
# Russian, and nothing anywhere reported a problem. A translation that is never compiled
# fails silently by construction, which is exactly why the --check mode is a gate and
# not a suggestion.
#
# Nothing here runs on the buildbot: luci.mk finds po/ and calls po2lmo itself. This
# script is for the developer and for CI, and needs perl + gettext (xgettext, msgmerge,
# msgfmt), none of which the OpenWrt build needs.
#
# The scanner is LuCI's OWN build/i18n-scan.pl, not a hand-rolled grep: it knows how to
# lex a .ut template (it rewrites the template into JavaScript before handing it to
# xgettext) and it already covers .js and the rpcd acl.d/*.json titles. A grep for
# _('…') would miss the ACL description and would trip over any apostrophe in a string.
set -eu

cd "$(dirname "$0")"

SCANNER_URL='https://raw.githubusercontent.com/openwrt/luci/master/build/i18n-scan.pl'
POT='po/templates/footstrap.pot'
CHECK=0
[ "${1:-}" = '--check' ] && CHECK=1

for tool in perl xgettext msgmerge msgfmt; do
	command -v "$tool" >/dev/null || { echo "update-po: $tool not found (install perl + gettext)" >&2; exit 1; }
done

# Prefer a scanner from a local LuCI checkout ($LUCI_SRC), so the gate is not hostage to
# the network; fall back to fetching it. jsmin.c is pinned the same way in CI.
scanner=''
if [ -n "${LUCI_SRC:-}" ] && [ -f "$LUCI_SRC/build/i18n-scan.pl" ]; then
	scanner="$LUCI_SRC/build/i18n-scan.pl"
else
	scanner="$(mktemp)"
	trap 'rm -f "$scanner"' EXIT
	curl -sfL "$SCANNER_URL" -o "$scanner" || {
		echo "update-po: cannot fetch $SCANNER_URL — set LUCI_SRC to a luci checkout" >&2
		exit 1
	}
fi

mkdir -p po/templates
fresh="$(mktemp)"
# htdocs = the theme JS, ucode = the templates, root = the rpcd ACL title
perl "$scanner" htdocs ucode root > "$fresh"

if [ "$CHECK" = 1 ]; then
	# Compare msgids only. Line-number comments churn on every edit and say nothing
	# about whether a string is missing.
	old_ids="$(mktemp)"; new_ids="$(mktemp)"
	grep '^msgid' "$POT" | sort > "$old_ids"
	grep '^msgid' "$fresh" | sort > "$new_ids"
	if ! cmp -s "$old_ids" "$new_ids"; then
		echo "update-po: $POT is STALE — a string was added or removed without rerunning ./update-po.sh" >&2
		diff "$old_ids" "$new_ids" | grep '^[<>]' >&2 || true
		rm -f "$fresh" "$old_ids" "$new_ids"
		exit 1
	fi
	rm -f "$fresh" "$old_ids" "$new_ids"

	rc=0
	for po in po/*/*.po; do
		[ -e "$po" ] || continue
		# an empty msgstr means the string renders in English for that language
		missing="$(msgfmt --statistics -o /dev/null "$po" 2>&1 | grep -o '[0-9]* untranslated' || true)"
		if [ -n "$missing" ]; then
			echo "update-po: $po has $missing message(s) — they will silently render in English" >&2
			rc=1
		fi
		msgfmt --check -o /dev/null "$po" || rc=1
	done
	[ "$rc" = 0 ] && echo "i18n: .pot current, every string translated"
	exit "$rc"
fi

mv "$fresh" "$POT"
echo "scanned -> $POT ($(grep -c '^msgid' "$POT") strings)"

for po in po/*/*.po; do
	[ -e "$po" ] || continue
	msgmerge --quiet --update --backup=none "$po" "$POT"
	echo "merged  -> $po: $(msgfmt --statistics -o /dev/null "$po" 2>&1 | tr '\n' ' ')"
done
