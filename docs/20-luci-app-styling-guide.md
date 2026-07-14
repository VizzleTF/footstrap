# 20. Styling a LuCI app so it works under any theme

*Русская версия: [20-luci-app-styling-guide.ru.md](20-luci-app-styling-guide.ru.md).*

This is written for authors of `luci-app-*` packages. It is not footstrap-specific advice: every
rule below comes from a pattern found in a real, popular app, and every one of them is a bug on
*some* theme — usually a theme the author never tested against. Where footstrap does something
specific, it is called out.

The survey behind it: 20 apps read line by line (OpenClash, passwall/passwall2, ssr-plus, mosdns,
vssr, ssclash, podkop, justclash, homeproxy, nikki, alist, dockerman, diskman, istore, AdGuardHome,
netspeedtest, partexp, taskplan, plus stock `openwrt/luci`), and the top-starred apps rendered on a
live router. Evidence lives in [19](19-tretya-storona-luci-app.md).

---

## 1. CSS lifetime: where you put a `<style>` decides who else it hits

A LuCI view is rendered client-side and swapped in and out of `#view`. A modern theme may be an
SPA: it never reloads the document. So the question "when does my CSS die?" has three different
answers, and only one of them is safe.

**DO — put the `<style>` in the tree you return.** It dies with your view, exactly like the rest
of your markup. Stock LuCI does this in `package-manager.js`, `nftables.js`, `aria2/log.js`.

```js
return E([], [
    E('style', [ css ]),           // scoped to this view's lifetime by construction
    E('div', { 'class': 'myapp-root' }, …)
]);
```

**DON'T — `document.head.appendChild(style)`.** On a full page load it looks harmless, because the
document is thrown away on the next click. Under an SPA theme it stays forever and restyles every
page the user visits afterwards. `luci-app-filemanager` hides the stock Save/Apply/Reset buttons
this way (`.cbi-button-save { display: none !important }`) and every config page in the session
becomes unsavable. `luci-app-banip` and `luci-app-adblock` do it with a `<link>`.

**DON'T — inject at module eval.** `<style>` added at the top level of your module (or by a
library you load, as ACE does with its 14 KB `ace_editor.css`) is created **once per document** and
can never be re-created: your module is cached. A theme that cleans up after you cannot give it
back, and your widget renders structureless. If you must, then at least be idempotent and expect
your sheet to be there for the life of the page.

**How footstrap reacts** (so you can predict it). Nothing is ever deleted. A sheet in `<head>` is
left alone — and SPA navigation keeps working — as long as it cannot paint a page that is not yours:

* it names only your own classes (`.ace_*`, `.hexview`, `.myapp-card`), **or**
* it names a stock widget but *pins* the rule to your markup with a name of your own —
  `#cbi-myapp-section > .cbi-section-remove` and `.myapp-table th.sortable.active` are both fine,
  because without your section, or your table, they match nothing. (A `:not()` argument does not
  count as a pin: `.cbi-button-save:not(.my-save-button)` still matches every stock save button on
  every page.) **Or**
* it is a bare selector that declares nothing but your own custom properties —
  `:root { --myapp-accent: … }` is inert; `:root { color-scheme: light dark }` is not.

Anything else — `.cbi-button-save { display: none }`, `.error { … }`, `h4 { … }`,
`div > label + select { … }`, `svg text { … }` — makes the document unusable for the SPA: the next
navigation falls back to a full page load. Your app still works; the user pays one ordinary page
load. All five of those examples are real, from apps in the top 30 by stars.

---

## 2. Namespace everything you declare

You are a guest in a document you share with the theme and with every other app.

- **Classes and ids:** prefix with your package name — `.myapp-card`, `#cbi-myapp-…`. Do not claim
  dictionary words. Seen in the wild and each one a live collision: `.hidden`, `.label`,
  `.description`, `.centered`, `.skeleton`, `.toast`, `.dialog-title`, `.flex-row`, `.log-line`,
  and `luci-lib-taskd`'s `[hidden] { display: none !important }`.
- **Custom properties:** declare them on **your** root element, not on `:root`. `:root` is a shared
  global scope: `luci-app-filemanager`'s hex editor puts `--clr-background`, `--clr-border`,
  `--clr-highlight` there, and the file manager itself writes `color-scheme` there. A theme whose
  tokens happen to share a name is silently repainted. (OpenClash gets this right: its ~90
  properties are scoped to `.oc`.)
- **Never ship a global reset.** `* { margin: 0; padding: 0 }` (OpenClash, twice) flattens the
  theme's own chrome. Neither is a CSS framework you `@import` (`pure.css` in vssr) — it is not
  yours to install document-wide.
