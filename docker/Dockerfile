# A dev "router": stock OpenWrt userland + LuCI, one image per supported release.
#
# The base image is the release's own rootfs tarball, so what runs here is the same
# userland the theme ships against — procd as PID 1, netifd, ubus, rpcd, uhttpd — and
# NOT a hand-assembled approximation. The package manager differs by release (apk on
# 25.12+, opkg on 24.10) and that difference is deliberately left visible: this project
# has to keep working on both.
#
# Build via docker/compose.yml, which pins the tag per service.
ARG OPENWRT_TAG=x86-64-25.12.4
FROM openwrt/rootfs:${OPENWRT_TAG}

# The rootfs tarball has no /var/lock etc. — on a real router procd's boot creates them
# under the /var -> /tmp tmpfs. They are needed BEFORE that, by the package manager below.
RUN mkdir -p /var/lock /var/run /var/log /var/state

# LuCI, plus what a real router actually renders: firewall/dhcp/wifi pages, and the
# package-manager view the theme styles. `curl` is deliberately NOT installed — it is not
# in OpenWrt's default set, and the self-updater's uclient-fetch fallback exists precisely
# because of that; installing it here would hide the bug class on the dev box.
#
# openssh-sftp-server is the one package here that is NOT about fidelity: OpenSSH 9+ scp
# speaks SFTP by default, dropbear ships no sftp-server, and every `scp` the deploy tooling
# runs would fail. The alternative was `scp -O` in each of those scripts — a flag on every
# call site, forever, so that a dev container can be 30 KB smaller.
#
# The luci-app-* list is long ON PURPOSE. A bare `luci` renders three menus, and a theme
# whose dev box shows three menus is a theme nobody can look at: the sections, the tabs, the
# tables and the widgets that actually need styling live in the apps. Everything here is
# from OpenWrt's OWN feed, so it resolves for both branches; the third-party apps that need
# their own feed are a separate step below.
#
# wpad/iw/iwinfo are the wifi userland. The RADIOS come from the host kernel (see
# hwsim/README): OpenWrt's kmod-mac80211-hwsim is built against OpenWrt's kernel and cannot
# load here, but hostapd and iwinfo do not care where a phy came from — nl80211 is nl80211.
RUN set -eu; \
	APPS="luci-app-firewall luci-app-package-manager luci-app-opkg \
		luci-app-banip luci-app-adblock luci-app-ddns luci-app-upnp \
		luci-app-statistics luci-app-nlbwmon luci-app-sqm luci-app-vnstat2 \
		luci-app-wol luci-app-watchcat luci-app-filemanager luci-app-ttyd \
		luci-app-https-dns-proxy luci-app-mwan3 luci-app-acme luci-app-samba4 \
		luci-app-openvpn luci-proto-wireguard luci-proto-openconnect \
		luci-mod-dashboard luci-app-attendedsysupgrade \
		wpad-basic-mbedtls wifi-scripts iw iwinfo hostapd-utils \
		openssh-sftp-server"; \
	if command -v apk >/dev/null; then \
		apk update; \
		for p in luci $APPS; do apk add "$p" 2>/dev/null || echo "skip (not in this feed): $p"; done; \
	else \
		opkg update; \
		for p in luci $APPS; do opkg install "$p" 2>/dev/null || echo "skip (not in this feed): $p"; done; \
	fi

