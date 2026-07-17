#!/bin/sh
# Give the dev containers wifi: virtual radios, real hostapd, real scans.
#
#   docker/hwsim-up.sh          # build if needed, load, hand out radios, configure
#   docker/hwsim-up.sh --down   # unload; the containers lose their radios
#
# Run it after `docker compose up`, and again after a container is recreated — a phy lives
# in a network namespace, and when that namespace dies the phy goes back to the host.
#
# WHY IT IS NOT PART OF THE IMAGE. A radio is a kernel object, and the kernel here belongs
# to the HOST (WSL): a container brings its own userland, never its own kernel. So the
# radios cannot be built, loaded or owned by the image — only handed to it. Three
# consequences worth knowing before touching this:
#
#   * OpenWrt's own `kmod-mac80211-hwsim` is useless here. It is built against OpenWrt's
#     6.12 kernel; this box runs 6.18.33.2-microsoft-standard-WSL2.
#   * Microsoft ships that kernel with `CONFIG_MAC80211_HWSIM is not set` (mac80211 and
#     cfg80211 themselves ARE there, as modules, for USB adapters over usbipd), so the
#     module is built from the WSL kernel's own source at the tag the running kernel came
#     from. See hwsim/build.sh — it takes a few minutes, once.
#   * A REAL Windows wifi adapter cannot be forwarded instead. usbipd-win only forwards USB
#     devices, and the WSL kernel carries drivers for almost no adapter — a built-in PCIe
#     card is not forwardable at all. Virtual radios are not a compromise on fidelity here;
#     they are the only radios this kernel can have.
#
# Nothing is installed on the host and no sudo is used: the module is built in a throwaway
# ubuntu container and loaded from a privileged one. That is not a trick — being in the
# `docker` group is already root-equivalent on this machine.
set -eu

cd "$(dirname "$0")"
KO_DIR="$(pwd)/hwsim"
KO="$KO_DIR/mac80211_hwsim.ko"
HELPER=ubuntu:24.04
RADIOS=4

# 2.4 GHz ONLY, and that is a limit of this kernel, not a shortcut.
#
# cfg80211 forbids beaconing on every 5 GHz channel here (`PASSIVE-SCAN` in `iw reg get`)
# because it never loads regulatory.db, so the built-in "world" domain is all it has. The
# database cannot be supplied: the WSL kernel resolves a firmware path in a namespace that
# is neither the container's nor the Ubuntu root — regulatory.db placed in BOTH still gave
# `Direct firmware load for regulatory.db failed with error -2` — and
# CONFIG_CFG80211_REQUIRE_SIGNED_REGDB=y rules out handing it one another way.
#
# hwsim's own `regtest` modes bypass the database by applying a driver-supplied domain, and
# that WAS tried: mode 6 gives 5 GHz to exactly two of the four radios (phy0 and phy1 get
# custom domains, phy2/phy3 stay on world), which would make the two containers behave
# differently for no reason a reader could guess. Two 2.4 radios each, identical on both
# boxes, is the honest trade — and the UI surface is the same either way.
#
# The second radio is what makes Channel Analysis WORK: a scan only shows what another
# radio in the same band and the same netns is beaconing, so each box carries a neighbour
# of its own on a different channel.

pid_of() { docker inspect -f '{{.State.Pid}}' "$1"; }
in_ct()  { docker exec "$1" sh -c "$2"; }

# A privileged container in the HOST's network and pid namespaces: this is what stands in
# for `sudo` on the host, and it is where every kernel-side step happens.
host_helper() {
	docker run --rm --privileged --net=host --pid=host \
		-v /lib/modules:/lib/modules:ro -v "$KO_DIR:/ko:ro" \
		"$HELPER" bash -c "
			apt-get update -qq >/dev/null 2>&1
			DEBIAN_FRONTEND=noninteractive apt-get install -y -qq kmod iw >/dev/null 2>&1
			$1"
}

if [ "${1:-}" = "--down" ]; then
	host_helper 'rmmod mac80211_hwsim 2>&1 || echo "not loaded"'
	echo "hwsim unloaded — the containers have no radios until this script runs again."
	exit 0
fi

if [ ! -f "$KO" ]; then
	echo "==> building mac80211_hwsim for $(uname -r) (a few minutes, once)"
	docker run --rm -v "$(pwd)/hwsim:/hwsim:ro" -v "$KO_DIR:/out" "$HELPER" bash /hwsim/build.sh
fi

echo "==> loading hwsim ($RADIOS radios)"
# Idempotent: an already-loaded module owns the radios the containers are using, and
# reloading it would take them away mid-session.
host_helper "
	lsmod | grep -q '^mac80211_hwsim' && { echo 'already loaded'; exit 0; }
	modprobe cfg80211 && modprobe mac80211
	insmod /ko/mac80211_hwsim.ko radios=$RADIOS
	echo loaded
"

# Two radios each: hwsim's medium does not cross a network namespace, so a box can only
# ever hear radios it owns. That is the whole reason for two — one is the router's AP, the
# other beacons on a different channel so that Channel Analysis has something to find.
echo "==> handing out radios"
# The phys are DISCOVERED, never named phy0..phy3. The index is a kernel counter that keeps
# climbing: reload the module a few times while working on this and the same four radios
# come back as phy4..phy7, then phy8..phy11. Hardcoding the names cost an afternoon of
# "not on the host (already handed out?)" against a host that had all four sitting there.
avail="$(host_helper 'ls /sys/class/ieee80211/ 2>/dev/null | tr "\n" " "' | tr -d '\r')"
echo "  on the host: ${avail:-none}"

