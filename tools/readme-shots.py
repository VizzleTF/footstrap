#!/usr/bin/env python3
"""README proof shots: overview with the cats wallpaper, sidebar and top layout, dark.

The dev box is a WSL container, so its overview leaks an i5, 15.5 GiB of RAM, a 1 TB disk
and a 10 GbE port. Polling is stopped and the values are replaced with the ones a real
OpenWrt router reports (taken from a Netcore N60 Pro on 25.12.2 — model/arch/kernel/RAM/
flash only, nothing identifying).
"""
import os, subprocess, time, pathlib

SSH = os.environ.get("FOOTSTRAP_SSH", "router2512")
OUT = pathlib.Path(os.environ.get("FOOTSTRAP_OUT", "/tmp/claude-1000/readme-shots"))
PW = os.environ["LUCI_PW"]

SYSTEM = {
    "Hostname": "OpenWrt",
    "Model": "Netcore N60 Pro",
    "Architecture": "ARMv8 Processor rev 4",
    "Target Platform": "mediatek/filogic",
    "Firmware Version": "OpenWrt 25.12.2 r32802-f505120278 / LuCI 25.12.2",
    "Kernel Version": "6.12.74",
    "Uptime": "22d 22h 51m 40s",
    "Load Average": "0.14, 0.10, 0.09",
}
MEMORY = {
    "Total Available": ("267.47 MiB / 484.06 MiB (55%)", 55),
    "Used": ("145.28 MiB / 484.06 MiB (30%)", 30),
    "Buffered": ("4.00 KiB / 484.06 MiB (0%)", 0),
    "Cached": ("161.70 MiB / 484.06 MiB (33%)", 33),
}
STORAGE = {
    "Disk space": ("46.80 MiB / 84.20 MiB (59%)", 59),
    "Temp space": ("1.34 MiB / 242.03 MiB (1%)", 1),
}
PORTS = [
    ("wan",  "2.5 GbE", True,  "▲ 1.94 GiB", "▼ 12.7 GiB"),
    ("lan1", "1 GbE",   True,  "▲ 812.4 MiB", "▼ 9.28 GiB"),
    ("lan2", "1 GbE",   True,  "▲ 44.1 MiB",  "▼ 128.6 MiB"),
    ("lan3", "-",       False, "▲ 0 B",       "▼ 0 B"),
]

PATCH = """
(data) => {
  if (window.L && L.Poll && L.Poll.stop) L.Poll.stop();

  const sectionOf = (t) => [...document.querySelectorAll('#view h3')]
    .filter(h => h.textContent.trim().replace(/Hide$/, '').trim() === t)
    .map(h => h.closest('.cbi-section'))[0];

  const rows = (sec) => [...sec.querySelectorAll('table.table tr.tr')];
  const labelOf = (tr) => tr.querySelector('td').textContent.trim();

  /* System: plain label/value cells */
  const sys = sectionOf('System');
  rows(sys).forEach(tr => {
    const v = data.system[labelOf(tr)];
    if (v !== undefined) tr.querySelectorAll('td')[1].textContent = v;
  });

  /* Memory + Storage: a title on .cbi-progressbar plus the inner bar width. Rows the
     router does not have (swap, the container's four host mounts) are dropped. */
  const bars = (title, map) => {
    const sec = sectionOf(title);
    if (!sec) return;
    rows(sec).forEach(tr => {
      const hit = map[labelOf(tr)];
      if (!hit) { tr.remove(); return; }
      const pb = tr.querySelector('.cbi-progressbar');
      pb.setAttribute('title', hit[0]);
      pb.firstElementChild.style.width = hit[1] + '%';
    });
  };
  bars('Memory', data.memory);
  bars('Storage', data.storage);

  /* Port status: one eth0 on the container, four ports on the router. Clone the tile. */
  const ports = sectionOf('Port status');
  if (ports) {
    const grid = ports.querySelector('div[style*="grid"]');
    const tpl = grid.querySelector('.ifacebox');
    grid.innerHTML = '';
    data.ports.forEach(([name, speed, up, tx, rx]) => {
      const box = tpl.cloneNode(true);
      box.querySelector('.ifacebox-head').textContent = name;
      box.querySelector('.ifacebox-body img').src =
        '/luci-static/resources/icons/port_' + (up ? 'up' : 'down') + '.svg';
      const sp = box.querySelector('.ifacebox-body span');
      sp.textContent = speed;
      sp.setAttribute('title', up ? 'Speed: ' + speed : 'no link');
      const zb = box.querySelector('.zonebadge');
      if (zb) zb.style.setProperty('--zone-color-rgb', up ? '144, 240, 144' : '160, 160, 160');
      const traffic = box.querySelectorAll('.ifacebox-body')[1].querySelector('.cbi-tooltip-container');
      traffic.innerHTML = tx + '<br>' + rx;
      grid.appendChild(box);
    });
  }

  /* stopping the poll flips the indicator to "Paused" — the shot must show the live state */
  [...document.querySelectorAll('[data-indicator="poll-status"], #indicators *')]
    .filter(e => e.children.length === 0 && e.textContent.trim() === 'Paused')
    .forEach(e => (e.textContent = 'Refreshing'));

  /* The container's WAN sits on the docker bridge. Walk TEXT NODES, not elements: the
     upstream block is one div holding `Protocol:…<br>Address:…`, so every line there has
     element children and an element-level filter never sees it. */
  const walk = document.createTreeWalker(document.getElementById('view'), NodeFilter.SHOW_TEXT);
  const hits = [];
  while (walk.nextNode()) if (/172\\.31\\./.test(walk.currentNode.nodeValue)) hits.push(walk.currentNode);
  hits.forEach(n => (n.nodeValue = n.nodeValue
    .replace(/172\\.31\\.0\\.2/g, '192.168.100.24')
    .replace(/172\\.31\\.\\d+\\.\\d+/g, '192.168.100.1')));

  /* the chrome carries the hostname too */
  document.querySelectorAll('.fs-brand-name, .fs-wordmark, #fs-brand-name').forEach(
    e => (e.textContent = data.system.Hostname));
  [...document.querySelectorAll('.fs-sidebar *, header *')]
    .filter(e => e.children.length === 0 && /OpenWrt-25-12/.test(e.textContent))
    .forEach(e => (e.textContent = e.textContent.replace(/OpenWrt-25-12/g, data.system.Hostname)));
  document.title = document.title.replace(/OpenWrt-25-12/g, data.system.Hostname);
}
"""

