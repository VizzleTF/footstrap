#!/bin/sh
# Rescan the theme sources into i18n/templates/footstrap.pot and merge it into every
# i18n/<lang>/footstrap.po. Run after adding or changing ANY _('…') string.
#
#   ./update-po.sh            rescan, merge, report what is still untranslated
#   ./update-po.sh --check    change nothing; fail if the .pot is stale or a string is
#                             untranslated. The CI gate.
#
# A missing translation CANNOT fail loudly — an uncompiled _() falls through to its English
# msgid and nothing reports it (the popover said "Palette"/"Rounding"/"Cats" on a Russian
# LuCI). Hence --check is a gate, not a suggestion.
#
# THE DIRECTORY IS `i18n/`, NOT `po/`, AND THAT IS LOAD-BEARING: LUCI_LANGUAGES is
# `$(wildcard po/*)`, so a po/ dir makes luci.mk emit a separate luci-i18n-footstrap-<lang>
# package per language — which broke the update button on every router in the field (issue #6;
# the long note is in the Makefile). The catalogue is bundled into the theme package instead.
#
# Nothing here runs on the buildbot — the Makefile calls po2lmo itself. This needs perl +
# gettext (xgettext, msgmerge, msgfmt), which the OpenWrt build does not.
#
# The scanner is LuCI's OWN build/i18n-scan.pl, not a grep: it lexes a .ut (rewriting the
# template into JS before xgettext) and covers the rpcd acl.d/*.json title. A grep for _('…')
# would miss the ACL string and choke on any apostrophe.
set -eu

cd "$(dirname "$0")"

# Pinned to a COMMIT, not `master`, and checksummed: a perl script we fetch over the network
# and then EXECUTE, and the gate deciding whether the catalogue is complete. Off a moving
# branch, the gate is whatever upstream pushed last. luci-upstream.pin is the single source of
# the commit and both checksums (CI sources it too) — they were once written out separately
# here and in the workflow, with nothing holding them together.
. ./luci-upstream.pin
SCANNER_URL="https://raw.githubusercontent.com/openwrt/luci/${LUCI_PIN}/build/i18n-scan.pl"
SCANNER_SHA256="$I18N_SCAN_SHA256"
POT='i18n/templates/footstrap.pot'
CHECK=0
[ "${1:-}" = '--check' ] && CHECK=1

for tool in perl xgettext msgmerge msgfmt; do
	command -v "$tool" >/dev/null || { echo "update-po: $tool not found (install perl + gettext)" >&2; exit 1; }
done

# Prefer a scanner from a local LuCI checkout ($LUCI_SRC) so the gate is not hostage to the
# network; fall back to fetching it. jsmin.c is pinned the same way in CI.
scanner=''
if [ -n "${LUCI_SRC:-}" ] && [ -f "$LUCI_SRC/build/i18n-scan.pl" ]; then
	scanner="$LUCI_SRC/build/i18n-scan.pl"
else
	scanner="$(mktemp)"
	trap 'rm -f "$scanner"' EXIT
	curl -sfL --proto '=https' --proto-redir '=https' "$SCANNER_URL" -o "$scanner" || {
		echo "update-po: cannot fetch $SCANNER_URL — set LUCI_SRC to a luci checkout" >&2
		exit 1
	}
	# the pin says WHICH script; this says it is that script and nothing else
	echo "$SCANNER_SHA256  $scanner" | sha256sum -c - >/dev/null || {
		echo "update-po: i18n-scan.pl checksum mismatch — refusing to run it" >&2
		exit 1
	}
fi

mkdir -p i18n/templates
fresh="$(mktemp)"
# htdocs = the theme JS, ucode = the templates, root = the rpcd ACL title
perl "$scanner" htdocs ucode root > "$fresh"

if [ "$CHECK" = 1 ]; then
	# Compare msgid AND msgctxt (line-number comments churn on every edit and say nothing).
	# The CONTEXT is part of the key — po2lmo hashes "ctxt\1msgid" — so a .pot carrying the
	# same msgids with the context dropped describes a different catalogue, which comparing
	# msgid alone waved through.
	old_ids="$(mktemp)"; new_ids="$(mktemp)"
	grep '^msgid\|^msgctxt' "$POT" | sort > "$old_ids"
	grep '^msgid\|^msgctxt' "$fresh" | sort > "$new_ids"
	if ! cmp -s "$old_ids" "$new_ids"; then
		echo "update-po: $POT is STALE — a string was added or removed without rerunning ./update-po.sh" >&2
		diff "$old_ids" "$new_ids" | grep '^[<>]' >&2 || true
		rm -f "$fresh" "$old_ids" "$new_ids"
		exit 1
	fi
	rm -f "$fresh" "$old_ids" "$new_ids"

	rc=0
	for po in i18n/*/*.po; do
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

for po in i18n/*/*.po; do
	[ -e "$po" ] || continue
	msgmerge --quiet --update --backup=none "$po" "$POT"
	echo "merged  -> $po: $(msgfmt --statistics -o /dev/null "$po" 2>&1 | tr '\n' ' ')"
done
