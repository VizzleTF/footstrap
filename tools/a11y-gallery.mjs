/* Accessibility gate — axe-core (WCAG 2.2 AA) over docs/gallery.html.
 *
 * THE GALLERY, NOT THE ROUTER: LuCI renders content client-side, so auditing a real page needs a
 * router, a session and a network. The gallery is a static file rendering EVERY widget LuCI (or
 * any third-party luci-app-*) can emit, with the real class names — the theme's whole widget
 * surface, checkable in CI with no device. The full {light,dark} x {footstrap,hicontrast} matrix,
 * because a palette switcher multiplies the contrast matrix and colour failures regress silently
 * in the combination nobody looks at: that is how the 1.69:1 white-on-green in hicontrast dark
 * survived as long as it did.
 *
 * Fails on `serious`/`critical` only. `moderate`/`minor` print but do not gate: the gallery
 * renders widgets out of any page context (isolated <table>s, headings with no document outline),
 * tripping landmark and heading-order rules that say nothing about the theme.
 *
 *   node tools/a11y-gallery.mjs
 */
import { chromium } from 'playwright';
import { AxeBuilder } from '@axe-core/playwright';
import { buildCss, serveGallery, applyAppearance, matrix } from './lib/gallery.mjs';

/* build + serve + Appearance-axis stamping: shared with export-tier.mjs (tools/lib/gallery.mjs) */
const { base, close } = await serveGallery(buildCss('cascade.css'));

/* The Tint axis re-hues every surface, so it multiplies this matrix like the palette does — and
 * unlike the palette it is a slider: the user can land anywhere on the wheel. Two hues, not the
 * six export-tier.mjs sweeps, because these are the extremes that matter: at the tint anchor's
 * fixed lightness, yellow carries the most luminance and blue the least, so they bracket what a
 * mix can do to the contrast of text on the surface. `null` = untinted. */
const TINTS = [null, 60, 260];

const MATRIX = matrix(TINTS);

const browser = await chromium.launch();
/* axe-core needs a real BrowserContext (it injects into every frame), not the implicit page
 * browser.newPage() creates. */
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
