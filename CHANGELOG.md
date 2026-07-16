# Changelog

Notable changes to `luci-theme-footstrap`, newest first. Format is
[Keep a Changelog](https://keepachangelog.com/1.1.0/); commits are
[Conventional Commits](https://www.conventionalcommits.org/), versions are
[SemVer](https://semver.org/). Sections, in fixed order: Added, Changed,
Deprecated, Removed, Fixed, Security, Performance — one of each per release.
Style and format guide: [docs/21-changelog-stil-i-format.md](docs/21-changelog-stil-i-format.md).

[CHANGELOG_ru.md](CHANGELOG_ru.md) mirrors this file. Edit both in one commit.

Every commit writes into `[Unreleased]`. Cutting a tag renames that heading.

## [Unreleased]

### Added

- **A live playground of the theme, published to GitHub Pages.** A real OpenWrt overview page, saved from a live router
  and fully anonymised (every MAC, client IP, IPv6 prefix, SSID and device hostname replaced) —
  the System/Memory/Storage grid, port status, wireless, interfaces and DHCP leases exactly as the
  theme renders them. The
  Appearance button opens the theme's real popover with every control wired up — Layout, Theme,
  Palette, Wallpaper, Tint, Accent, Rounding, Submenus and the icon rail — so you can drag the sliders
  and watch the whole page repaint without installing anything. Nothing navigates (every menu link is
  inert; the menu only opens and closes) and the controls deliberately touch no `localStorage`, so it
  can't change a real router's saved look. The control markup reuses the theme's own classes and
  drives the same `:root` attributes / custom properties the real popover does (the contract in
  `tools/axes.mjs`), so it repaints exactly as the router would. Linked from the README and the devkit.
- **A developer portal for third-party `luci-app-*` authors, published to GitHub Pages.** One
  self-contained page an app author opens to see what to copy, which colour token to read and what
  not to do — the 26-name export-tier grid (live under dark/palette/tint, click-to-copy `var()`), a
  component catalogue with Preview/HTML/`E()` tabs, and the styling rules with the real-app bug
  behind each. It is generated (like `cascade.css`) from the sources that already exist — tokens
  parsed from `02-tokens.css`, components sliced from `docs/gallery.html`, the real stylesheet and
  its fonts inlined — so nothing is hand-copied and nothing drifts.
- **"Fix my styles" — an in-browser checker in the portal.** Paste a chunk of an app (CSS, a
  `<style>`, a DevTools copy) and it points at **each** problem where it is — the line number, the
  source line with the offending fragment highlighted, and, for the mechanical ones, the exact
  before→after edit (click the green to copy just that fix; or "Apply every fix & copy" for the whole
  rewrite at once). It auto-fixes colour literals to export tokens with a literal fallback,
  `--warning-*`→`--warn-*`, private `--fs-*` to the matching export token, stray `!important`, runaway
  `z-index`, `<font color>` — and flags the structural ones it must not auto-touch (`<head>` injection, `:root {}`, un-prefixed classes, `window.onload`,
  `prefers-color-scheme`, a hardcoded editor theme, unscoped stock selectors). Every colour keeps the
  original as a `var(--token, original)` fallback, so a rewrite can never change how the app renders.
  To feed it, paste the CSS directly, drop in a whole **Save Page As** dump (it flags a `<style>` /
  `<link>` living in `<head>`), or run the one-line console grabber on the running app — it harvests
  every `<head>`-injected sheet, every inline `style=` in `#view` and every `<font color>` to the
  clipboard. It drops **nothing** — a prefix filter would have hidden the very un-prefixed classes
  (`.centered`, `.toast`) the codemod exists to catch — and instead tags each `<head>` sheet with its
  first selector, so the theme's own stylesheet, LuCI base's injected bits (`status/cpu.js`,
  `package-manager.js`) and other apps on the page are told apart from yours. Cross-checked on a live
  router against `luci-app-podkop`, `luci-app-justclash` and `luci-app-filemanager` (the last: 38
  colour literals, 14 `!important`, a `<head>` sheet, a `:root {}` and unscoped stock selectors, all
  caught) and a real excerpt of OpenClash's `oc.css`.

### Changed

- **The segmented Appearance controls are one tab stop each and answer the arrow keys.** They carried
  `role="radiogroup"`/`role="radio"` — a promise of W3C-APG behaviour — while every button stayed
  natively tabbable and the arrows did nothing, so a keyboard user tabbed through N stops in a control
  a screen reader had announced as one radio group. They now use a roving tabindex, arrows move *and*
  select with wrap-around, and Home/End jump to the ends. `npm run a11y` was green over this
  throughout: axe checks names and roles, not key handling. The popover also declares `aria-modal`,
  matching the Tab trap it already had.
- **The released `.apk` is built from the newest 25.12.x release SDK, not from `snapshots`.** The ipk
  leg already resolved the newest 24.10.x point release, while the toolchain and `apk mkpkg` behind
  the package users install drifted daily against a release that does not — the same argument, applied
  to both legs.
- **`install.sh` and the self-updater no longer overstate what survives a redirect.** The comment
  claimed the scheme was pinned on the redirect, but `--proto-redir` exists only on the curl branch,
  and `uclient-fetch` — tried first, and the only downloader on a stock router — has none; the host
  pin likewise covers the initial request only. Nothing is less safe than it was (the ed25519
  signature is what vouches for the package and it fails closed), but the docs now say which single
  layer actually reaches across the hop to `objects.githubusercontent.com`, instead of inviting a
  reader to budget three.
- **The Appearance "Reset" button is now labelled "Reset to default".** "Reset" alone did not say
  reset to *what*; the button drops this browser's overrides onto the router-wide default saved with
  "Save as default", so the label now names that destination.

### Fixed

- **The menu no longer closes itself once a second on a phone.** Tapping a section open and having it
  snap shut a second later was the poll doing it: `fitShell()` wrote `data-narrow` with
  `setAttribute` on every measure, and a same-value `setAttribute` still **queues a MutationObserver
  record** (measured in Chromium: 5 identical writes → 5 records; `toggleAttribute` on an
  already-present attribute → 0). Since `fs-fit` re-measures on every mutation inside `#view`, and
  LuCI's poll rewrites that once a second, the menu's `data-narrow` observer read each no-op write as
  a mode *change* and ran `closeFlyouts()`. It bit only the narrow sidebar (390 − 224 − 56 = 110 px of
  content, so the attribute is permanently set) — the wide and top layouts take the `removeAttribute`
  branch, which is silent when the attribute is absent, which is exactly why it survived: it is
  invisible on a desktop.
- **Saved Appearance defaults survive a theme upgrade.** `/etc/config/footstrap` is shipped as an
  empty stub and written at runtime by Appearance → "Save as default", but was never declared a
  conffile — so the package manager owned it as an ordinary file and replaced it on upgrade, and the
  theme's own one-click Update silently wiped every saved option while reporting success (the dev
  router held eight). One `conffiles` define covers both managers; `npm run conffiles` now fails if a
  shipped `/etc/config/*` is left undeclared, because nothing about this failure is observable — it
  lands on someone else's router, months later, at the moment they upgrade.
- **A broken stylesheet can no longer be left in place by the build.** `build-css.sh`'s floor check —
  the guard against a truncated write or a squeeze that ate the tail — ran *after* `mv` and after the
  cleanup trap was disarmed, so its own failure path left the mangled sheet at the output path.
  `dev-sync.sh` writes straight into `htdocs/`, so that file stayed in the working tree for the next
  `scp` to ship. The floor is now measured before the move, with the trap still armed.
- **`dev-sync.sh` deploys `root/` as a tree, so a new file reaches the dev router for free.** It
  tarred `usr` literally — a hand-written list of one, the very thing its own comment forbids — and
  `root/etc/` was the counterexample already in the tree: `root/etc/config/footstrap` shipped in the
  package and never reached the router. It now globs the top-level dirs, excluding only the two
  subtrees with real semantics: `uci-defaults` (deliberately run from `/tmp`) and `config`, which is
  installed only when **absent**, mirroring what the package manager does with a conffile — deploying
  over a live one would be the very wipe the fix above prevents.
- **The playground's top-bar menu no longer sticks a clicked dropdown open forever.** It click-toggled
  `.open` and never cleared it, so a tapped panel stayed on screen when the pointer left — the one way
  the demo diverged from a live router. It now mirrors `menu-footstrap.js`: in flyout mode (top bar /
  rail / narrow) a tap sticks the panel only until a real mouse re-enters (CSS `:hover` takes over) or
  a click lands outside/Escape closes it; the expanded-sidebar accordion is untouched, where `.open`
  legitimately persists.
- **The Wireless "Associated Stations" table no longer wraps Signal/Noise and the RX/TX rate onto
  extra lines** (issue #7). `overflow-wrap: anywhere` split the short "-54/-90 dBm" wherever a
  character landed and stacked the modulation string ("229 Mbit/s, 20 MHz, HE-MCS 9, HE-NSS 2") into
  6-9 lines per client — at ~1024px the whole table was a nine-line mess (measured on the router).
  Both columns are now nowrap, like the MAC already was, which also raises the table's floor so
  `fs-select.js` folds it into the clean per-field card a step earlier instead of crushing the
  columns. The Signal reading sits inside an `.ifacebadge` that re-declares `white-space: normal`, so
  its own text takes the nowrap too. Host is left to wrap — a hostname plus IPv6 is legitimately long.
- **The collapsed sidebar (icon rail) no longer leaves 1px specks of the hidden submenu at its edge**
  (issue #7). The sidebar was `position: sticky`, which the browser promotes to a composited GPU
  layer; with `overflow: visible` (needed so the rail's flyouts escape sideways) every hover repaint
  of the column left a 1px seam of the flyout's buttons/headers at the layer's edge, cleared only by a
  full repaint — visible on the live collapse and on hover, never on a fresh load. The desktop sidebar
  is now a STATIC element (not a layer, so nothing can be left stale) and the content column scrolls
  inside `.fs-main` instead of the window. It also drops the z-index the sticky layer needed: a static
  sidebar is no stacking context, so the flyouts sit above the content on their own `--fs-z-flyout` in
  the root context. Confined to the desktop sidebar via the `:not([data-narrow])` guard — the top
  layout and the phone bar keep window scrolling and their sticky bar.
- **Hovering the Diagnostics page no longer highlights the whole controls block, and empty tables
  no longer light up their "no data" row** (issue #5). A single generic `.table .tr:hover` tint hit
  every table, including layout tables the theme never meant to make interactive: the Diagnostics
  input+button row is one `<tr>` spanning the whole card (no header row, so it is never tagged a data
  table), so hover lit the entire block; and a data table's placeholder row ("There are no active
  leases") lit up on hover the same way. Row hover is now scoped to real data tables (per cell,
  placeholder excluded) and config-table data rows only.
- **The device/MAC badge in the Network status box now follows the rounding scale instead of a flat
  4px** (issue #5). It kept the base widget's hardcoded 4px corners, which read as square next to the
  card's `--fs-radius`; it now uses the token, so it rounds with the Appearance Rounding axis. Scoped
  to the status box — the small firewall zone badges stay tight.
- **The "Keep settings" checkbox in the firmware-upgrade confirm dialog no longer hugs its label
  text** (issue #5). The attendedsysupgrade dialog renders `label.btn > input[type=checkbox]` + text,
  and the base rule that zeroes a checkbox's margin left only a literal space between the ✓ and the
  words; a `.btn > input[type=checkbox]` margin restores the gap without touching the toggle switches.
- **A failed "Save as default" now shows a visible message instead of a silent tooltip.** On a
  rejected save rpc — most often an expired login session — the old code parked the error in a
  `title` attribute nobody hovers, so the click looked like it did nothing; the popover now shows
  "Could not save the default. Reload the page and try again." in place of its (absent) status text,
  with the raw rpc error kept in the tooltip for debugging. Note this does not cover a *deleted*
  `/etc/config/footstrap`: rpcd stages the write in the session and the commit then silently no-ops
  without recreating the file, returning success (measured on the router) — that file is owned by the
  package, and the read side already falls back to the built-in defaults.

## [0.9.0] — 2026-07-15

### Added

- **Appearance now has "Save as default", which stores the current look as the router-wide default
  for every browser and device.** Until now the whole popover lived only in the browser's
  localStorage, so a second device — or a cleared cache — started from the built-in defaults. Save
  writes all eight axes (layout, theme, palette, wallpaper, tint, accent, rounding, submenus) into
  `/etc/config/footstrap`; the server stamps them before the first paint, so a fresh browser inherits
  them with no flash. The write goes through a scoped rpcd ACL that grants the session `uci` write to
  the `footstrap` config only — rpcd validates every name, so no value reaches a shell. **The browser
  always wins**: this device's own choice, stored explicitly, overrides the saved default in either
  direction (you can still turn a router-defaulted tint back off), and "Reset" clears this browser's
  overrides so it drops back onto the saved default. A router upgraded from the old top-nav theme
  keeps reading its `luci.main.footstrap_layout` migration seed as the layout fallback.

### Changed

- **The header logo box is now the same size as the other square buttons in the bar (34px).** It sat
  at 30px while Appearance, Log out and the collapsed "Refreshing" pill were all 34 — the one odd
  square in the right cluster's row. The size is now a single token (`--fs-btn-size`) that all four
  read, so the row stays a set of equal squares and can be retuned in one place. The mark inside the
  box grew from 17 to 20px to fill the larger square.
- **The header logo now shows the OpenWrt favicon mark in a bordered box.** The accent-gradient tile
  behind the logo is gone; in its place is a plain 1px border, the same treatment the square buttons
  in the right cluster carry (Appearance, Logout). The glyph is the mark the browser tab already
  shows. Its ring follows the theme mode — dark on the light UI, light on dark — the way the SVG
  favicon follows `prefers-color-scheme`, though the logo reads the theme's own dark-mode flag rather
  than the media query. The cyan arcs are fixed and stay legible in both modes.
- **The top navigation bar now collapses by measurement at every width, and the "Refreshing"
  indicator shrinks to an icon before the menu wraps to a second row.** The bar used to switch to a
  phone layout at a hard 768px breakpoint; now `fitChrome` (the ResizeObserver) shrinks the menu
  pills, then swaps the "Refreshing" pill for a bordered green icon square — grey when the poll is
  paused, matching the Appearance and Log out buttons — freeing ~56px that is often enough to keep
  the menu on the brand's row, and stacks onto a second row only when even that overflows. No 768px
  floor: whether the menu fits depends on how many sections the router has, not on the screen. The
  sidebar layout keeps its own measured phone bar (`data-narrow`), untouched.

### Fixed

- **A section's dropdown jumped to the bar's left edge once the top menu wrapped to two rows.** Below
  the old 768px breakpoint the top bar fell back to a phone layout that pinned every dropdown to the
  bar's left edge, so a wrapped menu could show Network's submenu under Status. With the bar now
  measured at every width, each dropdown stays anchored under its own item, and the existing clamp
  keeps it inside the viewport.

## [0.8.9] — 2026-07-15

### Added

- **A gate against the whole class of bug above: no CSS rule may key off a `data-title` VALUE**
  (`npm run css-i18n`, and a CI step). Reading the attribute is fine — that is how a carded table
  prints its column labels — but matching it means matching a translated, render-dependent UI
  string, and the failure is silent in both directions: dead in every language you do not speak, and
  dead everywhere if your own stylesheet uppercases the heading. Presence tests (`[data-title]`) stay
  allowed.

### Changed

- **The 1676-line `menu-footstrap-common.js` is now one module per concern.** It had grown to hold
  seven unrelated things at once — the Appearance axes, the disclosure primitives, the menu-tree
  resolution, the chrome render and its measurements, the SPA router, the third-party-CSS guard and
  the self-updater — and a file that large stops being read: the same `EDGE_GAP` was written twice,
  and the update UI reached its own refresh through a `window.__fsUpdateApply` global for want of a
  seam. Split into `fs-menutree` (path ⇄ menu node, the port of `dispatcher.uc`), `fs-prefs` (the
  axes and their localStorage), `fs-widgets` (disclosure primitives, seg/slider controls, popup
  placement), `fs-chrome` (mode menu, tabs, rail, `fitShell`/`fitChrome`), `fs-router` (the SPA
  router), `fs-sheets` (the injected-CSS guard), `fs-update` (`FS_VERSION`, the check, the one-click
  install) and `fs-appearance` (the popover DOM); `menu-footstrap-common.js` keeps only the
  bootstrap. Nothing changed behaviourally — verified on the router: the chrome renders, an SPA nav
  still swaps the view in place (no full load), Back works, the popover builds all nine groups and
  the axes still apply, with zero console errors; jsmin's output stays token-identical for all 13
  shipped files.
- **Modules compose by CALLING, and the runtime enforces the graph.** `L.require` instantiates each
  module once as a singleton, so a module cannot subclass another (docs/11), and it raises
  `DependencyError` on a cycle — so shared halves (`fs-menutree`, `fs-prefs`) were pulled DOWN into
  their own modules rather than reached across, making the graph a DAG the runtime itself checks.
  Dependencies resolve through `Promise.all`, so the extra files cost round-trips in parallel.
- **The minified-JS ratchet goes 47104 → 50176 B, and that is what the split costs.** 46 621 →
  49 121 B, +2 500 B (+5.4 %): every module adds its own pragmas and `return baseclass.extend({…})`,
  and each call across a seam grows an alias prefix. uhttpd does not compress, so these are wire
  bytes — the raise is a deliberate trade for no file over ~600 lines, not drift.

### Fixed

- **The zone colour spilled past the rounded corner of an interface box** (issue #7). Network →
  Interfaces draws the zone as an inline background on `.ifacebox-head`, and `base` pairs a 4px box
  with a 3px head so the two round together — but `theme` bumped only the BOX to `--fs-radius`
  (10px by default), leaving a 3px head whose square corners cut straight through the rounding. The
  head now derives its radius from the box's, minus the 1px border it is inset by, so the two round
  together at any setting of the Rounding axis.
- **A MAC address still broke across two lines on every non-English router** (issue #7). The nowrap
  that was supposed to stop it keyed on `[data-title="MAC address"]` — and LuCI fills `data-title`
  from the column HEADING, so on a Russian router the cell says `MAC-адрес` and the rule matched
  nothing. It was fixed, released, and the reporter kept seeing the bug, because the fix only ever
  worked in the language it was written in. Anchored on the column instead; a translation cannot
  reorder columns. The same dead-in-40-languages pattern was in the DHCP leases table (DUID, the
  IPv6 list, the hostname) and is fixed with it.
- **A package-manager rule matched nothing at all, on every router, in every language.** The stacked
  card's Description cell keyed on `[data-title="Description"]`, but LuCI builds that table's cells
  from the heading's `innerText` — and the theme's own `text-transform: uppercase` on `.th` means the
  attribute really reads `DESCRIPTION`. The theme's CSS was rewriting the string the theme's CSS
  matched on, so the cell never got its block layout (measured: 0 elements matched). Anchored on the
  column; the layout now applies.

- **Three gates were aimed at one filename and would have gone quiet.** `tools/axes.mjs` read the
  Appearance contract out of `menu-footstrap-common.js` by name, so an axis living anywhere else
  would have been checked by nothing; it now reads the whole resources tree, which cannot go stale
  that way. The ESLint globals for `'require x as y'` aliases were a hand-written per-file list —
  the exact shape that stopped covering the next module added — and are now derived from each file's
  own pragmas, which also keeps `no-undef` able to catch a file using `prefs.` without requiring it.
  `Makefile` and `dev-sync.sh` stamp `FS_VERSION` by `sed`-ing a path, so both now point at
  `fs-update.js`; had they not, the popover would have silently shown "(dev)" and the update check
  would have stopped.
- **`css-orphans` reported a live selector as dead CSS, because it blinded itself to a NAME.** Module
  names were ignored by name so their `require` pragmas would not read as classes — which broke the
  moment a module was named after markup it owns: `fs-appearance` is both a module and the id of the
  button that opens it, so the ignore also hid the real `#fs-appearance`. It now blanks the
  POSITIONS a module is referenced from (the pragma line, `L.require('…')`) and the positions an
  `fs-` token is not a class (`--fs-*` custom properties, `data-fs-*` attributes), so a name can be
  shared between a module and its markup without lying to the tool.

## [0.8.8] — 2026-07-14

### Fixed
- **Software page on a phone: `filtered / all / none` stood one per line.** The rule that stacks that
  page's control titles was written as `.controls label`, so it also blocked the three radio labels
  nested a level deeper inside the group. It targets the group's own title label now
  (`.controls > div > label`), and the three choices sit on one row — at 320px too.
- **Software page on a phone: the pager broke onto three lines, and the package list still printed a
  column header it no longer needed.** Both are the same shape of bug — a rule aimed at one thing
  hitting another that merely shares its element name.
  The pager (`«` / `Displaying 1-100 of 7677` / `»`) is a `<div class="pager">` inside a `.controls`,
  and the phone rule that stacks that page's *labelled control groups* is written for
  `.controls > div` — so it blocked the pager too and its three children went one per line, 97px tall
  where 43 will do. It excludes `.pager` now.
  The header is the same story one layer up: `pages/30-software.css` shapes a carded row with
  `#packages.fs-stacked .tr`, and an **ID selector in the `page` layer** outranks
  `theme/30-tables.css`'s `.table.fs-stacked .tr.cbi-section-table-titles { display: none }` — so the
  column header came back on a screen where every cell already prints its own label. Both header rows
  are excluded from that rule.
  Desktop is untouched: 0 computed-style diffs over the package list, the overview and DHCP.
- **Port status: on a Russian router, a port that was DOWN but had carried traffic pushed its figures
  out of its own card and under the next one** (issue #7). The tile is a two-column layout — speed on
  the left, TX/RX on the right — and "do those two still fit side by side?" was answered by a
  `@container` threshold of 158px. A threshold is a **proxy for a question about the content, and this
  one was calibrated on English**: `no link` is ~45px against `нет соединения` at ~100px, and the
  figures are `nowrap` by design (`▲ 151.2 MiB` ~85px against ~35px when the counters read zero). That
  combination needs ~193px inside a card whose content box is 178 — so the threshold never fired, and
  a grid does not wrap: it overflowed. With the counters at zero the same card fitted, which is exactly
  what the reporter saw.
  The layout is a wrapping flex row now, which asks the real question for free: the two cells share a
  row while they fit and the figures take one of their own when they do not. Both `@container`
  thresholds are deleted — **removing them is the fix**, not a side effect. No JS: an observer (the
  first thing considered) would have to re-measure on every poll, since `29_ports.js` rebuilds these
  tiles every 5 s, to compute what the layout algorithm already knows.
  Three traps on the way, each caught by measuring rather than reading: `flex-basis: 100%` does not
  resolve on this card (it carries `container-type: inline-size`, so the main size is not a definite
  length — `width: 100%` is what works); `margin-left: auto` is counted when Chrome breaks lines, so
  the figures wrapped even on a card they fitted; and switching the card from `grid` to `flex` woke up
  a `flex-direction: column` that `base` has always set on every `.ifacebox` and that the grid had made
  moot — everything stacked into a column until the axis was stated.

## [0.8.7] — 2026-07-14

### Added
- **The widget gallery renders LuCI's real `ui.FileUpload`** — closed, and with the file browser
  open: the listing rows, the breadcrumb and the `Browse… / Filename / Upload file` strip, with the
  class names `ui.js` actually emits. It was represented by a bare `<input type="file">`, which
  shares none of that markup and so hid the clipped-button bug above from every check the theme has.
- **The gallery also renders the tooltip colour words, `.cbi-select` (valid and rejected) and an
  alert's full body** (`h5`, a list, a `<pre>`) — the widgets whose styling could not be settled
  either way while nothing drew them.
- **`galdiff.py`: a computed-style differ for the gallery**, and the reason the change above could
  be made safely. `cssdiff.py` drives a live router page, so it only ever sees widgets some page
  renders — exactly *not* the ones the absorption backlog is about; on those it reports no diff
  whatever you delete. The gallery has them all, so a base rule that still does work shows up as a
  real diff. It needs no router.

### Changed
- **Three `!important`s are gone from `styles/base` (33 → 30), and they are the three that should
  never have been there.** A flag in `base` is a flag aimed at the theme — `!important` inverts the
  layer order — so the rule this project writes down is that a flag must fight an *inline* or
  *unlayered* declaration, never another footstrap rule. These three fought footstrap: `.cbi-dropdown`'s
  `display` and `padding` were flagged to beat **base's own** generic form-field rule (which sets
  `display: inline-block` / `padding: 4px` on that very selector at a higher specificity), and
  `.spinning`'s `padding-left` was flagged to beat *them*. A later layer answers the first two for
  free and one specificity ladder answers the third, which is exactly what the layer split is for.
  Computed styles are identical — over the gallery and over three router pages, 0 diffs — and the
  ratchet is tightened to 30 so they cannot drift back.
  The remaining 30 all earn their place, and now provably: the six dropdown-state flags, the six
  forcing utilities (`.td.right` and friends — LuCI writes them on a cell *to* override the table's
  own alignment, and they lose to it on specificity alone), and the flags that fight an inline
  `style=`, an unlayered `<style>` blob, or `prefers-reduced-motion`.
- **CI is off the deprecated Node 20 runtime.** Every action was three or four majors behind
  (`checkout@v4` → `v7`, `setup-node@v4` → `v5`, `upload/download-artifact` → `v7`/`v8`,
  `action-gh-release@v2` → `v3`), and GitHub was already force-running them on Node 24 while
  warning on every job — the one piece of debt here with somebody else's clock on it. The inputs
  this workflow passes are unchanged across those majors; `download-artifact@v8` additionally turns
  an artifact hash mismatch into an error rather than a warning, which is the direction this
  repository's release path wants anyway.
- **The validation tooltip is themed now, and half of the base layer's absorption backlog is
  gone with it (50 declarations → 25).** `.cbi-tooltip`'s colour words were the one status surface
  the theme had never claimed — base carried them, and a comment there said so in as many words.
  Nothing could contradict it: the gallery rendered a *plain* tooltip only, and an un-rendered
  widget shows no diff, which reads as "that rule is already dead". The gallery renders all four
  now, and the measurement said the opposite — they were alive and un-themed. They are the theme's,
  in tokens.
  The same instrument then settled the rest of the backlog by measurement rather than by reading:
  every `border-color` base declared for a button variant (`.cbi-button-edit`, `-apply`, `-save`, …)
  turned out to be **dead on arrival** — the theme sets `border` on `.cbi-button`, and a later layer
  beats an earlier one whatever the specificity, so those buttons never wore the colour base
  declared. Deleted. What was genuinely alive got absorbed: the dropdown's width and its menu rows
  (the Save & Apply split button's menu had kept base's tight rows while every other dropdown was
  themed), the `…` overflow chip beside the chevron, the `<var>` in a form row, the invalid state of
  a `ui.Dropdown`, and an alert's `h5`/`ul`/`li`/`pre`.
  What remains in base is base doing its documented job — the focus ring and the transition every
  *unnamed* `input`, `button` and `select` falls back on. Absorbing those would mean the theme
  claiming every bare element selector, and the layer split exists precisely so overrides do not
  depend on source order.

### Fixed
- **The file browser clipped its own buttons: `Delete` was served sliced by the widget's border.**
  LuCI's `ui.FileUpload` sizes a listing row by proportion — name `flex: 10`, actions `flex: 3` —
  which fitted the ~20px buttons stock LuCI draws there. This theme's button is 36px tall with 14px
  of side padding, and a file row carries up to three (Deselect, Download, Delete): at 23% of the row
  they do not fit, and the row is `overflow: hidden`, so a button touched the clip box on **both**
  axes and lost its rounded corners to it — which reads as a broken button, not as a missing 8px.
  With no space between rows, one row's button also ran into the next row's. The action column is
  sized to its content now (a name can ellipsize; a button cannot), the browser has a real gutter,
  and the rows are spaced. Reaching this widget on a router takes two clicks inside a page most
  users never open, which is why it went unseen — `docs/gallery.html` now renders it open, so the
  next regression there is visible without a router.

- **Data tables rendered outside a CBI section drew a straight border across their own rounded
  corner, and every separator twice.** The apk package list and Status → Firewall's nftables tables
  are the live cases (issue #7). The theme declared a table's separators on the `.tr` — but the
  frame those tables carry needs `border-collapse: separate`, and **in the separated model a row's
  border is never painted**, so those rules drew nothing at all. What actually drew the lines was a
  per-cell `border-top` left over in `base`, which nobody had asked for: it also ran along the
  table's top edge, straight across the frame's radius. The separators are declared on the cells
  now, where they paint. Note this is one fix, not two — the first attempt removed the base border
  alone and shipped a package list with no separators whatsoever.
- **A button in a `.control-group` sat on top of the input next to it** — package-manager's
  Filter/Clear and "Download and install"/OK (issue #7). `.control-group` is bootstrap's *joined*
  input-group: base pulled the button back over the input so their 1px borders would coincide, and
  squared its left corners to match. This theme does not join controls, and a cascade layer beats
  base unconditionally, so the squared corners never applied while the pull-back still did — the
  button's rounded corner landed on the input's. They get a real gap now. The password reveal is the
  one group that genuinely is joined, and it builds its own seam.
- **Status → Firewall (nftables): the table header text was glued to the table's rounded frame.**
  Those tables carry `.cbi-section-table` but sit in a bare `<div>`, and that class zeroes the cells'
  left padding — correct only inside a `.cbi-section`, whose own 16px is the gutter. A table that
  draws its own frame now pads its own cells.
- **A MAC address in the associated-stations table broke across two lines** (issue #5); stock LuCI
  keeps it on one. Data cells may break anywhere — that is what reflows a wide table into the
  content column instead of scrolling it — but a MAC is not a breakable string, and at ~103px the
  column split it every time. Same targeted `nowrap` the DHCP leases table already uses.
- **A text field in a CBI form was too narrow to show its own value** — Attended Sysupgrade's server
  URL was clipped mid-domain (issue #5). The field was a fixed 210px, inherited from bootstrap's
  cascade, and that width holds far less here: the field is monospaced and padded 11px a side
  instead of 4. It is elastic now, capped at the same 440px as the `.cbi-dynlist` directly beneath
  it on that page — the mismatch between the two is what made the field look broken.

- **The README screenshots advertised a dashboard the theme does not have.** They were taken the day
  before the custom overview include was retired (it rebuilt a page-tall tree on every poll, which
  flickered and reset scroll on a phone), so they showed a Network card and a port grid this theme
  has not rendered since — and a user reasonably filed that difference as a rendering bug (issue #5).
  Regenerated from the current theme. The GIF was recorded after the change and was already correct.
- **The favicon was a flat cyan tile that fought every browser's tab strip.** The mark stays
  OpenWrt's on purpose — a tab icon says which *device* this is, not which theme paints it — but the
  solid square it was pasted on is gone: the icon is transparent now, so it sits in whatever the
  browser draws (issue #7). The SVG also lightens its dark ring under `prefers-color-scheme: dark`,
  where a near-black ring on a dark tab strip was all but invisible; `logo_48.png` is the fallback
  for browsers without SVG favicons and carries the light variant. It is also **320 bytes now,
  against 2 337** — uhttpd serves `/www` with no compression, so that is wire bytes.

## [0.8.6] — 2026-07-14

### Changed
- **The whole `docs/` tree now describes the theme that exists.** All twenty documents were checked
  claim by claim against the code. Two were deleted: `docs/10` (85 of its 94 lines specified a
  top-nav renderer that was removed — its one unique piece, `clampDropdown`, lives in
  `menu-footstrap.js` with a fuller comment) and `docs/12` (80% a worse copy of `docs/gallery.html`,
  and it "covered" a `.cbi-fileupload*` selector that exists in neither LuCI nor this theme). The rest
  were corrected: every token name they printed was dead (`--accent` → `--fs-accent`; the export tier
  was called a "bridge" when it is one-way and reading it from inside `styles/` fails the build), the
  layout was still described as a server-side theme entry, `dev-sync.sh` was documented with 1 of 5
  points right, and the benchmark numbers carried no version stamp. Exact byte counts were replaced
  with approximations plus the budget — the sheet grew by 37 bytes during this very pass, which is how
  precise numbers rot.
- **The READMEs describe the theme that exists.** The package README promised **two** theme entries
  (`FootstrapSidebar` / `FootstrapOnTop`), a `/luci-static/footstrap-top` symlink, `-dark`/`-light`
  symlinks, a `mobile.css` and a `sysauth.js` — none of which exist — claimed the theme needs OpenWrt
  25.12+ (24.10 is supported too), and told the reader to customise `cascade.css`, a **generated** file
  that is in `.gitignore`. It is now a short, true file: one theme entry, one renderer, where the CSS
  source actually lives, and `npm run check` before pushing. The root README (and its Russian mirror)
  had its benchmark labels swapped and its own result understated — the median page is **3.4×** faster
  than luci-theme-bootstrap and the whole 38-page run **2.3×**, with requests per page falling from
  15–48 to **0–8**; it read "≈2.3× median, ~1.9× overall, 15–39 → 1–4", and that 1.9× appears nowhere
  in the benchmark. It also promised the theme "carries its own translations, so it follows whatever
  language LuCI is set to" — the catalogue is **Russian only**; other locales get English for the
  theme's own strings.
- **CLAUDE.md now asks for comments that are minimally sufficient, not maximally dense — and its own
  stale numbers are fixed.** The guidance said "comment as densely as you like — the comments do not
  ship", which is how forty lying paragraphs grew: bytes are genuinely free (jsmin and `build-css.sh`
  strip them, so a "why" is never worth trading for bytes), but the reader's attention is not. The
  rule is now to state the problem and the reason and stop, and to treat a comment that cannot be made
  true as something to delete. Four of its own facts had rotted: the JS byte figures were measured on
  a tree that no longer existed (it claimed 78 KB of comments in 126 KB of source, when the source was
  really 159 KB before this release's rewrite; it is now 72 KB of 127 KB, minifying to 47 KB), the CSS
  source is ~255 KB and not ~284 KB, and `@mirror` was described as pinning **four** groups when it
  pins **six** — `gh/asset-urls` and `theme/legacy-names` went unlisted, along with the whole-file
  `@same-file LICENSE` pin. That last one is the exact blindness the mechanism exists to prevent.
- **Comments across the whole tree are cut to what states the problem and the reason, ~30–40% shorter.**
  The comments do not ship — jsmin and `build-css.sh` strip them — so this buys no bytes; it buys a
  reader who reaches the point. What went was narrative, rhetorical framing, restatement of the next
  line, and passages that merely re-told CLAUDE.md (now one-line pointers). What stayed is every
  defect, every measurement and every "do NOT" — those are the load-bearing half, and they set a floor
  well above the 50–70% cut that was aimed for. Verified mechanically that only comments changed: the
  built `cascade.css` is byte-identical (112 115 B), every JS token stream is identical under acorn,
  the Python AST minus docstrings is identical, and `npm run check` plus `jsmin-verify` are clean.

### Fixed
- **Dark mode: the selected row of an open dropdown failed WCAG AA at 4.21:1.** It painted accent text
  on `--fs-accent-soft` — a translucent tint of that same accent — and a tint drags the background
  toward the text and eats its own contrast, which is the one chip/badge rule this project writes down.
  Every dark-mode router showed it on every `<select>`, and the axe gate was green throughout: no
  gallery case rendered an OPEN dropdown with a value chosen, so the widget was invisible to the check.
  The row now sits on the opaque `--fs-panel2` with the accent carried by an inset rail, and the
  gallery renders the open state so the gate can see it. Found only because deleting a redundant doc
  (`docs/12`, which "covered" widgets in prose) forced its one real finding — the Combobox is missing
  from the gallery — into the gallery, where it is checkable.
- **The public styling guide told third-party app authors to break their own packages.**
  `docs/20` said `--warn-color-medium` "does not exist" and to rename it to `--warning-color-medium`.
  Exactly backwards: the theme exports `--warn-color-*` (and `--on-warn-color`), while
  `--warning-color-*` exists nowhere in the tree. `luci-app-podkop` reads `var(--warn-color-medium,
  orange)` and gets the themed amber today; following the guide would have dropped all seven of its
  declarations into the `orange` fallback. The lie was faithfully mirrored into the Russian copy.
- **Four docs instructed the reader to set `LUCI_MINIFY_JS:=0`**, which would triple the shipped JS.
  The Makefile deliberately leaves jsmin ON (it takes 127 KB to 47 KB, and uhttpd serves `/www` with no
  compression); what mangles modern CSS is csstidy, hence `LUCI_MINIFY_CSS:=0`. jsmin's real hazard —
  a regex literal after `return`/`=>` makes it swallow the file and exit **0** — is now stated where
  those docs used to give the wrong advice.
- **A closed MITM hole was still documented as open** (`docs/16`, L11: "install.sh silently disables TLS
  verification"). It has long been fixed — the installer pins `--proto-redir '=https'`, never disables
  verification even as a retry, and refuses to install unless the sha256 GitHub publishes for the asset
  matches. An audit doc that keeps a fixed finding open either sends the next reader chasing a ghost or
  convinces them the project is unsafe.
- **`docs/14` argued against the very fix `docs/15` describes.** Its teardown section said "not
  `Poll.stop()`"; the router does `queue.length = 0; Poll.stop(); Poll.start()` — which is what stopped
  the poller idling up to 5 s before its first tick. Two docs about adjacent things had drifted into
  contradiction.
- **Docs told you the login page needs no `sysauth.ut`, and that a theme should copy bootstrap's
  hidden-`<section>` login view.** Both are false and both were tried: without the theme's own
  `sysauth.ut` the generic template includes the header **without `blank_page`**, so the whole chrome is
  drawn around the login form with dead controls; and the bootstrap view pattern gives a blank page with
  no way to log in (the view bootstraps before a session exists, the RPC answers Access denied, `render()`
  never runs).
- **About forty source comments described code that no longer exists, and some of them described the
  opposite of what the code does.** Nothing a user can see, but a comment that lies is worse than no
  comment: the next person trusts it. The worst of them sat on the gates themselves. `jsmin-verify`'s
  header said "a **non-zero** exit code proves nothing" — backwards, and it negated the tool's whole
  reason to exist: jsmin corrupts a file *silently* and exits **0**, which is precisely why the token
  stream has to be compared. `install.sh` and `footstrap-selfupdate.sh` still explained that a release
  carries one `luci-i18n-footstrap-<lang>` package per language — the shape that broke Update on every
  router in the field (issue #6) and that 0.8.5 removed; `install.sh` then contradicted itself fifty
  lines later. `menu-footstrap-common.js` asserted in one paragraph that the shell widths are
  constants (`SIDEBAR_W = 224, RAIL_W = 68`) and in the next that they are read back from the CSS
  tokens — the first paragraph documented deleted code — and pointed at a function, `fitOne()`, that
  is nowhere in the tree. Thirteen more in `styles/theme/` named elements that were removed with the
  second renderer (`.fs-appearance-btn`, `.fs-top-logout`, a `<header>` no template emits) or claimed
  to override rules that `styles/base` has since **absorbed**; two stated the wrong specificity
  (`(0,3,1)` where the selector is `(0,4,0)`), and the dark canvas's chroma was written `.0165` in one
  file and `.0153` in another — converting `#1c2128` to OKLCH says `.0153`. Also fixed:
  `dev-sync.sh` still said the catalogue compiles in `Build/Compile` (it moved to `Build/Prepare`),
  `audit.py`'s docstring advertised a JS bracket check that was deliberately removed, and the
  uci-defaults marker comment said "drop the marker" where the code **writes** it.

### Security
- **Every release package is now signed with ed25519, and both the installer and the Update button
  refuse a package that does not carry our signature.** The sha256 the installer already checked
  cannot stand alone, and the reason is exact: GitHub *computes* the digest it publishes from the
  bytes that were uploaded. Anyone able to replace a release asset — a leaked write-scoped token is
  enough, no CI run involved — gets the digest recomputed for them, and the checksum then verifies
  the attacker's package. The signing key is a CI secret, is in no branch, and cannot be
  read back out of GitHub, so the same swap fails the signature: demonstrated end to end on the
  router with the real script (asset replaced, digest recomputed → sha256 passes, `ERR: BAD
  SIGNATURE`). `usign` is on every OpenWrt image (`base-files` depends on it), so this costs the
  theme no new runtime dependency, it covers apk and ipk with one mechanism, and — unlike trusting
  our key in `/etc/apk/keys` — it authorises nothing on the router beyond this one package. Both
  checks fail **closed**: a missing digest, a missing `.sig` asset or no `usign` on the box all
  refuse. A signature that is present and *wrong* is never overridable.
- **CI refuses to publish a release it cannot sign, and refuses a key the routers would reject.**
  The public half ships in the package and is embedded a second time in `install.sh` (which runs
  from `curl | sh`, before any package exists). A divergence between the two copies cannot be
  caught by any test — the installer would simply reject every release with `BAD SIGNATURE`, i.e.
  the failure would look exactly like the attack — so CI compares them on every run, and the
  release job re-verifies each freshly signed package against the key the router will actually use.

### Performance
- **A page load no longer spawns a CGI process to fetch an empty translation catalogue — 31 ms off
  every full load on an English router.** `<head>` loaded `admin/translations/<lang>` synchronously,
  and at `lang=en` that spent 31 ms (measured, five runs) to deliver **13 bytes** — `window.TR={};` —
  because there is no English catalogue to deliver: the msgids already are English. The process was
  the cost, not the data. The template now emits those 13 bytes inline when the language has no
  catalogue, and keeps the tag when it has one. The probe mirrors the server's own rule (`*.<lang>.lmo`
  in `/usr/lib/lua/luci/i18n`, which is what `load_catalog` globs), so a router that does ship an
  English catalogue still gets the tag; deciding by language name would have silently dropped it. It
  fails **open** — a throwing probe keeps the tag — because a missing catalogue makes every `_()`
  render English and report nothing. `defer` was rejected, not overlooked: `footer.ut` runs
  `L.require('menu-footstrap')` inline while the parser is still going, so a module's `_()` would race
  a deferred `window.TR` and lose silently.
- **The login page dropped its 17 copies of a 49-character `:has()` selector — 663 bytes of CSS.**
  Every rule keyed off `form:has(> .cbi-map input[name="luci_username"])`, on the assumption that the
  markup was stock LuCI's and therefore unnameable. It is ours: `sysauth.ut` renders that form, so it
  now carries `class="fs-login"`. The audit's stated blocker — that `ui.js` might re-render the login
  form for its session-expiry modal — was checked and is false: `ui.js` contains no `luci_username`
  and builds no login form at all, so nothing else ever matched those selectors. Computed styles on
  the live router are identical in light and dark (0 property diffs over every element of the page).

## [0.8.5] — 2026-07-14

### Changed
- **The layout toggle reads «Сбоку» / «Сверху» in Russian.**

### Fixed
- **The Update button installed a 6 KB translation catalogue instead of the theme.** v0.8.4 added a
  second package to the release (`luci-i18n-footstrap-ru`), and `footstrap-selfupdate.sh` — in every
  version already sitting on a router — picks the release asset with `grep -E '\.apk$' | head -1`.
  The GitHub API returns the asset list sorted **by name**, and `luci-i18n-footstrap-…` sorts before
  `luci-theme-footstrap-…`. So clicking Update installed the catalogue, reported success, left the
  theme on its old version and kept the badge asking for the same update — forever, because the
  script that picks the wrong asset is the one that never gets replaced. The script on a router
  cannot be fixed remotely: whatever we publish, it runs the picker it already has. So a release
  carries **one asset per format** again and the catalogue travels **inside the theme package**; CI
  fails the build unless `dist/` holds exactly one package per format. If your Update button gave
  you Russian but no new version, that is this bug — press it once more on 0.8.5 and it lands.
- **A third-party package's translation was overwriting the theme's own strings** — the layout
  toggle read "Максимум" on a Russian router. LuCI serves **one merged catalogue** to the client
  (`load_catalog()` reads every `*.<lang>.lmo` in `/usr/lib/lua/luci/i18n`, and a lookup returns the
  first archive that has the hash), so a msgid is a name shared with every `luci-app` on the box and
  readdir order decides who wins: somebody translates the msgid `Top` as "maximum" — right in a
  bandwidth dialog, nonsense on a layout switch. Every label in the Appearance popover now carries
  the `footstrap` message context, which makes the key ours alone. The chrome and login strings stay
  context-free on purpose (they inherit a correct translation from `luci-base` in the ~40 languages
  the theme ships no catalogue for), and so do System/Memory/Storage in the overview include — that
  one *matches* the stock section titles and must resolve exactly as `luci-mod-status` does.

## [0.8.4] — 2026-07-14

### Changed
- **`install.sh` now requires `jsonfilter` instead of falling back to grepping the API payload.**
  It is part of OpenWrt's base image and it is what reads the asset's sha256 — the only integrity
  check there is behind `--allow-untrusted` — so the fallback could only ever walk into the
  "no sha256 available — refusing to install" refusal anyway. Failing with one clear line beats
  failing three steps later with a security message.

### Fixed
- **The theme's own strings rendered in English on a translated LuCI — the release never carried
  the translation package.** `po/ru/footstrap.po` has been complete for releases, and CI already
  fails if a msgstr is empty, but no `.lmo` ever reached a router: the OpenWrt SDK built
  `luci-i18n-footstrap-ru`, the build job's `find` glob named only `luci-theme-footstrap-*`, and
  the language package was thrown away with the rest of `bin/`. Reported on a fully Russian LuCI
  (issue #6), where the Appearance popover read "Palette" / "Rounding" / "Cats" — and the layout
  toggle read **"Максимум"**, which is `luci-base`'s translation of the msgid "Top": LuCI serves
  ONE merged client catalogue (`load_catalog(lang, '/usr/lib/lua/luci/i18n')` reads every `.lmo`
  in the directory), so an unshipped catalogue does not fail — its msgids quietly resolve against
  somebody else's, or fall through to English. `install.sh` and the Appearance → Update button now
  install the language packages alongside the theme, and CI asserts BOTH packages by name: "the
  dist dir is non-empty" is exactly what let the missing catalogue ship for eight releases.
- **`install.sh` and the self-updater could have installed a 6 KB language pack in place of the
  theme.** Both picked the release asset by extension (`grep '\.apk$' | head -n1`), i.e. by
  whatever order GitHub happened to list the assets in. That was harmless while a release carried
  exactly one package; the moment the translation packages joined it, it became a coin flip. They
  now match on the package NAME (`/luci-theme-footstrap[-_]…`), and the two copies of that matcher
  are `@mirror`-pinned (`gh/asset-urls`) beside the `fetch()` and the host allowlist — the same
  forced duplication, made un-rottable for the same reason.
- **A language package is versioned with the theme it belongs to.** `luci.mk` versions them from
  `PKG_PO_VERSION`, which falls back to a git-or-mtime stamp — and the SDK build has no `.git`, so
  every CI run would have stamped them `0.<yymmdd>.<secs>`: a version unrelated to the release, and
  a different one on every rebuild of the same tag.

## [0.8.3] — 2026-07-14

### Added
- **CI compile-checks the ucode templates.** They had no parser anywhere: `luci.mk` copies them
  to the router verbatim, so a stray brace in `header.ut` built green, released, and then every
  user's LuCI silently fell back to a different theme. CI now builds `ucode` from a pinned
  upstream commit — the same discipline `jsmin.c` already gets, and for the same reason — and
  runs LuCI's own `ucode -T -c` over every `.ut`.
- **CI validates the rpcd ACL as JSON.** rpcd skips a file it cannot parse and says nothing, so a
  trailing comma there would have taken the update badge and the Update button away from every
  user with no other symptom.
- **The OpenWrt SDK is checksummed.** Two *linters* were pinned by commit and sha256 while the
  toolchain that actually builds the released package arrived on trust; its published
  `sha256sums` is now checked, and the download pins https across redirects.

### Changed
- **`build-css.sh` checks the file it actually writes, and refuses one that is too small.** The
  brace/rule-count check ran on the squeeze's *input* — while the squeeze is the pass most able
  to corrupt a stylesheet, being the one that tracks strings, joins lines and drops the last
  `;` — and the only gate on the finished file was an upper size bound, so every way of
  producing a *truncated* `cascade.css` passed silently. The rule count must now survive the
  squeeze unchanged, and the sheet has a floor as well as a ceiling.
- **A tag whose changelog section is missing now fails the release.** `release-notes.sh` warned
  to stderr and exited 0, publishing a release page reading "See the CHANGELOG" for a version
  the changelog had never heard of — precisely the mistake the "never tag first" rule exists to
  prevent, made permanent and public. The Russian mirror is required too.
- The installer's failure modal builds its message as a text node rather than through
  `innerHTML`: `luci.js` assigns a *bare string* child via `innerHTML` and only text-nodes an
  array, and what lands there is raw `apk`/`opkg` stderr — the one string in this theme that
  neither the theme nor LuCI composed.
- `tools/fs-orphans.mjs` no longer reports the `fs-fit` *module* as an unstyled class. A
  permanent false "NEW" line in a report is how a report teaches you to stop reading it.
- **`audit.py` reported the wrong line for every finding it has ever printed.** Stripping a
  comment deleted its newlines too, and the line numbers are derived from that stripped copy —
  so each `file:line` was shifted up by however many comment lines sat above the rule. In a tree
  where the comments outweigh the code that is a large shift: the focus block it called
  `30-forms.css:336` really lives at `:353`. A finding that points at the wrong line is a finding
  you go and "fix" in the wrong rule.

### Fixed
- **The ACE editor apps embed (SSClash, and any other app shipping ace.js) rendered as a black
  rectangle with no text, spilling out of the layout.** The SPA router used to DELETE every
  `<style>` a view had injected into `<head>` when navigating away — the right answer for the
  file manager's blob (see below), the wrong one for CSS the injector cannot put back. ACE
  imports `ace_editor.css` (14 KB: the absolutely-positioned layers, the gutter, the line boxes)
  once per DOCUMENT, at module eval, so a re-render never re-injects it, while its theme and mode
  sheets — loaded per editor — do come back. Measured on the router: open SSClash → Configuration,
  SPA-nav to Log and back, and the theme repaints the editor black while its structure never
  returns; the unpositioned layers blow the page out to 2 007 346 px tall. Deleting CSS was
  silently one-way, so the router no longer deletes any: a sheet that can only match its own app's
  widgets (`.ace_*`, the stock overview's `.cpu-status-view-mode-entry`) is inert on every other
  page and now simply stays, and SPA nav through those apps keeps working.
- **Apps that ship dark styles were rendering their LIGHT ones on a dark page.** An app has to
  guess whether the theme is dark, and a survey of the LuCI ecosystem found three dialects for
  asking: `data-theme="dark"` on `:root` (`luci-app-justclash` keys 21 rules off it),
  Bootstrap's `data-bs-theme` (`luci-app-ssclash` reads it first), and the luminance of the body
  background (OpenClash, passwall, and ssclash's fallback). The theme stamped only its own
  `data-darkmode`, so justclash's dark rules were all dead. It now stamps all three names for the
  same fact — `data-darkmode` stays the one the theme's own CSS reads, the other two are outbound
  compatibility like the `--*-color-*` export tier, and `tools/axes.mjs` fails the build if a
  `styles/` rule ever reads them or if the pre-paint template and the live applier drift apart.
- **The body background is now provably opaque, because that is what every dark-mode sniffer
  reads.** OpenClash, passwall and ssclash all decide light-vs-dark from the luminance of
  `getComputedStyle(document.body).backgroundColor` — and OpenClash's regex does not even match
  `rgba(0, 0, 0, 0)`, so a transparent body makes it conclude "light" and repaint a dark page in
  its light palette (it then writes `data-darkmode` onto our `:root` itself). Moving the page
  colour onto `:root` or fading it with an alpha would do exactly that, silently, so
  `tools/export-tier.mjs` now proves the body background is opaque and on the correct side of the
  luminance midpoint across the whole palette × mode × tint matrix.
- **An app that re-injects its CSS on every render no longer stacks copies of it.**
  `luci-app-podkop` appends a 4 KB `<style>` to `<head>` from its `render()` with no guard, and
  `luci-app-mosdns` re-appends three CodeMirror `<link>`s the same way; with the sweep gone, every
  SPA re-visit left another copy behind. Dropping a byte-identical duplicate is the one deletion
  that cannot break anyone — the rules do not go away, so a library's "already imported?" check
  still finds its sheet — and it is now the only one the router performs.
- **A view's CSS still cannot follow you to the next page — and that now includes a `<link>`.**
  `luci-app-banip` and `luci-app-adblock` append `<link rel=stylesheet href=…/custom.css>` to
  `<head>` at module eval, and that file styles `.cbi-input-text` / `.cbi-input-select` — stock
  widgets, on every page, unlayered. The old sweep only ever looked at `<style>`, so this leaked
  silently. What replaces the sweep is a test, not a list: a sheet is *invasive* if it can paint a
  page that is not its own. That means a bare selector (`h4`, `svg text`, `div > label + select`,
  `:root { color-scheme: … }`), or a selector made ENTIRELY of names the theme itself styles, with
  nothing of the app's own to pin it to the app's markup. Both shapes match stock widgets on every
  page, and being unlayered they outrank every cascade layer. The universe of names is read back
  from `cascade.css` at runtime, so it tracks the theme instead of drifting from it. A document
  carrying such a sheet is spent: the next navigation falls back to a REAL page load, which is what
  stock LuCI does on every link anyway.
  The two exemptions are what keep this from taxing the innocent, and both were measured against
  real apps: a stock class **pinned** by a name of the app's own (`#cbi-podkop-section >
  .cbi-section-remove`, `.bandix-table th.sortable.active`) cannot match without that app's markup —
  though a `:not()` argument is not a pin, which is exactly why `luci-app-filemanager`'s
  `.cbi-button-save:not(.custom-save-button)` still counts; and a bare selector declaring nothing but
  custom properties the theme never reads (`:root { --app-temp-status-temp: … }`) has nothing to
  paint with. Checked against the eight apps installed on the dev router: ACE/ssclash, podkop, the
  overview's CPU include and the hex editor keep SPA navigation, while `luci-app-filemanager`
  (`.cbi-button-save`), stock `luci-app-openvpn` (`h4 { white-space: nowrap }`), `luci-app-bandix`
  (`.error`), `luci-app-wrtbwmon` (`div > label + select`) and `luci-app-temp-status`
  (`svg text { fill }`) take the full load. Save/Apply/Reset are all still present on System after
  visiting the file manager. Measured at 0.3 ms per navigation.
- **Two fast clicks could leave you on one page while looking at another — and leave its poller
  running forever.** On a FIRST visit to a page the SPA router's `require()` *is* the render, so
  it cannot be cancelled: click Firewall (uncached — its module plus its `load()` RPCs, seconds
  on a slow link), click Wireless 100 ms later, and the router flushes the poll queue *before*
  Firewall's poller is ever added. Firewall then paints into the `#view` that now belongs to
  Wireless and registers a poller the flush can no longer catch. Reproduced on the live router
  with 1.2 s of added latency: the URL, the title, the menu and `body[data-page]` all said
  System while the Firewall's zone editor sat on screen. A superseded first render is now
  detected and undone — the current page is re-rendered, which is also what kills the orphaned
  poller.
- **Clicking the page you are already on no longer kills the Back button.** The router pushed a
  history entry unconditionally, so a click on the active menu item added a duplicate; Back then
  fired `popstate`, found the path unchanged, and correctly did nothing — once per stray click.
  A re-navigation to the current URL now replaces its entry, as a full page load does.
- **The Update button could hang until the router was rebooted.** A worker killed mid-`apk add`
  (an OOM on a 128 MB box, and apk is the memory-hungry part) left `status=RUNNING` and its
  staged copy behind forever, and a pre-check in front of the lock answered `RUNNING` to every
  later click — the client polled its full 300 s and reported "timed out waiting for the
  installer", permanently. Worse, the stale-lock reclaim written for exactly that case could
  never run, because the pre-check returned first. The atomic `mkdir` lock is now the only thing
  that decides, which is what it was always for.
- **The keyboard and the screen reader can follow a navigation again.** Every SPA nav rebuilds
  the menu, so the `<a>` the user had just activated with Enter was removed from the document
  and focus fell back to `<body>` — the next Tab restarted at the skip link — while nothing
  announced that the page had changed at all. Focus now moves to `<main>` (which already carried
  `tabindex="-1"` for the skip link) and the new page title is spoken through a polite live
  region.
- **The document `<h1>` was not in the accessibility tree at all.** It was hidden with the
  `hidden` attribute, i.e. `display: none`, which removes an element for assistive tech as
  thoroughly as it does for the eye — so the heading outline the `<h1>` was added to repair
  still began at the views' `<h2>`, and the router's title sync was updating a node nothing
  could read. It is now clipped (`.fs-sr`), the same technique the skip link already uses.
  Verified against Chrome's ARIA snapshot on the live router.
- **The menu never said "you are here".** The active leaf and the active section tab carried a
  CSS class and nothing else; they now carry `aria-current="page"`. The JS-generated icons and
  chevrons carry `aria-hidden="true"`, like every SVG in the templates.
- **A Lua-CBI form showed no red border on an invalid field.** `styles/base` does declare one for
  `.cbi-value-error input`, but the theme's `input { border: 1px solid … }` shorthand in a later
  layer wipes a longhand out regardless of specificity — so the field rendered plain grey. The
  modern `.cbi-input-invalid` path was fine; only `luci-compat`, i.e. every third-party app still
  on the Lua CBI, had lost the cue. Probed, not reasoned: grey `#d0d7de` before, danger red after.
- **Four input types rendered as stock white 3px-radius boxes** next to themed fields in the same
  form: `color`, `datetime-local`, `month` and `week` were missing from the theme's type list, and
  a missing type does not fall back to "unstyled" — it falls back to `base`.

### Security
- **The self-updater installed without checking the sha256 whenever it could not find one.** The
  check was `if [ -n "$digest" ]`, with no `else`: GitHub renaming the field, the `jsonfilter`
  predicate ceasing to resolve, or `jsonfilter` being absent all left the digest empty — and the
  package was then installed with `--allow-untrusted` and no integrity check whatsoever, while
  reporting success. Half of a two-link trust chain cannot be optional; a missing digest is now
  a refusal. `install.sh` refuses too (`FOOTSTRAP_ALLOW_UNVERIFIED=1` overrides, deliberately by
  hand).
- **`__run`, the privileged worker entrypoint, was reachable over RPC.** rpcd's `file.exec` ACL
  matches the command *path* — `params` are free — so any session holding the ACL could invoke
  the self-update script with `__run` directly, which ran the install in the foreground and
  **without taking the lock**: two concurrent `apk add` runs on the same package, the exact race
  the lock exists to stop, with rpcd killing one of them at its 30 s timeout, possibly
  mid-install. It now runs only when invoked as the staged worker copy.
- **The dynamic loader was left to the caller.** rpcd also hands the exec'd process an
  environment the caller controls: `PATH` was pinned, but `LD_PRELOAD`/`LD_LIBRARY_PATH` on
  `/bin/sh` are arbitrary code as root for anyone holding this ACL, and the proxy variables
  would have redirected the fetch. All of them are unset.
- **The release token is no longer handed to every pull request.** `permissions: contents: write`
  was workflow-wide, so it was in reach of the `npm ci` in the lint job — i.e. of the lifecycle
  scripts of every dev dependency — on a `pull_request` run. Only the release job declares it now.

## [0.8.2] — 2026-07-13

### Changed
- **The licensing position is written down, in the READMEs and in the Makefile.** The theme is
  Apache-2.0 and that is **not** a free choice: `styles/base/` began as a fork of
  luci-theme-bootstrap's `cascade.css`, the ucode templates derive from LuCI's own, and several JS
  helpers are copied from LuCI verbatim — all Apache-2.0, whose notices have to travel with it. (GPLv2
  is not even available: Apache-2.0's patent and indemnity clauses are additional restrictions GPLv2
  forbids. GPLv3 would be legal but would cost the theme its place in the LuCI feed and make
  firmware vendors avoid it, for a copyleft that buys little on code a browser is handed as source.)
  The bundled fonts are **not** covered by it — they are SIL OFL 1.1, and now say so.

### Fixed
- **The bundled webfonts were being redistributed without their licence.** Manrope and JetBrains Mono
  are SIL Open Font License 1.1, and OFL §2 requires every copy of the Font Software to carry the
  copyright notice **and** the licence text. The theme shipped nine `.woff2` files and neither — and
  it could not have carried them inside the fonts, because these are unicode-range subsets and the
  subsetter strips the licence out of the font's own name table (verified: the copyright survived, the
  licence field did not). `fonts/OFL.txt` now travels with them to the router.
- **The package's licence metadata pointed at nothing, and now ships what it declares.**
  `PKG_LICENSE_FILES` resolves against `$(PKG_BUILD_DIR)`, which `luci.mk` fills with only
  `src/ luasrc/ htdocs/ root/ ucode/ po/` — and CI rsyncs only the package directory into the SDK, so
  the repo-root `LICENSE` was reachable from neither. `Build/Prepare` copies it in, and `PKG_LICENSE`
  is now the honest `Apache-2.0 OFL-1.1`: the theme really does carry two bodies of work. The two
  copies of the Apache text (repo root, for GitHub; package, for the build) are pinned byte-identical
  by `npm run mirror`.
- **A view's injected CSS no longer follows you to every page you visit afterwards.** A view may inject
  a `<style>` into `<head>` when it renders — `luci-app-filemanager` does — and on a full page load
  that stylesheet dies with the document, so it only ever affects the page that asked for it. SPA
  navigation never reloads, so it stayed in `<head>` forever. That is not cosmetic: the file manager's
  blob carries `.cbi-button-apply, .cbi-button-reset, .cbi-button-save { display: none !important }`
  (it hides the stock buttons because it has its own), and being **unlayered** with `!important` it
  outranks every cascade layer. Measured on the router: open the file manager once, then go to
  System → **Save and Reset are gone**, and stay gone until a hard reload — every config page you touch
  afterwards is unsavable. The router now sweeps them on navigation, exactly as it already sweeps the
  outgoing view's pollers, stray `setInterval`s and open modals: the document is put back into the
  state a fresh page load would leave it in. The shell's own server-emitted `<style>` is marked
  `data-fs-shell` and kept — the two are told apart, not guessed at. Verified: a re-visit to the file
  manager now renders byte-for-byte identically to a full page load of it.

## [0.8.1] — 2026-07-13

### Added
- **A gate for the one duplication that cannot be pinned: the Appearance axes.** Every axis is
  implemented twice — `head.ut` stamps `:root` before the first paint (inline, before the module
  loader exists) and `menu-footstrap-common.js` applies it live — and neither copy can go. They
  cannot be byte-identical either, so `@mirror` cannot hold them. `tools/axes.mjs` (`npm run axes`)
  holds the **contract** instead, and derives it *from the JS* rather than restating it: the
  localStorage keys, the `:root` attributes, the custom properties, the 1–360 ranges, the rounding
  default (which `head.ut` cannot read from the CSS token — it runs before the stylesheet), and the
  load-bearing ordering rule, *set the custom property before the attribute*. That rule is why the
  gate exists: it is a one-line fix that would be made in the popover and forgotten in the template,
  and its only symptom is a single wrong frame on reload — which nobody reports and nothing else
  catches.
- **`@mirror` exists now — it was documented but never built.** `CLAUDE.md` described a mechanism in
  detail ("there is no numeric budget… tag every copy, the tool enforces byte-identity, an unpinned
  duplicate is a hard failure") and listed the groups it had supposedly pinned. None of it was real:
  `tools/css-dup.mjs` held a `BUDGET = 2` and its own failure message told you to *raise the budget*,
  there was not one `@mirror` tag in the tree, and the workflow described the check a third way. The
  project's argument was right and its tool was not, so the tool now matches: `tools/mirror.mjs`
  (`npm run mirror`) holds every pinned copy byte-identical, `css-dup` fails on an *unpinned*
  duplicate, and the budget is gone. It covers **shell as well as CSS** — see below.

### Changed
- **Save and Reset in the page action bar carry a tint, and the hover cue is now visible.** A
  transparent button beside the solid Save & Apply read as disabled rather than as secondary. Both now take the same step of the
  role ladder — `-soft` at rest, `-fill` on hover — Save off the accent role and Reset off danger,
  which it already declared on hover. Their labels are `--fs-text` and **not** the role colour: text of
  colour C on a translucent tint of C is the mistake this project documents having learned the hard
  way, and axe measured it immediately (accent on accent-soft: 4.25:1, an AA failure). The fill and the
  border carry the role; the label only has to be legible.
- **The hover lift flips direction per mode, and that is a WCAG fix.** `filter`
  recolours an element's *text* as well as its fill, and a light-mode solid button is a saturated fill
  carrying WHITE ink — which cannot get any brighter. Brightening it only closes the gap: on
  `--fs-accent` the white ink measures 5.19:1 at rest, the old `brightness(1.08)` already dropped it to
  4.59:1, and the lift that would actually be *visible* (1.15) dropped it to **4.08:1 — a failure
  introduced by hovering**. Measured from the rendered pixels, not computed. So light mode now darkens
  (0.90 → 6.16:1: a bigger cue *and* better contrast) and dark mode, where the fill is light and the
  ink dark, brightens (1.15 → ~8:1). Both say the same thing: the button moves away from the page.
- **`install.sh` and `footstrap-selfupdate.sh` are pinned mirrors of each other where they must be.**
  They cannot share a file — the installer is `curl | sh` and runs *before* the package that would
  hold the library exists — yet both must fetch over a verified channel, pin the asset host and check
  the sha256. That duplication had **already drifted**: the two `fetch()`s had different backend
  orders, one gave its first-choice tool (`uclient-fetch`, on OpenWrt) *no timeout at all*, and one
  was missing the https redirect pin on its `wget` path. Nothing said a word, precisely because a
  diverged copy stops looking like a duplicate. They are byte-identical now and `@mirror`-pinned, so
  they cannot drift again.
- **The upstream commit the borrowed build tools are pinned to lives in one file.** `jsmin.c` (which
  CI compiles and runs as the gate proving our shipped JS is safe) and `i18n-scan.pl` (which decides
  whether the translations are complete) were pinned to the same SHA in two places, each with a
  comment saying "bump them together", and nothing holding them together. Both now source
  `luci-upstream.pin`.
- **The Tint and Accent axes are one function.** They were forty near-identical lines apart — same
  1–360 validation, same "0 is off", same clamp, and the same load-bearing ordering rule (set the
  custom property *before* the attribute, or a fresh load paints one frame with the previous hue).
  That rule is exactly what gets fixed in one copy and not the other. The other seven Appearance axes
  are deliberately left alone: each has a real quirk a table would need an option for.
- **The two gallery gates share one harness.** `a11y-gallery.mjs` and `export-tier.mjs` each carried
  their own copy of "build the CSS, serve the gallery, stamp the Appearance axes onto `:root`" — and
  that last part was a *fourth and fifth* copy of rules that also live in the theme JS and in
  `head.ut`. A gate that keeps testing an old shape keeps passing, which is worse than no gate.
- **`dev-sync.sh` deploys the resource JS by glob, not by name.** It listed four files individually,
  so a fifth would ship in the package (luci.mk copies `htdocs/` wholesale) and silently never reach
  the dev router — and be tested for the first time after a release. The deploy skill had the same
  bug in a worse form: it knew how to map `root/*` to the router but its file discovery never handed
  it one, so editing the self-update backend or its ACL and deploying did **nothing**, quietly.
- **`fs-fit.js` actually owns the frame coalescing now, as the docs always claimed.** It exported
  `schedule()` (which runs *every* fitter) but no way to batch a single callback, so three callers
  had hand-rolled the identical five lines; two more had hand-rolled the same mutation filter. Both
  are shared primitives now (`fit.frame`, `fit.touches`). The dropdown clamp keeps its own per-`<li>`
  rAF handle — it needs to *cancel* a pending measure, which a shared one-flag coalescer cannot
  express.
- **The README described a product that no longer exists.** It offered "two layouts
  (`FootstrapSidebar` / `FootstrapOnTop`) switched in LuCI's settings" and "three palettes" including
  one that is now a separate wallpaper axis. There is one theme entry; layout, palette, wallpaper,
  tint, accent, rounding and submenu behaviour are all browser preferences in the Appearance popover,
  and none of them was documented. The self-update was not mentioned at all.
- **The viewport edge gap both hand-placed popups obey is one constant.** The Appearance popover and
  the menu's dropdown clamp each wrote their own `8`.
- **The documentation described a codebase that had moved on.** A sweep of every checkable claim in
  `CLAUDE.md`, the READMEs, `docs/`, the skills and the code comments found ~40 that were false. The
  load-bearing ones: the sidebar override's specificity was stated as `0,3,0` under a `768px` media
  query (it is `0,4,0` under `521px` + `:not([data-narrow])` — the `0,3,0` predates the `:not()`);
  nine comments pointed at `theme/20-shell-sidebar.css`, a file that does not exist; the CSS build's
  own `FS_CSS_BUDGET` was documented as 124 KB in two places and is 115 KB; CI's font budget was
  documented as 100 KB and is 70 KB (the doc's number would have let 33 KB of font drift in
  unnoticed); the JS comment/minify figures were ~2× stale; and several comments still described the
  table card stack as a container query that measurement replaced. (`docs/16` and `docs/18` are dated
  audit snapshots and are left as history, not rewritten.) A comment that lies is worse than no
  comment.
- **The shell's geometry is three tokens instead of six copies of three numbers.** `--fs-sidebar-w`,
  `--fs-rail-w` and `--fs-content-min` now live in `02-tokens.css`; the stylesheet lays the sidebar out
  from them and `menu-footstrap-common.js` reads them back to decide whether what is left for the
  content is still readable. The JS used to carry its own `SIDEBAR_W = 224, RAIL_W = 68,
  CONTENT_MIN = 500` against bare literals in the CSS, so narrowing the rail in the stylesheet would
  have left the measurement subtracting the old width with nothing in the build to notice — and
  `20-shell.css` even cited a `--fs-content-min` token that did not exist.
- **The package declares its own maintainer and homepage.** Without `LUCI_MAINTAINER`/`LUCI_URL`,
  `luci.mk` defaulted them and the built package claimed to be maintained by the OpenWrt LuCI
  community. The repository also gained the `LICENSE` text it had never carried, though the package
  deliberately does **not** set `PKG_LICENSE_FILES`: that resolves against the build directory, which
  `luci.mk` fills with only `src/ luasrc/ htdocs/ root/ ucode/ po/` — pointing the metadata at a file
  the build tree does not have would be worse than not pointing at one.
- **The linters were only enforcing the rules somebody remembered to list.** `eslint.config.mjs` never
  extended `eslint:recommended`, so `no-dupe-keys`, `no-unreachable`, `no-duplicate-case`,
  `no-prototype-builtins`, `getter-return`, `no-async-promise-executor` and about thirty other free
  correctness rules were simply off; stylelint was missing the value-grammar check
  (`declaration-property-value-no-unknown`), which is the only thing that can catch a declaration that
  is invalid at computed-value time and therefore vanishes in *silence* — the exact failure mode the
  `--*-rgb` component bridges were torn out for. Both sets found **zero** violations in the current
  tree, so they cost nothing today and catch the next mistake for free.

### Fixed
- **Any view using `<a href="#">` for its own controls had its state wiped on every click** (issue #3,
  `luci-app-filemanager`). Chrome fires `popstate` for a same-document *fragment* navigation, so
  clicking such a link inside a view arrived at the SPA router as if the user had pressed Back. The
  router then re-ran the navigation for the path already on screen, which re-instantiates the view —
  undoing whatever the click had just done, one turn of the event loop later. The file manager's tab
  strip is four `<a href="#">` links whose handler does not `preventDefault`, so switching to Editor,
  Settings or Help switched *and instantly reverted*, and the app was unusable. Traced on the router:
  `popstate` → `#view` receives a brand-new container. The two "Failed to display the file list"
  errors in that report are the same bug from the other side — each surprise re-render restarts the
  app's own `render()`, whose file list races the DOM insertion it depends on. A fragment change is
  not a navigation: the router now compares the *path* and stays out of the way when only the
  fragment moved. Back/forward across real paths still SPA-navigate, with zero full page loads.
- **The login page carried the whole chrome — sidebar, menu and footer — around a form whose only
  control is a password field.** The theme shipped no `sysauth.ut`, so LuCI fell back to its generic
  one, which includes the header *without* `blank_page` (luci-theme-bootstrap ships its own and does
  not have this problem). The theme has one now. It is deliberately **not** a copy of bootstrap's:
  that one hides the form in a `<section hidden>` and reveals it from a view module, and this theme
  tried exactly that once and got a blank page with no way to log in — the view runs before a session
  exists, its RPCs answer "Access denied", the promise rejects and `render()` never runs. The form is
  rendered by the server, so it works with JS disabled and cannot be broken by a rejected promise.
- **The login page ignored the Cats wallpaper.** Dark mode, palette and tint all reached it (they land
  on `body`), but the wallpaper is painted on `.fs-shell`, which a chrome-less page does not have — so
  the one screen you see before anything else was the one screen that did not match the theme.
- **A data table with no `id` lost its cell padding, its mono face and its row hover.** `[id]` and
  `.fs-dt` are two names for "this is a data table, not a key/value include", and they had been written
  as two selector lists at *different* weights — `.cbi-section .table[id] .td` is (0,4,0) but
  `table.fs-dt .td` is only (0,2,1), which loses to the key/value default at (0,3,0). A table that had
  an id was fine; one identified only by the JS tag kept the key/value padding (`10px 16px 10px 0` —
  flush left, right for a label column and wrong for a data cell). Live on the router: **Status →
  Routing** sat every cell hard against the table's left edge. Both names are one `:is([id], .fs-dt)`
  now and cannot drift apart again.
- **Typing in an open dropdown now jumps to the matching option, as a native `<select>` does.** Open
  Country Code, type "ru", and a native select highlights "RU - Russian Federation"; it is
  how anyone picks one of 248 entries. This theme replaces native selects with a styled `ui.Dropdown`
  (a native popup cannot be styled), and `ui.Dropdown` has **no letter search at all** — bootstrap only
  appears to have one because it leaves that field as a real `<select>`. Type-ahead is implemented for
  every `.cbi-dropdown`, including the ones LuCI renders itself: the buffer resets after a pause,
  repeating one letter cycles through the items that start with it, and the label is matched before the
  value, so both "ru" and "russ" find it. Enter commits, exactly as before.
- **The footer's credit line sat hard left.** `text-align: center` could not centre it: base made the
  footer a flex row with `justify-content: space-between` — a leftover from a two-column footer — and
  with the single `<span>` this theme emits, space-between parks it at the start.
- **"Refresh Channels" (Status → Channel Analysis) sat flush against the section below it**, reading as
  part of that card rather than as a page-level action. `.cbi-title-buttons` had no bottom margin.
- **The Appearance popover's "Submenus" control ignored the layout toggle.** The accordion switch is
  meaningless in the top layout (its sections are hover dropdowns, already exclusive), and it was
  left out with an `if (currentLayout() !== 'top')` around the group that builds it. But the popover
  is built ONCE, in `init()` — so that branch froze the control to whatever layout the *page loaded
  in*: switch to the top bar and it stayed on screen, load in the top bar and switch to the sidebar
  and it never appeared. It is always built now and hidden by CSS on `:root[data-layout="top"]`,
  which is the theme's own rule — toggling the layout re-renders nothing, CSS morphs the chrome — so
  it is correct on load, on toggle, and with no JS state at all.
- **In a window ~768–779 px wide the menu and the stylesheet disagreed about what the chrome was.**
  The CSS had moved off the 768 px breakpoint long ago: the sidebar yields when the *content* column
  would fall below its minimum, measured from the sidebar's real cut (`data-narrow`). `flyoutMode()`
  in the menu JS was still asking `matchMedia('(max-width: 767px)')`, and its comment pointed at a
  file that no longer exists. Measured on the live router at 770 and 775 px: the chrome painted as a
  full-width bar while the menu still believed it was a vertical accordion, so a section opened
  unfolded *inside* the bar, click-outside and Escape did not close it, and the dropdown edge-clamp
  refused to place it. Worse, nothing watched `data-narrow` at all, so dragging a window across the
  boundary ran no transition handler. Both now read the one attribute that decides.
- **Column weights (`col-1`…`col-10`) never reached a table that carded above the phone tier** — the
  other half of the split card contract. They are unguarded now, and that is not a workaround: `flex`
  is inert on anything that is not a flex item, and a cell becomes one exactly when its table cards,
  by *either* mechanism. So one copy replaces twenty rules under two guards, the config table gets
  its weights for the first time (it cards at a 960 px *container*, i.e. possibly on a 1200 px
  desktop), and the stylesheet got 512 bytes smaller. Verified on the router: the package list's
  cells went from `flex: 0 1 auto` to `1 1 30px` / `2 2 60px` / `10 10 300px`.
- **`cssdiff.py` could have blanked the dev router's theme selection.** It switches
  `luci.main.mediaurlbase` and restores it in a `finally`, but read the original with no fallback —
  so a failed `ssh` made it the empty string and the restore then ran `uci set
  luci.main.mediaurlbase=`. Its two sibling tools both default to bootstrap there; this one did not.
  It now refuses to switch the theme at all if it cannot read the value needed to switch back.
- **`preview.py --layout footstrap-top` screenshotted a broken UI.** It pointed the router's
  `mediaurlbase` at `/luci-static/footstrap-top`, a path the rest of the repo actively deletes. The
  layout is a client preference; it is set in the browser now, and the choices are `sidebar` / `top`.
- **`install.sh` left the LuCI module cache behind**, dropping only the index cache — and a stale
  module cache right after installing a package that replaces the theme's JS is the one case where it
  actually bites.
- **The data-table tagger and its own mutation filter used different selectors.** The tagger asked for
  `table.table` while the filter beside it carries a comment explaining why it must not. Every
  `.table` stock LuCI emits really is a `<table>`, so it cost nothing *here* — but that is luck, and
  the coverage rule is that a third-party `luci-app-*` renders what stock never does. One selector.
- **The self-update worked only on routers that happened to have `curl` installed.** `curl` is not in
  OpenWrt's default package set — the base image ships `uclient-fetch` — so on a stock router the
  Appearance update badge and the one-click Update button both died with the misleading
  `ERR: cannot reach the GitHub release API`. Reproduced on the dev router by moving `/usr/bin/curl`
  aside. The script now falls back to `uclient-fetch`, exactly as `install.sh` already did, so the
  theme still depends on nothing but `luci-base`.
- **Installing or updating the theme no longer logs every LuCI user out.** `postinst` ran
  `/etc/init.d/rpcd restart`, and rpcd keeps its sessions in memory. `reload` (SIGHUP) re-reads
  `/usr/share/rpcd/acl.d/*`, which is the only thing this package needs from rpcd — verified on a
  live router: removing our ACL file and reloading flips `session access` for the self-update script
  from `true` to `false`, and a session created before a `reload` survives it while dying across a
  `restart`. The "you have been logged out, sign in again" screen the updater used to show existed
  only to explain a logout the package inflicted on itself.
- **A data table stacked into cards above the phone breakpoint rendered columns that should have been
  dropped, and ignored its column weights.** The stack is *measured* (`fs-select.js`), so it fires at
  any width, but three halves of the same contract — the table's own `display: block`, the
  `.hide-xs`/`.hide-sm` columns stock LuCI drops, and the `.col-N` weights — lived only inside
  `@media (max-width: 767px)`. In the sidebar layout the content column is `viewport − 224 − 56`, so
  between roughly 768 and 860 px it is already below the "too cramped to be a table" floor while the
  media query has switched off. Measured on the live router at 790/820/850 px: the leases table
  stacked while still `display: table` (keeping the intrinsic min-width that `display: block` exists
  to prevent), and the wireless association list rendered **all five** of its `.hide-xs` cells. Those
  rules now key off the `.fs-stacked` class, where the stack is actually decided.
- **A future colourway would have painted success text with the *danger* ink.** `.cbi-tooltip.success`
  read `--fs-on-danger`. Nothing could see it, because every shipped palette happens to give all four
  inks the same value — `cssdiff` found zero diffs, `audit.py` saw a defined variable and axe measured
  the right contrast. Proven live by forcing `--fs-on-danger` red: the success tooltip turned red, and
  `--fs-on-good` had no effect on it at all.
- **`build-css.sh` could silently corrupt a CSS string.** The final "drop the last `;` of a block" pass
  was a `sed 's/;}/}/g'` bolted onto the string-aware awk, and sed cannot see strings: `content: ";}"`
  came out as `content: "}"`, and a data-URI containing `;}` was mangled the same way. Both reproduced.
  The squeeze now happens inside the scanner that already tracks quoting; the output on the current
  tree is byte-identical, so nothing shipped changes.
- **Installing footstrap could rewrite the active theme of a router running somebody else's theme.**
  The "does the active theme actually exist on disk?" guard in `uci-defaults` ran against whatever
  theme was current, not against ours — so a third-party theme whose ucode template directory is not
  named after its media basename could be quietly replaced with bootstrap. It is scoped to
  `/luci-static/footstrap*` now: repair what we ship, leave the rest of the router alone.
- **The installer told new users to pick theme entries that no longer exist** (`FootstrapSidebar` /
  `FootstrapOnTop`). There is one `Footstrap` entry; layout is a per-browser toggle in Appearance.

### Security
- **`install.sh` no longer disables TLS certificate verification.** The installer is piped from the
  internet into `sh` as root, and it retried every download with `--no-check-certificate` (or
  `curl -k`) after *any* failure of the verified attempt — which includes a man-in-the-middle
  presenting a bogus certificate. Whatever came back was then installed as a root package. The
  "install the CA bundle" hint it prints was therefore unreachable in the one case it was written
  for. `ca-bundle` is in OpenWrt's `DEFAULT_PACKAGES`, so the insecure path bought nothing on a
  stock router and silently disarmed the check on a broken one.
- **The theme package is now verified against the sha256 GitHub publishes for it, in both the
  installer and the self-updater.** Both install with `apk add --allow-untrusted`, i.e. with no
  package signature to fall back on, so the release API's per-asset `digest` is the only integrity
  check there is — and neither script was reading it. A mismatch now refuses the install. It rides
  the same TLS channel as the URL, so it does not defend against a compromised `api.github.com`;
  what it does defend against is a truncated or tampered download from the asset CDN, which is a
  different host.
- **The asset host is pinned, and the redirect scheme is pinned on the backends that can express it.**
  The download URL is read out of an API response and handed to `apk add` as root; it is now required
  to be a GitHub host. `curl` additionally gets `--proto '=https' --proto-redir '=https'`, so it will
  not follow a redirect to plain `http://` on the way to the asset CDN. **`uclient-fetch` — the
  first-choice backend, and the one a stock OpenWrt router actually has — has no equivalent flag**, so
  on that path the guards are the host allowlist and the sha256, not a scheme pin.
- **`install.sh` downloads into `mktemp -d`, not a predictable `/tmp/footstrap-install`.** `/tmp` is
  1777, so any local unprivileged process could pre-create that name as a symlink and have root
  write the package through it to a file of its choosing (CWE-377) — the same race
  `footstrap-selfupdate.sh` already documents six lines of reasoning about avoiding.
- **The self-updater cannot start two concurrent installs any more.** Its "is a run already in
  progress?" test was a read followed by a write, so two RPCs arriving together both read "no" and
  both spawned an `apk add` on the same package — reproduced by firing the script twice at once.
  An atomic `mkdir` lock replaces it, with the lock's own mtime as the staleness signal (five
  simultaneous invocations now yield exactly one `STARTED` and four `RUNNING`).
- **CI's jsmin and the i18n scanner are pinned to a commit SHA and checksummed.** Both were fetched
  from `openwrt/luci@master` and then *executed* — jsmin is compiled from C and is the gate that
  decides whether the shipped JavaScript is safe. Off a moving branch, the gate is whatever upstream
  pushed last.

## [0.8.0] — 2026-07-13

### Added
- **The sidebar/top-bar layout is now an instant toggle in Appearance → Layout, remembered per browser.** It
  used to be a *server* choice: two theme entries in System → Design (`FootstrapSidebar`,
  `FootstrapOnTop`), each with its own `mediaurlbase`, its own template directory and its own menu
  renderer. Switching meant going through the Design page and reloading. It is now a client
  preference like dark mode — `:root[data-layout]`, pre-painted by `head.ut` before the first frame,
  so there is no flash — and switching repaints in place with **no page reload and no menu re-render**:
  the DOM already serves both, and the menu's existing `MutationObserver` folds the accordion into
  dropdowns (and restores it on the way back) because that is the same state change as collapsing the
  icon rail.

- **Three new CSS gates, each closing a hole nothing off-the-shelf covers** (`npm run check` runs the
  lot; all three are CI-only — the OpenWrt buildbot still needs nothing but `cat`).
  - `tools/css-dup.mjs` — **the same declaration body written under two different guards.** No linter
    can flag this and none ever will: to a cascade-aware tool, two rules under mutually-exclusive
    guards (a media query vs an attribute selector, a class vs a container query) are both *required*,
    since only one can ever match. Yet it is exactly the shape that drifts. This release deleted 55
    such declarations in the chrome and took the duplicate-body count from **4 groups (~41 redundant
    declarations) to 2 (~14)**; the detector holds the remainder to a budget, so what CSS genuinely
    forces on you stays visible and cannot grow.
  - `tools/fs-orphans.mjs` — **dead CSS, scoped to the `fs-*` namespace.** PurgeCSS/uncss and
    coverage-based pruning are actively dangerous here: the coverage contract exists *because* a
    third-party `luci-app-*` renders widgets no page we can see renders, and a tool that prunes what
    it did not observe will un-theme somebody's app. But nobody else can emit an `fs-` class — so
    inside that one namespace, "nothing we ship emits it" really does mean dead, with zero risk to the
    contract. This is the check that catches a selector left behind when its markup is deleted.
  - `tools/css-metrics.mjs` — a **ratchet** on `!important` (33: the 16 in theme/pages that fight an
    inline or unlayered declaration, plus base's 17), max specificity and empty rules. `stylelint`
    stops a *new* file adding an `!important`; this stops the allowlisted files quietly growing more.

### Changed
- **Design now lists ONE "Footstrap" theme instead of two.** `mediaurlbase` is always
  `/luci-static/footstrap`; the layout is no longer a server-side theme at all. A router that was on
  the old top-nav theme keeps its top bar: `uci-defaults` records it as the router's default layout
  (`luci.main.footstrap_layout=top`), which `head.ut` stamps onto `<html data-layout>` — so a
  *migrated router opens on the top bar even in a browser that has never seen it*, and the user's own
  choice (localStorage) overrides that default forever after. A shell script cannot write
  localStorage; this is the channel that carries the fact across the upgrade.
- **`data-layout` is always stamped with an explicit value, by the server.** Absent-means-sidebar
  would force every rule to be a *negative* match (`:not([data-layout="top"])`), and a future third
  layout would then silently inherit the sidebar's rules merely by not being "top". Every layout rule
  is a positive match instead, so a new layout has to opt in. It also means the chrome is correct with
  JavaScript disabled — the attribute exists before a single byte of script runs.
- **On a phone, every layout renders the same top bar.** The sidebar's phone bar and the top layout's
  bar are one look now, so a narrow screen shows the same chrome whichever layout is picked. Where the
  two layouts had ever disagreed on the same element, the top bar's value is the one that survived.
- **The top bar's "Log out" is the same control as the sidebar's** — a square icon button in the right
  cluster, not a separate text item in the menu. The menu renderer already dropped the tree's
  `admin/logout` node in favour of the theme's own control; the top layout used to carry both.
- **The bar is now written once, and the vertical sidebar is the exception.** The bar is needed when
  `(viewport ≤ 767px) OR (:root[data-layout="top"])`, and CSS cannot OR a media query with an
  attribute selector in one selector — so writing the bar under both guards meant writing it twice.
  Measured: **55 of ~75 declarations were identical**, i.e. free to drift apart in silence. Inverting
  it — the bar as the unguarded base, the vertical sidebar as a single guarded override that wins on
  specificity (`0,3,0` vs `0,1,0`), never on source order — states each of the three chrome states
  exactly once. This is only expressible because `data-layout` always carries an explicit value.
  `cssdiff` proves the inversion changed nothing it did not mean to: **zero unintended property
  differences across 3 014 elements**, the only differences being the two this release intends (the
  hostname wrap, and the mode menu's active item, now themed in every layout instead of only the top
  one).
- **The bar stacks its menu onto a second row only when the menu does not fit — measured, not guessed.**
  It used to be `@media (max-width: 1199px)`. But whether the menu fits beside the brand depends on how
  many sections the router HAS (a stock install renders 5; a box with a few `luci-app-*` renders eleven),
  so a device-width breakpoint is the wrong instrument. Measured on a stock router the bar's contents come
  to ~683 px, so one row fits down to ~723 px — **that breakpoint was stacking the menu on every laptop and
  throwing away a row of vertical space for nothing**. The menu now shrinks its pills first
  (`.fs-dense1/2`) and stacks only when even the tightest step still wraps: at 1000 px a stock 5-section
  menu never stacks, 11 sections shrink, and 13+ stack.

- **One measuring engine (`fs-fit.js`) for every "does it still fit?" decision.** Two places in the
  theme must decide something no CSS query can ask, because the answer depends on what the CONTENT
  needs rather than on how wide the screen is: whether the menu fits beside the brand, and whether a
  table can still be read as a table. Both were once breakpoints, and every one of those numbers was a
  guess that some real router got wrong. The shape of the answer is always the same — measure the
  element UNCOLLAPSED, then toggle a class — so the measuring, the frame-coalescing and the
  ResizeObserver live in one module and a caller supplies only the decision. It encodes three rules,
  the first of which is a bug that was actually hit: **measure uncollapsed** — a collapsed thing always
  "fits" (a stacked table is a pile of flex rows), so reading it as it stands un-collapses it and the
  next frame collapses it again, which is an oscillation. The second is a guard rather than a cure:
  **re-fit synchronously on a mutation**, because a `MutationObserver` callback is a microtask and runs
  *before* the frame is painted, whereas `requestAnimationFrame` runs *at* paint — so if a poller ever
  REPLACES a table element (the fresh one arrives without our class) the deferred path would paint one
  frame at full width. Measured on this router it does not: LuCI updates the cells in place and the
  class survives the tick, and 60 samples across 6 poll ticks show no flicker on either path. The
  synchronous fit costs one layout per mutation batch and removes the hazard anyway. Third: coalesce
  on resize.

- **The sidebar gives way to the bar when the CONTENT column would get too narrow — and the icon rail
  therefore holds on ~155 px longer than the expanded sidebar.** It used to be one viewport
  breakpoint (767 px) for both, which could not be right: the sidebar's cut is not a constant, it is
  224 px expanded and 68 px as a rail. So collapsing the sidebar handed ~156 px back to the content
  and then folded the whole thing away at exactly the same window width — the room it had just freed
  bought the user nothing. The decision is measured from the sidebar's real cut against a stated
  minimum (500 px of content), so the expanded sidebar now yields at ~780 px and the rail at ~625 px.

- **The poll indicator now looks like one of the controls it sits beside.** In the bar it is followed by
  the Appearance and Log out buttons, and it was a 28 px capsule next to two 34 px rounded squares —
  three sizes and two shapes where there is one row. It takes the buttons' height and the theme's
  control radius now; in the vertical sidebar, where its neighbours are full-width rows rather than
  square buttons, it spans the column instead of floating in the middle of it as a stray chip.

### Removed
- **The second menu renderer, the second template and the second stylesheet are gone**
  (`menu-footstrap-top.js`, `ucode/template/themes/footstrap-top/`, the `/luci-static/footstrap-top`
  symlink, `styles/theme/50-topnav.css`). They were never two designs — the sidebar renderer already
  emitted the markup that its own CSS turns into a horizontal bar on a phone, and it already had a
  "flyout mode" in which a section behaves exactly like a top-nav dropdown. The top layout is that
  mode, at desktop width: **the whole of the deleted renderer's unique logic was one function**
  (`clampDropdown`, which nudges a dropdown back inside the viewport near the right edge), and it now
  lives in the surviving renderer. Hover-to-open was always pure CSS. Deleting the second stylesheet
  paid for the new one almost exactly: the layout merge itself cost **+78 bytes of CSS**. (The release
  as a whole is +971 bytes — the rest buys the hostname wrap, the measured stacking and the
  content-width sidebar.)
- **The `with_label` template parameter and the elements it forked** (`.fs-appearance-btn`,
  `.fs-top-logout`). A layout is a presentation choice, so it must not fork the markup: Appearance and
  Log out are one row each, and the bar and the rail squash them into icon buttons in CSS.

### Fixed
- **A page with nothing to poll (Software, Backup…) showed a "Paused" pill, reporting on a poll that
  does not exist there.** LuCI shows the indicator on a `poll-start` event and flips it to "Paused" on
  `poll-stop` — and never hides it again (`ui.hideIndicator()` exists, but core only calls it for
  `uci-changes`). On a full page load that omission is invisible, because `Poll.start()` only
  dispatches `poll-start` when the queue is non-empty, so an unpolled page simply never grows an
  indicator. But this theme's SPA router flushes the queue and calls `stop()` on every navigation, and
  `stop()` *does* dispatch `poll-stop`. The pill now obeys the only rule that makes sense — it exists
  if and only if there is something to poll — so it disappears on an unpolled page and comes back on a
  polled one. A **manual** pause still shows "Paused", because there the queue is not empty and the
  word means something. This also cures the same ghost in stock LuCI, where removing the last poller
  stops the loop and leaves the pill behind.
- **Collapsing the sidebar into the icon rail and then shrinking the window made the sidebar spring
  back OPEN, and toggling it again dropped straight to the phone bar.** The rail's rules were guarded
  at `min-width: 768px` while the vertical sidebar's guard had moved to 521 px, so in the gap between
  them the vertical rules applied and the rail's did not — the sidebar expanded to its full 224 px as
  the window got *smaller*. The rail is a MODE of the vertical sidebar and can never be visible under
  conditions the vertical sidebar is not; the two guards are now literally the same.
- **The rail's "Refreshing" glyph could not be clicked to pause the poll — because it was spinning.**
  A target that never stops moving cannot be hit. It is now a still green glyph, which is also what it
  should have been: a spinner promises that something is happening *that you are waiting for*, while
  this is a poll ticking quietly in the background forever, and a permanently spinning icon in the
  corner of the eye just makes an idle router look busy. Pausing and resuming by click both work; and
  the glyph now goes grey when the poll is paused, instead of shining green while lying about it.
- **The "Refreshing" pill drifted away from the Appearance and Log out buttons in the bar** instead of
  hugging them. Both it and the buttons carried `margin-left: auto`, and two autos SPLIT the free
  space between them rather than pushing one cluster to the right edge.
- **The chevrons came back on the collapsed rail's menu items.** A rail item has no label and no
  accordion — its children fly out to the side — so the chevron says nothing and only crowds the icon.
  The rail's rule to hide it was (0,4,0) and lost to the vertical sidebar's (0,4,3), which turns it
  back on.
- **The apk Software package list stopped collapsing into rows and overflowed its section.** It is
  `<table class="table" id="packages">` — no `.cbi-section-table` class at all — and its header row is
  `.cbi-section-table-titles`, not the `.table-titles` the data-table tagger looked for. So it matched
  *neither* rule and needed a hand-written stacking block of its own, at a fifth breakpoint. The
  tagger now accepts either header markup, and the list card-stacks and un-stacks like every other
  data table.
- **A data table now becomes cards when it actually stops fitting, not when the viewport crosses a
  number.** It used to be a container query, and there were THREE thresholds for it — 568 for a plain
  table, 780 for the DHCP leases (their 8 nowrap mono columns hold a ~736 px floor, so they must card
  earlier) and 800 for the package list — with the last two each carrying their own **copy** of the
  card rules, because CSS cannot share a declaration block across two `@container` thresholds. Both of
  those were really asking *does it overflow?*, which is a **fact the browser computes**, so both are
  gone: the overflow is measured and each table discovers its own width — including a table from a
  third-party `luci-app-*`, whose column count we could never have guessed. The card rules now exist
  once. What survives is the one judgement a measurement cannot make ("too cramped to be a table at
  all", 568), and it sits beside the measurement rather than in the stylesheet.
- **A long hostname wraps instead of being silently truncated.** It was `nowrap` + ellipsis, which hid
  the one string that tells you WHICH router you are looking at. It now breaks across lines —
  `overflow-wrap: anywhere`, so it will break mid-word when a single "word" is itself wider than the box,
  but only when there is no better break, so a normal dotted name still breaks at its dots. Wrapping
  alone was not enough: the bar is flex-wrap, so instead of squeezing the brand, flexbox wrapped
  the *menu* away and let a 78-character hostname sit on its own line 609 px wide. The brand is therefore
  also **capped** (30ch), and the bar grows in height to hold the extra line.

## [0.7.18] — 2026-07-13

### Added
- **An Accent hue slider (Appearance → Accent) recolours the UI accent.** A second hue
  axis beside the background Tint, but pointed at the CHROME rather than the canvas: the
  solid buttons, the toggle knobs, the range sliders, the focus rings, the active
  menu/tab and the accented links all follow, because each reads `--fs-accent` or a
  `color-mix()` of it, and the brand logo rotates with it too. The rotation is
  `oklch(from … l c H)` — it keeps the palette's exact lightness and chroma and swaps
  only the hue, so `--fs-on-accent` stays legible on every hue (the ink is not
  recomputed). 0 = off = the palette's designed accent; the value is per-router
  (localStorage) and pre-painted by `head.ut` so a reload doesn't flash the default.

### Changed
- **The page footer ("Powered by LuCI…") is centred** instead of left-aligned, in both
  layouts.
- **A tagged release now leads with a short changelog summary instead of install
  boilerplate.** The release body was just apk/ipk commands — the actual list of
  changes lived only in the changelog nobody links from the release page. It is now
  generated from the tag's `CHANGELOG.md` section (`tools/release-notes.sh`): one line
  per change — the bold lead of each bullet, grouped under Fixed/Added/…, with the
  verbose rationale dropped — and the install commands moved into a collapsed block. The
  Russian summary (from `CHANGELOG_ru.md`) follows the English one under a divider, so the
  release page carries both languages.

### Fixed
- **A scrolling textarea's scrollbar overshot the field's rounded corners.** A native
  scrollbar is a square strip that `border-radius` does not clip, so on a tall config field
  (an NFQWS_OPT blob, a long option list) the grey bar poked past the top-/bottom-right
  corner as a square notch. The scrollbar is now a slim self-rounded thumb floated off the
  edges (a transparent border + `background-clip:padding-box` insets it, a transparent track
  lets the corner show through), via a `::-webkit-scrollbar` block. Deliberately no
  `scrollbar-width`/`scrollbar-color`: setting either makes Chromium switch to the standard
  scrollbar and ignore the custom one — and that standard bar is the square, unclipped one
  that caused the bug. Firefox keeps its native scrollbar, which it already clips to the
  radius. The resize grip is restyled to match: an accent arc tracing the frame's own
  rounded corner (following the Rounding setting and the accent hue) instead of the default
  white square that poked past it. The widget gallery gained a scrolling-textarea case so
  this stays covered.
- **The "Refreshing" poll pill sat at the far left of the phone top bar, before the logo.**
  On a phone the sidebar collapses into a top bar, but `#indicators` had no flex `order`, so
  it defaulted to 0 and rendered ahead of the brand (`order:1`). It now joins the right-hand
  cluster with Appearance and Logout (`order:2` + `margin-left:auto`), mirroring the top-nav
  layout's `.fs-topnav-right` where the pill is the first child.
- **A stacked data table's last row had square bottom corners against the rounded frame.**
  When a data table cards into label/value pairs on a narrow screen, zebra striping
  (`.cbi-rowstyle-2`) paints its background on the row itself, and the frame is
  `overflow:visible` — so a striped last row's square background overshot the 12px rounded
  corners. Stacked rows are flex-wrap and already fit the width (nothing horizontal left to
  clip, the only thing `overflow:visible` guarded), so the table is `overflow:hidden` while
  stacked, clipping the row backgrounds to the frame radius exactly as an ordinary `.table`
  does.
- **The last row of a data table drew a separator that poked out past the card's rounded
  corners.** The row-separator rule (`.tr:not(.table-titles):not(...)`, specificity 0,4,0)
  outranked the `.tr:last-child` override that was meant to drop it (0,3,0), so the last
  row kept its `border-bottom` — a straight 1px line that overshot the frame's rounded
  bottom corners on any `overflow:visible` data table (leases, wifi, processes). The
  exclusion now lives in the separator rule itself (`:not(:last-child)`), so the last row
  never gets the border and no specificity battle decides it. Invisible before only where
  the table was `overflow:hidden` and clipped the line.
- **The DHCP leases table stopped shrinking at ~736px and spilled out of its section.**
  The leases workaround kept every mono column (IPv4/MAC/IAID/Remaining/the Static-Lease
  button/Interface) on one line — `white-space: nowrap` — down to a 568px container, so
  the table held a data-dependent intrinsic floor (~736px on a busy router). But the
  card-stack that folds a data table into label/value pairs only kicked in below 568px,
  leaving a 569–780px dead band where the table could neither shrink nor stack and
  overflowed the card. The `.leases`/`.leases6` pair now stacks from 780px down —
  matching stock bootstrap, which switches its tables to the phone layout early rather
  than forcing a scroll — while nowrap only stays on at ≥781px, where the real table
  genuinely fits. The two thresholds are adjacent (780/781) so no width is left with
  neither behaviour. Other data tables (Processes/Startup/Routes) are narrower and keep
  the shared 568px threshold.

## [0.7.17] — 2026-07-13

### Changed
- **Data tables on a phone stack the way stock LuCI stacks them: the column label sits
  above its value, and each cell takes half the row.** They used to put label and value
  on one line with the value flushed right, which left the value about 40% of the
  width. An Associated Stations row then spent 7 full-width lines, and its
  `.ifacebadge`, signal graph and long DUID wrapped under their own labels anyway.
  Half-width pairs fold the same row into 4 lines and hand the value the whole
  half-column. The row's buttons (Disconnect, Reserve IP) take a full-width line of
  their own below the pairs. Values stay left-aligned: a MAC, a DUID or a rate is an
  opaque string, and a ragged right edge reads worse than a ragged left one.
- **Config tables stack the same way, and a cell holding a widget keeps the full
  width.** A `.cbi-section-table` row (OpenVPN instances, firewall zones, port
  forwards) used to card into `label : value` lines with the value flushed right. It
  now uses the pair layout above: read-only cells at half a row (`data-widget` =
  dummy/flag/button, in both the `CBI.*` spelling `form.js` emits and the lowercase one
  the Lua CBI does), and any cell with an input, select or dropdown in it at the full
  width, because a dropdown half a phone wide cannot be used. Row buttons get their own
  line.
- **The width at which a data table stops being a table is stock LuCI's now, not
  ours.** Bootstrap's `mobile.css` stacks at `max-device-width: 600px`; the theme
  carded at a container width of 800px, i.e. on small tablets and narrow desktop
  windows where the real table still fits. The threshold is a 568px `#view` container:
  a 600px viewport, less the 16px of side padding `.fs-content` carries below the 767px
  tier. The DHCP-leases nowrap rule moved to the adjacent `min-width: 569px`, so no band
  of widths is left with neither behaviour.

### Fixed
- **A dialog on a phone laid its form out as if it were a desktop, and cut the inputs
  off at its right edge.** Every mobile rule in the theme was scoped to `#view`, and
  `ui.js` appends a modal to `<body>`, so none of them ever reached it. The
  `@container` queries that stack tables resolved to nothing in there either, because
  a modal sits inside no container the theme names. The modal is now a container in
  its own right (`fs-view fs-content`), and the field-stacking rules no longer ask for
  `#view`. Any app's dialog stacks the way its page does, not just the dialogs we
  happened to test.
- **The theme ignored the phone contract that every `luci-app-*` is written against.**
  LuCI's own JS marks the cells it wants dropped on a phone with `.hide-xs`/`.hide-sm`
  and weights columns with `.col-1`…`.col-10` (`wireless.js`, `connections.js`,
  `package-manager.js`, `channel_analysis.js`, `ui.js`). No stylesheet but bootstrap's
  `mobile.css` styles those classes, so a theme that skips them renders a layout the
  app's own JS believes it has already handled. Associated Stations was showing the MAC
  column stock LuCI hides, at the cost of half a row. Both class families are
  implemented now. Stock needs `!important` to win that cascade; one extra class
  (`.table .td.hide-xs`) does it here.
- **Forms on a phone zoomed the page in and never zoomed back out.** iOS Safari zooms
  when a focused control's text is smaller than 16px, and the theme's inputs are 13px.
  Below 767px they are 16px now, as in stock LuCI.
- **A stacked config row stayed one column deep whatever the rules said.** Two rules
  from elsewhere were landing on its cells. The Lua CBI gives a table cell the same
  `.cbi-value-field` class a form field carries, and base indents that class by 20px to
  sit it next to its label, so a pair-cell measured `50% + 20px`, two of them no longer
  fit a line, and each wrapped onto its own. Cell padding, meanwhile, is written as
  `.table.cbi-section-table .td`, which outranked the stack's plainer selector, so the
  stack's padding never applied at all. Both are fixed where they are written, not with
  a flag.
- The header row of a config table stayed visible on a phone and ran off the right
  edge, above a card that already repeats every one of its labels. The rule hid only
  `.thead`, which is the JS form's markup. The Lua CBI that half the third-party apps
  still render through (`luci-app-openvpn`) emits a bare `tr.cbi-section-table-titles`
  instead. Both are hidden now.

### Performance
- **The overview showed nothing at all until its slowest section answered.** Stock
  `view.status.index` calls `poll_status()` with a `Promise.all` over every include's
  `load()`, and `render()` does not return its tree until that settles, so `#view` stays
  empty for the whole wait. Measured on the dev router (warm, in-place nav): 229 ms
  before the first section appeared, while System, CPU, Memory, Storage, DHCP and
  Network had their data at 88 ms and were held back by `29_ports` and `60_wifi`
  (180 ms each). Sections now paint as soon as their own data lands: first section
  229 → 91 ms, everything filled 243 → 191 ms.
- **The overview fetched all of its data twice on every visit.** Stock registers the
  poller only after the first load completes, and `Poll.add()` steps immediately, so the
  page re-ran every include's `load()` right after painting: roughly 250 ms of ubus work
  for data it had just fetched. An in-flight guard folds that second run into the one
  already running: 9 → 5 ubus requests per navigation.
  Both come from replacing `poll_status` from the theme's own overview include, which
  loads inside `index.load()`. That is the one window where the swap is safe (the view
  instance exists, `render()` has not been called), and it covers a full page load and
  an in-place nav alike. The section frames, the includes, their `render()` output and
  the Hide/Show toggles all stay upstream's. `fillSection()` is a transcription of
  stock's own loop, kept in the same order so it can be diffed against `index.js` when
  luci-mod-status changes. If the shape it expects is not there, the patch is skipped
  and the page runs stock.

## [0.7.16] — 2026-07-12

### Added
- The SPA router now follows `alias` and `firstchild` menu nodes, so the links
  that used to be its blind spot navigate in place like every other page:
  Firewall, System Log, Realtime Graphs, Administration, Terminal, Attended
  Sysupgrade. Those are 6 of the 27 links the menu renders — and among the most
  clicked — yet each one still did a full page reload, because the router only
  recognised `view` nodes and an alias is a redirect, not a page. Coverage over
  every clickable node goes from 50 to 62.
  Resolution is a port of `resolve_firstchild()`/`node_weight()` from
  `dispatcher.uc`, not an approximation of it: the same weight (`order ?? 9999`,
  a login node last), the same `firstchild_ineligible` and `satisfied` filters,
  the same recursion into a nested `firstchild`. It has to be exact — the server
  answers an alias URL with a 200 at that URL and resolves the leaf internally
  (no redirect), so a client that picked a different child would open one page on
  a click and another on F5. Verified against the live router: for all 65
  clickable nodes the SPA's `data-page`, `dispatchpath`, `pathinfo`, URL and tab
  strip are identical to a real full load of the same URL, in both layouts and
  across Back/Forward. `rewrite` is deliberately left alone (the tree has none,
  and a wrong guess would open the wrong page — worse than the reload it falls
  back to).
- This changelog and its Russian mirror.

### Changed
- Stylesheet deduplicated: 1.4 KB smaller, nothing rendered differently
  (`cssdiff` over nine pages). The solid buttons were written out twice, byte for
  byte, so a recolour would have landed on half of them. Twelve `base`
  declarations that a `theme` rule already repaints through a *different* selector
  are gone; `audit.py` compares identical selectors only and could not see them.
- `setOpen`, the Space key, click-outside and Escape lived in both menu files, and
  the copies had drifted: only the sidebar checked flyout mode. One implementation
  in `menu-footstrap-common.js` now, with the selector passed in. Byte-neutral
  after minification, but the two layouts can no longer disagree on what `.open`
  means.

### Fixed
- Read-only users got working Save/Apply/Reset buttons. The SPA router rebuilt
  `L.env.nodespec` on every navigation and dropped its `readonly` flag, which
  `luci.js` reads as `hasViewPermission() = !env.nodespec.readonly`. A full page
  load disabled the buttons correctly; arriving by menu click did not.
- The active interface lost its highlight. `.ifacebox-head.active` was declared in
  `base` while `theme` repainted the plain `.ifacebox-head`, and a cascade layer
  beats specificity, so IPv4 Upstream and the radios drew as flat grey plates.
- The SSH-Keys list was capped at 440 px, wrapping a ~400-char key over three
  lines. Its `max-width: none` sat in `base` and lost the same way. Moved to
  `@layer page`, which actually wins.

### Performance
- **Every view was rendered twice on the first visit to a page, and registered two
  pollers.** LuCI's `require()` does not hand back a class — it caches an *instance*,
  so requiring a view for the first time constructs it, and a view's `__init__` *is*
  its render (that is all `ui.instantiateView()` does). The router required the view
  and then built a second instance on top, so the page was painted twice and polled at
  double the RPC rate for as long as the user stayed on it. A fresh instance is now
  built only on a revisit, when `require()` returns the singleton whose `__init__`
  already ran. Present since the router landed.
- **A view whose content comes from its first poll took up to 5 s to fill after an
  in-place navigation.** Wireless is the visible case: its station list is drawn from
  the first poll, and it sat spinning for 4950 ms against ~360 ms on a full page load.
  LuCI runs one 1 s tick and fires a poller only when `tick % interval == 0`; a full
  load calls `Poll.start()`, which zeroes the tick and steps at once, whereas the
  router kept the *outgoing* page's tick running, so the incoming view's poller had to
  wait for the next multiple of its interval. The poll loop is now put back into the
  state a fresh load leaves it in (`stop()` then `start()` on an empty queue), and the
  view's own first `poll.add()` arms the timer and takes the first step — which is
  exactly the upstream sequence, not a shortcut around it. Wireless: **4950 → 137 ms**,
  Realtime→Wireless: **55 → 16 ms**. Note `stop()` alone is not the fix and never was:
  it deletes the tick, and `Poll.add()` only auto-starts when the tick exists, so the
  page would never poll at all. Also note the two bugs above are one bug: re-arming the
  poll while the view still rendered twice made the realtime graphs throw, because
  `view/status/load.js` keeps its graph list in a module-level array (a LuCI module is
  a cached singleton across SPA navs) and indexes its RPC results by that array's
  current length — the second render grew it mid-flight. Fixing the double render
  closed that window for good.
- The navigation benchmark now covers **38 standard pages, up from 14**, compares
  **three themes** (stock `luci-theme-bootstrap`, third-party
  `luci-theme-proton2025` 1.3.0, footstrap), and all 38 pages open in footstrap
  without a page reload. Summed medians: **10517 ms bootstrap, 11680 ms proton2025,
  4638 ms footstrap**; median per-page speedup **3.43x** over bootstrap and **3.94x**
  over proton2025, and there is no longer a single page where footstrap loses. Network
  requests per navigation drop from 15–48 (bootstrap) and 27–72 (proton2025) to
  **0–8**. proton2025 is *slower* than the stock theme it restyles — it ships 436 KB
  of CSS against footstrap's 106 KB and has no client router.
  The pages the old benchmark missed are the ones the theme is fastest on: a tab or an
  alias link carries almost no work of its own, so a full reload spends its whole time
  restarting the runtime — Realtime→Wireless 287 → 16 ms (17.5x), Diagnostics 189 →
  21 ms (9.2x).
  Two harness bugs were producing plausible but false numbers and are fixed: a
  3-second wait for a spinner that a cached view never renders (it reported ~3017 ms
  for the eight *fastest* pages), and a readiness check that the outgoing page's DOM
  already satisfied. Readiness is now "the old nodes are gone", which is exactly what
  `dom.content(#view, …)` guarantees.

## [0.7.15] — 2026-07-12

### Fixed
- CI never ran. A step name contained `": "`, which an unquoted YAML scalar cannot,
  so the parser read it as a nested mapping and rejected the whole workflow. Every
  run since 0.7.13 died at 0 s with no job starting.
- `build-css.sh` silently dropped a wrapped declaration. `squeeze()` joined lines
  with nothing between them, so a `calc()` spanning two source lines became a parse
  error (`…))- .004 *`). The custom property went undefined, every `var()` reading
  it turned invalid at computed-value time, and the surface fell back to `unset`: a
  white canvas at 1.5:1. The source was valid CSS, the build exited 0, the brace
  check passed. A newline now collapses like a space; existing sources build
  byte-identically.
- The tint had a flat chroma, so its strength depended on which hue you picked,
  which is the one thing an identity cue must not do. Blue and violet did nothing
  (the canvas is a blue-grey and already out-chroma'd them), warm hues were too strong, and
  light mode showed nothing at all. Chroma is now a floor plus a `cos()` boost
  peaking at 258° and a warm-sector subtraction at 55°. Light gets a higher floor
  than dark, because near-white has almost no chroma of its own.
- Cats wallpaper opacity `.15` → `.20`. A tinted canvas swallowed the old value.

## [0.7.14] — 2026-07-12

### Added
- Tint slider (Appearance → *Tint (router identification)*, 0–360, 0 = off). One hue
  washes into the page canvas. `localStorage` is keyed by origin, so the hue is
  per-router with nothing server-side: the main router reads green, the AP violet,
  and a screenshot pasted into a ticket says which box it came from. The tint sets
  hue and chroma via `oklch(from …)` and leaves lightness alone. `color-mix()` was
  written first and is a trap in a polar space: the result's hue snaps to the tint's
  almost immediately, so the percentage controls nothing you can see. Both contrast
  gates sweep the tint.
- A translation catalogue. Every string was already wrapped in `_()` and `head.ut`
  already loaded LuCI's client catalogue, but `luci.mk` derives `LUCI_LANGUAGES`
  from `po/*` and there was no `po/`, so no language package was ever built and
  every `_()` fell through to its English msgid. `luci-i18n-footstrap-ru` builds
  now, and `update-po.sh --check` is a CI gate, because a translation that never
  gets compiled cannot fail loudly.

### Changed
- Derived colours and motion are named tokens. 39 inline `color-mix()`es had no
  name, and an unnamed level drifts in silence: the same hairline was 40% in one
  file and 45% in another, the same diff surface 30% in `base` and 18% in `theme`.
  The derived tier is a four-step ladder (`-soft` 12%, `-fill` 18%, `-line` 40%,
  `-line-hi` 55%), and the role × step matrix is complete on purpose. Motion went
  from seven durations and four curves to four durations and no easing token at
  all; every transition takes the CSS default.
- The `--*-color-*` export tier is a real ramp, not three aliases. `high`, `medium`
  and `low` were one token under three names, so an app asking for a gradation got
  one flat colour: `luci-app-podkop` painted its "no data" latency in the same
  vivid accent as a live value. The ramp's axis is chroma at constant lightness.
  `tools/export-tier.mjs` gates it with 256 checks and proves `high != low`,
  because a flat colour passes every contrast threshold there is.

### Fixed
- A button dropdown's chevron takes the button's own ink (`currentColor`) instead
  of `--fs-dim`. On the accent-filled Save & Apply it was grey on blue and read as
  a smudge. Form-control dropdowns keep the muted chevron on purpose.

## [0.7.13] — 2026-07-12

### Changed
- Tokens split into a private tier and an outbound export tier. `:root` is a shared
  global scope, and every `luci-app-*` drops its CSS into the same document
  unlayered, which outranks every cascade layer. One app writing `:root { --accent:
  … }`, or `--radius`/`--text`/`--border`, repainted this whole theme silently.
  Base reading the *conventional* names was the wider hole, since `--text-color-high`
  is a LuCI convention and an app is likelier to declare it. Measured against a
  hostile `:root` over the widget gallery: 312 of 336 elements repainted before,
  0 after. `audit.py` fails on any read of an export name from inside `styles/`.

### Removed
- The RGB colour bridge (`--accent-rgb`, `--error-color-high-rgb`, …): the HSL
  bridge's mistake in a different notation, a hand-kept second copy of a colour
  that already exists as a token. It goes stale when a palette is recoloured, and a
  missing triple makes the declaration invalid at computed-value time, so the tint
  vanishes with no error anywhere. Consumers take `color-mix()` over the token now.
- 51 dead base declarations that a later layer repaints on the same selector, found
  by a new cross-layer check in `audit.py`. The check keeps them apart from the
  absorption backlog (50 declarations where only part of a selector group is
  repainted), which must not be deleted: that would un-theme the widgets no shipped
  LuCI page renders but a third-party app does.
- 11 redundant `!important` flags (44 → 33), each checked property by property
  against the JS that writes the inline style it was supposed to fight.

### Performance
- The bold mono face is gone: 20 KB fetched on every page, 30% of the font payload,
  drawing 227 elements across seven pages that were all *labels*. LuCI writes every
  status readout as `<strong>MAC:</strong> ac:1f:6b:…`, where the strong names the
  datum and the text after it is the datum. Labels take the UI face now, at zero
  cost, since Manrope 700 is already loaded. Fonts on disk 94 664 → 68 488 B; the
  CI budget ratchets down to 70 KB.

## [0.7.12] — 2026-07-12

### Added
- CI gates every push and PR, not just tags. `check` needs nothing but
  `python3`/`awk`/`sh`, so it can never break the OpenWrt buildbot: shell syntax,
  the stylesheet build with its size budget, a font-byte budget, and `audit.py
  --strict` (the flag is new; the script always exited 0 and was useless as a
  gate). `lint` is npm-only and CI-only: eslint, stylelint, axe-core over the widget
  gallery across the full {light,dark} × {footstrap,hicontrast} matrix, and the
  minifier-equivalence check.
- OpenWrt 24.10 support, verified rather than assumed. The `openwrt-24.10` branch of
  `openwrt/luci` is already ucode, every template API this theme uses exists there,
  and the `L.env` blob the menu and SPA router key off is byte-identical between the
  branches. Only the package manager differs (apk vs opkg).
- `docs/18`: the peer baseline (what argon/aurora/proton2025 actually ship, measured
  from their repos), the standards checklist, and the audit this release came out of.

### Fixed
- Accessibility, up to WCAG 2.2 AA. Buttons had no focus indicator at all: base
  listed `button:hover`, not `:focus`, and the theme layer erased what was left. One
  global `--on-accent: #fff` sat on every fill in every mode and measured 1.69:1 on
  dark palettes' light fills; it is four inks now, defined per palette and per mode.
  The "hicontrast" palette was less contrasty than the default. Chips had a systemic
  bug: text of colour C on a translucent tint of C eats its own contrast, and being
  translucent its value depends on the surface underneath, so no percentage is safe
  everywhere. Plus `prefers-reduced-motion`, `forced-colors`, the W3C APG disclosure
  pattern for menus, a `<nav>` landmark, a skip link, an `<h1>` and 24 px touch
  targets.
- `fs-select.js` leaked a listener per option-list rebuild. All three
  MutationObservers ran a full scan on every poll tick, forcing layout. `data-page`
  was stamped from the *request* path, so `/admin/status` produced `admin-status` and
  every page-scoped rule silently missed. A self-update RPC in flight could outlive a
  navigation and throw a modal onto an unrelated page.
- The `PKG_UPGRADE` install guard was dead in production. apk never sets it, so only
  `dev-sync.sh` ever took the upgrade branch. A marker file decides fresh install vs
  upgrade now.

### Security
- The self-update script's state moved out of `/tmp` into root-owned
  `/var/run/footstrap-update`. `/tmp` is 1777 and the old paths were predictable, so
  a local user could pre-create them as symlinks and make root's `cp`, `chmod`,
  `curl -o` and `>` write through to a file of their choosing (CWE-377). `PATH` is
  pinned, since rpcd lets the caller pass env. Both `curl` calls gained timeouts, and
  a truncated cache no longer wedges the update button until reboot.

### Performance
- The JS is minified again (83 → 35 KB). `LUCI_MINIFY_JS:=0` had been copied from
  the CSS side, where it is justified, since csstidy mangles `:has()`/`color-mix()`.
  But `luci.mk` minifies JS with jsmin, which is already on the buildbot, and uhttpd
  serves `/www` uncompressed, so those were wire bytes and flash bytes both.
  Comments stay in git. jsmin's hazard is real and silent: it tells a regex from a
  division by one preceding character, and can swallow the rest of a file while
  exiting 0. So `wrap-regex` forbids the shape and `tools/jsmin-verify.mjs` proves
  the output is token-identical to the source.
- `build-css.sh` squeezes the whitespace CSS ignores (117.5 → 108.3 KB), proven
  behaviour-neutral with `cssdiff` over ~4000 elements.

## [0.7.11] — 2026-07-12

### Added
- Bilingual GitHub issue forms. The bug form asks for what a layout bug cannot be
  reproduced without: theme version, board, layout, palette/mode, page path, viewport,
  and whether stock `luci-theme-bootstrap` shows it too.

### Changed
- The HSL component bridge is gone. Every base shadow and hairline that read
  `--*-hsl` / `--*-h/s/l` uses `color-mix()` over the real palette tokens, so a
  palette edit repaints them with no hand-synced copy. The native select chevron is
  a per-palette data-URI (a data-URI cannot read `var()`), so it follows palette and
  mode.
- The header and footer chrome is shared between both layouts. Brand, appearance
  button, logout, notices and the whole footer were written twice and had drifted;
  they live in `themes/footstrap/partials/` now. The page title goes through
  `striptags()`, because a third-party menu title is not trusted markup.

### Fixed
- `ui.Select.setValue()` rewrites the native select without dispatching `change`, so
  the enhanced widget went stale: it showed the old value while Save read the new one.
- A missing `#tabmenu`/`#modemenu` no longer rejects out of `ui.menu.load()` and kills
  every menu. SPA navigation carries a generation token, so a slow view can no longer
  render into `#view` on top of a newer one.
- `luci.mk` keys `Build/Prepare` on `LUCI_NAME`, which defaults to the checkout
  directory name, so a differently-named checkout silently skipped the CSS build.
  Pinned.
- `postrm` moves an active footstrap `mediaurlbase` back to `bootstrap` instead of
  leaning on LuCI's runtime fallback.

## [0.7.10] — 2026-07-11

### Fixed
- `appearance: base-select` is scoped to LuCI form selects only (issue #2).
  Third-party app selects, such as podkop-plus's connection-monitor filter, sit
  outside `.cbi-value-field` and populate options via `replaceChildren`. Forcing
  `base-select` on every select made them render Chrome's customizable `::picker`,
  which early Chrome builds mis-render, showing only the first option. App selects
  fall back to a themed closed control plus the native, reliable dropdown list.

## [0.7.9] — 2026-07-11

### Fixed
- The apk Software page stacks on phones. It injects an unlayered inline `<style>`
  (`.controls{display:flex}`) that no cascade layer can outrank, so the
  Filter/Download/Actions columns crammed side by side and their labels overlapped.
  The disk-space bar's value drops below the bar with reserved space, so the long
  "N MiB used of …" no longer collides with the label.

## [0.7.8] — 2026-07-11

### Fixed
- One seam-free wallpaper layer per layout. Top-nav painted the cats on both
  `.fs-topwrap` and its `.fs-main-top` child, so two semi-transparent tile layers
  doubled and misaligned. The denser new art made the seam obvious.
- An empty data table renders cleanly. `L.ui.Table`'s single-cell placeholder row
  spanned only the first column in a `display:table` table, and the corner rounding
  drew a tiny box.

## [0.7.7] — 2026-07-11

### Changed
- New cats artwork (`docs/design/cats_final3.svg` is the editable source), recoloured
  to the theme's neutral and slightly denser (tile 520 → 440 px).

## [0.7.6] — 2026-07-11

### Changed
- Standard breakpoints: mobile ≤767, tablet 768–1199, desktop ≥1200, remapped
  everywhere including the flyout-mode JS breakpoint. The overview grid moved from a
  viewport `@media` to a `@container`, and the content column cap goes
  1040 → 1280.
- The Port status cards on the overview are count-agnostic (`auto-fit
  minmax(126,200)`, so 2 to 24+ ports lay out without a card stretching full-width),
  with a per-card container query that stacks speed and traffic when a card is too
  narrow.

### Fixed
- A long DHCP hostname wraps instead of forcing the table wide.
- Config-form modals widen to `min(1100px, 94vw)` via `.modal:has(.cbi-map)`, so a
  table inside (Bridge VLAN filtering) shows as a real table on desktop instead of
  cards.

## [0.7.5] — 2026-07-10

### Changed
- Palettes are swappable variant blocks, one self-contained block per colourway ×
  light/dark in `styles/03-palettes.css`. Adding a colourway is copying a block. Zero
  render change.
- The sidebar's redundant page-title topbar is gone, and `#indicators` moves to the
  top of the sidebar (a spinning glyph on the collapsed rail).
- Data tables reflow to fit the content column instead of scrolling horizontally.

### Fixed
- Top-nav on phones: Log out becomes an icon button, and `stripFitsOneRow` ignores the
  hidden item, so the menu still shrinks to one row.
- `.cbi-value` stacks on phones, so a field's help text gets the full column instead of
  an 8-line crush.

## [0.7.4] — 2026-07-10

### Added
- Rounding slider (Appearance, 0–20 px). One user base radius drives the whole scale
  proportionally, and 76 literal radii across 15 files became tokens. `head.ut`
  pre-paints it before first paint, so a reload never flashes the old radius.

### Fixed
- System → Administration → SSH-Keys renders its whole view as a bare `<div>` with no
  `.cbi-section`, so on the wallpaper the text sat frameless. It gets the panel card.

## [0.7.3] — 2026-07-10

### Fixed
- Phantom scroll on every tabbed form (Network → DNS/Interfaces/DHCP, Firewall, Flash).
  Inactive tab panes were collapsed to `height:0; overflow:hidden`, but a
  clipped-content pane still inflates `scrollHeight`, and DNS scrolled 792 px into
  blank space below the footer. The old `display:none` fix only matched `.cbi-section`
  panes, and dnsmasq renders each tab as a plain `<div data-tab-title>`.

## [0.7.2] — 2026-07-10

### Added
- Appearance popover: Wallpaper group (Off/Cats), palette reduced to 2
  (footstrap/hicontrast), Submenus and Updates toggles restored.
- Tabs and top-nav auto-fit. JS measures the wrap and applies density classes,
  trimming padding first and font last, with a text floor.

### Changed
- Data tables get a whole-table contour with rounded corners, and any direct parent in
  `#view` scrolls, so a table never pokes past its section.

## [0.7.1] — 2026-07-10

### Fixed
- The release check caches for 5 minutes, not an hour. The TTL is exactly how long a
  freshly published release stays invisible in the popover, and an hour made a stale
  badge indistinguishable from a broken check. At 300 s the worst case is 12 API
  calls/hour, well inside GitHub's anonymous budget.

## [0.7.0] — 2026-07-10

### Added
- `audit.py` checks for declarations shadowed within a layer, so the stylesheet cannot
  drift back into a changelog.
### Changed
- The styles tree is one directory per cascade layer (`tokens, base, theme, page`),
  with the 2300-line base stylesheet split by component. Rule order inside each layer
  is unchanged, and `cssdiff` reports zero computed-style differences on both layouts.
- The changelog-shaped duplication is collapsed. 182 declarations were shadowed by a
  later rule on the same selector, 108 of them restating an identical value. Tabs were
  described twice, the base button three times, the open dropdown list five times. Two
  of those duplicates were load-bearing through source order alone, and now win on
  specificity instead of position. Minified output 116 → 110 KB.
- The last of the bootstrap heritage is gone. The 28 hardcoded colours left in base are
  tokens (`.close` rendered `#000` on a dark background), `common.bootstrap()` became
  `common.init()`, and the word is out of filenames and comments. The Apache-2.0
  attribution in the banner stays, being a licence obligation rather than a description.

### Removed
- The four legacy `-dark`/`-light` media and template symlinks per layout.
  `uci-defaults` migrates a stale `mediaurlbase` before the on-disk check runs, so they
  guarded nothing.


---

Everything below 0.7.0 predates this file and is summarised one section per minor
line, not one per tag. The individual patch releases are in the git history.

## [0.6.x] — 2026-07-09 … 07-10

### Added
- The theme version in the Appearance popover, an update badge when a newer GitHub
  release exists, and one-click self-update. The backend is an ACL-gated `file.exec`
  of one fixed path with no arguments, installing with apk on 25.12 or opkg on 24.10.
- An Updates toggle (Check/Off). Off skips the GitHub call entirely: no fetch, no
  badge, no button.

### Changed
- The release check moved off the browser and onto the router. A LAN client often has
  no route to the internet while the router does, and GitHub allows 60 anonymous calls
  per hour per IP, which a check on every page load burned through.
- Self-update runs detached. `rpc.js` aborts the XHR after 20 s and rpcd kills the
  exec'd process after 30 s, so a synchronous install could not fit and rpcd could kill
  apk mid-install. The script spawns a worker and the client polls `status`.

### Fixed
- Self-update reported failure when it had succeeded. `postinst` restarts rpcd, which
  drops the session, so the status poll died with "Login session is expired". That is
  the success path, and it says so now, with a Log in again button.
- The dropdown chevron had no hit area. `font-size: 0`, which hides the stock textual
  arrow, also collapsed the inherited `line-height`, so the span measured 28×0 while
  the chevron rendered outside it. Aiming at the visible chevron hit the button behind
  it, and on Diagnostics that started a ping. Now 34×30.
- Widget tables lost their rounded frame. A real `<table>` inherits `border-collapse:
  collapse`, which ignores `border-radius`, and the corners had come from an
  `overflow: hidden` that was dropped so an open dropdown would not be clipped.
  Switched to the separated border model with zero spacing: same layout, radius applies.
- The sidebar rail was gated at min-width 901 px while the mobile bar moved to 600, so
  between 601 and 900 the collapse button set `data-rail` with no rule to match it.
- A progressbar's value overlapped the row divider in multi-column tables
  (cpu-status "Detailed load of each CPU").

## [0.5.x] — 2026-07-09

### Added
- Collapsible sidebar rail (`data-rail`, persisted, applied before paint). Section
  submenus become hover/tap flyouts and leaves get a tooltip.
- Below 900 px the sidebar becomes the same sticky, blurred bar the top-nav layout uses.
- A Submenus switch in Appearance (sidebar only): Keep open, or Auto-collapse.

### Changed
- The custom overview dashboard is retired. `05_footstrap_dashboard.js` re-rendered a
  page-tall tree on every poll, which flickered and reset mobile scroll. A layout-only
  include replaces it: it tags the stock System/Memory/Storage sections and wraps them
  in a grid, leaving stock content and polling untouched.
- Every progressbar collapsed into one thin 10 px meter with the value above its right
  edge. Memory, Storage, CPU load, Active Connections and the Software disk bar all
  render identically now.
- The page heading and every tab strip sit in a rounded card.

### Fixed
- Login was a blank page. The forked `sysauth.ut` parked the form in a
  `<section hidden>` and revealed it from a view module, but there is no session on the
  login page, an RPC in that chain answers Access denied, and `render()` never ran. The
  card is rendered server-side now, with no JS at all.
- Keep-open sections survive a full page load, not just an SPA nav. The set lives in
  `localStorage` (`fs-menu-open`).
- Inactive CBI tab panes are taken out of flow. A `height:0; overflow:hidden` pane still
  inflates `scrollHeight`, which added ~585 px of phantom scroll below the footer.
- The sidebar-to-top-bar breakpoint dropped from 850 to 600 px, so the sidebar stays
  usable on narrow tablets.
- `form.TableSection`/`GridSection` render their table without an id, so the key/value
  rules were forcing `width: 40%` and `nowrap` on the first column and starving the
  data columns.

## [0.4.x] — 2026-07-09

### Added
- A client-side SPA router. A menu click re-instantiates the target LuCI view in place
  instead of reloading the page: no re-parse of `luci.js`/`cbi.js`, no re-fetched
  translations, no menu rebuild. It covers `view` nodes (~89% of pages), and
  call/function/template/alias nodes, external links, downloads, modified clicks and
  any error fall back to normal navigation. `pushState` keeps real dispatcher URLs, so
  F5, deep links and back/forward still work.
- A Playwright navigation benchmark against stock bootstrap: median 2.28× faster
  click-to-render, 1.91× total, and 15–39 requests per page down to 1–4 (`docs/15`).
- The uci changes modal is themed: token-based diff tints instead of the vivid stock
  colours, rounded to match the cards.

## [0.3.x] — 2026-07-08

### Added
- The GitHub Primer palette becomes the default `footstrap`; the previous high-contrast
  look stays selectable as Hi-Contrast.
- The cats wallpaper, shipped self-hosted, first as the Roman palette and then renamed
  Rvht (the legacy value migrates client-side before paint).
- CI builds an ipk for 24.10 alongside the apk for 25.12, and `install.sh` detects apk
  vs opkg and fetches the matching asset.

### Changed
- Six theme entries collapse to two layouts, FootstrapSidebar and FootstrapOnTop. Mode
  and palette became client-side toggles, and `uci-defaults` migrates existing installs
  onto their base layout.
- Standalone data tables (leases, Processes, Startup, Associated Stations) stack into
  cards below 820 px. They carry no `.cbi-map` wrapper, so the section-table container
  query never reached them and they overflowed to ~800 px on a phone.
- `postinst` and `postrm` restart rpcd, so a direct apk/opkg install picks up the ACLs
  and the theme registration without a reboot.

### Fixed
- Top-nav dropdowns work on touch. Hover-only submenus were unusable there: a tap now
  toggles a popup card below the bar, a second tap closes it, and on a hybrid device a
  real mouse entering the menu drops the tap-opened panel.
- The firewall zone table stacks through container queries instead of overflowing.

## [0.2.x] — 2026-07-08

### Added
- The Appearance popover (Mode auto/light/dark, plus Palette), replacing the plain dark
  toggle. Client-side, instant, persisted, no reload.

### Fixed
- Saving a wireless config, or any form with a native select, failed silently.
  `fs-select` rendered its styled dropdown *before* the native `<select>`, making the
  dropdown `frameEl.firstChild`, and `ui.Select.getValue()` reads
  `this.node.firstChild.value`. It got a `<div>` and returned undefined. The dropdown
  goes after the select now, with the value mirrored both ways.
- Inactive tab panes showed a ~38 px phantom strip on first render. LuCI sets
  `data-tab-active="true"` on the shown tab only, and the others carry no attribute yet,
  so a rule keyed on `"false"` missed them.
- The duplicate-hide MutationObserver was installed once per poll, leaking observers and
  slowing the page progressively.
- The `--faint` token (table headers, field labels) was used but never declared.
- The Enabled button on System → Startup was blue text on a green fill.

## [0.1.x] — 2026-07-08

### Added
- First release. `luci-theme-footstrap` for OpenWrt 25.12+: two layouts, a ucode-only
  server shell, and an apk build through the OpenWrt SDK.

### Fixed
- LuCI's CSS and JS minifiers are disabled. csstidy mangles `:has()`, `color-mix()` and
  nested `calc()`, which broke the layout outright. JS minification came back in 0.7.12,
  once jsmin was proven safe by a token-equivalence gate.

[0.9.0]: https://github.com/VizzleTF/luci-theme-footstrap/compare/v0.8.9...v0.9.0
[0.8.9]: https://github.com/VizzleTF/luci-theme-footstrap/compare/v0.8.8...v0.8.9
[0.8.8]: https://github.com/VizzleTF/luci-theme-footstrap/compare/v0.8.7...v0.8.8
[0.8.7]: https://github.com/VizzleTF/luci-theme-footstrap/compare/v0.8.6...v0.8.7
[0.8.6]: https://github.com/VizzleTF/luci-theme-footstrap/compare/v0.8.5...v0.8.6
[0.7.17]: https://github.com/VizzleTF/luci-theme-footstrap/compare/v0.7.16...v0.7.17
[0.7.16]: https://github.com/VizzleTF/luci-theme-footstrap/compare/v0.7.15...v0.7.16
[0.7.15]: https://github.com/VizzleTF/luci-theme-footstrap/compare/v0.7.14...v0.7.15
[0.7.14]: https://github.com/VizzleTF/luci-theme-footstrap/compare/v0.7.13...v0.7.14
[0.7.13]: https://github.com/VizzleTF/luci-theme-footstrap/compare/v0.7.12...v0.7.13
[0.7.12]: https://github.com/VizzleTF/luci-theme-footstrap/compare/v0.7.11...v0.7.12
[0.7.11]: https://github.com/VizzleTF/luci-theme-footstrap/compare/v0.7.10...v0.7.11
[0.7.10]: https://github.com/VizzleTF/luci-theme-footstrap/compare/v0.7.9...v0.7.10
[0.7.9]: https://github.com/VizzleTF/luci-theme-footstrap/compare/v0.7.8...v0.7.9
[0.7.8]: https://github.com/VizzleTF/luci-theme-footstrap/compare/v0.7.7...v0.7.8
[0.7.7]: https://github.com/VizzleTF/luci-theme-footstrap/compare/v0.7.6...v0.7.7
[0.7.6]: https://github.com/VizzleTF/luci-theme-footstrap/compare/v0.7.5...v0.7.6
[0.7.5]: https://github.com/VizzleTF/luci-theme-footstrap/compare/v0.7.4...v0.7.5
[0.7.4]: https://github.com/VizzleTF/luci-theme-footstrap/compare/v0.7.3...v0.7.4
[0.7.3]: https://github.com/VizzleTF/luci-theme-footstrap/compare/v0.7.2...v0.7.3
[0.7.2]: https://github.com/VizzleTF/luci-theme-footstrap/compare/v0.7.1...v0.7.2
[0.8.5]: https://github.com/VizzleTF/luci-theme-footstrap/compare/v0.8.4...v0.8.5
[0.8.4]: https://github.com/VizzleTF/luci-theme-footstrap/compare/v0.8.3...v0.8.4
[0.8.3]: https://github.com/VizzleTF/luci-theme-footstrap/compare/v0.8.2...v0.8.3
[0.8.2]: https://github.com/VizzleTF/luci-theme-footstrap/compare/v0.8.1...v0.8.2
[0.8.1]: https://github.com/VizzleTF/luci-theme-footstrap/compare/v0.8.0...v0.8.1
[0.8.0]: https://github.com/VizzleTF/luci-theme-footstrap/compare/v0.7.18...v0.8.0
[0.7.18]: https://github.com/VizzleTF/luci-theme-footstrap/compare/v0.7.17...v0.7.18
[0.7.1]: https://github.com/VizzleTF/luci-theme-footstrap/compare/v0.7.0...v0.7.1
[0.7.0]: https://github.com/VizzleTF/luci-theme-footstrap/compare/v0.6.5...v0.7.0
[0.6.x]: https://github.com/VizzleTF/luci-theme-footstrap/compare/v0.5.7...v0.6.5
[0.5.x]: https://github.com/VizzleTF/luci-theme-footstrap/compare/v0.4.1...v0.5.7
[0.4.x]: https://github.com/VizzleTF/luci-theme-footstrap/compare/v0.3.8...v0.4.1
[0.3.x]: https://github.com/VizzleTF/luci-theme-footstrap/compare/v0.2.4...v0.3.8
[0.2.x]: https://github.com/VizzleTF/luci-theme-footstrap/compare/v0.1.1...v0.2.4
[0.1.x]: https://github.com/VizzleTF/luci-theme-footstrap/commits/v0.1.1
