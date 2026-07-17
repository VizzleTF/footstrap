#!/usr/bin/env python3
"""Compare computed styles of every element under two stylesheets.

Screenshots cannot verify a CSS change on a live router: the page's own counters
(uptime, DHCP leases, wifi signal) move 0.5-1.3% of the pixels between two runs of the
SAME stylesheet, while a real regression can be 0.19% — the signal sits under the noise.

So: load the page ONCE, snapshot getComputedStyle for a fixed property set on every
element (keyed by a stable DOM path), swap the theme <link> to the second stylesheet,
snapshot again, diff. Same DOM, same live data, so every difference is caused by CSS.

Both stylesheets must already be on the router under /www/luci-static/footstrap/.
"""
import os, sys, subprocess, time, json, argparse, collections

PROPS = ["display","position","top","right","bottom","left","z-index",
         "width","height","min-width","max-width","min-height",
         "margin-top","margin-right","margin-bottom","margin-left",
         "padding-top","padding-right","padding-bottom","padding-left",
         "border-top-width","border-right-width","border-bottom-width","border-left-width",
         "border-top-color","border-bottom-color","border-radius",
         "background-color","background-image","color","box-shadow","opacity",
         "font-family","font-size","font-weight","line-height","text-align",
         "white-space","overflow-x","overflow-y","flex-direction","flex-wrap",
         "align-items","justify-content","gap","grid-template-columns","order",
         "text-transform","letter-spacing","visibility",
         # Motion and masks. Added because their absence made this tool LIE BY OMISSION: the
         # refresh glyph's 19px->18px unification and the animation durations snapping onto the
         # --fs-dur* scale both reported "0 property diffs" — the tool could not see either the
         # regression it was asked about or the change it was asked to confirm. That is the
         # failure CLAUDE.md names: a clean diff is only as honest as the property list behind it.
         "animation-duration","animation-timing-function","animation-name",
         "transition-duration","transition-property",
         "mask-size","mask-image","-webkit-mask-size","-webkit-mask-image",
         # Wrapping, and `direction` — which is here to be BORING. text-align: right -> end is a
         # value-string change the tool reports as a diff while rendering is untouched, but that
         # equivalence holds only while direction is ltr, and nothing in openwrt/luci sets dir=rtl
         # (checked: zero hits repo-wide). Snapshotting it turns "end == right here" from an
         # assumption into a reading. text-wrap likewise: its absence made a `pretty` change
         # invisible, which is this list's documented failure mode one line up.
         "direction","text-wrap","overflow-wrap","word-break"]

SNAP = """(props) => {
  const path = (el) => {
    const parts = [];
    while (el && el.nodeType === 1 && parts.length < 40) {
      const p = el.parentElement;
      const i = p ? Array.prototype.indexOf.call(p.children, el) : 0;
      parts.unshift(el.tagName.toLowerCase() + ':' + i);
      el = p;
    }
    return parts.join('/');
  };
  const out = {};
  for (const el of document.querySelectorAll('*')) {
    if (el.closest('head')) continue;
    const cs = getComputedStyle(el);
    const v = {};
    for (const p of props) v[p] = cs.getPropertyValue(p);
    out[path(el)] = { cls: el.className && el.className.baseVal !== undefined
                             ? el.className.baseVal : (el.className || ''),
                      tag: el.tagName.toLowerCase(), v };
  }
  return out;
}"""

SWAP = """(href) => new Promise((res) => {
  const l = document.querySelector('link[rel=stylesheet][href*=cascade]');
  const n = l.cloneNode();
  n.href = href;
  n.onload = () => {
    l.remove();
    // Swapping the <link> restarts font matching (both sheets declare the same
    // @font-face rules). Snapshotting before the webfont is ready measures fallback
    // metrics — every width shifts a pixel or two and drowns the real diff.
    document.fonts.ready.then(() =>
      requestAnimationFrame(() => requestAnimationFrame(res)));
  };
  l.parentNode.insertBefore(n, l.nextSibling);
})"""

