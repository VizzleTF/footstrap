'use strict';
'require baseclass';
'require rpc';
'require fs-fit as fit';

/* The nine Appearance axes (the popover that presents them is fs-appearance.js; the ninth, the
 * update check, lives with the updater it switches off — fs-update.js). All client-side, instant,
 * persisted in localStorage — no server, no reload — and head.ut's inline script re-applies them
 * before paint, so a reload never flashes the wrong one; tools/axes.mjs holds those two copies to
 * one contract, and it derives that contract from THIS file.
 *
 * ---- three layers, and the browser always wins ----
 * The effective value of every axis is  localStorage ?? router-default ?? built-in.  The router
 * default is Appearance -> Save as default (saveAsDefault below, written to /etc/config/footstrap
 * and read back by the server into window.__fsSD); the built-in is a bare :root. So a NEW browser,
 * incognito, or a cleared cache inherits the router default, but THIS browser's own choice — stored
 * EXPLICITLY, see the next paragraph — overrides it, in either direction.
 *
 * ---- every applier stores its choice EXPLICITLY, and that is load-bearing ----
 * Once a router default exists, "clear the key" no longer means "the built-in default" — it means
 * "inherit whatever the router default is". So an applier that lsDel-ed on the default value could
 * not express "I want the built-in, NOT the router default" (you could not turn a router-defaulted
 * tint back off). Every axis therefore records the chosen value, including the off/default one, the
 * way `layout` always has. lsDel is reserved for resetToDefault(), which drops back to the router
 * default on purpose. */
function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
function lsDel(k) { try { localStorage.removeItem(k); } catch (e) {} }

/* the router-wide defaults the server stamped (head.ut). Read at RUNTIME so current*() reports the
 * effective default when this browser has no localStorage — the popover's controls then show what
 * the page is actually painted as, not a phantom "auto". */
function sd(k) { try { return (window.__fsSD || {})[k]; } catch (e) { return undefined; } }

function currentMode() {
	const s = lsGet('fs-darkmode');
	if (s === 'true') return 'dark';
	if (s === 'false') return 'light';
	if (s === 'auto') return 'auto';
	if (s === null) { const d = sd('darkmode'); if (d === 'dark' || d === 'light') return d; }
	return 'auto';
}
function currentPalette() {
	const s = lsGet('fs-palette');
	/* legacy 'rvht'/'roman'/'github' are migrated to explicit values by head.ut before paint, so
	 * they do not reach here on a loaded page; the fallthrough returns the default for any stray. */
	if (s === 'hicontrast') return 'hicontrast';
	if (s === 'footstrap') return 'footstrap';
	if (s === null && sd('palette') === 'hicontrast') return 'hicontrast';
	return 'footstrap';	/* default = GitHub colors */
}
/* Wallpaper is a separate axis from the palette: the cats pattern composes with
 * either palette. data-wallpaper="cats" on :root drives styles/theme/15-wallpaper.css. */
function currentWallpaper() {
	const s = lsGet('fs-wallpaper');
	if (s === 'cats') return 'cats';
	if (s === 'off') return 'off';
	if (s === null && sd('wallpaper') === 'cats') return 'cats';
	return 'off';
}
function applyWallpaper(val) {
	const root = document.documentElement;
	lsSet('fs-wallpaper', val === 'cats' ? 'cats' : 'off');
	if (val === 'cats') root.setAttribute('data-wallpaper', 'cats');
	else root.removeAttribute('data-wallpaper');
}
/* ---- dark mode is announced in three dialects, because apps SNIFF for it ----
 *
 * An app with its own dark styles has to guess whether the page is dark, and there is no standard:
 * apps read `data-theme="dark"` on :root (luci-app-justclash keys 21 rules off it), Bootstrap's
 * `data-bs-theme` (luci-app-ssclash), or, failing both, the LUMINANCE of the body background
 * (ssclash's fallback). Stamp all three for the same fact: before this, every one of justclash's
 * [data-theme="dark"] rules was dead, so a dark page rendered its LIGHT fills.
 *
 * `data-darkmode` is the name the theme's OWN CSS keys off. The other two are OUTBOUND
 * compatibility, like the `--*-color-*` export tier: nothing in `styles/` may read them, and
 * tools/axes.mjs fails the build if it does. */
function stampDark(root, dark) {
	root.setAttribute('data-darkmode', dark ? 'true' : 'false');
	root.setAttribute('data-theme', dark ? 'dark' : 'light');
	root.setAttribute('data-bs-theme', dark ? 'dark' : 'light');
}

