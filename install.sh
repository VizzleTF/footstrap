#!/bin/sh
# luci-theme-footstrap + luci-app-footstrap-updater installer for OpenWrt 24.10 (ipk) and 25.12+ (apk).
#
# One-line install (run on the router over SSH):
#   wget -qO- https://raw.githubusercontent.com/VizzleTF/luci-theme-footstrap/main/install.sh | sh
# or:
#   curl -fsSL https://raw.githubusercontent.com/VizzleTF/luci-theme-footstrap/main/install.sh | sh
#
# Optional: pin the THEME release tag ->  ... | sh -s v0.9.3  (the updater always takes its own latest)
#
# The installer ASKS whether to install the update checker (luci-app-footstrap-updater). Force the
# answer without a prompt (scripted installs):  FOOTSTRAP_UPDATER=1 (install) / =0 (theme only).
#
# SINCE THE SPLIT the theme and the updater ship from TWO repos with their own tags: the theme from
# VizzleTF/luci-theme-footstrap, the updater from VizzleTF/luci-app-footstrap-updater. This installer
# resolves each from its own latest release and verifies both against the one release key. The theme
# is always installed; the updater is OPTIONAL and the installer asks (or FOOTSTRAP_UPDATER=1/0 decides
# non-interactively). Licensed Apache-2.0.

set -e

REPO_THEME="VizzleTF/luci-theme-footstrap"
REPO_UPDATER="VizzleTF/luci-app-footstrap-updater"
TAG="${1:-latest}"		# pins the THEME tag only; the updater always resolves its own latest

# mktemp, not a fixed /tmp name: /tmp is 1777, so a local unprivileged process can pre-create a
# predictable name as a symlink and root writes the downloaded package through it (CWE-377).
TMP="$(mktemp -d)" || { printf '[-] cannot create a temp dir\n' >&2; exit 1; }
trap 'rm -rf "$TMP"' EXIT INT TERM

info() { printf '[*] %s\n' "$1"; }
ok()   { printf '[+] %s\n' "$1"; }
warn() { printf '[!] %s\n' "$1"; }
err()  { printf '[-] %s\n' "$1" >&2; }

# Decide whether to install the update checker (the luci-app-footstrap-updater package). It is the
# WHOLE of the "check for new versions / one-click Update" feature — no package, no update controls
# in the Appearance panel, no network calls to GitHub. So the choice is: do you want update checks?
#
# ASKED INTERACTIVELY, but read from /dev/tty, NOT stdin — and that is the crux of a `curl | sh`
# installer. In the documented one-liner `wget -qO- … | sh`, the shell is reading the SCRIPT from
# stdin (the pipe), so a plain `read` would swallow the rest of the script, not the user's answer.
# /dev/tty is the controlling terminal regardless of what stdin is, so the prompt works in BOTH the
# piped form and podkop's `sh -c "$(wget -qO- …)"` form. (podkop gets away with a plain `read`
# because its `sh -c "$(…)"` invocation leaves stdin ON the terminal; reading /dev/tty is the form
# that does not depend on how the user launched us.)
#
# FOOTSTRAP_UPDATER=1/0 forces the answer with no prompt (for scripted/cron installs). With no
# terminal and no override, default to installing it — that is the historical behaviour and the
# common want, and FOOTSTRAP_UPDATER=0 is the documented way to opt out non-interactively.
want_updater() {
	case "${FOOTSTRAP_UPDATER:-}" in
		0|no|n|false|NO|N|False) return 1 ;;
		1|yes|y|true|YES|Y|True)  return 0 ;;
	esac
	if [ ! -r /dev/tty ]; then
		info "Non-interactive: installing the update checker (FOOTSTRAP_UPDATER=0 to skip)."
		return 0
	fi
	printf '[?] Install the update checker for one-click theme updates? [Y/n] ' > /dev/tty
	# read failing (EOF/no input) falls through to the default: install.
	read -r _ans < /dev/tty || { printf '\n' > /dev/tty; return 0; }
	case "$_ans" in
		n|N|no|NO|No) return 1 ;;
		*)            return 0 ;;
	esac
}

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
# EVERY fetch VERIFIES THE CERTIFICATE. This runs as root from `curl | sh`, and the package
# manager installs --allow-untrusted (it holds no key of ours), so what vouches for the package
# is the ed25519 signature checked below — but this channel is what delivers the release metadata
# that names the asset, its checksum and its signature. Never `-k` / `--no-check-certificate`,
# not even as a retry: a failed verification IS the MITM case, and `ca-bundle` is in OpenWrt's
# DEFAULT_PACKAGES, so the insecure path buys nothing.
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
sig_url() {		# <json> <package-url> -> the detached signature published for THAT package
	# Looked UP in the asset list, never derived by appending ".sig" to the URL: a derived URL
	# is a URL nobody published, and it would send the fetch after a file the release does not
	# claim to have. -Fx = whole line, literal.
	jsonfilter -i "$1" -e '@.assets[*].browser_download_url' 2>/dev/null | grep -Fx "$2.sig" || true
}
# @endmirror

