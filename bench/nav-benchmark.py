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
  Discovered live from /admin/menu: every node the menu can turn into a link
  (satisfied + titled) at depth >= 3, whose *resolved* target is a standard LuCI
  page. Third-party app pages are excluded by construction (see STANDARD_VIEWS).

  Three things this deliberately does NOT do, each of which used to hide pages:
    - it does not stop at depth 3. The tab leaves (Realtime x5, Logs x2,
      Administration x5, Firewall x5) are click-navigable — they are just clicked
      in #tabmenu instead of the main menu — and they are 17 of the 39 pages.
    - it does not require action.type == 'view'. A menu link can be an `alias`
      (Firewall, System Log, Realtime Graphs), a `firstchild` (Administration) or
      the overview `template`; the theme's router resolves all of them, and the
      user clicks them more than anything else. Benchmarking only `view` nodes
      measured the theme everywhere except its front door.
    - it does not filter on the view path alone: package-manager's view path has
      no module prefix at all, so a prefix filter silently dropped it.

  Excluded on purpose:
    - admin/status/channel_analysis — its time is a 5 s hardware radio scan, not
      theme work, and re-running it 12x would disrupt the router's own wifi.
    - attendedsysupgrade — it talks to sysupgrade.openwrt.org; that would time the
      internet, not the theme.

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
PROTON    = "/luci-static/proton2025"       # luci-theme-proton2025, a third-party theme

# Every theme in the run, baseline first. Only footstrap has a client router, so it
# is the only one navigated by clicking a link; the others get a real full navigation,
# which is what a click does in them anyway. Add a theme here and it joins the table —
# it must already be installed and registered in `luci.themes` on the router.
THEMES = [BOOTSTRAP, PROTON, FOOTSTRAP]
BASELINE = BOOTSTRAP

# A page counts as standard if the view it resolves to belongs to a module that
# ships with a stock OpenWrt LuCI: luci-mod-status / -system / -network (whose
# firewall views live under firewall/) and the package manager. Matching the
# resolved VIEW path, not the menu path, is what keeps a third-party app out even
# when it hangs itself under admin/system.
STANDARD_VIEWS = ("status/", "system/", "network/", "firewall/", "package-manager")
OVERVIEW_TPL   = "admin_status/index"       # the one template node that is a page
EXCLUDE_PATHS  = ("admin/status/channel_analysis",)   # radio scan — see docstring

# Tag the outgoing view's nodes; LuCI renders a view with dom.content(#view, …),
# which REPLACES the children, so "no tagged node left" == "the new page is up".
STALE = ("(()=>{const v=document.getElementById('view'); if(!v) return;"
         "for (const c of v.children) c.setAttribute('data-bench-old','');})()")

# Rendered = #view has content, nothing is spinning, and none of it is the page we
# just navigated AWAY from.
#
# The stale check is not a nicety. A SPA nav leaves the old view on screen until
# the new one renders, so a condition that only asks "does #view have children"
# is true the instant the click lands — it would time the previous page. The old
# harness papered over that by first waiting up to 3 s for a spinner to appear as
# a "nav acknowledged" gate, which broke the other way: a view whose module is
# already cached renders with no spinner frame at all, so the wait ran its full
# 3 s timeout and reported ~3017 ms for pages that were in fact the FASTEST ones.
# Eight pages were mis-timed that way. Marker in, spinner gate out.
RENDERED = (
    "(()=>{const v=document.getElementById('view');"
    "if(!v || v.children.length===0) return false;"
    "if(v.querySelector('.spinning')) return false;"
    "if(v.querySelector('[data-bench-old]')) return false;"
    "return !/Loading view/.test(v.innerText);})()"
)


def sh(host, cmd):
    return subprocess.run(["ssh", host, cmd], check=True,
                          capture_output=True, text=True).stdout.strip()


def node_weight(n):
    return min(n.get("order", 9999), 9999) + (10000 if (n.get("auth") or {}).get("login") else 0)