const _mqDark = window.matchMedia('(prefers-color-scheme: dark)');
function applyMode(val) {
	const root = document.documentElement;
	/* 'auto' is stored EXPLICITLY (not lsDel), so it overrides a router default of dark/light —
	 * otherwise a router defaulted to dark could never be set back to "follow the OS" here. */
	if (val === 'auto') lsSet('fs-darkmode', 'auto');
	else lsSet('fs-darkmode', val === 'dark' ? 'true' : 'false');
	const dark = (val === 'dark') || (val === 'auto' && _mqDark.matches);
	stampDark(root, dark);
}
/* "Auto" means follow the OS — it only did so at page load, so an OS flipping to dark on its
 * own schedule left the open page in light until a reload. Only follows when the effective mode
 * is auto: an explicit browser choice, or an explicit router default with no browser override. */
_mqDark.addEventListener('change', () => {
	if (currentMode() === 'auto') {
		const root = document.documentElement;
		stampDark(root, _mqDark.matches);
	}
});
function applyPalette(val) {
	const root = document.documentElement;
	/* footstrap (GitHub colours) is the default = bare :root, no attr; hicontrast is the
	 * opt-in variant. Colourway blocks live in styles/03-palettes.css. Stored explicitly. */
	lsSet('fs-palette', val === 'hicontrast' ? 'hicontrast' : 'footstrap');
	if (val === 'hicontrast') root.setAttribute('data-palette', 'hicontrast');
	else root.removeAttribute('data-palette');
}

/* Corner-radius axis: one base value (the card radius, 0–20px) as an inline --fs-radius-base on
 * :root; 02-tokens derives the control/chip radii from it so every surface rounds in step. head.ut
 * pre-paints it. Stored explicitly (including the default 12), so it can override a router default. */
const FS_RADIUS_DEFAULT = 12;
function currentRadius() {
	const raw = lsGet('fs-radius');
	if (raw !== null) { const s = parseInt(raw, 10); return (s >= 0 && s <= 20) ? s : FS_RADIUS_DEFAULT; }
	const d = sd('rounding');
	return (typeof d === 'number' && d >= 0 && d <= 20) ? d : FS_RADIUS_DEFAULT;
}
function applyRadius(px) {
	const root = document.documentElement;
	const v = Math.max(0, Math.min(20, px | 0));
	lsSet('fs-radius', String(v));
	if (v === FS_RADIUS_DEFAULT) root.style.removeProperty('--fs-radius-base');
	else root.style.setProperty('--fs-radius-base', v + 'px');
}

/* Background-tint axis: ONE hue (0–360°) washed into the CANVAS the cards float on (--fs-bg), so a
 * whole install reads as green/violet/amber and you can tell which router a tab — or a screenshot
 * in a ticket — belongs to. Cards, chrome and the status colours keep the palette's values: the cue
 * colours the paper, not the UI. Mixed in CSS (:root[data-tint] + an inline --fs-tint-h; the TINT
 * block in 03-palettes.css explains why it stays contrast-safe on every hue). 0 IS "OFF", not
 * "red": a hue wheel wraps, so one end of the slider is free for the off state a hue axis otherwise
 * has no room for. head.ut pre-paints it.
 *
 * ---- the HUE axis, written once ----
 * Tint and Accent are one axis pointed at two things: same 1–360 validation, same "0 is off", same
 * off path, same load-bearing ORDERING rule — set the custom property BEFORE the attribute, or a
 * fresh load paints one frame with the previous hue. That rule is exactly what gets fixed in one
 * copy and not the other, so it lives here once. The router-default fallback keys off the axis name
 * (`fs-tint` -> window.__fsSD.tint), so the helper keeps its THREE-argument signature — tools/axes.mjs
 * matches hueAxis() as exactly three string args.
 *
 * The other seven axes stay separate; each has a quirk a shared table would need an option for.
 * `mode` stores a value it does not apply (tri-state → matchMedia) and owns an MQL listener;
 * `radius` sets an inline property with no attribute; `layout` reads the ATTRIBUTE (the
 * server-migrated default); `autoCollapse`/`updateCheck` have no :root attribute at all. */
