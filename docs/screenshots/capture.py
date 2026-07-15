#!/usr/bin/env python3
"""Capture anonymized README screenshots of stock LuCI pages on the dev router.

Renders each page with luci-theme-footstrap active, scrubs every piece of per-device
data OUT OF THE LIVE DOM before the shot (IPv4/IPv6, MAC, DHCP hostnames, DUID/IAID,
Wi-Fi SSID/BSSID), then writes desktop and/or mobile PNGs. The theme is only activated
for the run and always reverted.

The scrub reads the real values FROM the page and replaces them with random,
self-consistent fakes — nothing being anonymized is written in this file, so the
script is safe to commit. The password is taken from $LUCI_PW, never hardcoded.

Usage:
  LUCI_PW=<router-root-pw> docs/screenshots/capture.py [--form desktop|mobile|both]
                                                        [--ssh-host router] [--out DIR]

Requires the project preview venv (Playwright + Chromium):
  .claude/tooling/preview-venv/bin/python docs/screenshots/capture.py ...
"""
import argparse, os, subprocess, sys, time, pathlib
from playwright.sync_api import sync_playwright

MEDIA = "/luci-static/footstrap"

FORMS = {
    # desktop uses the top-bar layout; mobile is narrow enough that the chrome
    # collapses to the phone bar on its own (data-narrow), so the layout key only
    # decides how the accordion behaves.
    "desktop": dict(w=1440, h=1000, dsf=2, layout="top"),
    "mobile":  dict(w=390,  h=844,  dsf=2, layout="sidebar"),
}

# full=True -> full-page (the dashboard, to show every card anonymized);
# full=False -> viewport crop (config/list pages, which would be endless full-page).
JOBS = [
    dict(path="admin/status/overview",        name="overview", modes=("dark", "light"), full=True),
    dict(path="admin/system/system",          name="system",   modes=("dark",),          full=False),
    dict(path="admin/system/package-manager", name="software", modes=("dark",),          full=False),
]

# Runs in the page. Collects the real values from the DOM and swaps them for random,
# per-value-consistent fakes. No original is ever written here.
SCRUB = r"""
() => {
  const R=(n)=>Math.floor(Math.random()*n);
  const HEX='0123456789abcdef';
  const hex=(n)=>Array.from({length:n},()=>HEX[R(16)]).join('');
  const cache=new Map();
  const memo=(k,f)=>{ if(!cache.has(k)) cache.set(k,f()); return cache.get(k); };

  const randMac=(o)=>memo('mac|'+o.toLowerCase(),()=>{
     const up=/[A-F]/.test(o), sep=o.includes('-')?'-':':';
     let g=['02']; for(let i=0;i<5;i++) g.push(hex(2));       // 02: = locally administered
     let s=g.join(sep); return up?s.toUpperCase():s;
  });
  const randIp4=(o)=>memo('ip4|'+o,()=>{
     const cidr=o.match(/\/\d+$/); const first=[10,192,172][R(3)];
     const b=first===192?168:first===172?(16+R(16)):R(255);
     return first+'.'+b+'.'+R(255)+'.'+(1+R(253))+(cidr?cidr[0]:'');
  });
  const randIp6=(o)=>memo('ip6|'+o,()=>o.replace(/[0-9a-f]{1,4}/gi,m=>hex(m.length)));

  const HOSTS=['galaxy-a54','pixel-8','macbook-pro','desk-pc','living-tv','ipad-mini',
               'echo-dot','robovac','nas-01','laptop-02','printer','desktop-pc','tablet','nvr-cam'];
  let hi=0;
  const randHost=(o)=>memo('host|'+o,()=>{const n=HOSTS[hi%HOSTS.length]+(hi>=HOSTS.length?('-'+hi):'');hi++;return n;});
  const SSIDS=['home-wifi','home-wifi_5g','guest-net']; let si=0;
  const randSsid=(o)=>memo('ssid|'+o,()=>SSIDS[si++%SSIDS.length]);

  const hostStrings=new Set(), ssidStrings=new Set();

  // structured pass: identify hostname / host / duid / iaid columns by header
  document.querySelectorAll('.table').forEach(t=>{
    const titles=t.querySelector('.tr.table-titles, .tr.cbi-section-table-titles');
    if(!titles) return;
    const heads=[...titles.querySelectorAll('.th, th')].map(e=>e.textContent.trim().toLowerCase());
    t.querySelectorAll('.tr:not(.table-titles):not(.cbi-section-table-titles):not(.placeholder)').forEach(row=>{
      [...row.querySelectorAll(':scope > .td, :scope > td')].forEach((c,i)=>{
        const h=heads[i]||'', txt=c.textContent.trim();
        if(!txt||txt==='-'||txt==='?') return;
        if(h==='hostname') hostStrings.add(txt);
        else if(h==='host'){ const f=txt.split(/[\s(]/)[0]; if(f&&f!=='-') hostStrings.add(f); }
        else if(h==='duid') c.textContent=memo('duid|'+txt,()=>hex(txt.length));
        else if(h.includes('iaid')){ if((/^[0-9a-f]+$/i).test(txt)) c.textContent=memo('iaid|'+txt,()=>hex(txt.length)); }
      });
    });
  });
  document.querySelectorAll('strong').forEach(s=>{
    if((/^SSID:?$/i).test(s.textContent.trim())){
      const n=s.nextSibling;
      if(n&&n.nodeType===3){ const v=n.textContent.trim(); if(v) ssidStrings.add(v); }
    }
  });

  // longest-first so a "name-suffix" host is replaced whole before "name" bites its prefix
  const hostArr=[...hostStrings].sort((a,b)=>b.length-a.length);
  const ssidArr=[...ssidStrings].sort((a,b)=>b.length-a.length);

  const walker=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT);
  const nodes=[]; while(walker.nextNode()) nodes.push(walker.currentNode);
  const MAC=/\b([0-9A-Fa-f]{2}[:-]){5}[0-9A-Fa-f]{2}\b/g;
  // lookaround keeps a 4-part PACKAGE VERSION (e.g. "ack 1.2.3.4-r1") from reading as an IP:
  // not preceded by word-char/dot, not followed by word-char/dot/hyphen.
  const IP4=/(?<![\w.])(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)(?:\/\d{1,2})?(?![\w.-])/g;
  const IP6=/[0-9a-fA-F]{0,4}(?::[0-9a-fA-F]{0,4}){2,}(?:\/\d{1,3})?/g;
  for(const n of nodes){
    let s=n.textContent;
    if(!s.trim()) continue;
    s=s.replace(MAC,m=>randMac(m));
    s=s.replace(IP6,m=> m.includes('::')? randIp6(m): m);
    s=s.replace(IP4,m=>randIp4(m));
    for(const h of hostArr){ if(h && s.includes(h)) s=s.split(h).join(randHost(h)); }
    for(const ss of ssidArr){ if(ss && s.includes(ss)) s=s.split(ss).join(randSsid(ss)); }
    if(s!==n.textContent) n.textContent=s;
  }
}
"""