- **Never restyle stock LuCI selectors from outside your page.** `.cbi-button-up`, `.cbi-value`,
  `.cbi-section-table-titles`, `ul.dropdown`, `table th` — the theme owns those, and your rule is
  unlayered, so it beats every cascade layer the theme has. Inside your own page, scope it:
  `.myapp-root .cbi-value { … }`.

---

## 3. Colour: use the export tier, not literals

Every LuCI theme exposes the same custom-property contract. Read it, with a literal fallback:

```css
color:            var(--text-color-high, #333);
background-color: var(--background-color-low, #f5f5f5);
border-color:     var(--border-color-medium, #ddd);
/* status colours: primary / success / warning / error, each in high / medium / low */
color:            var(--error-color-medium, #f44336);
/* text ON a filled surface has its own ink: */
background-color: var(--success-color-high, #2e7d32);
color:            var(--on-success-color, #fff);
```

Rules:

- **The names are exact.** `--warn-color-medium` (podkop, 7 uses) and `--text-color` (justclash,
  6 uses) **do not exist** — those always fall through to the literal, on every theme. It is
  `--warning-color-medium` and `--text-color-high`.
- **`high` / `medium` / `low` is a ramp**, not three names for one colour. If you paint "no data"
  in `--primary-color-low`, expect it to be visibly quieter than a live value.
- **Never hardcode a surface.** `background: white` on a `position: fixed` modal (passwall) is a
  white box on a dark page. `#1e1e1e` on a log terminal (justclash) is a black box on a light page.
- **Never put text of colour C on a translucent tint of C.** The tint drags the background toward
  the text and eats its own contrast, and being translucent, the result depends on whatever is
  underneath — so no percentage is safe everywhere. Give the chip an opaque surface and let the
  border carry the colour.
- `<font color="green">` (dockerman, ssr-plus, OpenClash) is a status readout that vanishes on half
  the palettes. Use `--success-color-medium`.

---

## 4. Dark mode: `prefers-color-scheme` is the wrong question

`@media (prefers-color-scheme: dark)` reports the **operating system**, not the theme. Every modern
LuCI theme has its own light/dark switch, and a user who forces dark on a light OS gets your light
card on their dark page. netspeedtest, vssr, passwall and stock `ustreamer` all have this bug.

Ask the theme instead, in this order:

```js
function isDark() {
    const root = document.documentElement;
    if (root.dataset.darkmode) return root.dataset.darkmode === 'true';  // OpenClash + luci-app-internet-detector use this
    if (root.dataset.theme)    return root.dataset.theme === 'dark';     // footstrap, justclash's convention
    if (root.dataset.bsTheme)  return root.dataset.bsTheme === 'dark';   // Bootstrap-5 convention
    const m = getComputedStyle(document.body).backgroundColor.match(/\d+/g);   // works on any theme
    return m && m.length >= 3
        ? (0.299 * +m[0] + 0.587 * +m[1] + 0.114 * +m[2]) / 255 < 0.5
        : false;
}
```

There are four dialects in the wild, and footstrap stamps three of them — `data-darkmode`,
`data-theme`, `data-bs-theme` — on `:root` before first paint, so any of these checks works.
`luci-app-internet-detector` keys its dark block off `:root[data-darkmode="true"]` and therefore
looks right here with no changes at all.

In CSS, the same thing:

```css
.myapp-card { background: var(--background-color-low, #fff); }         /* follows the theme already */
:root[data-theme="dark"] .myapp-card { /* only if you truly need a dark-specific override */ }
```

- footstrap stamps `data-darkmode`, `data-theme` **and** `data-bs-theme` on `:root`, before first
  paint, precisely so all three dialects work.
- The luminance fallback works everywhere — but only because the theme keeps `body`'s background
  **opaque**. Do not assume any single attribute exists.
- **Best of all: do not detect at all.** If every colour you use comes from the export tier, dark
  mode is already handled for you — that is what the tier is for. `luci-app-nikki` reads zero
  theme state and looks right everywhere.

---

## 5. Editors and other heavy widgets

- **Do not hardcode the editor's colour theme.** mosdns and AdGuardHome pin CodeMirror to
  `dracula`, ssclash pins ACE to `tomorrow_night_bright`: a permanently black editor on a light
  page. Pick the editor theme from `isDark()` above (OpenClash does this correctly:
  `themeExtension(isDark)`).
- **Do not install a shared library into a shared path.** AdGuardHome ships its CodeMirror to
  `/luci-static/resources/codemirror/`; two apps shipping different versions overwrite each other.
  Put it under `/luci-static/resources/view/<yourapp>/`.
