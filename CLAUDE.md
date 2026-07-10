# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

`luci-theme-footstrap` — LuCI theme for **OpenWrt 25.12+ only** (older releases not supported). Deep design/architecture research lives in `docs/01`–`docs/17` (Russian) — read the relevant doc before non-trivial changes; `docs/17` covers the CSS build and cascade layers. Communicate in Russian.

The theme is standalone: it ships no framework and depends on nothing but `luci-base`. `styles/base/` began as a fork of `luci-theme-bootstrap`'s cascade.css and is being absorbed rule by rule — but it is footstrap's code now, so **do not describe it as "the fork" or reintroduce the word bootstrap** into filenames, comments or docs. The only place that name legitimately survives is where it denotes the *other, real* package: the `/luci-static/bootstrap` fallback in `uci-defaults`, the benchmark baseline in `bench/`, and the Apache-2.0 attribution block in `styles/00-header.css` (a licence obligation, not a description).

## What a LuCI theme is (25.12+)

LuCI runs on **ucode**, not Lua. Page content is rendered **client-side** by app view-JS (`luci-mod-*`); the server only emits a shell: theme header + empty `#view` + footer. So this theme = **server chrome (ucode `header.ut`/`footer.ut`) + one `cascade.css` + client menu-JS**. There is no server-side content — templates and JS are copied to the router as-is; the only build step is `build-css.sh`, a `cat` that concatenates `styles/` into `cascade.css`.

Theme selection: `uci luci.main.mediaurlbase` → `basename` → template dir `themes/<basename>/header`. A broken `header.ut` does not brick the UI — LuCI falls back to another registered theme and shows a "Theme fallback" indicator (see `docs/01`).

## Two layouts, one stylesheet

Registered in `luci.themes` (System → System → Language and Style), **2 entries**: `FootstrapSidebar` (`/luci-static/footstrap`) and `FootstrapOnTop` (`/luci-static/footstrap-top`). Mode (auto/light/dark) and palette are **client-side** toggles in the Appearance popover, not theme entries — dark mode comes from `data-darkmode`, set before paint by the inline script in `partials/head.ut` from `localStorage`/`prefers-color-scheme`. The six legacy entries (`Footstrap`, `…Dark`, `…Light`, `FootstrapTop`, …) are deleted, their `-dark`/`-light` media and template dirs are gone, and `uci-defaults` migrates a stale `mediaurlbase` onto a surviving layout before the on-disk check runs.

- `ucode/template/themes/footstrap/` — sidebar templates (real dir); `footstrap-top/` — top-nav templates (real dir). No symlinks.
- `htdocs/luci-static/footstrap/` — the only real media dir (holds `cascade.css`, `fonts/`, logos). `footstrap-top` is a **symlink → footstrap**, so both layouts serve the same `cascade.css`.
- Layout is switched by class: sidebar uses `.fs-shell`/`.fs-sidebar`; top-nav uses `body.fs-top` + `.fs-topnav`. Both consume the same tokens/components; sidebar rules don't match top markup and vice-versa.
- `menu-footstrap.js` (vertical, collapsible sections) and `menu-footstrap-top.js` (horizontal + hover dropdowns) render the client menu into `#topmenu`/`#tabmenu`/`#modemenu` and wire the `#fs-theme-toggle` button.

## CSS architecture (critical)

**`htdocs/luci-static/footstrap/cascade.css` is generated — never edit it.** It is gitignored and produced by `luci-theme-footstrap/build-css.sh`, which concatenates the `styles/` tree and strips comments/indentation (166 KB → 110 KB; uhttpd serves `/www/luci-static/*.css` with **no gzip**, so bytes are wire bytes). `build-css.sh` runs from the package `Makefile` (`Build/Prepare/luci-theme-footstrap`) and from `dev-sync.sh`; it needs only `cat`/`awk`, so an OpenWrt buildbot can run it. Use `--dev` to keep comments.

