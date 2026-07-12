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
TMP="/tmp/footstrap-install"

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

# --- resolve the asset url ------------------------------------------------
if [ "$TAG" = "latest" ]; then
	API="https://api.github.com/repos/$REPO/releases/latest"
else
	API="https://api.github.com/repos/$REPO/releases/tags/$TAG"
fi

info "Resolving release ($TAG)..."
ASSET_URL=$(fetch "$API" "" | grep -o "https://[^\"]*luci-theme-footstrap[^\"]*\.$EXT" | head -n1 || true)

if [ -z "$ASSET_URL" ]; then
	err "Could not find a .$EXT asset for release '$TAG'."
	err "Check releases: https://github.com/$REPO/releases"
	exit 1
fi
ok "Found: $ASSET_URL"

# --- download -------------------------------------------------------------
mkdir -p "$TMP"
info "Downloading package..."
if ! fetch "$ASSET_URL" "$PKG" || [ ! -s "$PKG" ]; then
	err "Download failed. If it is a TLS/cert error, install the CA bundle:"
	if [ "$PM" = "apk" ]; then err "  apk add ca-bundle   (then re-run)"; else err "  opkg update && opkg install ca-bundle   (then re-run)"; fi
	exit 1
fi
ok "Downloaded $(wc -c < "$PKG") bytes."

# --- install --------------------------------------------------------------
info "Installing with $PM..."
if [ "$PM" = "apk" ]; then
	apk add --allow-untrusted "$PKG"
else
	# local .ipk: opkg installs it directly; luci-base is already present on any
	# LuCI system, so no repo fetch is needed.
	opkg install "$PKG"
fi

rm -f /tmp/luci-indexcache* 2>/dev/null || true
rm -rf "$TMP" 2>/dev/null || true

# refresh rpcd so LuCI re-reads ACLs / theme registration without a reboot
if [ -x /etc/init.d/rpcd ]; then
	info "Restarting rpcd..."
	/etc/init.d/rpcd restart >/dev/null 2>&1 || true
fi

printf '\n'
ok "luci-theme-footstrap installed."
info "Select it in System -> System -> Language and Style -> \"Design\":"
info "  FootstrapSidebar  (sidebar)"
info "  FootstrapOnTop    (top-nav)"
info "Dark/light and the colour palette are in the header \"Appearance\" popover."
info "Then hard-reload the page (Ctrl+F5)."
