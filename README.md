# luci-theme-footstrap

**English** · [Русский](README_ru.md)

![luci-theme-footstrap](docs/screenshots/Example.gif)

[More screenshots →](docs/screenshots/)

A dark (and light) LuCI theme for OpenWrt 24.10 and newer, with the whole
interface re-laid-out: rounded cards, readable forms, and a reworked dashboard,
login page and package manager.

## What you get

- **It styles every app, not just the stock pages.** The look hangs off generic
  rules for LuCI's widgets instead of being hand-fitted page by page, so
  third-party `luci-app` packages (podkop, statistics and the rest) come out as
  tidy as the system screens.
- **Usable on a phone.** Tables (processes, DHCP leases, firewall rules) collapse
  into cards, forms stack into a single column, and the top menu opens as a popup
  on tap. Nothing scrolls sideways.
- **Everything about the look is a browser preference, not a router setting.** There
  is **one** theme entry to pick, `Footstrap`; everything else lives in the
  **Appearance** popover in the menu and applies instantly, with no page reload and
  nothing written to the router:
  - **Layout** — side menu or top bar.
  - **Theme** — auto (follows your OS) / light / dark.
  - **Palette** — Footstrap (GitHub Primer colours) or Hi-Contrast.
  - **Wallpaper** — off, or cats. Composes with either palette.
  - **Tint** — washes one hue into the page background, so you can tell *which
    router* a tab (or a screenshot in a ticket) belongs to at a glance.
  - **Accent** — re-hues the buttons, toggles, sliders and focus rings.
  - **Rounding** — corner radius, 0–20px.
  - **Submenus** — keep several menu sections open, or auto-collapse to one.
- **It tells you when there is a new release, and can install it for you.** The
  router (not your browser) asks GitHub; Appearance → *Update now* downloads the
  release package, verifies its sha256 and installs it. Turn the check off in the
  same popover if you would rather it did not phone home.
- **Faster than the stock theme.** Pages switch without a full reload (client-side
  SPA navigation): a menu click is on average **≈2.3× faster** than
  luci-theme-bootstrap (median across pages; ~1.9× overall, with network requests
  per page dropping from 15–39 to 1–4). To measure it yourself, see
  [docs/15](docs/15-benchmark-navigatsiya.md) (Russian).

## Install

One line over SSH — the script works out whether you have apk (25.12+) or opkg
(24.10), downloads the right packages, **checks each against the sha256 GitHub
publishes for it**, and installs them:

```sh
wget -qO- https://raw.githubusercontent.com/VizzleTF/luci-theme-footstrap/main/install.sh | sh
```

For a specific version, pass the tag: `... | sh -s v0.8.0`.

It installs the theme **and its translations**, so the theme follows whatever
language LuCI is set to. `FOOTSTRAP_NO_I18N=1` installs the theme alone.

To install by hand, download the raw files from the
[releases](https://github.com/VizzleTF/luci-theme-footstrap/releases) — the files
themselves, not the zip artifact from the Actions page:

```sh
apk add --allow-untrusted luci-theme-footstrap-*.apk   # 25.12+
apk add --allow-untrusted luci-i18n-footstrap-ru-*.apk # translation, optional
opkg install luci-theme-footstrap_*.ipk                # 24.10
opkg install luci-i18n-footstrap-ru_*.ipk              # translation, optional
```

Then pick **Footstrap** in **System → System → Language and Style**, field
"Design". That is the only thing you set on the router — layout, palette and the
rest are in the Appearance popover.

## Licence

The theme is **Apache-2.0** — and that is not a free choice: `styles/base/` began as a fork of
[luci-theme-bootstrap](https://github.com/openwrt/luci)'s `cascade.css`, the ucode templates derive
from LuCI's own, and a few JS helpers are copied from LuCI verbatim. All of that is Apache-2.0, its
notices travel with it, and the whole LuCI/OpenWrt ecosystem is Apache-2.0 too.

The bundled webfonts are **not** covered by it. Manrope and JetBrains Mono are
[SIL Open Font License 1.1](luci-theme-footstrap/htdocs/luci-static/footstrap/fonts/OFL.txt), whose
notice and text ship beside the fonts, as the licence requires.

---

**Writing a `luci-app-*`?** [How to style a LuCI app so it works under any theme](docs/20-luci-app-styling-guide.md)
— CSS lifetime, namespacing, the colour contract, dark-mode detection, and what this theme does when
an app breaks the rules. Drawn from 30 real apps, verified on a router.

Internals, the build and development notes live in [docs/](docs/) (Russian).