- **Iframes:** stock `luci-app-ttyd` is the reference — size it `width: 100%; min-height: …;
  resize: vertical`, take the port from UCI, and mirror the page's protocol. Do not hardcode a port
  (dockerman: `:7682`) and do not paint the iframe `background: #fff` (netspeedtest) — the embedded
  page decides its own colours.
- **`z-index`:** stay inside a sane range. passwall's dropdown sits at `2147483647` and OpenClash's
  fullscreen editor at `999999 !important` — a theme's own overlays and dropdowns cannot coexist
  with that. Nothing you render needs to be above everything ever.
- Never `body { pointer-events: none }` (passwall, while its modal is open): if anything navigates
  while the class is on, the entire UI is dead.

---

## 6. Layout: the viewport is not your column

A theme puts a sidebar next to your page. On footstrap that is 224 px, and on a 1024 px screen your
content column is ~740 px wide while `@media (max-width: 768px)` still says "desktop". Every app in
the survey that stacked its cards by a viewport query (justclash 56rem, podkop 900 px, netspeedtest
768 px) breaks in exactly that band.

- Prefer `@container` queries, or measure your own container and set a class.
- Do not force `table-layout: fixed` plus a `min-width` on every cell (filemanager) — that defeats
  any responsive card-stacking a theme does.
- Avoid fixed px widths on containers; `width: 100%; max-width: …` is what you meant.

---

## 7. Be SPA-friendly (and it costs you nothing on a classic theme)

A modern theme may re-instantiate your view without ever reloading the document.

- `window.onload` and `DOMContentLoaded` fire **once per document**. A handler registered there
  (diskman, passwall's `optimize_cbi_ui.htm`) silently stops working after the first navigation.
  Do your work in `render()`.
- Clear your own `setInterval`s and pollers when the view goes away; register pollers through
  `L.Poll` and LuCI will do it for you.
- Do not append persistent nodes to `document.body` (podkop's toast container, taskd's dialog):
  they survive the view swap. Put them in your view tree.
- Do not add a document-level `popstate` handler that navigates (istore) — you will race the
  theme's router and win, wrongly.
- **Do not hide the stock buttons with CSS.** Set `handleSave`, `handleSaveApply` and `handleReset`
  to `null` in your view (as `luci-app-partexp` and `luci-app-ttyd` do). That is the supported way,
  it needs no `!important`, and it does not leak onto the next page.

---

## 8. Checklist

| | |
|---|---|
| `<style>` returned inside the view tree, not appended to `<head>` | ✅ |
| Every class, id and custom property prefixed with the app name | ✅ |
| No `:root { … }`, no `* { … }`, no imported CSS framework | ✅ |
| No stock `.cbi-*` / `table` / `pre` selector styled outside the app's own subtree | ✅ |
| All colours from `--*-color-*` with a literal fallback; correct names | ✅ |
| Dark mode read from `data-theme` / `data-bs-theme` / body luminance — never `prefers-color-scheme` | ✅ |
| Editor theme chosen from the page's mode, not hardcoded | ✅ |
| Layout keyed to the container, not the viewport | ✅ |
| `handleSaveApply = null` instead of hiding stock buttons | ✅ |
| No `window.onload`, no body-level leftovers, no `popstate` hijack, no `z-index: 2147483647` | ✅ |

Apps to read as references: **`luci-app-nikki`** (zero injected CSS, zero colour literals, stock forms
only), stock **`luci-app-ttyd`** (the iframe done right), **`luci-app-smartdns`** (its `<style>` is
returned inside the `.cbi-map` it belongs to) and **`luci-app-internet-detector`** (namespaced
`:root { --app-id-* }` custom properties, and a dark block keyed off the theme's attribute).

---

## 9. How much of this is actually broken today

Two rounds of the survey, 30 apps, rendered on a live router under this theme:

* **Most apps are fine.** Of the ten next-most-starred apps (quickfile, tailscale-community,
  smartdns, internet-detector, 3ginfo-lite, cloudflarespeedtest, aliddns, koolproxy, ech-workers,
  sms-tool), **all ten** keep SPA navigation and none injects anything that can paint another page.
* **The breakage is concentrated in the big, old ones**, and it is nearly always the same two
  mistakes: CSS put in `<head>` instead of the view tree, and colour hardcoded instead of taken from
  the export tier.
* **Legacy Lua/CBI apps** (OpenClash, passwall, dockerman, diskman, AdGuardHome, koolproxy, sms-tool)
  are server-rendered, so their `<style>` lives and dies with their own page — but their hardcoded
  light-mode surfaces (`#f7f7f7` cards, `background: white` dialogs) still look wrong on a dark page,
  and no theme can fix that from the outside.
