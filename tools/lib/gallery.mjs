/* Shared harness for the two playwright gates that render docs/gallery.html:
 * tools/a11y-gallery.mjs (axe, WCAG 2.2 AA) and tools/export-tier.mjs (the outbound
 * --*-color-* contract). Nothing here ships to the router.
 *
 * WHY THIS FILE EXISTS. The two gates carried the same ~20 lines three times over: build the
 * stylesheet, serve the gallery from an ephemeral port, and stamp the Appearance axes onto
 * :root before measuring. The last of those is the one that mattered — `applyAppearance()`
 * below was a FOURTH and FIFTH copy of rules that already live in menu-footstrap-common.js
 * and in head.ut's pre-paint script, including the load-bearing one:
 *
 *     set --fs-tint-h BEFORE the data-tint attribute
 *
 * If the tint ever gains a second custom property, or the accent axis is added to the sweep,
 * a copy that nobody remembered would keep testing the OLD shape — and keep passing. A gate
 * that silently measures the wrong thing is worse than no gate. One copy.
 */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const TMP = process.env.RUNNER_TEMP || '/tmp';

/* The stylesheet is GENERATED (build-css.sh concatenates styles/). Build it — never measure
 * whatever stale copy happens to be lying around from the last run. */
export function buildCss(name = 'cascade.css') {
	const css = join(TMP, name);
	execFileSync(join(ROOT, 'luci-theme-footstrap/build-css.sh'), [css], { stdio: 'inherit' });
	return css;
}

/* Serve docs/gallery.html + the freshly-built stylesheet on an ephemeral port.
 * Returns { base, close }. */
export async function serveGallery(cssPath) {
	const FILES = {
		'/gallery.html': join(ROOT, 'docs/gallery.html'),
		'/cascade.css': cssPath,
	};
	const TYPES = { '.html': 'text/html', '.css': 'text/css' };
	const server = createServer(async (req, res) => {
		const path = req.url.split('?')[0];
		const file = FILES[path === '/' ? '/gallery.html' : path];
		if (!file) { res.writeHead(404).end(); return; }
		res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'text/plain' });
		res.end(await readFile(file));
	});
	await new Promise((r) => server.listen(0, '127.0.0.1', r));
	return {
		base: `http://127.0.0.1:${server.address().port}/gallery.html`,
		close: () => server.close(),
	};
}

/* Stamp one point of the Appearance matrix onto :root, exactly the way the theme does.
 *
 * THIS IS THE ONE COPY. It must stay in step with applyMode/applyPalette/hueAxis in
 * menu-footstrap-common.js and with head.ut's pre-paint script — if an axis changes shape,
 * change it here too, or these gates go on proving something that is no longer true.
 *
 * `tint`/`accent`: null (or 0) = off, which CLEARS the attribute and the custom property —
 * an untinted router must cost exactly the palette it already had, so "off" is not hue 0. */
export async function applyAppearance(page, { mode = 'light', palette = 'footstrap', tint = null, accent = null } = {}) {
	await page.evaluate(([m, p, t, a]) => {
		const root = document.documentElement;
		root.setAttribute('data-darkmode', m === 'dark' ? 'true' : 'false');
		if (p === 'hicontrast') root.setAttribute('data-palette', 'hicontrast');
		else root.removeAttribute('data-palette');
		/* hue axes: the custom property FIRST, then the attribute that switches the mixes on.
		 * The other order paints one frame with the previous hue — the same ordering rule the
		 * theme's own applier documents. */
		const hue = (val, attr, prop) => {
			if (!val) { root.removeAttribute(attr); root.style.removeProperty(prop); return; }
			root.style.setProperty(prop, String(val));
			root.setAttribute(attr, '');
		};
		hue(t, 'data-tint', '--fs-tint-h');
		hue(a, 'data-accent', '--fs-accent-h');
	}, [mode, palette, tint, accent]);
	await page.waitForTimeout(150);
}

/* The palette x mode grid both gates sweep. The TINT list is a PARAMETER, not shared: axe
 * runs in seconds and takes the two extremes, while export-tier walks the wheel at 60°. That
 * difference is deliberate and is argued in each caller; the scaffolding around it is not. */
export function matrix(tints = [null]) {
	return [
		{ palette: 'footstrap', mode: 'light' },
		{ palette: 'footstrap', mode: 'dark' },
		{ palette: 'hicontrast', mode: 'light' },
		{ palette: 'hicontrast', mode: 'dark' },
	].flatMap((c) => tints.map((tint) => ({ ...c, tint })));
}
