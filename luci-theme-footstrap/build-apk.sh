#!/bin/sh
# Build luci-theme-footstrap as an OpenWrt .apk via the SDK.
# The theme is noarch (CSS/JS/templates/fonts only), so the package installs on any
# router of that release whatever its CPU architecture.
#
#   ./build-apk.sh            # download SDK if needed, then build
#   BUILD_DIR=~/x ./build-apk.sh
set -e

REL="${OPENWRT_RELEASE:-25.12.2}"
SDK_BASE="https://downloads.openwrt.org/releases/${REL}/targets/mediatek/filogic"
SDK_FILE="openwrt-sdk-${REL}-mediatek-filogic_gcc-14.3.0_musl.Linux-x86_64.tar.zst"
SDK_URL="$SDK_BASE/$SDK_FILE"
# MUST be a case-sensitive fs (ext4/…), NOT an NTFS/9p Windows mount.
BUILD_DIR="${BUILD_DIR:-/tmp/ow-footstrap-build}"
# FORCE=1 overrides buildroot's host-prereq bail-outs (see step 4).
export FORCE=1
THEME_DIR="$(cd "$(dirname "$0")" && pwd)"          # this package
SDK_DIR="$BUILD_DIR/sdk"

mkdir -p "$BUILD_DIR"
cd "$BUILD_DIR"

# 1. SDK
if [ ! -d "$SDK_DIR" ]; then
	echo ">> downloading SDK $REL ..."
	# --https-only: GNU wget follows https -> http redirects, and this tarball is a toolchain
	# that will build a package a maintainer may hand to someone.
	wget -q --https-only -O sdk.tar.zst "$SDK_URL"

	# The SDK is the least verified input in this repo and the only one that ends up in the built
	# package: jsmin.c and i18n-scan.pl — two LINTERS — are pinned by commit AND sha256, while the
	# toolchain that builds the artifact arrived on trust alone. OpenWrt publishes sha256sums next
	# to the tarball. Fails CLOSED: a missing or unmatched line refuses, it does not warn and carry
	# on. Mirrors the same check in .github/workflows/build.yml.
	echo ">> verifying SDK sha256 ..."
	wget -q --https-only -O sha256sums "$SDK_BASE/sha256sums"
	WANT="$(grep -F " *$SDK_FILE" sha256sums | cut -d' ' -f1)"
	[ -n "$WANT" ] || { echo "no sha256 published for $SDK_FILE" >&2; exit 1; }
	GOT="$(sha256sum sdk.tar.zst | cut -d' ' -f1)"
	[ "$WANT" = "$GOT" ] || { echo "SDK checksum mismatch: want $WANT, got $GOT" >&2; exit 1; }
	rm -f sha256sums
	echo ">> SDK sha256 verified."

	echo ">> extracting ..."
	mkdir -p "$SDK_DIR"
	tar --zstd -xf sdk.tar.zst -C "$SDK_DIR" --strip-components=1
	rm -f sdk.tar.zst
fi
cd "$SDK_DIR"

# 2. feeds (need luci for luci.mk + BuildPackage macros)
if [ ! -f feeds/luci.index ] && [ ! -d feeds/luci ]; then
	./scripts/feeds update base luci
fi
./scripts/feeds install -a -p luci >/dev/null 2>&1 || true

# 3. drop our theme into the luci themes feed (fresh copy)
DEST="feeds/luci/themes/luci-theme-footstrap"
rm -rf "$DEST"
cp -a "$THEME_DIR" "$DEST"
rm -rf "$DEST/build-apk.sh" "$DEST/dev-sync.sh" "$DEST/.git" 2>/dev/null || true

./scripts/feeds update -i luci
./scripts/feeds install luci-theme-footstrap

# 4. build. ncurses is only needed for interactive menuconfig, not for a noarch
# theme, so satisfy the host prereq stamp to skip that check.
mkdir -p staging_dir/host
touch staging_dir/host/.prereq-build
make defconfig FORCE=1
make package/luci-theme-footstrap/clean FORCE=1 V=s >/dev/null 2>&1 || true
make package/luci-theme-footstrap/compile FORCE=1 V=s

# 5. locate the artifact
echo
echo ">> built packages:"
find bin -name 'luci-theme-footstrap*' \( -name '*.apk' -o -name '*.ipk' \) -print
