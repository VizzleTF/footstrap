# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

`luci-theme-footstrap` — LuCI theme for **OpenWrt 24.10 and newer**. Deep design/architecture research lives in `docs/01`–`docs/22` (Russian; 10 and 12 do not exist) — read the relevant doc before non-trivial changes; `docs/17` covers the CSS build and cascade layers, `docs/18` the best-practice baseline and the audit, `docs/21` the changelog contract, `docs/22` the SPA best-practice baseline + the router's measured audit (`docs/14` is how the router works; `docs/22` is how a router *should* work and where ours does not). Communicate in Russian.

**Both releases are supported, and the API surface is genuinely the same** — verified against `openwrt-24.10` of `openwrt/luci`, not assumed:
- LuCI on 24.10 is already **ucode**, not Lua (`modules/luci-base/ucode/` exists there), and every template API this theme uses is present: `ctx.path`, `ctx.request_path`, `entityencode`, `striptags`, `dispatcher.build_url/lookup/lang`, `ubus.call`, `pkgs_update_time` (whose 24.10 definition already falls back from `/lib/apk/db/installed` to `/usr/lib/opkg/status`).
- The `L.env` blob that `luci-base`'s own `template/header.ut` emits is **byte-identical** between the branches, so `L.env.dispatchpath` — which the whole menu and the SPA router key off — exists on both.
- `luci.mk` on 24.10 honours `LUCI_MINIFY_CSS` (pinned to `0` here), so csstidy never gets to mangle `:has()`/`color-mix()`. `LUCI_MINIFY_JS` is deliberately left at its default of `1` — that is jsmin, which the theme *wants* (see "Writing JS" below); the CSS is minified by `build-css.sh` instead.
- Packaging differs only in the manager: **apk** on 25.12+, **opkg**/`.ipk` on 24.10. CI builds both; `install.sh` and `footstrap-selfupdate.sh` detect which one is present.

The theme is standalone: it ships no framework and depends on nothing but `luci-base`. `styles/base/` began as a fork of `luci-theme-bootstrap`'s cascade.css and is being absorbed rule by rule — but it is footstrap's code now, so **do not describe it as "the fork" or reintroduce the word bootstrap** into filenames, comments or docs. The only place that name legitimately survives is where it denotes the *other, real* package: the `/luci-static/bootstrap` fallback in `uci-defaults`, the benchmark baseline in `bench/`, and the Apache-2.0 attribution block in `styles/00-header.css` (a licence obligation, not a description).

## What a LuCI theme is (25.12+)

LuCI runs on **ucode**, not Lua. Page content is rendered **client-side** by app view-JS (`luci-mod-*`); the server only emits a shell: theme header + empty `#view` + footer. So this theme = **server chrome (ucode `header.ut`/`footer.ut`) + one `cascade.css` + client menu-JS**. There is no server-side content — templates and JS are copied to the router as-is; the only build step is `build-css.sh`, a `cat` that concatenates `styles/` into `cascade.css`.

Theme selection: `uci luci.main.mediaurlbase` → `basename` → template dir `themes/<basename>/header`. A broken `header.ut` does not brick the UI — LuCI falls back to another registered theme and shows a "Theme fallback" indicator (see `docs/01`).

## One theme, one template, one renderer — layout is a CLIENT preference

Registered in `luci.themes` (System → System → Language and Style): **1 entry**, `Footstrap` (`/luci-static/footstrap`). `mediaurlbase` is always that path. Layout (sidebar / top bar) joined mode, palette, tint, accent and rounding as a **client-side** toggle in the Appearance popover — it is NOT a theme entry and NOT a server choice. Every legacy entry (`FootstrapSidebar`, `FootstrapOnTop`, the six `…Dark`/`…Light`/`…Top` names) is deleted, their media and template dirs are gone, and `uci-defaults` migrates a stale `mediaurlbase` onto the one surviving path before the on-disk check runs.

**There was never a second design.** The sidebar renderer already emitted markup its own CSS turns into a horizontal bar on a phone, and it already had a *flyout mode* (`flyoutMode()`) in which a section behaves exactly like a top-nav dropdown. The top layout IS that mode at desktop width. So the second renderer, the second template and the second stylesheet were deleted; the only unique logic they carried was `clampDropdown` (nudge a dropdown back inside the viewport near the right edge), which moved into the surviving renderer. Hover-to-open is pure CSS. Do not reintroduce a second renderer/template for a layout.

