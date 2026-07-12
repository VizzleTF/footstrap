# Changelog

All notable changes to `luci-theme-footstrap`. One entry per released tag,
newest first. Format follows [Keep a Changelog](https://keepachangelog.com/1.1.0/);
the project uses [Conventional Commits](https://www.conventionalcommits.org/) and
[SemVer](https://semver.org/).

A Russian mirror lives in [CHANGELOG_ru.md](CHANGELOG_ru.md) — the two are edited in
the same commit and must not drift apart.

Sections used: **Added** · **Changed** · **Fixed** · **Removed** · **Security** ·
**Performance**.

Every commit writes into `[Unreleased]`; cutting a tag renames that heading to the
version.

## [Unreleased]

### Added
- This changelog, and its Russian mirror.

## [0.7.15] — 2026-07-12

### Fixed
- **CI was not running at all.** A step name contained `": "` — an unquoted YAML
  scalar cannot, so the parser read it as a nested mapping and rejected the whole
  workflow. Every run since 0.7.13 died at 0 s with no job ever starting.
- **The CSS builder silently dropped a wrapped declaration.** `squeeze()` is
  line-oriented and joined lines with nothing between them, gluing a `calc()` that
  spanned two source lines into a parse error (`…))- .004 *`). The declaration
  vanished, the custom property it defined went undefined, every `var()` reading it
  became invalid at computed-value time and the surface fell back to `unset` — a
  white canvas at 1.5:1. The source was valid CSS, the build exited 0 and the brace
  check passed. A newline now feeds the same run-collapse logic as a space; output
  on existing sources is byte-identical.
- **The tint had a flat chroma**, so its strength depended on which hue you picked —
  the one thing an identity cue may not do. Blue and violet did nothing (the canvas
  is itself a blue-grey and already out-chroma'd the tint), warm hues shouted, and
  light mode was invisible. The chroma is now a floor plus a `cos()` boost peaking at
  258° and a warm-sector subtraction at 55°; light gets a *higher* floor than dark,
  because near-white has almost no chroma of its own.
- The cats wallpaper is drawn at opacity `.20` (was `.15`), which a tinted canvas
  swallowed.

## [0.7.14] — 2026-07-12

### Added
- **Tint slider** (Appearance → *Tint (router identification)*, 0–360, 0 = off). One
  hue washes into the page canvas. `localStorage` is keyed by origin, so the hue is
  already per router with nothing server-side: the main router reads green, the AP
  violet, and a screenshot pasted into a ticket says which box it came from. The tint
  sets the canvas's hue and chroma via `oklch(from …)` and leaves its lightness
  alone — `color-mix()` was tried first and is a trap in a polar space (the hue lands
  on the tint's almost at once, so the percentage controls nothing you can see). Both
  contrast gates sweep the tint.
- **i18n: a translation catalogue.** Every string was already wrapped in `_()` and
  `head.ut` already loaded LuCI's client-side catalogue, but `luci.mk` derives
  `LUCI_LANGUAGES` from `po/*` and there was no `po/` — so no language package was
  ever built and every `_()` fell through to its English msgid. `luci-i18n-footstrap-ru`
  now builds. `update-po.sh --check` is a CI gate, because a translation that is never
  compiled cannot fail loudly.

### Changed
- **Derived colours and motion are named tokens now.** 39 inline `color-mix()`es had
  no name, and an unnamed level drifts in silence: the same hairline was written 40%
  in one file and 45% in another, the same diff surface 30% in `base` and 18% in
  `theme`. The derived tier is a four-step ladder (`-soft` 12% · `-fill` 18% ·
  `-line` 40% · `-line-hi` 55%) and the role × step matrix is complete on purpose.
  Motion collapsed from seven durations and four curves to four duration tokens and
  no easing token at all — every transition takes the CSS default.
- **The `--*-color-*` export tier is a real ramp, not three aliases.** `high`/`medium`/
  `low` used to be one token wearing three names, so an app asking for a gradation got
  one flat colour: `luci-app-podkop` painted its "no data" latency in the same vivid
  accent as a live value. The ramp's axis is chroma at constant lightness;
  `tools/export-tier.mjs` gates it with 256 checks and proves `high != low`, because a
  flat colour passes every contrast threshold there is.

### Fixed
- A **button** dropdown's chevron takes the button's own ink (`currentColor`) instead
  of `--fs-dim` — on the accent-filled Save & Apply it was grey on blue and read as a
  smudge. The form-control dropdown keeps its muted chevron on purpose.

## [0.7.13] — 2026-07-12

### Performance
- **The bold mono face is gone** — 20 KB fetched on every page, 30% of the whole font
  payload, and it drew 227 elements across seven pages, every one of them a *label*.
  LuCI writes every status readout as `<strong>MAC:</strong> ac:1f:6b:…`: the strong
  names the datum, the text after it *is* the datum. Labels take the UI face now, which
  costs zero bytes (Manrope 700 is already loaded). Fonts on disk 94 664 → 68 488 B;
  the CI font budget is tightened to 70 KB as a ratchet.

### Changed
- **Tokens split into a private tier and an outbound export tier.** `:root` is a shared
  global scope and every `luci-app-*` drops its CSS into the same document *unlayered*,
  which outranks every cascade layer — so one app writing `:root { --accent: … }` (or
  `--radius`/`--text`/`--border`) repainted this entire theme, silently. Base reading
  the *conventional* names was the wider hole: `--text-color-high` is a LuCI convention,
  so an app is likelier to declare it. Measured against a hostile `:root` over the
  widget gallery: **312 of 336 elements repainted before, 0 after**. `audit.py` fails on
  any read of an export name from inside `styles/`.

### Removed
- **The RGB colour bridge** (`--accent-rgb`, `--error-color-high-rgb`, …) — the same
  mistake as the HSL bridge in a different notation: a hand-kept second copy of a colour
  that already exists as a token. It goes stale when a palette is recoloured, and a
  missing triple makes the declaration invalid at computed-value time, so the tint just
  vanishes with no error anywhere. Every consumer takes `color-mix()` over the token now.
- **51 dead base declarations** a later layer repaints on the same selector. `audit.py`
  gained the cross-layer check that finds them — and deliberately separates them from the
  *absorption backlog* (50 declarations where only some members of a selector group are
  repainted, which must **not** be deleted: that would un-theme the widgets no shipped
  LuCI page renders but a third-party app does).
- 11 redundant `!important` flags (43 → 33), each checked property by property against
  the JS that emits the inline style it was supposed to fight.

## [0.7.12] — 2026-07-12

### Added
- **CI gates every push and PR**, not just tags. `check` needs nothing but
  `python3`/`awk`/`sh` (so it can never break the OpenWrt buildbot): shell syntax, the
  stylesheet build with its size budget, a font-byte budget, and `audit.py --strict` —
  the flag is new, the script always exited 0 and was useless as a gate. `lint` is
  npm-only and CI-only: eslint, stylelint, axe-core over the widget gallery across the
  full {light,dark} × {footstrap,hicontrast} matrix, and the minifier-equivalence check.
- **OpenWrt 24.10 is officially supported**, verified rather than assumed: the
  `openwrt-24.10` branch of `openwrt/luci` is already ucode, every template API this
  theme uses exists there, and the `L.env` blob the menu and SPA router key off is
  byte-identical between the branches. Only the package manager differs (apk vs opkg).
- `docs/18`: the peer baseline (what argon/aurora/proton2025 actually ship, measured from
  their repos), the standards checklist, and the audit that produced this release.

### Performance
- **The JS is minified again** (83 KB → 35 KB). `LUCI_MINIFY_JS:=0` was copied from the
  CSS side, where it *is* justified (csstidy mangles `:has()`/`color-mix()`) — but
  `luci.mk` minifies JS with jsmin, which is already on the buildbot. uhttpd serves
  `/www` with no compression, so those were wire bytes *and* flash bytes. Comments stay
  in git. jsmin's hazard is real and silent (it tells a regex from a division by one
  preceding character and can swallow the rest of a file *while exiting 0*), so
  `wrap-regex` forbids the shape and `tools/jsmin-verify.mjs` proves the output is
  token-identical to the source.
- `build-css.sh` squeezes the whitespace CSS ignores (117.5 → 108.3 KB), proven
  behaviour-neutral with `cssdiff` over ~4000 elements.

### Security
- **The self-update script's state moved out of `/tmp`** into root-owned
  `/var/run/footstrap-update`. `/tmp` is 1777 and the old paths were predictable, so a
  local user could pre-create them as symlinks and make root's `cp`, `chmod`, `curl -o`
  and `>` write through them to a file of their choosing (CWE-377). `PATH` is pinned
  (rpcd lets the caller pass env), both `curl` calls gained timeouts, and a truncated
  cache no longer wedges the update button until reboot.

### Fixed
- **Accessibility, to WCAG 2.2 AA.** Buttons had *no* focus indicator at all (base
  listed `button:hover`, not `:focus`, and the theme layer erased what was left). One
  global `--on-accent: #fff` sat on every fill in every mode and measured 1.69:1 on dark
  palettes' light fills — split into four inks defined per palette *and* per mode. The
  "hicontrast" palette was *less* contrasty than the default. Chips had a systemic bug:
  text of colour C on a translucent tint *of* C eats its own contrast, and being
  translucent its value depends on the surface underneath, so no percentage is safe.
  Plus `prefers-reduced-motion`, `forced-colors`, the W3C APG disclosure pattern for
  menus, a `<nav>` landmark, a skip link, an `<h1>` and 24 px touch targets.
- `fs-select.js` leaked a listener per option-list rebuild. All three MutationObservers
  ran a full scan on every poll tick, forcing layout. `data-page` was stamped from the
  *request* path, so `/admin/status` produced `admin-status` and every page-scoped rule
  silently did not apply. A self-update RPC in flight could outlive a navigation and
  throw a modal onto an unrelated page.
- The `PKG_UPGRADE` install guard was **dead in production** — apk never sets it, so only
  `dev-sync.sh` ever took the upgrade branch. Fresh-install vs upgrade is decided by a
  marker file now.

## [0.7.11] — 2026-07-12

### Changed
- **The HSL component bridge is gone.** Every base shadow and hairline that read
  `--*-hsl` / `--*-h/s/l` uses `color-mix()` over the real palette tokens, so a palette
  edit repaints them instead of needing a hand-synced copy. The native select chevron is
  a per-palette data-URI (a data-URI cannot read `var()`), so it follows palette and mode.
- **The header/footer chrome is shared between both layouts.** Brand, appearance button,
  logout, notices and the whole footer were written twice and had drifted; they live in
  `themes/footstrap/partials/` now. The page title goes through `striptags()` — a
  third-party menu title is not trusted markup.

### Fixed
- `ui.Select.setValue()` rewrites the native select without dispatching `change`, so the
  enhanced widget went stale: it showed the old value while Save read the new one.
- A missing `#tabmenu`/`#modemenu` no longer rejects out of `ui.menu.load()` and kills
  every menu. SPA navigation carries a generation token, so a slow view can no longer
  render into `#view` after a newer one.
- `luci.mk` keys `Build/Prepare` on `LUCI_NAME`, which defaults to the checkout directory
  name — a differently-named checkout silently skipped the CSS build. Pinned.
- `postrm` moves an active footstrap `mediaurlbase` back to `bootstrap` instead of leaning
  on LuCI's runtime fallback.

### Added
- Bilingual GitHub issue forms. The bug form asks for what a layout bug cannot be
  reproduced without: theme version, board, layout, palette/mode, page path, viewport,
  and whether stock `luci-theme-bootstrap` shows it too.

## [0.7.10] — 2026-07-11

### Fixed
- **`appearance: base-select` is scoped to LuCI form selects only** (issue #2). Third-party
  app selects (e.g. podkop-plus's connection-monitor filter) sit outside `.cbi-value-field`
  and populate options via `replaceChildren`; forcing `base-select` on *every* select made
  them render Chrome's customizable `::picker`, which early/buggy Chrome builds mis-render
  — only the first option showed. App selects fall back to a themed closed control plus the
  native, reliable dropdown list.

## [0.7.9] — 2026-07-11

### Fixed
- **The apk Software page stacks on phones.** It injects an unlayered inline `<style>`
  (`.controls{display:flex}`) that no cascade layer can outrank, so the Filter/Download/
  Actions columns crammed side by side and their labels overlapped. The disk-space bar's
  value drops below the bar with reserved space, so the long "N MiB used of …" no longer
  collides with the label.

## [0.7.8] — 2026-07-11

### Fixed
- **One seam-free wallpaper layer per layout.** Top-nav painted the cats on both
  `.fs-topwrap` and its `.fs-main-top` child, so two semi-transparent tile layers doubled
  and misaligned — the denser new art made the seam obvious.
- An empty data table renders cleanly: `L.ui.Table`'s single-cell placeholder row spanned
  only the first column in a `display:table` table, and the corner rounding drew a tiny box.

## [0.7.7] — 2026-07-11

### Changed
- New cats artwork (`docs/design/cats_final3.svg` is the editable source), recoloured to
  the theme's neutral and slightly denser (tile 520 → 440 px).

## [0.7.6] — 2026-07-11

### Changed
- **Standard breakpoints**: mobile ≤767 / tablet 768–1199 / desktop ≥1200, remapped
  everywhere (including the flyout-mode JS breakpoint), and the overview grid moved from a
  viewport `@media` to a robust `@container`. The content column cap goes 1040 → 1280.
- The Port status cards on the overview are count-agnostic (`auto-fit minmax(126,200)`, so
  2 to 24+ ports lay out without a card stretching full-width), with a per-card container
  query that stacks speed/traffic when a card is too narrow.

### Fixed
- A long DHCP hostname wraps instead of forcing the table wide.
- Config-form modals widen to `min(1100px, 94vw)` via `.modal:has(.cbi-map)`, so a table
  inside (Bridge VLAN filtering) shows as a real table on desktop instead of cards.

## [0.7.5] — 2026-07-10

### Changed
- **Palettes are swappable variant blocks** — one self-contained block per colourway ×
  light/dark in `styles/03-palettes.css`. Adding a colourway is copying a block. Zero
  render change.
- The sidebar's redundant page-title topbar is gone; `#indicators` moves to the top of the
  sidebar (a spinning glyph on the collapsed rail).
- Data tables reflow to fit the content column instead of scrolling horizontally.

### Fixed
- Top-nav on phones: Log out becomes an icon button; `stripFitsOneRow` ignores the hidden
  item, so the menu still shrinks to one row.
- `.cbi-value` stacks on phones, so a field's help text gets the full column instead of an
  8-line crush.

## [0.7.4] — 2026-07-10

### Added
- **Rounding slider** (Appearance, 0–20 px). One user base radius drives the whole scale
  proportionally; 76 literal radii across 15 files became tokens. `head.ut` pre-paints it
  before first paint, so a reload never flashes the old radius.

### Fixed
- System → Administration → SSH-Keys renders its whole view as a bare `<div>` with no
  `.cbi-section`, so on the wallpaper the text sat frameless. It gets the panel card.

## [0.7.3] — 2026-07-10

### Fixed
- **Phantom scroll on every tabbed form** (Network → DNS/Interfaces/DHCP, Firewall, Flash).
  Inactive tab panes were collapsed to `height:0; overflow:hidden`, but a clipped-content
  pane still inflates `scrollHeight` — DNS scrolled 792 px into blank space below the
  footer. The old `display:none` fix only matched `.cbi-section` panes, and dnsmasq renders
  each tab as a plain `<div data-tab-title>`.

## [0.7.2] — 2026-07-10

### Added
- Appearance popover: Wallpaper group (Off/Cats), palette reduced to 2
  (footstrap/hicontrast), Submenus and Updates toggles restored.
- Tabs and top-nav **auto-fit**: JS measures the wrap and applies density classes (trimming
  padding first, font last, with a text floor).

### Changed
- Data tables get a whole-table contour with rounded corners, and any direct parent in
  `#view` scrolls, so a table never pokes past its section.

## [0.7.1] — 2026-07-10

### Fixed
- The release check caches for 5 minutes, not an hour. The TTL is exactly how long a
  freshly published release stays invisible in the popover, and an hour made a stale badge
  indistinguishable from a broken check. At 300 s the worst case is 12 API calls/hour, well
  inside GitHub's anonymous budget.

## [0.7.0] — 2026-07-10

### Changed
- **The styles tree is one directory per cascade layer** (`tokens, base, theme, page`), the
  2300-line base stylesheet split by component. Rule order inside each layer is unchanged;
  `cssdiff` reports zero computed-style differences on both layouts.
- **The changelog-shaped duplication is collapsed**: 182 declarations were shadowed by a
  later rule on the same selector, 108 of them restating an identical value. Tabs were
  described twice, the base button three times, the open dropdown list five times. Two of
  those duplicates were load-bearing *through source order alone* and now win on specificity
  instead of position. Minified output 116 → 110 KB.
- The last of the bootstrap heritage is gone: the 28 hardcoded colours left in base are
  tokens (`.close` rendered `#000` on a dark background), `common.bootstrap()` →
  `common.init()`, and the word is out of filenames and comments. The Apache-2.0
  attribution in the banner stays — it is a licence obligation, not a description.

### Removed
- The four legacy `-dark`/`-light` media and template symlinks per layout. `uci-defaults`
  migrates a stale `mediaurlbase` before the on-disk check runs, so they guarded nothing.

### Added
- `audit.py` checks for declarations shadowed within a layer, so the stylesheet cannot
  drift back into a changelog.

[Unreleased]: https://github.com/VizzleTF/luci-theme-footstrap/compare/v0.7.15...HEAD
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
