#!/usr/bin/env python3
"""
nav-benchmark.py — measure per-page navigation time of luci-theme-footstrap
(client-side SPA router) vs the stock luci-theme-bootstrap (full page reload),
walking the *standard* LuCI pages one by one and waiting for each to fully
render before the next.

WHAT IT MEASURES
  For every standard page it times, in wall-clock milliseconds, the interval
  from "navigation intent" to "view fully rendered":
    - footstrap: a real in-app click on the menu link -> the theme's SPA router
      re-instantiates the view into #view (no page reload).
    - bootstrap: a full navigation to the page URL -> browser reloads the whole
      shell, re-parses/re-runs luci.js+cbi.js, re-fetches translations, rebuilds
      the menu, then renders the view.
  Both themes render page content into the SAME #view element (the dispatcher
  emits it regardless of theme), so the "rendered" condition is identical and
  the comparison is apples-to-apples: user-perceived click-to-usable time.

METHOD (per theme)
  1. Activate the theme (uci luci.main.mediaurlbase), clear the LuCI caches.
  2. Fresh browser context, log in.
  3. WARM pass: walk every page once, unmeasured, so HTTP cache + LuCI module
     cache are populated (steady state — matches "after each has loaded once").
  4. MEASURED passes (--runs, default 5): walk every page again, timing each
     arrival. Report the MEDIAN per page to suppress noise.
  Also counts network requests fired during each transition (SPA fetches only
  the RPC it needs; a full reload re-requests the shell + scripts, even if 304).

STANDARD PAGES
  Discovered live from /admin/menu: every satisfied `view` node whose view path
  starts with status/ , system/ or network/ (the luci-mod-status / -system /
  -network modules). Third-party app pages are excluded by construction.

USAGE
  python3 -m venv .venv && .venv/bin/pip install playwright && \
      .venv/bin/python -m playwright install chromium
  LUCI_PW=<router-root-password> .venv/bin/python bench/nav-benchmark.py \
      [--ssh-host router] [--runs 5] [--headful]
  See docs/15-benchmark-navigatsiya.md for the full recipe.
"""
import argparse, json, os, re, statistics, subprocess, sys, time

FOOTSTRAP = "/luci-static/footstrap"        # sidebar variant (simple menu)
BOOTSTRAP = "/luci-static/bootstrap"        # stock baseline
PREFIXES  = ("status/", "system/", "network/")

RENDERED = (
    "(()=>{var v=document.getElementById('view');"
    "return v && !v.querySelector('.spinning') && v.children.length>0"
    " && !/Loading view/.test(v.innerText);})()"
)
SPINNING = "document.querySelector('#view .spinning') != null"


def sh(host, cmd):
    return subprocess.run(["ssh", host, cmd], check=True,
                          capture_output=True, text=True).stdout.strip()


def discover_pages(base, ctx):
    """Return ordered [(dispatch_path, view_path, title)] of standard pages."""
    r = ctx.request.get(f"{base}/cgi-bin/luci/admin/menu")
    tree = r.json()
    rows, seen = [], set()

    def walk(node, path):
        for k, v in (node.get("children") or {}).items():
            a = v.get("action") or {}
            p = path + [k]
            # len(p)==3 => admin/<section>/<page>: a real menu-leaf item. Deeper
            # nodes are in-view tabs (reached via #tabmenu, not a menu click), so
            # they are excluded — we benchmark only click-navigable menu pages.
            if (a.get("type") == "view" and str(a.get("path", "")).startswith(PREFIXES)
                    and v.get("satisfied", True) and len(p) == 3):
                dp = "/".join(p)
                if dp not in seen:
                    seen.add(dp)
                    rows.append((dp, a["path"], v.get("title", k)))
            walk(v, p)
    walk(tree, [])
    return rows


def wait_render(page, t_start):
    """Block until #view is fully rendered; return elapsed ms, or None on timeout."""
    try:                                  # nav acknowledged (spinner shown)
        page.wait_for_function(SPINNING, timeout=3000)
    except Exception:
        pass                              # instant render — spinner flashed by
    try:
        page.wait_for_function(RENDERED, timeout=20000)
    except Exception:
        return None
    return (time.perf_counter() - t_start) * 1000.0


def nav_footstrap(page, base, dp):
    """SPA: real in-app click on the menu link (fires the theme's click handler)."""
    sel = f'a[href$="/cgi-bin/luci/{dp}"], a[href$="/{dp}"]'
    # locate the link (may be inside a collapsed section — a programmatic click
    # still bubbles to the document handler, so visibility is irrelevant)
    found = page.evaluate(
        "(sel)=>{const a=document.querySelector(sel); if(!a) return false;"
        " a.click(); return true;}", sel)
    return found


def nav_bootstrap(page, http, dp):
    page.goto(f"{http}/cgi-bin/luci/{dp}", wait_until="commit")
    return True


