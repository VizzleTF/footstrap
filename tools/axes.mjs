#!/usr/bin/env node
/* The Appearance axes exist TWICE, in two languages, and nothing held them together.
 *
 * WHY THERE ARE TWO COPIES AT ALL — and why they cannot simply be merged.
 * Every axis (dark mode, palette, wallpaper, rounding, tint, accent, the icon rail, the
 * layout) is applied in two places:
 *
 *   1. `partials/head.ut` — four inline <script> blocks that read localStorage and stamp
 *      :root BEFORE THE FIRST PAINT. They must be inline and they must run before any module
 *      loads, or the page flashes the wrong theme on every reload. They cannot `require` a
 *      LuCI module, because the module loader does not exist yet.
 *   2. `menu-footstrap-common.js` — the live appliers behind the Appearance popover.
 *
 * So the duplication is forced, like the @mirror cases. But unlike those, the two copies are
 * not byte-identical and never can be (one is ES5-ish inline script, the other a module), so
 * mirror.mjs cannot hold them. What CAN be held is the CONTRACT they share: the localStorage
 * key names, the :root attributes, the custom properties, the valid ranges, the default — and
 * the one rule that is load-bearing and easy to fix in only one place:
 *
 *      set the custom property BEFORE the attribute that switches the mixes on,
 *      or a fresh load paints one frame with the previous hue.
 *
 * THE CONTRACT IS DERIVED FROM THE JS, not written out here a third time. This tool reads the
 * axes out of menu-footstrap-common.js and then checks head.ut (and the CSS token, and
 * fs-orphans' ignore list) against them. Add an axis and the gate tells you what you forgot.
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

const COMMON = read('luci-theme-footstrap/htdocs/luci-static/resources/menu-footstrap-common.js');
const MENU = read('luci-theme-footstrap/htdocs/luci-static/resources/menu-footstrap.js');
const HEAD = read('luci-theme-footstrap/ucode/template/themes/footstrap/partials/head.ut');
const TOKENS = read('luci-theme-footstrap/styles/02-tokens.css');
const STYLES = readTree('luci-theme-footstrap/styles');
const ORPHANS = read('tools/fs-orphans.mjs');

const errors = [];
const ok = [];

/* ---- 1. every localStorage key the theme uses, taken from the JS -------------------- */
const keysIn = (src) => {
	const out = new Set();
	for (const m of src.matchAll(/(?:lsGet|lsSet|lsDel)\(\s*'(fs-[a-z-]+)'/g)) out.add(m[1]);
	for (const m of src.matchAll(/localStorage\.(?:getItem|setItem|removeItem)\(\s*'(fs-[a-z-]+)'/g)) out.add(m[1]);
	/* the accordion's remembered set keeps its key in a constant */
	for (const m of src.matchAll(/^const\s+\w*KEY\w*\s*=\s*'(fs-[a-z-]+)'/gm)) out.add(m[1]);
	return out;
};
/* ...plus the keys that are no longer written as literals at the call site: the hue axes pass
 * theirs INTO hueAxis(key, attr, prop), so a naive lsGet('fs-…') scan misses them entirely. */
const hueAxes = [...COMMON.matchAll(/hueAxis\(\s*'([^']+)'\s*,\s*'([^']+)'\s*,\s*'([^']+)'\s*\)/g)]
	.map(([, key, attr, prop]) => ({ key, attr, prop }));

const jsKeys = new Set([...keysIn(COMMON), ...keysIn(MENU), ...hueAxes.map(a => a.key)]);
const headKeys = keysIn(HEAD);

if (!jsKeys.size) errors.push('found no fs-* localStorage keys in the theme JS — this tool is broken, not the theme');

/* A key the TEMPLATE touches that the JS does not know is a leftover: head.ut would keep
 * pre-painting a preference nothing can ever set or clear again. */
for (const k of headKeys)
	if (!jsKeys.has(k))
		errors.push(`head.ut reads localStorage '${k}', but no theme JS ever writes it — dead pre-paint, or a typo`);

/* ---- 2. the hue axes: key, attribute, custom property, order, range ------------------ */
if (!hueAxes.length) errors.push('no hueAxis() calls found in menu-footstrap-common.js — did the axis helper get renamed?');

for (const { key, attr, prop } of hueAxes) {
	const where = `hue axis '${key}'`;
	if (!headKeys.has(key)) { errors.push(`${where}: head.ut never reads localStorage '${key}' — it will flash on reload`); continue; }
	const iProp = HEAD.indexOf(`setProperty('${prop}'`);
	const iAttr = HEAD.indexOf(`setAttribute('${attr}'`);
	if (iProp < 0) { errors.push(`${where}: head.ut never sets ${prop}`); continue; }
	if (iAttr < 0) { errors.push(`${where}: head.ut never sets the ${attr} attribute`); continue; }
	/* THE ordering rule. It is the reason this gate exists: it is a one-line fix that would be
	 * made in the popover's applier and forgotten in the template, and the only symptom is a
	 * single wrong frame on a reload — which nobody reports and no test catches. */
	if (iProp > iAttr)
		errors.push(`${where}: head.ut sets the ${attr} attribute BEFORE ${prop}. The property must come `
			+ `first, or a fresh load paints one frame with the previous hue (or hue 0).`);
	/* the valid range, as the JS validates it (1..360) */
	const rangeRe = new RegExp(`getItem\\('${key}'\\)[\\s\\S]{0,200}?>=\\s*1\\s*&&[\\s\\S]{0,40}?<=\\s*360`);
	if (!rangeRe.test(HEAD))
		errors.push(`${where}: head.ut does not validate the stored hue as 1..360 the way the JS does `
			+ `(an out-of-range value would be pre-painted and then rejected by the popover)`);
	ok.push(`hue axis ${key.padEnd(10)} -> ${attr}, ${prop}   (key, attr, property, order and range agree)`);
}

/* ---- 3. the rounding default: JS, template and CSS token must be the same number ----- */
const jsRadius = COMMON.match(/const\s+FS_RADIUS_DEFAULT\s*=\s*(\d+)/);
const cssRadius = TOKENS.match(/--fs-radius-base:\s*(\d+)px/);
const headRadius = HEAD.match(/r\s*!==?\s*(\d+)/);
if (!jsRadius) errors.push('FS_RADIUS_DEFAULT not found in menu-footstrap-common.js');
else if (!cssRadius) errors.push('--fs-radius-base not found in styles/02-tokens.css');
else if (!headRadius) errors.push('head.ut no longer skips the default rounding (the `r !== <default>` test is gone)');
else if (!(jsRadius[1] === cssRadius[1] && cssRadius[1] === headRadius[1]))
	errors.push(`the rounding DEFAULT disagrees across the three places that state it: `
		+ `JS FS_RADIUS_DEFAULT=${jsRadius[1]}, CSS --fs-radius-base=${cssRadius[1]}px, head.ut r!==${headRadius[1]}. `
		+ `head.ut cannot read the CSS token (it runs before the stylesheet), so this is the only thing checking it.`);
else ok.push(`rounding default ${jsRadius[1]}px agrees in the JS, the CSS token and head.ut`);

/* ---- 3b. the dark-mode attributes: the same SET, with the same values, in both places --
 *
 * Dark mode is announced three times over: `data-darkmode` (what this theme's own CSS reads)
 * plus `data-theme` and `data-bs-theme` — the two dialects third-party apps sniff for. They are
 * stamped by the pre-paint script in head.ut AND by stampDark() in the live applier, and an
 * attribute added to one and forgotten in the other has a symptom nobody reports: an app's dark
 * styles are dead on a fresh load and come alive the moment you touch the Appearance popover
 * (or the other way round). Derive the set from the JS; hold the template to it. */
const stampBody = (src, re) => (src.match(re) || [, null])[1];
const attrsIn = (body) => new Map([...(body || '').matchAll(
	/setAttribute\('([^']+)',\s*dark\s*\?\s*'([^']+)'\s*:\s*'([^']+)'/g)].map((m) => [m[1], `${m[2]}/${m[3]}`]));

const jsStamp = attrsIn(stampBody(COMMON, /function stampDark\([^)]*\)\s*\{([\s\S]*?)\n\}/));
const headStamp = attrsIn(stampBody(HEAD, /function set\(dark\)\s*\{([\s\S]*?)\n\t\t\t\t\}/));

if (!jsStamp.size) errors.push('no stampDark() found in menu-footstrap-common.js — did the dark-mode applier get renamed?');
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
 * theme must not. A styles/ rule keyed off data-theme would be silently hijackable by any app
 * that stamps it (OpenClash writes data-darkmode on :root from its own luminance sniff). */
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
	console.error('\nhead.ut pre-paints every axis before the first frame and menu-footstrap-common.js');
	console.error('applies it live; the two cannot share code (the template runs before the module');
	console.error('loader exists), so this is what keeps them saying the same thing.');
	process.exit(1);
}

console.log('\naxes: the pre-paint template and the live appliers agree on every axis.');