# usign is on EVERY OpenWrt image — base-files depends on it — so verifying the release signature
# costs the theme no new runtime dependency (see LUCI_DEPENDS in the Makefile: the curl lesson).
# The key is the package's own; it is not added to /etc/apk/keys, so nothing this package does
# makes footstrap a trust anchor for the router's package manager at large.
# @mirror gh/verify-sig
verify_sig() {		# <file> <sigfile> <pubkey-file> -> 0 iff the signature is ours and intact
	command -v usign >/dev/null 2>&1 || return 2
	usign -V -q -m "$1" -x "$2" -p "$3"
}
# @endmirror

# THE ONLY COPY of the release public key outside the packages, and it has to exist: this script is
# fetched with `curl | sh` and runs BEFORE any package is installed. The package copy is
# luci-app-footstrap-updater/root/usr/share/luci-app-footstrap-updater/release.pub — the self-updater
# reads THAT one — and CI fails the build if the two ever say different things. One key signs both the
# theme and the updater assets.
#
# A public key is public — pinning it here is the point, not a leak. It is what makes a tampered
# release asset unusable even though the API answer that names the asset comes from the same host
# as its checksum.
release_pubkey() {	# writes the key to $1
	cat > "$1" <<-'EOF'
	untrusted comment: luci-theme-footstrap release key
	RWQYxjhl4rz41tNZc3dXmnRplRO1ydN1q8as++iPUjZc6SRUCb952L/T
	EOF
}

# --- resolve the assets (TWO repos since the split) -----------------------
# jsonfilter (OpenWrt base image) is what reads the sha256 out of the API answer — without it
# there is no integrity check at all, only unverifiable bytes handed to root. Refuse, don't
# fall back.
command -v jsonfilter >/dev/null 2>&1 || {
	err "jsonfilter not found — it is part of OpenWrt's base image."
	err "This installer only supports OpenWrt."
	exit 1
}

# Fetch a repo's release JSON. $1 owner/repo, $2 outfile, $3 tag (latest | vX).
resolve_release() {
	if [ "$3" = "latest" ]; then _api="https://api.github.com/repos/$1/releases/latest"
	else _api="https://api.github.com/repos/$1/releases/tags/$3"; fi
	fetch "$_api" 20 "$2" && [ -s "$2" ]
}

info "Resolving the theme release ($TAG) from $REPO_THEME..."
THEME_JSON="$TMP/theme.json"
if ! resolve_release "$REPO_THEME" "$THEME_JSON" "$TAG"; then
	err "Could not reach the GitHub release API."
	err "If it is a TLS/cert error, install the CA bundle:"
	if [ "$PM" = "apk" ]; then err "  apk add ca-bundle   (then re-run)"; else err "  opkg update && opkg install ca-bundle   (then re-run)"; fi
	exit 1
fi
THEME_URL=$(asset_urls "$THEME_JSON" luci-theme-footstrap | head -n1)
if [ -z "$THEME_URL" ]; then
	err "Could not find a luci-theme-footstrap .$EXT asset for release '$TAG'."
	err "Check releases: https://github.com/$REPO_THEME/releases"
	exit 1
