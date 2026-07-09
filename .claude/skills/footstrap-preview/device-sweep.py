#!/usr/bin/env python3
"""Sweep LuCI pages at popular device widths and report horizontal overflow.

Loads each page at each device's logical (CSS) viewport width in the footstrap
theme, then flags any element whose right edge crosses the viewport — i.e. content
that gets clipped by `.fs-main { overflow-x: clip }` or forces a page-level scroll.
It also measures the phantom-scroll gap (scrollHeight past the footer).

One login, one browser, theme flipped to footstrap for the run and ALWAYS reverted.

  LUCI_PW=<pw> .claude/tooling/preview-venv/bin/python \
    .claude/skills/footstrap-preview/device-sweep.py [--devices ...] [--pages ...] [--layout ...]

Defaults sweep a broad page set across phones + tablets. `--json` dumps raw data.
"""
import argparse, os, subprocess, sys, json

# logical CSS widths (portrait) — the number CSS media queries actually see
DEVICES = {
    "fold-cover":       344,   # Galaxy Z Fold 5 outer screen
    "galaxy-s24":       360,   # Samsung S24 / most compact Androids
    "iphone-se":        375,   # iPhone SE / 12/13 mini
    "galaxy-s24-ultra": 384,   # S24 Ultra
    "iphone-15":        393,   # iPhone 14/15/16 Pro
    "pixel-8":          412,   # Pixel 7/8
    "iphone-promax":    430,   # iPhone 15/16 Pro Max
    "fold-open":        768,   # Z Fold 5 unfolded / iPad mini portrait
    "ipad-air":         820,   # iPad Air portrait
    "ipad-pro11":       834,   # iPad Pro 11" portrait
    "ipad-pro13":      1024,   # iPad Pro 13" portrait
}

PAGES = [
    "admin/status/overview", "admin/status/routes", "admin/status/logs",
    "admin/status/processes", "admin/system/system", "admin/system/admin",
    "admin/system/reboot", "admin/system/flash", "admin/system/crontab",
    "admin/system/startup", "admin/system/package-manager",
    "admin/network/network", "admin/network/dhcp", "admin/network/hosts",
    "admin/network/wireless", "admin/network/firewall", "admin/network/diagnostics",
    "admin/network/routes",
]

