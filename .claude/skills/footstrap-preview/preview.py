#!/usr/bin/env python3
"""Screenshot luci-theme-footstrap pages on the live router.

Flow per layout: ssh-set luci.main.mediaurlbase -> for each mode set
localStorage fs-darkmode (client dark/light) -> login -> open page ->
wait for client render -> full-page screenshot. Restores the original
theme at the end no matter what.

Router HTTP host comes from `ssh -G <SSH_HOST>` hostname; password from
env LUCI_PW (required). Run via the project preview venv:
  .claude/tooling/preview-venv/bin/python .claude/skills/footstrap-preview/preview.py <page> [...]
"""
import argparse, os, subprocess, sys, time, pathlib

# ONE theme, ONE media path. The layout is a CLIENT preference (localStorage 'fs-layout'),
# not a theme entry — so it is set in the browser, not with `uci set mediaurlbase`.
#
# This used to be a dict mapping "footstrap-top" to /luci-static/footstrap-top, a path the
# rest of the repo actively deletes (dev-sync.sh rm -rf's it, uci-defaults migrates away from
# it). `preview.py --layout footstrap-top` therefore pointed the dev router's mediaurlbase at
# a directory that does not exist — i.e. it screenshotted a broken UI, or LuCI's theme
# fallback, and called it the top layout.
MEDIA_PATH = "/luci-static/footstrap"
LAYOUTS = ["sidebar", "top"]

def sh(host, cmd):
    return subprocess.run(["ssh", host, cmd], capture_output=True, text=True, timeout=30)

def get_http_base(ssh_host):
    out = subprocess.run(["ssh", "-G", ssh_host], capture_output=True, text=True, timeout=15).stdout
    host = next((l.split()[1] for l in out.splitlines() if l.startswith("hostname ")), None)
    if not host:
        sys.exit("cannot resolve router hostname from ssh -G")
    return f"http://{host}"

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("pages", nargs="*", default=["admin/status/overview"],
                    help="LuCI paths, e.g. admin/status/overview admin/network/dhcp")
    ap.add_argument("--pages-file", help="file with one LuCI path per line")
    ap.add_argument("--layout", choices=["sidebar", "top", "both"], default="both")
    ap.add_argument("--mode", choices=["dark", "light", "both"], default="both")
    ap.add_argument("--ssh-host", default=os.environ.get("FOOTSTRAP_SSH", "router"))
    ap.add_argument("--out", default=os.environ.get("FOOTSTRAP_OUT",
                    "/tmp/claude-1000/footstrap-preview"))
    ap.add_argument("--width", type=int, default=1440)
    ap.add_argument("--height", type=int, default=900)
    ap.add_argument("--palette", default="", help="fs-palette value, footstrap (default) or hicontrast")
    ap.add_argument("--ls", action="append", default=[], metavar="KEY=VALUE",
                    help="extra localStorage entry set before load, repeatable (e.g. --ls fs-rail=true)")
    ap.add_argument("--hover", default="", help="CSS selector to hover before the shot (flyouts/dropdowns)")
    ap.add_argument("--click", default="", help="CSS selector to click before the shot (popovers)")
    ap.add_argument("--viewport-only", action="store_true", help="shoot the viewport instead of the full page")
    args = ap.parse_args()
    pages = list(args.pages or [])
    if args.pages_file:
        pages += [ln.strip() for ln in open(args.pages_file) if ln.strip()]
    # a single arg containing spaces = shell mistake; split it
    pages = [q for p in pages for q in p.split()]
    pages = pages or ["admin/status/overview"]

    pw = os.environ.get("LUCI_PW")
    if not pw:
        sys.exit("set LUCI_PW env (router root password)")
    user = os.environ.get("LUCI_USER", "root")

    layouts = list(LAYOUTS) if args.layout == "both" else [args.layout]

    modes = ["dark", "light"] if args.mode == "both" else [args.mode]
    base = get_http_base(args.ssh_host)
    outdir = pathlib.Path(args.out); outdir.mkdir(parents=True, exist_ok=True)

    from playwright.sync_api import sync_playwright

    orig = sh(args.ssh_host, "uci get luci.main.mediaurlbase").stdout.strip() or "/luci-static/bootstrap"
    print(f"router={base} original-theme={orig}")
    saved = []
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(args=["--no-sandbox"])
            # activate the one theme once; the layout is chosen per-context below
            sh(args.ssh_host, f"uci set luci.main.mediaurlbase={MEDIA_PATH}; "
                              f"uci commit luci; rm -f /tmp/luci-indexcache*")
            for layout in layouts:
                for mode in modes:
                    ctx = browser.new_context(viewport={"width": args.width, "height": args.height},
                                              device_scale_factor=2, ignore_https_errors=True)
                    _pal = (f"try{{localStorage.setItem('fs-palette','{args.palette}')}}catch(e){{}}"
                            if args.palette else "")
                    _extra = "".join(
                        f"try{{localStorage.setItem('{k}','{v}')}}catch(e){{}}"
                        for k, _, v in (e.partition("=") for e in args.ls))
                    # the layout is a client preference now — head.ut's pre-paint script reads
                    # this key and stamps <html data-layout> before the first frame
                    ctx.add_init_script(
                        f"try{{localStorage.setItem('fs-layout','{layout}')}}catch(e){{}}"
                        f"try{{localStorage.setItem('fs-darkmode','{'true' if mode=='dark' else 'false'}')}}catch(e){{}}{_pal}{_extra}")
                    # authenticate via the API (cookie is shared with the context's pages)
                    ctx.request.post(f"{base}/cgi-bin/luci/",
                                     form={"luci_username": user, "luci_password": pw})
                    page = ctx.new_page()
                    for path in pages:
                        page.goto(f"{base}/cgi-bin/luci/{path}", wait_until="networkidle")
                        # let client JS render the view
                        try:
                            page.wait_for_selector("#view .cbi-section, #view .table",
                                                   timeout=6000)
                        except Exception:
                            pass
                        time.sleep(1.2)
                        if args.hover:
                            try:
                                page.hover(args.hover, timeout=3000)
                                time.sleep(0.4)
                            except Exception as e:
                                print(f"hover {args.hover!r} failed: {e}")
                        if args.click:
                            try:
                                page.click(args.click, timeout=3000)
                                time.sleep(0.4)
                            except Exception as e:
                                print(f"click {args.click!r} failed: {e}")
                        slug = path.replace('/', '-')[:120]
                        name = f"{layout}__{mode}__{slug}.png"
                        fp = outdir / name
                        page.screenshot(path=str(fp), full_page=not args.viewport_only)
                        saved.append(str(fp))
                        print("saved", fp)
                    ctx.close()
            browser.close()
    finally:
        sh(args.ssh_host, f"uci set luci.main.mediaurlbase={orig}; uci commit luci; rm -f /tmp/luci-indexcache*")
        print(f"reverted theme -> {orig}")
    print("\n".join(saved))

if __name__ == "__main__":
    main()
