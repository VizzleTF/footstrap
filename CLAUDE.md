# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

`luci-theme-footstrap` — LuCI theme for **OpenWrt 25.12+ only** (older releases not supported). Fork of `luci-theme-bootstrap`. Deep design/architecture research lives in `docs/01`–`docs/10` (Russian) — read the relevant doc before non-trivial changes. Communicate in Russian.

## What a LuCI theme is (25.12+)

LuCI runs on **ucode**, not Lua. Page content is rendered **client-side** by app view-JS (`luci-mod-*`); the server only emits a shell: theme header + empty `#view` + footer. So this theme = **server chrome (ucode `header.ut`/`footer.ut`) + one `cascade.css` + client menu-JS**. There is no build step and no server-side content — CSS + templates + JS are copied to the router as-is.

Theme selection: `uci luci.main.mediaurlbase` → `basename` → template dir `themes/<basename>/header`. A broken `header.ut` does not brick the UI — LuCI falls back to another registered theme and shows a "Theme fallback" indicator (see `docs/01`).

## Two layouts, one stylesheet

Registered in `luci.themes` (System → System → Language and Style), **2 entries**: `FootstrapSidebar` (`/luci-static/footstrap`) and `FootstrapOnTop` (`/luci-static/footstrap-top`). Mode (auto/light/dark) and palette are **client-side** toggles in the Appearance popover, not theme entries. The six legacy entries (`Footstrap`, `…Dark`, `…Light`, `FootstrapTop`, …) are deleted and their `mediaurlbase` collapsed onto the base layout by `uci-defaults`. `header.ut` still derives a forced mode from a `-dark`/`-light` name suffix (the media/template symlinks are kept so a stale `mediaurlbase` never 404s), else auto (client `data-darkmode` from `localStorage`/`prefers-color-scheme`).

- `ucode/template/themes/footstrap/` — sidebar templates (real dir); `footstrap-top/` — top-nav templates (real dir). `-dark`/`-light` are **symlinks** to their base template dir.
- `htdocs/luci-static/footstrap/` — the only real media dir (holds `cascade.css`, `fonts/`, logos). `footstrap-dark|light|top|top-dark|top-light` are **symlinks → footstrap**, so every variant serves the same `cascade.css`.
- Layout is switched by class: sidebar uses `.fs-shell`/`.fs-sidebar`; top-nav uses `body.fs-top` + `.fs-topnav`. Both consume the same tokens/components; sidebar rules don't match top markup and vice-versa.
- `menu-footstrap.js` (vertical, collapsible sections) and `menu-footstrap-top.js` (horizontal + hover dropdowns) render the client menu into `#topmenu`/`#tabmenu`/`#modemenu` and wire the `#fs-theme-toggle` button.

## cascade.css architecture (critical)

~3400 lines. Structure top-to-bottom:
1. `@font-face` (self-hosted Manrope + JetBrains Mono).
2. **Token block** (`:root` + `:root[data-darkmode="true"]`) — footstrap tokens (`--bg/--panel/--panel2/--border/--text/--dim/--accent/--good/--warn/--danger` …) **plus a bridge** that maps the legacy bootstrap computed vars (`--background-color-high`, `--primary-color-medium`, `--*-color-*-hsl`, `--text-color-*`, …) onto footstrap tokens. This is why the ~2600 lines of unmodified bootstrap rules re-theme without editing them.
3. Unmodified bootstrap base rules (the fork).
4. Appended **footstrap sections** (shell layout, overview polish, audit fixes, top-nav, buttons, tabs) that override the base.

Rules when editing CSS:
- **Do not edit the base 2600 lines.** Add an override block at the end; source-order + specificity make it win.
- If you change/replace the token block, re-add every HSL component token base rules reference (`--background-color-h/s/l`, `--border-color-low-hsl`, `--text-color-low-hsl`, …) or shadows/text-shadows silently break. Audit: `grep var(--x)` used vs `--x:` defined (see `docs` history / the "audit fixes" block).
- Un-themed spots = hardcoded color literals (`#hex`/`rgb()`) in base rules that bypass the bridge — map them to tokens.
- **Overview tables**: discriminate by `id`. Key/value includes (System, Memory) render `<table class="table">` **without** id → 2-col label/value style. Data tables (DHCP leases = `id="status_leases"`) have an **id** → data-table style. Use `.table[id]` vs `.table:not([id])`.
- `:has()` and `color-mix()` are used (modern browsers only — fine for target). After any CSS edit, brace-check: `python3 -c "s=open(F).read();print(s.count('{'),s.count('}'))"`.

## Overview layout include (theme/mod boundary)

