#!/bin/bash
# Build mac80211_hwsim.ko for the RUNNING WSL kernel. Runs inside a throwaway ubuntu
# container (see hwsim-up.sh) — nothing is installed on the host to do this.
#
# WHY THIS EXISTS: the containers get their wifi from virtual radios, and a virtual radio is
# a kernel module. The kernel here is the host's — WSL's — and Microsoft ships it with
# `CONFIG_MAC80211_HWSIM is not set` (mac80211 and cfg80211 themselves ARE built, as
# modules, for USB adapters over usbipd). OpenWrt's own `kmod-mac80211-hwsim` cannot fill
# the gap: it is built against OpenWrt's 6.12 kernel and a container does not bring its own.
# So the module has to be built from the WSL kernel's own source, at the exact tag the
# running kernel came from.
set -euo pipefail

KVER="$(uname -r)"                       # 6.18.33.2-microsoft-standard-WSL2
TAG="linux-msft-wsl-${KVER%%-*}"         # linux-msft-wsl-6.18.33.2
OUT=${OUT:-/out}

echo "kernel=$KVER tag=$TAG"

# dwarves (pahole) and gcc-13-plugin-dev are NOT optional extras, and the reason is exact:
# `make olddefconfig` silently drops any option whose tooling is missing, and one of the
# things it drops is CONFIG_DEBUG_INFO_BTF_MODULES — which adds four fields to
# `struct module`. The module then fails to load with
#   .gnu.linkonce.this_module section size must match the kernel's built struct module size
# i.e. the config, not the code, was wrong. Measured: 22 options drifted from
# /proc/config.gz without these; with them, only the compiler VERSION STRINGS differ.
apt-get update -qq
DEBIAN_FRONTEND=noninteractive apt-get install -y -qq \
	git build-essential bc bison flex libssl-dev libelf-dev cpio kmod rsync \
	dwarves gcc-13-plugin-dev zstd python3 >/dev/null

# --depth 1 on the exact tag: the full history is ~5 GB and none of it is wanted.
git clone --depth 1 --branch "$TAG" https://github.com/microsoft/WSL2-Linux-Kernel.git /src
cd /src

# The running kernel's own config, straight out of the kernel — not a defconfig that
# happens to look similar. Every symbol vermagic checks (SMP, preempt, module_unload) and
# every struct layout the module compiles against comes from here.
zcat /proc/config.gz > .config
scripts/config --module MAC80211_HWSIM
make olddefconfig
grep -q '^CONFIG_MAC80211_HWSIM=m' .config || { echo "hwsim did not stick in .config"; exit 1; }

# Fail here rather than at insmod. Any option olddefconfig dropped for want of a tool is a
# potential struct-layout change, and the symptom lands three steps later as an opaque
# "Invalid module format". Only MAC80211_HWSIM itself and the compiler's own version
# strings may differ from the running kernel's config.
zcat /proc/config.gz | grep -v '^#' | grep -v '^$' | sort > /tmp/running.cfg
grep -v '^#' .config | grep -v '^$' | sort > /tmp/built.cfg
if diff /tmp/running.cfg /tmp/built.cfg \
	| grep '^[<>]' \
	| grep -vE 'MAC80211_HWSIM|CC_VERSION_TEXT|GCC_VERSION|AS_VERSION|LD_VERSION|CC_HAS_|GCC_ASM_GOTO'
then
	echo "ERROR: the config drifted from the running kernel beyond compiler versions (above)."
	echo "A dropped option can change struct module and insmod will reject the result."
	exit 1
fi

# modules_prepare + a single-directory build, NOT a full `make modules`. The full build is
# ~20 minutes for one 200 KB module. The price is that there is no Module.symvers, so the
# module carries no symbol CRCs and the kernel — which is CONFIG_MODVERSIONS=y — will
# refuse it unless loaded with --force-modversion. That force is safe HERE and nowhere
# else: the module was compiled from the exact source and config the running kernel was
# built from, so the symbols genuinely match; the CRCs are missing, not wrong.
make -j"$(nproc)" modules_prepare

# KBUILD_MODPOST_WARN=1 is what makes the shortcut possible. Without Module.symvers, modpost
# cannot resolve a single import and stops with `"pv_ops" [mac80211_hwsim.ko] undefined!` —
# 183 of those. But nothing is actually missing: a module's imports are resolved by the
# KERNEL at insmod, and modpost is only building the version table. Told to warn instead of
# fail, it emits the .ko with an empty one, which is precisely the module that
# --force-modversion then accepts.
make -j"$(nproc)" M=drivers/net/wireless/virtual KBUILD_MODPOST_WARN=1

cp drivers/net/wireless/virtual/mac80211_hwsim.ko "$OUT/"
echo "built: $(ls -la "$OUT/mac80211_hwsim.ko")"
