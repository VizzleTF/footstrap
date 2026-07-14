'use strict';
'require baseclass';
'require ui';
'require fs-fit as fit';

/* Shared chrome logic: mode menu, section tabs, the SPA router and the Appearance
 * popover. menu-footstrap.js is the one renderer that composes with it
 * (common.init(renderMainMenu)).
 *
 * There used to be TWO renderers here — a vertical one and a horizontal one — and
 * this file existed to share what they had in common. They are one now: the layout
 * is a client preference (:root[data-layout]) that CSS morphs, so the same markup
 * serves the sidebar, the top bar, the collapsed rail and the phone bar. The
 * composition seam is kept anyway, because LuCI instantiates every required
 * baseclass module into a singleton — a base class cannot be `extend`-ed across
 * modules, so injecting renderMainMenu as a callback is still how the two files
 * talk. */

/* --- stray-interval teardown for SPA nav ---------------------------------
 * A full page load kills every window.setInterval the outgoing page set. Our
 * SPA nav never reloads, so a view's own setInterval poller keeps firing
 * against a page that's gone — e.g. luci-app-podkop's log tailer
 * (view/podkop/main.js: `this.timer = setInterval(() => this.checkOnce(), …)`)
 * logs `[SHELL] [/usr/bin/podkop check_logs]` forever after you navigate away.
 * L.Poll pollers are handled separately (queue flush in navigate); this covers
 * the plain setInterval ones. Track view-set interval ids and clear them on nav
 * teardown, but preserve L.Poll's own 1s tick (it is a window.setInterval too).
 * Hook at module eval — the earliest point, before any view render sets a timer. */
const _viewIntervals = (window.__fsViewIntervals || (window.__fsViewIntervals = new Set()));
(function hookIntervals() {
	if (window.__fsIntervalsHooked) return;
	window.__fsIntervalsHooked = true;
	const _si = window.setInterval, _ci = window.clearInterval;
	window.setInterval = function () {
		const id = _si.apply(window, arguments);
		_viewIntervals.add(id);
		return id;
	};
	window.clearInterval = function (id) {
		_viewIntervals.delete(id);
		return _ci.apply(window, arguments);
	};
})();
function clearViewIntervals() {
	const keep = (L.Poll && L.Poll.timer) || null;
	_viewIntervals.forEach((id) => { if (id !== keep) window.clearInterval(id); });
}

/* section tabs -> #tabmenu (horizontal) */
function renderTabMenu(tree, url, level) {
	const container = document.querySelector('#tabmenu');
	/* a template variant without the container must not blow up the whole
	 * ui.menu.load() chain (an unhandled rejection here kills every menu) */
	if (!container)
		return E([]);
	const ul = E('ul', { 'class': 'tabs' });
	const children = ui.menu.getChildren(tree);
	let activeNode = null;

	children.forEach(child => {
		const isActive = (L.env.dispatchpath[3 + (level || 0)] === child.name);
		/* aria-current="page", not just the `active` class: the class is paint, and paint is
		 * the one thing a screen reader cannot see. Same rule as the main menu's leaves.
		 * E() drops an attribute whose value is null (luci.js: `attr[key] == null` → skip),
		 * so the inactive tabs carry nothing. */
		ul.appendChild(E('li', { 'class': 'tabmenu-item-%s %s'.format(child.name, isActive ? 'active' : '') }, [
			E('a', { 'href': L.url(url, child.name), 'aria-current': isActive ? 'page' : null }, [ _(child.title) ])
		]));
		if (isActive)
			activeNode = child;
	});

	if (ul.children.length === 0)
		return E([]);

	container.appendChild(ul);
	container.style.display = '';

	if (activeNode)
		renderTabMenu(activeNode, url + '/' + activeNode.name, (level || 0) + 1);

	return ul;
}

/* ---- tab-strip auto-fit -------------------------------------------------
 * A tab strip (section tabs in #tabmenu, or a view's own .cbi-tabmenu) can carry
 * ~11 pills (e.g. luci-app-justclash) that overflow one row on a normal screen.
 * Rather than wrap to a second line, shrink the pills to fit: step through two
 * density classes (styles/theme/40-tabs.css) that trim padding, then gap+font,
 * until the strip fits one row — floored so a pill never gets tighter than its
 * label or loses its gap; past the floor the strip is allowed to wrap. Runs on
 * render, on resize, and when a view renders its own tabs (works in both layouts
 * and as the page narrows). */
function stripFitsOneRow(ul) {
	/* Only laid-out children count. The top-nav hides its "Log out" <li> below 768px
	 * (a top-bar icon button takes over); a display:none child has offsetTop 0, so
	 * using it as `last` made this read "one row" even while VPN had wrapped — and
	 * the density fit never kicked in. Filter to items that actually render. */
	const items = [...ul.children].filter((el) => el.getClientRects().length > 0);
	const first = items[0], last = items[items.length - 1];
	/* one row iff first and last item share a top edge */
	return !first || !last || first.offsetTop === last.offsetTop;
}
function fitTabStrips() {
	/* .fs-sidebar ul.nav is only a horizontal strip on the phone bar (≤767px);
	 * on the desktop it is a vertical list where the one-row measure is
	 * meaningless — fitOne() skips it there. */
	/* `.fs-sidebar > ul.nav` covers the main menu in EVERY layout now — it is the same
	 * list, and the flexDirection check below is what tells a bar (row) from a vertical
	 * sidebar (column). The old `.fs-topnav .fs-mainmenu` selector went with the second
	 * template. */
	document.querySelectorAll('.tabs, .cbi-tabmenu, .fs-sidebar > ul.nav').forEach((ul) => {
		if (ul.children.length < 2) return;
		if (ul.matches('.fs-sidebar > ul.nav') && getComputedStyle(ul).flexDirection !== 'row') {
			/* desktop sidebar: a vertical list — the one-row measure is meaningless
			 * and would floor it at fs-dense2 forever. Clear and skip. */
			if (ul.classList.contains('fs-dense1') || ul.classList.contains('fs-dense2'))
				ul.classList.remove('fs-dense1', 'fs-dense2');
			return;
		}
		/* steady state (poll tick on an already-fitting strip): one measure, zero
		 * class writes — the write-measure-write dance below forces a reflow per
		 * strip, which is wasted on pages polled every second. */
		if (!ul.classList.contains('fs-dense1') && !ul.classList.contains('fs-dense2') && stripFitsOneRow(ul))
			return;
		ul.classList.remove('fs-dense1', 'fs-dense2');
		if (stripFitsOneRow(ul)) return;
		ul.classList.add('fs-dense1');
		if (stripFitsOneRow(ul)) return;
		ul.classList.remove('fs-dense1');
		ul.classList.add('fs-dense2');	/* floor: leave wrapped if it still overflows */
	});
}
/* ---- does the main menu fit on the brand's row? ---------------------------
 * The desktop bar stacks its menu onto a second row only when the menu does NOT fit
 * beside the brand — and whether it fits depends on how many sections THIS ROUTER has,
 * not on how wide the screen is. A stock install renders 5 sections; a box with a few
 * luci-app-* packages renders eleven. So this is measured, not keyed off a breakpoint.
 *
 * It used to be `@media (max-width: 1199px)`. Measured on a stock router the bar's
 * contents come to ~683px (brand 109 + menu 371 + right cluster 155 + gaps), i.e. one
 * row fits down to ~723px — so that breakpoint was stacking the menu on every laptop
 * and throwing away a row of vertical space for nothing.
 *
 * Always measured in the UNSTACKED state: a stacked menu has the whole bar to itself and
 * would of course "fit", which would flip it straight back — the classic layout
 * oscillation. So: unstack → let the density steps try to squeeze it → stack only if even
 * the tightest step still wraps → then let the density relax, now that it owns a row. */
/* ---- does the CONTENT column still have room, once the sidebar has taken its cut? -------
 *
 * The vertical sidebar gives way to the bar when what is LEFT for the content would be too
 * narrow to read. That used to be `@media (max-width: 767px)`, which said nothing about the
 * thing that actually matters — and could not, because the sidebar's cut is not a constant:
 * it is 224px expanded and 68px collapsed to the rail. One viewport breakpoint therefore
 * gave the two states the same answer, when the whole point of collapsing the sidebar is to
 * hand ~156px BACK to the content. So the rail folded away at the same width as the
 * expanded sidebar, and the room it had just freed bought the user nothing.
 *
 * Measured instead: the sidebar's real cut, subtracted from the real viewport. The rail now
 * keeps its column ~156px further down than the expanded sidebar does.
 *
 * The widths are CONSTANTS, not read from the rendered sidebar — deliberately. Reading the
 * live width would make the answer depend on the state it is deciding (once the sidebar is
 * a bar it has no cut at all, so the content "fits", so it un-narrows, so it cuts again):
 * an oscillation. A constant makes the decision a pure function of the viewport. */
/* The numbers come from the STYLESHEET, which is the thing that actually lays the sidebar
 * out — they are not restated here.
 *
 * They used to be: `CONTENT_MIN = 500, SIDEBAR_W = 224, RAIL_W = 68, CONTENT_PAD = 56`,
 * against bare `224px` / `68px` literals in theme/20-shell.css and a `--fs-content-pad`
 * token this file doubled by hand. Two copies of one number, in two languages, with nothing
 * to hold them together: narrow the rail in the CSS and this measurement goes on subtracting
 * the old width, silently deciding the content still fits when it does not — and no gate in
 * the build can see it. (20-shell.css even referred to a "--fs-content-min" token, which did
 * not exist; the value lived only here.) They are tokens now, in 02-tokens.css, and this
 * reads them back.
 *
 * Read once and memoised: fitShell runs on every resize and every content mutation, and
 * getComputedStyle forces a style recalc. The fallbacks are the historical values — a
 * browser that somehow hands us an empty custom property must not turn the whole shell
 * measurement into NaN (`NaN < NaN` is false, so the sidebar would simply never yield). */
let _geom = null;
function shellGeometry() {
	if (_geom) return _geom;
	const cs = getComputedStyle(document.documentElement);
	const px = (name, dflt) => {
		const v = parseFloat(cs.getPropertyValue(name));
		return Number.isFinite(v) ? v : dflt;
	};
	_geom = {
		contentMin: px('--fs-content-min', 500),
		sidebarW:   px('--fs-sidebar-w', 224),
		railW:      px('--fs-rail-w', 68),
		/* the token is ONE side's padding; the column loses it twice */
		contentPad: px('--fs-content-pad', 28) * 2
	};
	return _geom;
}

function fitShell() {
	const root = document.documentElement;
	if (currentLayout() === 'top') {		/* no sidebar, no cut, nothing to decide */
		root.removeAttribute('data-narrow');
		return;
	}
	const g = shellGeometry();
	const cut = (root.getAttribute('data-rail') === 'true') ? g.railW : g.sidebarW;
	const content = window.innerWidth - cut - g.contentPad;
	if (content < g.contentMin) root.setAttribute('data-narrow', '');
	else root.removeAttribute('data-narrow');
}

function fitChrome() {
	fitShell();

	const bar = document.querySelector('.fs-sidebar');
	const menu = document.getElementById('topmenu');
	const desktopBar = !!bar && !!menu &&
		document.documentElement.getAttribute('data-layout') === 'top' &&
		window.innerWidth >= 768;

	if (bar) bar.classList.remove('fs-bar-stack');
	fitTabStrips();
	/* The menu's own pills wrapping IS the "it does not fit" signal — but only because the
	 * unstacked desktop bar is flex-wrap: nowrap (50-toplayout.css). Without that the bar
	 * would wrap itself and hand the menu a whole row, in which the menu of course "fits",
	 * and this would never fire. Do NOT measure the bar's children by offsetTop instead:
	 * the bar is align-items:center with children of different heights, so their offsetTop
	 * differs even on one row (that read as "wrapped" for a 5-section menu). */
	if (desktopBar && !stripFitsOneRow(menu)) {
		bar.classList.add('fs-bar-stack');
		fitTabStrips();
	}
}
/* The measuring, the frame-coalescing and the ResizeObserver are NOT here: they are the
 * shared engine in fs-fit.js, which the data tables use too (the two decisions are the same
 * shape — measure UNCOLLAPSED, then toggle a class). fitChrome is registered with it in
 * init(); this is just the "do it soon" entry point the chrome's own callers use. */
