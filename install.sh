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
# Detects the OpenWrt release and its package manager, then downloads the
# matching assets from the latest (or given) GitHub release: .apk for apk-based
# systems (25.12+), .ipk for opkg-based systems (24.10). Licensed Apache-2.0.
#
# It installs the theme AND its luci-i18n-footstrap-<lang> translation packages.
# The catalogue is not optional decoration: without the .lmo on the router, every
# _() in the theme renders its English msgid and nothing reports it — the Appearance
# popover said "Palette"/"Rounding"/"Cats" on a fully Russian LuCI (issue #6).
# FOOTSTRAP_NO_I18N=1 installs the theme alone.

set -e

REPO="VizzleTF/luci-theme-footstrap"
TAG="${1:-latest}"

# mktemp, not a fixed /tmp/footstrap-install: /tmp is 1777, so any local
# unprivileged process can pre-create that predictable name as a symlink and this
# script — running as root — would write the downloaded package through it to a
# file of the attacker's choosing (CWE-377). footstrap-selfupdate.sh already
# avoids exactly this; the installer did not.
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

# Refuse clearly-too-old releases (theme needs the ucode theme engine + modern
# CSS shipped by 24.10+). SNAPSHOT / empty / non-numeric versions are allowed.
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
# Prefer tools that speak HTTPS on OpenWrt; fall back through what's present.
# $1 = url, $2 = output file (omit for stdout).
#
# EVERY fetch below VERIFIES THE CERTIFICATE. This script is piped from the
# internet into `sh` as root and the thing it downloads is installed as a root
# package, so the TLS channel is the entire trust chain (together with the sha256
# check further down). It used to retry with `--no-check-certificate` / `-k` after
# ANY failure of the verified attempt — which includes a MITM presenting a bogus
# cert — and the "install the CA bundle" hint below was therefore unreachable in
# the one case it was written for. `ca-bundle` is in OpenWrt's DEFAULT_PACKAGES,
# so the insecure path bought nothing on a stock router and silently disarmed the
# check on a broken one. Do not add a `-k` fallback back.
# fetch <url> <max-seconds> [outfile]  — stdout when no outfile.
# Same signature as footstrap-selfupdate.sh's fetch(), deliberately: the two are mirrors of
# each other (see the @mirror note below) and a differing signature is how they drifted in the
# first place — this one used to take (url, outfile), hardcode --max-time on the curl branch
# and give uclient-fetch, its FIRST choice on OpenWrt, no timeout at all.
# Last resort in the chain below is wget, effectively the non-OpenWrt path (an OpenWrt box has
# uclient-fetch, and its /usr/bin/wget is usually the same applet). GNU wget follows an
# https -> http redirect by default, so ask for --https-only where it exists; a wget without
# the flag is busybox's, which we would not have reached on the boxes that ship one.
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

# The package is downloaded from a URL read out of the API answer and then handed
# to `apk add --allow-untrusted` as root. Pin the host, so a malformed or tampered
# response cannot point that install at an arbitrary server.
# @mirror gh/asset-host
asset_host_ok() {
	case "$1" in
		https://github.com/*|https://objects.githubusercontent.com/*|https://release-assets.githubusercontent.com/*) return 0 ;;
	esac
	return 1
}
# @endmirror

# A release carries the THEME package and one luci-i18n-footstrap-<lang> package per
# translation, so an asset has to be picked by package NAME. Matching on the extension
# alone — `grep "\.apk$" | head -n1`, which is what this did — takes whichever asset
# GitHub happens to list first, and once the language packages existed that could be a
# 6 KB catalogue installed in place of the theme.
#
# `[-_]` right after the name is the separator both naming schemes use and it is what
# keeps the two names apart (apk: `name-1.2.3-r1.apk`, ipk: `name_1.2.3-r1_all.ipk`);
# anchoring on `/` in front means a repo or a tag that contains the package name cannot
# match either.
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