def sh(host, cmd):
    return subprocess.run(["ssh", host, cmd], capture_output=True, text=True, timeout=30)

def http_base(host):
    out = subprocess.run(["ssh", "-G", host], capture_output=True, text=True, timeout=15).stdout
    h = next((l.split()[1] for l in out.splitlines() if l.startswith("hostname ")), None)
    if not h:
        sys.exit("cannot resolve router hostname from ssh -G")
    return f"http://{h}"

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--form", choices=["desktop", "mobile", "both"], default="both")
    ap.add_argument("--ssh-host", default=os.environ.get("FOOTSTRAP_SSH", "router"))
    ap.add_argument("--out", default=str(pathlib.Path(__file__).resolve().parent))
    args = ap.parse_args()

    pw = os.environ.get("LUCI_PW") or sys.exit("set LUCI_PW env (router root password)")
    user = os.environ.get("LUCI_USER", "root")
    forms = list(FORMS) if args.form == "both" else [args.form]
    base = http_base(args.ssh_host)
    outroot = pathlib.Path(args.out)

    orig = sh(args.ssh_host, "uci get luci.main.mediaurlbase").stdout.strip() or "/luci-static/bootstrap"
    print(f"router={base} original-theme={orig}")
    try:
        with sync_playwright() as p:
            b = p.chromium.launch(args=["--no-sandbox"])
            sh(args.ssh_host, f"uci set luci.main.mediaurlbase={MEDIA}; uci commit luci; rm -f /tmp/luci-indexcache*")
            for form in forms:
                cfg = FORMS[form]
                outdir = outroot / form
                outdir.mkdir(parents=True, exist_ok=True)
                for job in JOBS:
                    for mode in job["modes"]:
                        ctx = b.new_context(viewport={"width": cfg["w"], "height": cfg["h"]},
                                            device_scale_factor=cfg["dsf"], ignore_https_errors=True)
                        ctx.add_init_script(
                            f"try{{localStorage.setItem('fs-layout','{cfg['layout']}')}}catch(e){{}}"
                            f"try{{localStorage.setItem('fs-darkmode','{'true' if mode=='dark' else 'false'}')}}catch(e){{}}")
                        ctx.request.post(f"{base}/cgi-bin/luci/", form={"luci_username": user, "luci_password": pw})
                        pg = ctx.new_page()
                        pg.goto(f"{base}/cgi-bin/luci/{job['path']}", wait_until="networkidle")
                        try:
                            pg.wait_for_selector("#view .cbi-section, #view .table", timeout=9000)
                        except Exception:
                            pass
                        time.sleep(3.0)
                        pg.evaluate(SCRUB)
                        time.sleep(0.4)
                        fp = outdir / f"{job['name']}-{mode}.png"
                        pg.screenshot(path=str(fp), full_page=job["full"])
                        print("saved", fp)
                        ctx.close()
            b.close()
    finally:
        sh(args.ssh_host, f"uci set luci.main.mediaurlbase={orig}; uci commit luci; rm -f /tmp/luci-indexcache*")
        print("reverted theme ->", orig)

if __name__ == "__main__":
    main()