def first_child(node):
    """resolve_firstchild() from dispatcher.uc: eligible child of lowest weight."""
    best = best_name = None
    for name, c in (node.get("children") or {}).items():
        if not c.get("satisfied") or not c.get("title") or not isinstance(c.get("action"), dict):
            continue
        if c["action"].get("type") == "firstchild":
            if (best is None or node_weight(best) > node_weight(c)) and first_child(c):
                best, best_name = c, name
        elif not c.get("firstchild_ineligible"):
            if best is None or node_weight(best) > node_weight(c):
                best, best_name = c, name
    return (best_name, best) if best else None


def resolve(tree, segs):
    """Follow alias/firstchild to the page the dispatcher would render."""
    node = tree
    for s in segs:
        node = (node.get("children") or {}).get(s)
        if not node:
            return None
    for _ in range(8):
        a = node.get("action") or {}
        if a.get("type") == "alias":
            return resolve(tree, str(a["path"]).split("/"))
        if a.get("type") == "firstchild":
            pick = first_child(node)
            if not pick:
                return None
            node = pick[1]
            continue
        return node
    return None


def discover_pages(base, ctx):
    """Return ordered [(dispatch_path, view_path, title)] of standard pages.

    Tree order matters and is preserved: a tab leaf is only clickable once its
    section is open, and the section's own menu link (the alias/firstchild parent)
    always precedes its children in the tree — so walking in this order guarantees
    every link exists in the DOM by the time we click it.
    """
    tree = ctx.request.get(f"{base}/cgi-bin/luci/admin/menu").json()
    rows, seen = [], set()

    def walk(node, path):
        for k, v in (node.get("children") or {}).items():
            p = path + [k]
            dp = "/".join(p)
            # a link the menu can actually render: satisfied + titled (this is
            # exactly ui.menu.getChildren()'s filter). Depth < 3 is a section
            # header — a disclosure toggle in this theme, not a link.
            if v.get("satisfied") and v.get("title") and len(p) >= 3 and dp not in seen \
                    and dp not in EXCLUDE_PATHS:
                target = resolve(tree, p)
                a = (target or {}).get("action") or {}
                vp = str(a.get("path", ""))
                is_page = (a.get("type") == "view" and vp.startswith(STANDARD_VIEWS)) or \
                          (a.get("type") == "template" and vp == OVERVIEW_TPL)
                if is_page:
                    seen.add(dp)
                    rows.append((dp, vp, v["title"]))
            walk(v, p)
    walk(tree, [])
    return rows