function scheduleTabFit() {
	fit.schedule();
}
/* Did this batch of mutations actually add or remove a tab strip?
 *
 * The observer below exists for exactly one reason — to catch a view that renders
 * its own .cbi-tabmenu after navigation. But it used to fire fitTabStrips() on
 * ANY mutation, and LuCI's poll rewrites page content once a second, so on a
 * polled page (Overview, Processes) we measured every strip on the page every
 * second: getClientRects() and offsetTop are layout reads, i.e. a forced synchronous
 * reflow per strip per tick, to discover the tabs had not moved. Nothing here
 * depends on content, only on strips appearing; width changes are covered by the
 * resize listener above. */
/* `removed: true` — a strip DISAPPEARING matters here too (the density classes were sized for
 * a menu that is no longer on the page), which is the one way this differs from fs-select's
 * use of the same helper. */
function tabStripTouched(mutations) {
	return fit.touches(mutations, '.tabs, .cbi-tabmenu', { removed: true });
}
let _tabFitWired = false;
function wireTabFit() {
	if (_tabFitWired) return;
	_tabFitWired = true;
	window.addEventListener('resize', scheduleTabFit);
	/* catch a view rendering its own .cbi-tabmenu after navigation */
	new MutationObserver((mutations) => {
		if (tabStripTouched(mutations)) scheduleTabFit();
	}).observe(document.body, { childList: true, subtree: true });
}

/* modes -> #modemenu; drives the injected renderMainMenu for the active mode */
function renderModeMenu(tree, renderMainMenu) {
	const ul = document.querySelector('#modemenu');
	const children = ui.menu.getChildren(tree);

	children.forEach((child, index) => {
		const isActive = L.env.requestpath.length
			? child.name === L.env.requestpath[0]
			: index === 0;

		/* the main menu must render even if a template variant has no #modemenu —
		 * only the mode list itself is skippable chrome */
		if (ul)
			ul.appendChild(E('li', { 'class': isActive ? 'active' : '' }, [
				E('a', { 'href': L.url(child.name) }, [ _(child.title) ])
			]));

		if (isActive)
			renderMainMenu(child, child.name);
	});

	if (!ul)
		return;
	if (children.length <= 1)
		ul.classList.add('single');
	if (ul.children.length > 1)
		ul.style.display = '';
}

/* The Appearance popover's axes. ALL of them are client-side, instant and persisted in
 * localStorage — no server, no reload — and head.ut's inline script re-applies them before
 * paint, so a reload never flashes the wrong one (tools/axes.mjs holds the two copies to the
 * same contract):
 *
 *   Layout (sidebar|top) · Theme (auto|light|dark) · Palette (footstrap|hicontrast) ·
 *   Wallpaper (off|cats) · Tint (hue) · Accent (hue) · Rounding (0-20px) ·
 *   Submenus (keep-open|auto-collapse) · Updates (check|off)
 *
 * Layout is NOT a server choice and is NOT in the stock "Design" dropdown — there is one
 * theme entry. The only server involvement is a DEFAULT for a router migrated from the old
 * top-nav theme (luci.main.footstrap_layout), which the user's own choice then overrides. */
function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
function lsDel(k) { try { localStorage.removeItem(k); } catch (e) {} }

function currentMode() {
	const s = lsGet('fs-darkmode');
	return s === 'true' ? 'dark' : (s === 'false' ? 'light' : 'auto');
}
function currentPalette() {
	const s = lsGet('fs-palette');
	/* legacy 'rvht'/'roman' were the default colours + the cats wallpaper — head.ut
	 * migrates them to fs-wallpaper=cats + the default palette before paint, so here
	 * they read as the default. */
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
/* ---- dark mode is announced in three dialects, because apps SNIFF for it ---------------
 *
 * A third-party app ships its own dark styles and has to guess whether the page is dark. There
 * is no standard for that, and a survey of what LuCI apps actually do turned up exactly three
 * dialects: an attribute on :root (`data-theme="dark"` — `luci-app-justclash` keys 21 rules off
 * it), Bootstrap's `data-bs-theme` (`luci-app-ssclash` reads it first), and, when neither is
 * present, the LUMINANCE of the body background (ssclash's fallback — the only one that needs no
 * cooperation from the theme, and the reason its editor chrome is right today).
 *
 * We stamp all three names for the same fact. Measured on the router before this: every one of
 * justclash's `[data-theme="dark"]` rules was dead, so its LIGHT fills were what a dark page
 * rendered. The cost is two attributes; the alternative is every app that supports dark mode
 * looking broken under this theme and correct under the theme it was written against.
 *
 * `data-darkmode` remains the name the theme's OWN CSS keys off. The other two are OUTBOUND
 * compatibility — exactly like the `--*-color-*` export tier — and nothing inside `styles/` may
 * read them; `tools/axes.mjs` fails the build if it does. */
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
/* "Auto" means "follow the OS" — but it only did so at page load, so an OS that
 * flips to dark on its own schedule left the open page in light until a reload. */
_mqDark.addEventListener('change', () => {
	if (currentMode() === 'auto') applyMode('auto');
});
function applyPalette(val) {
	const root = document.documentElement;
	/* footstrap (GitHub colours) is the default = bare :root, no attr; hicontrast is
	 * the opt-in variant. Colourway blocks live in styles/03-palettes.css. */
	if (val === 'hicontrast') { lsSet('fs-palette', 'hicontrast'); root.setAttribute('data-palette', 'hicontrast'); }
	else { lsDel('fs-palette'); root.removeAttribute('data-palette'); }
}

/* Corner-radius axis: one base value (the card radius, 0–20px) set as an inline
 * --fs-radius-base on :root; styles/02-tokens derives the control/chip radii from
 * it so every surface rounds in step. Default 12 clears the override entirely.
 * head.ut pre-paints it before first paint (no reflow on load). */
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

/* Background-tint axis: ONE hue (0–360°) washed into the CANVAS the cards float on
 * (--fs-bg — the same surface the cats wallpaper tiles over), so a whole install
 * reads as green / violet / amber at a glance and you can tell which router the tab
 * (or the screenshot in a ticket) belongs to. Cards, chrome and the status colours
 * keep the palette's values — the cue colours the paper, not the UI. The tint itself
 * is done in CSS — :root[data-tint] + an inline --fs-tint-h; see the TINT block in
 * 03-palettes.css for why the mix is contrast-safe on every hue.
 *
 * 0 IS "OFF", not "red": a hue wheel wraps, so 360 is the same red and nothing is
 * lost by spending one end of the slider on the off state — which a hue axis
 * otherwise has no room for (there is no "no colour" hue). Off clears the attribute
 * entirely, so an untinted router costs exactly the CSS the palette already had.
 * head.ut pre-paints it before first paint, so a reload doesn't flash the neutral
 * palette first. */
/* ---- the HUE axis, written once --------------------------------------------------
 *
 * Tint and Accent are the same axis pointed at two different things, and they were written
 * out twice: same 1-360 validation, same "0 is off", same clamp, same removeAttribute +
 * removeProperty on the off path, and the same load-bearing ORDERING rule (set the custom
 * property BEFORE the attribute, or a fresh load paints one frame with the previous hue).
 * Three names differed; forty lines did not.
 *
 * That ordering rule is exactly the kind of thing that gets fixed in one copy and not the
 * other — so it now exists once. A third hue axis is three arguments away.
 *
 * The other seven Appearance axes are NOT folded in with them, and that is deliberate: each
 * has a real quirk that a table would have to grow an option for. `mode` stores a value that
 * is not the value it applies (tri-state → matchMedia) and owns an MQL listener; `radius`
 * sets an inline custom property with no attribute, and its default sits in the MIDDLE of the
 * range, so "clear the key" is not an end of the slider; `layout` reads the ATTRIBUTE rather
 * than localStorage (the server-migrated default) and writes its default explicitly; and
 * `autoCollapse`/`updateCheck` have no `:root` attribute at all and dispatch events instead.
 * Five short functions beat one table with five optional hooks. */
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
				 * order paints one frame with the previous hue (or hue 0) on a fresh load. */
				root.style.setProperty(prop, String(v));
				root.setAttribute(attr, '');
			}
		}
	};
}

const TINT = hueAxis('fs-tint', 'data-tint', '--fs-tint-h');
const currentTint = TINT.current, applyTint = TINT.apply;

/* Accent-hue axis: ONE hue (0–360°) that recolours the UI accent — the solid buttons,
 * the toggle knobs, the range sliders, the focus rings, the accented links — while the
 * canvas, cards and status colours (good/warn/danger) stay put. Unlike the tint (which
 * hues the paper), this hues the CHROME. Done in CSS: :root[data-accent] rotates the
 * hue of --fs-accent/--fs-accent-lt via oklch(from … l c H), keeping the palette's
 * lightness and chroma so --fs-on-accent stays legible on every hue (03-palettes.css).
 *
 * 0 IS "OFF" (the palette's designed accent), same rationale as the tint: a hue wheel
 * wraps, so spending one end on the off state loses nothing, and off clears the
 * attribute so an un-recoloured router costs exactly the palette it already had.
 * head.ut pre-paints it, so a reload doesn't flash the default accent first. */
const ACCENT = hueAxis('fs-accent', 'data-accent', '--fs-accent-h');
const currentAccent = ACCENT.current, applyAccent = ACCENT.apply;

/* Layout axis: the vertical sidebar (default) vs the horizontal top bar. Both are
 * ONE template and ONE menu renderer now — the layout is a client class, morphed by
 * CSS keyed off :root[data-layout='top'] (head.ut pre-paints it, so no flash), the
 * same way dark-mode is. Toggling needs NO menu re-render: the DOM already serves
 * both, and the sidebar menu's MutationObserver on data-layout folds/restores the
 * accordion (menu-footstrap.js).
 *
 * currentLayout() reads the ATTRIBUTE, not localStorage, so the control reflects
 * what is actually painted — which for a router migrated from the old top-nav theme
 * is the SERVER default (luci.main.footstrap_layout=top, applied in head.ut) even
 * with no localStorage yet.
 *
 * applyLayout() is the one axis that writes its DEFAULT value EXPLICITLY instead of
 * clearing the key: a migrated router carries that server default, and lsDel would
 * let it re-assert 'top' on the next load. localStorage always wins over the server
 * default, so it must record the deliberate choice, not its absence. */
/* head.ut stamps :root[data-layout] server-side and the pre-paint script overrides it
 * from localStorage, so the attribute always carries an explicit value. Read it — do
 * NOT read localStorage here, or a router whose default is 'top' (migrated from the
 * old top-nav theme) would report 'sidebar' until the user first touched the toggle. */
function currentLayout() {
	return document.documentElement.getAttribute('data-layout') === 'top' ? 'top' : 'sidebar';
}
function isTopLayout() {
	return currentLayout() === 'top';
}
function applyLayout(val) {
	const layout = (val === 'top') ? 'top' : 'sidebar';
	/* ALWAYS an explicit value, never a removed attribute: every layout rule matches
	 * data-layout POSITIVELY (:root[data-layout='sidebar'] / ='top'), so that a future
	 * third layout has to opt in to a rule rather than inherit it by not being 'top'.
	 * head.ut stamps the same attribute server-side, so it is never absent. */
	lsSet('fs-layout', layout);
	document.documentElement.setAttribute('data-layout', layout);
	/* the bar and the column have completely different room for the menu, so the
	 * fits-on-one-row measurement has to be re-taken. Nothing else re-renders. */
	scheduleTabFit();
}

/* Sidebar accordion behaviour: with auto-collapse on, opening a section folds
 * every other one back (one open at a time); off (default, and the historical
 * behaviour) they stack. Only meaningful for the expanded sidebar — the rail
 * flyouts and the mobile bar are always exclusive. Read by menu-footstrap.js. */