# The three apps the fence was measured against that do NOT live in OpenWrt's feed. They are
# here because this theme's hardest problem is SHARING ONE DOCUMENT with apps like these
# (see CLAUDE.md, "three zones, three defences") — `tools/chrome-fence.mjs` reasons about
# openclash's `*{padding:0!important}` from a text file, while this puts the real sheet in
# the real document.
#
# justclash is the one whose sheet a text file CANNOT reason about at all: its package ships
# no .css — every rule is built from its view JS at runtime, which is exactly the
# `textIsSheet()` shape (a <style> whose textContent is not its sheet). It is also the app
# behind the theme's `data-theme="dark"` publication (21 rules key off it) and the
# `--*-color-*` export tier, so its pages are where both of those get looked at for real.
#
# ADD, not a download inside the container: buildkit fetches it host-side, and it is pinned
# by the tag in compose.yml. These are dev fixtures and are NOT part of the release trust
# chain — nothing here is signed or verified, and nothing here ships. Do not copy this
# pattern into install.sh or the self-updater, which verify for real.
ARG NIKKI_VERSION=v1.26.1
# Two forms of the same number: the TAG carries the `v`, the asset file names do not, and
# ADD cannot run a shell to strip it.
ARG OPENCLASH_TAG=v0.47.116
ARG OPENCLASH_VER=0.47.116
# justclash's assets carry a package release suffix the tag does not (`-r1`), and they are
# arch/branch independent — one pair of files serves both releases. Its two halves are
# installed as SEPARATE commands on purpose: upstream supports 25.12+ only and the core
# drags in nftables/tproxy/jq-full deps, while `luci-app-justclash` depends on nothing but
# libc — so on 24.10 the core may refuse and the half this theme is here to render must
# survive that. One `install a b` would take both down with it.
ARG JUSTCLASH_TAG=v0.73.0
ARG JUSTCLASH_VER=0.73.0-r1
ARG OPENWRT_BRANCH=25.12
ADD https://github.com/nikkinikki-org/OpenWrt-nikki/releases/download/${NIKKI_VERSION}/nikki_x86_64-openwrt-${OPENWRT_BRANCH}.tar.gz /tmp/nikki.tar.gz
ADD https://github.com/vernesong/OpenClash/releases/download/${OPENCLASH_TAG}/luci-app-openclash-${OPENCLASH_VER}.apk /tmp/openclash.apk
ADD https://github.com/vernesong/OpenClash/releases/download/${OPENCLASH_TAG}/luci-app-openclash_${OPENCLASH_VER}_all.ipk /tmp/openclash.ipk
ADD https://github.com/SaltyMonkey/justclash/releases/download/${JUSTCLASH_TAG}/justclash-${JUSTCLASH_VER}.apk /tmp/justclash.apk
ADD https://github.com/SaltyMonkey/justclash/releases/download/${JUSTCLASH_TAG}/luci-app-justclash-${JUSTCLASH_VER}.apk /tmp/luci-justclash.apk
ADD https://github.com/SaltyMonkey/justclash/releases/download/${JUSTCLASH_TAG}/justclash-${JUSTCLASH_VER}-all.ipk /tmp/justclash.ipk
ADD https://github.com/SaltyMonkey/justclash/releases/download/${JUSTCLASH_TAG}/luci-app-justclash-${JUSTCLASH_VER}-all.ipk /tmp/luci-justclash.ipk
RUN set -eu; \
	mkdir -p /tmp/nikki && tar -xzf /tmp/nikki.tar.gz -C /tmp/nikki; \
	if command -v apk >/dev/null; then \
		apk add --allow-untrusted /tmp/nikki/nikki-*.apk /tmp/nikki/luci-app-nikki-*.apk \
			/tmp/nikki/mihomo-meta-*.apk || echo "skip: nikki"; \
		apk add --allow-untrusted /tmp/openclash.apk || echo "skip: openclash"; \
		apk add --allow-untrusted /tmp/justclash.apk || echo "skip: justclash core"; \
		apk add --allow-untrusted /tmp/luci-justclash.apk || echo "skip: luci-app-justclash"; \
	else \
		opkg install /tmp/nikki/nikki_*.ipk /tmp/nikki/luci-app-nikki_*.ipk \
			/tmp/nikki/mihomo-meta_*.ipk || echo "skip: nikki"; \
		opkg install /tmp/openclash.ipk || echo "skip: openclash"; \
		opkg install /tmp/justclash.ipk || echo "skip: justclash core"; \
		opkg install /tmp/luci-justclash.ipk || echo "skip: luci-app-justclash"; \
	fi; \
	rm -rf /tmp/nikki* /tmp/openclash.* /tmp/justclash.* /tmp/luci-justclash.*

# LuCI refuses nothing on an empty root password, but the tooling authenticates for real
# (LUCI_PW, and ssh's own PasswordAuthentication), so there has to be one.
ARG ROOT_PASSWORD=1234
RUN printf '%s\n%s\n' "$ROOT_PASSWORD" "$ROOT_PASSWORD" | passwd root >/dev/null

# Host keys are baked into the IMAGE, not generated on first boot: a container is
# recreated often, and a key that changes every time turns every ssh/scp the deploy and
# preview tooling runs into a host-key prompt.
RUN dropbearkey -t ed25519 -f /etc/dropbear/dropbear_ed25519_host_key \
	&& dropbearkey -t rsa -s 2048 -f /etc/dropbear/dropbear_rsa_host_key

COPY files/ /

# uci-defaults run once, on first boot, from procd's boot sequence — the same hook the
# theme's own registration uses.
RUN chmod +x /etc/uci-defaults/* /usr/lib/footstrap-dev/* 2>/dev/null || true

EXPOSE 22 80
STOPSIGNAL SIGTERM
# NOT /sbin/init directly — the entrypoint has to read docker's address off eth0 while it
# is still there, and write the network config procd would otherwise generate. Read it.
CMD ["/usr/lib/footstrap-dev/entrypoint.sh"]