function hueAxis(key, attr, prop) {
	const sdKey = key.slice(3);	/* 'fs-tint' -> 'tint', the window.__fsSD field */
	return {
		current() {
			const raw = lsGet(key);
			if (raw !== null) { const h = parseInt(raw, 10); return (h >= 1 && h <= 360) ? h : 0; }
			const d = sd(sdKey);
			return (typeof d === 'number' && d >= 1 && d <= 360) ? d : 0;
		},
		apply(deg) {
			const root = document.documentElement;
			const v = Math.max(0, Math.min(360, deg | 0));
			/* stored EXPLICITLY, including 0=off, so dragging to off overrides a router default hue
			 * instead of falling back to it. */
			lsSet(key, String(v));
			if (!v) {
				root.removeAttribute(attr);
				root.style.removeProperty(prop);
			} else {
				/* the hue FIRST, then the attribute that switches the mixes on — the other
				 * order paints one frame with the previous hue on a fresh load. */
				root.style.setProperty(prop, String(v));
				root.setAttribute(attr, '');
			}
		}
	};
}

const TINT = hueAxis('fs-tint', 'data-tint', '--fs-tint-h');
const currentTint = TINT.current, applyTint = TINT.apply;

/* Accent-hue axis: ONE hue that recolours the UI accent (solid buttons, toggle knobs, range
 * sliders, focus rings, accented links) while canvas, cards and good/warn/danger stay put — the
 * tint hues the paper, this hues the CHROME. CSS rotates --fs-accent/--fs-accent-lt via
 * oklch(from … l c H), keeping the palette's lightness and chroma so --fs-on-accent stays legible
 * on every hue (03-palettes.css). 0 = off (the palette's designed accent), same rationale as the
 * tint. head.ut pre-paints it. */
const ACCENT = hueAxis('fs-accent', 'data-accent', '--fs-accent-h');
const currentAccent = ACCENT.current, applyAccent = ACCENT.apply;

/* Layout axis: vertical sidebar (default) vs horizontal top bar. ONE template, ONE renderer — CSS
 * morphs the chrome off :root[data-layout] (head.ut pre-paints it), and toggling re-renders
 * NOTHING: the DOM serves both, and menu-footstrap.js's MutationObserver on data-layout folds the
 * accordion into dropdowns / restores it.
 *
 * Read the ATTRIBUTE, not localStorage: head.ut stamps it server-side (from the router default) and
 * the pre-paint script overrides it from localStorage, so it always carries an explicit value.
 * localStorage would report 'sidebar' on a router whose default is 'top' until the user first
 * touched the toggle. */
function currentLayout() {
	return document.documentElement.getAttribute('data-layout') === 'top' ? 'top' : 'sidebar';
}
function isTopLayout() {
	return currentLayout() === 'top';
}
function applyLayout(val) {
	const layout = (val === 'top') ? 'top' : 'sidebar';
	/* ALWAYS an explicit value, never a removed attribute: every layout rule matches data-layout
	 * POSITIVELY (='sidebar' / ='top'), and a migrated/defaulted router carries a server default
	 * that lsDel would let re-assert on the next load, so localStorage must record the choice. */
	lsSet('fs-layout', layout);
	document.documentElement.setAttribute('data-layout', layout);
	/* the bar and the column have different room for the menu: re-take the fits-on-one-row
	 * measurement. Nothing else re-renders. */
	fit.schedule();
}

/* Sidebar accordion: auto-collapse on = one section open at a time; off (default) they stack.
 * Only meaningful for the expanded sidebar — rail flyouts and the mobile bar are always
 * exclusive. Read by menu-footstrap.js. */
function currentAutoCollapse() {
	const s = lsGet('fs-menu-autocollapse');
	if (s === 'true') return true;
	if (s === 'false') return false;
	if (s === null && sd('autocollapse') === 'on') return true;
	return false;
}
function applyAutoCollapse(val) {
	const on = (val === 'on');
	/* stored explicitly ('false' for off, not lsDel) so it overrides a router default of 'on' */
	lsSet('fs-menu-autocollapse', on ? 'true' : 'false');

	/* switching it on with several sections unfolded would leave the menu in a state the
	 * setting says is impossible — fold all but the active */
	if (on) {
		document.querySelectorAll('#topmenu > li.open:not(.active)')
			.forEach(li => li.classList.remove('open'));
	}

	/* The menu owns two other pieces of this state — the remembered "keep open" set and each
	 * trigger's aria-expanded — and neither is reachable from here, so folding the sections above
	 * left them behind: the next navigation re-rendered from the stale set and unfolded everything
	 * again. Tell the layout instead of reaching across into it. */
	document.dispatchEvent(new CustomEvent('fs-autocollapse', { detail: { on } }));
}