function currentAutoCollapse() {
	return lsGet('fs-menu-autocollapse') === 'true';
}
function applyAutoCollapse(val) {
	const on = (val === 'on');
	if (on) lsSet('fs-menu-autocollapse', 'true');
	else lsDel('fs-menu-autocollapse');

	/* switching it on with several sections already unfolded would leave the
	 * menu in a state the setting says is impossible — fold all but the active */
	if (on) {
		document.querySelectorAll('#topmenu > li.open:not(.active)')
			.forEach(li => li.classList.remove('open'));
	}

	/* This file can only reach the DOM. The sidebar layout owns two other pieces of
	 * the same state — the remembered "Keep open" set (localStorage) and the
	 * aria-expanded flag on each trigger — and neither is visible from here, so
	 * folding the sections above left them behind: the next navigation re-rendered
	 * the menu from the stale remembered set and unfolded everything again. Tell the
	 * layout instead of reaching across into it. */
	document.dispatchEvent(new CustomEvent('fs-autocollapse', { detail: { on } }));
}

/* ---------------------------------------------------------------------------
 * Disclosure primitives, shared by both layouts' menus.
 *
 * The sidebar and the top-nav render different markup, but a section header is
 * the SAME W3C-APG disclosure control in both: an <a role="button"> that owns a
 * panel it can show and hide. These three helpers used to be written out once per
 * menu file — and the copies had already drifted apart (only the sidebar's Escape
 * handler learnt to check flyout mode), which is the whole argument for hoisting
 * them here. What stays layout-specific is the SELECTOR, so each is a parameter.
 * ------------------------------------------------------------------------- */

/* The `.open` class and aria-expanded must never disagree — `.open` alone told a
 * sighted user everything and a screen-reader user nothing — so every open and
 * close in both layouts goes through this one function. `linkSel` is the layout's
 * trigger: the sidebar's bare `:scope > a`, the top-nav's `:scope > a.menu`. */
function setOpen(li, on, linkSel) {
	li.classList.toggle('open', on);
	li.querySelector(linkSel)?.setAttribute('aria-expanded', on ? 'true' : 'false');
}

/* An <a role="button"> is given Enter by the browser but NOT Space, and a
 * disclosure control has to answer both. */
function wireSpaceKey(link) {
	link.addEventListener('keydown', (ev) => {
		if (ev.key !== ' ' && ev.key !== 'Spacebar') return;
		ev.preventDefault();
		link.click();
	});
}

/* Dismissal, both ways round:
 *  - click outside the menu closes it;
 *  - WCAG 2.2 SC 1.4.13 (Content on Hover or Focus) — a panel revealed by hover or
 *    focus must be dismissible from the KEYBOARD, and the disclosure pattern wants
 *    focus handed back to the trigger that opened it.
 * `when` is what lets the sidebar restrict both to flyout mode, where its `.open`
 * means "popup panel" rather than "unfolded accordion" — closing an accordion
 * because the user clicked elsewhere on the page would be wrong. */
function wireDismiss(opts) {
	const active = () => (opts.when ? opts.when() : true);

	document.addEventListener('click', (ev) => {
		if (active() && !ev.target.closest(opts.inside))
			opts.close();
	});

	document.addEventListener('keydown', (ev) => {
		if (ev.key !== 'Escape' || !active()) return;
		const open = document.querySelector(opts.open);
		if (!open) return;
		const trigger = open.querySelector(opts.trigger);
		opts.close();
		trigger?.focus();
	});
}

/* One segmented control; highlights the active option, calls onPick on change.
 *
 * `label` is not decoration: the visible caption is a sibling <div class="fs-ap-label">
 * that nothing associated with the control, and the selected option was carried by
 * a CSS class alone. A screen reader got an unnamed group of unrelated buttons with
 * no indication of which one was in effect. This is a radio group — say so. */
function segControl(current, opts, onPick, label) {
	const wrap = E('div', { 'class': 'fs-seg', 'role': 'radiogroup', 'aria-label': label || '' });
	opts.forEach(o => {
		const active = (o.val === current);
		const b = E('button', {
			'type': 'button',
			'class': active ? 'active' : '',
			'role': 'radio',
			'aria-checked': active ? 'true' : 'false',
			'data-val': o.val
		}, [ o.label ]);
		b.addEventListener('click', () => {
			onPick(o.val);
			wrap.querySelectorAll('button').forEach(x => {
				const on = (x === b);
				x.classList.toggle('active', on);
				x.setAttribute('aria-checked', on ? 'true' : 'false');
			});
		});
		wrap.appendChild(b);
	});
	return wrap;
}

/* A range slider with a live readout; onInput fires continuously as it drags.
 * Without the label and valuetext a screen reader announced a bare "slider, 12" —
 * no idea what it adjusts, and no unit.
 *
 * `opts.fmt` renders the value: it is what the READOUT says and what the screen
 * reader is told, so it is not cosmetic — the tint slider's `0` means "off", and a
 * reader announcing "0 degrees" would be announcing a hue that is not applied. */
function sliderControl(current, min, max, onInput, label, opts) {
	const o = opts || {};
	const fmt = o.fmt || (v => v + 'px');
	const out = E('span', { 'class': 'fs-range-val' }, [ fmt(current) ]);
	const input = E('input', {
		'type': 'range', 'class': 'fs-range' + (o.cls ? ' ' + o.cls : ''),
		'min': String(min), 'max': String(max), 'step': String(o.step || 1), 'value': String(current),
		'aria-label': label || '',
		'aria-valuetext': fmt(current)
	});
	input.addEventListener('input', () => {
		const v = parseInt(input.value, 10);
		out.firstChild.data = fmt(v);
		input.setAttribute('aria-valuetext', fmt(v));
		onInput(v);
	});
	return E('div', { 'class': 'fs-rangewrap' }, [ input, out ]);
}

/* ---- SPA client router (variant C) ---------------------------------------
 *
 * Kills the full page reload for `view`-type menu nodes — measured on the dev router,
 * 54 of 74 menu leaves (~73%); the rest are `call`/`function`/`template`. LuCI
 * already renders every page client-side into #view (LuCI.view.__init__ →
 * load()→render()); only *navigation* is server-dispatched. So we intercept
 * link clicks, and instead of a full GET we re-instantiate the target view in
 * place — the exact thing the stock dispatcher's view.ut does via
 * ui.instantiateView(), minus the page reload.
 *
 * Safety: this is purely additive theme JS. Anything that is NOT a satisfied
 * `view` node (call/function/template/alias/firstchild, external links,
 * downloads, cross-origin, modified clicks) or any error falls through to a
 * normal browser navigation. Deep links / F5 keep working because we pushState
 * the real dispatcher URL. Other themes are unaffected.
 *
 * Re-instantiation detail: L.require('view.x') returns a cached *singleton*
 * whose __init__ (the render) already ran once, so calling it again won't
 * repaint. We instead grab the class off the instance (Class sets
 * prototype.constructor = the constructor) and `new v.constructor()` to run a
 * fresh __init__ → fresh load()+render() into #view — identical to a full load,
 * which always starts from a fresh instance anyway. See docs/14. */

let _tree = null, _renderMain = null, _wired = false;
/* The pathname whose view is CURRENTLY rendered. The popstate handler compares against it to
 * tell a real navigation from a mere fragment change (an `<a href="#">` inside a view, which
 * Chrome delivers here as a popstate — see the note there). Seeded from the page we were
 * served, then kept in step by navigate(). */
let _curPath = window.location.pathname;
/* navigation generation token: two quick clicks race their async require()s, and
 * without this the FIRST view could render into #view after the second, leaving
 * stale content under the newer URL/title/chrome. Each committed navigation bumps
 * the generation; a resolved require whose generation is stale renders nothing. */
let _navGen = 0;
/* the self-update poll chain reschedules itself with a raw setTimeout (only
 * setInterval is hooked above), so navigate() must be able to cancel it — or it
 * keeps firing fs.exec RPCs and can pop its modal onto an unrelated page. */
let _updTimer = null;
/* ...but clearing the timer is not enough on its own. If the user navigates while
 * an fs.exec('status') is ALREADY in flight (rpctimeout is 20 s, so that window is
 * wide), there is no timer to clear — and when the RPC resolves it schedules the
 * next tick and can throw its modal over whatever page the user is now looking at.
 * A generation token kills the chain at the point where it would resurrect itself. */
let _updGen = 0;

/* rebuild mode menu + main menu + section tabs from the current L.env; called
 * on first load and after every SPA navigation. Clears the containers first so
 * a re-render doesn't stack duplicates. */
function renderChrome() {
	const modemenu = document.querySelector('#modemenu');
	const topmenu  = document.querySelector('#topmenu');
	const tabmenu  = document.querySelector('#tabmenu');

	if (modemenu) { modemenu.innerHTML = ''; modemenu.style.display = 'none'; modemenu.classList.remove('single'); }
	if (topmenu)  topmenu.innerHTML = '';
	if (tabmenu)  { tabmenu.innerHTML = ''; tabmenu.style.display = 'none'; }

	renderModeMenu(_tree, _renderMain);

	if (L.env.dispatchpath.length >= 3) {
		let node = _tree, url = '';
		for (let i = 0; i < 3 && node; i++) {
			node = node.children[L.env.dispatchpath[i]];
			url = url + (url ? '/' : '') + L.env.dispatchpath[i];
		}
		if (node)
			renderTabMenu(node, url);
	}

	scheduleTabFit();
}

/* /cgi-bin/luci/admin/status/overview -> ['admin','status','overview'].
 * The bare base (/cgi-bin/luci/, what dispatcher.build_url() emits for the brand
 * wordmark link) yields an EMPTY seg list, NOT null: it is a valid LuCI path — the
 * dispatcher's root node is itself a `firstchild`, so resolveSegs([]) walks
 * root -> admin -> status -> overview exactly as the server does on a full GET of
 * the base. Returning null here made navigate() treat the wordmark as un-routable
 * and fall back to a full page reload. null stays reserved for a path that is not
 * under LuCI's scriptname at all. */
function segsFromPath(pathname) {
	const base = L.env.scriptname || '';
	if (base && pathname.indexOf(base) !== 0)
		return null;
	const rest = pathname.slice(base.length).replace(/^\/+|\/+$/g, '');
	return rest.length ? rest.split('/') : [];
}

/* walk the (scrubbed, ACL-filtered) menu tree to the node for a path */
function nodeForSegs(segs) {
	let node = _tree;
	for (let i = 0; i < segs.length; i++) {
		node = node && node.children && node.children[segs[i]];
		if (!node) return null;
	}
	return node;
}

/* ---- alias / firstchild resolution ---------------------------------------
 *
 * 7 of the 27 links the menu renders are not pages but redirects: 4 `alias`
 * (Firewall, System Log, Realtime Graphs, and any app that groups its tabs that
 * way) and 3 `firstchild` (Administration, Terminal, Attended Sysupgrade). They
 * used to be the router's blind spot — viewClassFor() saw a non-`view` action and
 * fell through to a full page load, so the most-clicked entries in the whole menu
 * were the ones that still reloaded.
 *
 * The server does not redirect them: a full GET of /admin/status/logs answers 200
 * at that URL and stamps the *resolved* leaf into requestpath/dispatchpath/nodespec
 * (verified against the live router), keeping `pathinfo` as the requested path. So
 * the client can do the same resolution — and must do it EXACTLY the way
 * dispatcher.uc does, or a click and an F5 on the same URL would open different
 * pages. Hence node_weight() and the firstchild rules below are ports, not
 * approximations. The one thing skipped is the ACL check: the menu tree the client
 * is handed by /admin/menu is already ACL-filtered for this session.
 *
 * `rewrite` is deliberately NOT followed. The tree has none, and a wrong guess at
 * its splice semantics would silently open the WRONG page — strictly worse than
 * the full load it would fall back to. */

/* node_weight() from dispatcher.uc: lower wins; a login node sorts last. */
function nodeWeight(node) {
	return Math.min(node.order ?? 9999, 9999) + (node.auth && node.auth.login ? 10000 : 0);
}

/* resolve_firstchild() from dispatcher.uc: the eligible child of lowest weight.
 * Ties go to the first in tree order (the comparison is strict, as upstream's is,
 * and JSON.parse preserves key order). A `firstchild` child is only eligible if it
 * resolves to something itself — recursively. */
function firstChildOf(node) {
	let bestName = null, best = null;
	const kids = node.children || {};
	for (const name in kids) {
		const child = kids[name];
		if (!child.satisfied || !child.title || !child.action || typeof child.action !== 'object')
			continue;
		if (child.action.type === 'firstchild') {
			if ((!best || nodeWeight(best) > nodeWeight(child)) && firstChildOf(child)) {
				best = child; bestName = name;
			}
		} else if (!child.firstchild_ineligible) {
			if (!best || nodeWeight(best) > nodeWeight(child)) {
				best = child; bestName = name;
			}
		}
	}
	return best ? { name: bestName, node: best } : null;
}

