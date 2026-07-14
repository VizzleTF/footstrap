#!/bin/sh
# luci-theme-footstrap installer for OpenWrt 24.10 (ipk) and 25.12+ (apk).
#
# One-line install (run on the router over SSH):
#   wget -qO- https://raw.githubusercontent.com/VizzleTF/luci-theme-footstrap/main/install.sh | sh
# or:
#   curl -fsSL https://raw.githubusercontent.com/VizzleTF/luci-theme-footstrap/main/install.sh | sh
#
# Optional: pin a release tag ->  ... | sh -s v0.3.1
#
# Detects the OpenWrt release and its package manager, then installs the matching asset
# from the latest (or given) GitHub release: .apk on 25.12+, .ipk on 24.10. ONE package —
# the theme carries its own .lmo catalogue. Licensed Apache-2.0.

set -e

REPO="VizzleTF/luci-theme-footstrap"
TAG="${1:-latest}"

# mktemp, not a fixed /tmp name: /tmp is 1777, so a local unprivileged process can pre-create a
# predictable name as a symlink and root writes the downloaded package through it (CWE-377).
TMP="$(mktemp -d)" || { printf '[-] cannot create a temp dir\n' >&2; exit 1; }
trap 'rm -rf "$TMP"' EXIT INT TERM

info() { printf '[*] %s\n' "$1"; }
ok()   { printf '[+] %s\n' "$1"; }
warn() { printf '[!] %s\n' "$1"; }
err()  { printf '[-] %s\n' "$1" >&2; }

printf '\n================================================\n'
printf '    luci-theme-footstrap installer\n'
printf '    LuCI theme for OpenWrt 24.10 / 25.12+\n'
printf '================================================\n\n'

# --- detect OpenWrt + require >= 24.10 -----------------------------------
if [ -f /etc/openwrt_release ]; then
	. /etc/openwrt_release 2>/dev/null || true
	ok "Detected: ${DISTRIB_DESCRIPTION:-OpenWrt}"
else
	warn "This does not look like OpenWrt — continuing anyway."
fi

# Refuse clearly-too-old releases (the theme needs the ucode theme engine + modern CSS of
# 24.10+). SNAPSHOT / empty / non-numeric versions are allowed through.
case "${DISTRIB_RELEASE:-}" in
	''|*SNAPSHOT*) : ;;
	*)
		_maj=$(printf '%s' "$DISTRIB_RELEASE" | cut -d. -f1)
		_min=$(printf '%s' "$DISTRIB_RELEASE" | cut -d. -f2)
		case "$_maj$_min" in
			*[!0-9]*|'') : ;;	# unparseable -> don't block
			*)
				if [ "$_maj" -lt 24 ] || { [ "$_maj" -eq 24 ] && [ "$_min" -lt 10 ]; }; then
					err "footstrap requires OpenWrt 24.10 or newer (detected $DISTRIB_RELEASE)."
					exit 1
				fi
				;;
		esac
		;;
esac

# --- pick package manager / asset format ---------------------------------
if command -v apk >/dev/null 2>&1; then
	PM="apk"; EXT="apk"
elif command -v opkg >/dev/null 2>&1; then
	PM="opkg"; EXT="ipk"
else
	err "Neither apk nor opkg found — cannot install a package."
	exit 1
fi
ok "Package manager: $PM (installing .$EXT)"

