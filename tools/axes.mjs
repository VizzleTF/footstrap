#!/usr/bin/env node
/* Every Appearance axis (dark mode, palette, wallpaper, rounding, tint, accent, rail, layout) is
 * implemented TWICE, and nothing held the copies together:
 *
 *   1. `partials/head.ut` — inline <script>s that read localStorage and stamp :root BEFORE THE
 *      FIRST PAINT, or the page flashes the wrong theme on every reload. They cannot `require` a
 *      LuCI module: the module loader does not exist yet.
 *   2. `fs-prefs.js` — the live appliers behind the Appearance popover. (The update-check control is
 *      NOT one of these: it is not pre-painted, and it lives in the optional updater package, not the
 *      theme tree this gate scans.)
 *
 * Forced duplication, like the @mirror cases — but these two can never be byte-identical (inline
 * script vs module), so mirror.mjs cannot hold them. What CAN be held is the CONTRACT: key names,
 * :root attributes, custom properties, valid ranges, the default — and the load-bearing rule:
 *
 *      set the custom property BEFORE the attribute that switches the mixes on,
 *      or a fresh load paints one frame with the previous hue.
 *
 * The contract is DERIVED FROM THE JS, not restated here a third time: read the axes out of the
 * theme's resource modules, then hold head.ut (plus the CSS token and fs-orphans' ignore list) to
 * them. Add an axis and the gate tells you what you forgot.
 *
 * The JS side is the WHOLE resources tree concatenated, deliberately: it used to name one file, and
 * an axis moved (or added) elsewhere would have left the gate quietly checking nothing. A glob
 * cannot go stale that way.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const readTree = (p) => readdirSync(join(ROOT, p), { recursive: true })
	.filter((f) => f.endsWith('.css'))
	.map((f) => read(join(p, f)))
	.join('\n');

const readJs = (p) => readdirSync(join(ROOT, p), { recursive: true })
	.filter((f) => f.endsWith('.js'))
	.map((f) => read(join(p, f)))
	.join('\n');

/* every module the theme ships — the axes live across fs-prefs.js and menu-footstrap.js */
const JS = readJs('luci-theme-footstrap/htdocs/luci-static/resources');
const HEAD = read('luci-theme-footstrap/ucode/template/themes/footstrap/partials/head.ut');
const TOKENS = read('luci-theme-footstrap/styles/02-tokens.css');
const STYLES = readTree('luci-theme-footstrap/styles');
const ORPHANS = read('tools/fs-orphans.mjs');
/* The THIRD implementation of the axes, and the one nothing held. lib/gallery.mjs stamps them onto
 * :root so a11y-gallery.mjs and export-tier.mjs can sweep the matrix — its own header calls itself
 * "THE ONE COPY" and it was the forgotten one. Renaming --fs-tint-h there left every gate at exit 0
 * while export-tier reported "28 palette x mode x tint combinations" and silently measured an
 * UNTINTED page in 21 of them: 7 distinct results presented as 28. A gate that measures the wrong
 * thing quietly is worse than no gate — which is the sentence that file opens with. */
const GALLERY = read('tools/lib/gallery.mjs');

const errors = [];
const ok = [];