PROBE = r"""() => {
  const cw = document.documentElement.clientWidth;
  const sw = document.documentElement.scrollWidth;
  const q = s => document.querySelector(s);
  const bt = e => e ? Math.round(e.getBoundingClientRect().bottom + window.scrollY) : null;
  const footer = bt(q('.fs-footer')) || bt(q('.fs-main')) || document.documentElement.scrollHeight;
  const gap = document.documentElement.scrollHeight - footer;
  const off = [];
  for (const e of document.querySelectorAll('#view *, .fs-content *')) {
    const s = getComputedStyle(e);
    if (s.display === 'none' || s.visibility === 'hidden') continue;
    const r = e.getBoundingClientRect();
    if (r.width > 15 && r.right > cw + 1) {
      off.push({ sel: e.tagName.toLowerCase() + (e.id ? '#' + e.id : '') +
                      (e.className ? '.' + e.className.toString().trim().split(/\s+/).slice(0,3).join('.') : ''),
                 over: Math.round(r.right - cw) });
    }
  }
  // keep the worst overflow per selector
  const bySel = {};
  for (const o of off) if (!bySel[o.sel] || o.over > bySel[o.sel]) bySel[o.sel] = o.over;
  const list = Object.entries(bySel).map(([sel, over]) => ({ sel, over })).sort((a,b)=>b.over-a.over);
  return { cw, pageScroll: Math.max(0, sw - cw), gap: Math.max(0, gap), off: list.slice(0, 8) };
}"""

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--devices", default="", help="comma list of device keys (default all)")
    ap.add_argument("--pages", default="", help="space/comma list of LuCI paths (default broad set)")
    ap.add_argument("--layout", choices=["footstrap", "footstrap-top"], default="footstrap")
    ap.add_argument("--mode", choices=["dark", "light"], default="dark")
    ap.add_argument("--ssh-host", default=os.environ.get("FOOTSTRAP_SSH", "router"))
    ap.add_argument("--json", action="store_true")
    args = ap.parse_args()

    pw = os.environ.get("LUCI_PW") or sys.exit("set LUCI_PW env (router root password)")
    user = os.environ.get("LUCI_USER", "root")
    devs = [d.strip() for d in args.devices.split(",") if d.strip()] or list(DEVICES)
    bad = [d for d in devs if d not in DEVICES]
    if bad: sys.exit(f"unknown device(s): {bad}\nknown: {', '.join(DEVICES)}")
    pages = [p for chunk in args.pages.replace(",", " ").split() for p in [chunk]] or PAGES

    host = args.ssh_host
    ghost = subprocess.run(["ssh", "-G", host], capture_output=True, text=True).stdout
    hn = next((l.split()[1] for l in ghost.splitlines() if l.startswith("hostname ")), None) or sys.exit("no hostname")
    base = f"http://{hn}"
    orig = subprocess.run(["ssh", host, "uci get luci.main.mediaurlbase"],
                          capture_output=True, text=True).stdout.strip() or "/luci-static/bootstrap"
    subprocess.run(["ssh", host, f"uci set luci.main.mediaurlbase=/luci-static/{args.layout}; "
                                 f"uci commit luci; rm -f /tmp/luci-indexcache*"])
    from playwright.sync_api import sync_playwright
    results = {}
    try:
        with sync_playwright() as p:
            b = p.chromium.launch(args=["--no-sandbox"])
            for dev in devs:
                W = DEVICES[dev]
                ctx = b.new_context(viewport={"width": W, "height": 900}, ignore_https_errors=True)
                ctx.add_init_script(
                    f"try{{localStorage.setItem('fs-darkmode','{'true' if args.mode=='dark' else 'false'}')}}catch(e){{}}")
                ctx.request.post(f"{base}/cgi-bin/luci/", form={"luci_username": user, "luci_password": pw})
                pg = ctx.new_page()
                for path in pages:
                    try:
                        pg.goto(f"{base}/cgi-bin/luci/{path}", wait_until="networkidle", timeout=15000)
                        pg.wait_for_timeout(1300)
                        r = pg.evaluate(PROBE)
                    except Exception as e:
                        r = {"error": str(e)[:50]}
                    results.setdefault(path, {})[dev] = r
                ctx.close()
            b.close()
    finally:
        subprocess.run(["ssh", host, f"uci set luci.main.mediaurlbase={orig}; "
                                     f"uci commit luci; rm -f /tmp/luci-indexcache*"])

    if args.json:
        print(json.dumps(results, indent=1)); return

    print(f"\ndevices: {', '.join(f'{d}={DEVICES[d]}' for d in devs)}  layout={args.layout} mode={args.mode}\n")
    clean = True
    for path in pages:
        issues = []
        for dev in devs:
            r = results[path][dev]
            if r.get("error"): issues.append(f"{dev}: ERR {r['error']}"); continue
            probs = []
            if r["pageScroll"] > 1: probs.append(f"H-scroll+{r['pageScroll']}")
            if r["gap"] > 40:       probs.append(f"gap+{r['gap']}")
            if r["off"]:            probs.append("clip:" + ",".join(f"{o['sel']}(+{o['over']})" for o in r["off"][:3]))
            if probs: issues.append(f"  @{DEVICES[dev]:>4} {dev:16} " + " | ".join(probs))
        if issues:
            clean = False
            print(f"■ {path}")
            for i in issues: print(i)
            print()
    if clean:
        print("✓ no overflow / phantom-scroll on any device")

if __name__ == "__main__":
    main()