# --- downloader -----------------------------------------------------------
# fetch <url> <max-seconds> [outfile]  — stdout when no outfile.
#
# EVERY fetch VERIFIES THE CERTIFICATE. This runs as root from `curl | sh` and installs what it
# downloads --allow-untrusted (no package signature), so this TLS channel plus the sha256 below
# ARE the trust chain. Never `-k` / `--no-check-certificate`, not even as a retry: a failed
# verification IS the MITM case, and `ca-bundle` is in OpenWrt's DEFAULT_PACKAGES, so the
# insecure path buys nothing.
#
# Signature pinned to footstrap-selfupdate.sh's fetch(): the two cannot share a file (this one
# runs before the package exists) and had already drifted — this one took (url, outfile),
# hardcoded --max-time on curl, and gave uclient-fetch, its FIRST choice on OpenWrt, no timeout.
# wget is the last resort (non-OpenWrt); GNU wget follows https -> http redirects, hence
# --https-only where the flag exists.
#
# @mirror gh/fetch
fetch() {
	_u="$1"; _t="$2"; _o="$3"
	if command -v uclient-fetch >/dev/null 2>&1; then
		if [ -n "$_o" ]; then uclient-fetch -T "$_t" -qO "$_o" "$_u" 2>/dev/null
		else uclient-fetch -T "$_t" -qO- "$_u" 2>/dev/null; fi
		return $?
	fi
	if command -v curl >/dev/null 2>&1; then
		if [ -n "$_o" ]; then
			curl -fsSL --proto =https --proto-redir =https --connect-timeout 10 --max-time "$_t" -o "$_o" "$_u" 2>/dev/null
		else
			curl -fsSL --proto =https --proto-redir =https --connect-timeout 10 --max-time "$_t" "$_u" 2>/dev/null
		fi
		return $?
	fi
	if command -v wget >/dev/null 2>&1; then
		_s=''
		wget --help 2>&1 | grep -q -- '--https-only' && _s='--https-only'
		if [ -n "$_o" ]; then wget -q $_s -T "$_t" -O "$_o" "$_u"
		else wget -q $_s -T "$_t" -O- "$_u"; fi
		return $?
	fi
	return 1
}
# @endmirror

# The URL comes out of the API answer and the file it names is handed to `apk add
# --allow-untrusted` as root. Pin the host, so a malformed or tampered response cannot point
# that install at an arbitrary server.
# @mirror gh/asset-host
asset_host_ok() {
	case "$1" in
		https://github.com/*|https://objects.githubusercontent.com/*|https://release-assets.githubusercontent.com/*) return 0 ;;
	esac
	return 1
}
# @endmirror

# Pick the asset by package NAME, not by extension. `grep "\.apk$" | head -n1` — what this did —
# takes whichever asset GitHub lists first, and the API sorts assets BY NAME: in v0.8.4, when the
# release still carried separate luci-i18n-footstrap-<lang> packages, that was a 6 KB catalogue
# installed in place of the theme (issue #6). Releases hold ONE package per format now; the name
# match is the fix for the next such mistake.
#
# `[-_]` is the separator both naming schemes use and is what keeps the two names apart (apk:
# `name-1.2.3-r1.apk`, ipk: `name_1.2.3-r1_all.ipk`); anchoring on `/` in front stops a repo or
# tag containing the package name from matching.
#
# @mirror gh/asset-urls
asset_urls() {		# <json> <package-name> -> every matching asset URL, one per line
	jsonfilter -i "$1" -e '@.assets[*].browser_download_url' 2>/dev/null \
		| grep -E "/$2[-_][^/]*\.$EXT\$" || true
}
asset_digest() {	# <json> <url> -> the sha256 GitHub publishes for THAT asset
	# matched on the URL rather than on list position — the two `assets[*]` lists
	# happen to be parallel today, but nothing promises it
	jsonfilter -i "$1" -e "@.assets[@.browser_download_url=\"$2\"].digest" 2>/dev/null | head -n1
}
# @endmirror

# --- resolve the assets ---------------------------------------------------
if [ "$TAG" = "latest" ]; then
	API="https://api.github.com/repos/$REPO/releases/latest"
else
	API="https://api.github.com/repos/$REPO/releases/tags/$TAG"
fi

info "Resolving release ($TAG)..."
JSON="$TMP/release.json"
if ! fetch "$API" 20 "$JSON" || [ ! -s "$JSON" ]; then
	err "Could not reach the GitHub release API."
	err "If it is a TLS/cert error, install the CA bundle:"
	if [ "$PM" = "apk" ]; then err "  apk add ca-bundle   (then re-run)"; else err "  opkg update && opkg install ca-bundle   (then re-run)"; fi
	exit 1
fi

# jsonfilter (OpenWrt base image) is what reads the sha256 out of the API answer — without it
# there is no integrity check at all, only unverifiable bytes handed to root. Refuse, don't
# fall back.
command -v jsonfilter >/dev/null 2>&1 || {
	err "jsonfilter not found — it is part of OpenWrt's base image."
	err "This installer only supports OpenWrt."
	exit 1
}