fi

# --- the updater: its own repo first, the theme release as a fallback -------------------------
# The updater's home is REPO_UPDATER and every future release comes from there — so it is asked
# first, and it wins whenever it offers an asset. The theme release is a second place to look, and
# it exists because the split is not instantaneous:
#
#   - the updater repo has no signed release yet (its signing secret is not set, so its release job
#     cannot run) — that is the state this fallback was written for;
#   - the theme repo published the updater up to and including the transition release, so its
#     `latest` really does carry a signed, installable asset;
#   - a renamed or unreachable updater repo degrades to "the theme release we already fetched"
#     instead of to "no update controls at all", at no extra API call.
#
# Both sources are verified against the SAME key, so the fallback loosens nothing: it changes where
# the bytes come from, never whether they are checked. $UPDATER_JSON follows the asset — the digest
# and the .sig are listed by whichever release publishes it, and install_asset verifies against that
# json, not against whichever one happened to be fetched last.
#
# WHEN THE UPDATER REPO PUBLISHES this whole fallback becomes dead code and should go: delete the
# `if [ -z "$UPDATER_URL" ]` branch below, leaving the REPO_UPDATER resolution.
info "Resolving the updater release (latest) from $REPO_UPDATER..."
UPDATER_JSON="$TMP/updater.json"; UPDATER_URL=""
if resolve_release "$REPO_UPDATER" "$UPDATER_JSON" latest; then
	UPDATER_URL=$(asset_urls "$UPDATER_JSON" luci-app-footstrap-updater | head -n1)
fi
if [ -z "$UPDATER_URL" ]; then
	UPDATER_URL=$(asset_urls "$THEME_JSON" luci-app-footstrap-updater | head -n1)
	if [ -n "$UPDATER_URL" ]; then
		UPDATER_JSON="$THEME_JSON"
		info "The updater repo publishes no asset yet — taking the updater from the theme release."
	fi
fi

