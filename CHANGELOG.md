# Changelog

Notable changes to `luci-theme-footstrap`, newest first. Format is
[Keep a Changelog](https://keepachangelog.com/1.1.0/); commits are
[Conventional Commits](https://www.conventionalcommits.org/), versions are
[SemVer](https://semver.org/). Sections: Added, Changed, Fixed, Removed,
Security, Performance.

[CHANGELOG_ru.md](CHANGELOG_ru.md) mirrors this file. Edit both in one commit.

Every commit writes into `[Unreleased]`. Cutting a tag renames that heading.

## [0.7.16] — 2026-07-12

### Added
- The SPA router now follows `alias` and `firstchild` menu nodes, so the links
  that used to be its blind spot navigate in place like every other page:
  Firewall, System Log, Realtime Graphs, Administration, Terminal, Attended
  Sysupgrade. Those are 7 of the 27 links the menu renders — and among the most
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
  (the canvas is a blue-grey and already out-chroma'd them), warm hues shouted, and
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

### Performance
- The bold mono face is gone: 20 KB fetched on every page, 30% of the font payload,
  drawing 227 elements across seven pages that were all *labels*. LuCI writes every
  status readout as `<strong>MAC:</strong> ac:1f:6b:…`, where the strong names the
  datum and the text after it is the datum. Labels take the UI face now, at zero
  cost, since Manrope 700 is already loaded. Fonts on disk 94 664 → 68 488 B; the
  CI budget ratchets down to 70 KB.

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
- 11 redundant `!important` flags (43 → 33), each checked property by property
  against the JS that writes the inline style it was supposed to fight.

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

### Security
- The self-update script's state moved out of `/tmp` into root-owned
  `/var/run/footstrap-update`. `/tmp` is 1777 and the old paths were predictable, so
  a local user could pre-create them as symlinks and make root's `cp`, `chmod`,
  `curl -o` and `>` write through to a file of their choosing (CWE-377). `PATH` is
  pinned, since rpcd lets the caller pass env. Both `curl` calls gained timeouts, and
  a truncated cache no longer wedges the update button until reboot.

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

## [0.7.11] — 2026-07-12

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

### Added
- Bilingual GitHub issue forms. The bug form asks for what a layout bug cannot be
  reproduced without: theme version, board, layout, palette/mode, page path, viewport,
  and whether stock `luci-theme-bootstrap` shows it too.

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
  viewport `@media` to a robust `@container`, and the content column cap goes
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

### Added
- `audit.py` checks for declarations shadowed within a layer, so the stylesheet cannot
  drift back into a changelog.

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

[Unreleased]: https://github.com/VizzleTF/luci-theme-footstrap/compare/v0.7.15...HEAD
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
[0.7.1]: https://github.com/VizzleTF/luci-theme-footstrap/compare/v0.7.0...v0.7.1
[0.7.0]: https://github.com/VizzleTF/luci-theme-footstrap/compare/v0.6.5...v0.7.0
[0.6.x]: https://github.com/VizzleTF/luci-theme-footstrap/compare/v0.5.7...v0.6.5
[0.5.x]: https://github.com/VizzleTF/luci-theme-footstrap/compare/v0.4.1...v0.5.7
[0.4.x]: https://github.com/VizzleTF/luci-theme-footstrap/compare/v0.3.8...v0.4.1
[0.3.x]: https://github.com/VizzleTF/luci-theme-footstrap/compare/v0.2.4...v0.3.8
[0.2.x]: https://github.com/VizzleTF/luci-theme-footstrap/compare/v0.1.1...v0.2.4
[0.1.x]: https://github.com/VizzleTF/luci-theme-footstrap/commits/v0.1.1
