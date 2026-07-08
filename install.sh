#!/bin/sh
# luci-theme-footstrap installer for OpenWrt 25.12+ (apk).
#
# One-line install (run on the router over SSH):
#   wget -qO- https://raw.githubusercontent.com/VizzleTF/footstrap/main/install.sh | sh
# or:
#   curl -fsSL https://raw.githubusercontent.com/VizzleTF/footstrap/main/install.sh | sh
#
# Optional: pin a release tag ->  ... | sh -s v0.2.1
#
# Downloads the latest (or given) release .apk from GitHub and installs it with
# apk. The package registers its six theme entries on first install; pick one in
# System -> System -> Language and Style (field "Design"). Licensed Apache-2.0.

set -e

REPO="VizzleTF/footstrap"
TAG="${1:-latest}"
TMP="/tmp/footstrap-install"
APK="$TMP/luci-theme-footstrap.apk"

info() { printf '[*] %s\n' "$1"; }
ok()   { printf '[+] %s\n' "$1"; }
warn() { printf '[!] %s\n' "$1"; }
err()  { printf '[-] %s\n' "$1" >&2; }

printf '\n================================================\n'
printf '    luci-theme-footstrap installer\n'
printf '    LuCI theme for OpenWrt 25.12+\n'
printf '================================================\n\n'

# --- sanity ---------------------------------------------------------------
if [ -f /etc/openwrt_release ]; then
	. /etc/openwrt_release 2>/dev/null || true
	ok "Detected: ${DISTRIB_DESCRIPTION:-OpenWrt}"
else
	warn "This does not look like OpenWrt — continuing anyway."
fi

if ! command -v apk >/dev/null 2>&1; then
	err "apk not found. This theme targets OpenWrt 25.12+ (apk only), not opkg/ipk."
	exit 1
fi

# --- downloader -----------------------------------------------------------
# Prefer tools that speak HTTPS on OpenWrt; fall back through what's present.
# $1 = url, $2 = output file (omit for stdout).
fetch() {
	_url="$1"; _out="$2"
	if command -v uclient-fetch >/dev/null 2>&1; then
		if [ -n "$_out" ]; then uclient-fetch -qO "$_out" "$_url" 2>/dev/null && return 0
		else uclient-fetch -qO- "$_url" 2>/dev/null && return 0; fi
		# retry ignoring cert issues (no ca-bundle installed)
		if [ -n "$_out" ]; then uclient-fetch --no-check-certificate -qO "$_out" "$_url" 2>/dev/null && return 0
		else uclient-fetch --no-check-certificate -qO- "$_url" 2>/dev/null && return 0; fi
	fi
	if command -v curl >/dev/null 2>&1; then
		if [ -n "$_out" ]; then curl -fsSL -k -o "$_out" "$_url" && return 0
		else curl -fsSL -k "$_url" && return 0; fi
	fi
	if command -v wget >/dev/null 2>&1; then
		if [ -n "$_out" ]; then wget -q --no-check-certificate -O "$_out" "$_url" && return 0
		else wget -q --no-check-certificate -O- "$_url" && return 0; fi
	fi
	return 1
}

# --- resolve the .apk asset url ------------------------------------------
if [ "$TAG" = "latest" ]; then
	API="https://api.github.com/repos/$REPO/releases/latest"
else
	API="https://api.github.com/repos/$REPO/releases/tags/$TAG"
fi

info "Resolving release ($TAG)..."
ASSET_URL=$(fetch "$API" "" | grep -o 'https://[^"]*luci-theme-footstrap[^"]*\.apk' | head -n1 || true)

if [ -z "$ASSET_URL" ]; then
	err "Could not find a .apk asset for release '$TAG'."
	err "Check releases: https://github.com/$REPO/releases"
	exit 1
fi
ok "Found: $ASSET_URL"

# --- download -------------------------------------------------------------
mkdir -p "$TMP"
info "Downloading package..."
if ! fetch "$ASSET_URL" "$APK" || [ ! -s "$APK" ]; then
	err "Download failed. If it is a TLS/cert error, install ca-bundle:"
	err "  apk add ca-bundle   (then re-run this script)"
	exit 1
fi
ok "Downloaded $(wc -c < "$APK") bytes."

# --- install --------------------------------------------------------------
info "Installing with apk..."
apk add --allow-untrusted "$APK"

rm -f /tmp/luci-indexcache* 2>/dev/null || true
rm -rf "$TMP" 2>/dev/null || true

printf '\n'
ok "luci-theme-footstrap installed."
info "Select it in System -> System -> Language and Style -> \"Design\":"
info "  Footstrap / FootstrapDark / FootstrapLight  (sidebar)"
info "  FootstrapTop / …Dark / …Light               (top-nav)"
info "Then hard-reload the page (Ctrl+F5)."