def sh(cmd):
    return subprocess.run(["ssh", SSH, cmd], capture_output=True, text=True, timeout=30)

host = next(l.split()[1] for l in subprocess.run(["ssh", "-G", SSH], capture_output=True, text=True).stdout.splitlines() if l.startswith("hostname "))
base = f"http://{host}"
OUT.mkdir(parents=True, exist_ok=True)

from playwright.sync_api import sync_playwright

data = {"system": SYSTEM, "memory": MEMORY, "storage": STORAGE, "ports": PORTS}
orig = sh("uci get luci.main.mediaurlbase").stdout.strip() or "/luci-static/bootstrap"
try:
    sh("uci set luci.main.mediaurlbase=/luci-static/footstrap; uci commit luci; rm -f /tmp/luci-indexcache*")
    with sync_playwright() as p:
        b = p.chromium.launch(args=["--no-sandbox"])
        for layout, w, h, click in (("sidebar", 1400, 770, None), ("top", 1400, 770, None),
                                    ("phone", 390, 844, "#topmenu > li:nth-child(5) > a")):
            ctx = b.new_context(viewport={"width": w, "height": h}, device_scale_factor=2)
            # 'phone' is not a layout: it is the sidebar layout at 390px, where the chrome
            # becomes a bar and a section opens as a popup on tap.
            ctx.add_init_script(
                "try{localStorage.setItem('fs-layout','%s');"
                "localStorage.setItem('fs-darkmode','true');"
                "localStorage.setItem('fs-wallpaper','cats');"
                "}catch(e){}" % ("sidebar" if layout == "phone" else layout))
            ctx.request.post(f"{base}/cgi-bin/luci/", form={"luci_username": "root", "luci_password": PW})
            page = ctx.new_page()
            page.goto(f"{base}/cgi-bin/luci/admin/status/overview", wait_until="networkidle")
            page.wait_for_selector("#view table.table", timeout=8000)
            time.sleep(2.0)
            page.evaluate(PATCH, data)
            time.sleep(0.4)
            if click:
                page.click(click)
                time.sleep(0.5)
            fp = OUT / f"overview-{layout}-dark.png"
            page.screenshot(path=str(fp))
            print("saved", fp)
            ctx.close()
        b.close()
finally:
    sh(f"uci set luci.main.mediaurlbase={orig}; uci commit luci; rm -f /tmp/luci-indexcache*")
    print("reverted", orig)