def run_theme(p, http, base, media, pages, runs, login):
    browser = p.chromium.launch(args=["--no-sandbox"], headless=not login["headful"])
    ctx = browser.new_context(ignore_https_errors=True)
    ctx.request.post(f"{http}/cgi-bin/luci/",
                     form={"luci_username": "root", "luci_password": login["pw"]})
    page = ctx.new_page()

    reqs = {"n": 0}
    page.on("request", lambda r: reqs.__setitem__("n", reqs["n"] + 1))

    is_foot = (media == FOOTSTRAP)
    dps = [dp for dp, _, _ in pages]

    # start on the first page (full load either way)
    page.goto(f"{http}/cgi-bin/luci/{dps[0]}", wait_until="load")
    wait_render(page, time.perf_counter())

    skipped, nolink = set(), set()

    def go(dp):
        reqs["n"] = 0
        t = time.perf_counter()
        ok = nav_footstrap(page, base, dp) if is_foot else nav_bootstrap(page, http, dp)
        if not ok:
            if dp not in nolink:
                nolink.add(dp)
                print(f"  - excl {dp}: no direct menu link (reached via tabs) — not click-navigable")
            return None, 0
        ms = wait_render(page, t)
        if ms is None and dp not in skipped:
            skipped.add(dp)
            txt = page.evaluate("(()=>{var v=document.getElementById('view');"
                                "return v?(v.querySelector('.spinning')?'<spinning>':v.innerText.slice(0,60)):'<no #view>'})()")
            print(f"  ! skip {dp}: not rendered in time (#view={txt!r})")
        return ms, reqs["n"]

    # WARM pass (unmeasured)
    for dp in dps:
        go(dp)

    # MEASURED passes
    times = {dp: [] for dp in dps}
    nreq = {dp: [] for dp in dps}
    for _ in range(runs):
        for dp in dps:
            ms, n = go(dp)
            if ms is not None:
                times[dp].append(ms)
                nreq[dp].append(n)

    browser.close()
    return times, nreq


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--ssh-host", default=os.environ.get("FOOTSTRAP_SSH", "router"))
    ap.add_argument("--runs", type=int, default=5)
    ap.add_argument("--headful", action="store_true")
    ap.add_argument("--out", default=None, help="write JSON results here")
    args = ap.parse_args()

    pw = os.environ.get("LUCI_PW")
    if not pw:
        sys.exit("set LUCI_PW env (router root password)")

    host = args.ssh_host
    ip = re.search(r"^hostname (.+)$",
                   subprocess.check_output(["ssh", "-G", host]).decode(), re.M).group(1).strip()
    http = f"http://{ip}"
    login = {"pw": pw, "headful": args.headful}

    from playwright.sync_api import sync_playwright

    orig = sh(host, "uci get luci.main.mediaurlbase") or BOOTSTRAP
    print(f"router={http} original-theme={orig} runs={args.runs}")

    results = {}
    try:
        with sync_playwright() as p:
            for media in (BOOTSTRAP, FOOTSTRAP):
                sh(host, f"uci set luci.main.mediaurlbase={media}; uci commit luci; "
                         f"rm -f /tmp/luci-indexcache*")
                # discover pages once (theme-independent), via a throwaway ctx
                b = p.chromium.launch(args=["--no-sandbox"])
                c = b.new_context(ignore_https_errors=True)
                c.request.post(f"{http}/cgi-bin/luci/",
                               form={"luci_username": "root", "luci_password": pw})
                pages = discover_pages(http, c)
                b.close()
                print(f"\n=== {media}  ({len(pages)} standard pages) ===")
                times, nreq = run_theme(p, http, media, media, pages, args.runs, login)
                results[media] = {"pages": pages, "times": times, "nreq": nreq}
    finally:
        sh(host, f"uci set luci.main.mediaurlbase={orig}; uci commit luci; rm -f /tmp/luci-indexcache*")
        print(f"\nreverted theme -> {orig}")

    # ---- report ----
    pages = results[FOOTSTRAP]["pages"]
    bt, ft = results[BOOTSTRAP]["times"], results[FOOTSTRAP]["times"]
    bn, fn = results[BOOTSTRAP]["nreq"],  results[FOOTSTRAP]["nreq"]

    def med(x): return statistics.median(x) if x else float("nan")

    print("\n" + "=" * 92)
    print(f"{'page':40s} {'bootstrap':>11s} {'footstrap':>11s} {'speedup':>8s}  {'req b/f':>9s}")
    print("-" * 92)
    tot_b = tot_f = 0.0
    ratios = []
    rows_out = []
    for dp, vp, title in pages:
        b, f = med(bt[dp]), med(ft[dp])
        if b != b or f != f:      # nan
            continue
        tot_b += b; tot_f += f
        sp = b / f if f else float("nan")
        ratios.append(sp)
        print(f"{dp:40s} {b:9.0f}ms {f:9.0f}ms {sp:7.2f}x  {med(bn[dp]):3.0f}/{med(fn[dp]):<3.0f}")
        rows_out.append({"page": dp, "view": vp, "title": title,
                         "bootstrap_ms": round(b, 1), "footstrap_ms": round(f, 1),
                         "speedup": round(sp, 2)})
    print("-" * 92)
    print(f"{'TOTAL (sum of medians)':40s} {tot_b:9.0f}ms {tot_f:9.0f}ms {tot_b/tot_f:7.2f}x")
    print(f"{'median per-page speedup':40s} {'':>11s} {'':>11s} {statistics.median(ratios):7.2f}x")
    print("=" * 92)

    if args.out:
        json.dump({"router": http, "runs": args.runs,
                   "total_bootstrap_ms": round(tot_b, 1), "total_footstrap_ms": round(tot_f, 1),
                   "total_speedup": round(tot_b / tot_f, 2),
                   "median_speedup": round(statistics.median(ratios), 2),
                   "pages": rows_out}, open(args.out, "w"), indent=2)
        print(f"wrote {args.out}")


if __name__ == "__main__":
    main()
