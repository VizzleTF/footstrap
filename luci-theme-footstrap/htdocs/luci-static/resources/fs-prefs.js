'use strict';
'require baseclass';
'require fs-fit as fit';

/* The nine Appearance axes (the popover that presents them is fs-appearance.js; the ninth, the
 * update check, lives with the updater it switches off — fs-update.js). All client-side, instant,
 * persisted in localStorage — no server, no reload — and head.ut's inline script re-applies them
 * before paint, so a reload never flashes the wrong one; tools/axes.mjs holds those two copies to
 * one contract, and it derives that contract from THIS file.
 *
 * The only server involvement is a DEFAULT layout for a router migrated from the old top-nav theme
 * (luci.main.footstrap_layout), which the user's own choice then overrides. */
function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
function lsDel(k) { try { localStorage.removeItem(k); } catch (e) {} }

function currentMode() {
	const s = lsGet('fs-darkmode');
	return s === 'true' ? 'dark' : (s === 'false' ? 'light' : 'auto');
}
function currentPalette() {
	const s = lsGet('fs-palette');
	/* legacy 'rvht'/'roman' were the default colours + the cats wallpaper; head.ut migrates
	 * them to fs-wallpaper=cats + the default palette before paint, so they read as default. */
	if (s === 'hicontrast') return 'hicontrast';
	return 'footstrap';	/* default = GitHub colors; legacy 'github'/'rvht'/null map here */
}
/* Wallpaper is a separate axis from the palette: the cats pattern composes with
 * either palette. data-wallpaper="cats" on :root drives styles/theme/15-wallpaper.css. */
function currentWallpaper() { return lsGet('fs-wallpaper') === 'cats' ? 'cats' : 'off'; }
function applyWallpaper(val) {
	const root = document.documentElement;
	if (val === 'cats') { lsSet('fs-wallpaper', 'cats'); root.setAttribute('data-wallpaper', 'cats'); }
	else { lsDel('fs-wallpaper'); root.removeAttribute('data-wallpaper'); }
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
	if (val === 'auto') lsDel('fs-darkmode');
	else lsSet('fs-darkmode', val === 'dark' ? 'true' : 'false');
	const dark = (val === 'dark') || (val === 'auto' && _mqDark.matches);
	stampDark(root, dark);
}
/* "Auto" means follow the OS — it only did so at page load, so an OS flipping to dark on its
 * own schedule left the open page in light until a reload. */
_mqDark.addEventListener('change', () => {
	if (currentMode() === 'auto') applyMode('auto');
});
function applyPalette(val) {
	const root = document.documentElement;
	/* footstrap (GitHub colours) is the default = bare :root, no attr; hicontrast is the
	 * opt-in variant. Colourway blocks live in styles/03-palettes.css. */
	if (val === 'hicontrast') { lsSet('fs-palette', 'hicontrast'); root.setAttribute('data-palette', 'hicontrast'); }
	else { lsDel('fs-palette'); root.removeAttribute('data-palette'); }
}

/* Corner-radius axis: one base value (the card radius, 0–20px) as an inline --fs-radius-base on
 * :root; 02-tokens derives the control/chip radii from it so every surface rounds in step. The
 * default (12) clears the override entirely. head.ut pre-paints it. */
const FS_RADIUS_DEFAULT = 12;
function currentRadius() {
	const s = parseInt(lsGet('fs-radius'), 10);
	return (s >= 0 && s <= 20) ? s : FS_RADIUS_DEFAULT;
}
function applyRadius(px) {
	const root = document.documentElement;
	const v = Math.max(0, Math.min(20, px | 0));
	if (v === FS_RADIUS_DEFAULT) { lsDel('fs-radius'); root.style.removeProperty('--fs-radius-base'); }
	else { lsSet('fs-radius', String(v)); root.style.setProperty('--fs-radius-base', v + 'px'); }
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
 * copy and not the other, so it lives here once.
 *
 * The other seven axes stay separate; each has a quirk a shared table would need an option for.
 * `mode` stores a value it does not apply (tri-state → matchMedia) and owns an MQL listener;
 * `radius` sets an inline property with no attribute and its default sits MID-range, so "clear the
 * key" is not an end of the slider; `layout` reads the ATTRIBUTE (the server-migrated default) and
 * writes its default explicitly; `autoCollapse`/`updateCheck` have no :root attribute at all. */
function hueAxis(key, attr, prop) {
	return {
		current() {
			const h = parseInt(lsGet(key), 10);
			return (h >= 1 && h <= 360) ? h : 0;
		},
		apply(deg) {
			const root = document.documentElement;
			const v = Math.max(0, Math.min(360, deg | 0));
			if (!v) {
				lsDel(key);
				root.removeAttribute(attr);
				root.style.removeProperty(prop);
			} else {
				lsSet(key, String(v));
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
 * Read the ATTRIBUTE, not localStorage: head.ut stamps it server-side and the pre-paint script
 * overrides it from localStorage, so it always carries an explicit value. localStorage would report
 * 'sidebar' on a router whose default is 'top' (migrated from the old top-nav theme) until the user
 * first touched the toggle. */
function currentLayout() {
	return document.documentElement.getAttribute('data-layout') === 'top' ? 'top' : 'sidebar';
}
function isTopLayout() {
	return currentLayout() === 'top';
}
function applyLayout(val) {
	const layout = (val === 'top') ? 'top' : 'sidebar';
	/* ALWAYS an explicit value, never a removed attribute: every layout rule matches data-layout
	 * POSITIVELY (='sidebar' / ='top'), so a future third layout must opt in to a rule rather than
	 * inherit it by not being 'top'. And this is the one axis that writes its DEFAULT explicitly
	 * rather than clearing the key: a migrated router carries a server default that lsDel would let
	 * re-assert 'top' on the next load, so localStorage must record the choice, not its absence. */
	lsSet('fs-layout', layout);
	document.documentElement.setAttribute('data-layout', layout);
	/* the bar and the column have different room for the menu: re-take the fits-on-one-row
	 * measurement. Nothing else re-renders. fs-fit runs every registered fitter, and the chrome's
	 * is one of them (fs-chrome.js registers fitChrome in the theme's init). */
	fit.schedule();
}

/* Sidebar accordion: auto-collapse on = one section open at a time; off (default) they stack.
 * Only meaningful for the expanded sidebar — rail flyouts and the mobile bar are always
 * exclusive. Read by menu-footstrap.js. */
function currentAutoCollapse() {
	return lsGet('fs-menu-autocollapse') === 'true';
}
function applyAutoCollapse(val) {
	const on = (val === 'on');
	if (on) lsSet('fs-menu-autocollapse', 'true');
	else lsDel('fs-menu-autocollapse');

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
 * stored state belongs to the preference layer, and fs-update.js needs the ls* helpers anyway. */
function applyRail(on) {
	const root = document.documentElement;
	if (on) { root.setAttribute('data-rail', 'true'); lsSet('fs-rail', 'true'); }
	else { root.removeAttribute('data-rail'); lsDel('fs-rail'); }
}
function currentRail() {
	return document.documentElement.getAttribute('data-rail') === 'true';
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
	currentRail, applyRail
});
