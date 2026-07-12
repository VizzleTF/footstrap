# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

`luci-theme-footstrap` — LuCI theme for **OpenWrt 24.10 and newer**. Deep design/architecture research lives in `docs/01`–`docs/18` (Russian) — read the relevant doc before non-trivial changes; `docs/17` covers the CSS build and cascade layers, `docs/18` the best-practice baseline and the audit. Communicate in Russian.

**Both releases are supported, and the API surface is genuinely the same** — verified against `openwrt-24.10` of `openwrt/luci`, not assumed:
- LuCI on 24.10 is already **ucode**, not Lua (`modules/luci-base/ucode/` exists there), and every template API this theme uses is present: `ctx.path`, `ctx.request_path`, `entityencode`, `striptags`, `dispatcher.build_url/lookup/lang`, `ubus.call`, `pkgs_update_time` (whose 24.10 definition already falls back from `/lib/apk/db/installed` to `/usr/lib/opkg/status`).
- The `L.env` blob that `luci-base`'s own `template/header.ut` emits is **byte-identical** between the branches, so `L.env.dispatchpath` — which the whole menu and the SPA router key off — exists on both.
- `luci.mk` on 24.10 honours `LUCI_MINIFY_CSS`/`LUCI_MINIFY_JS` (both pinned to `0` here), so csstidy never gets to mangle `:has()`/`color-mix()`.
- Packaging differs only in the manager: **apk** on 25.12+, **opkg**/`.ipk` on 24.10. CI builds both; `install.sh` and `footstrap-selfupdate.sh` detect which one is present.

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

**`htdocs/luci-static/footstrap/cascade.css` is generated — never edit it.** It is gitignored and produced by `luci-theme-footstrap/build-css.sh`, which concatenates the `styles/` tree, strips comments and then squeezes the whitespace CSS ignores (~218 KB → **106 KB**; uhttpd serves `/www/luci-static/*.css` with **no gzip**, so bytes are wire bytes). The squeeze deletes the space after `:`, the spaces around `{ } ; ,` and the last `;` of a block, and nothing else — it leaves the single space between selectors alone (`.a .b` is a descendant combinator, `.a.b` is not) and never touches `calc()` or a string. Proven behaviour-neutral with `cssdiff` (0 diffs over ~4000 elements). The `/*!` licence banner is copied verbatim — it is an Apache-2.0 attribution, not formatting. It also enforces a **size budget** and refuses to write an oversized stylesheet. `build-css.sh` runs from the package `Makefile` (`Build/Prepare/luci-theme-footstrap`) and from `dev-sync.sh`; it needs only `cat`/`awk`, so an OpenWrt buildbot can run it. Use `--dev` to keep comments.

