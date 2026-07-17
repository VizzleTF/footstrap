---
name: footstrap-preview
description: Screenshot luci-theme-footstrap pages on the live router so changes can be seen without asking the user. Use after editing cascade.css / templates / menu-JS, or whenever a visual check of a LuCI page is needed. Renders any page in both layouts (sidebar / top-nav) and dark/light, then the PNGs can be Read to actually see the result. Triggers: "screenshot", "preview", "how does it look", "покажи", "скриншот", "превью", "как выглядит".
---

# footstrap-preview

Drives headless Chromium (Playwright) against the dev router: logs into LuCI,
temporarily activates the target theme, sets dark/light client-side, opens the
page, waits for the client-side view to render, and saves a full-page PNG. The
original theme is **always restored** at the end. Then **Read the PNG** to see it.

## Run

```sh
LUCI_PW=<router-root-password> \
  .claude/tooling/preview-venv/bin/python \
  .claude/skills/footstrap-preview/preview.py <page...> [--layout ...] [--mode ...]
```

- `<page...>` — one or more LuCI paths (default `admin/status/overview`), e.g.
  `admin/network/dhcp admin/system/system admin/status/routes`.
- `--layout sidebar|top|both` (default `both`). The layout is a CLIENT preference
  (`localStorage.fs-layout`), not a theme entry — there is one theme, `Footstrap`.
- `--mode dark|light|both` (default `both`).
- `--ssh-host` (default `router2512`, or env `FOOTSTRAP_SSH`). The dev routers are the two
  containers from `docker/compose.yml`: `router2512` (25.12) and `router2410`
  (24.10). **Shoot both when a change could land differently per release**; the theme
  supports both branches.
- Output dir: `--out` or env `FOOTSTRAP_OUT` (default `/tmp/claude-1000/footstrap-preview`).

After it prints `saved <path>` lines, **Read each PNG** (the Read tool renders
images) to inspect the result. Files are named `<layout>__<mode>__<page>.png`.

## Requirements / notes

- `LUCI_PW` env is required (router root password — `1234` on the dev containers). Do not
  hardcode it in files.
- Router HTTP base is derived from `ssh -G <host>` hostname, so the box must answer on ssh
  AND http at the SAME address — which is why `~/.ssh/config` points these hosts at the
  containers' bridge addresses (172.31.0.2 / .3) and not at their published localhost
  ports. Those ports are for a Windows-side browser; playwright runs in WSL, where the
  bridge is routable. See `docker/README.md`.
- **It flips the live active theme for a few seconds per layout and reverts.** If
  someone is using the router UI they'll see a brief switch. Fine for dev.
- The venv + Chromium live in `.claude/tooling/preview-venv` (gitignored). If the
  venv is missing, recreate: `python3 -m venv .claude/tooling/preview-venv &&
  .claude/tooling/preview-venv/bin/pip install playwright &&
  .claude/tooling/preview-venv/bin/python -m playwright install chromium`.
- Deploy your edits first (`dev-sync.sh` or scp + cache bump) — the screenshot
  reflects what's on the router, not the working tree.