FONTS_READY = "() => document.fonts.ready.then(() => true)"

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("pages", nargs="+")
    ap.add_argument("--a", default="cascade-a.css", help="baseline css filename under /luci-static/footstrap/")
    ap.add_argument("--b", default="cascade-b.css", help="candidate css filename")
    ap.add_argument("--layout", default="/luci-static/footstrap")
    ap.add_argument("--mode", default="dark")
    ap.add_argument("--ssh-host", default="router")
    # Behaviour is a FUNCTION of width, and a diff taken only at 1440 never enters the
    # narrow states: the overview grid (@container fs-view 800), the config table's card
    # (@container fs-content 960 — which in the sidebar layout can fire on a 1200px DESKTOP,
    # the column being viewport-224-56), and the data tables (MEASURED, not a container
    # query: .fs-stacked / fs-select.js — they can card at any width). Touch any of those,
    # re-run inside each band.
    ap.add_argument("--width", type=int, default=1440)
    ap.add_argument("--height", type=int, default=900)
    ap.add_argument("--ls", action="append", default=[], metavar="KEY=VALUE",
                    help="extra localStorage entry set before load (e.g. --ls fs-layout=top)")
    args = ap.parse_args()

    pw = os.environ["LUCI_PW"]
    out = subprocess.run(["ssh","-G",args.ssh_host],capture_output=True,text=True).stdout
    host = next(l.split()[1] for l in out.splitlines() if l.startswith("hostname "))
    base = f"http://{host}"

    def sh(c): return subprocess.run(["ssh",args.ssh_host,c],capture_output=True,text=True)
    # This script SWITCHES the router's active theme and restores it in a finally block, so
    # `orig` is all that stands between a dev router and a broken UI. A failed ssh (or an
    # unset key) used to leave it the EMPTY STRING, and finally then ran
    # `uci set luci.main.mediaurlbase=`, blanking theme selection. Refuse to start rather
    # than restore a value we never read.
    orig = sh("uci get luci.main.mediaurlbase").stdout.strip()
    if not orig:
        sys.exit("cannot read luci.main.mediaurlbase from the router — refusing to switch the "
                 "theme, because the value needed to switch it back could not be read")

    from playwright.sync_api import sync_playwright
    total = collections.Counter()
    try:
        sh(f"uci set luci.main.mediaurlbase={args.layout}; uci commit luci; rm -f /tmp/luci-indexcache*")
        with sync_playwright() as p:
            br = p.chromium.launch(args=["--no-sandbox"])
            ctx = br.new_context(viewport={"width":args.width,"height":args.height})
            _extra = "".join(f"try{{localStorage.setItem('{k}','{v}')}}catch(e){{}}"
                             for k, _, v in (e.partition("=") for e in args.ls))
            ctx.add_init_script(
                f"try{{localStorage.setItem('fs-darkmode','{'true' if args.mode=='dark' else 'false'}')}}catch(e){{}}{_extra}")
            ctx.request.post(f"{base}/cgi-bin/luci/", form={"luci_username":"root","luci_password":pw})
            page = ctx.new_page()
            for path in args.pages:
                page.goto(f"{base}/cgi-bin/luci/{path}", wait_until="networkidle")
                try: page.wait_for_selector("#view .cbi-section, #view .table", timeout=6000)
                except Exception: pass
                time.sleep(1.2)
                page.evaluate(FONTS_READY)
                # force stylesheet A first, so both snapshots come from a link we control
                page.evaluate(SWAP, f"/luci-static/footstrap/{args.a}")
                time.sleep(0.4)
                sa = page.evaluate(SNAP, PROPS)
                page.evaluate(SWAP, f"/luci-static/footstrap/{args.b}")
                time.sleep(0.4)
                sb = page.evaluate(SNAP, PROPS)

                diffs = []
                for k, ea in sa.items():
                    eb = sb.get(k)
                    if not eb: continue
                    for prop, va in ea["v"].items():
                        vb = eb["v"][prop]
                        if va != vb:
                            diffs.append((ea["tag"], str(ea["cls"])[:60], prop, va, vb))
                print(f"\n=== {path}: {len(sa)} elements, {len(diffs)} property diffs ===")
                agg = collections.Counter((d[0], d[1], d[2]) for d in diffs)
                for (tag, cls, prop), n in agg.most_common(25):
                    ex = next(d for d in diffs if (d[0],d[1],d[2])==(tag,cls,prop))
                    print(f"  {n:3d}x {tag}.{cls[:38]:38s} {prop:22s} {ex[3][:28]:28s} -> {ex[4][:28]}")
                    total[prop]+=n
            br.close()
    finally:
        sh(f"uci set luci.main.mediaurlbase={orig}; uci commit luci; rm -f /tmp/luci-indexcache*")
    print("\nproperties affected overall:", dict(total))

if __name__ == "__main__":
    main()
