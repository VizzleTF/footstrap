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
- **Two layouts.** Side menu (FootstrapSidebar) or top menu (FootstrapOnTop) —
  switched in LuCI's settings.
- **Three palettes and light modes.** Footstrap (GitHub Primer colours, the
  default), Hi-Contrast, and Rvht (Footstrap plus cat wallpapers). Auto / light /
  dark. Changed from the Appearance popover in the header, applied instantly with
  no page reload.
- **Faster than the stock theme.** Pages switch without a full reload (client-side
  SPA navigation): a menu click is on average **≈2.3× faster** than
  luci-theme-bootstrap (median across pages; ~1.9× overall, with network requests
  per page dropping from 15–39 to 1–4). To measure it yourself, see
  [docs/15](docs/15-benchmark-navigatsiya.md) (Russian).

## Install

One line over SSH — the script works out whether you have apk (25.12+) or opkg
(24.10) and installs the right package:

```sh
wget -qO- https://raw.githubusercontent.com/VizzleTF/luci-theme-footstrap/main/install.sh | sh
```

For a specific version, pass the tag: `... | sh -s v0.3.8`.

To install by hand, download the raw file from the
[releases](https://github.com/VizzleTF/luci-theme-footstrap/releases) — the file
itself, not the zip artifact from the Actions page:

```sh
apk add --allow-untrusted luci-theme-footstrap-*.apk   # 25.12+
opkg install luci-theme-footstrap_*.ipk                # 24.10
```

Then pick the theme in **System → System → Language and Style**, field "Design".

---

Internals, the build and development notes live in [docs/](docs/) (Russian).
