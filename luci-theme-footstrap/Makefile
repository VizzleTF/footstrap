#
# Copyright (C) 2026
#
# This is free software, licensed under the Apache License, Version 2.0 .
#

include $(TOPDIR)/rules.mk

PKG_NAME:=luci-theme-footstrap

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

# Ship CSS/JS verbatim — the LuCI minifier mangles modern CSS (:has(),
# color-mix(), nested calc()) and ES syntax, which breaks the layout.
LUCI_MINIFY_CSS:=0
LUCI_MINIFY_JS:=0

PKG_LICENSE:=Apache-2.0

define Package/luci-theme-footstrap/postrm
#!/bin/sh
[ -n "$${IPKG_INSTROOT}" ] || {
	uci -q delete luci.themes.Footstrap
	uci -q delete luci.themes.FootstrapDark
	uci -q delete luci.themes.FootstrapLight
	uci -q delete luci.themes.FootstrapTop
	uci -q delete luci.themes.FootstrapTopDark
	uci -q delete luci.themes.FootstrapTopLight
	uci commit luci
}
endef

include $(TOPDIR)/feeds/luci/luci.mk

# call BuildPackage - OpenWrt buildroot signature