for ct in footstrap-2512 footstrap-2410; do
	docker inspect "$ct" >/dev/null 2>&1 || { echo "  skip $ct (not running)"; continue; }
	have="$(in_ct "$ct" 'ls /sys/class/ieee80211/ 2>/dev/null | wc -l')"
	if [ "$have" -ge 2 ]; then
		echo "  $ct already has $have phy(s)"
		continue
	fi
	pid="$(pid_of "$ct")"
	take="$(echo "$avail" | tr ' ' '\n' | grep -v '^$' | head -2 | tr '\n' ' ')"
	[ -n "$take" ] || { echo "  $ct: no phy left on the host"; continue; }
	for p in $take; do
		host_helper "iw phy $p set netns $pid" >/dev/null 2>&1 && echo "  $p -> $ct" \
			|| echo "  $p -> $ct FAILED"
		avail="$(echo "$avail" | sed "s/\b$p\b//")"
	done
done

echo "==> configuring wifi"
for ct in footstrap-2512 footstrap-2410; do
	docker inspect "$ct" >/dev/null 2>&1 || continue
	in_ct "$ct" '
		# wifi-scripts owns /sbin/wifi and the netifd wireless glue. It is NOT pulled by
		# `luci`, and without it there is no /etc/config/wireless at all.
		command -v wifi >/dev/null || {
			(apk update >/dev/null 2>&1; apk add wifi-scripts >/dev/null 2>&1) ||
			(opkg update >/dev/null 2>&1; opkg install wifi-scripts >/dev/null 2>&1)
		}

		# hostapd and netifd both cache what the kernel had when they STARTED, and both
		# started at boot — before this script handed the box its first phy. Without this
		# restart hostapd dies inside its own ucode
		#   (`Exception: left-hand side expression is null In __phy_is_fullmac()`)
		# and netifd just says "Wireless module not found". Neither error mentions the
		# actual cause, which is that the radios did not exist yet.
		/etc/init.d/wpad restart >/dev/null 2>&1
		/etc/init.d/network restart >/dev/null 2>&1
		sleep 5

		# `wifi config` writes a radio section per phy — the same call /etc/init.d/boot
		# makes on a real router. It cannot run at boot here: the phys arrive after.
		#
		# The test is for the RADIO SECTION, not for the file: `wifi config` skips a file
		# that already exists, and the uci batch below happily writes its wifi-iface
		# sections into a file with no radios in it. A half-written wireless config then
		# blocked the generator forever, and every run after it configured APs onto radios
		# that did not exist — silently, because `uci -q set` on a missing section says
		# nothing.
		uci -q get wireless.radio0 >/dev/null 2>&1 || {
			rm -f /etc/config/wireless
			wifi config >/dev/null 2>&1
		}
		uci -q get wireless.radio0 >/dev/null 2>&1 || { echo "  no radios detected"; exit 1; }

		# No `country`: with no regulatory.db (see the top of this file) a country hint
		# cannot be resolved, so a country line would only hand hostapd a hint the kernel
		# must reject.
		#
		# Everything below only re-states what a lived-in router would have: a main SSID, a
		# guest SSID on its own network, a neighbour on another channel, and a disabled one
		# (LuCI renders a disabled iface differently, and that state needs styling too).
		uci -q batch <<-EOF
			set wireless.radio0.band="2g"
			set wireless.radio0.channel="6"
			set wireless.radio0.htmode="HT20"
			set wireless.radio0.cell_density="0"
			delete wireless.radio0.disabled
			set wireless.default_radio0.ssid="footstrap-dev"
			set wireless.default_radio0.encryption="psk2"
			set wireless.default_radio0.key="footstrap123"
			set wireless.default_radio0.network="lan"
			delete wireless.default_radio0.disabled

			set wireless.radio1.band="2g"
			set wireless.radio1.channel="11"
			set wireless.radio1.htmode="HT20"
			set wireless.radio1.cell_density="0"
			delete wireless.radio1.disabled
			set wireless.default_radio1.ssid="footstrap-neighbour"
			set wireless.default_radio1.encryption="sae-mixed"
			set wireless.default_radio1.key="footstrap123"
			set wireless.default_radio1.network="lan"
			delete wireless.default_radio1.disabled

			set wireless.guest_ap=wifi-iface
			set wireless.guest_ap.device="radio0"
			set wireless.guest_ap.mode="ap"
			set wireless.guest_ap.network="guest"
			set wireless.guest_ap.ssid="footstrap-guest"
			set wireless.guest_ap.encryption="none"
			set wireless.guest_ap.isolate="1"

			set wireless.iot_ap=wifi-iface
			set wireless.iot_ap.device="radio0"
			set wireless.iot_ap.mode="ap"
			set wireless.iot_ap.network="iot"
			set wireless.iot_ap.ssid="footstrap-iot"
			set wireless.iot_ap.encryption="psk2"
			set wireless.iot_ap.key="iot12345678"
			set wireless.iot_ap.disabled="1"
			commit wireless
		EOF
		wifi up >/dev/null 2>&1
	' || echo "  $ct: wifi config failed"
done

sleep 3
for ct in footstrap-2512 footstrap-2410; do
	docker inspect "$ct" >/dev/null 2>&1 || continue
	echo "--- $ct"
	in_ct "$ct" 'iwinfo 2>/dev/null | grep -E "ESSID|Channel" | head -6' || true
done
echo
echo "Wireless is up. Network -> Wireless, and Channel Analysis scans for real."