/* Follow alias/firstchild to the real page. Returns {segs, node} of the leaf the
 * dispatcher would have rendered, or null when nothing resolves (the server would
 * 404 — let it). The hop cap is a cycle guard: an alias loop in some app's menu.d
 * must not hang the UI. */
function resolveSegs(segs) {
	let node = nodeForSegs(segs);
	for (let hops = 0; node && node.action && hops < 8; hops++) {
		const type = node.action.type;
		if (type === 'alias') {
			segs = String(node.action.path).split('/');
			node = nodeForSegs(segs);
		} else if (type === 'firstchild') {
			const pick = firstChildOf(node);
			if (!pick) return null;
			segs = segs.concat([ pick.name ]);
			node = pick.node;
		} else {
			return { segs, node };
		}
	}
	return null;
}

/* The view class a menu node instantiates, or null if the node isn't SPA-able.
 * Normal `view` nodes derive it from action.path; the Status→Overview `template`
 * node maps to view.status.index (its server template just instantiates that —
 * see ensureOverviewHelpers). Shared by navigate() and the hover prefetch. */
function viewClassFor(node) {
	if (!node || !node.action || node.satisfied === false)
		return null;
	if (node.action.type === 'view')
		return 'view.' + String(node.action.path).replace(/\//g, '.');
	if (node.action.type === 'template' && node.action.path === 'admin_status/index')
		return 'view.status.index';
	return null;
}

/* The view class the page CURRENTLY on screen wants — i.e. what _curPath resolves to.
 * Read by the stale-render repair below to tell "the superseded render happened to paint
 * the right view anyway" from "it painted the wrong one". */
function currentViewClass() {
	const segs = segsFromPath(_curPath);
	const res = segs && resolveSegs(segs);
	return viewClassFor(res && res.node);
}

/* ---- a superseded FIRST render cannot be cancelled, so undo it -----------------------
 *
 * _navGen stops a stale require() from calling `new view.constructor()` — but that only
 * covers the CACHED path. On a FIRST visit the require() *is* the render (see the long note
 * in navigate()): LuCI's require constructs the view, and a view's __init__ runs
 * load() → render() → dom.content(#view) and registers its pollers. That construction is
 * already under way inside a promise we do not own; there is nothing to cancel.
 *
 * So the fast double-click is a real bug, not a theoretical one: click Firewall (uncached —
 * module fetch plus its load() RPCs, seconds on a slow router), then click Wireless 100 ms
 * later. navigate(Wireless) flushes L.Poll's queue BEFORE Firewall's poller is ever added.
 * Firewall's load() then resolves, paints into the #view that now belongs to Wireless, and
 * registers its poller — which the flush can no longer catch. The user is left with Wireless
 * in the URL, the title, the menu and body[data-page], Firewall's content on screen, and
 * Firewall's poller running on every page they visit afterwards. Returning quietly on a
 * stale generation left all of that standing.
 *
 * Repair by re-running the navigation that is actually current: navigate() is exactly the
 * "put the document back the way a fresh load leaves it" routine — it flushes the poll
 * queue, kills stray intervals, hides stray modals and re-instantiates the view. push is
 * false: the URL never moved, only the DOM under it did. If it declines (the superseded view
 * injected CSS into <head>), the reload does the same job the hard way.
 *
 * The className check is what terminates this. If the superseded render painted the class the
 * current path wants anyway (click A → B → A while A was still loading), the DOM is correct
 * and its poller is the one this page needs — repairing would re-render for nothing, and with
 * two uncached views racing it is also what would let a repair trigger a repair. */
function repairStaleRender(className) {
	if (className === currentViewClass())
		return;
	console.warn('footstrap: a superseded view (' + className + ') rendered into the live page; re-rendering ' + _curPath);
	if (!navigate(_curPath, false))
		window.location.reload();
}

/* Build the exact URL LuCI.require() will fetch for a class name, cache-bust and
 * all (base_url/<dotted→slashed>.js?v=resource_version). Matching it byte-for-byte
 * is what makes a hover prefetch a warm cache hit for the subsequent require(). */
function moduleUrl(className) {
	const v = L.env.resource_version ? ('?v=' + L.env.resource_version) : '';
	return (L.env.base_url || '') + '/' + className.replace(/\./g, '/') + '.js' + v;
}

/* Hover prefetch: on pointerenter of a link to an SPA-able view, warm the browser
 * HTTP cache for its module JS with a plain fetch() — NOT require(): require would
 * run the class __init__ and render another page's view into #view. The later
 * click's require() then hits cache instead of the network (−10–40 ms LAN on the
 * first visit to a page, more on WAN/VPN). Deduped per class; failures are silent
 * (it's a pure optimisation). Static resource, so same-origin credentials are moot. */
/* view classes this router has already required — i.e. the ones LuCI has an instance
 * cached for. A class NOT in here is rendered by the require() itself (see navigate). */
const _seen = new Set();
const _prefetched = new Set();
function prefetchView(pathname) {
	const segs = segsFromPath(pathname);
	if (!segs) return;
	const res = resolveSegs(segs);
	const className = viewClassFor(res && res.node);
	if (!className || _prefetched.has(className)) return;
	_prefetched.add(className);
	try { fetch(moduleUrl(className), { credentials: 'same-origin' }).catch(() => {}); } catch (e) {}
}

/* Status→Overview is a `template` node whose server template (admin_status/index.ut)
 * defines 3 global helpers used by the stock status includes
 * (18_cpu/20_memory/25_storage/30_network …) and then instantiates
 * view.status.index. Reaching overview via SPA never runs that inline <script>,
 * so define the helpers here — idempotent, guarded so a prior full load's copies
 * are not clobbered. Bodies are verbatim from admin_status/index.ut, except
 * L.itemlist -> window.L.itemlist: itemlist lives on the augmented runtime
 * singleton, not the bare module-`L` this factory receives (the two-L trap,
 * docs/14). `E`/`String`/`.format` are true globals so they need no change. */
function ensureOverviewHelpers() {
	/* eslint-disable no-var -- these three bodies are copied VERBATIM from LuCI's
	   admin_status/index.ut so they can be diffed against upstream when it changes.
	   Modernising the `var`s would silently break that property, which is the whole
	   reason the copies are safe to carry. */
	if (typeof window.progressbar != 'function')
		window.progressbar = function(query, value, max, byte) {
			var pg = document.querySelector(query),
			    vn = parseInt(value) || 0,
			    mn = parseInt(max) || 100,
			    fv = byte ? String.format('%1024.2mB', value) : value,
			    fm = byte ? String.format('%1024.2mB', max) : max,
			    pc = Math.floor((100 / mn) * vn);
			if (pg) {
				pg.firstElementChild.style.width = pc + '%';
				pg.setAttribute('title', '%s / %s (%d%%)'.format(fv, fm, pc));
			}
		};
	if (typeof window.renderBox != 'function')
		window.renderBox = function(title, active, childs) {
			childs = childs || [];
			childs.unshift(window.L.itemlist(E('span'), [].slice.call(arguments, 3)));
			return E('div', { class: 'ifacebox' }, [
				E('div', { class: 'ifacebox-head center ' + (active ? 'active' : '') },
					E('strong', title)),
				E('div', { class: 'ifacebox-body left' }, childs)
			]);
		};
	if (typeof window.renderBadge != 'function')
		window.renderBadge = function(icon, title) {
			return E('span', { class: 'ifacebadge' }, [
				E('img', { src: icon, title: title || '' }),
				window.L.itemlist(E('span'), [].slice.call(arguments, 2))
			]);
		};
	/* eslint-enable no-var */
}

/* ---- a view's injected CSS: never DELETE it, and leave a poisoned document by a real load ----
 *
 * A view may inject a <style> into <head> at render time. On a full page load that stylesheet is
 * discarded with the document, so it only ever affects the page that asked for it. Our SPA nav
 * never reloads, so it stays in <head> and goes on restyling every page visited afterwards.
 *
 * That is not cosmetic. `luci-app-filemanager` injects
 *     .cbi-button-apply, .cbi-button-reset, .cbi-button-save:not(.custom-save-button)
 *         { display: none !important }
 * (it hides the stock buttons because it has its own), and being UNLAYERED with !important it
 * outranks every cascade layer. Measured on the router: open the file manager once, then go to
 * System → Save and Reset are GONE, and stay gone until a full reload. Any config page touched
 * after visiting that app is unsavable.
 *
 * The router used to answer that by DELETING every injected <style> on nav, alongside the
 * outgoing view's pollers, its stray setIntervals and its open modals. **Deleting CSS does not
 * belong in that family**, and the difference is what broke SSClash. A poller can always be
 * re-registered by re-rendering the view; a stylesheet only comes back if whoever injected it
 * injects it AGAIN — and a library that imports its CSS at MODULE EVAL never will, because its
 * module is cached for the life of the document. ACE is exactly that: `ace_editor.css` (14 KB —
 * the absolutely-positioned layers, the gutter, the line boxes) is imported once per document,
 * while its THEME and MODE sheets ride along with the per-editor lazy-loaded files and do come
 * back. Measured: open SSClash → Configuration, SPA-nav to Log and back, and the editor is a
 * black rectangle with no text — the theme repainted it, the structure never returned — and the
 * unpositioned layers blow the page out to 2 007 346 px tall. Deletion was silently one-way.
 *
 * So the sweep is gone. Two facts decide what replaces it:
 *
 *  1. A sheet that can only match its OWN app's widgets is inert everywhere else. Ace's four
 *     sheets name nothing but `.ace_*` (and `[ace_nocontext]`); the stock overview's CPU include
 *     names `.cpu-status-view-mode-entry`. Left in <head> they restyle exactly nothing on the
 *     next page — so leave them, and ace keeps working across SPA navs.
 *  2. A sheet that reaches into the widget universe the THEME itself styles (`.cbi-button-save`,
 *     `pre`, `:root`, …) can repaint any page — and, being unlayered, outranks every layer. That
 *     document is spent. We cannot delete our way out of it (fact 1's libraries would die), so we
 *     leave it standing and refuse to hand it to another view: the nav falls back to a REAL page
 *     load. The outgoing app keeps the CSS it is still using, the incoming page starts from a
 *     clean document, and the cost is one ordinary navigation — exactly what stock LuCI does on
 *     every link, on every theme. Speed is traded, never correctness, and only on pages that
 *     inject invasively.
 *
 * `invasiveSheet()` is that test, and its universe is not a hand-written list of names: it is
 * read back from cascade.css itself (same-origin, so `cssRules` is readable), so it tracks the
 * theme instead of drifting from it. Two shapes count as invasive — a selector naming a class or
 * id the theme styles, and a selector with no class/id/attribute at all (`pre`, `*`, `:root`),
 * which matches stock markup by construction. Everything else is namespaced to its author.
 * Measured on the router: 0.3 ms per nav, and it correctly splits ace + the CPU include (kept)
 * from the file manager's blob (real load).
 *
 * WHAT IS EXEMPT, and why:
 *  - `[data-fs-shell]` — the ONE <style> the server emits (partials/head.ut). It belongs to the
 *    document, not to a view. Marked server-side rather than guessed at.
 *  - anything inside `#view` — dies with the content swap on its own; it can never outlive the
 *    view, so it can never poison another page.
 *  - LuCI core injects no <style> at runtime at all (checked: luci.js, ui.js, cbi.js), so every
 *    other one in the document came from a view.
 * Self-healing: the full load produces a document with no view CSS in it, so SPA nav resumes
 * immediately after. One slow navigation per poisoned page, not a mode the session gets stuck in.
 *
 * If cascade.css cannot be read at all (no universe), every view sheet counts as invasive — the
 * conservative answer is the slow one, never the broken one. */
let _themeNames = null;

function themeNames() {
	if (_themeNames) return _themeNames;
	const names = new Set();	/* every class and id the theme styles */
	const props = new Set();	/* every custom property it declares or reads */
	const walk = (rules) => {
		for (const r of rules) {
			if (r.selectorText)
				(r.selectorText.match(/[.#][A-Za-z_][\w-]*/g) || []).forEach((n) => names.add(n));
			if (r.cssText)
				(r.cssText.match(/--[A-Za-z_][\w-]*/g) || []).forEach((p) => props.add(p));
			if (r.cssRules) walk(r.cssRules);
		}
	};
	for (const ss of document.styleSheets) {
		if (!ss.href || !(/\/cascade\.css/).test(ss.href)) continue;
		try { walk(ss.cssRules); } catch (e) { return null; }
	}
	_themeNames = names.size ? { names, props } : null;
	return _themeNames;
}

/* A rule whose SELECTOR is bare (`:root`, `pre`, `*`) still cannot touch us if none of its
 * DECLARATIONS can: a custom property this theme never reads is inert — it sits in the cascade
 * doing nothing but waiting for the app's own CSS to `var()` it.
 *
 * This is not a nicety, it is the difference between an app costing a full page load and not.
 * `luci-app-temp-status` (top-30 by stars) opens with `:root { --app-temp-status-temp: #147aff; … }`,
 * and `luci-app-filemanager`'s hex editor with `:root { --clr-background: … }` — namespaced, inert,
 * and both would otherwise have been read as "this document is spent" on the strength of the
 * selector alone.
 *
 * What still counts as invasive here, and why each is right:
 *  - any STANDARD property on a bare selector — `:root { color-scheme: light dark }` is exactly what
 *    the stock file manager writes, and it re-points every UA widget in the document at the OS
 *    preference instead of the theme's mode;
 *  - a custom property the THEME reads — the whole point of the private `--fs-*` tier is that an app
 *    writing `--accent` or `--radius` on `:root` cannot repaint us, and the check has to keep it
 *    that way for the names we DO read. */
function inertDeclarations(rule, props) {
	const st = rule.style;
	if (!st || !st.length) return false;	/* no declarations to judge -> judge by selector */
	for (let i = 0; i < st.length; i++) {
		const p = st.item(i);
		if (p.slice(0, 2) !== '--') return false;	/* a real property: it paints something */
		if (props.has(p)) return false;			/* a custom property the theme itself reads */
	}
	return true;
}

/* true when this sheet can repaint a page that is not its own.
 *
 * A <link> whose sheet is not readable — still loading, 404, cross-origin — is invasive by
 * default: unknown CSS is treated as the dangerous kind, so the fallback is the slow path and
 * never the broken one. */
function invasiveSheet(el, universe) {
	let sheet;
	try { sheet = el.sheet; } catch (e) { return true; }
	if (!sheet) return true;

	const { names, props } = universe;
	let invasive = false;
	const walk = (rules) => {
		for (const r of rules) {
			if (invasive) return;
			if (r.selectorText) {
				for (const part of r.selectorText.split(',')) {
					const p = part.trim();
					if (!p) continue;
					/* no class, no id, no attribute anywhere: a bare type/universal selector, which
					 * matches stock markup on every page (`pre`, `*`, `svg text`, `:root`) — unless
					 * everything it declares is inert here (see inertDeclarations) */
					if (!(/[.#[]/).test(p)) {
						if (inertDeclarations(r, props)) continue;
						invasive = true;
						return;
					}
					/* A rule may name a stock widget and still be harmless, if it can only ever
					 * MATCH inside the app's own markup: `#cbi-podkop-section > .cbi-section-remove`
					 * needs podkop's section to exist, and `.bandix-table th.sortable.active` needs
					 * bandix's table. What decides it is whether the selector carries any name the
					 * theme does NOT know — that name is the app's, and it is what pins the rule to
					 * the app's subtree. A selector made ENTIRELY of stock names has nothing pinning
					 * it, and matches the same widgets on every other page.
					 *
					 * Functional pseudo-class arguments are stripped before looking for that pin,
					 * and that is the whole difference between podkop and the file manager:
					 * `.cbi-button-save:not(.custom-save-button)` mentions an app class too, but
					 * inside a NEGATION — it does not require the app's markup, it excludes it. */
					const themeHit = (p.match(/[.#][A-Za-z_][\w-]*/g) || []).some((n) => names.has(n));
					if (!themeHit) continue;
					const pinned = (p.replace(/:[a-z-]+\([^)]*\)/gi, ' ').match(/[.#][A-Za-z_][\w-]*/g) || [])
						.some((n) => !names.has(n));
					if (!pinned) { invasive = true; return; }
				}
			}
			if (r.cssRules) walk(r.cssRules);
		}
	};
	try { walk(sheet.cssRules); } catch (e) { return true; }
	return invasive;
}

/* Both element kinds count, and the <link> half is not hypothetical: `luci-app-banip` and
 * `luci-app-adblock` append `<link rel=stylesheet href=…/custom.css>` to <head> at MODULE EVAL,
 * and that file styles `.cbi-input-text` / `.cbi-input-select` — stock widgets, on every page,
 * unlayered. A <link> INSIDE the view tree is a different thing and needs no handling
 * (`luci-app-nlbwmon` does that): it dies with the content swap like any other node. */
const VIEW_SHEETS = 'style:not([data-fs-shell]), link[rel~="stylesheet"]:not([data-fs-shell])';

function documentPoisoned() {
	const names = themeNames();
	return Array.prototype.some.call(
		document.querySelectorAll(VIEW_SHEETS),
		(el) => !el.closest('#view') && (!names || invasiveSheet(el, names)));
}

/* ---- the one thing that IS safe to remove: a byte-identical second copy ----------------
 *
 * Not deleting view CSS has a cost, and an app that injects on EVERY render is where it shows:
 * `luci-app-podkop` calls injectGlobalStyles() from its render() (a 4 KB blob appended to <head>
 * with no guard), and `luci-app-mosdns` re-appends three CodeMirror <link>s the same way. Each
 * SPA re-visit adds another copy, and the copies never stop being parsed.
 *
 * Dropping an EXACT duplicate is the one deletion that cannot break anyone, and for the reason
 * the sweep failed: the rules do not go away. The surviving copy is byte-identical, so the
 * cascade is unchanged (two identical sheets resolve to the same computed value as one), and a
 * library's "have I already imported this?" check — the thing ACE's structural CSS died on —
 * still finds its sheet in the document.
 *
 * Keep the FIRST copy, not the last: it is the one already matched by any handle the app kept. */
function dedupeViewSheets() {
	const seen = new Set();
	document.querySelectorAll(VIEW_SHEETS).forEach((el) => {
		if (el.closest('#view')) return;
		const key = el.tagName + '|' + (el.tagName === 'LINK' ? el.href : el.textContent);
		if (seen.has(key)) el.remove();
		else seen.add(key);
	});
}

/* Watch <head> rather than deduping on navigation, because the copy arrives too late to catch
 * otherwise: podkop injects from its render(), which resolves AFTER the router's require() callback
 * (measured — a nav-time sweep left the document permanently carrying one stale duplicate, bounded
 * but never zero). The observer collapses the copy in the same microtask it appears in.
 *
 * It cannot loop: removing a node produces a mutation with no ADDED nodes, and the handler bails
 * unless a stylesheet was added. */
function watchViewSheets() {
	new MutationObserver((muts) => {
		for (const m of muts)
			for (const n of m.addedNodes)
				if (n.nodeName === 'STYLE' || n.nodeName === 'LINK') {
					dedupeViewSheets();
					return;
				}
	}).observe(document.head, { childList: true });
}

/* Attempt an in-place navigation to `pathname`. Returns true if handled as a
 * SPA nav (caller should preventDefault), false to let the browser do a normal
 * full navigation. `push` adds a history entry (false when replaying popstate). */
function navigate(pathname, push) {
	const segs = segsFromPath(pathname);
	if (!segs) return false;

	/* The view on screen injected CSS that can repaint any page: this document is spent, and
	 * the only exit that leaves BOTH pages correct is a real navigation. See invasiveSheet(). */
	if (documentPoisoned()) return false;

	/* `segs` is what the user clicked, `rsegs` the leaf it resolves to — the two
	 * differ for an alias/firstchild link, and a full load keeps BOTH: the URL and
	 * pathinfo stay as requested while requestpath/dispatchpath/nodespec/title carry
	 * the resolved leaf. Mirror that split exactly; collapsing it either way would
	 * make an F5 land somewhere the click did not. */
	const res = resolveSegs(segs);
	const node = res && res.node;
	const className = viewClassFor(node);
	if (!className)
		return false;
	const rsegs = res.segs;

	/* from here on the navigation is committed */
	const gen = ++_navGen;
	_curPath = pathname;	/* what is on screen from now on — read by the popstate handler */

	/* Ensure a #view container, and clear whatever the OUTGOING page left as a
	 * SIBLING of #view inside .fs-content.
	 *
	 * LuCI.view repaints #view via dom.content(), which only replaces #view's OWN
	 * children — anything a page emitted next to #view rides along untouched. The
	 * Status→Overview `template` node emits <h2 name="content">Status</h2> right
	 * there in .fs-content (footstrap hides it on the overview via a
	 * body[data-page='admin-status-overview'] rule, since the chrome already shows
	 * the title). SPA-navigating away changes data-page, so that rule stops matching
	 * and the orphaned heading became visible on EVERY page until a full reload — the
	 * "Status on all pages" bug. Sweep those strays on every nav, keeping only the
	 * chrome that legitimately outlives a page: the section tabs, server notices and
	 * <noscript>. This also serves the original purpose — a `cbi`/other template page
	 * that emits no #view of its own gets a fresh one injected into the cleared host. */
	const contentHost = document.querySelector('.fs-content');
	if (!contentHost) return false;
	Array.from(contentHost.children).forEach(c => {
		if (c.id !== 'view' && c.id !== 'tabmenu' &&
		    !c.classList.contains('alert-message') && c.nodeName !== 'NOSCRIPT')
			c.remove();
	});
	if (!document.getElementById('view')) {
		const v = document.createElement('div');
		v.id = 'view';
		contentHost.appendChild(v);
	}

	/* teardown: drop the outgoing view's pollers so they stop hitting detached DOM /
	 * wasting RPCs, then put the poll loop back into the state a FRESH PAGE LOAD leaves
	 * it in. The only non-view poller LuCI adds is the transient apply/reboot
	 * reachability check, so flushing the queue is safe.
	 *
	 * Why the re-arm matters: LuCI runs one 1 s tick and `step()` fires a queue entry
	 * only when `tick % interval == 0`. Simply leaving the OUTGOING page's tick running
	 * (what this router used to do) makes the incoming view's poller wait for the next
	 * multiple of its interval — up to `pollinterval`, 5 s. Wireless draws its station
	 * list from the first poll, so it sat spinning for 4950 ms against ~360 ms on a full
	 * load; every poll-fed section lagged the same way.
	 *
	 * stop() alone is NOT the fix: it deletes `tick`, and Poll.add() only auto-starts
	 * when `tick != null`, so the incoming pollers would never start at all. stop() then
	 * start() on an EMPTY queue leaves exactly what a fresh document has when its view is
	 * about to render — `tick = 0`, no timer armed. The view's first poll.add() then sees
	 * `tick != null && !active()`, calls start() itself, and start() steps immediately.
	 * That is not a shortcut around upstream: it is upstream. On a full load initDOM()
	 * runs Poll.start() on an empty queue before the view renders, and the view's own
	 * poll.add() is what arms the timer and takes the first step. */
	if (L.Poll && L.Poll.queue) {
		L.Poll.queue.length = 0;
		L.Poll.stop();
		L.Poll.start();
	}
	/* also kill the outgoing view's plain setInterval pollers (e.g. podkop's log
	 * tailer) — a full load would have; the SPA must do it explicitly. Keeps
	 * L.Poll's own tick alive. */
	clearViewIntervals();
	if (_updTimer) { window.clearTimeout(_updTimer); _updTimer = null; }
	_updGen++;	/* and disown any fs.exec already in flight (see _updGen) */
	try { if (typeof ui.hideModal == 'function') ui.hideModal(); } catch (e) {}

	/* point the runtime env at the new node so views, tabs and highlighting read
	 * the right path. For a fully-matched leaf, request == dispatch path. */
	L.env.requestpath  = rsegs.slice();
	L.env.dispatchpath = rsegs.slice();
	L.env.pathinfo     = '/' + segs.join('/');
	/* `readonly` is not decoration: luci.js implements hasViewPermission() as
	 * `!env.nodespec.readonly`, and the dispatcher stamps it on every node an ACL
	 * grants read-but-not-write. Views (network/interfaces, wireless, the package
	 * manager) and luci.js's own Save/Apply footer key their disabled state off it.
	 * Dropping it here handed a read-only user LIVE Save/Apply buttons the moment
	 * they arrived by SPA nav, where a full page load had correctly disabled them. */
	L.env.nodespec     = { satisfied: true, action: node.action, title: node.title,
	                       depends: node.depends, readonly: node.readonly };

	/* Keep <body data-page> in sync with the route. The server template stamps the
	 * dispatch path (`ctx.path`) on every full load, and LuCI's
	 * page-scoped CSS (and any per-page hook) keys off it. `rsegs` is the resolved
	 * leaf path, so the two agree — which is the point: a firstchild URL
	 * like /admin/status must produce the same "admin-status-overview" whether it
	 * arrives as a full load or as a client-side nav. A SPA nav swaps the
	 * view without reloading, so — like requestpath/dispatchpath/title above —
	 * the router must re-stamp it, or the incoming page keeps the previous page's
	 * data-page and its scoped styles silently don't apply. This is route-state
	 * sync the router already owns, not a per-page patch: it fixes every
	 * body[data-page=…] rule at once. */
	document.body.setAttribute('data-page', rsegs.join('-'));

	/* A re-navigation to the page already on screen must REPLACE its history entry, not
	 * push a second one. Clicking the active menu item (or the brand, from the overview)
	 * is a perfectly ordinary thing to do, and pushing a duplicate entry makes the Back
	 * button do nothing: popstate fires, `location.pathname === _curPath`, and the
	 * fragment-change guard below correctly returns without navigating — so the user is
	 * left pressing Back once per stray click before anything moves. A full page load has
	 * no such trap: re-visiting the same URL is one entry, not two. */
	if (push)
		history[pathname === window.location.pathname ? 'replaceState' : 'pushState']({ fsnav: true }, '', pathname);

	/* titles: <host> | <page> */
	const host = (document.title.split('|')[0] || '').trim();
	document.title = node.title ? (host + ' | ' + _(node.title)) : host;
	const tmain = document.querySelector('.fs-title-main');
	if (tmain && node.title)
		tmain.textContent = _(node.title);

	renderChrome();

	/* a full load starts at the top; the in-place swap must too — without this,
	 * navigating away from a long page opens the next one mid-scroll. popstate
	 * replays (push=false) keep the browser's own scroll handling. */
	if (push)
		window.scrollTo(0, 0);

	/* ---- what a full page load does for a keyboard/screen-reader user, and the SPA did not
	 *
	 * A real navigation resets focus to the top of the new document and the browser announces
	 * it. Neither happens here, and it is worse than merely missing: renderChrome() above has
	 * just done `#topmenu.innerHTML = ''`, so the very <a> the user activated with Enter no
	 * longer exists. Focus falls back to <body>, the next Tab restarts at the skip link, and
	 * nothing anywhere says the page changed — the URL, the title and #view all moved in
	 * silence. A sighted mouse user never notices; for everyone else the page simply stops
	 * being navigable.
	 *
	 * So do what the browser would: put focus on the <main> (it already carries tabindex="-1"
	 * for the skip link, and #maincontent:focus is already outline-less, so this is visible to
	 * nobody who was not already keyboarding), and speak the new title through the polite live
	 * region in header.ut. preventScroll because the scroll position is decided just above —
	 * focus() would otherwise drag a popstate replay back to the top and undo the browser's
	 * own restoration. */
	const main = document.getElementById('maincontent');
	if (main) main.focus({ preventScroll: true });
	const live = document.getElementById('fs-nav-status');
	if (live) live.textContent = node.title ? _(node.title) : '';

	/* Require + instantiate through the runtime singleton `window.L`, NOT the
	 * bare `L` a LuCI module factory is handed. They are different objects: the
	 * dispatcher builds `window.L = new LuCI()` and the `ui` module augments *that*
	 * instance with helper methods (itemlist/showModal/…), whereas a module's `L`
	 * param is the un-augmented base. A required module captures whichever `L` did
	 * the require(), so a view required via the bare `L` throws "L.itemlist is not
	 * a function" mid-render. `env`/`Poll` are shared (prototype/singleton) so the
	 * mutations above are fine on either; only the require target must be window.L.
	 * See docs/14.
	 *
	 * require/instanceof errors fall back to a real navigation; render-time errors are
	 * handled inside LuCI.view (shows the stock error), same as a full load.
	 *
	 * WHEN to re-instantiate is the subtle part, and getting it wrong cost this router
	 * a duplicate render on every first visit to a page. LuCI's require() does not hand
	 * back a class — it caches an INSTANCE, so `require('view.x')` on a class not seen
	 * before CONSTRUCTS it, and a view's __init__ *is* its render. (That is the whole of
	 * ui.instantiateView(): require the view and you have rendered it.) So on a first
	 * visit the require already painted the page, and the `new view.constructor()` that
	 * followed painted it a SECOND time — two renders, and two pollers registered for the
	 * same page, doubling its RPCs for as long as the user stayed. Only on a REVISIT does
	 * require() return the cached singleton whose __init__ already ran, and only then does
	 * a fresh instance have to be built to re-run it.
	 *
	 * `_seen` is that distinction, and it must be read BEFORE the require resolves, since
	 * the require is what fills LuCI's cache. */
	if (className === 'view.status.index')
		ensureOverviewHelpers();

	const RT = window.L;
	const cached = _seen.has(className);
	_seen.add(className);
	RT.require(className).then(view => {
		if (!(view instanceof RT.view))
			throw new TypeError('Loaded class ' + className + ' is not a view');
		if (gen !== _navGen) {
			/* A newer navigation superseded this one. On the CACHED path nothing has
			 * happened yet — skipping the constructor below is the whole cancellation.
			 * On the FIRST-visit path the require() we are being called back from has
			 * ALREADY rendered into the live page and registered its pollers, and there
			 * was never anything to cancel: undo it. See repairStaleRender(). */
			if (!cached)
				repairStaleRender(className);
			return;
		}
		if (cached)
			new view.constructor();	/* singleton: its __init__ already ran, re-run it */
	}).catch((e) => {
		/* The full-page reload is a correct fallback, but swallowing the reason made
		 * every SPA-router regression look like "the page is just slow to load"
		 * instead of an error. Log, then fall back. */
		console.error('footstrap: SPA nav to ' + className + ' failed, falling back to a full load', e);
		if (gen === _navGen) window.location = pathname;
	});

	return true;
}

/* The same-origin nav URL an event's link points at, or null when the link is
 * not ours to handle (new-tab target, download, bare #hash, cross-origin,
 * unparsable). Shared by the click router and the hover prefetch — the two
 * used to carry drifting copies of this filter. */
function linkUrlFrom(ev) {
	const a = ev.target.closest && ev.target.closest('a[href]');
	if (!a || (a.target && a.target !== '_self') || a.hasAttribute('download'))
		return null;
	const raw = a.getAttribute('href');
	if (!raw || raw.charAt(0) === '#') return null;
	let url;
	try { url = new URL(a.href, window.location.href); } catch (e) { return null; }
	return url.origin === window.location.origin ? url : null;
}

function wireRouter() {
	if (_wired) return;
	_wired = true;

	document.addEventListener('click', (ev) => {
		if (ev.defaultPrevented || ev.button !== 0 ||
		    ev.ctrlKey || ev.metaKey || ev.shiftKey || ev.altKey)
			return;

		const url = linkUrlFrom(ev);
		if (!url) return;

		/* navigate() carries only the pathname: pushState-ing a bare path for a
		 * link that promised ?query= / #hash would strip both from the URL (and
		 * from the view, which reads location.search). Let those links full-load. */
		if (url.search || url.hash) return;

		if (navigate(url.pathname, true))
			ev.preventDefault();
	}, false);

	/* Warm the view module cache when the pointer enters a nav link.
	 *
	 * `pointerover` bubbles from EVERY element the pointer crosses — dragging the
	 * mouse across the process table fires it hundreds of times — and each one used
	 * to run closest(), build a URL and walk the menu tree before prefetchView()
	 * finally deduplicated it. Bail on the element first: the same <a> re-fires this
	 * for every child span it contains, and a non-link target is the overwhelmingly
	 * common case. */
	let lastHovered = null;
	document.addEventListener('pointerover', (ev) => {
		const a = ev.target.closest?.('a[href]');
		if (!a || a === lastHovered) return;
		lastHovered = a;
		const url = linkUrlFrom(ev);
		if (url)
			prefetchView(url.pathname);
	}, { passive: true });

	window.addEventListener('popstate', () => {
		/* an entry carrying a query belongs to a full load (we only ever push bare
		 * paths) — replaying it as a bare-path SPA nav would drop the query the
		 * view expects, so reload instead */
		if (window.location.search) {
			window.location.reload();
			return;
		}

		/* A FRAGMENT CHANGE IS NOT A NAVIGATION, and treating it as one broke every view
		 * that uses `href="#"` for its own in-page controls — which is a very common idiom.
		 *
		 * Chrome fires `popstate` for a same-document fragment navigation, so clicking an
		 * `<a href="#">` inside a view arrived here as if the user had pressed Back. We then
		 * re-ran navigate() for the very path already on screen, which RE-INSTANTIATES the
		 * view — wiping whatever state the click had just set.
		 *
		 * Reported as "luci-app-filemanager does not work" (issue #3), and it really did not:
		 * its tab strip is four `<a href="#">` links whose handler does not preventDefault, so
		 * every click switched the tab and was instantly undone by the re-render one turn of
		 * the event loop later. Traced on the live router — `popstate` → `#view` gets a fresh
		 * container. The double "Failed to display the file list" in that report is the same
		 * bug seen from the other side: each surprise re-render restarts the app's own
		 * render(), and its file list races the DOM insertion.
		 *
		 * The view has not changed unless the PATH changed. If only the fragment moved, the
		 * page owns it — say nothing and let the app keep the state it just set. */
		if (window.location.pathname === _curPath)
			return;

		if (!navigate(window.location.pathname, false))
			window.location.reload();
	});
}

/* ---- the poll indicator must not outlive the poll ------------------------
 *
 * LuCI shows the "Refreshing" pill on a `poll-start` event and flips it to "Paused" on
 * `poll-stop`, and it NEVER hides it again — `ui.hideIndicator()` exists, but core only ever
 * calls it for `uci-changes`.
 *
 * On a full page load that omission is invisible, because `Poll.start()` dispatches
 * `poll-start` ONLY when the queue is non-empty (luci.js) — so a page with nothing to poll
 * (Software, Backup, …) simply never grows an indicator. But this theme's SPA router flushes
 * the queue and calls `stop()` on every navigation, and `stop()` DOES dispatch `poll-stop`.
 * So walking from a polled page to an unpolled one left a "Paused" pill sitting there,
 * reporting on a poll that does not exist on that page.
 *
 * The rule the pill should obey is just: it exists if and only if there is something to poll.
 * "Paused" is meaningful when the user has paused a page that HAS pollers; with an empty
 * queue it is a ghost. Hooking `poll-stop` also cures the same ghost in stock LuCI, where
 * removing the last poller stops the loop and leaves the pill behind.
 *
 * Registered at module eval, i.e. AFTER luci.js has registered its own listener — so ours
 * runs second and can take back what that one just painted. */
document.addEventListener('poll-stop', () => {
	if (L.Poll && L.Poll.queue && L.Poll.queue.length === 0) {
		try { ui.hideIndicator('poll-status'); } catch (e) {}
	}
});

/* Pause LuCI's 1s poll loop while the tab is hidden and resume when it shows
 * again. LuCI has no visibilitychange handler, so a status/overview page left
 * open in a background tab hammers ubus 24/7 (esp. the pricey iwinfo getAssocList)
 * on a low-power router. Poll.stop() just clearInterval()s (the queue is
 * preserved); Poll.start() re-arms the interval and runs one immediate step() so
 * data is fresh the moment the tab is refocused. A poller added while hidden
 * won't auto-start (stop() deletes the tick) — start() picks it up on show, so
 * nothing is lost, only deferred. See docs/14 for the stop()/tick caveat. */
let _visWired = false;
function wireVisibility() {
	if (_visWired) return;
	_visWired = true;
	/* respect a manual pause: the user can stop polling via the "Refreshing"
	 * indicator, and an unconditional start() on tab-show would silently undo
	 * that. Only resume what the tab-hide actually paused. */
	let wasActive = true;
	document.addEventListener('visibilitychange', () => {
		if (!L.Poll) return;
		try {
			if (document.hidden) {
				wasActive = L.Poll.active();
				if (wasActive) L.Poll.stop();
			}
			else if (wasActive) {
				L.Poll.start();
			}
		} catch (e) {}
	});
}

/* How close a popup may come to the edge of the viewport before it is nudged back in.
 * Read by BOTH popups the theme places by hand — the Appearance popover below and the menu's
 * dropdown edge-clamp (menu-footstrap.js) — which had each written their own `8`. */
const EDGE_GAP = 8;

/* Place the popover next to its trigger and keep it inside the viewport.
 * It is position:fixed and lives on <body> — the sidebar is `overflow-y: auto`
 * (which computes overflow-x to `auto` too), so an absolutely-positioned popover
 * parented to the Appearance row was clipped/scrolled off the sidebar edge.
 * Top-nav opens downward from the right edge of the button; the sidebar opens
 * sideways out of the rail. Both are then clamped to the viewport. */
function placePopover(btn, pop) {
	const gap = EDGE_GAP, r = btn.getBoundingClientRect();
	const w = pop.offsetWidth, h = pop.offsetHeight;
	const vw = document.documentElement.clientWidth;
	const vh = document.documentElement.clientHeight;
	const top_layout = isTopLayout();

	let left = top_layout ? (r.right - w) : (r.right + gap);
	let top  = top_layout ? (r.bottom + gap) : (r.bottom - h);

	/* sidebar: if there is no room to the right, fall back above the trigger */
	if (!top_layout && left + w > vw - gap) {
		left = r.left;
		top = r.top - h - gap;
	}

	pop.style.left = Math.max(gap, Math.min(left, vw - w - gap)) + 'px';
	pop.style.top  = Math.max(gap, Math.min(top,  vh - h - gap)) + 'px';
}

/* ---- theme version + update check --------------------------------------
 * FS_VERSION is stamped at build/deploy: the package Makefile (Build/Prepare)
 * and dev-sync.sh rewrite the '0.0.0-dev' literal below to the git-derived
 * version. On release builds it is the real version; a plain source checkout
 * (never stamped) stays 'dev' and skips the update check.
 *
 * The ROUTER asks GitHub, not the browser (`footstrap-selfupdate.sh check`, the
 * same ACL-gated script the Update button runs). A LAN client frequently has no
 * route to the internet while the router does, and this keeps the check off the
 * user's own IP rate limit. The script caches the answer for an hour, and the
 * result is memoised here in _fsUpdatePromise for the page load, so re-opening
 * the popover (or a second layout) costs nothing. Fails silent: no reachable
 * API -> no badge, the version still shows. */
const FS_VERSION = '0.0.0-dev';
const FS_REPO = 'VizzleTF/luci-theme-footstrap';
const FS_UPDATE_SCRIPT = '/usr/libexec/footstrap-selfupdate.sh';
let _fsUpdatePromise = null;

/* opt-out toggle for the GitHub update check (Appearance -> Updates). Default on;
 * off means no network call, no badge/dot. */
function currentUpdateCheck() { return lsGet('fs-update-check') !== 'off'; }
function applyUpdateCheck(val) {
	/* the badge/dot cleanup happens in applyUpdateUI (invoked just below) */
	if (val === 'off') lsSet('fs-update-check', 'off');
	else lsDel('fs-update-check');
	/* re-evaluate so turning it back on within the same session shows the state */
	_fsUpdatePromise = null;
	if (typeof window.__fsUpdateApply == 'function') window.__fsUpdateApply();
}

/* The parentheses around the regex are load-bearing — do not "tidy" them away.
 * luci.mk minifies this file with jsmin, whose regex-vs-division test is a ONE
 * character lookback against a fixed allow-list. `n` (the last letter of `return`)
 * is not on it, so `return /re/` makes jsmin read the regex as a division and, if
 * the regex body contains `//` or `/*`, silently swallow the rest of the file —
 * exiting 0 while doing it (openwrt/luci#8299). `(` IS on the allow-list.
 * tools/jsmin-verify.mjs is the gate that catches this; this is the fix. */
function fsVersionReal() { return ((/^\d+\.\d+/).test(FS_VERSION)) && FS_VERSION !== '0.0.0-dev'; }
function fsParseVer(s) { return String(s).replace(/^v/, '').split(/[.\-+]/).map(n => parseInt(n, 10) || 0); }
function fsVerCmp(a, b) {
	a = fsParseVer(a); b = fsParseVer(b);
	for (let i = 0; i < Math.max(a.length, b.length); i++) {
		const d = (a[i] || 0) - (b[i] || 0);
		if (d) return d > 0 ? 1 : -1;
	}
	return 0;
}
function checkFootstrapUpdate() {
	if (_fsUpdatePromise) return _fsUpdatePromise;
	if (!fsVersionReal() || !currentUpdateCheck())
		return (_fsUpdatePromise = Promise.resolve({ current: FS_VERSION, latest: null, hasUpdate: false }));
	_fsUpdatePromise = window.L.require('fs')	/* window.L, not the module L — see the two-L note above */
		.then(fs => fs.exec(FS_UPDATE_SCRIPT, [ 'check' ]))
		.then(res => {
			/* "v1.2.3" on success, "ERR: …" when the router could not reach the
			 * API — and "ERR: unknown argument" from a pre-check script, i.e. the
			 * installed backend is older than this JS. All three mean: no badge. */
			const out = String((res && res.stdout) || '').trim();
			const latest = (/^v?\d/).test(out) ? out : null;
			return { current: FS_VERSION, latest, hasUpdate: !!(latest && fsVerCmp(latest, FS_VERSION) > 0) };
		})
		.catch(() => ({ current: FS_VERSION, latest: null, hasUpdate: false }));
	return _fsUpdatePromise;
}

function wireAppearance() {
	const btn = document.getElementById('fs-appearance');
	if (!btn) return;

	/* Popover axes, in order: Layout, Theme, Palette, Wallpaper, Tint, Accent, Rounding,
	 * plus Submenus (sidebar only) and Updates. Palette dropped its third "Rvht" option — it set no colours, only
	 * the cats wallpaper, which is now its own Wallpaper axis (composes with either
	 * palette). Tint sits next to Palette because it composes with it too: it hues the
	 * surfaces of whichever palette is on, and its job is identifying the ROUTER, not
	 * choosing a look. */
	const groups = [
		E('div', { 'class': 'fs-ap-group' }, [
			E('div', { 'class': 'fs-ap-label' }, [ _('Layout') ]),
			segControl(currentLayout(), [
				{ val: 'sidebar', label: _('Sidebar') },
				{ val: 'top',     label: _('Top') }
			], applyLayout, _('Layout'))
		]),
		E('div', { 'class': 'fs-ap-group' }, [
			E('div', { 'class': 'fs-ap-label' }, [ _('Theme') ]),
			segControl(currentMode(), [
				{ val: 'auto',  label: _('Auto') },
				{ val: 'light', label: _('Light') },
				{ val: 'dark',  label: _('Dark') }
			], applyMode, _('Theme'))
		]),
		E('div', { 'class': 'fs-ap-group' }, [
			E('div', { 'class': 'fs-ap-label' }, [ _('Palette') ]),
			segControl(currentPalette(), [
				{ val: 'footstrap',  label: 'Footstrap' },
				{ val: 'hicontrast', label: 'Hi-Contrast' }
			], applyPalette, _('Palette'))
		]),
		E('div', { 'class': 'fs-ap-group' }, [
			E('div', { 'class': 'fs-ap-label' }, [ _('Wallpaper') ]),
			segControl(currentWallpaper(), [
				{ val: 'off',  label: _('Off') },
				{ val: 'cats', label: _('Cats') }
			], applyWallpaper, _('Wallpaper'))
		]),
		E('div', { 'class': 'fs-ap-group' }, [
			/* the caption says what the axis is FOR, not what it does — "Tint" alone
			 * reads as decoration and nobody would look for the router-identity cue
			 * under it */
			E('div', { 'class': 'fs-ap-label' }, [ _('Tint (router identification)') ]),
			/* step 5 = 72 hues, which is finer than anyone can name and coarse enough
			 * that the same router lands on the same colour when it is set again. */
			sliderControl(currentTint(), 0, 360, applyTint, _('Tint (router identification)'), {
				step: 5,
				cls: 'fs-range-hue',
				fmt: v => (v ? v + '°' : _('Off'))
			})
		]),
		E('div', { 'class': 'fs-ap-group' }, [
			E('div', { 'class': 'fs-ap-label' }, [ _('Accent') ]),
			/* recolours the accented CONTROLS (buttons/toggles/sliders/focus rings), not
			 * the canvas the way Tint does — same hue slider, off at 0 = palette default */
			sliderControl(currentAccent(), 0, 360, applyAccent, _('Accent'), {
				step: 5,
				cls: 'fs-range-hue fs-range-accent',
				fmt: v => (v ? v + '°' : _('Off'))
			})
		]),
		E('div', { 'class': 'fs-ap-group' }, [
			E('div', { 'class': 'fs-ap-label' }, [ _('Rounding') ]),
			sliderControl(currentRadius(), 0, 20, applyRadius, _('Rounding'))
		])
	];

	/* The top layout has no accordion — its sections are hover dropdowns, already exclusive —
	 * so this switch is meaningless there and must not be offered.
	 *
	 * ALWAYS BUILT, HIDDEN BY CSS (:root[data-layout="top"] .fs-ap-submenus, theme/20-shell.css).
	 * It used to be an `if (currentLayout() !== 'top')` around the push, and that was simply
	 * wrong: this popover is built ONCE, in init(), so the branch froze the control to the
	 * layout the PAGE LOADED in. Switch to the top bar and the Submenus control stayed on
	 * screen; load in the top bar, switch to the sidebar, and it never appeared. The comment
	 * here used to call that "acceptable — a no-op in top mode anyway", which was true of the
	 * control's effect and not of what the user saw.
	 *
	 * Doing it in CSS is not a workaround, it is the theme's rule: "toggling the layout
	 * re-renders nothing; CSS morphs the chrome" (CLAUDE.md). This control is chrome. Keying it
	 * off the same :root[data-layout] every other layout rule reads makes it correct on load,
	 * correct on toggle, and correct with no JS state at all. */
	groups.push(E('div', { 'class': 'fs-ap-group fs-ap-submenus' }, [
		E('div', { 'class': 'fs-ap-label' }, [ _('Submenus') ]),
		segControl(currentAutoCollapse() ? 'on' : 'off', [
			{ val: 'off', label: _('Keep open') },
			{ val: 'on',  label: _('Auto-collapse') }
		], applyAutoCollapse, _('Submenus'))
	]));

	/* version line + "new version" badge + one-click Update button (the last two
	 * are revealed by the update check below when a newer release exists). */
	const badge = E('a', {
		'class': 'fs-ap-badge', 'hidden': '',
		'href': 'https://github.com/' + FS_REPO + '/releases/latest',
		'target': '_blank', 'rel': 'noopener'
	}, [ _('New version available') ]);
	const updateBtn = E('button', { 'class': 'fs-ap-update', 'type': 'button', 'hidden': '' }, [ _('Update now') ]);

	/* opt-out toggle for the update check */
	groups.push(E('div', { 'class': 'fs-ap-group' }, [
		E('div', { 'class': 'fs-ap-label' }, [ _('Updates') ]),
		segControl(currentUpdateCheck() ? 'on' : 'off', [
			{ val: 'on',  label: _('Check') },
			{ val: 'off', label: _('Off') }
		], applyUpdateCheck, _('Updates'))
	]));

	groups.push(E('div', { 'class': 'fs-ap-footer' }, [
		E('div', { 'class': 'fs-ap-verrow' }, [
			E('a', {
				'class': 'fs-ap-version',
				'href': 'https://github.com/' + FS_REPO,
				'target': '_blank',
				'rel': 'noopener noreferrer'
			}, [ fsVersionReal() ? ('Footstrap v' + FS_VERSION) : 'Footstrap (dev)' ]),
			badge
		]),
		updateBtn
	]));

	const pop = E('div', { 'class': 'fs-appearance-pop', 'role': 'dialog', 'aria-label': _('Appearance'), 'hidden': '' }, groups);
	document.body.appendChild(pop);

	/* reveal the badge + Update button and mark the trigger (green dot) when a
	 * newer release exists. Runs once per page load and again when the Updates
	 * toggle flips (via window.__fsUpdateApply, which applyUpdateCheck calls). */
	function applyUpdateUI() {
		if (!currentUpdateCheck()) {
			btn.classList.remove('fs-has-update');
			badge.hidden = true; updateBtn.hidden = true;
			return;
		}
		checkFootstrapUpdate().then(u => {
			btn.classList.toggle('fs-has-update', !!u.hasUpdate);
			badge.hidden = !u.hasUpdate; updateBtn.hidden = !u.hasUpdate;
			if (u.hasUpdate)
				badge.textContent = _('New version available') + (u.latest ? ' (' + u.latest + ')' : '');
		});
	}
	window.__fsUpdateApply = applyUpdateUI;
	applyUpdateUI();

	/* one-click self-update: confirm, then run the ACL-gated backend script via
	 * file.exec (fs.exec). It downloads the latest release .apk/.ipk and installs
	 * it with apk (25.12) or opkg (24.10); on success the page reloads onto the
	 * new theme. No user input reaches the script — the ACL grants exec of that
	 * fixed path only, and the two arguments below are literals.
	 *
	 * The install outlives the RPC path: rpc.js aborts the XHR after
	 * `L.env.rpctimeout` (20 s) and rpcd kills the exec'd process after its own
	 * `timeout` (30 s). So the script only spawns a detached worker and returns
	 * STARTED; we poll `status` until it flips to OK or ERR. */
	const FS_UPDATE_POLL_MS = 2000;
	const FS_UPDATE_LIMIT_MS = 300000;

	function runSelfUpdate() {
		close(false);	/* the modal takes focus from here */
		/* Everything below belongs to THIS run. navigate() bumps _updGen, so a
		 * resolved RPC from a run the user has navigated away from does nothing
		 * instead of rescheduling itself and popping a modal over the new page. */
		const gen = ++_updGen;
		const stale = () => gen !== _updGen;
		const modal = (body) => { if (!stale()) ui.showModal(_('Update Footstrap'), body); };
		/* The message is an ARRAY child, and that is not a style choice: luci.js's dom.append()
		 * assigns a BARE STRING child via `node.innerHTML`, and only an array is turned into a
		 * text node. What lands here is raw installer output — footstrap-selfupdate.sh reports
		 * `ERR: install failed: <apk/opkg stderr>` — plus RPC exception text, i.e. the one
		 * string in this theme that neither the theme nor LuCI composed. Markup in it would be
		 * parsed. Every other E() here already passes an array; these did not. */
		const fail = (msg) => modal([
			E('p', {}, [ _('Update failed') + ': ' + String(msg || _('unknown error')).replace(/^ERR:\s*/, '').trim() ]),
			E('div', { 'class': 'right' }, E('button', { 'class': 'btn', 'click': ui.hideModal }, _('Close')))
		]);
		modal([
			E('p', {}, _('Download and install the latest Footstrap release from GitHub? The page reloads when done.')),
			E('div', { 'class': 'right' }, [
				E('button', { 'class': 'btn', 'click': ui.hideModal }, _('Cancel')), ' ',
				E('button', { 'class': 'btn cbi-button-action', 'click': doUpdate }, _('Update'))
			])
		]);

		/* The update no longer logs you out — but keep this branch anyway.
		 *
		 * postinst used to `rpcd restart`, which destroys every in-memory session, so a
		 * successful update ended with this browser logged out and every further RPC
		 * answering "Login session is expired" / "Access denied". The whole branch existed
		 * to explain a self-inflicted logout as success. postinst now does `rpcd reload`
		 * (SIGHUP), which re-reads the ACL directory — verified on a live router to be all
		 * this package needs — and leaves sessions alone, so the normal path is now simply
		 * "Updated. Reloading…".
		 *
		 * It stays because the CLAIM it makes is still true: an expired session arriving
		 * after the installer has run means the package installed (postinst is the last
		 * thing to run), and telling the user to sign in again is the right answer whatever
		 * killed the session — a hand-rolled rpcd restart, an upgrade of luci-base
		 * alongside, a router that rebooted. A full reload also re-fetches the new CSS/JS,
		 * whose cache-buster changed with the install. */
		const sessionGone = (m) =>
			(/session is expired|Access denied|-32002|\b403\b/i).test(String(m));
		const relogin = () => modal([
			E('p', {}, _('Update installed. The router restarted its session service, so you have been logged out — sign in again to load the new theme.')),
			E('div', { 'class': 'right' }, E('button', {
				'class': 'btn cbi-button-action',
				'click': () => location.reload()
			}, _('Log in again')))
		]);

		function poll(fs, deadline) {
			if (stale()) return;
			if (Date.now() > deadline)
				return fail(_('timed out waiting for the installer'));

			return fs.exec(FS_UPDATE_SCRIPT, [ 'status' ]).then(res => {
				/* the RPC was in flight while the user navigated: drop it on the floor */
				if (stale()) return;
				const out = String((res && res.stdout) || '').trim();
				if ((/^OK$/).test(out)) {
					modal([ E('p', {}, _('Updated. Reloading…')) ]);
					window.setTimeout(() => location.reload(), 1200);
					return;
				}
				if ((/^ERR:/).test(out))
					return fail(out);
				/* RUNNING, or IDLE if the worker has not written the file yet.
				 * Tracked in _updTimer so navigate() can cancel the chain. */
				_updTimer = window.setTimeout(() => poll(fs, deadline), FS_UPDATE_POLL_MS);
			}).catch(e => {
				if (stale()) return;
				return sessionGone(e && e.message || e) ? relogin() : fail(e && e.message || e);
			});
		}

		function doUpdate() {
			modal([ E('p', { 'class': 'spinning' }, _('Downloading and installing…')) ]);
			window.L.require('fs')
				.then(fs => fs.exec(FS_UPDATE_SCRIPT).then(res => {
					if (stale()) return;
					const out = String((res && res.stdout) || '').trim();
					if (!(/^(STARTED|RUNNING)$/).test(out))
						return fail((res && (res.stderr || res.stdout)) || '');
					poll(fs, Date.now() + FS_UPDATE_LIMIT_MS);
				}))
				.catch(e => { if (!stale()) fail(e && e.message || e); });
		}
	}
	updateBtn.addEventListener('click', runSelfUpdate);

	/* Clicking outside means the user is going somewhere else — closing must not
	 * yank their focus back to the trigger. Escape and the trigger itself do. */
	function outside(e) { if (!pop.contains(e.target) && !btn.contains(e.target) && e.target !== btn) close(false); }
	function reposition() { placePopover(btn, pop); }

	/* role="dialog" is a promise about keyboard behaviour, and the popover was not
	 * keeping it: focus stayed on the page behind, Tab walked straight out of the
	 * open dialog into the view underneath, and a click-outside close dropped focus
	 * on the floor instead of handing it back to the trigger. */
	const FOCUSABLE = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';
	function keydown(e) {
		if (e.key === 'Escape') { close(); return; }
		if (e.key !== 'Tab') return;
		const items = [...pop.querySelectorAll(FOCUSABLE)].filter((el) => !el.disabled && el.offsetParent !== null);
		if (!items.length) return;
		const first = items[0], last = items[items.length - 1];
		/* wrap at both ends so focus cannot leave an open dialog */
		if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
		else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
	}
	function open() {
		pop.hidden = false; btn.setAttribute('aria-expanded', 'true');
		reposition();
		pop.querySelector(FOCUSABLE)?.focus();
		document.addEventListener('click', outside, true);
		document.addEventListener('keydown', keydown);
		window.addEventListener('resize', reposition);
		window.addEventListener('scroll', reposition, true);
	}
	function close(returnFocus = true) {
		if (pop.hidden) return;
		pop.hidden = true; btn.setAttribute('aria-expanded', 'false');
		document.removeEventListener('click', outside, true);
		document.removeEventListener('keydown', keydown);
		window.removeEventListener('resize', reposition);
		window.removeEventListener('scroll', reposition, true);
		if (returnFocus) btn.focus();
	}

	pop.id = 'fs-appearance-pop';
	btn.setAttribute('aria-haspopup', 'dialog');
	btn.setAttribute('aria-expanded', 'false');
	btn.setAttribute('aria-controls', pop.id);
	/* NO stopPropagation here. It was not needed — outside() is registered in the
	 * CAPTURE phase and already excludes clicks on btn — and it actively broke the
	 * sidebar: menu-footstrap.js closes an open flyout from a bubble-phase click
	 * listener on document, which never saw this event, so opening Appearance from
	 * a collapsed rail left the flyout panel hanging open underneath it. */
	btn.addEventListener('click', () => { pop.hidden ? open() : close(); });
}

/* Sidebar rail toggle: collapse the sidebar to an icon-only strip. The state
 * lives on <html data-rail> (head.ut re-applies it before paint on a full load)
 * and in localStorage. Everything else — flyout submenus, hidden labels — is CSS
 * keyed off that attribute. */
function wireRail() {
	const btn = document.getElementById('fs-rail-toggle');
	if (!btn) return;

	const root = document.documentElement;

	function sync() {
		const on = root.getAttribute('data-rail') === 'true';
		btn.setAttribute('aria-expanded', on ? 'false' : 'true');
		const label = on ? _('Expand menu') : _('Collapse menu');
		btn.setAttribute('aria-label', label);
		btn.setAttribute('title', label);
	}

	btn.addEventListener('click', () => {
		const on = root.getAttribute('data-rail') !== 'true';
		if (on) { root.setAttribute('data-rail', 'true'); lsSet('fs-rail', 'true'); }
		else { root.removeAttribute('data-rail'); lsDel('fs-rail'); }
		sync();
		/* the sidebar's cut just changed by ~156px, so the content column may now clear (or
		 * fall below) --fs-content-min: re-take the measurement rather than wait for a
		 * resize that is not coming */
		scheduleTabFit();
	});

	sync();
}

return baseclass.extend({
	/* menu-footstrap.js asks before unfolding a section (see applyAutoCollapse) */
	autoCollapse: currentAutoCollapse,

	/* the viewport edge gap both hand-placed popups obey — see EDGE_GAP above */
	EDGE_GAP,

	/* the disclosure primitives both layouts' menus build their sections on */
	setOpen,
	wireSpaceKey,
	wireDismiss,

	/* entry point: load the menu tree, render mode menu (which drives the
	 * injected renderMainMenu), the section tabs, and wire the theme toggle. */
	init(renderMainMenu) {
		ui.menu.load().then((tree) => {
			_tree = tree;
			_renderMain = renderMainMenu;

			/* The page we are standing on arrived as a full load, which means LuCI has
			 * ALREADY required — and therefore instantiated and rendered — its view. Seed
			 * `_seen` with it, or the first SPA nav BACK to this page would take require()'s
			 * cached instance, skip the re-instantiation, and render nothing at all. */
			const here = viewClassFor(nodeForSegs(L.env.dispatchpath || []));
			if (here)
				_seen.add(here);

			/* the bar's "does the menu fit beside the brand" measurement joins the same
			 * engine the tables use — it re-runs on every #view resize (which is also what
			 * a rail collapse and a layout toggle produce) and on content mutations */
			fit.add(fitChrome);

			renderChrome();
			wireAppearance();
			wireRail();
			wireRouter();
			wireVisibility();
			wireTabFit();
			watchViewSheets();
		/* This file warns about exactly this in renderTabMenu ("an unhandled
		 * rejection here kills every menu") and then left the root chain bare: a
		 * throw anywhere in the six calls above took out the menu, the router and
		 * the Appearance popover together, silently. It still fails — there is no
		 * sane partial recovery — but it fails loudly. */
		}).catch((e) => console.error('footstrap: chrome init failed', e));
	}
});
