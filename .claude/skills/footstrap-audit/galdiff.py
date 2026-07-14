"""Computed-style diff of docs/gallery.html between two stylesheets.

THE INSTRUMENT THE ABSORPTION BACKLOG NEEDS, and the one cssdiff.py cannot be. cssdiff drives a
live router page, so it only ever sees widgets some page renders — and the backlog is, by
definition, about the ones no page here renders. On those, cssdiff reports 0 diffs whatever you
delete, and 0 diffs reads as "that rule was dead". It was not; nothing was looking.

The gallery renders every widget LuCI (or a third-party luci-app-*) can emit, so a base rule that
still does work shows up here as a real diff. Same DOM, same file, only the <link> swapped —
every difference is caused by CSS. Needs no router.

Two things it still cannot see, so do not read a clean run as proof for them:
  - pseudo-ELEMENTS (`.item::after` and friends) — getComputedStyle is not asked for them here;
  - pseudo-CLASSES (:hover, :focus) — nothing is hovered, so the whole focus-ring half of the
    backlog is invisible to it. That half is base doing its documented job anyway.

usage: galdiff.py <a.css> <b.css>   (run from the repo root; build both with build-css.sh)
"""
import pathlib
import shutil
import sys
import tempfile

from playwright.sync_api import sync_playwright

A, B = sys.argv[1], sys.argv[2]
GALLERY = pathlib.Path("docs/gallery.html").resolve()

PROPS = [
    "background-color", "background-image", "color", "border-top-width", "border-top-color",
    "border-bottom-width", "border-bottom-color", "border-left-color", "border-right-color",
    "border-radius", "padding", "margin", "font-family", "font-size", "font-weight",
    "line-height", "display", "width", "height", "min-width", "max-width", "text-transform",
    "box-shadow", "outline-width", "transition-property", "opacity", "flex", "gap",
    # text-align/vertical-align are the ONLY thing the .left/.right/.center/.top/.middle/.bottom
    # forcing utilities set. Leaving them out of this list made stripping those six !important
    # flags look free — the tool was blind, not the flags idle.
    "text-align", "vertical-align", "position", "z-index", "overflow", "white-space",
]

SNAP = """(props) => {
  const out = [];
  document.querySelectorAll('*').forEach((e, i) => {
    const cs = getComputedStyle(e);
    const rec = {};
    for (const p of props) rec[p] = cs.getPropertyValue(p);
    out.push([i, e.tagName + (e.className && typeof e.className === 'string' ? '.' + e.className.trim().replace(/\\s+/g, '.') : ''), rec]);
  });
  return out;
}"""

tmp = pathlib.Path(tempfile.mkdtemp())
shutil.copy(GALLERY, tmp / "gallery.html")


def snap(page, css):
    shutil.copy(css, tmp / "cascade.css")
    page.goto(f"file://{tmp}/gallery.html")
    page.wait_for_timeout(500)
    return page.evaluate(SNAP, PROPS)


with sync_playwright() as p:
    b = p.chromium.launch()
    pg = b.new_page(viewport={"width": 1280, "height": 900})
    a_snap = snap(pg, A)
    b_snap = snap(pg, B)
    b.close()

assert len(a_snap) == len(b_snap), "element count changed — not a pure CSS diff"

diffs = {}
for (i, tag, ra), (_, _, rb) in zip(a_snap, b_snap):
    for prop, va in ra.items():
        vb = rb[prop]
        if va != vb:
            diffs.setdefault((tag, prop, va, vb), 0)
            diffs[(tag, prop, va, vb)] += 1

print(f"{len(a_snap)} elements, {sum(diffs.values())} property diffs\n")
for (tag, prop, va, vb), n in sorted(diffs.items(), key=lambda kv: -kv[1]):
    print(f"  {n:3}x {tag[:44]:44} {prop:20} {va[:32]:32} -> {vb[:32]}")
