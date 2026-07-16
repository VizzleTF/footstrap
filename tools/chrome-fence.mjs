#!/usr/bin/env node
/* The chrome is defended from third-party CSS in three places that must agree, and nothing held
 * them together. Proven, not assumed: breaking the fence constant to `.fs-sidebarTYPO` left the menu
 * completely unprotected and `npm run check`, `jsmin-verify` and `eslint` ALL exited 0.
 *
 *   1. `header.ut` — the markup. `<nav class="fs-sidebar">` IS the chrome root, for BOTH layouts
 *      (the top bar is the same element; CSS morphs it).
 *   2. `fs-sheets.js` — CHROME_FENCE, appended to a foreign selector's subject so it can no longer
 *      MATCH a menu element. This is what beats a third party's `!important`: there is nothing left
 *      to out-rank.
 *   3. `theme/10-chrome.css` — the pin, which closes the one way in a fence cannot: INHERITANCE from
 *      `html`/`body`, where no match is needed at all.
 *
 * The name is DERIVED FROM THE MARKUP here, never restated: rename the class in header.ut and this
 * gate re-derives it, then fails on the two copies that still say the old one. That is the whole
 * point — the failure it prevents has NO symptom. The fence silently stops fencing, every test stays
 * green, and the menu breaks on someone else's router months later, next to an app we never saw.
 *
 * It also holds the SHAPES, because each was a bug that was measured, not imagined:
 *  - `:where()` in both. It contributes ZERO specificity. Drop it from the fence and every app rule
 *    silently gains a point, re-ordering the app's stylesheet against itself on its own page. Drop it
 *    from the pin and the pin (0,1,0) starts fighting the chrome's own rules on source order.
 *  - The fence must cover the root AND its subtree (`.X, .X *`); the root alone leaves every menu
 *    element inside it exposed.
 *  - The pin must cover the root ALONE. Pinning descendants was measured and it broke the chrome's
 *    own inheritance: a direct declaration beats an inherited one even when the inherited one is
 *    ours, costing `.fs-label` its `nowrap` and forcing `text-align` from `start` to `left` on 302
 *    elements — which breaks every RTL language LuCI ships.
 *  - The pin may only carry INHERITED properties. A non-inherited one there is a style decision
 *    wearing a guard's coat, and at 0,0,0 it would lose to everything anyway.
 *
 * Lastly it holds the dark-mode guard to `stampDark`: the guard exists because third parties write
 * the attributes this theme publishes (`luci-app-openclash`, seven templates). Add a fourth dialect
 * to stampDark and forget the observer's attributeFilter, and that dialect is unguarded — silently.
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

const HEADER = read('luci-theme-footstrap/ucode/template/themes/footstrap/header.ut');
const SHEETS = read('luci-theme-footstrap/htdocs/luci-static/resources/fs-sheets.js');
const PREFS = read('luci-theme-footstrap/htdocs/luci-static/resources/fs-prefs.js');
const CHROME = read('luci-theme-footstrap/styles/theme/10-chrome.css');

const errors = [];
const ok = [];

/* ---- 1. the chrome root, derived from the markup ------------------------------------- */
/* One <nav> in the template, and it is the menu — `<nav>, not <aside>` is a deliberate choice the
 * header documents. If that ever stops being true this throws rather than guessing wrong. */
const navs = [...HEADER.matchAll(/<nav\b[^>]*\bclass="([^"]+)"/g)].map((m) => m[1].trim());
if (navs.length !== 1) {
	console.error(`FAIL: expected exactly one <nav> in header.ut (the chrome root), found ${navs.length}.`);
	console.error('This gate derives the chrome root from the markup; teach it the new shape.');
	process.exit(1);
}
const ROOT_CLASS = navs[0].split(/\s+/)[0];
if (!(/^fs-/).test(ROOT_CLASS)) {
	console.error(`FAIL: the chrome root class "${ROOT_CLASS}" is not in the fs-* namespace.`);
	console.error('Nobody outside this theme may emit an fs-* name — that is what makes the fence safe.');
	process.exit(1);
}
ok.push(`chrome root derived from header.ut: .${ROOT_CLASS}`);

/* ---- 2. the fence (fs-sheets.js) ------------------------------------------------------ */
const fenceM = SHEETS.match(/const CHROME_FENCE = '([^']+)';/);
if (!fenceM) {
	errors.push('fs-sheets.js no longer declares `const CHROME_FENCE = \'…\';` — the fence is what '
		+ 'keeps a third party\'s !important out of the menu; this gate cannot find it');
} else {
	const fence = fenceM[1];
	if (!fence.includes(`.${ROOT_CLASS}`))
		errors.push(`CHROME_FENCE (${fence}) does not mention .${ROOT_CLASS}, the chrome root header.ut `
			+ `emits — the menu is NOT fenced and nothing else would tell you`);
	if (!fence.startsWith(':where('))
		errors.push(`CHROME_FENCE (${fence}) must be wrapped in :where() so it adds ZERO specificity; `
			+ `without it every fenced app rule silently gains a point against the app's own stylesheet`);
	if (!fence.includes(':not('))
		errors.push(`CHROME_FENCE (${fence}) must EXCLUDE the chrome (:not(…)), not select it`);
	/* the subtree half: `.X *`. Without it the fence only spares the root element itself. */
	if (!new RegExp(`\\.${ROOT_CLASS}\\s*\\*`).test(fence))
		errors.push(`CHROME_FENCE (${fence}) covers .${ROOT_CLASS} but not its DESCENDANTS `
			+ `(.${ROOT_CLASS} *) — every element inside the menu would stay exposed`);
	if (!errors.length) ok.push(`fence excludes .${ROOT_CLASS} and its subtree, at zero specificity`);
}