/* ---- 1. every localStorage key the theme uses, taken from the JS -------------------- */
const keysIn = (src) => {
	const out = new Set();
	for (const m of src.matchAll(/(?:lsGet|lsSet|lsDel)\(\s*'(fs-[a-z-]+)'/g)) out.add(m[1]);
	for (const m of src.matchAll(/localStorage\.(?:getItem|setItem|removeItem)\(\s*'(fs-[a-z-]+)'/g)) out.add(m[1]);
	/* the accordion's remembered set keeps its key in a constant, not at the call site */
	for (const m of src.matchAll(/^const\s+\w*KEY\w*\s*=\s*'(fs-[a-z-]+)'/gm)) out.add(m[1]);
	return out;
};
/* ...plus the axes built by a FACTORY, which pass their key in as an argument — hueAxis(key, attr,
 * prop) and enumAxis(key, attr, on, off). Those have no lsGet('fs-…') call site at all (the factory
 * body reads a variable), so the scan above misses them entirely and every check below would go
 * quiet on exactly the axes it is meant to hold. Match each factory call by its literal args. */
const hueAxes = [...JS.matchAll(/hueAxis\(\s*'([^']+)'\s*,\s*'([^']+)'\s*,\s*'([^']+)'\s*\)/g)]
	.map(([, key, attr, prop]) => ({ key, attr, prop }));
const enumAxes = [...JS.matchAll(/enumAxis\(\s*'([^']+)'\s*,\s*'([^']+)'\s*,\s*'([^']+)'\s*,\s*'([^']+)'\s*\)/g)]
	.map(([, key, attr, on, off]) => ({ key, attr, on, off }));

const jsKeys = new Set([...keysIn(JS), ...hueAxes.map(a => a.key), ...enumAxes.map(a => a.key)]);
const headKeys = keysIn(HEAD);

if (!jsKeys.size) errors.push('found no fs-* localStorage keys in the theme JS — this tool is broken, not the theme');

/* A key the TEMPLATE touches but the JS does not know is a leftover: head.ut would go on
 * pre-painting a preference nothing can set or clear. */
for (const k of headKeys)
	if (!jsKeys.has(k))
		errors.push(`head.ut reads localStorage '${k}', but no theme JS ever writes it — dead pre-paint, or a typo`);

/* ---- 2. the hue axes: key, attribute, custom property, order, range ------------------ */
if (!hueAxes.length) errors.push('no hueAxis() calls found in the theme JS — did the axis helper get renamed?');

for (const { key, attr, prop } of hueAxes) {
	const where = `hue axis '${key}'`;
	if (!headKeys.has(key)) { errors.push(`${where}: head.ut never reads localStorage '${key}' — it will flash on reload`); continue; }
	const iProp = HEAD.indexOf(`setProperty('${prop}'`);
	const iAttr = HEAD.indexOf(`setAttribute('${attr}'`);
	if (iProp < 0) { errors.push(`${where}: head.ut never sets ${prop}`); continue; }
	if (iAttr < 0) { errors.push(`${where}: head.ut never sets the ${attr} attribute`); continue; }
	/* THE ordering rule, and the reason this gate exists: a one-line fix that would be made in
	 * the popover's applier and forgotten in the template, whose only symptom is a single wrong
	 * frame on reload — which nobody reports and no other test catches. */
	if (iProp > iAttr)
		errors.push(`${where}: head.ut sets the ${attr} attribute BEFORE ${prop}. The property must come `
			+ `first, or a fresh load paints one frame with the previous hue (or hue 0).`);
	/* the valid range, as the JS validates it (1..360) */
	const rangeRe = new RegExp(`getItem\\('${key}'\\)[\\s\\S]{0,200}?>=\\s*1\\s*&&[\\s\\S]{0,40}?<=\\s*360`);
	if (!rangeRe.test(HEAD))
		errors.push(`${where}: head.ut does not validate the stored hue as 1..360 the way the JS does `
			+ `(an out-of-range value would be pre-painted and then rejected by the popover)`);
	/* the gates' own stamper, held to the same axis it claims to sweep */
	if (!GALLERY.includes(`'${attr}', '${prop}'`))
		errors.push(`${where}: tools/lib/gallery.mjs does not stamp ${attr} with ${prop} — the axe and `
			+ `export-tier sweeps would go on reporting this axis in their combination count while every `
			+ `point of it measured the UNSTAMPED page, which is a pass by not looking`);
	ok.push(`hue axis ${key.padEnd(10)} -> ${attr}, ${prop}   (key, attr, property, order and range agree; swept by lib/gallery.mjs)`);
}

/* ---- 2b. the enum axes: key, attribute and the ON value ------------------------------
 *
 * A two-value axis (palette, wallpaper) stamps the ON value as the attribute's value and removes
 * the attribute for OFF — a bare :root IS the default. Both halves matter: pre-paint the attribute
 * and forget the removal and a browser that has switched the axis back off keeps the old look for
 * one frame; stamp the wrong VALUE ('dark' for 'hicontrast') and the palette block never matches at
 * all, silently, until the popover is touched. */
if (!enumAxes.length) errors.push('no enumAxis() calls found in the theme JS — did the axis helper get renamed?');

for (const { key, attr, on } of enumAxes) {
	const where = `enum axis '${key}'`;
	if (!headKeys.has(key)) { errors.push(`${where}: head.ut never reads localStorage '${key}' — it will flash on reload`); continue; }
	if (!HEAD.includes(`setAttribute('${attr}', '${on}')`)) {
		errors.push(`${where}: head.ut never stamps ${attr}='${on}' — the pre-paint and the live applier `
			+ `disagree about this axis's ON value, so a fresh load paints the default and the popover `
			+ `paints the choice`);
		continue;
	}
	if (!HEAD.includes(`removeAttribute('${attr}')`)) {
		errors.push(`${where}: head.ut never removes ${attr} — OFF is a bare :root, so without the `
			+ `removal the pre-paint can only ever turn this axis on`);
		continue;
	}
	ok.push(`enum axis ${key.padEnd(10)} -> ${attr}='${on}'   (key, attr and both directions agree)`);
}

/* ...and the converse: an axis lib/gallery.mjs stamps that the JS no longer has is a sweep of a
 * dead attribute, which also reads as "28 combinations" and measures 7. */
for (const [, attr, prop] of GALLERY.matchAll(/hue\(\w+, '([^']+)', '([^']+)'\)/g))
	if (!hueAxes.some((a) => a.attr === attr && a.prop === prop))
		errors.push(`tools/lib/gallery.mjs stamps ${attr}/${prop}, which no hueAxis() in the theme JS `
			+ `declares — the gates sweep an axis the theme does not have`);

/* ---- 3. the rounding default: JS, template and CSS token must be the same number ----- */
const jsRadius = JS.match(/const\s+FS_RADIUS_DEFAULT\s*=\s*(\d+)/);
const cssRadius = TOKENS.match(/--fs-radius-base:\s*(\d+)px/);
const headRadius = HEAD.match(/r\s*!==?\s*(\d+)/);
if (!jsRadius) errors.push('FS_RADIUS_DEFAULT not found in the theme JS (fs-prefs.js)');
else if (!cssRadius) errors.push('--fs-radius-base not found in styles/02-tokens.css');
else if (!headRadius) errors.push('head.ut no longer skips the default rounding (the `r !== <default>` test is gone)');
else if (!(jsRadius[1] === cssRadius[1] && cssRadius[1] === headRadius[1]))
	errors.push(`the rounding DEFAULT disagrees across the three places that state it: `
		+ `JS FS_RADIUS_DEFAULT=${jsRadius[1]}, CSS --fs-radius-base=${cssRadius[1]}px, head.ut r!==${headRadius[1]}. `
		+ `head.ut cannot read the CSS token (it runs before the stylesheet), so this is the only thing checking it.`);
else ok.push(`rounding default ${jsRadius[1]}px agrees in the JS, the CSS token and head.ut`);

/* ---- 3b. the dark-mode attributes: the same SET, same values, in both places -----------
 *
 * Dark mode is announced three times: `data-darkmode` (what this theme's CSS reads) plus
 * `data-theme` and `data-bs-theme` (the two dialects third-party apps sniff for). Both head.ut's
 * pre-paint and stampDark() write them; one added to one copy and forgotten in the other has a
 * symptom nobody reports — an app's dark styles are dead on a fresh load and come alive the
 * moment you touch the Appearance popover (or vice versa). Derive the set from the JS. */
const stampBody = (src, re) => (src.match(re) || [, null])[1];
const attrsIn = (body) => new Map([...(body || '').matchAll(
	/setAttribute\('([^']+)',\s*dark\s*\?\s*'([^']+)'\s*:\s*'([^']+)'/g)].map((m) => [m[1], `${m[2]}/${m[3]}`]));

const jsStamp = attrsIn(stampBody(JS, /function stampDark\([^)]*\)\s*\{([\s\S]*?)\n\}/));
const headStamp = attrsIn(stampBody(HEAD, /function set\(dark\)\s*\{([\s\S]*?)\n\t\t\t\t\}/));

if (!jsStamp.size) errors.push('no stampDark() found in the theme JS — did the dark-mode applier get renamed?');
else if (!headStamp.size) errors.push('head.ut no longer stamps the dark-mode attributes in its pre-paint set(dark)');
else {
	for (const [attr, val] of jsStamp)
		if (!headStamp.has(attr))
			errors.push(`dark mode: stampDark() sets ${attr}, head.ut does not — an app sniffing it sees the `
				+ `wrong mode until the user touches the Appearance popover`);
		else if (headStamp.get(attr) !== val)
			errors.push(`dark mode: ${attr} is '${val}' in the JS but '${headStamp.get(attr)}' in head.ut`);
	for (const attr of headStamp.keys())
		if (!jsStamp.has(attr))
			errors.push(`dark mode: head.ut pre-paints ${attr}, but stampDark() never updates it — toggling the `
				+ `mode live would leave it stating the mode the page loaded in`);
	if (!errors.length)
		ok.push(`dark mode  -> ${[...jsStamp.keys()].join(', ')}   (pre-paint and live applier stamp the same set)`);
}

/* The two compat names are OUTBOUND, like the --*-color-* export tier: apps read them, this
 * theme must not. A styles/ rule keyed off data-theme is hijackable by any app that stamps it
 * (OpenClash writes data-darkmode on :root from its own luminance sniff). */
for (const attr of ['data-theme', 'data-bs-theme'])
	if (STYLES.includes(`[${attr}`))
		errors.push(`styles/ keys a rule off [${attr}] — that name is OUTBOUND compatibility for third-party `
			+ `apps, not a theme input. The theme's own dark rules read [data-darkmode].`);

/* ---- 4. css-orphans must know every key, or a new axis breaks that gate -------------- */
for (const k of jsKeys)
	if (!ORPHANS.includes(`'${k}'`))
		errors.push(`tools/fs-orphans.mjs does not list '${k}' in IGNORE_EXACT — it looks like an fs-* CSS `
			+ `class to that tool's regex, so adding this axis makes css-orphans report a phantom dead selector`);

/* ---- report --------------------------------------------------------------------------- */
for (const line of ok) console.log('  ok   ' + line);
console.log(`  ok   ${jsKeys.size} localStorage keys, all known to css-orphans`);

if (errors.length) {
	console.error('\nFAIL: the Appearance axes have drifted between their two implementations.');
	for (const e of errors) console.error('  - ' + e);
	console.error('\nhead.ut pre-paints every axis before the first frame and fs-prefs.js');
	console.error('applies it live; the two cannot share code (the template runs before the module');
	console.error('loader exists), so this is what keeps them saying the same thing.');
	process.exit(1);
}

console.log('\naxes: the pre-paint template and the live appliers agree on every axis.');
