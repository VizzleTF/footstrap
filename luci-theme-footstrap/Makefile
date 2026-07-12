#
# Copyright (C) 2026
#
# This is free software, licensed under the Apache License, Version 2.0 .
#

include $(TOPDIR)/rules.mk

PKG_NAME:=luci-theme-footstrap
# luci.mk defaults LUCI_NAME to the checkout's directory name and keys the
# Build/Prepare hook name on it — a differently-named checkout symlinked into
# the feed would silently skip the CSS build. Pin it.
LUCI_NAME:=luci-theme-footstrap

# Version is git-derived locally; CI injects FOOTSTRAP_VERSION from the tag
# (the SDK build has no .git so it can't derive one).
FOOTSTRAP_VERSION?=
ifneq ($(FOOTSTRAP_VERSION),)
PKG_VERSION:=$(FOOTSTRAP_VERSION)
PKG_RELEASE:=1
endif

LUCI_TITLE:=Footstrap Theme
LUCI_DEPENDS:=+luci-base
LUCI_PKGARCH:=all

# CSS: ship verbatim. luci.mk would run it through csstidy, which is old enough to
# mangle modern CSS (:has(), color-mix(), nested calc()) and break the layout. The
# stylesheet is minified by build-css.sh instead, which only drops comments and
# indentation and understands strings.
LUCI_MINIFY_CSS:=0
#
# JS: DO let luci.mk minify it (LUCI_MINIFY_JS defaults to 1, so this is the absence
# of an opt-out, not an opt-in). That is jsmin, built from luci-base/src/jsmin.c —
# already on the buildbot, since luci-base/host is a build dependency — and it is what
# every other LuCI package uses. Half of this theme's JS is comments (~41 KB of 83 KB),
# and uhttpd serves /www with NO compression, so those are wire bytes AND flash bytes.
# jsmin takes the shipped JS from 83 KB to 35 KB, comments stay in git.
#
# The catch, and why the gates exist: jsmin decides `/` = regex-or-division from a
# ONE-character lookback, and `n` (from `return`) and `>` (from `=>`) are not on its
# allow-list — so `return /re/` can make it eat the rest of the file AND EXIT 0
# (openwrt/luci#8299). Two things stop that reaching a release:
#   - eslint `wrap-regex` forbids writing the hazardous shape at all;
#   - tools/jsmin-verify.mjs proves jsmin's output is TOKEN-IDENTICAL to the source.
# Both run in CI. See CLAUDE.md.

PKG_LICENSE:=Apache-2.0

define Package/luci-theme-footstrap/postinst
#!/bin/sh
[ -n "$${IPKG_INSTROOT}" ] || {
	# uci-defaults registers the theme entries; refresh rpcd + clear caches so
	# LuCI picks them up without a reboot.
	[ -f /etc/uci-defaults/30_luci-theme-footstrap ] && \
		sh /etc/uci-defaults/30_luci-theme-footstrap >/dev/null 2>&1 || true
	rm -f /tmp/luci-indexcache* /tmp/luci-modulecache/* >/dev/null 2>&1 || true
	/etc/init.d/rpcd restart >/dev/null 2>&1 || true
}
exit 0
endef

define Package/luci-theme-footstrap/postrm
#!/bin/sh
[ -n "$${IPKG_INSTROOT}" ] || {
	for t in FootstrapSidebar FootstrapOnTop Footstrap FootstrapDark \
	         FootstrapLight FootstrapTop FootstrapTopDark FootstrapTopLight; do
		uci -q delete "luci.themes.$$t"
	done
	# don't leave the active theme pointing at the media dir we just removed —
	# fall back to bootstrap instead of relying on LuCI's runtime fallback
	case "$$(uci -q get luci.main.mediaurlbase)" in
		/luci-static/footstrap*)
			[ -f /www/luci-static/bootstrap/cascade.css ] && \
				uci set luci.main.mediaurlbase=/luci-static/bootstrap ;;
	esac
	uci commit luci
	# The "have we been installed before" marker that uci-defaults writes (it is what
	# tells a fresh install from an upgrade). Removing it here means an uninstall
	# followed by a reinstall is correctly treated as fresh again.
	rm -rf /usr/share/luci-theme-footstrap >/dev/null 2>&1 || true
	rm -f /tmp/luci-indexcache* /tmp/luci-modulecache/* >/dev/null 2>&1 || true
	/etc/init.d/rpcd restart >/dev/null 2>&1 || true
}
endef

# luci.mk calls this hook right after copying luasrc/ucode/htdocs/root/src into
# PKG_BUILD_DIR, so we rewrite the build copy — never the source tree.
#
# 1. cascade.css is generated, not committed: build-css.sh concatenates
#    styles/*.css + pages/*.css and strips comments. Those two dirs are not in
#    luci.mk's copy list, so we read them from $(CURDIR) and write the result
#    straight into the build tree. Only `cat`/`awk` are used — no host toolchain
#    to install, which is why this works on an OpenWrt buildbot.
# 2. Stamp the git-derived version into the theme JS so the Appearance popover
#    can show it and run its GitHub update check. Skipped when PKG_VERSION is
#    empty (leaves the '0.0.0-dev' literal).
define Build/Prepare/luci-theme-footstrap
	$(SHELL) $(CURDIR)/build-css.sh $(PKG_BUILD_DIR)/htdocs/luci-static/footstrap/cascade.css
	$(if $(PKG_VERSION),$(SED) "s#const FS_VERSION = '[^']*'#const FS_VERSION = '$(PKG_VERSION)'#" \
		$(PKG_BUILD_DIR)/htdocs/luci-static/resources/menu-footstrap-common.js)
endef

include $(TOPDIR)/feeds/luci/luci.mk

# call BuildPackage - OpenWrt buildroot signature