THEME_URL=$(asset_urls "$JSON" luci-theme-footstrap | head -n1)
if [ -z "$THEME_URL" ]; then
	err "Could not find a luci-theme-footstrap .$EXT asset for release '$TAG'."
	err "Check releases: https://github.com/$REPO/releases"
	exit 1
fi

# ONE package per format per release, catalogue bundled inside the theme package: the release must
# stay pickable by the self-updater a router ALREADY runs, which takes the first asset of its
# extension and cannot be fixed remotely — see the Makefile note and issue #6.

# --- download, verify, install --------------------------------------------
# --allow-untrusted = NO package signature, so the sha256 the API publishes for the asset is the
# only integrity check there is. Same TLS channel as the URL, so it is no defence against a
# compromised api.github.com; it IS one against a tampered or truncated download from the asset
# CDN, a different host. A MISSING digest is a REFUSAL, not a warning: half of a two-link trust
# chain cannot be optional, and whatever empties it (a renamed field, an unexpected answer) leaves
# us installing bytes we cannot account for. FOOTSTRAP_ALLOW_UNVERIFIED=1 overrides — deliberately
# something you have to type.
install_asset() {
	_url="$1"
	_name=$(basename "$_url")
	_pkg="$TMP/$_name"

	asset_host_ok "$_url" || { err "Refusing an asset from an unexpected host: $_url"; exit 1; }

	info "Downloading $_name..."
	if ! fetch "$_url" 600 "$_pkg" || [ ! -s "$_pkg" ]; then
		err "Download failed. If it is a TLS/cert error, install the CA bundle:"
		if [ "$PM" = "apk" ]; then err "  apk add ca-bundle   (then re-run)"; else err "  opkg update && opkg install ca-bundle   (then re-run)"; fi
		exit 1
	fi

	_digest=$(asset_digest "$JSON" "$_url")
	if [ -z "$_digest" ] || ! command -v sha256sum >/dev/null 2>&1; then
		if [ "${FOOTSTRAP_ALLOW_UNVERIFIED:-0}" = "1" ]; then
			warn "No sha256 for $_name — installing UNVERIFIED because FOOTSTRAP_ALLOW_UNVERIFIED=1."
		else
			err "No sha256 available for $_name — refusing to install."
			err "The package is installed with --allow-untrusted, so this checksum is the"
			err "only integrity check there is."
			err "To override anyway:  FOOTSTRAP_ALLOW_UNVERIFIED=1 sh install.sh"
			exit 1
		fi
	else
		_want="${_digest#sha256:}"
		_got=$(sha256sum "$_pkg" | cut -d' ' -f1)
		if [ "$_want" != "$_got" ]; then
			err "Checksum MISMATCH for $_name — refusing to install."
			err "  expected $_want"
			err "  got      $_got"
			exit 1
		fi
		ok "sha256 verified: $_name ($(wc -c < "$_pkg") bytes)"
	fi

	info "Installing $_name with $PM..."
	if [ "$PM" = "apk" ]; then
		apk add --allow-untrusted "$_pkg"
	else
		# local .ipk; luci-base is on any LuCI system already, so no repo fetch is needed.
		opkg install "$_pkg"
	fi
	rm -f "$_pkg"
}

install_asset "$THEME_URL"

# BOTH caches, as postinst/postrm/uci-defaults do: dropping only the index cache left a stale
# /tmp/luci-modulecache, which bites exactly here — a package that replaces the theme's JS.
rm -f /tmp/luci-indexcache* 2>/dev/null || true
rm -rf /tmp/luci-modulecache 2>/dev/null || true

# reload, NOT restart: rpcd keeps sessions in memory, so restart logs out every LuCI user. SIGHUP
# (reload) re-reads /usr/share/rpcd/acl.d/*, which is all this package needs — verified live:
# removing our ACL + reload flips `session access` to false, and a session survives a reload.
if [ -x /etc/init.d/rpcd ]; then
	info "Reloading rpcd..."
	/etc/init.d/rpcd reload >/dev/null 2>&1 || true
fi

printf '\n'
ok "luci-theme-footstrap installed (translations included)."
info "Select \"Footstrap\" in System -> System -> Language and Style -> \"Design\"."
info "Layout (sidebar / top bar), dark mode, palette, tint and accent all live in"
info "the \"Appearance\" popover in the menu — they are per-browser, not per-router."
info "Then hard-reload the page (Ctrl+F5)."
