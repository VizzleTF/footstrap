#!/bin/sh
# Rescan the updater sources into i18n/templates/footstrap-updater.pot and merge into every
# i18n/<lang>/footstrap-updater.po. Run after adding or changing any _('…') string in fs-update.js
# or the ACL description.
#
#   ./update-po.sh            rescan, merge, report what is still untranslated
#   ./update-po.sh --check    change nothing; fail if the .pot is stale or a string is untranslated.
#
# Same shape and rationale as the theme's update-po.sh (see the long notes there): a missing
# translation renders silently in English, so --check is a gate. The catalogue is bundled into THIS
# package (i18n/, not po/) so the release carries one asset per format — a per-language package would
# re-open issue #6 for fielded self-updaters. Scans htdocs (fs-update.js) and root (the rpcd ACL
# title); there is no ucode dir here.
set -eu

cd "$(dirname "$0")"

# luci-upstream.pin is the one source of the luci commit + scanner checksum, and WHICH repo this
# package sits in decides where it is: at the root in the updater's own repo, inside the theme package
# dir while the theme repo builds the transition release. Both are tried rather than one being picked,
# so this file stays identical in the two checkouts — the alternative is a one-line divergence that
# nothing can pin and that breaks the i18n gate in whichever repo was edited second.
_pin=''
for _p in ../luci-upstream.pin ../luci-theme-footstrap/luci-upstream.pin; do
	[ -f "$_p" ] && { _pin="$_p"; break; }
done
[ -n "$_pin" ] || { echo "update-po: luci-upstream.pin not found (looked beside and in the theme package)" >&2; exit 1; }
. "$_pin"
SCANNER_URL="https://raw.githubusercontent.com/openwrt/luci/${LUCI_PIN}/build/i18n-scan.pl"
SCANNER_SHA256="$I18N_SCAN_SHA256"
POT='i18n/templates/footstrap-updater.pot'
CHECK=0
[ "${1:-}" = '--check' ] && CHECK=1

for tool in perl xgettext msgmerge msgfmt; do
	command -v "$tool" >/dev/null || { echo "update-po: $tool not found (install perl + gettext)" >&2; exit 1; }
done

fetched=''; fresh=''; old_ids=''; new_ids=''
# shellcheck disable=SC2064
trap 'rm -f "$fetched" "$fresh" "$old_ids" "$new_ids"' EXIT INT TERM

scanner=''
if [ -n "${LUCI_SRC:-}" ] && [ -f "$LUCI_SRC/build/i18n-scan.pl" ]; then
	scanner="$LUCI_SRC/build/i18n-scan.pl"
else
	scanner="$(mktemp)"; fetched="$scanner"
	curl -sfL --proto '=https' --proto-redir '=https' "$SCANNER_URL" -o "$scanner" || {
		echo "update-po: cannot fetch $SCANNER_URL — set LUCI_SRC to a luci checkout" >&2
		exit 1
	}
	echo "$SCANNER_SHA256  $scanner" | sha256sum -c - >/dev/null || {
		echo "update-po: i18n-scan.pl checksum mismatch — refusing to run it" >&2
		exit 1
	}
fi

mkdir -p i18n/templates
fresh="$(mktemp)"
perl "$scanner" htdocs root > "$fresh"

if [ "$CHECK" = 1 ]; then
	old_ids="$(mktemp)"; new_ids="$(mktemp)"
	grep '^msgid\|^msgctxt' "$POT" | sort > "$old_ids"
	grep '^msgid\|^msgctxt' "$fresh" | sort > "$new_ids"
	if ! cmp -s "$old_ids" "$new_ids"; then
		echo "update-po: $POT is STALE — a string was added or removed without rerunning ./update-po.sh" >&2
		diff "$old_ids" "$new_ids" | grep '^[<>]' >&2 || true
		exit 1
	fi

	rc=0
	for po in i18n/*/*.po; do
		[ -e "$po" ] || continue
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

for po in i18n/*/*.po; do
	[ -e "$po" ] || continue
	msgmerge --quiet --update --backup=none "$po" "$POT"
	echo "merged  -> $po: $(msgfmt --statistics -o /dev/null "$po" 2>&1 | tr '\n' ' ')"
done
