#!/bin/sh
# Build luci-theme-footstrap as an OpenWrt .apk via the SDK.
# The theme is noarch (CSS/JS/templates/fonts only), so the package installs on any
# router of that release whatever its CPU architecture.
#
#   ./build-apk.sh            # download SDK if needed, then build
#   BUILD_DIR=~/x ./build-apk.sh
set -e

REL="${OPENWRT_RELEASE:-25.12.2}"
SDK_URL="https://downloads.openwrt.org/releases/${REL}/targets/mediatek/filogic/openwrt-sdk-${REL}-mediatek-filogic_gcc-14.3.0_musl.Linux-x86_64.tar.zst"
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
	wget -q -O sdk.tar.zst "$SDK_URL"
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