# --- download, verify, install --------------------------------------------
# TWO checks, answering DIFFERENT attackers, and both fail CLOSED.
#
#  - the ed25519 SIGNATURE is the one that matters. The sha256 cannot stand alone: GitHub
#    COMPUTES `@.assets[*].digest` from the uploaded bytes, so anyone who can replace a release
#    asset (a leaked write-scoped PAT — no CI run needed) gets the digest recomputed for them and
#    the checksum then cheerfully verifies the attacker's package. The signing key lives nowhere
#    in this repository and cannot be read back out of GitHub, so a replaced asset fails to
#    verify. `apk add --allow-untrusted` means the PACKAGE MANAGER holds no key of ours — it does
#    not mean the package is unverified; this script is what verifies it.
#  - the sha256 still earns its place: it catches a tampered or truncated download from the asset
#    CDN (a different host from api.github.com) with a clearer message. It does NOT remain if usign
#    is absent — nothing does: no usign is a REFUSAL below, which is correct and is the opposite of
#    what this comment used to promise.
#
# A MISSING digest or a MISSING signature is a REFUSAL, not a warning: half of a trust chain
# cannot be optional, and whatever empties it (a renamed field, an unexpected answer) leaves us
# installing bytes we cannot account for. FOOTSTRAP_ALLOW_UNVERIFIED=1 overrides — deliberately
# something you have to type, and its one honest use is pinning a release older than the signing
# key (`sh -s v0.9.0`). A signature that is PRESENT and WRONG is never overridable: that is not a
# missing check, that is a failed one.
install_asset() {
	_url="$1"
	_json="$2"		# the release JSON that LISTS this asset (its digest + signature live there)
	_name=$(basename "$_url")
	_pkg="$TMP/$_name"

	asset_host_ok "$_url" || { err "Refusing an asset from an unexpected host: $_url"; exit 1; }

	info "Downloading $_name..."
	if ! fetch "$_url" 600 "$_pkg" || [ ! -s "$_pkg" ]; then
		err "Download failed. If it is a TLS/cert error, install the CA bundle:"
		if [ "$PM" = "apk" ]; then err "  apk add ca-bundle   (then re-run)"; else err "  opkg update && opkg install ca-bundle   (then re-run)"; fi
		exit 1
	fi

	_digest=$(asset_digest "$_json" "$_url")
	if [ -z "$_digest" ] || ! command -v sha256sum >/dev/null 2>&1; then
		if [ "${FOOTSTRAP_ALLOW_UNVERIFIED:-0}" = "1" ]; then
			warn "No sha256 for $_name — installing UNVERIFIED because FOOTSTRAP_ALLOW_UNVERIFIED=1."
		else
			err "No sha256 available for $_name — refusing to install."
			err "The release must account for every byte it hands to root; half a trust chain"
			err "is not one."
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

	_sig_url=$(sig_url "$_json" "$_url")
	_sig="$_pkg.sig"
	_pub="$TMP/release.pub"
	release_pubkey "$_pub"
	if [ -z "$_sig_url" ] || ! command -v usign >/dev/null 2>&1; then
		if [ "${FOOTSTRAP_ALLOW_UNVERIFIED:-0}" = "1" ]; then
			warn "No signature check for $_name — installing UNVERIFIED because FOOTSTRAP_ALLOW_UNVERIFIED=1."
		elif [ -z "$_sig_url" ]; then
			err "This release publishes no signature for $_name — refusing to install."
			err "Releases up to and including v0.8.5 were published before signing existed."
			err "To install one of those anyway:"
			err "  FOOTSTRAP_ALLOW_UNVERIFIED=1 sh install.sh $TAG"
			exit 1
		else
			err "usign not found — it is part of OpenWrt's base image (base-files depends on it)."
			err "Without it the release signature cannot be checked, and the package is installed"
			err "with --allow-untrusted. Refusing."
			exit 1
		fi
	else
		asset_host_ok "$_sig_url" || { err "Refusing a signature from an unexpected host: $_sig_url"; exit 1; }
		if ! fetch "$_sig_url" 60 "$_sig" || [ ! -s "$_sig" ]; then
			err "Could not download the signature for $_name — refusing to install."
			exit 1
		fi
		if ! verify_sig "$_pkg" "$_sig" "$_pub"; then
			err "BAD SIGNATURE for $_name — refusing to install."
			err "The bytes downloaded are NOT the package we published. Do not install them by"
			err "hand; report it at https://github.com/$REPO_UPDATER/issues"
			exit 1
		fi
		ok "signature verified: $_name (usign, key $(usign -F -p "$_pub" 2>/dev/null))"
		rm -f "$_sig"
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

install_asset "$THEME_URL" "$THEME_JSON"

# The updater is optional and the user chooses (see want_updater above). A release older than the
# split simply has no updater asset — then there is nothing to offer or ask about.
UPDATER_INSTALLED=0
if [ -z "$UPDATER_URL" ]; then
	warn "This release publishes no luci-app-footstrap-updater asset — installing the theme only."
	warn "The Appearance popover will show the version but no update controls."
elif want_updater; then
	install_asset "$UPDATER_URL" "$UPDATER_JSON"
	UPDATER_INSTALLED=1
else
	info "Skipping the update checker — the theme shows its version but no update controls."
	info "Add it any time:  FOOTSTRAP_UPDATER=1 sh install.sh   (or re-run and answer yes)."
fi

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
if [ "$UPDATER_INSTALLED" = 1 ]; then
	ok "luci-theme-footstrap + luci-app-footstrap-updater installed (translations included)."
else
	ok "luci-theme-footstrap installed (translations included)."
fi
info "Select \"Footstrap\" in System -> System -> Language and Style -> \"Design\"."
info "Layout (sidebar / top bar), dark mode, palette, tint and accent all live in"
info "the \"Appearance\" popover in the menu. Each browser keeps its own choices;"
	info "\"Save as default\" stores the current look as the router-wide starting point."
info "Then hard-reload the page (Ctrl+F5)."