- **`:root[data-layout]` carries the layout, ALWAYS with an explicit value (`sidebar` | `top`), stamped by the SERVER** in `partials/head.ut` (`<html data-layout=…>`), then overridden before paint by the inline script from `localStorage.fs-layout`. Two reasons it is never absent: every layout rule can then match **positively** (a future third layout must opt in, instead of inheriting the sidebar's rules merely by not being `top` — which is what `:not([data-layout="top"])` would have done), and the chrome is correct with JS disabled. **Never write a `:not([data-layout=…])` guard.**
- **Toggling the layout re-renders nothing.** The DOM already serves both; CSS morphs the chrome, and `menu-footstrap.js`'s `MutationObserver` on `data-layout` folds the accordion into dropdowns / restores it — the same state change as collapsing the icon rail. `applyLayout()` is the one Appearance axis that writes its DEFAULT value **explicitly** (`'sidebar'`, not `lsDel`), because a migrated router carries a server default that would otherwise re-assert `top`.
- **Migration:** a router that was on the old top-nav theme keeps its bar. A shell script cannot write `localStorage`, so `uci-defaults` records the router's DEFAULT layout in `luci.main.footstrap_layout=top`; `head.ut` stamps it, and the user's own choice overrides it forever after. `postrm` deletes the key.
- `ucode/template/themes/footstrap/` — the ONE template dir. `htdocs/luci-static/footstrap/` — the ONE media dir. No `-top` dir, no symlink.
- `menu-footstrap.js` is the ONE renderer (vertical accordion / bar dropdowns / rail flyouts — all the same markup); `menu-footstrap-common.js` is the chrome BOOTSTRAP and everything else is one module per concern — see "The JS modules" below.
- **The BAR is the base; the vertical sidebar is the exception.** The bar is what the chrome IS — for the top layout at every width, and for the sidebar layout on a phone. It is written ONCE, unguarded, in `styles/theme/20-shell.css`. The vertical sidebar is a single guarded override (`@media(min-width:521px){ :root[data-layout="sidebar"]:not([data-narrow]) … }`) and it wins on **specificity** (`0,4,0` vs `0,1,0`), never on source order. The guard is **not** a viewport breakpoint dressed up as one: `data-narrow` is what actually decides (see `fs-fit`/`fitShell` below), and `521px` is only the floor below which no sidebar cut could leave a readable column anyway. `50-toplayout.css` is a pure **delta** — only what the top-layout bar adds (designed height, content-aligned padding, menu on the brand's row, per-item dropdown anchoring). It has **no `@media` floor**: the top bar is measured at *every* width (see `fitChrome` below), so those deltas — and the per-item dropdown anchor + its `clampDropdown` — apply from 320px up. There is no separate left-pinned "phone bar" for the top layout; the SIDEBAR layout keeps its own (the base `left:16px` panel), decided by `data-narrow`.
  Why this way round: the bar is needed when `(≤767px) OR ([data-layout="top"])`, and CSS cannot OR a media query with an attribute selector in one selector — so writing the bar under both guards meant writing it twice (measured: 55 of ~75 declarations identical, free to drift). Inverting states each of the three chrome states exactly once. **This is only expressible because `data-layout` always carries an explicit value.** The price is that the vertical override must answer every declaration the bar makes — which is precisely what `cssdiff` proves (desktop sidebar byte-identical). If you add a declaration to the bar, ask whether the column needs to undo it, and re-run `cssdiff`.
- **The bar stacks its menu onto a second row by MEASUREMENT, not by a breakpoint** (`.fs-bar-stack`, set in `fs-chrome.js` `fitChrome()`). Whether the menu fits beside the brand depends on how many sections the router has, not on the screen — so there is no `@media` for it. The unstacked top bar is `flex-wrap: nowrap` on purpose: otherwise flexbox wraps the BAR, hands the menu a whole row, and the "does it fit" measurement always says yes. Escalation is shrink → collapse the poll pill → stack: `.fs-dense1/2` trims the pills first, then `.fs-ind-compact` swaps the "Refreshing" pill for a bordered icon square (frees ~56px — often enough to stay on one row), and only when even that still wraps does the menu take its own row (`.fs-ind-compact` stays set). All measured, at any width.

## The JS modules — one concern each, and the runtime enforces the graph

A LuCI resource module is reached through `L.require`, which **instantiates it once as a singleton**
and passes it into the dependent's factory as a formal parameter (`'require fs-prefs as prefs'`).
Two consequences the whole layout rests on: a module can never be `extend`-ed by another (a base
class across modules throws — docs/11, proven, not assumed), so composition is by **calling**, never
by inheriting; and `require()` **raises `DependencyError` on a cycle**, so the graph below is a DAG
that the runtime itself checks. Shared halves are pulled DOWN into their own module rather than
reached across — that is what keeps it acyclic.

| module | owns |
|---|---|
| `fs-fit.js` | the one "does it still fit?" engine (below) |
| `fs-menutree.js` | path ⇄ menu node; the `alias`/`firstchild` resolution, a port of `dispatcher.uc` |
| `fs-prefs.js` | the Appearance axes and their `localStorage` (the live half of the `axes` gate) |
| `fs-widgets.js` | disclosure primitives (`setOpen`/`wireSpaceKey`/`wireDismiss`), the seg/slider controls, `EDGE_GAP` + `placePopover` |
| `fs-chrome.js` | mode menu, section tabs, the rail toggle, `fitShell`/`fitChrome` |
| `fs-select.js` | **two concerns, and the name only says one**: `<select>` → `ui.Dropdown` + typeahead, *and* the data tables' card stacking (`fitTables`). Loaded by `partials/footer.ut`, not required by any module |
| `fs-sheets.js` | third-party CSS: keeping it out of the chrome, and off every later page |
| `fs-router.js` | the SPA client router (docs/14) |
| `fs-update.js` | **`FS_VERSION`**, the update check, the one-click self-update |
| `fs-appearance.js` | the popover DOM |
| `menu-footstrap-common.js` | the BOOTSTRAP: load the tree once, hand it out, wire the rest in order |
| `menu-footstrap.js` | the ONE menu renderer; injects `renderMainMenu` into `common.init` |

Dependencies: `prefs→fit`, `widgets→prefs`, `chrome→{fit,prefs,menutree}`, `appearance→{prefs,widgets,update}`,
`update→prefs`, `select→fit`, `router→{menutree,chrome,sheets,update}`, `common→` all.

- **`FS_VERSION` lives in `fs-update.js`, and the FILE NAME is part of the contract**: the package
  `Makefile` (`Build/Prepare`) and `dev-sync.sh` both stamp the git version by `sed`-ing that literal
  **by path**. Moving the constant means changing both, and nothing else would notice — the popover
  would just show "(dev)" and the update check would go quiet.
- **Splitting cost 2 500 B of minified JS** (46 621 → 49 121 B, +5.4%). Each module adds its pragmas
  and a `return baseclass.extend({…})`, and each call across a seam grows an alias prefix; uhttpd does
  not compress, so those are wire bytes. It buys no file over ~600 lines and gates that can no longer
  be aimed at one stale filename. `require()` resolves dependencies with `Promise.all`, so the extra
  files cost round-trips in **parallel**, not in series. (There is no longer a minified-JS size budget
  in CI — removed; keep the modules lean by judgement, not by a byte ceiling.)

## `fs-fit.js` — the one "does it still fit?" engine, and what may and may not be measured

Some decisions in this theme depend on what the **content** needs, not on how wide the screen is, and no CSS query can ask that: a media query measures the viewport, a container query measures the container, and neither can know what the content requires. Those decisions are measured. `fs-fit.js` owns the measuring, the frame-coalescing and the ResizeObserver; a caller registers a fitter (`fit.add(fn)`) and supplies only the decision. Both the top bar (`fitChrome`) and the data tables (`fitTables` in `fs-select.js`) use it. **Add new "does it fit" logic here — do not grow a second observer.**

It owns two more shared primitives, and they are here because the alternative was measured: the pattern got hand-rolled instead.
- **`fit.frame(fn)`** — coalesce any callback into one call per frame. `fit.schedule()` runs *every* fitter, so a caller that only wants its own work batched cannot use it, and three of them (`fs-select`'s select scan, the overview's grid re-arrange, the menu's clamp reset) had each written the identical five lines. **Exception, and it is a real one:** `menu-footstrap.js`'s dropdown clamp keeps a rAF handle *per `<li>`* so it can **cancel** a pending measure when the pointer moves on; a shared one-flag coalescer cannot express that. Leave it alone.
- **`fit.touches(mutations, sel, {removed})`** — "is any of this batch even mine?". LuCI's poll rewrites content once a second, so every MutationObserver here needs that question before it does document-wide queries; two of them had written the same triple loop. Each caller keeps its own `sel` — the two care about different things, and a shared filter that pretends otherwise starts lying to one of them.

**`--fs-sidebar-w` / `--fs-rail-w` / `--fs-content-min` are TOKENS (`02-tokens.css`), and `fitShell()` reads them back with `getComputedStyle`.** The stylesheet lays the sidebar out; the JS subtracts its cut from the viewport to decide whether what is LEFT is still readable (`data-narrow`). The JS used to carry its own `SIDEBAR_W = 224, RAIL_W = 68, CONTENT_MIN = 500` against bare literals in the CSS — narrow the rail in the stylesheet and the measurement would go on subtracting the old width, with nothing in the build to notice. **`data-narrow` is the single source of "the sidebar has become a bar": the CSS guards on it and `menu-footstrap.js`'s `flyoutMode()` reads it.** It used to ask `matchMedia('(max-width: 767px)')` instead, and in the 768–779px window the chrome painted as a bar while the menu still behaved like an accordion (measured on the router). **Never re-introduce a viewport breakpoint for that question.**

Three rules it exists to enforce, each of them a bug that was actually hit:
1. **Measure UNCOLLAPSED.** A collapsed thing always "fits" — a stacked table is a pile of flex rows, a wrapped menu owns a whole row. Reading it as it stands un-collapses it and the next frame collapses it again: oscillation. Strip the class, read, then decide.
2. **Re-fit SYNCHRONOUSLY on a mutation.** A `MutationObserver` callback is a microtask — it runs *before* the frame is painted; `requestAnimationFrame` runs *at* paint. LuCI's poll re-renders content once a second and the fresh element comes back without our class, so deferring the re-fit to rAF let a stacked table paint one frame at full width and overflow its section, every tick (measured: 19–109 px, once a second).
3. **Coalesce on resize**, because each fit forces a synchronous layout.

**A CONFIG table (`.cbi-section-table`) is NOT measurable, and must keep its `@container` (960) — do not "finish the job" by moving it onto the measurement.** Its rows are full of widgets (`fs-select.js` turns every `<select>` into a `ui.Dropdown`), and a widget bakes in a width from the layout it was laid out in — so un-collapsing one to take a reading *changes the thing being read*. Measured on the live router: after that toggle the firewall's zone table reported it needed 1747 px where it really needs 1190 px, then overflowed its section by 557 px — an overflow the CSS-only version never had. **The act of measuring was the bug.** A data table has no widgets, which is exactly why it is the one that gets measured. The cost is the last duplicated card block — the same declarations under a CLASS (`.fs-stacked`) and under an `@container`, which CSS cannot share; it is **pinned** `@mirror table-card/{label,actions}` so the two copies cannot drift apart.

**The card contract is ONE contract, and it was once split in half — do not split it again.** The stack is *measured*, so it fires at any viewport width; but the table's own `display: block`, the `.hide-xs`/`.hide-sm` columns stock LuCI drops, and the `.col-N` weights all used to live only inside `@media (max-width: 767px)`. In the sidebar layout the content column is `viewport − 224 − 56`, so between roughly **768 and 860 px** it is already below the "too cramped" floor while the media query has switched off: measured on the router at 790/820/850 px, the leases table carded while still `display: table`, and the wireless list rendered **all five** of its `.hide-xs` cells. Those now key off `.fs-stacked`.
The `.col-N` weights need **no guard at all** and are unguarded in `theme/30-tables.css`: `flex` applies only to a *flex item*, and a `.td` becomes one exactly when its table cards — by **either** mechanism, at any width. So one copy serves the phone tier, the measured stack and the config table's `@container` alike, and the config table (which cards at a **960 px container**, i.e. possibly on a 1200 px desktop) got its weights for the first time. **Do not "fix" this by copying them under a guard.**

## Sharing ONE document with third-party apps — three zones, three defences

Every `luci-app-*` drops its CSS and its JS into the **same document** as this theme. That is the
root of a whole bug class, and it cuts three ways. Measured across the real, shipped stylesheets of
ten packages (openclash, podkop, mosdns, filemanager, banip, adblock, ssclash, temp-status, passwall,
justclash) — take the numbers below from `tools/chrome-fence.mjs` and the changelog, not from memory.

**Zone 1 — OURS: the chrome.** `[data-fs-chrome]` (the mark; see below) · `fs-*` · `--fs-*` ·
`fs-*` localStorage · the Appearance axes. **Nobody outside may write here**, and three things
enforce it, each closing a door the others cannot:
- **The mark** (`header.ut`, `fs-appearance.js`) — **the chrome is NOT one element, and naming one is
  how this went wrong**. The fence and the pin used to say `.fs-sidebar`, which is the menu in both
  layouts — but the skip link is a sibling of `.fs-shell`, the Appearance popover hangs off `<body>`
  (it is `position: fixed`, and the sidebar is a transformed ancestor that would re-root it), and the
  sr-only `<h1>`/live region sit inside `.fs-main`. Measured by replaying v0.9.1's own fence text
  against openclash's rule: the menu **held**, and all four of those broke — the popover flattened
  (padding 12px→0) and `position: fixed→static`, both sr-only elements un-clipped onto every page.
  So a chrome root **declares itself** with `data-fs-chrome` where it is written, and the other two
  read the mark. A new chrome root cannot forget to edit a constant in another file, because there is
  no constant naming it. **Mark ROOTS only** — never nest one inside another.
- **The fence** (`fs-sheets.js`) — an invasive sheet's unpinned selectors get
  `:where(:not([data-fs-chrome], [data-fs-chrome] *))` appended to their SUBJECT, so they can no
  longer *match* a chrome element. This is the only thing that beats a third party's `!important`:
  there is nothing left to out-rank. `:where()` is load-bearing — zero specificity, so the app's rules
  keep their exact weight everywhere else. Openclash's `*{padding:0!important}` took the menu from 47
  damaged elements to 0; mosdns's `span{cursor:unset!important}` from 1 to 0.
- **The pin** (`theme/10-chrome.css`) — the fence cannot close **inheritance**: a rule on `html`/`body`
  needs no match at all. The pin states the inherited properties on the chrome **ROOTS ALONE**, which
  breaks the chain from `html` once while the chrome's own inheritance flows on. It says so **in the
  selector** (`:where([data-fs-chrome]:not([data-fs-chrome] *))`) rather than trusting the next person
  not to nest a mark: **descendants must never be pinned** — a direct declaration beats an inherited
  one *even when the inherited one is ours*: measured, it cost `.fs-label` its `nowrap` and forced
  `text-align` from `start` to `left` on 302 elements, breaking every RTL language LuCI ships. That
  guard is in CSS because no gate can check it — the marks live in a template with conditional blocks,
  so "is this one inside that one" is not a question a text scanner can answer. No `!important` is
  needed or wanted: inheritance is not a cascade competitor.
- **The verdict is taken BEFORE the fence rewrites the sheet** (`_invasive`, a WeakSet in
  `fs-sheets.js`), and only `true` is remembered. `documentPoisoned()` used to re-judge the *fenced*
  text and reach the right answer **by accident**: the class-named fence left `.fs-sidebar` in the
  selector, which is a name the theme styles, so a fenced rule still tripped `themeHit`. Moving to an
  attribute leaves no class name behind — every fenced document would have read clean and the SPA
  would have carried openclash's `*` into the next page. A clean verdict stays provisional (a sheet
  built with `insertRule()` is empty the first time we look).
- **The `:root` guard** (`fs-prefs.js`) — not a cascade problem at all. `luci-app-openclash` writes
  `data-darkmode` onto `:root` from **seven** templates, gated on a check that consults
  `matchMedia('(prefers-color-scheme: dark)')` before the page's real background — so an explicit
  Light choice was lost to the user's OS setting. Only the **published** trio
  (`data-darkmode`/`data-theme`/`data-bs-theme`) is guarded: publishing them to apps is exactly what
  puts them in an app's vocabulary. The guard compares before it writes, so when the page really is
  dark the app's write agrees and it never fires — that is also what stops it looping.

**Zone 2 — SHARED: stock LuCI.** `.cbi-*` · `#view`/`#maincontent`/`#indicators` (core contracts —
`luci.js`, `ui.js`; the names cannot be renamed) · the `--*-color-*` export tier · the `data-darkmode`
convention. **Here the app is entitled to win on specificity**, exactly as on a theme with no layers.
That is what re-hosting an invasive sheet into the **existing `theme` layer** buys (`fs-sheets.js`):
same-layer arbitration. Do NOT give app CSS a layer of its own *below* `theme` — measured, it fixes
the chrome but repaints the app author's own widgets.

**Zone 3 — THEIRS: the app.** Its own namespaced names. **We do not write here.** Before "fixing"
an apparent outbound collision, check who OWNS the name: `.left`/`.right`/`.center` look like ours
but are LuCI's own utilities — stock emits them on non-cells **59 times** (`form.js:3018` is literally
`class="cbi-button drag-handle center"`), and `luci-theme-bootstrap`'s cascade carries byte-identical
rules. Scoping them to cells would have broken stock. Likewise `ul.nav`: stock bootstrap styles `.nav`
*more* broadly than we style `ul.nav`, and zero of ten packages emit it.

`pinnedToApp()` in `fs-sheets.js` **is** the zone test, and both the fence and `invasiveSheet()` share
it on purpose: a selector held by a name the theme does not know is Zone 3 and is left alone; an
unpinned one is Zone 1/2. Two copies of that judgement would drift into disagreeing.

**`npm run chrome-fence` is what stops all of this rotting**, and it exists because the failure is
silent: breaking the fence constant to `.fs-sidebarTYPO` left the menu completely unprotected while
`check`, `jsmin-verify` and `eslint` all exited **0**. The mark is named in three places (markup, pin,
fence); the gate **derives** it from `header.ut` and holds the other two to it, plus the guard's
`attributeFilter` against `stampDark`.

The fence and the pin are each **one canonical string, compared whole** — not tested for tokens, and
that is not pedantry. The token version's four independent `includes()` checks all **passed** on
`:where(:not(.fs-sidebar), .fs-sidebar *)`, a plausible botched edit that is the exact *inverse* of a
fence: it stops sparing the chrome and starts targeting it. A gate whose thesis is "a stale copy just
stops defending, silently" cannot be the thing that waves that through. Ten mutations are checked to
fail, including that one. Do not loosen a comparison here to make an edit fit — change the string the
gate builds, deliberately.

**What is deliberately NOT covered** — these are accepted trades, not oversights: the `base` layer
still loses to a foreign `*` in the content area (the app must outrank `theme` for its own page, so it
sits above `base`; that was already true); a `<style>` whose **text is not its sheet** cannot be
wrapped, so it is fenced but not re-hosted and Zone 2 stays where it already was (see `textIsSheet()`
— an `@import` at the top, or an app that built the sheet with `insertRule()`); the observer watches
`<head>` only (the initial pass covers server-rendered markup); and the fence is JS, so a wrong frame
can paint before the modules land.

**A `<style>`'s `textContent` is NOT its sheet — `el.sheet.cssRules` is**, and assuming otherwise put
the one deletion this module exists to prevent *inside the fix for it*. An app that builds its CSS
with `insertRule()` leaves the text empty while the rules apply, and the old wrap re-set
`textContent`, which RE-PARSES: measured on the router, `.probe-only { color: lime }` came back as
`@layer theme {}` — every rule gone, silently. The `if (!rules) return` guard could never fire, since
a `CSSRuleList` is truthy at length 0. The dedupe had the same hole from the other end: every
insertRule-built `<style>` keyed as the same empty string, so the second one was **removed** as a
"duplicate" of a sheet it shares nothing with. `textIsSheet()` now asks the exact question once — does
re-parsing this text give back the sheet that is applying? — with a **constructible** sheet as the
probe (never adopted, so nothing paints and our own observer never sees it). It subsumes the
`@import` case: `replaceSync` drops `@import` per spec, so the serialisations differ and the answer is
already no. Verified on the router across all six shapes.

## CSS architecture (critical)

**`htdocs/luci-static/footstrap/cascade.css` is generated — never edit it.** It is gitignored and produced by `luci-theme-footstrap/build-css.sh`, which concatenates the `styles/` tree, strips comments and then squeezes the whitespace CSS ignores (~287 KB of source → **~111 KB**; uhttpd serves `/www/luci-static/*.css` with **no gzip**, so bytes are wire bytes). The squeeze deletes the space after `:`, the spaces around `{ } ; ,` and the last `;` of a block, and nothing else — it leaves the single space between selectors alone (`.a .b` is a descendant combinator, `.a.b` is not) and never touches `calc()` or a string. **All of that happens inside ONE string-aware awk pass, and the last `;` is dropped there too.** It used to be a `| sed 's/;}/}/g'` bolted onto the awk output, and sed cannot see strings: `content: ";}"` came out as `content: "}"`, and a data-URI containing `;}` was mangled the same way (both reproduced). Nothing in the tree happens to contain that byte pair — which is exactly how a bug like that waits for whoever adds the first one. Proven behaviour-neutral with `cssdiff` (0 diffs over ~4000 elements). The `/*!` licence banner is copied verbatim — it is an Apache-2.0 attribution, not formatting. There is no upper size budget any more (removed), but it keeps a **broken-build FLOOR** — it refuses to write a stylesheet suspiciously SHORT (a truncated write, a squeeze that ate the tail), which is a correctness guard, not a size limit. `build-css.sh` runs from the package `Makefile` (`Build/Prepare/luci-theme-footstrap`) and from `dev-sync.sh`; it needs only `cat`/`awk`, so an OpenWrt buildbot can run it. Use `--dev` to keep comments.

**One directory per cascade layer**; within each, the filename prefix is the source order:
- `styles/00-header.css` — licence banner + the **only** `@layer` declaration.
- `styles/01-fonts.css` — `@font-face`, unlayered.
- `styles/02-tokens.css`, `03-palettes.css` — `@layer tokens`. **Two tiers, and the split is load-bearing.** *Private:* `--fs-*` (`--fs-bg/--fs-panel/--fs-text/--fs-accent/…`, the radius scale, the z-index scale `--fs-z-*` — every z-index in the theme comes from there). **Every rule in this theme reads only these.** *Export:* the `--*-color-*` names LuCI themes conventionally expose, defined **from** the private tier and read by **nobody** inside footstrap — they exist so a third-party `luci-app-*` stylesheet keeps working and keeps following the palette and dark mode.
  The export tier is a **ramp, not a set of aliases** — `high`/`medium`/`low` must be three different colours, because consumers ask for a gradation and get whatever we define. All three used to alias one token, so `luci-app-podkop` painted its "no data" latency with `--primary-color-low` and got the same vivid accent as a live value. The ramp's axis is **chroma at constant lightness** (`color-mix(in oklch, … , var(--fs-dim))`): fading `low` toward the surface — the intuitive "muted" — spends contrast the palette does not have (on `--fs-panel2` in dark every accent already sits at 4.56:1, i.e. +0.06 over AA), and pushing `high` toward `--fs-text` collapses the ramp in dark mode, where `--fs-text` is near-white. `tools/export-tier.mjs` enforces all of it; the full reasoning is in `02-tokens.css`.
  **Derived colours are tokens too, and the ladder is the point.** A tint of a role is mixed FROM the role token, so it follows the palette — those `color-mix()`es were never the stale-copy bug the `*-rgb`/`*-hsl` bridges were. What they lacked was a **name**, and an unnamed level drifts in silence: the same outline border was written 40% in a table and 45% in the action bar, the same uci-diff block 30% in `base` and 18% in `theme`, the same hover fill 12% in one file and 18% in another — four strengths where the design has two. So there are now **four steps, and the role x step matrix is COMPLETE on purpose** — every role has every step whether or not something reads it today, because a gap is exactly how the drift started (`--fs-accent-soft` existed, `good`/`warn`/`danger` had no sibling, so every rule that wanted one invented a percentage):
  `-soft` 12% = a quiet fill (outline-button `:hover`) · `-fill` 18% = a stronger fill (callout/diff surface, the invalid ring) · `-line` 40% = a hairline · `-line-hi` 55% = that hairline on hover.
  `--fs-accent-soft` is the one member that stays in `03-palettes.css`, because its strength is the only one that differs per **mode** (10% light / 15% dark). Also derived: `--fs-glass` (the frosted pop surface, panel 96%) and `--fs-blur` (one radius for every frosted surface — the bar said 10px and the pops 12px, a difference nobody chose); `--fs-emboss`/`--fs-text-emboss` (the raised 1px edge — `.ifacebox` mixed `--fs-dim` and `.ifacebadge` `--fs-panel` for the *same* edge at the same 5%); `--fs-hover-lift` (`brightness(1.08)` — the one hover cue that cannot be a colour, since the fill it brightens is whatever the role says; the three sites had drifted to 1.06/1.08/1.12); and `--fs-focus-ring-invalid`, which takes `-fill` and not `-soft` because a red ring has to read as an alarm. **`--fs-bar-bg` (88%) is deliberately NOT merged into `--fs-glass` (96%)**: a bar is a thin strip the page scrolls under and seeing content ghost through it is the point, while a dropdown carries a whole menu and must stay readable. **`--fs-scrim` is the theme's only colour literal and stays one** — plain black at .7 is the absence of light behind a dialog, not a tint of any palette token, and a palette-tinted scrim over a dark page dims nothing.
  **Motion is a scale too, and there is deliberately no easing token.** Four durations — `--fs-dur` .15s (a state change: colour/border/shadow/background/filter), `--fs-dur-move` .2s (transform, max-height), `--fs-dur-fade` .25s (a transient thing fading: spinner, notification), `--fs-dur-fill` .4s (a progress bar growing to its value). There used to be seven durations (.12/.125/.15/.2/.22/.25/.4) and four curves (`ease`, `ease-in`, `linear`, one `cubic-bezier`), none of it chosen — two rules even declared the same three properties at the same duration in a *different order*, so a grep could not see they were the same rule. Every transition now omits the timing function and takes the CSS default (`ease`): one curve, nothing to keep in sync, fewer bytes than naming it. A rule that needs a different curve is making a design decision and should justify it in a comment.
  Why the private tier exists at all: `:root` is a **shared** global scope — every `luci-app-*` drops its CSS into the same document, **unlayered, which outranks every cascade layer**. One app writing `:root { --accent: … }`, or `--radius`/`--text`/`--border` (names anyone would pick), used to repaint this whole theme silently. Base reading the *export* names was the wider hole still: `--text-color-high` is a LuCI **convention**, so an app is *likelier* to declare it. Measured on `docs/gallery.html` with a hostile `:root`: **312 of 336 elements repainted before the split, 0 after.** `audit.py` fails on any read of an export name from inside `styles/`, so the coupling cannot grow back. Element-scoped locals (`--bd-color`, `--fg-color`, `--on-color`, `--focus-color`, `pre`'s `--border-color`) are exempt — they are declared inside the rule that reads them and cannot be hijacked from a foreign `:root`.
- `styles/base/*.css` — `@layer base`, the widget defaults every LuCI view assumes: reset, typography, forms, tables, chrome, modal, buttons, cbi-dropdown, widgets, LuCI-specific. Split from a single 2300-line file; rule order inside the layer is unchanged.
- `styles/theme/10-chrome.css` — `@layer theme`, the chrome EVERY layout shares (brand, logo, wordmark, logout, indicators, `ul.nav` menu primitives, hover/active/focus). Its values are the **top-bar** ones: where the two layouts ever disagreed on the same element, the bar's value is the one that survived the merge. A layout file may set placement on these (`flex`, `order`, the rail/bar collapse) but never their look.
- `styles/theme/15`–`95` — `@layer theme`, one file per component/layout concern (wallpaper, shell, progressbar, tables, alerts, tabs, misc, toplayout, buttons, inputs, dropdown, modal, responsive, a11y-media). `20-shell.css` carries the bar (base), the vertical sidebar (override) and the icon rail; `50-toplayout.css` is the top-layout bar delta (all widths, measured — no 768 floor).
- `styles/theme/95-a11y-media.css` — `prefers-reduced-motion` and `forced-colors`. The reduced-motion block is the ONE place a new `!important` is legitimate: the flag inverts the layer order, so it is the only way a single rule can stop animations declared in `base` as well as in `theme`. Do not copy the flag out of that block.
- `styles/pages/*.css` — `@layer page`, per-page corrections (login, overview, software, sshkeys, leases, assoclist).

Layer order is `tokens, base, theme, page`. A later layer beats an earlier one **regardless of specificity**, so a theme rule never needs `!important` to outrank a base rule. Unlayered rules beat every layer and that slot is deliberately empty — it is the escape hatch.

Rules when editing CSS:
- **The inks (`--fs-on-accent`/`--fs-on-good`/`--fs-on-warn`/`--fs-on-danger`) are per palette AND per mode**, and live in `03-palettes.css` next to the fills they must be legible against — never as one global value in `02-tokens.css`. A dark palette has LIGHT fills and therefore needs a DARK ink. A single global `--fs-on-accent: #fff` failed WCAG AA on seven of the eight dark-palette fills (down to 1.69:1). A new colourway must set all four and check them against its own fills.
- **Fonts are split by `unicode-range`** (`styles/01-fonts.css`): 3 faces (Manrope 600/700, JetBrains Mono 400) × {latin, latin-ext, cyrillic}. Measured against the live router, a Latin UI fetches **3 files / 46 KB** and touches neither cyrillic nor latin-ext; 68 KB ships in total. There is deliberately **no Manrope 400** — `font-weight: normal` resolves onto the 600 face, so body text is semibold by design; adding a 400 costs ~13 KB and restyles every page.
- **There is no bold mono, and it must not come back.** A `<strong>` is a LABEL — LuCI writes every status readout as `<strong>MAC:</strong> ac:1f:6b:…` — so it takes the UI face even on a monospaced surface (`theme/45-misc.css`; the same goes for `.ifacebadge`, a badge, and for `code`/`pre`, whose literal must not inherit a container's emphasis). Before that rule, 227 elements over seven pages rendered in bold mono and the browser fetched `jetbrains-mono-600` (20 KB) to draw the word "MAC:" — 30% of the whole font payload. **Anything now asking for mono at weight ≥600 gets synthetic bold, which smears a monospace grid**; if a rule seems to need bold mono, the real question is whether that element is a label (then it is not mono at all), not whether to re-add 20 KB. Note that *excluding* an element from the mono rule does nothing — it still **inherits** mono from its parent; the sans face has to be **assigned**.
- The CSS and font **size budgets were removed** (CI no longer fails on bytes; `build-css.sh` keeps only its broken-build FLOOR). Fonts still ship as `unicode-range`-split subsets and the JS/CSS are still minified — keep the payload lean by judgement, not by a ceiling.
- **Coverage is a contract — never drop the styling of a selector because no shipped LuCI page uses it.** Third-party `luci-app-*` packages on other users' routers render widgets stock LuCI never does (the reason `docs/gallery.html` exists): a selector with no on-router example *today* is still styled for the package that emits it tomorrow. You may **move or merge** a rule between files/layers (that is the whole absorption process), but the set of selectors the theme styles — and the fact that each stays themed — must only ever grow. "This looks unused, delete it" un-themes someone's app; deletion is never a cleanup. Consolidation means folding two rules into one that still matches everything both did, not removing coverage.
- **`styles/base/` is editable — all of it is.** Prefer overriding in the matching `styles/theme/` file (the layer makes it win without touching base), but you may edit base directly when that is genuinely the right place: converting a base rule off the raw HSL/rgb component bridge onto `color-mix()`/token colours, fixing a base bug, or absorbing a block. Base is being *absorbed*: delete a block, run `cssdiff`, and whatever the diff reports is what the theme must own — write those rules into the right component file and re-run until the diff is empty. Any base edit that changes rendered output must be justified by a near-empty `cssdiff` (intended shifts only) — that is the guardrail, not a blanket prohibition. `docs/17` records the categories left.
- **`docs/gallery.html`** renders every widget LuCI (or any third-party `luci-app-*`) can emit, with the real class names, so the theme can be checked without hunting for a router page that uses the widget. It is not shipped: `scp docs/gallery.html router:/www/luci-static/footstrap/` and open `http://<router>/luci-static/footstrap/gallery.html` — no login needed.
- **`!important` in `styles/theme` and `styles/pages` is 17 declarations: 13 of them fight something no cascade layer can outrank**, and the remaining 4 are the reduced-motion block in `95-a11y-media.css` (see above). One (`theme/45-misc.css`) fights the inline `width:100%` the realtime graphs write on the box they draw into: those views size the drawing from `#view.offsetWidth`, so inside footstrap's padded card the canvas is 34px short and the newest samples are clipped — the box has to be bled back out to the card's border edge (`--fs-card-pad` + 1px, derived, never restated). Eight (`pages/20-overview.css`) fight an inline `style=`: `29_ports.js` writes `style="margin:.25em;min-width:70px;max-width:100px"` on each Port tile, `display:grid;grid-template-columns:…;margin-bottom:1em` on their grid, `display:flex` on the zone bar we hide, and `text-align:left;font-size:80%` on the traffic figures (the `text-align:right` flag is scoped to the wide card by a `@container` query — on the narrow one the inline `left` is what we want, so an unscoped flag would have been wrong). Four (`theme/90-responsive.css`) fight an inline `left`/`right` written by `ui.js` on an open dropdown list, and the unlayered `<style>` blob (`.controls{display:flex}`) that `package-manager.js` injects — unlayered beats every layer. Do not remove those; do not add new ones. **Every flag must fight an inline or unlayered declaration; one that fights another footstrap rule is redundant** — this was checked property by property against the emitting JS and 11 such flags were removed (`cssdiff`: 0 diffs).
- **`!important` inverts the layer order** — an important declaration in `base` beats an important one in `theme`, which is why a flag in `base` is a flag aimed at the theme. `styles/base` keeps **14** (six carry the `.cbi-dropdown` widget's internal state machinery — `[open]`/`[multiple]`/`[empty]`/`[optional]` override each other and upstream resolves that with flags; six are the `.left/.right/.center/.top/.middle/.bottom` forcing utilities, which LuCI writes on a cell precisely to override the table's own alignment and which lose to `.cbi-section .table .td` (0,3,0) on specificity alone; two fight an inline `style=` — the zone-colour gradient and the `stroke:black` on the realtime graphs' `<line>`s). **It was 17.** The three that went were not fighting an inline or a widget state at all — they were fighting *footstrap's own rules*: `.cbi-dropdown`'s `display`/`padding` fought base's generic form-field rule, and `.spinning`'s `padding-left` fought them in turn. A later layer and one specificity ladder answer all three, which is what the layer split is for. If a rule needs `!important` to beat *another footstrap rule*, it belongs in a later layer — do not add the flag. Every removal here was measured with `galdiff.py`, not reasoned.
- **A `!important` you cannot see is a `!important` you cannot judge.** Every claim above is measured over `docs/gallery.html`, and twice the measurement was the thing that lied: the forcing utilities looked idle because nothing in the gallery emitted a `.td.right` (added), and then because `galdiff.py`'s property list did not include `text-align` (added). A clean diff is only as honest as the widget list and the property list behind it — extend both before trusting one.
- Verify any non-trivial CSS change with the computed-style differ, not screenshots: it swaps the `<link>` on a live page so live counters can't produce false diffs. See "Verify a CSS change" below.
- **Both component bridges are gone: the HSL one (`--*-hsl` triples, `--*-h/s/l` parts) and the RGB one that outlived it** (`--accent-rgb`, `--error-color-high-rgb`, `--success-color-high-rgb`, read as `rgba(var(--x), .3)`). They were the same mistake in two notations — a second, hand-kept copy of a colour that already exists as a token: it goes stale in silence when a palette is recoloured, and if the triple ever goes missing the declaration is invalid at computed-value time, so the tint just vanishes with no error (`audit.py` cannot catch that either — the var IS defined, only elsewhere). Every rule that read them takes `color-mix()` over the palette token now; `color-mix(in srgb, C p%, transparent)` is exactly `rgba(C, p/100)` (the mix is premultiplied — proven by rasterising both). **A tint of X is mixed FROM X. Do not reintroduce a component copy of a colour in any notation** — that includes writing `--accent-soft` as a literal restating `--accent`'s RGB, which is how it used to be. The one surviving `--*-rgb` is `--zone-color-rgb`, and it is not ours: `luci-mod-network` writes it inline on a zone badge.
- Un-themed spots = hardcoded color literals (`#hex`/`rgb()`) that bypass the bridge — `audit.py` reports them and `styles/base` is currently at **zero**. Keep it there: a literal cannot follow a palette or dark mode.
- **Edit the rule that already styles a selector; never append a second one.** `audit.py` reports any declaration shadowed by a later rule on the same selector in the same layer, and that count is currently **zero**. Appending is how this stylesheet became a changelog held together by 220 `!important`.
- **A base declaration a later layer repaints on the same selector is dead — and `audit.py` now fails on it (`--strict`), currently at zero.** Layers beat specificity, so `theme`/`page` outrank `base` unconditionally, and base is not a fallback either: if a theme value goes invalid at computed-value time the property falls back to `unset`, never to base. **But deletability is decided by the whole selector GROUP, not the one selector.** Base groups upstream widgets together (`.cbi-button-positive, .cbi-button-fieldadd, .cbi-button-add, .cbi-button-save`), and theme often repaints only some of them. Dropping the rule because it "looks overridden" un-themes the rest — the widgets no shipped LuCI page renders but a third-party `luci-app-*` does. So `audit.py` reports two lists: the **removable** one (every member repainted → deleting changes nothing) and the **absorption backlog** (only some members repainted → *do not delete*; absorb by writing the uncovered selectors into `theme` first). The backlog stands at **26 declarations** and is the real to-do list for finishing base (`audit.py` prints the current count — do not restate it from memory; this line has already drifted once, from 50, while the backlog was being worked down). Note the checker is deliberately conservative: it only matches *identical* selectors, so a base rule like `.alert-message.warning { background }` that theme kills via a plain `.alert-message { background }` is dead too but is not reported — proving that needs selector-superset reasoning, and a wrong matcher there would un-theme someone's app. `cssdiff` cannot protect you here: an un-rendered widget shows no diff.
- **Do not let source order carry meaning.** Two rules at equal specificity resolve by position, which silently breaks the moment a file is reordered or merged. Win on specificity instead (`.cbi-page-actions .cbi-dropdown.cbi-button-apply`, not `.cbi-button-apply` written afterwards). The one deliberate exception is documented in place, in `theme/55-buttons.css`.
- **Overview tables**: discriminate by `id`. Key/value includes (System, Memory) render `<table class="table">` **without** id → 2-col label/value style. Data tables (DHCP leases = `id="status_leases"`) have an **id** → data-table style. Use `.table[id]` vs `.table:not([id])`.
- `:has()`, `color-mix()`, `@layer` and `:where()` are used (modern browsers only — fine for target). `build-css.sh` brace-checks its own output and refuses to write an unbalanced file.

## Overview layout include (theme/mod boundary)

`htdocs/luci-static/resources/view/status/include/05_footstrap_overview_layout.js` is an **additive**, layout-only overview include (unique filename → no collision with `luci-mod-status`; LuCI auto-discovers `*.js` in that dir, `05_` sorts first). It renders **no content of its own** — it only re-arranges the **stock** System/Memory/Storage sections: a `MutationObserver` on `#view` tags those three `.cbi-section`s by title and wraps them in `.fs-ovl`, so CSS grid puts System in the left column across both rows with Memory (top) + Storage (bottom) in the right column (`.fs-ovl` block in `cascade.css`). The stock poll updates each section **in place** (`dom.content`), never rebuilding the `.cbi-section` wrapper, so the moved wrappers stay put across polls (minimal flicker, no full-tree swap — the reason the earlier full-custom `05_footstrap_dashboard.js` was dropped: rebuilding a page-tall tree every poll flickered and reset mobile scroll). Its own empty stock wrapper is hidden via `#view > .cbi-section:has(.fs-ovl-marker)`. Gated on a footstrap theme being active (`L.env.media`) AND on being the overview page
(`body[data-page]`). The observer's callback has an **O(1) fast path** — one `isConnected` check on the wrapper it built — because it fires on every poll tick; it deliberately does NOT `disconnect()` after wrapping, so that if a future `luci-mod-status` ever does rebuild a section, the grid self-heals instead of staying broken.

## Package / registration

- `Makefile`: `include $(TOPDIR)/feeds/luci/luci.mk` (not a relative path — CI rsyncs the package into `package/`, not into the feed), `LUCI_DEPENDS:=+luci-base`; `luci.mk` auto-installs `ucode/→/usr/share/ucode/luci`, `htdocs/→/www`, `root/→/`. `postrm` deletes every `luci.themes.*` entry (current + legacy names) and removes the install marker (`/usr/share/luci-theme-footstrap`). `postinst` re-runs the uci-defaults script, so it executes on **upgrade** too (apk maps `postinst` to both `post-install` and `post-upgrade`) — note OpenWrt's own `default_postinst` *also* runs every shipped `/etc/uci-defaults/*` and then deletes it, so the script runs twice per install; it is idempotent and the fresh-vs-upgrade marker is written at the end of the first pass.
- **Anything under `root/etc/config/` MUST be listed in the `conffiles` define, and `npm run conffiles` enforces it.** `/etc/config/footstrap` is shipped as an empty stub and **written at runtime** — Appearance → "Save as default" has rpcd `uci set`/`commit` the router-wide axes into that very file (`fs-prefs.js saveAsDefault()`). Undeclared, the package manager owns it as an ordinary file and **replaces it on upgrade**, so the theme's own one-click Update wiped the admin's saved defaults, silently, reporting success (measured on the dev router: eight options in the live file, package-owned, no `.conffiles` entry beside `base-files`'/`dnsmasq`'s). One define covers both managers — `include/package-pack.mk` maps it to apk's `.conffiles` and ipk's `CONTROL/conffiles`. It needs a gate rather than just a fix because **nothing observable fails**: the wipe lands on someone else's router, months later, at the moment they upgrade. `dev-sync.sh` mirrors the same semantics — it installs a config file only when ABSENT, never over a live one.
- **`+luci-base` is the WHOLE dependency list, and keeping it that way is a constraint.** `footstrap-selfupdate.sh` used to hard-require `curl`, which is **not** in OpenWrt's default package set (the base image ships `uclient-fetch`; on the dev router `/usr/bin/curl is owned by curl-8.19.0-r2`, an explicitly installed package). On a stock router the update badge and the Update button both died with `ERR: cannot reach the GitHub release API` — reproduced by moving `/usr/bin/curl` aside. The script falls back to `uclient-fetch` now. `jsonfilter` and `sha256sum` are in the base image, so they need no dep either. Do not add a runtime dep for a convenience tool; fall back instead.
- **`postinst`/`postrm` `rpcd reload`, never `restart`.** rpcd keeps sessions in memory, so `restart` logs out every LuCI user — including the admin who just clicked Update. `reload` sends SIGHUP, which **does** re-read `/usr/share/rpcd/acl.d/*` (verified on a live router: deleting our ACL file + `reload` flips `session access` for the self-update script from `true` to `false`, and a session created before a `reload` survives it but dies across a `restart`). The ACL refresh is the only thing this package needs from rpcd.
- `root/etc/uci-defaults/30_luci-theme-footstrap` is the single source of truth for registration: deletes all legacy names, registers the ONE theme entry (`Footstrap` → `/luci-static/footstrap`; there is no second layout entry — layout is a client preference), migrates `luci.main.mediaurlbase` (legacy `-dark`/`-light` → base layout; a dangling path → `bootstrap`), and drops the index/module caches. **Fresh install vs upgrade is decided by a marker file** (`/usr/share/luci-theme-footstrap/.installed`, written at the end of the script and removed by `postrm`): a fresh install may activate the theme, an upgrade must never change the active theme. It used to key off a `PKG_UPGRADE` env var, which apk never sets — the guard was dead in production and only `dev-sync.sh` (which exports it by hand) ever took the upgrade branch. **Never register themes anywhere else** — `dev-sync.sh` runs this same script.
- Version is git-derived; don't set `PKG_VERSION`. 25.12 packages are **apk** (`apk add --allow-untrusted *.apk`), not opkg/ipk.

## Getting the package onto a router — the trust chain is the whole thing

`install.sh` (piped from the internet into `sh` **as root**) and `root/usr/libexec/footstrap-selfupdate.sh` (the ACL-gated backend behind Appearance → Update) both hand a downloaded package to the package manager with `--allow-untrusted` — that flag means **apk/opkg holds no key of ours**, not that the bytes are unverified. Verifying them is these scripts' own job, and the chain is three things:

1. **A verified TLS channel.** Never `curl -k`, never `--no-check-certificate`, and never as a "retry" after the verified attempt fails — a failure *is* the MITM case, and `ca-bundle` is in OpenWrt's `DEFAULT_PACKAGES` so the insecure path buys nothing. Pin the redirect scheme where the backend can (`--proto-redir '=https'` on curl) and pin the host — the URL comes out of a JSON answer and ends up as an argument to root. **But be exact about the reach of both, because the release asset hops to `objects.githubusercontent.com` and `-L` must follow it:** the scheme pin exists only on the *curl* branch, while `uclient-fetch` — tried first, and the only downloader on a stock router — has no such flag and re-parses an absolute `Location:` from scratch; and the host pin covers the *initial request only*, since no backend pins a host across a redirect. On the path a stock router actually takes, **the signature is the only layer that survives a redirect**. That is by design, not a hole (it is what vouches for the package), but do not budget the other two as if they covered it.
2. **An ed25519 signature over the package** (`usign`), and this is the link that actually holds. **The sha256 cannot stand alone, and the reason is exact: GitHub COMPUTES `@.assets[*].digest` from the bytes that were uploaded.** Anyone who can replace a release asset — a leaked write-scoped PAT, no CI run involved — gets the digest recomputed for them, and the checksum then verifies the *attacker's* package. The signing key is a GitHub Actions secret, is in no branch, and cannot be read back out, so the same swap fails the signature. Demonstrated end-to-end on the router with the real script: asset replaced + digest recomputed → sha256 passes, `ERR: BAD SIGNATURE`.
3. **The sha256 GitHub publishes for the asset.** It still earns its place below the signature: it catches a tampered or truncated download from the asset CDN (a *different* host from `api.github.com`) with a clearer failure. It does **not** "remain if `usign` is absent" — nothing does, and the docs and both scripts used to say otherwise: a missing `usign` is a **refusal** (rc=2). That is the correct behaviour; the prose was the bug.

Everything fails **closed**. A missing digest, a missing `.sig` asset, no `usign` on the box — all refuse. The `if [ -n "$digest" ]` shape both scripts once had fails *open*: a renamed field or an absent tool empties the variable, and the install proceeds with no check at all, reporting OK. `install.sh` alone has an override (`FOOTSTRAP_ALLOW_UNVERIFIED=1`, for pinning a release older than the signing key); a signature that is **present and wrong** is never overridable — that is not a missing check, it is a failed one.

**Why usign and not the package manager's own signature.** `apk verify` checks against `/etc/apk/keys`, so trusting footstrap's key there would make this theme a trust anchor for **everything the router installs** — far more authority than a theme has any business holding. opkg (24.10) cannot verify a standalone `.ipk` at all. `usign` is on **every** OpenWrt image (`base-files` depends on it — so this costs the theme no new runtime dep; see the `curl` lesson in the Makefile), it covers **both** formats with one mechanism, and the key it uses authorises nothing but this one package.

**The key exists in two places and neither copy can go.** `root/usr/share/luci-theme-footstrap/release.pub` is shipped by the package and is what the self-updater reads; `install.sh` must **embed** a copy, because `curl | sh` runs before any package exists. A divergence cannot be caught by any test — the installer would just reject every release with `BAD SIGNATURE`, i.e. the failure looks exactly like the attack — so CI compares the two on every run. Rotating the key means changing both, and the release that ships the new `release.pub` is the one that starts trusting it.

`curl` is **not** in OpenWrt's default package set — the base image ships `uclient-fetch` — so the self-updater must fall back to it rather than take a runtime dependency. `jsonfilter`, `sha256sum` and `usign` *are* in the base image.

**The two scripts cannot share a file** (the installer is `curl | sh` and runs *before* the package that would hold the library exists), so their `fetch()`, host allowlist, asset/signature lookup and `verify_sig()` are `@mirror`-pinned instead. That is not ceremony: they had **already** drifted three ways.

- **`luci-theme-footstrap/luci-upstream.pin` is the single source of the pinned `openwrt/luci` commit** and the sha256s of the two tools this project borrows from it — `jsmin.c` (compiled and run in CI as the gate proving the shipped JS is safe) and `build/i18n-scan.pl` (run by perl as the i18n gate). Both are downloaded and **executed**, so pulling them from a moving `master` would mean the gate is whatever upstream pushed last. `update-po.sh` and the workflow both source that one file; they used to state the commit separately, each with a comment saying "bump them together". It also pins the two other borrowed-and-executed tools: `UCODE_PIN` (the interpreter that compile-checks the `.ut` templates) and `USIGN_PIN` — **the commit the router's own `usign` binary is built from**, so the signer in CI and the verifier in the field are the same code. usign needs neither cmake nor libubox: `cc *.c` over six sources plus the bundled `base64.c`; it is built by `tools/build-usign.sh`, which **both** jobs that need it call — the release job to sign, the build job to verify the SDK — because two copies of a `checkout <pin>` are exactly how two jobs end up on different commits.

- **The OpenWrt SDK is verified by SIGNATURE, and the sha256 beside it was never a verification.** The SDK is the least verified input here and the only one that ends up *inside* the package users install — `jsmin.c` and `i18n-scan.pl` are **linters** pinned by commit and sha256, while the toolchain that compiles the released artifact arrived on nothing but TLS. Checking it against `sha256sums` from the **same host, same directory, unsigned** is the very shape this project rejects for GitHub's asset digest (see the trust chain above): whoever can replace `openwrt-sdk-*.tar.zst` replaces the checksum beside it, and the check then verifies the attacker's SDK — demonstrated, the old code passes that attack. What makes it real is `sha256sums.sig`, an ed25519 signature verified with OpenWrt's key for that branch, fetched from **github.com/openwrt/keyring** at the commit `luci-upstream.pin` pins — a *different host*, so `downloads.openwrt.org` cannot vouch for itself. The key is a **public verify key** OpenWrt publishes; it authorises nothing. **The two branches do NOT share a key** — 24.10 has a release key of its own (`d310c6f2833e97f7`), 25.12 is signed by the unattended-build key (`b5043e70f9a75cde`) — so each leg names its own in the `build.yml` matrix beside its `channel`, with the sha256 that holds it; only the keyring *commit* is in the pin file. Pinning one key for both was wrong in the only way it could be: the 24.10 leg refused to build, which is the gate working on its own author. Proven per leg: both verify with their own key, each fails with the other's, one byte flipped in `sha256sums` → `verification failed`, a swapped key file → sha256 mismatch. If a build reports `BAD SIGNATURE`, read the **keynum** the step prints before assuming an attack — OpenWrt rotating a branch's key looks identical.

## Development workflow (one `cat`-based CSS build — deploy to a live router)

Test router: `ssh router` (OpenWrt 25.12.2, mediatek/filogic, apk). **Never break it; back up before touching files** (`/root/theme-backup/`). Login for authed testing: root + password set during dev.

Deploy everything: `luci-theme-footstrap/dev-sync.sh` (rebuilds `cascade.css` from `styles/`, copies the template + partials, fonts, **every** resource JS by glob, the overview-layout include, and the self-update backend + its ACL; sweeps the legacy variant dirs INCLUDING `footstrap-top`; registers the one theme idempotently; **does not** change the active theme).

**Deploy by GLOB or by directory, never by a hand-written list of names.** `dev-sync.sh` used to name its four resource JS files individually, so a fifth would have shipped in the package (`luci.mk` copies `htdocs/` wholesale) and silently never reached the dev router — first tested after a release. The same bug lived in `.claude/skills/footstrap-deploy/deploy.sh`, whose `dest()` knew how to map `root/*` but whose file discovery never handed it one: editing `footstrap-selfupdate.sh` or its ACL and deploying did **nothing**, quietly.

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

## Writing JS: comments cost no bytes but are not free, regex literals are not free either

**A comment costs the user nothing — it costs the reader.** `luci.mk` runs the theme's JS
through **jsmin** at package time (built from `luci-base/src/jsmin.c`; `luci-base/host` is
already a build dependency, so it is on the buildbot). Comments are **105 KB of the 169 KB**
of source — **62%** — and jsmin takes the shipped bytes to **55 KB (−68%)** while the source
in git keeps every word. uhttpd serves `/www` with **no compression**, so those would
otherwise be wire bytes *and* flash bytes on an 8–16 MB device. The same holds for CSS:
`build-css.sh` strips comments too. **So never trade a "why" away for bytes — there are none
to save.**

**The budget that is real is the reader's attention, and the rule is: minimally sufficient to
see the problem and the reason.** A comment earns its place by naming the defect it guards
against, the measurement that made the trade worth making, or the "do NOT" that saves the next
person a rediscovery — a number with nothing behind it is a claim, and a claim with a number
behind it is why this codebase keeps them. It does *not* earn its place by narrating what the
next line does, restating what this file already said, repeating CLAUDE.md (a one-line pointer
does that), or recounting how the code used to look — unless the old shape is a trap someone
would re-introduce, and then it is one clause, not a paragraph.

**A stale comment is worse than no comment, because the next person trusts it.** Around forty
were once found describing code that no longer existed, and several stated the *opposite* of
what the code did — `jsmin-verify`'s own header said a non-zero exit proves nothing, when the
whole hazard is that jsmin exits **0**. When you change code, the comment above it is part of
the change; when a comment cannot be made true, delete it.

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
npm run check        # everything below, in one go — run this before pushing
npm run lint         # eslint (theme JS) + stylelint (styles/ tree)
npm run audit        # audit.py --strict: the export-tier reads, shadowed decls, stray !important
npm run conffiles    # every shipped /etc/config/* is declared, so an upgrade cannot eat it
npm run a11y         # axe-core, WCAG 2.2 AA, over docs/gallery.html
npm run export-tier  # the --*-color-* contract with third-party luci-app-*
npm run i18n         # the .pot is current and every string is translated
npm run css-metrics  # ratchet: !important, max specificity, no empty rules (the numbers live in the tool)
npm run css-orphans  # dead fs-* selectors (SAFE: scoped to our own namespace)
npm run css-dup      # the same declaration body under two different guards
npm run mirror       # @mirror-pinned copies (CSS *and* shell) are still byte-identical
npm run axes         # head.ut's pre-paint agrees with the live Appearance appliers
npm run chrome-fence # the fence, the pin and the dark-mode guard still match the chrome
```

**`tools/jsmin-verify.mjs` is the one gate `check` cannot run**, and it is the one that catches the
silent exit-0 corruption (see "Writing JS"): it needs a jsmin binary built from the pinned
`luci-base/src/jsmin.c`, which CI compiles (`build.yml`) and a dev box has no reason to. `wrap-regex`
in eslint stops the hazardous shape being written, so `check` covers the cause locally and CI proves
the effect. To run it by hand: build jsmin from the `luci-upstream.pin` commit and
`JSMIN=/tmp/jsmin node tools/jsmin-verify.mjs <files>`.

- **`axes` is the gate for the one duplication that cannot be pinned.** Every Appearance axis is
  implemented twice: `partials/head.ut` stamps `:root` **before the first paint** (inline, before the
  module loader exists — it cannot `require` anything), and `fs-prefs.js` / `fs-update.js` apply it
  live. Neither copy can go, and they cannot be byte-identical, so `@mirror` cannot hold them. What
  `tools/axes.mjs` holds is the **contract** — and it derives it *from the JS* rather than restating
  it: the localStorage keys, the `:root` attributes, the custom properties, the 1–360 ranges, the
  rounding default (which `head.ut` cannot read from the CSS token, because it runs before the
  stylesheet), and the load-bearing ordering rule — **set the custom property BEFORE the attribute**,
  or a reload paints one frame with the previous hue. That last one is the reason the gate exists: it
  is a one-line fix that would be made in the popover and forgotten in the template, and its only
  symptom is a single wrong frame, which nobody reports and no other test catches.

- **`css-orphans` is the only safe way to hunt dead CSS here, and the reason is the namespace.**
  PurgeCSS/uncss and coverage-based pruning are *actively dangerous* under the coverage contract
  above — they prune what they did not observe, and what they did not observe is exactly the
  third-party widget the contract protects. But **nobody outside this theme can emit an `fs-`
  class**, so inside that one namespace "nothing we ship emits it" really does mean dead. It reports
  both directions: styled-but-never-emitted (a hard failure — a selector left behind when its markup
  was deleted) and emitted-but-never-styled (a report; see `JUSTIFIED_UNSTYLED` in the tool).
- **`css-dup` finds what no linter can, and `@mirror` is how you answer it.** Two rules with the same
  declarations under mutually-exclusive guards (a media query vs an attribute selector, two
  `@container` thresholds) are *both required* to a cascade-aware tool — so no linter will ever call
  it an error, and it is exactly the shape that drifts.
  **Every duplicated body must be a decision: fold it into one rule, or pin it.** There is no numeric
  budget — a budget is a number nobody defends, and it lets the next unexplained copy in for free.
  When the guards genuinely cannot be merged in CSS, wrap the **declarations** of every copy in
  `/* @mirror <group>/<role> */ … /* @endmirror */` (inside the braces — the selectors legitimately
  differ, only the declarations must match). `css-dup` then accepts the duplicate, and
  **`tools/mirror.mjs` (`npm run mirror`) enforces that the copies stay byte-identical**. An unpinned
  duplicate is a hard failure.
  Note the trap the pin closes, because it is the whole point: `css-dup` finds bodies that are
  IDENTICAL, so the moment two copies diverge they stop being a "duplicate" and it goes quiet
  **exactly when you need it to shout**. `@mirror` is what makes duplication you cannot delete into
  duplication that cannot rot.
- **`@mirror` is not CSS-only — it covers the shell too**, because the same forced duplication exists
  there: `install.sh` is fetched with `curl | sh` and runs *before* the package exists, so it cannot
  source a library that ships *inside* the package — yet it must do exactly what
  `footstrap-selfupdate.sh` does (fetch over a verified channel, pin the asset host, check the
  sha256). That duplication had **already drifted**: the two `fetch()`s had different backend orders,
  one gave its first-choice tool no timeout at all, and one was missing the https redirect pin —
  and nothing said a word, precisely because a diverged copy is invisible to a duplicate detector.
  Currently pinned: `table-card/{label,actions}` (CSS: `.fs-stacked` vs the config table's
  `@container`), `gh/{fetch,asset-host,asset-urls,verify-sig}` (shell: the installer vs the
  self-updater) and `theme/legacy-names` (the legacy theme list, in `uci-defaults` and again in the
  `Makefile`'s `postrm`). Seven groups, two copies each — `npm run mirror` discovers them from the
  source and prints the list, so take the count from there, not from this line — plus one whole-file
  pin, `@same-file LICENSE`, because a
  licence text cannot carry a marker comment without ceasing to be the licence text.
  A `@mirror` group with only ONE copy is also a failure — a mirror of one enforces
  nothing.

- **eslint** needs `ecmaFeatures.globalReturn` — a LuCI resource file is evaluated inside a
  function wrapper, which is why each ends in a bare `return baseclass.extend({…})`. The
  `'require x as y'` pragma aliases are real bindings at runtime that ESLint cannot see, so they
  are declared as globals — DERIVED from the source tree (`resourceFiles()`), never listed, so a
  new module's alias cannot be forgotten.
- **stylelint** deliberately does NOT extend `stylelint-config-standard` (it is a
  formatter and would rewrite the whole tree). Only correctness rules, plus the project's
  own invariants: `declaration-no-important` with the same allowlist `audit.py` uses.
- **axe-core** runs over `docs/gallery.html` — a STATIC file that renders every widget, so
  the whole widget surface is auditable with no router. It sweeps `{light,dark} ×
  {footstrap,hicontrast} × {untinted,60°,260°}` — 12 combinations: a palette switcher multiplies the
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

## i18n — a `_()` with no catalogue is silently English, and a msgid is a GLOBAL name

Strings are wrapped in `_()` in the theme JS and the `.ut` templates, and `partials/head.ut`
already loads LuCI's client-side catalogue (`admin/translations/<lang>`). Nothing about a missing
or wrong translation can fail loudly — that is the whole shape of this area, and why the rules
below are gates and not advice.

- `luci-theme-footstrap/update-po.sh` rescans and merges; `--check` fails if the `.pot` is
  stale or any msgstr is empty. Run it after adding or changing **any** `_()` string. It compares
  **msgctxt as well as msgid** — the context is part of the key, so a `.pot` carrying the same
  msgids with the context dropped describes a different catalogue.
- It uses LuCI's own `build/i18n-scan.pl`, which knows how to lex a `.ut` (it rewrites the
  template into JS before xgettext) and also picks up the `rpcd` ACL title. A grep for `_('…')`
  would miss the ACL string and choke on any apostrophe.
- **The catalogue ships INSIDE the theme package, and the directory is `i18n/`, not `po/`.**
  luci.mk derives `LUCI_LANGUAGES` from `$(wildcard po/*)` and emits a separate
  `luci-i18n-footstrap-<lang>` package per language — the conventional layout, which **broke the
  update button on every router in the field** (v0.8.4, issue #6). A multi-asset release is
  unpickable by the self-updater the router ALREADY runs: it takes `grep '\.apk$' | head -1`, the
  GitHub API returns assets sorted **by name**, and `luci-i18n-…` sorts before `luci-theme-…`. So
  Update installed a 6 KB catalogue instead of the theme, said OK, and offered the same update
  forever. **A router's installed self-updater cannot be fixed remotely — the RELEASE has to stay
  pickable by the script that is already there.** CI therefore fails unless `dist/` holds exactly
  ONE package per format. Renaming `po/` is what stops luci.mk generating the language packages;
  `Build/Compile` runs the same `po2lmo`. The basename is `footstrap-theme.<lang>.lmo`, **not**
  `footstrap.<lang>.lmo`: `lmo_load_catalog` globs `*.<lang>.lmo` so any basename loads, and a
  router that installed v0.8.4 still *owns* `footstrap.ru.lmo` through the old package — writing
  that path would be a file conflict, and apk would refuse the very upgrade that fixes it.
  Bundling also kills the skew: two packages could drift, and a theme whose catalogue lags simply
  renders the new strings in English, reporting nothing.
- **A msgid is a global name, shared with every `luci-app` on the router.** `action_translations`
  calls `load_catalog(lang, '/usr/lib/lua/luci/i18n')`, which loads **every** `*.<lang>.lmo` in the
  directory into ONE catalogue, and a lookup returns the first archive holding the hash — so
  **readdir order decides who owns a string**. The layout toggle rendered "Максимум" on a user's
  Russian router: somebody's catalogue translates the msgid `Top` as "maximum" — correct in a
  bandwidth dialog, nonsense on a layout switch. Every label in the Appearance popover therefore
  carries the `footstrap` **msgctxt** (`_(str, ctx)`; po2lmo keys on `ctxt\1msgid`), which makes
  the key ours alone.
  Three things are deliberately left context-free, and this is the interesting half of the rule:
  the **chrome** (Menu, Logout, Skip to content) and the **login/notice sentences**, because
  inheriting `luci-base`'s translation is a *feature* in the ~40 languages this theme has no
  catalogue for; and **System/Memory/Storage** in `05_footstrap_overview_layout.js`, which
  *matches* the stock section titles and must therefore resolve to exactly what `luci-mod-status`
  resolves to.
- Verified end-to-end on the router (compiled `.lmo` → `uci set luci.main.lang=ru`), not
  merely by `msgfmt` exiting 0. `dev-sync.sh` deploys the catalogue when `po2lmo` is on `$PATH`.

## Build the .apk (distribution)

Via OpenWrt SDK: symlink the package into `feeds/luci/themes/`, `./scripts/feeds install luci-theme-footstrap`, `make package/luci-theme-footstrap/compile V=s`. Full steps in `docs/05`.

## Commit rules

Conventional Commits, message in English. **Never commit without an explicit instruction.** No co-author / "Generated with" / any AI attribution trailers.

**Two remotes, and both are the full repository — push to BOTH.** `origin`
(`github.com:VizzleTF/luci-theme-footstrap`) is what `main` tracks and what the CHANGELOG's
compare links and the self-update's release API point at; `forgejo`
(`git.vaka.work/vizzle/openwrt_footstrap`) is a complete mirror, not a partial or archival
one — same branch, same history, fast-forward. A push that lands on only one of them leaves
the other silently behind, which is exactly how `forgejo` ended up 11 commits stale. Tags go
to both as well, when a tag is asked for.

## CHANGELOG — every commit writes into `## [Unreleased]`, and a tag renames it

**Full style + format guide: `docs/21-changelog-stil-i-format.md`** (research-backed against Keep
a Changelog 1.1.0, Common Changelog and Conventional Commits) — the single source of truth for
category set, fixed section order, entry structure and the release workflow. Always follow it; the
summary below is the pointer, the doc is the contract.

Two files, kept in lockstep: **`CHANGELOG.md`** (English) and **`CHANGELOG_ru.md`** (Russian
mirror). Keep a Changelog format, newest first. Sections in the FIXED order `Added` / `Changed` /
`Deprecated` / `Removed` / `Fixed` / `Security` / `Performance` (KaC order + the project's
`Performance` extension), one section of each type per release, no duplicates. **Both are edited in
the same commit** — a mirror that lags is worse than no mirror, because the reader cannot tell which
one is stale.

**Every substantive commit adds its entry to the `## [Unreleased]` section at the top**, above
the newest tagged version — in the same commit as the code, never as a follow-up. A changelog
written later is written from the diff, and the diff is exactly the thing that does not know
*why*. Commits that change nothing a user or a maintainer could observe (a typo in a comment,
a CI-only refactor with identical behaviour) do not need an entry; when unsure, write one.

**Cutting a release is three steps, in this order**: rename `## [Unreleased]` to
`## [x.y.z] — YYYY-MM-DD` and add the `compare/` link at the bottom (in both files) → commit
that → tag **that** commit. Never tag first: the tag must point at a commit that already
contains its own entry, otherwise the release page and the tarball describe a version whose
changelog does not exist yet. A fresh empty `## [Unreleased]` goes back on top with the next
commit that has something to say.

**The GitHub release body is generated from the changelog, not written by hand.** On a `v*`
tag the CI release job runs `tools/release-notes.sh <x.y.z>`, which pulls the tag's
`## [x.y.z]` section out of **`CHANGELOG.md`** (the English file) and emits one line per
change — the **bold lead of each bullet only**, grouped under its `### Fixed`/`### Added`/…
header, with the rationale paragraph dropped and the install commands tucked into a collapsed
block. Consequences for how you write an entry: the bold lead is the release note, so it must
be a **self-contained one-line summary** that reads on its own (it appears with no rationale
behind it); a bullet with **no `**bold**` lead is silently omitted** from the release; empty
sections are dropped, so a `### Changed` with no bullets never shows. The multi-line-bold and
inline-`code` shapes this project already uses are handled. `CHANGELOG.md` is the primary
source; the **Russian summary from `CHANGELOG_ru.md` is appended** after the English one under
a divider, so keep the mirror's `[x.y.z]` section in step or the release page shows English
only for that half.

What goes in an entry:
- **Each entry is `- **one-line effect.** then the rationale`** — the bold lead states what
  changed for the reader in a single self-contained sentence (it becomes the release note, see
  above), and the prose after it carries the *why*, the measurement and what the rule protects.
- **Write the effect, not the diff.** "Buttons had no focus indicator at all" beats "changed
  `:hover` to `:focus` in `styles/base/70-buttons.css`". The reader wants to know what was
  broken for them and whether it is fixed.
- **Keep the number that made the change worth making.** This project's commit bodies already
  carry them (20 KB of font drawing 227 labels; 312 of 336 elements repainted by a hostile
  `:root`; contrast at 1.69:1 where AA wants 4.5) — a claim with a measurement behind it is
  the whole difference between a changelog and a marketing blurb. Carry it across.
- **Say what a rule protects against when it is non-obvious**, in one clause. Half of this
  theme's invariants exist because the obvious alternative was tried and measured worse; an
  entry that omits the reason invites the next person to undo it.
- Several commits may land under one heading — the released section is per *release*, not per
  commit, and `[Unreleased]` accumulates until it is renamed.