/* The sidebar rail's collapsed flag. The BUTTON that flips it is chrome (fs-chrome.js): only the
 * stored state belongs to the preference layer, and fs-update.js needs the ls* helpers anyway.
 * NOT part of the router-wide defaults — it is a transient chrome collapse, not an appearance
 * choice, so it is absent from snapshotAxes()/resetToDefault() below. */
function applyRail(on) {
	const root = document.documentElement;
	if (on) { root.setAttribute('data-rail', 'true'); lsSet('fs-rail', 'true'); }
	else { root.removeAttribute('data-rail'); lsDel('fs-rail'); }
}
function currentRail() {
	return document.documentElement.getAttribute('data-rail') === 'true';
}

/* ---- Save as default: write the current EFFECTIVE axes to /etc/config/footstrap ----
 * The scoped rpcd ACL (config 'footstrap' only) lets the logged-in admin's session set + commit
 * those options; rpcd validates the config/section/option names, so no value reaches a shell and
 * there is no injection surface. The server reads them back on the next load and the sanitiser in
 * head.ut clamps every one before it becomes window.__fsSD.
 *
 * snapshotAxes() reads the EFFECTIVE values (currentLayout()/currentMode()/… already fold in this
 * browser's localStorage), so "Save as default" captures exactly what the user sees. It does NOT
 * touch localStorage — this browser keeps overriding, which is the point: the saved default is for
 * OTHER browsers/devices. resetToDefault() is the escape hatch that drops this browser back onto it. */
const AXIS_KEYS = [
	'fs-layout', 'fs-darkmode', 'fs-palette', 'fs-wallpaper',
	'fs-tint', 'fs-accent', 'fs-radius', 'fs-menu-autocollapse'
];
const _uciSet = rpc.declare({ object: 'uci', method: 'set', params: [ 'config', 'section', 'values' ] });
const _uciCommit = rpc.declare({ object: 'uci', method: 'commit', params: [ 'config' ] });

function snapshotAxes() {
	return {
		layout: currentLayout(),
		darkmode: currentMode(),
		palette: currentPalette(),
		wallpaper: currentWallpaper(),
		tint: String(currentTint()),
		accent: String(currentAccent()),
		rounding: String(currentRadius()),
		autocollapse: currentAutoCollapse() ? 'on' : 'off'
	};
}
/* The RESOLVED router default (UCI value if set, else the built-in), in snapshotAxes() string form,
 * so the popover can grey the Save button out when this browser already shows exactly it. Seeded
 * from window.__fsSD at load and replaced with the just-saved snapshot after saveAsDefault(), so a
 * save flips the match to true without a reload. */
function _resolvedDefault() {
	const t = sd('tint'), a = sd('accent'), r = sd('rounding');
	return {
		layout: sd('layout') || 'sidebar',
		darkmode: sd('darkmode') || 'auto',
		palette: sd('palette') || 'footstrap',
		wallpaper: sd('wallpaper') || 'off',
		tint: String((typeof t === 'number' && t >= 1 && t <= 360) ? t : 0),
		accent: String((typeof a === 'number' && a >= 1 && a <= 360) ? a : 0),
		rounding: String((typeof r === 'number' && r >= 0 && r <= 20) ? r : FS_RADIUS_DEFAULT),
		autocollapse: sd('autocollapse') || 'off'
	};
}
let _savedDefault = _resolvedDefault();
function matchesSavedDefault() {
	const cur = snapshotAxes();
	return Object.keys(cur).every(k => cur[k] === _savedDefault[k]);
}
function saveAsDefault() {
	const snap = snapshotAxes();
	return _uciSet('footstrap', 'settings', snap)
		.then(() => _uciCommit('footstrap'))
		.then(() => { _savedDefault = snap; });
}
/* clear THIS browser's overrides so the router default (or the built-in) takes over; the caller
 * reloads so head.ut re-applies from window.__fsSD in one clean pass. */
function resetToDefault() {
	AXIS_KEYS.forEach(lsDel);
}

return baseclass.extend({
	/* the storage helpers, shared with fs-update.js's own axis */
	lsGet, lsSet, lsDel,

	FS_RADIUS_DEFAULT,

	currentMode, applyMode, stampDark,
	currentPalette, applyPalette,
	currentWallpaper, applyWallpaper,
	currentRadius, applyRadius,
	currentTint, applyTint,
	currentAccent, applyAccent,
	currentLayout, isTopLayout, applyLayout,
	currentAutoCollapse, applyAutoCollapse,
	currentRail, applyRail,

	snapshotAxes, saveAsDefault, resetToDefault, matchesSavedDefault
});
