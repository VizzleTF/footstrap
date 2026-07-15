/* Shared harness for the two playwright gates that render docs/gallery.html: a11y-gallery.mjs
 * (axe, WCAG 2.2 AA) and export-tier.mjs (the outbound --*-color-* contract). Nothing here ships.
 *
 * Both gates repeated the same ~20 lines (build the stylesheet, serve the gallery on an ephemeral
 * port, stamp the Appearance axes onto :root). The stamping is what mattered: each gate's
 * `applyAppearance()` was one more copy of rules that already live in fs-prefs.js
 * and head.ut's pre-paint script — including the load-bearing one:
 *
 *     set --fs-tint-h BEFORE the data-tint attribute
 *
 * If the tint gains a second custom property, or accent joins the sweep, a forgotten copy goes on
 * testing the OLD shape and passing. A gate that silently measures the wrong thing is worse than
 * no gate. One copy.
 */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const TMP = process.env.RUNNER_TEMP || '/tmp';

/* The stylesheet is GENERATED (build-css.sh concatenates styles/). Build it — never measure a
 * stale copy left over from the last run. */
export function buildCss(name = 'cascade.css') {
	const css = join(TMP, name);
	execFileSync(join(ROOT, 'luci-theme-footstrap/build-css.sh'), [css], { stdio: 'inherit' });
	return css;
}

/* Serve docs/gallery.html + the freshly-built stylesheet on an ephemeral port. */
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
 * THE ONE COPY. It must stay in step with applyMode/applyPalette/hueAxis in
 * fs-prefs.js and head.ut's pre-paint script — if an axis changes shape, change it
 * here too, or these gates go on proving something that is no longer true.
 *
 * `tint`/`accent`: null (or 0) = off, which CLEARS both attribute and custom property. An
 * untinted router must cost exactly the palette it already had, so "off" is not hue 0. */
export async function applyAppearance(page, { mode = 'light', palette = 'footstrap', tint = null, accent = null } = {}) {
	await page.evaluate(([m, p, t, a]) => {
		const root = document.documentElement;
		root.setAttribute('data-darkmode', m === 'dark' ? 'true' : 'false');
		if (p === 'hicontrast') root.setAttribute('data-palette', 'hicontrast');
		else root.removeAttribute('data-palette');
		/* hue axes: the custom property FIRST, then the attribute that switches the mixes on.
		 * The other order paints one frame with the previous hue — the theme's own ordering rule. */
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

/* The palette x mode grid both gates sweep. The TINT list is a PARAMETER, not shared: axe takes
 * the two extremes, export-tier walks the wheel at 60°. That difference is deliberate and argued
 * in each caller; the scaffolding around it is not. */
export function matrix(tints = [null]) {
	return [
		{ palette: 'footstrap', mode: 'light' },
		{ palette: 'footstrap', mode: 'dark' },
		{ palette: 'hicontrast', mode: 'light' },
		{ palette: 'hicontrast', mode: 'dark' },
	].flatMap((c) => tints.map((tint) => ({ ...c, tint })));
}