/* ---- 3. the pin (theme/10-chrome.css) ------------------------------------------------- */
/* Inherited properties, per CSS. Only these belong in the pin: it exists to break the inheritance
 * chain from html/body, and a non-inherited property cannot arrive that way. */
const INHERITED = new Set([
	'azimuth', 'border-collapse', 'border-spacing', 'caption-side', 'color', 'cursor', 'direction',
	'empty-cells', 'font', 'font-family', 'font-size', 'font-style', 'font-variant', 'font-weight',
	'font-size-adjust', 'font-stretch', 'hanging-punctuation', 'hyphens', 'letter-spacing',
	'line-height', 'list-style', 'list-style-image', 'list-style-position', 'list-style-type',
	'orphans', 'overflow-wrap', 'quotes', 'tab-size', 'text-align', 'text-align-last',
	'text-indent', 'text-justify', 'text-shadow', 'text-transform', 'visibility', 'white-space',
	'widows', 'word-break', 'word-spacing', 'word-wrap', 'writing-mode', 'text-rendering',
	'image-rendering', 'pointer-events', 'caret-color', 'accent-color', 'color-scheme',
	'font-feature-settings', 'font-variation-settings', 'font-kerning', 'text-decoration-color'
]);

const pinM = CHROME.match(/:where\(\s*\.([A-Za-z_][\w-]*)([^)]*)\)\s*\{([^}]*)\}/);
if (!pinM) {
	errors.push('theme/10-chrome.css no longer carries the `:where(.<root>) { … }` pin — it is what '
		+ 'stops a foreign rule on html/body reaching the menu by INHERITANCE, which the fence cannot');
} else {
	const [, pinClass, pinRest, body] = pinM;
	if (pinClass !== ROOT_CLASS)
		errors.push(`the pin in theme/10-chrome.css targets .${pinClass}, but header.ut emits `
			+ `.${ROOT_CLASS} — a foreign html/body rule inherits straight into the menu`);
	/* root ONLY: `.X *` here re-breaks the chrome's own inheritance (measured: 302 elements) */
	if ((/\*/).test(pinRest) || (/,/).test(pinRest))
		errors.push(`the pin must target the chrome ROOT ALONE, but its selector also carries `
			+ `"${pinRest.trim()}". Pinning descendants beats the chrome's OWN inherited values: `
			+ `.fs-label loses its nowrap and text-align is forced from start to left (302 elements, `
			+ `which breaks RTL). The root alone breaks the chain from html and lets ours flow on`);
	const props = [...body.matchAll(/([-a-z]+)\s*:/g)].map((m) => m[1]);
	const notInherited = props.filter((p) => !INHERITED.has(p));
	if (notInherited.length)
		errors.push(`the pin declares non-inherited propert${notInherited.length > 1 ? 'ies' : 'y'} `
			+ `${notInherited.join(', ')} — the pin exists only to break the inheritance chain, and at `
			+ `zero specificity it cannot win anything else anyway`);
	if (!props.length)
		errors.push('the pin declares nothing — a pin of nothing pins nothing');
	if (!notInherited.length && props.length && pinClass === ROOT_CLASS)
		ok.push(`pin on .${ROOT_CLASS} alone, ${props.length} inherited properties, zero specificity`);
}

/* ---- 4. the dark-mode guard is watching everything stampDark writes -------------------- */
const stampM = PREFS.match(/function stampDark\([^)]*\)\s*\{([\s\S]*?)\n\}/);
const guardM = PREFS.match(/attributeFilter:\s*\[([^\]]*)\]/);
if (!stampM) {
	errors.push('fs-prefs.js no longer declares `function stampDark(…)` — this gate holds the guard to it');
} else if (!guardM) {
	errors.push('fs-prefs.js declares stampDark() but no observer attributeFilter — the published '
		+ 'dark-mode attributes are UNGUARDED. luci-app-openclash writes data-darkmode onto :root from '
		+ 'seven templates; without the guard an explicit Light choice is lost to the OS setting');
} else {
	const written = [...stampM[1].matchAll(/setAttribute\(\s*'([^']+)'/g)].map((m) => m[1]).sort();
	const watched = [...guardM[1].matchAll(/'([^']+)'/g)].map((m) => m[1]).sort();
	const missing = written.filter((a) => !watched.includes(a));
	const extra = watched.filter((a) => !written.includes(a));
	if (missing.length)
		errors.push(`stampDark() writes ${missing.join(', ')} but the guard does not watch `
			+ `${missing.length > 1 ? 'them' : 'it'} — a third party can hijack that dialect silently`);
	if (extra.length)
		errors.push(`the guard watches ${extra.join(', ')}, which stampDark() does not write — it would `
			+ `restamp on an attribute it does not own`);
	if (!missing.length && !extra.length)
		ok.push(`dark-mode guard watches all ${written.length} published dialects: ${written.join(', ')}`);
}

/* ---- report --------------------------------------------------------------------------- */
for (const line of ok) console.log('  ok   ' + line);

if (errors.length) {
	console.error('\nFAIL: the chrome\'s defences have drifted from the chrome.');
	for (const e of errors) console.error('  - ' + e);
	console.error('\nThe fence, the pin and the markup name the same element in three places, and the');
	console.error('dark-mode guard mirrors stampDark. None of these fails loudly on its own: a stale');
	console.error('copy just stops defending, every other test stays green, and the menu breaks on');
	console.error('someone else\'s router — next to a third-party app we have never seen.');
	process.exit(1);
}

console.log('\nchrome-fence: the fence, the pin and the dark-mode guard all still match the chrome.');
