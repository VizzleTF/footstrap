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
# matching asset from the latest (or given) GitHub release: .apk for apk-based
# systems (25.12+), .ipk for opkg-based systems (24.10). Licensed Apache-2.0.

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

PKG="$TMP/luci-theme-footstrap.$EXT"

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

# --- resolve the asset url ------------------------------------------------
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

# jsonfilter is in OpenWrt's base image, so this is the normal path. The grep
# fallback exists only for a non-OpenWrt box; it is scoped to browser_download_url
# (the old code grepped the WHOLE payload for any github URL ending in .apk, which
# would happily match a URL inside a release BODY that anyone can write).
if command -v jsonfilter >/dev/null 2>&1; then
	ASSET_URL=$(jsonfilter -i "$JSON" -e '@.assets[*].browser_download_url' | grep -E "\.$EXT\$" | head -n1 || true)
	# the digest of THAT asset, matched on the URL rather than on list position —
	# the two `assets[*]` lists happen to be parallel today, but nothing promises it
	DIGEST=$(jsonfilter -i "$JSON" -e "@.assets[@.browser_download_url=\"$ASSET_URL\"].digest" 2>/dev/null | head -n1 || true)
else
	ASSET_URL=$(grep -o "\"browser_download_url\": *\"[^\"]*\.$EXT\"" "$JSON" | grep -o 'https://[^"]*' | head -n1 || true)
	DIGEST=""
fi

if [ -z "$ASSET_URL" ]; then
	err "Could not find a .$EXT asset for release '$TAG'."
	err "Check releases: https://github.com/$REPO/releases"
	exit 1
fi
asset_host_ok "$ASSET_URL" || { err "Refusing an asset from an unexpected host: $ASSET_URL"; exit 1; }
ok "Found: $ASSET_URL"

# --- download -------------------------------------------------------------
info "Downloading package..."
if ! fetch "$ASSET_URL" 600 "$PKG" || [ ! -s "$PKG" ]; then
	err "Download failed. If it is a TLS/cert error, install the CA bundle:"
	if [ "$PM" = "apk" ]; then err "  apk add ca-bundle   (then re-run)"; else err "  opkg update && opkg install ca-bundle   (then re-run)"; fi
	exit 1
fi
ok "Downloaded $(wc -c < "$PKG") bytes."

# --- verify ---------------------------------------------------------------
# The package is about to be installed as root with --allow-untrusted, i.e. with
# no package signature to fall back on — so the sha256 the API publishes for the
# asset is the only integrity check there is. It comes over the same TLS channel
# as the URL, so it does not defend against a compromised api.github.com; what it
# does defend against is a truncated or tampered download from the asset CDN,
# which is a different host. Do not skip it silently.
if [ -n "$DIGEST" ] && command -v sha256sum >/dev/null 2>&1; then
	WANT="${DIGEST#sha256:}"
	GOT=$(sha256sum "$PKG" | cut -d' ' -f1)
	if [ "$WANT" != "$GOT" ]; then
		err "Checksum MISMATCH — refusing to install."
		err "  expected $WANT"
		err "  got      $GOT"
		exit 1
	fi
	ok "sha256 verified."
else
	warn "No sha256 published for this asset — installing unverified."
fi

# --- install --------------------------------------------------------------
info "Installing with $PM..."
if [ "$PM" = "apk" ]; then
	apk add --allow-untrusted "$PKG"
else
	# local .ipk: opkg installs it directly; luci-base is already present on any
	# LuCI system, so no repo fetch is needed.
	opkg install "$PKG"
fi

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
info "Select \"Footstrap\" in System -> System -> Language and Style -> \"Design\"."
info "Layout (sidebar / top bar), dark mode, palette, tint and accent all live in"
info "the \"Appearance\" popover in the menu — they are per-browser, not per-router."
info "Then hard-reload the page (Ctrl+F5)."