def wait_render(page, t_start):
    """Block until #view holds the NEW page, fully rendered; ms elapsed, None on timeout."""
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
    spa = {}

    def go(dp):
        reqs["n"] = 0
        # a marker on `window` dies with a full page load and survives an in-place
        # swap: the only honest way to tell a SPA nav from a router fallback, and
        # without it a 1.0x row looks like a slow SPA instead of a full reload.
        page.evaluate("() => { window.__benchmark = 1; }")
        page.evaluate(STALE)
        t = time.perf_counter()
        ok = nav_footstrap(page, base, dp) if is_foot else nav_bootstrap(page, http, dp)
        if not ok:
            if dp not in nolink:
                nolink.add(dp)
                print(f"  - excl {dp}: no link in the DOM at this point in the walk")
            return None, 0
        ms = wait_render(page, t)
        if ms is None and dp not in skipped:
            skipped.add(dp)
            txt = page.evaluate("(()=>{var v=document.getElementById('view');"
                                "return v?(v.querySelector('.spinning')?'<spinning>':v.innerText.slice(0,60)):'<no #view>'})()")
            print(f"  ! skip {dp}: not rendered in time (#view={txt!r})")
        if is_foot:
            spa[dp] = bool(page.evaluate("() => window.__benchmark === 1"))
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
    return times, nreq, spa


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
            for media in THEMES:
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
                times, nreq, spa = run_theme(p, http, media, media, pages, args.runs, login)
                results[media] = {"pages": pages, "times": times, "nreq": nreq, "spa": spa}
    finally:
        sh(host, f"uci set luci.main.mediaurlbase={orig}; uci commit luci; rm -f /tmp/luci-indexcache*")
        print(f"\nreverted theme -> {orig}")

    # ---- report ----
    def med(x): return statistics.median(x) if x else float("nan")

    def name(media): return media.rsplit("/", 1)[-1]

    pages = results[FOOTSTRAP]["pages"]
    spa = results[FOOTSTRAP]["spa"]

    width = 42 + 13 * len(THEMES) + 24
    hdr = f"{'page':40s}" + "".join(f"{name(m):>12s}" for m in THEMES)
    hdr += f"{'speedup':>9s}{'req':>9s}{'nav':>6s}"
    print("\n" + "=" * width)
    print(hdr)
    print("-" * width)

    totals = {m: 0.0 for m in THEMES}
    ratios = []
    rows_out = []
    for dp, vp, title in pages:
        vals = {m: med(results[m]["times"][dp]) for m in THEMES}
        if any(v != v for v in vals.values()):        # nan in any theme => not comparable
            continue
        for m in THEMES:
            totals[m] += vals[m]
        sp = vals[BASELINE] / vals[FOOTSTRAP] if vals[FOOTSTRAP] else float("nan")
        ratios.append(sp)
        kind = "spa" if spa.get(dp) else "full"
        reqs = "/".join(f"{med(results[m]['nreq'][dp]):.0f}" for m in THEMES)
        print(f"{dp:40s}" + "".join(f"{vals[m]:10.0f}ms" for m in THEMES)
              + f"{sp:8.2f}x{reqs:>9s}{kind:>6s}")
        row = {"page": dp, "view": vp, "title": title,
               "speedup_vs_" + name(BASELINE): round(sp, 2), "footstrap_nav": kind}
        row.update({name(m) + "_ms": round(vals[m], 1) for m in THEMES})
        rows_out.append(row)

    print("-" * width)
    print(f"{'TOTAL (sum of medians)':40s}" + "".join(f"{totals[m]:10.0f}ms" for m in THEMES)
          + f"{totals[BASELINE] / totals[FOOTSTRAP]:8.2f}x")
    print(f"{'median per-page speedup':40s}" + " " * (12 * len(THEMES))
          + f"{statistics.median(ratios):8.2f}x")
    print(f"{'pages navigated in-place (SPA)':40s} "
          f"{sum(1 for r in rows_out if r['footstrap_nav'] == 'spa')}/{len(rows_out)}")
    print("\nvs each theme (sum of medians / median per-page):")
    for m in THEMES:
        if m == FOOTSTRAP:
            continue
        per = statistics.median([med(results[m]["times"][dp]) / med(results[FOOTSTRAP]["times"][dp])
                                 for dp, _, _ in pages
                                 if med(results[FOOTSTRAP]["times"][dp]) == med(results[FOOTSTRAP]["times"][dp])
                                 and med(results[m]["times"][dp]) == med(results[m]["times"][dp])])
        print(f"  footstrap vs {name(m):14s} {totals[m] / totals[FOOTSTRAP]:5.2f}x total, {per:5.2f}x median page")
    print("=" * width)

    if args.out:
        out = {"router": http, "runs": args.runs, "themes": [name(m) for m in THEMES],
               "baseline": name(BASELINE),
               "spa_pages": sum(1 for r in rows_out if r["footstrap_nav"] == "spa"),
               "median_speedup": round(statistics.median(ratios), 2),
               "pages": rows_out}
        out.update({"total_" + name(m) + "_ms": round(totals[m], 1) for m in THEMES})
        out["total_speedup"] = round(totals[BASELINE] / totals[FOOTSTRAP], 2)
        json.dump(out, open(args.out, "w"), indent=2)
        print(f"wrote {args.out}")


if __name__ == "__main__":
    main()