`htdocs/luci-static/resources/view/status/include/05_footstrap_overview_layout.js` is an **additive**, layout-only overview include (unique filename → no collision with `luci-mod-status`; LuCI auto-discovers `*.js` in that dir, `05_` sorts first). It renders **no content of its own** — it only re-arranges the **stock** System/Memory/Storage sections: a `MutationObserver` on `#view` tags those three `.cbi-section`s by title and wraps them in `.fs-ovl`, so CSS grid puts System in the left column across both rows with Memory (top) + Storage (bottom) in the right column (`.fs-ovl` block in `cascade.css`). The stock poll updates each section **in place** (`dom.content`), never rebuilding the `.cbi-section` wrapper, so the moved wrappers stay put across polls (minimal flicker, no full-tree swap — the reason the earlier full-custom `05_footstrap_dashboard.js` was dropped: rebuilding a page-tall tree every poll flickered and reset mobile scroll). Its own empty stock wrapper is hidden via `#view > .cbi-section:has(.fs-ovl-marker)`. Gated on a footstrap theme being active (`L.env.media`).

## Package / registration

- `Makefile`: `include ../../luci.mk`, `LUCI_DEPENDS:=+luci-base`; `luci.mk` auto-installs `ucode/→/usr/share/ucode/luci`, `htdocs/→/www`, `root/→/`. `postrm` deletes every `luci.themes.*` entry (current + legacy names). `postinst` re-runs the uci-defaults script, so it executes on **upgrade** too (apk maps `postinst` to both `post-install` and `post-upgrade`).
- `root/etc/uci-defaults/30_luci-theme-footstrap` is the single source of truth for registration: deletes all legacy names, registers the 2 layouts, migrates `luci.main.mediaurlbase` (legacy `-dark`/`-light` → base layout; a dangling path → `bootstrap`), and drops the index/module caches. Fresh installs default to the sidebar layout (`PKG_UPGRADE` guard). **Never register themes anywhere else** — `dev-sync.sh` runs this same script.
- Version is git-derived; don't set `PKG_VERSION`. 25.12 packages are **apk** (`apk add --allow-untrusted *.apk`), not opkg/ipk.

## Development workflow (no build — deploy to a live router)

Test router: `ssh router` (OpenWrt 25.12.2, mediatek/filogic, apk). **Never break it; back up before touching files** (`/root/theme-backup/`). Login for authed testing: root + password set during dev.

Deploy everything: `luci-theme-footstrap/dev-sync.sh` (copies both layouts' templates, `cascade.css`, fonts, both menu-JS, the overview-layout include; recreates media/template symlinks; registers themes idempotently; **does not** change the active theme).

Iterate faster on single files:
```sh
scp -q luci-theme-footstrap/htdocs/luci-static/footstrap/cascade.css router:/www/luci-static/footstrap/
ssh router 'touch /lib/apk/db/installed; rm -f /tmp/luci-indexcache*'
```
- `touch /lib/apk/db/installed` bumps `pkgs_update_time` → changes the `cascade.css?v=` cache-bust so a plain F5 reloads CSS.
- `rm /tmp/luci-indexcache*` clears the menu/dispatch cache.
- Syntax-check ucode templates on the router (LuCI's own `trycompile`): `ssh router 'ucode -T -c -o /dev/null <template>.ut'`.

Verify a change (content is client-JS, so `curl` only sees the shell — activate the theme briefly, then revert):
```sh
ssh router '
  orig=$(uci get luci.main.mediaurlbase)
  uci set luci.main.mediaurlbase=/luci-static/footstrap; uci commit luci; rm -f /tmp/luci-indexcache*
  curl -s -c /tmp/j -b /tmp/j --data-urlencode luci_username=root --data-urlencode luci_password=<pw> -o /dev/null http://127.0.0.1/cgi-bin/luci/
  curl -s -b /tmp/j http://127.0.0.1/cgi-bin/luci/admin/status/overview | grep -o "cbi-section\|Unable to render"
  uci set luci.main.mediaurlbase=$orig; uci commit luci'   # always revert
```
Local tooling note: `node` is a broken nvm shim here — don't rely on it; brace/paren-check JS/CSS with `python3` instead.

## Build the .apk (distribution)

Via OpenWrt SDK: symlink the package into `feeds/luci/themes/`, `./scripts/feeds install luci-theme-footstrap`, `make package/luci-theme-footstrap/compile V=s`. Full steps in `docs/05`.

## Commit rules

Conventional Commits, message in English. **Never commit without an explicit instruction.** No co-author / "Generated with" / any AI attribution trailers.
