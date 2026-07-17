'use strict';
'require baseclass';
'require rpc';
'require fs-fit as fit';

/* The eight Appearance axes THIS file owns (the popover that presents them is fs-appearance.js). A
 * ninth control, the update check, is not here and not always present: it lives in the OPTIONAL
 * luci-app-footstrap-updater package (fs-update.js) with the updater it switches off, and the popover
 * shows it only when that package is installed. All client-side, instant, persisted in localStorage —
 * no server, no reload — and head.ut's inline script re-applies them before paint, so a reload never
 * flashes the wrong one; tools/axes.mjs holds those two copies to one contract, and it derives that
 * contract from THIS file.
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

/* ---- every axis owns its ROUTER DEFAULT, and nothing else may restate it ----
 * `def()` is the sd() branch of current() alone — what the effective value would be with no
 * localStorage. It is exposed because _resolvedDefault() needs exactly that branch and used to
 * spell each one out a second time: two copies of the SAME validation, and the drift has no
 * symptom. Disagree, and matchesSavedDefault() lies about the one thing the Save button IS —
 * its own status (see there): it greys when there is something to save, or never greys at all,
 * and nothing else in the UI would contradict it. */
function modeDefault() {
	const d = sd('darkmode');
	return (d === 'dark' || d === 'light') ? d : 'auto';
}
function currentMode() {
	const s = lsGet('fs-darkmode');
	if (s === 'true') return 'dark';
	if (s === 'false') return 'light';
	if (s === 'auto') return 'auto';
	if (s === null) return modeDefault();
	return 'auto';
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

/* The one expression for "is this page dark right now", so the applier, the OS listener and the
 * guard below cannot disagree about it — and all three really do call it now. Only the guard did:
 * the other two spelled the same condition out again, which is the drift this exists to prevent,
 * sitting three lines under a comment claiming it could not happen. */
function intendedDark() {
	const m = currentMode();
	return m === 'dark' || (m === 'auto' && _mqDark.matches);
}

function applyMode(val) {
	const root = document.documentElement;
	/* 'auto' is stored EXPLICITLY (not lsDel), so it overrides a router default of dark/light —
	 * otherwise a router defaulted to dark could never be set back to "follow the OS" here. */
	if (val === 'auto') lsSet('fs-darkmode', 'auto');
	else lsSet('fs-darkmode', val === 'dark' ? 'true' : 'false');
	/* AFTER the store, so intendedDark() reads the choice just made — which is what lets the one
	 * expression serve here too, instead of a second copy spelled in terms of `val`. */
	stampDark(root, intendedDark());
}

/* ---- the three dialects are PUBLISHED, so third parties write them too ----
 *
 * Announcing dark mode in a vocabulary apps understand is what makes them follow the page — and it
 * is exactly why an app reaches for the same attribute. `luci-app-openclash` stamps
 * `data-darkmode="true"` straight onto :root from seven of its templates (config_editor.htm:215,306,
 * select_git_cdn.htm:114, config_edit.htm:259, tblsection.htm:479, sub_info_show.htm:52), gated on
 * its own isDarkBackground() (openclash/js/common.js:12) — which consults
 * `matchMedia('(prefers-color-scheme: dark)')` BEFORE it ever looks at the body's real background.
 *
 * So a user who explicitly chose LIGHT here, on an OS set to dark, gets the whole theme flipped to
 * dark by opening an OpenClash page. Reproduced on the router: data-darkmode false -> true, page
 * background rgb(246,248,250) -> rgb(28,33,40). Their explicit choice, lost, silently, to their OS
 * setting, through someone else's package. select_git_cdn.htm:117's removeAttribute is the mirror
 * hazard: it deletes the attribute head.ut writes as 'false'.
 *
 * No cascade trick can answer this — it is a DOM write, not a rule. So watch the attributes we own
 * and restate the truth. Nothing else is guarded: the other axes (data-layout, data-palette,
 * data-accent, data-tint) are PRIVATE to this theme, no app has a reason to know them, and a survey
 * of ten shipping packages found none that writes any of them. The published trio is the surface
 * precisely because it is published.
 *
 * This does not fight the app's intent, it corrects a wrong premise: when the page really is dark,
 * OpenClash's write AGREES with ours and the guard never fires — the compare is what makes it inert
 * in the common case, and what stops it looping on its own restamp. It also cannot ping-pong: our
 * write produces a mutation, the callback re-runs, the values now match, it returns. */
function guardDarkStamp() {
	const root = document.documentElement;
	const check = () => {
		const dark = intendedDark();
		if (root.getAttribute('data-darkmode') === (dark ? 'true' : 'false') &&
			root.getAttribute('data-theme') === (dark ? 'dark' : 'light') &&
			root.getAttribute('data-bs-theme') === (dark ? 'dark' : 'light')) return;
		stampDark(root, dark);
	};
	/* An app's inline <script> runs while its template is still being parsed — long before this
	 * module is fetched — so by now the attribute can already be wrong. Observing alone would never
	 * see that mutation: check first, then watch. */
	check();
	new MutationObserver(check).observe(root, {
		attributes: true,
		attributeFilter: ['data-darkmode', 'data-theme', 'data-bs-theme']
	});
}
/* "Auto" means follow the OS — it only did so at page load, so an OS flipping to dark on its
 * own schedule left the open page in light until a reload. Only follows when the effective mode
 * is auto: an explicit browser choice, or an explicit router default with no browser override. */
_mqDark.addEventListener('change', () => {
	if (currentMode() === 'auto') {
		const root = document.documentElement;
		stampDark(root, intendedDark());
	}
});
/* Corner-radius axis: one base value (the card radius, 0–20px) as an inline --fs-radius-base on
 * :root; 02-tokens derives the control/chip radii from it so every surface rounds in step. head.ut
 * pre-paints it. Stored explicitly (including the default 12), so it can override a router default. */
const FS_RADIUS_DEFAULT = 12;
function radiusDefault() {
	const d = sd('rounding');
	return (typeof d === 'number' && d >= 0 && d <= 20) ? d : FS_RADIUS_DEFAULT;
}
function currentRadius() {
	const raw = lsGet('fs-radius');
	if (raw !== null) { const s = parseInt(raw, 10); return (s >= 0 && s <= 20) ? s : FS_RADIUS_DEFAULT; }
	return radiusDefault();
}
function applyRadius(px) {
	const root = document.documentElement;
	const v = Math.max(0, Math.min(20, px | 0));
	lsSet('fs-radius', String(v));
	if (v === FS_RADIUS_DEFAULT) root.style.removeProperty('--fs-radius-base');
	else root.style.setProperty('--fs-radius-base', v + 'px');
}

/* ---- the two axis SHAPES, each written once ------------------------------------------------
 *
 * Four of the nine axes are two shapes with two instances each, so the shape lives in a factory and
 * the instance is one line. Both keep the same contract: `current()` is localStorage ?? def(),
 * `def()` is the router default alone, `apply()` stores the choice EXPLICITLY (see the header —
 * lsDel would mean "inherit the router default", which is not what picking the built-in means).
 * Neither uses `this`: every export below is a DETACHED method reference (`const currentTint =
 * TINT.current`), and a `this` in here would throw the moment one was called.
 *
 * The router-default fallback keys off the axis name (`fs-tint` -> window.__fsSD.tint), so both
 * helpers take their key as the FIRST argument and tools/axes.mjs matches each call by its literal
 * args — that scan is how a key reaches the gate at all, since an axis built by a factory has no
 * lsGet('fs-…') call site to find.
 *
 * The other FIVE axes stay separate; each has a quirk a shared table would need an option for.
 * `mode` stores a value it does not apply (tri-state → matchMedia) and owns an MQL listener;
 * `radius` sets an inline property with no attribute; `layout` reads the ATTRIBUTE (the
 * server-migrated default); `autoCollapse`/`updateCheck` have no :root attribute at all. */

/* A two-value axis: `on` is stamped as the attribute's VALUE, `off` is a bare :root (no attribute).
 * Palette and wallpaper were this shape twice over — current() and apply() agreed line for line
 * down to the stray-value fallthrough, and the two halves of `palette` had already drifted APART in
 * the file (current() at the top, apply() 100 lines below). */
function enumAxis(key, attr, on, off) {
	const sdKey = key.slice(3);	/* 'fs-palette' -> 'palette', the window.__fsSD field */
	const def = () => (sd(sdKey) === on ? on : off);
	return {
		def,
		current() {
			const s = lsGet(key);
			if (s === on) return on;
			if (s === off) return off;
			if (s === null) return def();
			return off;		/* a stray value reads as the built-in default */
		},
		apply(val) {
			const root = document.documentElement;
			const isOn = (val === on);
			lsSet(key, isOn ? on : off);
			if (isOn) root.setAttribute(attr, on);
			else root.removeAttribute(attr);
		}
	};
}

/* A hue axis: 1–360°, 0 = off. Tint and Accent are one axis pointed at two things — same
 * validation, same "0 is off", same off path, same load-bearing ORDERING rule (set the custom
 * property BEFORE the attribute, or a fresh load paints one frame with the previous hue). That rule
 * is exactly what gets fixed in one copy and not the other, so it lives here once. */
function hueAxis(key, attr, prop) {
	const sdKey = key.slice(3);	/* 'fs-tint' -> 'tint', the window.__fsSD field */
	const def = () => {
		const d = sd(sdKey);
		return (typeof d === 'number' && d >= 1 && d <= 360) ? d : 0;
	};
	return {
		def,
		current() {
			const raw = lsGet(key);
			if (raw !== null) { const h = parseInt(raw, 10); return (h >= 1 && h <= 360) ? h : 0; }
			return def();
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

/* Palette: footstrap (GitHub colours) is the default = bare :root; hicontrast is the opt-in
 * variant. Colourway blocks live in styles/03-palettes.css. Legacy 'rvht'/'roman'/'github' are
 * migrated to explicit values by head.ut before paint, so they never reach current() on a loaded
 * page; the stray fallthrough covers them anyway. */
const PALETTE = enumAxis('fs-palette', 'data-palette', 'hicontrast', 'footstrap');
const currentPalette = PALETTE.current, applyPalette = PALETTE.apply;

/* Wallpaper is a separate axis from the palette: the cats pattern composes with
 * either palette. data-wallpaper="cats" on :root drives styles/theme/15-wallpaper.css. */
const WALLPAPER = enumAxis('fs-wallpaper', 'data-wallpaper', 'cats', 'off');
const currentWallpaper = WALLPAPER.current, applyWallpaper = WALLPAPER.apply;

/* Background-tint axis: ONE hue washed into the CANVAS the cards float on (--fs-bg), so a whole
 * install reads as green/violet/amber and you can tell which router a tab — or a screenshot in a
 * ticket — belongs to. Cards, chrome and the status colours keep the palette's values: the cue
 * colours the paper, not the UI. Mixed in CSS (:root[data-tint] + an inline --fs-tint-h; the TINT
 * block in 03-palettes.css explains why it stays contrast-safe on every hue). 0 IS "OFF", not
 * "red": a hue wheel wraps, so one end of the slider is free for the off state a hue axis otherwise
 * has no room for. head.ut pre-paints it. */
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
function autoCollapseDefault() {
	return sd('autocollapse') === 'on';
}
function currentAutoCollapse() {
	const s = lsGet('fs-menu-autocollapse');
	if (s === 'true') return true;
	if (s === 'false') return false;
	if (s === null) return autoCollapseDefault();
	return false;
}
function applyAutoCollapse(val) {
	const on = (val === 'on');
	/* stored explicitly ('false' for off, not lsDel) so it overrides a router default of 'on' */
	lsSet('fs-menu-autocollapse', on ? 'true' : 'false');

	/* Switching it on with several sections unfolded leaves the menu in a state the setting says is
	 * impossible, so somebody must fold them — but not this module. It owns storage; the menu owns
	 * every piece of the open/closed state (the `.open` class, the trigger's aria-expanded, the
	 * remembered "keep open" set), and it opens and closes exclusively through setOpen(), which is
	 * what keeps the class and the aria agreeing. Reaching in from here with a raw classList.remove
	 * satisfied the class and left the aria saying expanded — the exact disagreement setOpen exists
	 * to prevent — and then relied on this event to have the menu repair what we had just broken.
	 * One operation, one owner: say what changed and let the menu apply it. */
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
 * save flips the match to true without a reload.
 *
 * Every field is the axis's OWN def() — this used to restate each one instead (the 1..360 clamp
 * twice, 0..20 once, and a bare `sd('palette') || 'footstrap'` where current() whitelists), i.e. a
 * second copy of a validation with no symptom when the two disagree: `matchesSavedDefault()` simply
 * lies, and the Save button IS that answer. `layout` is the one exception and cannot be otherwise —
 * currentLayout() reads the ATTRIBUTE, so this is the only place stating the layout router default. */
function _resolvedDefault() {
	return {
		layout: sd('layout') || 'sidebar',
		darkmode: modeDefault(),
		palette: PALETTE.def(),
		wallpaper: WALLPAPER.def(),
		tint: String(TINT.def()),
		accent: String(ACCENT.def()),
		rounding: String(radiusDefault()),
		autocollapse: autoCollapseDefault() ? 'on' : 'off'
	};
}
let _savedDefault = _resolvedDefault();
function matchesSavedDefault() {
	const cur = snapshotAxes();
	return Object.keys(cur).every((k) => cur[k] === _savedDefault[k]);
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

	currentMode, applyMode, guardDarkStamp,
	currentPalette, applyPalette,
	currentWallpaper, applyWallpaper,
	currentRadius, applyRadius,
	currentTint, applyTint,
	currentAccent, applyAccent,
	currentLayout, isTopLayout, applyLayout,
	currentAutoCollapse, applyAutoCollapse,
	currentRail, applyRail,

	saveAsDefault, resetToDefault, matchesSavedDefault
});
