#
# Copyright (C) 2026
#
# This is free software, licensed under the Apache License, Version 2.0 .
#

include $(TOPDIR)/rules.mk

PKG_NAME:=luci-theme-footstrap
# luci.mk keys the Build/Prepare hook name on LUCI_NAME, which defaults to the checkout's
# directory name — a differently-named checkout symlinked into the feed would silently skip
# the CSS build. Pin it.
LUCI_NAME:=luci-theme-footstrap

# Version is git-derived; never hardcode PKG_VERSION. CI injects FOOTSTRAP_VERSION from the
# tag (an SDK build has no .git, so it cannot derive one).
FOOTSTRAP_VERSION?=
ifneq ($(FOOTSTRAP_VERSION),)
PKG_VERSION:=$(FOOTSTRAP_VERSION)
PKG_RELEASE:=1
endif

LUCI_TITLE:=Footstrap Theme
# +luci-base is the WHOLE list. The self-updater used to hard-require `curl`, which is NOT in
# OpenWrt's default package set (the base image ships uclient-fetch), so the update button
# failed on a stock router; it falls back to uclient-fetch rather than pull curl onto an 8 MB
# device for one API call. jsonfilter and sha256sum ARE in the base image. Do not add a
# runtime dep for a convenience tool — fall back instead.
LUCI_DEPENDS:=+luci-base
LUCI_PKGARCH:=all
# Else luci.mk defaults these to LuCI's own, and the package claims MAINTAINER "OpenWrt LuCI
# community" / URL openwrt/luci.
LUCI_MAINTAINER:=VizzleTF <vizzletf47@gmail.com>
LUCI_URL:=https://github.com/VizzleTF/luci-theme-footstrap

# CSS: ship verbatim. luci.mk would run csstidy over it, which is old enough to mangle
# :has()/color-mix()/nested calc() and break the layout. build-css.sh minifies instead.
LUCI_MINIFY_CSS:=0
#
# JS: DO let luci.mk minify it — LUCI_MINIFY_JS defaults to 1, so this is the absence of an
# opt-out. That is jsmin (luci-base/src/jsmin.c, on the buildbot already since luci-base/host is
# a build dep). ~72 KB of this theme's 127 KB of JS is comments, and uhttpd serves /www with NO
# compression, so those are wire AND flash bytes: jsmin ships 47 KB, git keeps every word.
#
# The catch, and why the gates exist: jsmin decides `/` = regex-or-division from a ONE-character
# lookback, and `n` (of `return`) and `>` (of `=>`) are not on its allow-list — so `return /re/`
# makes it eat the rest of the file AND EXIT 0 (openwrt/luci#8299). eslint's `wrap-regex` bans
# the shape; tools/jsmin-verify.mjs proves jsmin's output is TOKEN-IDENTICAL to the source.

# TWO licences, for two bodies of work.
#
# Apache-2.0 — the theme, and not a free choice: styles/base began as a fork of
# luci-theme-bootstrap's cascade.css, the ucode templates derive from LuCI's own, and a few JS
# helpers are verbatim copies. The notices travel with it.
#
# OFL-1.1 — the webfonts. OFL §2 requires every copy of the Font Software to carry the
# copyright notice AND the licence, and these .woff2 are unicode-range SUBSETS whose subsetter
# strips the licence out of the font's own metadata — so the text ships beside them.
PKG_LICENSE:=Apache-2.0 OFL-1.1
PKG_LICENSE_FILES:=LICENSE htdocs/luci-static/footstrap/fonts/OFL.txt