**One directory per cascade layer**; within each, the filename prefix is the source order:
- `styles/00-header.css` — licence banner + the **only** `@layer` declaration.
- `styles/01-fonts.css` — `@font-face`, unlayered.
- `styles/02-tokens.css`, `03-palettes.css` — `@layer tokens`. **Two tiers, and the split is load-bearing.** *Private:* `--fs-*` (`--fs-bg/--fs-panel/--fs-text/--fs-accent/…`, the radius scale, the z-index scale `--fs-z-*` — every z-index in the theme comes from there). **Every rule in this theme reads only these.** *Export:* the `--*-color-*` names LuCI themes conventionally expose, defined **from** the private tier and read by **nobody** inside footstrap — they exist so a third-party `luci-app-*` stylesheet keeps working and keeps following the palette and dark mode.
  The export tier is a **ramp, not a set of aliases** — `high`/`medium`/`low` must be three different colours, because consumers ask for a gradation and get whatever we define. All three used to alias one token, so `luci-app-podkop` painted its "no data" latency with `--primary-color-low` and got the same vivid accent as a live value. The ramp's axis is **chroma at constant lightness** (`color-mix(in oklch, … , var(--fs-dim))`): fading `low` toward the surface — the intuitive "muted" — spends contrast the palette does not have (on `--fs-panel2` in dark every accent already sits at 4.56:1, i.e. +0.06 over AA), and pushing `high` toward `--fs-text` collapses the ramp in dark mode, where `--fs-text` is near-white. `tools/export-tier.mjs` enforces all of it; the full reasoning is in `02-tokens.css`.
  Why the private tier exists at all: `:root` is a **shared** global scope — every `luci-app-*` drops its CSS into the same document, **unlayered, which outranks every cascade layer**. One app writing `:root { --accent: … }`, or `--radius`/`--text`/`--border` (names anyone would pick), used to repaint this whole theme silently. Base reading the *export* names was the wider hole still: `--text-color-high` is a LuCI **convention**, so an app is *likelier* to declare it. Measured on `docs/gallery.html` with a hostile `:root`: **312 of 336 elements repainted before the split, 0 after.** `audit.py` fails on any read of an export name from inside `styles/`, so the coupling cannot grow back. Element-scoped locals (`--bd-color`, `--fg-color`, `--on-color`, `--focus-color`, `pre`'s `--border-color`) are exempt — they are declared inside the rule that reads them and cannot be hijacked from a foreign `:root`.
- `styles/base/*.css` — `@layer base`, the widget defaults every LuCI view assumes: reset, typography, forms, tables, chrome, modal, buttons, cbi-dropdown, widgets, LuCI-specific. Split from a single 2300-line file; rule order inside the layer is unchanged.
- `styles/theme/10-chrome.css` — `@layer theme`, the chrome both layouts share (brand, logo, wordmark, logout, indicators, `ul.nav` menu primitives). Its values are the **top-nav** ones. A layout file may set placement on these (`flex`, `order`, the icon-rail collapse) but never their look — they used to be described twice and had drifted.
- `styles/theme/15`–`95` — `@layer theme`, one file per component/layout concern (wallpaper, shell-sidebar, progressbar, tables, alerts, tabs, misc, topnav, buttons, inputs, dropdown, modal, responsive, a11y-media).
- `styles/theme/95-a11y-media.css` — `prefers-reduced-motion` and `forced-colors`. The reduced-motion block is the ONE place a new `!important` is legitimate: the flag inverts the layer order, so it is the only way a single rule can stop animations declared in `base` as well as in `theme`. Do not copy the flag out of that block.
- `styles/pages/*.css` — `@layer page`, per-page corrections (login, overview, software).

Layer order is `tokens, base, theme, page`. A later layer beats an earlier one **regardless of specificity**, so a theme rule never needs `!important` to outrank a base rule. Unlayered rules beat every layer and that slot is deliberately empty — it is the escape hatch.

Rules when editing CSS:
- **The inks (`--fs-on-accent`/`--fs-on-good`/`--fs-on-warn`/`--fs-on-danger`) are per palette AND per mode**, and live in `03-palettes.css` next to the fills they must be legible against — never as one global value in `02-tokens.css`. A dark palette has LIGHT fills and therefore needs a DARK ink. A single global `--fs-on-accent: #fff` failed WCAG AA on seven of the eight dark-palette fills (down to 1.69:1). A new colourway must set all four and check them against its own fills.
- **Fonts are split by `unicode-range`** (`styles/01-fonts.css`): 3 faces (Manrope 600/700, JetBrains Mono 400) × {latin, latin-ext, cyrillic}. Measured against the live router, a Latin UI fetches **3 files / 46 KB** and touches neither cyrillic nor latin-ext; 68 KB ships in total. There is deliberately **no Manrope 400** — `font-weight: normal` resolves onto the 600 face, so body text is semibold by design; adding a 400 costs ~13 KB and restyles every page.
- **There is no bold mono, and it must not come back.** A `<strong>` is a LABEL — LuCI writes every status readout as `<strong>MAC:</strong> ac:1f:6b:…` — so it takes the UI face even on a monospaced surface (`theme/45-misc.css`; the same goes for `.ifacebadge`, a badge, and for `code`/`pre`, whose literal must not inherit a container's emphasis). Before that rule, 227 elements over seven pages rendered in bold mono and the browser fetched `jetbrains-mono-600` (20 KB) to draw the word "MAC:" — 30% of the whole font payload. **Anything now asking for mono at weight ≥600 gets synthetic bold, which smears a monospace grid**; if a rule seems to need bold mono, the real question is whether that element is a label (then it is not mono at all), not whether to re-add 20 KB. Note that *excluding* an element from the mono rule does nothing — it still **inherits** mono from its parent; the sans face has to be **assigned**.
- `build-css.sh` and CI enforce a size budget on both the CSS and the font bytes. The font budget is a **ratchet** (70 KB now) — tighten it when bytes go away, so they cannot drift back.
- **Coverage is a contract — never drop the styling of a selector because no shipped LuCI page uses it.** Third-party `luci-app-*` packages on other users' routers render widgets stock LuCI never does (the reason `docs/gallery.html` exists): a selector with no on-router example *today* is still styled for the package that emits it tomorrow. You may **move or merge** a rule between files/layers (that is the whole absorption process), but the set of selectors the theme styles — and the fact that each stays themed — must only ever grow. "This looks unused, delete it" un-themes someone's app; deletion is never a cleanup. Consolidation means folding two rules into one that still matches everything both did, not removing coverage.
- **`styles/base/` is editable — all of it is.** Prefer overriding in the matching `styles/theme/` file (the layer makes it win without touching base), but you may edit base directly when that is genuinely the right place: converting a base rule off the raw HSL/rgb component bridge onto `color-mix()`/token colours, fixing a base bug, or absorbing a block. Base is being *absorbed*: delete a block, run `cssdiff` over both layouts, and whatever the diff reports is what the theme must own — write those rules into the right component file and re-run until the diff is empty. Any base edit that changes rendered output must be justified by a near-empty `cssdiff` (intended shifts only) — that is the guardrail, not a blanket prohibition. `docs/17` records the categories left.
- **`docs/gallery.html`** renders every widget LuCI (or any third-party `luci-app-*`) can emit, with the real class names, so the theme can be checked without hunting for a router page that uses the widget. It is not shipped: `scp docs/gallery.html router:/www/luci-static/footstrap/` and open `http://<router>/luci-static/footstrap/gallery.html` — no login needed.
- **`!important` in `styles/theme` and `styles/pages` is 16 declarations: 12 of them fight something no cascade layer can outrank**, and the remaining 4 are the reduced-motion block in `95-a11y-media.css` (see above). Eight (`pages/20-overview.css`) fight an inline `style=`: `29_ports.js` writes `style="margin:.25em;min-width:70px;max-width:100px"` on each Port tile, `display:grid;grid-template-columns:…;margin-bottom:1em` on their grid, `display:flex` on the zone bar we hide, and `text-align:left;font-size:80%` on the traffic figures (the `text-align:right` flag is scoped to the wide card by a `@container` query — on the narrow one the inline `left` is what we want, so an unscoped flag would have been wrong). Four (`theme/90-responsive.css`) fight an inline `left`/`right` written by `ui.js` on an open dropdown list, and the unlayered `<style>` blob (`.controls{display:flex}`) that `package-manager.js` injects — unlayered beats every layer. Do not remove those; do not add new ones. **Every flag must fight an inline or unlayered declaration; one that fights another footstrap rule is redundant** — this was checked property by property against the emitting JS and 11 such flags were removed (`cssdiff`: 0 diffs).
- **`!important` inverts the layer order** — an important declaration in `base` beats an important one in `theme`. `styles/base` keeps 17 of them (eight carry the `.cbi-dropdown` widget's internal layout, six are the `.left/.right/.center/.top/.middle/.bottom` forcing utilities, two fight inline `style=` — the zone-colour gradient and the `stroke:black` on the realtime graphs' `<line>`s — and one, `.spinning`'s `padding-left`, must out-important the dropdown's own `padding: 0 !important` for the spinning Save & Apply control), so those base rules still win. If a theme rule needs `!important` to beat *another footstrap rule*, that rule belongs in a later layer or the two rules should be merged — do not add the flag.
- Verify any non-trivial CSS change with the computed-style differ, not screenshots: it swaps the `<link>` on a live page so live counters can't produce false diffs. See "Verify a CSS change" below.
- **Both component bridges are gone: the HSL one (`--*-hsl` triples, `--*-h/s/l` parts) and the RGB one that outlived it** (`--accent-rgb`, `--error-color-high-rgb`, `--success-color-high-rgb`, read as `rgba(var(--x), .3)`). They were the same mistake in two notations — a second, hand-kept copy of a colour that already exists as a token: it goes stale in silence when a palette is recoloured, and if the triple ever goes missing the declaration is invalid at computed-value time, so the tint just vanishes with no error (`audit.py` cannot catch that either — the var IS defined, only elsewhere). Every rule that read them takes `color-mix()` over the palette token now; `color-mix(in srgb, C p%, transparent)` is exactly `rgba(C, p/100)` (the mix is premultiplied — proven by rasterising both). **A tint of X is mixed FROM X. Do not reintroduce a component copy of a colour in any notation** — that includes writing `--accent-soft` as a literal restating `--accent`'s RGB, which is how it used to be. The one surviving `--*-rgb` is `--zone-color-rgb`, and it is not ours: `luci-mod-network` writes it inline on a zone badge.
- Un-themed spots = hardcoded color literals (`#hex`/`rgb()`) that bypass the bridge — `audit.py` reports them and `styles/base` is currently at **zero**. Keep it there: a literal cannot follow a palette or dark mode.
- **Edit the rule that already styles a selector; never append a second one.** `audit.py` reports any declaration shadowed by a later rule on the same selector in the same layer, and that count is currently **zero**. Appending is how this stylesheet became a changelog held together by 220 `!important`.
- **A base declaration a later layer repaints on the same selector is dead — and `audit.py` now fails on it (`--strict`), currently at zero.** Layers beat specificity, so `theme`/`page` outrank `base` unconditionally, and base is not a fallback either: if a theme value goes invalid at computed-value time the property falls back to `unset`, never to base. **But deletability is decided by the whole selector GROUP, not the one selector.** Base groups upstream widgets together (`.cbi-button-positive, .cbi-button-fieldadd, .cbi-button-add, .cbi-button-save`), and theme often repaints only some of them. Dropping the rule because it "looks overridden" un-themes the rest — the widgets no shipped LuCI page renders but a third-party `luci-app-*` does. So `audit.py` reports two lists: the **removable** one (every member repainted → deleting changes nothing) and the **absorption backlog** (only some members repainted → *do not delete*; absorb by writing the uncovered selectors into `theme` first). The backlog stands at **50 declarations** and is the real to-do list for finishing base. Note the checker is deliberately conservative: it only matches *identical* selectors, so a base rule like `.alert-message.warning { background }` that theme kills via a plain `.alert-message { background }` is dead too but is not reported — proving that needs selector-superset reasoning, and a wrong matcher there would un-theme someone's app. `cssdiff` cannot protect you here: an un-rendered widget shows no diff.
- **Do not let source order carry meaning.** Two rules at equal specificity resolve by position, which silently breaks the moment a file is reordered or merged. Win on specificity instead (`.cbi-page-actions .cbi-dropdown.cbi-button-apply`, not `.cbi-button-apply` written afterwards). The one deliberate exception is documented in place, in `theme/55-buttons.css`.
- **Overview tables**: discriminate by `id`. Key/value includes (System, Memory) render `<table class="table">` **without** id → 2-col label/value style. Data tables (DHCP leases = `id="status_leases"`) have an **id** → data-table style. Use `.table[id]` vs `.table:not([id])`.
- `:has()`, `color-mix()`, `@layer` and `:where()` are used (modern browsers only — fine for target). `build-css.sh` brace-checks its own output and refuses to write an unbalanced file.

## Overview layout include (theme/mod boundary)

`htdocs/luci-static/resources/view/status/include/05_footstrap_overview_layout.js` is an **additive**, layout-only overview include (unique filename → no collision with `luci-mod-status`; LuCI auto-discovers `*.js` in that dir, `05_` sorts first). It renders **no content of its own** — it only re-arranges the **stock** System/Memory/Storage sections: a `MutationObserver` on `#view` tags those three `.cbi-section`s by title and wraps them in `.fs-ovl`, so CSS grid puts System in the left column across both rows with Memory (top) + Storage (bottom) in the right column (`.fs-ovl` block in `cascade.css`). The stock poll updates each section **in place** (`dom.content`), never rebuilding the `.cbi-section` wrapper, so the moved wrappers stay put across polls (minimal flicker, no full-tree swap — the reason the earlier full-custom `05_footstrap_dashboard.js` was dropped: rebuilding a page-tall tree every poll flickered and reset mobile scroll). Its own empty stock wrapper is hidden via `#view > .cbi-section:has(.fs-ovl-marker)`. Gated on a footstrap theme being active (`L.env.media`). The observer's callback has an **O(1) fast path** — one `isConnected` check on the wrapper it built — because it fires on every poll tick; it deliberately does NOT `disconnect()` after wrapping, so that if a future `luci-mod-status` ever does rebuild a section, the grid self-heals instead of staying broken.

## Package / registration

- `Makefile`: `include ../../luci.mk`, `LUCI_DEPENDS:=+luci-base`; `luci.mk` auto-installs `ucode/→/usr/share/ucode/luci`, `htdocs/→/www`, `root/→/`. `postrm` deletes every `luci.themes.*` entry (current + legacy names) and removes the install marker (`/usr/share/luci-theme-footstrap`). `postinst` re-runs the uci-defaults script, so it executes on **upgrade** too (apk maps `postinst` to both `post-install` and `post-upgrade`).
- `root/etc/uci-defaults/30_luci-theme-footstrap` is the single source of truth for registration: deletes all legacy names, registers the 2 layouts, migrates `luci.main.mediaurlbase` (legacy `-dark`/`-light` → base layout; a dangling path → `bootstrap`), and drops the index/module caches. **Fresh install vs upgrade is decided by a marker file** (`/usr/share/luci-theme-footstrap/.installed`, written at the end of the script and removed by `postrm`): a fresh install may activate the sidebar layout, an upgrade must never change the active theme. It used to key off a `PKG_UPGRADE` env var, which apk never sets — the guard was dead in production and only `dev-sync.sh` (which exports it by hand) ever took the upgrade branch. **Never register themes anywhere else** — `dev-sync.sh` runs this same script.
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
LUCI_PW=<pw> python3 .claude/skills/footstrap-audit/cssdiff.py \
  admin/network/firewall admin/system/system admin/status/overview admin/system/opkg
```

## Writing JS: comments are free, regex literals are not

**Comment as densely as you like — the comments do not ship.** `luci.mk` runs the theme's
JS through **jsmin** at package time (built from `luci-base/src/jsmin.c`; `luci-base/host`
is already a build dependency, so it is on the buildbot). Half of this theme's JS is
comments — ~41 KB of 83 KB — and jsmin takes the shipped bytes from **83 KB to 35 KB**
(−57%) while the source in git keeps every word. uhttpd serves `/www` with **no
compression**, so those were wire bytes *and* flash bytes on a 8–16 MB device. Explaining
*why* a line exists costs the user nothing. Do it.

**The constraint is on regex literals, and it is a correctness rule, not style.**
jsmin decides whether a `/` opens a **regex** or a **division** by looking at exactly ONE
preceding character against a fixed allow-list (`( , = : [ ! & | ? + - ~ * / { } ;`).
Neither `n` — the last letter of `return` — nor `>` from `=>` is on it. So:

```js
return /^https?:\/\//i.test(addr);   // jsmin reads the regex's // as a comment,
                                      // swallows the REST OF THE FILE, and exits 0.
return (/^https?:\/\//i.test(addr)); // `(` is on the allow-list. Safe.
```

That is not theoretical — it is openwrt/luci#8299, #8020, #8021, #8256. **A zero exit code
from jsmin proves nothing**; the corruption is silent.

Rules:
- **Never write a regex literal directly after `return` or `=>`. Wrap it in parentheses.**
  Machine-enforced: eslint's `wrap-regex` fails the build. `npx eslint --fix` writes the parens for you.
- A regex passed as an **argument** (`s.replace(/x/g, y)`) is already preceded by `(` or `,` — safe, and not flagged.
- **Never put a backtick inside a `${…}` expression** in a template literal (jsmin loses the string; it fails loudly, but do not do it).
- Everything else measured safe on this codebase: division, strings containing `//`, plain template literals, regexes containing `//` or `*/` **when they sit behind an allow-listed character**.

Two gates back this up, and both run in CI:
- **`wrap-regex`** (eslint) — stops the hazardous shape being written at all.
- **`tools/jsmin-verify.mjs`** — builds the same jsmin from upstream, minifies every shipped
  file, and fails unless the output's **token stream is identical** to the source's (acorn).
  This is the only check that catches the exit-0 corruption. `jsmin.c` is byte-identical on
  `openwrt-24.10` and `master`, so one build covers both releases.

`.claude/skills/footstrap-audit/audit.py` deliberately does **not** count brackets in JS any
more: a bracket counter cannot lex JS, and the hand-rolled attempt tripped over the `//`
inside `.replace(/\//g, '.')` — the very bug class above. eslint owns JS correctness.

## Lint / a11y gates (npm — CI and local only, never the buildbot)

`package.json` + `eslint.config.mjs` + `.stylelintrc.json` at the repo root exist for
checks, **nothing there is shipped**: `luci.mk` copies `htdocs/` and `ucode/` verbatim and
the OpenWrt buildbot has no node. Run them before pushing:

```sh
npm run lint         # eslint (theme JS) + stylelint (styles/ tree)
npm run a11y         # axe-core, WCAG 2.2 AA, over docs/gallery.html
npm run export-tier  # the --*-color-* contract with third-party luci-app-*
npm run i18n         # the .pot is current and every string is translated
```

- **eslint** needs `ecmaFeatures.globalReturn` — a LuCI resource file is evaluated inside a
  function wrapper, which is why each ends in a bare `return baseclass.extend({…})`. The
  `'require x as y'` pragma names (`common`) are declared as globals; they are real
  bindings at runtime that ESLint cannot see.
- **stylelint** deliberately does NOT extend `stylelint-config-standard` (it is a
  formatter and would rewrite the whole tree). Only correctness rules, plus the project's
  own invariants: `declaration-no-important` with the same allowlist `audit.py` uses.
- **axe-core** runs over `docs/gallery.html` — a STATIC file that renders every widget, so
  the whole widget surface is auditable with no router. It sweeps the full
  `{light,dark} × {footstrap,hicontrast}` matrix: a palette switcher multiplies the
  contrast matrix, and that is precisely where failures hide (a 1.69:1 white-on-green
  survived in hicontrast dark until this gate existed).
- **Chip/badge rule learned the hard way**: never put text of colour C on a *translucent
  tint of C*. The tint drags the background toward the text and eats its own contrast, and
  being translucent its rendered value depends on the surface underneath — so no
  percentage is safe everywhere. Give the chip an opaque surface (`--panel2`) and let the
  border carry the colour. `audit.py` cannot see this; axe can.
- **`tools/export-tier.mjs`** guards the one thing axe *cannot* see: the outbound
  `--*-color-*` tier. Those widgets belong to other people's packages (`luci-app-podkop`,
  `luci-app-justclash`, stock `firewall.js`/`status/cpu.js` all read them), so they are not
  in the gallery and no contrast check ever looked at them. It proves each level is legible
  as **text** on all three surfaces, that the matching `--on-*-color` is legible **on** it as
  a fill, and that `high`/`medium`/`low` are three *different* colours — see the ramp note in
  `02-tokens.css`. That last check exists because they were once three aliases of one token
  and **a flat colour passes every contrast threshold there is**; only a spread check fails on it.

## i18n — a `_()` with no catalogue is silently English

Strings are wrapped in `_()` in the theme JS and the `.ut` templates, and `partials/head.ut`
already loads LuCI's client-side catalogue (`admin/translations/<lang>`). But `luci.mk`
derives `LUCI_LANGUAGES` from **`po/*`**, so with no `po/` directory no language package was
ever built and every `_()` fell through to its English msgid — the Appearance popover said
"Palette"/"Rounding"/"Cats" on a Russian LuCI and nothing reported a thing. **A missing
translation cannot fail loudly by construction; that is why `--check` is a CI gate.**

- `luci-theme-footstrap/update-po.sh` rescans and merges; `--check` fails if the `.pot` is
  stale or any msgstr is empty. Run it after adding or changing **any** `_()` string.
- It uses LuCI's own `build/i18n-scan.pl`, which knows how to lex a `.ut` (it rewrites the
  template into JS before xgettext) and also picks up the `rpcd` ACL title. A grep for `_('…')`
  would miss the ACL string and choke on any apostrophe.
- **Nothing to add to the Makefile**: `LUCI_TYPE`/`LUCI_BASENAME` resolve to `theme`/`footstrap`,
  `LUCI_LANG.ru` is already defined in `luci.mk`, and it runs `po2lmo` itself → the package
  `luci-i18n-footstrap-ru` appears as soon as `po/ru/footstrap.po` exists.
- Verified end-to-end on the router (compiled `.lmo` → `uci set luci.main.lang=ru`), not
  merely by `msgfmt` exiting 0.

## Build the .apk (distribution)

Via OpenWrt SDK: symlink the package into `feeds/luci/themes/`, `./scripts/feeds install luci-theme-footstrap`, `make package/luci-theme-footstrap/compile V=s`. Full steps in `docs/05`.

## Commit rules

Conventional Commits, message in English. **Never commit without an explicit instruction.** No co-author / "Generated with" / any AI attribution trailers.