**One directory per cascade layer**; within each, the filename prefix is the source order:
- `styles/00-header.css` — licence banner + the **only** `@layer` declaration.
- `styles/01-fonts.css` — `@font-face`, unlayered.
- `styles/02-tokens.css`, `03-palettes.css` — `@layer tokens`. Footstrap tokens (`--bg/--panel/--panel2/--border/--text/--dim/--accent/…`) **plus a bridge** onto the `--*-color-*` names LuCI themes conventionally expose. The bridge is not bookkeeping: `styles/base` and any third-party `luci-app-*` stylesheet address those names, so one palette edit repaints both.
- `styles/base/*.css` — `@layer base`, the widget defaults every LuCI view assumes: reset, typography, forms, tables, chrome, modal, buttons, cbi-dropdown, widgets, LuCI-specific. Split from a single 2300-line file; rule order inside the layer is unchanged.
- `styles/theme/10-chrome.css` — `@layer theme`, the chrome both layouts share (brand, logo, wordmark, logout, indicators, `ul.nav` menu primitives). Its values are the **top-nav** ones. A layout file may set placement on these (`flex`, `order`, the icon-rail collapse) but never their look — they used to be described twice and had drifted.
- `styles/theme/15`–`90` — `@layer theme`, one file per component/layout concern (palette-rvht, shell-sidebar, progressbar, tables, alerts, tabs, misc, topnav, buttons, inputs, dropdown, modal, responsive).
- `styles/pages/*.css` — `@layer page`, per-page corrections (login, overview, software).

Layer order is `tokens, base, theme, page`. A later layer beats an earlier one **regardless of specificity**, so a theme rule never needs `!important` to outrank a base rule. Unlayered rules beat every layer and that slot is deliberately empty — it is the escape hatch.