# RELOAD, NOT RESTART: rpcd holds sessions in memory, so `restart` logs out every LuCI user —
# including the admin who just clicked Update. `reload` sends SIGHUP, which re-reads
# /usr/share/rpcd/acl.d/*, and that ACL refresh is the only thing this package needs from rpcd.
# Verified on a live router: a session survives `reload` and dies across `restart`; deleting our
# acl.d file + `reload` flips `session access` for the self-update script from true to false.
define Package/luci-theme-footstrap/postinst
#!/bin/sh
[ -n "$${IPKG_INSTROOT}" ] || {
	# uci-defaults registers the theme; refresh rpcd + drop caches so LuCI sees it without a
	# reboot. Calling it ourselves is belt-and-braces: OpenWrt's default_postinst also runs
	# (then deletes) every /etc/uci-defaults/* we ship, so it executes twice per install. It is
	# idempotent, and its fresh-vs-upgrade marker is written at the end of the first pass, so
	# that pass still sees a fresh install.
	[ -f /etc/uci-defaults/30_luci-theme-footstrap ] && \
		sh /etc/uci-defaults/30_luci-theme-footstrap >/dev/null 2>&1 || true
	rm -f /tmp/luci-indexcache* /tmp/luci-modulecache/* >/dev/null 2>&1 || true
	/etc/init.d/rpcd reload >/dev/null 2>&1 || true
}
exit 0
endef

define Package/luci-theme-footstrap/postrm
#!/bin/sh
[ -n "$${IPKG_INSTROOT}" ] || {
	# Every theme name this package has ever registered. postrm runs when uci-defaults is
	# already deleted, so it cannot source the list: it is duplicated by necessity and
	# mirror-pinned so it cannot drift. Only the assignment is byte-identical — the `$$` is
	# make's escaping.
# @mirror theme/legacy-names
LEGACY_THEMES="Footstrap FootstrapDark FootstrapLight FootstrapTop FootstrapTopDark FootstrapTopLight FootstrapSidebar FootstrapOnTop"
# @endmirror
	for t in $$LEGACY_THEMES; do
		uci -q delete "luci.themes.$$t"
	done
	# The router's DEFAULT layout, set by uci-defaults when migrating an old top-nav install.
	# It means nothing to any other theme, and left behind it would silently re-apply the top
	# bar on a later reinstall.
	uci -q delete luci.main.footstrap_layout
	# Don't leave the active theme pointing at the media dir we just removed. The same TWO-part
	# check uci-defaults uses: a theme needs its media dir AND its ucode template to render, so
	# a one-part check could hand the UI to a half-removed bootstrap — the blank page this
	# branch exists to avoid.
	case "$$(uci -q get luci.main.mediaurlbase)" in
		/luci-static/footstrap*)
			[ -d /www/luci-static/bootstrap ] && \
			[ -f /usr/share/ucode/luci/template/themes/bootstrap/header.ut ] && \
				uci set luci.main.mediaurlbase=/luci-static/bootstrap ;;
	esac
	uci commit luci
	# The "installed before" marker uci-defaults writes to tell fresh from upgrade. Removing it
	# makes uninstall-then-reinstall count as fresh again.
	rm -rf /usr/share/luci-theme-footstrap >/dev/null 2>&1 || true
	rm -f /tmp/luci-indexcache* /tmp/luci-modulecache/* >/dev/null 2>&1 || true
	/etc/init.d/rpcd reload >/dev/null 2>&1 || true	# see the postinst note: reload keeps sessions
}
endef

# Runs right after luci.mk copies luasrc/ucode/htdocs/root/src into PKG_BUILD_DIR, so it
# rewrites the build copy, never the source tree.
#
# 1. cascade.css is generated, not committed — and styles/ is not in luci.mk's copy list, so
#    build-css.sh reads it from $(CURDIR) and writes into the build tree. cat/awk only, no host
#    toolchain: that is why it runs on an OpenWrt buildbot.
# 2. Stamp the git-derived version into the theme JS (popover + update check). Skipped when
#    PKG_VERSION is empty, leaving the '0.0.0-dev' literal.
# 3. Compile the translation catalogue INTO this package.
#
# THE CATALOGUE SHIPS INSIDE THIS PACKAGE — not how a luci-app does it. Undoing that re-opens
# two production bugs.
#
# A `po/` dir makes luci.mk emit a separate `luci-i18n-footstrap-<lang>` package per language.
# v0.8.4 did, and it broke the update button on every router in the field (issue #6):
#   1. The release then has several assets, and the `footstrap-selfupdate.sh` users ALREADY
#      have picks with `grep -E '\.apk$$' | head -1`. GitHub sorts assets BY NAME and
#      `luci-i18n-…` sorts before `luci-theme-…`, so Update installed the 6 KB catalogue
#      instead of the theme, reported success, and re-offered the same update forever. An
#      installed self-updater cannot be fixed remotely — only the RELEASE can, so it stays at
#      ONE asset per format (CI asserts it).
#   2. Two packages drift: an _() the older catalogue lacks renders in English, reporting
#      nothing. Bundled, they cannot disagree.
# Price: ~3.6 KB of catalogue on an English router.
#
# Hence `po/` -> `i18n/`: LUCI_LANGUAGES is `$(wildcard po/*)`, so the rename is what stops the
# language packages. po2lmo (luci-base/host, already a build dep) lands in hostpkg/bin BEFORE
# this hook — hence here, not Build/Compile, which a post-include `define` cannot override.
#
# Basename `footstrap-theme.<lang>.lmo`, NOT `footstrap.<lang>.lmo`: lmo_load_catalog globs
# `*.<lang>.lmo` so any basename loads, and a v0.8.4 router still OWNS `footstrap.ru.lmo` via
# the old luci-i18n package — same path = file conflict = apk refuses the very upgrade that
# fixes it.
define Build/Prepare/luci-theme-footstrap
	# luci.mk's Build/Prepare copies only src/ luasrc/ htdocs/ root/ ucode/ po/ into
	# $(PKG_BUILD_DIR), and PKG_LICENSE_FILES resolves against THAT — so the Apache text has to
	# be put there by hand or the declaration points at nothing. (The fonts' OFL.txt lives under
	# htdocs/, which luci.mk already copies.)
	$(CP) $(CURDIR)/LICENSE $(PKG_BUILD_DIR)/
	$(SHELL) $(CURDIR)/build-css.sh $(PKG_BUILD_DIR)/htdocs/luci-static/footstrap/cascade.css
	$(if $(PKG_VERSION),$(SED) "s#const FS_VERSION = '[^']*'#const FS_VERSION = '$(PKG_VERSION)'#" \
		$(PKG_BUILD_DIR)/htdocs/luci-static/resources/menu-footstrap-common.js)
	$(INSTALL_DIR) $(PKG_BUILD_DIR)/root/usr/lib/lua/luci/i18n
	$(foreach po,$(wildcard $(CURDIR)/i18n/*/*.po), \
		po2lmo $(po) \
			$(PKG_BUILD_DIR)/root/usr/lib/lua/luci/i18n/footstrap-theme.$(notdir $(patsubst %/,%,$(dir $(po)))).lmo;)
endef

# Absolute, not a relative path: CI rsyncs this package into package/, not into the feed.
include $(TOPDIR)/feeds/luci/luci.mk

