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
import { chromium } from 'playwright';
import { AxeBuilder } from '@axe-core/playwright';
import { buildCss, serveGallery, applyAppearance, matrix } from './lib/gallery.mjs';

/* build + serve: shared with export-tier.mjs, including the rules for stamping the
 * Appearance axes onto :root (tools/lib/gallery.mjs) */
const { base, close } = await serveGallery(buildCss('cascade.css'));

/* The Tint axis re-hues every surface in the gallery, so it multiplies this matrix
 * the way the palette does — and unlike the palette it is a slider, i.e. the user
 * can land anywhere on the wheel. Two hues per combination rather than the six
 * export-tier.mjs sweeps, because an axe pass is seconds and these two are the
 * extremes that matter: at the fixed lightness the tint anchor uses, yellow carries
 * the most luminance and blue the least, so they bracket what a mix can do to the
 * contrast of text sitting on the surface. `null` = untinted. */
const TINTS = [null, 60, 260];

const MATRIX = matrix(TINTS);

const browser = await chromium.launch();
/* axe-core requires a real BrowserContext (it injects into every frame), not the
 * implicit page browser.newPage() creates. */
const ctx = await browser.newContext();
let failed = 0;

for (const { mode, palette, tint } of MATRIX) {
	const page = await ctx.newPage();
	await page.goto(base, { waitUntil: 'load' });
	await applyAppearance(page, { mode, palette, tint });
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
close();

if (failed) {
	console.error(`\n${failed} serious/critical accessibility violation(s) — see above`);
	process.exit(1);
}
console.log(`\naxe-core: clean across all ${MATRIX.length} palette x mode x tint combinations`);
