/* Automated accessibility gate — axe-core over docs/gallery.html.
 *
 * WHY THE GALLERY AND NOT THE ROUTER. LuCI renders page content client-side, so
 * auditing a real page means having a router, a session and a network. The gallery
 * is a static file that already renders EVERY widget LuCI (or any third-party
 * luci-app-*) can emit, with the real class names — so it is the whole widget
 * surface of the theme, checkable in CI with no device at all. Nothing else in the
 * LuCI theme ecosystem does this.
 *
 * It runs the full matrix — {light, dark} x {footstrap, hicontrast} — because a
 * palette switcher multiplies the contrast matrix, and colour-contrast failures are
 * exactly the kind that regress silently in the combination nobody looks at. That is
 * how the 1.69:1 white-on-green in hicontrast dark survived for as long as it did.
 *
 *   node tools/a11y-gallery.mjs
 *
 * Fails on `serious` and `critical` only. `moderate`/`minor` are printed but do not
 * fail the build: the gallery deliberately renders widgets out of any page context
 * (isolated <table>s, headings with no document outline), which trips landmark and
 * heading-order rules that say nothing about the theme.
 */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { chromium } from 'playwright';
import { AxeBuilder } from '@axe-core/playwright';

const ROOT = new URL('..', import.meta.url).pathname;
const TMP = process.env.RUNNER_TEMP || '/tmp';
const CSS = join(TMP, 'cascade.css');

/* the stylesheet is generated — build it, don't assume a stale copy is lying around */
execFileSync(join(ROOT, 'luci-theme-footstrap/build-css.sh'), [CSS], { stdio: 'inherit' });

const FILES = {
	'/gallery.html': join(ROOT, 'docs/gallery.html'),
	'/cascade.css': CSS,
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
const base = `http://127.0.0.1:${server.address().port}/gallery.html`;

/* The Tint axis re-hues every surface in the gallery, so it multiplies this matrix
 * the way the palette does — and unlike the palette it is a slider, i.e. the user
 * can land anywhere on the wheel. Two hues per combination rather than the six
 * export-tier.mjs sweeps, because an axe pass is seconds and these two are the
 * extremes that matter: at the fixed lightness the tint anchor uses, yellow carries
 * the most luminance and blue the least, so they bracket what a mix can do to the
 * contrast of text sitting on the surface. `null` = untinted. */
const TINTS = [null, 60, 260];

const MATRIX = [
	{ mode: 'light', palette: 'footstrap' },
	{ mode: 'dark', palette: 'footstrap' },
	{ mode: 'light', palette: 'hicontrast' },
	{ mode: 'dark', palette: 'hicontrast' },
].flatMap((c) => TINTS.map((tint) => ({ ...c, tint })));

const browser = await chromium.launch();
/* axe-core requires a real BrowserContext (it injects into every frame), not the
 * implicit page browser.newPage() creates. */
const ctx = await browser.newContext();
let failed = 0;

for (const { mode, palette, tint } of MATRIX) {
	const page = await ctx.newPage();
	await page.goto(base, { waitUntil: 'load' });
	await page.evaluate(([m, p, t]) => {
		const root = document.documentElement;
		root.setAttribute('data-darkmode', m === 'dark' ? 'true' : 'false');
		if (p === 'hicontrast') root.setAttribute('data-palette', 'hicontrast');
		else root.removeAttribute('data-palette');
		if (t === null) { root.removeAttribute('data-tint'); root.style.removeProperty('--fs-tint-h'); }
		else { root.style.setProperty('--fs-tint-h', String(t)); root.setAttribute('data-tint', ''); }
	}, [mode, palette, tint]);
	await page.waitForTimeout(400);   /* let the webfonts settle before measuring contrast */

	const { violations } = await new AxeBuilder({ page })
		.withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
		.analyze();

	const hard = violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
	const soft = violations.filter((v) => !hard.includes(v));

	const label = `${palette}/${mode}${tint === null ? '' : `/tint${tint}`}`;
	if (!hard.length) {
		console.log(`✔ ${label.padEnd(22)} no serious/critical violations` +
			(soft.length ? `  (${soft.length} moderate/minor, not gating)` : ''));
	} else {
		failed += hard.length;
		console.log(`✖ ${label.padEnd(22)} ${hard.length} serious/critical:`);
		for (const v of hard) {
			console.log(`    [${v.impact}] ${v.id}: ${v.help}`);
			const LIMIT = process.env.AXE_ALL ? 999 : 4;
			for (const n of v.nodes.slice(0, LIMIT))
				console.log(`      ${n.target.join(' ')}\n        ${(n.failureSummary || '').split('\n').slice(1).join(' ').trim().slice(0, 200)}`);
			if (v.nodes.length > LIMIT) console.log(`      … and ${v.nodes.length - LIMIT} more`);
		}
	}
	await page.close();
}

await ctx.close();
await browser.close();
server.close();

if (failed) {
	console.error(`\n${failed} serious/critical accessibility violation(s) — see above`);
	process.exit(1);
}
console.log(`\naxe-core: clean across all ${MATRIX.length} palette x mode x tint combinations`);
