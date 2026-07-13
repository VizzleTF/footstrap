/* The export tier is a CONTRACT with other people's packages — this proves we keep it.
 *
 * --*-color-* is the only part of this theme anything outside it reads. On the dev
 * router alone that is luci-app-podkop, luci-app-justclash (eleven files) and stock
 * firewall.js / status/cpu.js. They were written against luci-theme-bootstrap, and
 * they read a level as `color:` about as often as they read it as `background:` —
 * counted across bootstrap's own cascade — so we owe each level three things:
 *
 *   LEGIBLE AS TEXT   every level clears WCAG AA (4.5:1) on all three of our surfaces.
 *                     Bootstrap does NOT manage this (its --primary-color-low is 3.6:1
 *                     on its own dark panel); this is what caps how wide our ramp can be.
 *   LEGIBLE AS A FILL the matching --on-*-color clears AA *on top of* each level, so a
 *                     filled chip an app builds stays readable.
 *   ACTUALLY A RAMP   high/medium/low must be visibly different colours. They were once
 *                     three aliases of ONE token and nothing caught it — a flat colour
 *                     passes every contrast threshold there is. Only this check fails on
 *                     it, which is why it exists: podkop paints "no data" with
 *                     --primary-color-low and got the same vivid accent as a live value.
 *
 *   node tools/export-tier.mjs
 *
 * Runs the whole {footstrap,hicontrast} x {light,dark} matrix, because a palette
 * switcher multiplies the matrix and the combination nobody looks at is where this rots.
 */
import { chromium } from 'playwright';
import { buildCss, serveGallery, applyAppearance, matrix } from './lib/gallery.mjs';

const AA = 4.5;

/* How far --x-color-high must sit from --x-color-low (max channel delta, 0..1) for the
 * ramp to be a ramp. Not one number, and deliberately NOT a contrast check: --background-*
 * and --border-* separate adjacent surfaces and are MEANT to be quiet (bootstrap's own
 * are 0.04 and 0.13 apart), while a family apps print text in has to show a real step. */
const MIN_SPREAD = { background: 0.02, border: 0.10, default: 0.10 };

const SURFACES = ['--fs-bg', '--fs-panel', '--fs-panel2'];
const LEVELS = ['high', 'medium', 'low'];
/* families an app paints TEXT with -> must clear AA on every surface */
const TEXT_FAMILIES = ['text', 'primary', 'error', 'success', 'warn'];
/* families used as a FILL -> their ink must clear AA on top of them */
const INKS = {
	primary: '--on-primary-color',
	error: '--on-error-color',
	success: '--on-success-color',
	warn: '--on-warn-color',
};
/* --border-* and --background-* get no contrast floor on purpose: they are surface
 * separations, not content. WCAG 1.4.11's 3:1 covers the boundary that IDENTIFIES a
 * control — here the focus ring and the input outline — not a table rule. */
const ALL_FAMILIES = [...TEXT_FAMILIES, 'background', 'border'];

/* build + serve + the Appearance-axis stamping: shared with a11y-gallery.mjs
 * (tools/lib/gallery.mjs) */
const { base, close } = await serveGallery(buildCss('cascade-export.css'));

const luminance = ([r, g, b]) => {
	const f = (u) => (u /= 255) <= 0.03928 ? u / 12.92 : ((u + 0.055) / 1.055) ** 2.4;
	return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};
const contrast = (a, b) => {
	const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
	return (hi + 0.05) / (lo + 0.05);
};
const spread = (a, b) => Math.max(...a.map((x, i) => Math.abs(x - b[i]))) / 255;

const NAMES = [
	...SURFACES,
	...ALL_FAMILIES.flatMap((f) => LEVELS.map((l) => `--${f}-color-${l}`)),
	...Object.values(INKS),
];

/* The Tint axis (Appearance → Tint) re-hues the three SURFACES every level above is
 * measured against, so it multiplies this matrix — and it is user-driven, i.e. the
 * hue nobody looked at is the one someone picks. Six hues, evenly around the wheel:
 * the tint is a mix, the mix is monotonic in hue, and 60° apart is finer than the
 * gamut boundaries that would move a result. `null` = the untinted palette. */
const TINTS = [null, 0, 60, 120, 180, 240, 300];

const MATRIX = matrix(TINTS);

const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto(base, { waitUntil: 'load' });

const failures = [];
let checks = 0;

for (const { palette, mode, tint } of MATRIX) {
	await applyAppearance(page, { mode, palette, tint });

	/* Resolve each custom property by RASTERISING it, never by parsing the computed
	 * string: a color-mix() computes to whatever space it was written in, and
	 * `oklch(L C H)` has three numbers that parse perfectly well as an rgb() triple —
	 * silently, and wrongly. That misread once scored a light token as near-black. */
	const v = await page.evaluate((names) => {
		const probe = document.createElement('div');
		document.body.appendChild(probe);
		const cv = document.createElement('canvas');
		cv.width = cv.height = 1;
		const cx = cv.getContext('2d', { willReadFrequently: true });
		const out = {};
		for (const n of names) {
			probe.style.color = '';
			probe.style.color = `var(${n})`;
			cx.clearRect(0, 0, 1, 1);
			cx.fillStyle = getComputedStyle(probe).color;
			cx.fillRect(0, 0, 1, 1);
			const d = cx.getImageData(0, 0, 1, 1).data;
			out[n] = [d[0], d[1], d[2]];
		}
		probe.remove();
		return out;
	}, NAMES);

	const where = `${palette}/${mode}${tint === null ? '' : `/tint ${tint}°`}`;

	for (const family of TEXT_FAMILIES)
		for (const level of LEVELS)
			for (const surface of SURFACES) {
				const name = `--${family}-color-${level}`;
				const ratio = contrast(v[name], v[surface]);
				checks++;
				if (ratio < AA)
					failures.push(`${where}: ${name} on ${surface} = ${ratio.toFixed(2)} (AA needs ${AA} — apps print text in it)`);
			}

	for (const [family, ink] of Object.entries(INKS))
		for (const level of LEVELS) {
			const name = `--${family}-color-${level}`;
			const ratio = contrast(v[ink], v[name]);
			checks++;
			if (ratio < AA)
				failures.push(`${where}: ${ink} on ${name} = ${ratio.toFixed(2)} (AA needs ${AA} — apps fill with it)`);
		}

	for (const family of ALL_FAMILIES) {
		const hi = v[`--${family}-color-high`];
		const lo = v[`--${family}-color-low`];
		const need = MIN_SPREAD[family] ?? MIN_SPREAD.default;
		const got = spread(hi, lo);
		checks++;
		if (got < need)
			failures.push(`${where}: --${family}-color-high and -low are ${got.toFixed(3)} apart, need ${need} ` +
				`(${hi} vs ${lo}) — the ramp is FLAT: an app asking for a gradation gets one colour three times`);
	}
}

await browser.close();
close();

if (failures.length) {
	console.error(`export tier: FAIL — ${failures.length} of ${checks} checks\n`);
	for (const f of failures) console.error(`  ${f}`);
	process.exit(1);
}
console.log(`export tier: OK — ${checks} checks across ${MATRIX.length} palette x mode x tint combinations`);
