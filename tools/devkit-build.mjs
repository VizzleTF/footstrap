/* devkit-build.mjs — assemble the self-contained luci-app developer portal.
 *
 * docs/devkit.html is GENERATED (like cascade.css) and gitignored. It is the page an external
 * luci-app-* author opens to see what to copy, which token to read and what not to do, without a
 * router and without this repo. The source of every part is a file that already exists here, so
 * nothing is hand-copied and nothing can drift:
 *
 *   - the stylesheet         ← build-css.sh (the real cascade.css, inlined)
 *   - the 26-name export tier ← styles/02-tokens.css (parsed — the ONE contract apps may read)
 *   - the component catalogue ← docs/gallery.html (the single source of real widget markup)
 *   - the chrome + prose      ← docs/devkit.src.html (authored: Start-here, Rules, Checklist)
 *
 * The DOM→E() conversion and click-to-copy happen in the BROWSER off the rendered preview node, so
 * the code a dev copies always matches what they see. Run: node tools/devkit-build.mjs
 */
import { readFile, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildCss } from './lib/gallery.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'docs/devkit.src.html');
const GALLERY = join(ROOT, 'docs/gallery.html');
const TOKENS = join(ROOT, 'luci-theme-footstrap/styles/02-tokens.css');
const OUT = join(ROOT, 'docs/devkit.html');

/* The export tier is the whole contract an app is allowed to read. Its NAMES are the source of
 * truth here — the values render live from the inlined stylesheet, so we never restate a colour.
 * Only these families are the tier; --fs-* is private and deliberately not surfaced. */
function parseExportTier(css) {
	const order = ['background', 'border', 'text', 'primary', 'success', 'warn', 'error'];
	const found = new Set();
	for (const m of css.matchAll(/--((?:background|border|text|primary|success|warn|error)-color-(?:highest|high|medium|low))\s*:/g))
		found.add(m[1]);
	for (const m of css.matchAll(/--(on-(?:primary|success|warn|error)-color)\s*:/g))
		found.add('__on__' + m[1]);
	const groups = {};
	for (const name of found) {
		if (name.startsWith('__on__')) continue;
		const fam = name.split('-color-')[0];
		(groups[fam] ||= { family: fam, levels: [], ink: null }).levels.push(name);
	}
	for (const name of found) {
		if (!name.startsWith('__on__')) continue;
		const real = name.slice('__on__'.length);          // on-primary-color → primary
		const fam = real.replace(/^on-/, '').replace(/-color$/, '');
		if (groups[fam]) groups[fam].ink = real;
	}
	const rank = { highest: 0, high: 1, medium: 2, low: 3 };
	const lvl = (n) => rank[n.split('-color-')[1]] ?? 9;
	return order.filter((f) => groups[f]).map((f) => ({
		...groups[f],
		levels: groups[f].levels.sort((a, b) => lvl(a) - lvl(b)),
	}));
}

/* Pull each <div class="g-sec"> out of the gallery. They are siblings (g-sec never nests), so a
 * split on the opening tag is exact. Strip the two things that are QA-internal, not dev-facing:
 * HTML comments and the .g-note commentary (absorption backlogs, "until it did" — noise to a
 * consumer). What is left is the widget markup ui.js/cbi.js really emit. */
function parseComponents(html) {
	const body = html.slice(html.indexOf('<div class="g-sec">'));
	return body.split('<div class="g-sec">').filter((c) => c.trim()).map((chunk) => {
		let sec = chunk.slice(0, chunk.search(/<\/div>\s*(?:<\/div>\s*<\/body>|$|<div class="g-sec">)/));
		// the h2 may not be the very first node in the "Data table" section (two h2s) — take the first
		const title = (sec.match(/<h2>([\s\S]*?)<\/h2>/) || [, ''])[1].replace(/&amp;/g, '&').trim();
		let markup = sec
			.replace(/<h2>[\s\S]*?<\/h2>/, '')
			.replace(/<!--[\s\S]*?-->/g, '')
			.replace(/<p class="g-note">[\s\S]*?<\/p>/g, '')
			.replace(/\n{3,}/g, '\n\n')
			.trim();
		return { title, markup };
	}).filter((c) => c.title && c.markup);
}

/* The page must be ONE file (opened off GitHub Pages with no sibling assets), so every url() the
 * stylesheet references — the subset fonts and the wallpaper — is inlined as a data: URI. The
 * assets live under htdocs/luci-static/footstrap/, the same paths the router serves. */
const MEDIA = join(ROOT, 'luci-theme-footstrap/htdocs/luci-static/footstrap');
const MIME = { '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.png': 'image/png' };
async function inlineAssets(cssText) {
	const refs = [...new Set([...cssText.matchAll(/url\(([^)]+)\)/g)].map((m) => m[1].replace(/["']/g, '').trim()))]
		.filter((u) => !u.startsWith('data:') && !u.startsWith('http'));
	for (const ref of refs) {
		try {
			const buf = await readFile(join(MEDIA, ref));
			const ext = ref.slice(ref.lastIndexOf('.'));
			const uri = `data:${MIME[ext] || 'application/octet-stream'};base64,${buf.toString('base64')}`;
			cssText = cssText.split(`url(${ref})`).join(`url(${uri})`)
				.split(`url("${ref}")`).join(`url("${uri}")`).split(`url('${ref}')`).join(`url('${uri}')`);
		} catch { /* an asset the devkit does not need; leave the url() as-is */ }
	}
	return cssText;
}

const [src, galleryHtml, tokensCss] = await Promise.all([
	readFile(SRC, 'utf8'), readFile(GALLERY, 'utf8'), readFile(TOKENS, 'utf8'),
]);
const css = await inlineAssets(await readFile(buildCss('devkit-cascade.css'), 'utf8'));
const tiers = parseExportTier(tokensCss);
const components = parseComponents(galleryHtml);

const data = { tiers, components };
const out = src
	.replace('/*__CASCADE__*/', () => css)
	.replace('/*__DATA__*/', () => 'window.FS_DEVKIT=' + JSON.stringify(data) + ';');

await writeFile(OUT, out);
console.log(`devkit.html: ${tiers.length} token families, ${components.length} components, ${(out.length / 1024 | 0)} KB`);
