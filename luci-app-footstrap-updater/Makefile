#
# Copyright (C) 2026
#
# This is free software, licensed under the Apache License, Version 2.0 .
#

include $(TOPDIR)/rules.mk

PKG_NAME:=luci-app-footstrap-updater
# luci.mk keys hook names on LUCI_NAME, which defaults to the checkout's directory name — a
# differently-named checkout symlinked into the feed would silently skip the Build/Prepare hook. Pin
# it.
LUCI_NAME:=luci-app-footstrap-updater

# Version is git-derived; never hardcode PKG_VERSION. CI injects FOOTSTRAP_VERSION from the tag (an
# SDK build has no .git, so it cannot derive one). SINCE THE SPLIT this package lives in its own repo
# with its OWN tags and release stream — the version here is the updater's alone, independent of the
# theme's. The self-updater compares the installed version against this repo's latest tag to decide
# whether the updater leg can be skipped.
FOOTSTRAP_VERSION?=
ifneq ($(FOOTSTRAP_VERSION),)
PKG_VERSION:=$(FOOTSTRAP_VERSION)
PKG_RELEASE:=1
endif

LUCI_TITLE:=Footstrap theme self-update
# +luci-theme-footstrap: this package updates the theme, its fs-update.js requires the theme's
# fs-version/fs-prefs/fs-router modules, and installing it without the theme is meaningless. +luci-base
# is transitive through the theme but stated for clarity. NO curl dep — the backend falls back to
# uclient-fetch (the base image ships that, not curl); usign/jsonfilter/sha256sum are in the base
# image. See the theme Makefile's curl lesson.
LUCI_DEPENDS:=+luci-base +luci-theme-footstrap
LUCI_PKGARCH:=all
LUCI_MAINTAINER:=VizzleTF <vizzletf47@gmail.com>
LUCI_URL:=https://github.com/VizzleTF/luci-app-footstrap-updater

# LUCI_MINIFY_JS defaults to 1 — jsmin (luci-base/host, already a build dep) strips the ~5 KB of
# comments in fs-update.js. Same regex-vs-division hazard as the theme JS; eslint's wrap-regex and
# tools/jsmin-verify.mjs gate it across both packages.

PKG_LICENSE:=Apache-2.0

# RELOAD, NOT RESTART: rpcd holds sessions in memory, so `restart` logs out every LuCI user —
# including the admin who just clicked Update. `reload` sends SIGHUP, which re-reads
# /usr/share/rpcd/acl.d/*, and that ACL refresh (the file.exec grant for the self-update script) is
# the only thing this package needs from rpcd. See the theme Makefile for the live-verified rationale.
define Package/luci-app-footstrap-updater/postinst
#!/bin/sh
[ -n "$${IPKG_INSTROOT}" ] || {
	rm -f /tmp/luci-indexcache* /tmp/luci-modulecache/* >/dev/null 2>&1 || true
	/etc/init.d/rpcd reload >/dev/null 2>&1 || true
}
exit 0
endef

define Package/luci-app-footstrap-updater/postrm
#!/bin/sh
[ -n "$${IPKG_INSTROOT}" ] || {
	# Removing the updater removes fs-update.js from /www/luci-static/resources; drop the module cache
	# so the theme's Appearance popover stops offering update controls on the next load, and reload
	# rpcd so the file.exec grant goes away.
	rm -f /tmp/luci-indexcache* /tmp/luci-modulecache/* >/dev/null 2>&1 || true
	/etc/init.d/rpcd reload >/dev/null 2>&1 || true
}
exit 0
endef

# Runs right after luci.mk copies htdocs/root into PKG_BUILD_DIR, so it rewrites the build copy, never
# the source tree. Compiles the translation catalogue INTO this package — same reasoning as the theme
# (the `po/` -> `i18n/` rename stops luci.mk emitting per-language packages, which would make the
# release carry more than one asset per format and re-open issue #6 for fielded self-updaters). The
# basename is footstrap-updater.<lang>.lmo; lmo_load_catalog globs `*.<lang>.lmo`, so any basename
# loads, and this one cannot collide with the theme's footstrap-theme.<lang>.lmo.
define Build/Prepare/luci-app-footstrap-updater
	$(INSTALL_DIR) $(PKG_BUILD_DIR)/root/usr/lib/lua/luci/i18n
	$(foreach po,$(wildcard $(CURDIR)/i18n/*/*.po), \
		po2lmo $(po) \
			$(PKG_BUILD_DIR)/root/usr/lib/lua/luci/i18n/footstrap-updater.$(notdir $(patsubst %/,%,$(dir $(po)))).lmo;)
	# Stamp this repo's version into fs-update.js's UPD_VERSION — the string the badge compares against
	# `check-updater` (the updater repo's latest tag). BY FILE NAME + literal, exactly like the theme's
	# FS_VERSION stamp, so the constant cannot move files without this breaking loudly. Skipped when
	# PKG_VERSION is empty (a plain source checkout), leaving '0.0.0-dev' — never checked.
	$(if $(PKG_VERSION),$(SED) "s#const UPD_VERSION = '[^']*'#const UPD_VERSION = '$(PKG_VERSION)'#" \
		$(PKG_BUILD_DIR)/htdocs/luci-static/resources/fs-update.js)
endef

# Absolute, not a relative path: CI rsyncs this package into package/, not into the feed.
include $(TOPDIR)/feeds/luci/luci.mk

# THE LINE BELOW IS LOAD-BEARING AND IT IS NOT A SIGNATURE — do not delete it as boilerplate.
# include/scan.mk builds the package list by GREPPING Makefiles for `call BuildPackage`; luci.mk calls
# it at the include above, but the grep cannot see that, so this literal is what puts the package into
# the SDK's list. tools/scan-marker.sh fails the build if it goes missing.
# call BuildPackage - OpenWrt buildroot signature