Rules when editing CSS:
- **Coverage is a contract — never drop the styling of a selector because no shipped LuCI page uses it.** Third-party `luci-app-*` packages on other users' routers render widgets stock LuCI never does (the reason `docs/gallery.html` exists): a selector with no on-router example *today* is still styled for the package that emits it tomorrow. You may **move or merge** a rule between files/layers (that is the whole absorption process), but the set of selectors the theme styles — and the fact that each stays themed — must only ever grow. "This looks unused, delete it" un-themes someone's app; deletion is never a cleanup. Consolidation means folding two rules into one that still matches everything both did, not removing coverage.
- **Do not edit `styles/base/` to change how something looks.** Put the override in the matching `styles/theme/` file; the layer makes it win. Base is being *absorbed*, not patched: delete a block from it, run `cssdiff` over both layouts, and whatever the diff reports is exactly what the theme still has to own — write those rules into the right component file and re-run until the diff is empty. `docs/17` records the categories left.
- **`docs/gallery.html`** renders every widget LuCI (or any third-party `luci-app-*`) can emit, with the real class names, so the theme can be checked without hunting for a router page that uses the widget. It is not shipped: `scp docs/gallery.html router:/www/luci-static/footstrap/` and open `http://<router>/luci-static/footstrap/gallery.html` — no login needed.
- **`!important` in `styles/theme` and `styles/pages` is down to 20 declarations and all of them fight an inline `style=` attribute**, not another rule: `29_ports.js` writes `style="margin:.25em;min-width:70px;max-width:100px"` on each Port status tile, and `ui.js` positions an open dropdown list with inline `left`/`right`. No cascade layer can outrank an inline declaration — only an author `!important` can. Do not remove those; do not add new ones.
- **`!important` inverts the layer order** — an important declaration in `base` beats an important one in `theme`. `styles/base` keeps 20 of them (eleven carry the `.cbi-dropdown` widget's internal layout, six are the `.left/.right/.center/.top/.middle/.bottom` forcing utilities, three fight inline `style=`), so those base rules still win. If a theme rule needs `!important` to beat *another footstrap rule*, that rule belongs in a later layer or the two rules should be merged — do not add the flag.
- Verify any non-trivial CSS change with the computed-style differ, not screenshots: it swaps the `<link>` on a live page so live counters can't produce false diffs. See "Verify a CSS change" below.
- If you change/replace the token block, re-add every HSL component token base rules reference (`--background-color-h/s/l`, `--border-color-low-hsl`, `--text-color-low-hsl`, …) or shadows/text-shadows silently break. Audit: `grep var(--x)` used vs `--x:` defined.
- Un-themed spots = hardcoded color literals (`#hex`/`rgb()`) that bypass the bridge — `audit.py` reports them and `styles/base` is currently at **zero**. Keep it there: a literal cannot follow a palette or dark mode.
- **Edit the rule that already styles a selector; never append a second one.** `audit.py` reports any declaration shadowed by a later rule on the same selector in the same layer, and that count is currently **zero**. Appending is how this stylesheet became a changelog held together by 220 `!important`.
- **Do not let source order carry meaning.** Two rules at equal specificity resolve by position, which silently breaks the moment a file is reordered or merged. Win on specificity instead (`.cbi-page-actions .cbi-dropdown.cbi-button-apply`, not `.cbi-button-apply` written afterwards). The one deliberate exception is documented in place, in `theme/55-buttons.css`.
- **Overview tables**: discriminate by `id`. Key/value includes (System, Memory) render `<table class="table">` **without** id → 2-col label/value style. Data tables (DHCP leases = `id="status_leases"`) have an **id** → data-table style. Use `.table[id]` vs `.table:not([id])`.
- `:has()`, `color-mix()`, `@layer` and `:where()` are used (modern browsers only — fine for target). `build-css.sh` brace-checks its own output and refuses to write an unbalanced file.

## Overview layout include (theme/mod boundary)

`htdocs/luci-static/resources/view/status/include/05_footstrap_overview_layout.js` is an **additive**, layout-only overview include (unique filename → no collision with `luci-mod-status`; LuCI auto-discovers `*.js` in that dir, `05_` sorts first). It renders **no content of its own** — it only re-arranges the **stock** System/Memory/Storage sections: a `MutationObserver` on `#view` tags those three `.cbi-section`s by title and wraps them in `.fs-ovl`, so CSS grid puts System in the left column across both rows with Memory (top) + Storage (bottom) in the right column (`.fs-ovl` block in `cascade.css`). The stock poll updates each section **in place** (`dom.content`), never rebuilding the `.cbi-section` wrapper, so the moved wrappers stay put across polls (minimal flicker, no full-tree swap — the reason the earlier full-custom `05_footstrap_dashboard.js` was dropped: rebuilding a page-tall tree every poll flickered and reset mobile scroll). Its own empty stock wrapper is hidden via `#view > .cbi-section:has(.fs-ovl-marker)`. Gated on a footstrap theme being active (`L.env.media`).

## Package / registration

- `Makefile`: `include ../../luci.mk`, `LUCI_DEPENDS:=+luci-base`; `luci.mk` auto-installs `ucode/→/usr/share/ucode/luci`, `htdocs/→/www`, `root/→/`. `postrm` deletes every `luci.themes.*` entry (current + legacy names). `postinst` re-runs the uci-defaults script, so it executes on **upgrade** too (apk maps `postinst` to both `post-install` and `post-upgrade`).
- `root/etc/uci-defaults/30_luci-theme-footstrap` is the single source of truth for registration: deletes all legacy names, registers the 2 layouts, migrates `luci.main.mediaurlbase` (legacy `-dark`/`-light` → base layout; a dangling path → `bootstrap`), and drops the index/module caches. Fresh installs default to the sidebar layout (`PKG_UPGRADE` guard). **Never register themes anywhere else** — `dev-sync.sh` runs this same script.
- Version is git-derived; don't set `PKG_VERSION`. 25.12 packages are **apk** (`apk add --allow-untrusted *.apk`), not opkg/ipk.

## Development workflow (one `cat`-based CSS build — deploy to a live router)

Test router: `ssh router` (OpenWrt 25.12.2, mediatek/filogic, apk). **Never break it; back up before touching files** (`/root/theme-backup/`). Login for authed testing: root + password set during dev.

Deploy everything: `luci-theme-footstrap/dev-sync.sh` (rebuilds `cascade.css` from `styles/`, copies both layouts' templates, fonts, both menu-JS, the overview-layout include; recreates the `footstrap-top` media symlink and sweeps the legacy variant dirs; registers themes idempotently; **does not** change the active theme).

Iterate faster on CSS alone — rebuild first, the file on the router is generated:
```sh
luci-theme-footstrap/build-css.sh /tmp/cascade.css --dev
scp -q /tmp/cascade.css router:/www/luci-static/footstrap/cascade.css
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
Verify a CSS change (`docs/17`). Screenshots are useless here: live counters (uptime, DHCP leases, wifi signal) move 0.5–1.3% of the pixels between two runs of the *same* stylesheet, while a real regression can be 0.19%. `cssdiff.py` loads a page once, snapshots `getComputedStyle` for every element, swaps the `<link>` to the second stylesheet and snapshots again — same DOM, same data, so every difference is caused by CSS:
```sh
scp -q old.css router:/www/luci-static/footstrap/cascade-a.css
scp -q new.css router:/www/luci-static/footstrap/cascade-b.css
LUCI_PW=<pw> .claude/tooling/preview-venv/bin/python .claude/skills/footstrap-audit/cssdiff.py \
  admin/network/firewall admin/system/system admin/status/overview admin/system/opkg
```

Local tooling note: `node` is a broken nvm shim here — don't rely on it; brace/paren-check JS/CSS with `python3` instead.

## Build the .apk (distribution)

Via OpenWrt SDK: symlink the package into `feeds/luci/themes/`, `./scripts/feeds install luci-theme-footstrap`, `make package/luci-theme-footstrap/compile V=s`. Full steps in `docs/05`.

## Commit rules

Conventional Commits, message in English. **Never commit without an explicit instruction.** No co-author / "Generated with" / any AI attribution trailers.
