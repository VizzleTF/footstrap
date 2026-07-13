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
# +luci-base only, deliberately: the self-updater used to hard-require `curl`,
# which is NOT in OpenWrt's default package set (the base image ships
# uclient-fetch; on the dev router /usr/bin/curl is owned by an explicitly
# installed curl package). Rather than pull curl and its deps onto an 8 MB device
# for one API call, footstrap-selfupdate.sh now falls back to uclient-fetch —
# so the theme still depends on nothing but luci-base. jsonfilter and sha256sum,
# which it also uses, ARE in the base image.
LUCI_DEPENDS:=+luci-base
LUCI_PKGARCH:=all
# Without these, luci.mk defaults them to the LuCI project's own values and the
# built package claims MAINTAINER "OpenWrt LuCI community" / URL openwrt/luci.
LUCI_MAINTAINER:=VizzleTF <vizzletf47@gmail.com>
LUCI_URL:=https://github.com/VizzleTF/luci-theme-footstrap

# CSS: ship verbatim. luci.mk would run it through csstidy, which is old enough to
# mangle modern CSS (:has(), color-mix(), nested calc()) and break the layout. The
# stylesheet is minified by build-css.sh instead, which only drops comments and
# indentation and understands strings.
LUCI_MINIFY_CSS:=0
#
# JS: DO let luci.mk minify it (LUCI_MINIFY_JS defaults to 1, so this is the absence
# of an opt-out, not an opt-in). That is jsmin, built from luci-base/src/jsmin.c —
# already on the buildbot, since luci-base/host is a build dependency — and it is what
# every other LuCI package uses. Most of this theme's JS is comments (~78 KB of 126 KB),
# and uhttpd serves /www with NO compression, so those are wire bytes AND flash bytes.
# jsmin takes the shipped JS from 126 KB to 40 KB, comments stay in git.
#
# The catch, and why the gates exist: jsmin decides `/` = regex-or-division from a
# ONE-character lookback, and `n` (from `return`) and `>` (from `=>`) are not on its
# allow-list — so `return /re/` can make it eat the rest of the file AND EXIT 0
# (openwrt/luci#8299). Two things stop that reaching a release:
#   - eslint `wrap-regex` forbids writing the hazardous shape at all;
#   - tools/jsmin-verify.mjs proves jsmin's output is TOKEN-IDENTICAL to the source.
# Both run in CI. See CLAUDE.md.

PKG_LICENSE:=Apache-2.0
PKG_LICENSE_FILES:=LICENSE

# RELOAD, NOT RESTART — this is the difference between "the theme updated" and
# "everyone using LuCI was logged out".
#
# rpcd keeps its sessions in memory, so `restart` destroys every one of them: the
# admin who clicked Update, and anyone else logged in at the time. `reload` sends
# SIGHUP, which re-reads /usr/share/rpcd/acl.d/* — and that ACL refresh is the
# ONLY thing this package needs from rpcd.
#
# Verified on a live router, not assumed: a session created before `reload`
# survives it and dies across `restart`; and removing our acl.d file + `reload`
# flips `session access` for the self-update script from true to false, so SIGHUP
# demonstrably re-reads the ACL directory.
define Package/luci-theme-footstrap/postinst
#!/bin/sh
[ -n "$${IPKG_INSTROOT}" ] || {
	# uci-defaults registers the theme entries; refresh rpcd + clear caches so
	# LuCI picks them up without a reboot.
	#
	# The explicit call is deliberate belt-and-braces: OpenWrt's own
	# default_postinst ALSO runs (and then deletes) every /etc/uci-defaults/* the
	# package ships, so on a normal install the script runs twice. It is idempotent,
	# and the fresh-vs-upgrade marker is written at the end of the first run, so the
	# first pass still sees a fresh install. Keeping our own call means registration
	# does not depend on that host behaviour staying the way it is.
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
	# The same set uci-defaults registers/deletes. postrm runs when that file is already gone,
	# so it cannot source it — the list is duplicated by necessity and PINNED, so it cannot
	# drift. Only the assignment is byte-identical; the `$$` below is make's escaping.
# @mirror theme/legacy-names
LEGACY_THEMES="Footstrap FootstrapDark FootstrapLight FootstrapTop FootstrapTopDark FootstrapTopLight FootstrapSidebar FootstrapOnTop"
# @endmirror
	for t in $$LEGACY_THEMES; do
		uci -q delete "luci.themes.$$t"
	done
	# the theme's own server-side setting: the router's DEFAULT layout, which
	# uci-defaults sets when migrating an old top-nav install. It means nothing to any
	# other theme, and leaving it behind would silently re-apply the top bar if this
	# package were reinstalled later.
	uci -q delete luci.main.footstrap_layout
	# don't leave the active theme pointing at the media dir we just removed —
	# fall back to bootstrap instead of relying on LuCI's runtime fallback.
	# The same TWO-part check uci-defaults uses: a theme needs its media dir AND its
	# ucode template to render. Testing only for cascade.css would hand the UI to a
	# half-removed bootstrap and produce the blank page this branch exists to avoid.
	case "$$(uci -q get luci.main.mediaurlbase)" in
		/luci-static/footstrap*)
			[ -d /www/luci-static/bootstrap ] && \
			[ -f /usr/share/ucode/luci/template/themes/bootstrap/header.ut ] && \
				uci set luci.main.mediaurlbase=/luci-static/bootstrap ;;
	esac
	uci commit luci
	# The "have we been installed before" marker that uci-defaults writes (it is what
	# tells a fresh install from an upgrade). Removing it here means an uninstall
	# followed by a reinstall is correctly treated as fresh again.
	rm -rf /usr/share/luci-theme-footstrap >/dev/null 2>&1 || true
	rm -f /tmp/luci-indexcache* /tmp/luci-modulecache/* >/dev/null 2>&1 || true
	/etc/init.d/rpcd reload >/dev/null 2>&1 || true	# see the postinst note: reload keeps sessions
}
endef

# luci.mk calls this hook right after copying luasrc/ucode/htdocs/root/src into
# PKG_BUILD_DIR, so we rewrite the build copy — never the source tree.
#
# 1. cascade.css is generated, not committed: build-css.sh concatenates
#    the four styles/ dirs (styles/, base/, theme/, pages/) and strips comments.
#    They are not in luci.mk's copy list, so we read them from $(CURDIR) and write the result
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