# jsonfilter is in OpenWrt's base image (this installer only ever runs on a router), and
# it is what reads the sha256 out of the API answer — so without it there is no integrity
# check at all and the install below is unverifiable bytes handed to root. Refuse, rather
# than fall back to grepping the payload: the old fallback could only ever reach the
# "no sha256 — refusing to install" branch anyway.
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

# The translation packages. Every one of them, not the one language the router happens to
# be set to today: a .lmo is a few KB, LuCI only loads the catalogue for the language it is
# actually running in, and gating on `uci get luci.main.lang` would install nothing on the
# stock router — its default is `auto`, which means "whatever the browser asks for", i.e.
# potentially any of them. Without the catalogue every _() in the theme silently renders its
# English msgid (issue #6). FOOTSTRAP_NO_I18N=1 skips them.
#
# NOT `[ … ] && I18N_URLS=""`: with `set -e` an AND-list whose test fails is itself a
# failing command at top level, and the installer would exit right here — on the normal
# path, where FOOTSTRAP_NO_I18N is unset.
I18N_URLS=$(asset_urls "$JSON" luci-i18n-footstrap)
if [ "${FOOTSTRAP_NO_I18N:-0}" = "1" ]; then
	I18N_URLS=""
	info "Skipping the translation packages (FOOTSTRAP_NO_I18N=1)."
fi

# --- download, verify, install --------------------------------------------
# Each package is installed as root with --allow-untrusted, i.e. with no package signature
# to fall back on — so the sha256 the API publishes for the asset is the only integrity
# check there is. It comes over the same TLS channel as the URL, so it does not defend
# against a compromised api.github.com; what it does defend against is a truncated or
# tampered download from the asset CDN, which is a different host.
#
# A missing digest is therefore a REFUSAL, not a warning. Half of a two-link trust chain
# cannot be optional: whatever makes the digest empty — GitHub renaming the field, the API
# answer not being what we think it is — leaves us installing bytes we cannot account for,
# and printing a line about it into a `curl | sh` scroll changes nothing about that. Set
# FOOTSTRAP_ALLOW_UNVERIFIED=1 to override; it is deliberately something you have to type.
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
		# local .ipk: opkg installs it directly; luci-base is already present on any
		# LuCI system, so no repo fetch is needed.
		opkg install "$_pkg"
	fi
	rm -f "$_pkg"
}

# The theme first: the language packages DEPEND on it.
install_asset "$THEME_URL"
for u in $I18N_URLS; do
	install_asset "$u"
done

# BOTH caches, as postinst/postrm/uci-defaults do. This dropped only the index cache, leaving
# /tmp/luci-modulecache behind — and a stale module cache after installing a package that
# replaces the theme's JS is the one case where it actually bites.
rm -f /tmp/luci-indexcache* 2>/dev/null || true
rm -rf /tmp/luci-modulecache 2>/dev/null || true

# reload, NOT restart: rpcd keeps its sessions in memory, so a restart logs every
# LuCI user out. SIGHUP (what `reload` sends) re-reads /usr/share/rpcd/acl.d/*,
# which is all this package's ACL needs — verified on a live router: removing the
# ACL file and reloading flips `session access` for the script to false, and a
# session created before the reload survives it.
if [ -x /etc/init.d/rpcd ]; then
	info "Reloading rpcd..."
	/etc/init.d/rpcd reload >/dev/null 2>&1 || true
fi

printf '\n'
ok "luci-theme-footstrap installed."
if [ -n "$I18N_URLS" ]; then
	ok "Translations installed. The theme follows the language set in"
	info "System -> System -> Language and Style -> \"Language\"."
fi
info "Select \"Footstrap\" in System -> System -> Language and Style -> \"Design\"."
info "Layout (sidebar / top bar), dark mode, palette, tint and accent all live in"
info "the \"Appearance\" popover in the menu — they are per-browser, not per-router."
info "Then hard-reload the page (Ctrl+F5)."
