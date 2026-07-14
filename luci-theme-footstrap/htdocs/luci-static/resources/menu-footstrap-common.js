'use strict';
'require baseclass';
'require ui';
'require fs-fit as fit';

/* Shared chrome: mode menu, section tabs, the SPA router and the Appearance popover.
 * menu-footstrap.js is the one renderer and composes with it (common.init(renderMainMenu)); that
 * callback seam stays because LuCI instantiates every required baseclass module into a singleton,
 * so a base class cannot be `extend`-ed across modules. */

/* --- stray-interval teardown for SPA nav ---
 * A full load kills every window.setInterval the outgoing page set; SPA nav does not, so a view's
 * poller keeps firing against a page that is gone (luci-app-podkop's log tailer runs
 * `podkop check_logs` forever after you navigate away). Track view-set ids and clear them on nav,
 * keeping L.Poll's own 1s tick (also a setInterval); L.Poll's queue is flushed in navigate().
 * Hooked at module eval — before any view render can set a timer. */
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
	/* a template without the container must not reject: an unhandled rejection here kills the
	 * whole ui.menu.load() chain, i.e. every menu */
	if (!container)
		return E([]);
	const ul = E('ul', { 'class': 'tabs' });
	const children = ui.menu.getChildren(tree);
	let activeNode = null;

	children.forEach(child => {
		const isActive = (L.env.dispatchpath[3 + (level || 0)] === child.name);
		/* aria-current="page", not just the `active` class: the class is paint, which a screen
		 * reader cannot see. E() drops a null attribute value, so inactive tabs carry nothing. */
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

/* ---- tab-strip auto-fit ----
 * A tab strip (#tabmenu, or a view's own .cbi-tabmenu) can carry ~11 pills (luci-app-justclash)
 * that overflow one row. Rather than wrap, shrink: two density classes (styles/theme/40-tabs.css)
 * trim padding, then gap+font. Floored so a pill never gets tighter than its label — past the
 * floor the strip is allowed to wrap. */
function stripFitsOneRow(ul) {
	/* Only laid-out children count: a display:none child has offsetTop 0, so taking it as `last`
	 * read as "one row" while the strip had in fact wrapped, and the density fit never fired. */
	const items = [...ul.children].filter((el) => el.getClientRects().length > 0);
	const first = items[0], last = items[items.length - 1];
	/* one row iff first and last item share a top edge */
	return !first || !last || first.offsetTop === last.offsetTop;
}
function fitTabStrips() {
	/* `.fs-sidebar > ul.nav` is the main menu in EVERY layout — the same list — so the
	 * flexDirection check below is what tells a bar (row) from a vertical sidebar (column),
	 * where a one-row measure is meaningless. */
	document.querySelectorAll('.tabs, .cbi-tabmenu, .fs-sidebar > ul.nav').forEach((ul) => {
		if (ul.children.length < 2) return;
		if (ul.matches('.fs-sidebar > ul.nav') && getComputedStyle(ul).flexDirection !== 'row') {
			/* vertical list: the measure would floor it at fs-dense2 forever. Clear and skip. */
			if (ul.classList.contains('fs-dense1') || ul.classList.contains('fs-dense2'))
				ul.classList.remove('fs-dense1', 'fs-dense2');
			return;
		}
		/* steady state (poll tick on an already-fitting strip): one measure, no class writes —
		 * the write-measure-write dance below forces a reflow per strip, every second. */
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
/* ---- does the CONTENT column still have room, once the sidebar has taken its cut? ----
 *
 * The sidebar gives way to the bar when what is LEFT for the content would be too narrow to read.
 * A viewport breakpoint (`@media (max-width: 767px)`) cannot say that: the cut is not a constant —
 * 224px expanded, 68px collapsed to the rail — so one breakpoint gave both states the same answer,
 * and the rail folded away at the same width as the full sidebar, the ~156px it had just freed
 * buying the user nothing. Do NOT measure the RENDERED sidebar either: the answer would depend on
 * the state it is deciding (once it is a bar there is no cut, so the content "fits", so it
 * un-narrows, so it cuts again) — oscillation.
 *
 * The widths come from the STYLESHEET (02-tokens.css), which is what lays the sidebar out; never
 * restate them here, or narrowing the rail in CSS leaves this subtracting the old width with no gate
 * able to see it. Memoised because fitShell runs on every resize and mutation and getComputedStyle
 * forces a style recalc; the fallbacks stop an empty custom property making the measurement NaN
 * (`NaN < NaN` is false, so the sidebar would simply never yield). */
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
	/* ---- does the main menu fit on the brand's row? ----
	 * Whether it fits depends on how many sections THIS router has (stock 5, a loaded box 11), not
	 * on the viewport — so it is measured, not a breakpoint. `@media (max-width: 1199px)` stacked
	 * it on every laptop: a stock bar's contents come to ~683px, i.e. one row fits down to ~723px.
	 * Measured UNSTACKED (the remove above): a stacked menu owns a whole row and would "fit",
	 * flipping straight back — oscillation.
	 *
	 * The menu's own pills wrapping IS the "does not fit" signal, but only because the unstacked
	 * desktop bar is flex-wrap: nowrap (50-toplayout.css); otherwise the BAR wraps, hands the menu
	 * a whole row, and it always "fits". Do NOT measure the bar's children by offsetTop instead:
	 * the bar is align-items:center with children of differing heights, so their offsetTop differs
	 * even on one row (that read as "wrapped" for a 5-section menu). */
	if (desktopBar && !stripFitsOneRow(menu)) {
		bar.classList.add('fs-bar-stack');
		fitTabStrips();
	}
}
/* The measuring, frame-coalescing and ResizeObserver live in fs-fit.js, shared with the data
 * tables (same shape: measure UNCOLLAPSED, then toggle a class). fitChrome is registered there in
 * init(); this is the "do it soon" entry point the chrome's own callers use. */
function scheduleTabFit() {
	fit.schedule();
}
/* Did this batch of mutations add or remove a tab strip? The observer below exists only to catch a
 * view rendering its own .cbi-tabmenu after nav; firing on ANY mutation re-measured every strip on
 * the page once a second on a polled page — getClientRects()/offsetTop are layout reads, i.e. a
 * forced synchronous reflow per strip per tick, to learn the tabs had not moved.
 *
 * `removed: true` — a strip DISAPPEARING matters too (the density classes were sized for a menu no
 * longer on the page); that is the one way this differs from fs-select's use of the helper. */
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

		/* the main menu must render even if a template has no #modemenu — only the mode
		 * list itself is skippable chrome */
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

/* The nine Appearance axes (listed in wireAppearance below). All client-side, instant, persisted in
 * localStorage — no server, no reload — and head.ut's inline script re-applies them before paint,
 * so a reload never flashes the wrong one; tools/axes.mjs holds those two copies to one contract.
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
	 * measurement. Nothing else re-renders. */
	scheduleTabFit();
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

/* ---- disclosure primitives, shared by the menu ----
 * A section header is a W3C-APG disclosure control: an <a role="button"> owning a panel it shows and
 * hides. These lived once per menu file back when there were two, and the copies had already drifted
 * (only one Escape handler learnt to check flyout mode). The trigger SELECTOR stays a parameter. */

/* `.open` and aria-expanded must never disagree — `.open` alone told a sighted user everything and
 * a screen-reader user nothing — so every open and close goes through this one function.
 * `linkSel` is the layout's trigger (the menu's `:scope > a`). */
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

/* Dismissal both ways: a click outside closes; and WCAG 2.2 SC 1.4.13 (Content on Hover or Focus)
 * requires a hover/focus panel to be dismissible from the KEYBOARD, with focus handed back to the
 * trigger. `when` restricts both to flyout mode, where `.open` means "popup panel" — closing an
 * unfolded ACCORDION because the user clicked elsewhere on the page would be wrong. */
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
 * `label` is not decoration: the visible caption is a sibling <div> nothing associated with the
 * control, and the selection was carried by a CSS class alone — a screen reader got an unnamed
 * group of unrelated buttons with no indication of which was in effect. It is a radio group. */
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

/* A range slider with a live readout; onInput fires continuously as it drags. Without the label
 * and valuetext a screen reader announced a bare "slider, 12" — no unit, no idea what it adjusts.
 * `opts.fmt` is what the READOUT says AND what the reader is told, so it is not cosmetic: the tint
 * slider's 0 means "off", and announcing "0 degrees" would announce a hue that is not applied. */
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

/* ---- SPA client router ----
 *
 * Kills the full page reload for `view`-type menu nodes — 54 of 74 menu leaves (~73%) on the dev
 * router; the rest are call/function/template. LuCI already renders every page client-side into
 * #view; only NAVIGATION is server-dispatched. So intercept link clicks and re-instantiate the
 * target view in place — what the dispatcher's view.ut does via ui.instantiateView(), minus the
 * reload. Purely additive: anything that is not a satisfied `view` node (call/function/template/
 * alias/firstchild, external, download, cross-origin, modified click) or any error falls through to
 * a normal navigation, and deep links / F5 keep working because we pushState the real URL.
 *
 * Re-instantiation: L.require('view.x') returns a cached SINGLETON whose __init__ (the render)
 * already ran, so calling it again repaints nothing. Take the class off the instance
 * (prototype.constructor) and `new v.constructor()` for a fresh __init__ → load()+render(), which is
 * what a full load does anyway. docs/14. */

let _tree = null, _renderMain = null, _wired = false;
/* The pathname whose view is CURRENTLY rendered — popstate compares against it to tell a real
 * navigation from a mere fragment change (see there). Seeded from the served page. */
let _curPath = window.location.pathname;
/* nav generation token: two quick clicks race their async require()s, and without it the FIRST
 * view could render into #view after the second, leaving stale content under the newer
 * URL/title/chrome. A resolved require whose generation is stale renders nothing. */
let _navGen = 0;
/* the self-update poll chain reschedules with a raw setTimeout (only setInterval is hooked above),
 * so navigate() must be able to cancel it — or it keeps firing fs.exec RPCs and can pop its modal
 * onto an unrelated page. */
let _updTimer = null;
/* ...and clearing the timer is not enough: if an fs.exec('status') is ALREADY in flight when the
 * user navigates (rpctimeout is 20 s, so the window is wide) there is no timer to clear, and on
 * resolve it reschedules the chain and throws its modal over the new page. The generation token
 * kills the chain at the point where it would resurrect itself. */
let _updGen = 0;

/* rebuild mode menu + main menu + section tabs from the current L.env; on first load and after
 * every SPA nav. Containers are cleared first so a re-render does not stack duplicates. */
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
 * The bare base (what build_url() emits for the brand wordmark) yields an EMPTY seg list, NOT null:
 * the dispatcher's root node is itself a `firstchild`, so resolveSegs([]) walks to the overview
 * exactly as the server does — returning null made the wordmark un-routable and full-reload. null
 * stays reserved for a path outside LuCI's scriptname. */
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

/* ---- alias / firstchild resolution ----
 *
 * 7 of the 27 menu links are redirects, not pages: 4 `alias` (Firewall, System Log, Realtime
 * Graphs) and 3 `firstchild` (Administration, Terminal, Attended Sysupgrade) — i.e. the
 * most-clicked entries were the ones still doing a full load.
 *
 * The server does not redirect them: a full GET of /admin/status/logs answers 200 at that URL and
 * stamps the RESOLVED leaf into requestpath/dispatchpath/nodespec, keeping `pathinfo` as requested.
 * The client must resolve EXACTLY as dispatcher.uc does, or a click and an F5 on the same URL would
 * open different pages — nodeWeight() and firstChildOf() are ports, not approximations. Only the
 * ACL check is skipped: the tree from /admin/menu is already ACL-filtered for this session.
 *
 * `rewrite` is deliberately NOT followed: the tree has none, and a wrong guess at its splice
 * semantics would silently open the WRONG page — worse than the full load it falls back to. */

/* node_weight() from dispatcher.uc: lower wins; a login node sorts last. */
function nodeWeight(node) {
	return Math.min(node.order ?? 9999, 9999) + (node.auth && node.auth.login ? 10000 : 0);
}

/* resolve_firstchild() from dispatcher.uc: the eligible child of lowest weight. Ties go to tree
 * order (the comparison is strict, as upstream's is, and JSON.parse preserves key order). A
 * `firstchild` child is eligible only if it resolves to something itself — recursively. */
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

/* Follow alias/firstchild to the real page: {segs, node} of the leaf the dispatcher would have
 * rendered, or null when nothing resolves (the server would 404 — let it). The hop cap is a cycle
 * guard: an alias loop in some app's menu.d must not hang the UI. */
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

/* The view class a menu node instantiates, or null if the node isn't SPA-able. The Status→Overview
 * `template` node maps to view.status.index (its server template just instantiates that — see
 * ensureOverviewHelpers). Shared by navigate() and the hover prefetch. */
function viewClassFor(node) {
	if (!node || !node.action || node.satisfied === false)
		return null;
	if (node.action.type === 'view')
		return 'view.' + String(node.action.path).replace(/\//g, '.');
	if (node.action.type === 'template' && node.action.path === 'admin_status/index')
		return 'view.status.index';
	return null;
}

/* The view class the page CURRENTLY on screen wants (what _curPath resolves to). Read by the
 * stale-render repair below to tell "the superseded render happened to paint the right view
 * anyway" from "it painted the wrong one". */
function currentViewClass() {
	const segs = segsFromPath(_curPath);
	const res = segs && resolveSegs(segs);
	return viewClassFor(res && res.node);
}

/* ---- a superseded FIRST render cannot be cancelled, so undo it ----
 *
 * _navGen stops a stale require() from calling `new view.constructor()` — but only on the CACHED
 * path. On a FIRST visit the require() IS the render (see navigate()): it constructs the view, whose
 * __init__ runs load() → render() → dom.content(#view) and registers its pollers, inside a promise
 * we do not own. Nothing to cancel.
 *
 * So the fast double-click is a real bug: click Firewall (uncached), click Wireless 100 ms later.
 * navigate(Wireless) flushes L.Poll's queue BEFORE Firewall's poller is added; Firewall then paints
 * into the #view that now belongs to Wireless and registers a poller the flush can no longer catch —
 * leaving Wireless's URL/title/menu/data-page, Firewall's content, and Firewall's poller running on
 * every page afterwards.
 *
 * Repair by re-running the current navigation: navigate() is exactly the "put the document back the
 * way a fresh load leaves it" routine. push=false — the URL never moved, only the DOM under it; if
 * it declines (the superseded view injected CSS), the reload does it the hard way. The className
 * check terminates this: if the superseded render painted the class the current path wants anyway
 * (A → B → A while A was still loading), the DOM and its poller are correct — and with two uncached
 * views racing it is also what stops a repair triggering a repair. */
function repairStaleRender(className) {
	if (className === currentViewClass())
		return;
	console.warn('footstrap: a superseded view (' + className + ') rendered into the live page; re-rendering ' + _curPath);
	if (!navigate(_curPath, false))
		window.location.reload();
}

/* The exact URL LuCI.require() will fetch for a class name, cache-bust and all. Matching it
 * byte-for-byte is what makes a hover prefetch a warm cache hit for the later require(). */
function moduleUrl(className) {
	const v = L.env.resource_version ? ('?v=' + L.env.resource_version) : '';
	return (L.env.base_url || '') + '/' + className.replace(/\./g, '/') + '.js' + v;
}

/* Hover prefetch: warm the browser HTTP cache for a view's module JS with a plain fetch() — NOT
 * require(), which would run the class __init__ and render another page's view into #view. The
 * later click's require() then hits cache instead of the network (−10–40 ms LAN on a first visit,
 * more over WAN/VPN). Deduped per class; failures are silent (it is a pure optimisation). */
/* view classes already required, i.e. the ones LuCI has an instance cached for. A class NOT in
 * here is rendered by the require() itself (see navigate). */
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

/* Status→Overview is a `template` node whose server template (admin_status/index.ut) defines 3
 * globals the stock status includes use (18_cpu/20_memory/25_storage/…) and then instantiates
 * view.status.index. Arriving by SPA never runs that inline <script>, so define them here — guarded,
 * so a prior full load's copies are not clobbered. Bodies are verbatim from upstream except
 * L.itemlist → window.L.itemlist (the two-L trap, docs/14). */
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

/* ---- a view's injected CSS: never DELETE it; leave a poisoned document by a real load ----
 *
 * A view's <style> dies with the document on a full load; SPA nav never reloads, so it restyles
 * every page after. `luci-app-filemanager` injects `.cbi-button-apply, .cbi-button-reset,
 * .cbi-button-save:not(.custom-save-button) { display: none !important }` — unlayered + important,
 * outranking every cascade layer: one visit and Save/Reset are gone from every config page.
 *
 * But DELETING them on nav broke SSClash. A poller can be re-registered by re-rendering the view;
 * a stylesheet only returns if its injector runs AGAIN, and a library importing CSS at MODULE EVAL
 * never will (module cached for the life of the document). ACE's ace_editor.css (14 KB of
 * absolutely-positioned layers, gutter, line boxes) is imported once — after the sweep, navigating
 * back to its editor gave a black rectangle 2 007 346 px tall. Deletion was silently one-way.
 *
 * So: a sheet matching only its OWN app's widgets (`.ace_*`, `.cpu-status-view-mode-entry`) is
 * inert elsewhere — LEAVE it. One reaching into the widget universe the THEME styles
 * (`.cbi-button-save`, `pre`, `:root`) can repaint any page: that document is spent, so refuse to
 * hand it to another view and fall back to a REAL page load — speed traded, never correctness, and
 * the fresh document carries no view CSS, so SPA nav resumes right after.
 *
 * `invasiveSheet()` is that test; its universe is read back from cascade.css itself (same-origin,
 * so `cssRules` is readable) rather than a hand-written list, so it tracks the theme. 0.3 ms per
 * nav. Exempt: `[data-fs-shell]` (the one <style> the server emits — marked, not guessed at) and
 * anything inside `#view` (dies with the content swap); LuCI core injects no <style> at runtime at
 * all (checked: luci.js, ui.js, cbi.js). If cascade.css cannot be read, EVERY view sheet counts as
 * invasive: fail to the slow path, never the broken one. */
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

/* A rule with a bare SELECTOR (`:root`, `pre`, `*`) still cannot touch us if none of its
 * DECLARATIONS can: a custom property this theme never reads is inert. That is the difference
 * between an app costing a full page load and not — `luci-app-temp-status` opens with
 * `:root { --app-temp-status-temp: #147aff; … }`, and both it and the file manager's hex editor
 * would otherwise read as "document spent" on the strength of the selector alone.
 *
 * Still invasive: any STANDARD property on a bare selector (the stock file manager writes
 * `:root { color-scheme: light dark }`, re-pointing every UA widget at the OS preference), and any
 * custom property the THEME reads — the point of the private `--fs-*` tier is that an app writing
 * `--accent`/`--radius` on `:root` cannot repaint us, and this must keep it so for names we read. */
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

/* true when this sheet can repaint a page that is not its own. A sheet that is not readable —
 * still loading, 404, cross-origin — is invasive by default: unknown CSS takes the slow path,
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
					/* A rule may name a stock widget and still be harmless if it can only ever
					 * MATCH inside the app's own markup: `#cbi-podkop-section > .cbi-section-remove`
					 * needs podkop's section to exist. What pins it there is a name the theme does
					 * NOT know — the app's own. A selector made ENTIRELY of stock names has nothing
					 * pinning it, and matches the same widgets on every other page.
					 *
					 * Functional pseudo-class arguments are stripped before looking for that pin,
					 * and that is the whole difference between podkop and the file manager:
					 * `.cbi-button-save:not(.custom-save-button)` names an app class too, but
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

/* Both element kinds count; the <link> half is not hypothetical: `luci-app-banip` and
 * `luci-app-adblock` append `<link rel=stylesheet href=…/custom.css>` to <head> at MODULE EVAL,
 * and it styles `.cbi-input-text`/`.cbi-input-select` — stock widgets, every page, unlayered. A
 * <link> INSIDE the view tree (`luci-app-nlbwmon`) needs no handling: it dies with the swap. */
const VIEW_SHEETS = 'style:not([data-fs-shell]), link[rel~="stylesheet"]:not([data-fs-shell])';

function documentPoisoned() {
	const names = themeNames();
	return Array.prototype.some.call(
		document.querySelectorAll(VIEW_SHEETS),
		(el) => !el.closest('#view') && (!names || invasiveSheet(el, names)));
}

/* ---- the one thing that IS safe to remove: a byte-identical second copy ----
 *
 * Not deleting view CSS costs where an app injects on EVERY render: `luci-app-podkop` calls
 * injectGlobalStyles() from render() (4 KB, no guard) and `luci-app-mosdns` re-appends three
 * CodeMirror <link>s, so every SPA re-visit adds a copy that never stops being parsed. Dropping an
 * EXACT duplicate cannot break anyone, for the reason the sweep failed: the rules do not go away —
 * the surviving copy is byte-identical, and a library's "have I already imported this?" check (what
 * ACE died on) still finds its sheet. Keep the FIRST copy: it is what any handle the app kept
 * points at. */
function dedupeViewSheets() {
	const seen = new Set();
	document.querySelectorAll(VIEW_SHEETS).forEach((el) => {
		if (el.closest('#view')) return;
		const key = el.tagName + '|' + (el.tagName === 'LINK' ? el.href : el.textContent);
		if (seen.has(key)) el.remove();
		else seen.add(key);
	});
}

/* Watch <head> rather than deduping on navigation: the copy arrives too late otherwise — podkop
 * injects from its render(), which resolves AFTER the router's require() callback, so a nav-time
 * sweep left the document permanently carrying one stale duplicate (bounded, never zero). The
 * observer collapses the copy in the microtask it appears in. It cannot loop: a removal produces a
 * mutation with no ADDED nodes, and the handler bails unless a stylesheet was added. */
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

	/* `segs` is what the user clicked, `rsegs` the leaf it resolves to; they differ for an
	 * alias/firstchild link, and a full load keeps BOTH — URL and pathinfo as requested,
	 * requestpath/dispatchpath/nodespec/title resolved. Mirror that split exactly, or an F5
	 * lands somewhere the click did not. */
	const res = resolveSegs(segs);
	const node = res && res.node;
	const className = viewClassFor(node);
	if (!className)
		return false;
	const rsegs = res.segs;

	/* from here on the navigation is committed */
	const gen = ++_navGen;
	_curPath = pathname;	/* what is on screen from now on — read by the popstate handler */

	/* Ensure a #view, and clear what the OUTGOING page left as a SIBLING of #view inside .fs-content:
	 * dom.content() replaces only #view's OWN children, so anything a page emitted next to it rides
	 * along — the Status→Overview template emits <h2 name="content">Status</h2> there, hidden only
	 * by a body[data-page='admin-status-overview'] rule, so after an SPA nav the orphan showed on
	 * EVERY page until a full reload. Keep only the chrome that legitimately outlives a page (tabs,
	 * server notices, <noscript>); this also gives a template page that emits no #view a fresh one. */
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

	/* teardown: drop the outgoing view's pollers, then put the poll loop back into the state a FRESH
	 * LOAD leaves it in. The only non-view poller LuCI adds is the transient apply/reboot
	 * reachability check, so flushing the queue is safe.
	 *
	 * The re-arm matters: LuCI runs one 1 s tick and fires a queue entry only when
	 * `tick % interval == 0`, so leaving the OUTGOING page's tick running makes the incoming poller
	 * wait for the next multiple of its interval — up to `pollinterval`, 5 s. Wireless draws its
	 * station list from the first poll and sat spinning for 4950 ms against ~360 ms on a full load.
	 *
	 * stop() alone is NOT the fix: it deletes `tick`, and Poll.add() only auto-starts when
	 * `tick != null`, so the incoming pollers would never start at all. stop()+start() on an EMPTY
	 * queue leaves what a fresh document has (`tick = 0`, no timer armed); the view's first
	 * poll.add() then starts it and steps immediately — upstream's own sequence, since on a full
	 * load initDOM() runs Poll.start() on an empty queue before the view renders. */
	if (L.Poll && L.Poll.queue) {
		L.Poll.queue.length = 0;
		L.Poll.stop();
		L.Poll.start();
	}
	/* kill the outgoing view's plain setInterval pollers too (podkop's log tailer) — a full load
	 * would have. L.Poll's own tick survives. */
	clearViewIntervals();
	if (_updTimer) { window.clearTimeout(_updTimer); _updTimer = null; }
	_updGen++;	/* and disown any fs.exec already in flight (see _updGen) */
	try { if (typeof ui.hideModal == 'function') ui.hideModal(); } catch (e) {}

	/* point the runtime env at the new node so views, tabs and highlighting read the right
	 * path. For a fully-matched leaf, request == dispatch path. */
	L.env.requestpath  = rsegs.slice();
	L.env.dispatchpath = rsegs.slice();
	L.env.pathinfo     = '/' + segs.join('/');
	/* `readonly` is not decoration: luci.js implements hasViewPermission() as
	 * `!env.nodespec.readonly`, and views (network/interfaces, wireless, the package manager)
	 * plus luci.js's Save/Apply footer key their disabled state off it. Dropping it handed a
	 * read-only user LIVE Save/Apply buttons on an SPA nav, where a full load disabled them. */
	L.env.nodespec     = { satisfied: true, action: node.action, title: node.title,
	                       depends: node.depends, readonly: node.readonly };

	/* Keep <body data-page> in sync with the route: the server stamps the dispatch path
	 * (`ctx.path`) on every full load, and page-scoped CSS keys off it. `rsegs` is the RESOLVED
	 * leaf, so a firstchild URL like /admin/status yields the same "admin-status-overview" whether
	 * it arrives as a full load or a client nav. Without the re-stamp the incoming page keeps the
	 * previous page's data-page and its scoped styles silently do not apply. */
	document.body.setAttribute('data-page', rsegs.join('-'));

	/* Re-navigating to the page already on screen must REPLACE its history entry, not push a
	 * second one. Clicking the active menu item is ordinary, and a duplicate entry makes Back do
	 * nothing: popstate fires, `location.pathname === _curPath`, and the fragment guard below
	 * correctly returns — one dead Back press per stray click. A full load has no such trap. */
	if (push)
		history[pathname === window.location.pathname ? 'replaceState' : 'pushState']({ fsnav: true }, '', pathname);

	/* titles: <host> | <page> */
	const host = (document.title.split('|')[0] || '').trim();
	document.title = node.title ? (host + ' | ' + _(node.title)) : host;
	const tmain = document.querySelector('.fs-title-main');
	if (tmain && node.title)
		tmain.textContent = _(node.title);

	renderChrome();

	/* a full load starts at the top; the in-place swap must too, or navigating away from a long
	 * page opens the next one mid-scroll. popstate replays keep the browser's scroll handling. */
	if (push)
		window.scrollTo(0, 0);

	/* ---- what a full load does for a keyboard/screen-reader user, and the SPA did not ----
	 * renderChrome() has just done `#topmenu.innerHTML = ''`, so the very <a> the user activated with
	 * Enter no longer exists: focus falls back to <body>, the next Tab restarts at the skip link, and
	 * nothing says the page changed — URL, title and #view all moved in silence. So do what a real
	 * navigation would: focus <main> (already tabindex="-1" for the skip link, and outline-less on
	 * :focus) and speak the new title through header.ut's polite live region. preventScroll because
	 * the scroll position is decided just above — focus() would otherwise drag a popstate replay back
	 * to the top and undo the browser's own restoration. */
	const main = document.getElementById('maincontent');
	if (main) main.focus({ preventScroll: true });
	const live = document.getElementById('fs-nav-status');
	if (live) live.textContent = node.title ? _(node.title) : '';

	/* Require through the runtime singleton `window.L`, NOT the bare `L` a module factory is handed:
	 * the dispatcher builds `window.L = new LuCI()` and `ui` augments THAT instance with
	 * itemlist/showModal/…, so a view required via the bare `L` throws "L.itemlist is not a
	 * function" mid-render (the two-L trap, docs/14). require/instanceof errors fall back to a real
	 * navigation; render-time errors are handled inside LuCI.view, as on a full load.
	 *
	 * WHEN to re-instantiate is the subtle part. require() does not hand back a class — it caches an
	 * INSTANCE, so requiring a class not seen before CONSTRUCTS it, and a view's __init__ IS its
	 * render. On a first visit the require has therefore already painted the page, and a
	 * `new view.constructor()` after it painted a SECOND time — two renders, two pollers, double
	 * RPCs for as long as the user stayed. Only on a REVISIT does require() return the cached
	 * singleton whose __init__ already ran. `_seen` is that distinction, and it must be read BEFORE
	 * the require resolves, since the require is what fills LuCI's cache. */
	if (className === 'view.status.index')
		ensureOverviewHelpers();

	const RT = window.L;
	const cached = _seen.has(className);
	_seen.add(className);
	RT.require(className).then(view => {
		if (!(view instanceof RT.view))
			throw new TypeError('Loaded class ' + className + ' is not a view');
		if (gen !== _navGen) {
			/* A newer navigation superseded this one. On the CACHED path nothing has happened
			 * yet — skipping the constructor below is the whole cancellation. On the FIRST-visit
			 * path the require() has ALREADY rendered into the live page and registered its
			 * pollers, with nothing to cancel: undo it. See repairStaleRender(). */
			if (!cached)
				repairStaleRender(className);
			return;
		}
		if (cached)
			new view.constructor();	/* singleton: its __init__ already ran, re-run it */
	}).catch((e) => {
		/* the full reload is a correct fallback, but swallowing the reason made every SPA-router
		 * regression look like "the page is just slow to load". Log, then fall back. */
		console.error('footstrap: SPA nav to ' + className + ' failed, falling back to a full load', e);
		if (gen === _navGen) window.location = pathname;
	});

	return true;
}

/* The same-origin nav URL an event's link points at, or null when the link is not ours to handle
 * (new-tab target, download, bare #hash, cross-origin, unparsable). Shared by the click router and
 * the hover prefetch, which used to carry drifting copies of this filter. */
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

		/* navigate() carries only the pathname: pushState-ing a bare path for a link that
		 * promised ?query= / #hash would strip both from the URL and from the view, which
		 * reads location.search. Let those links full-load. */
		if (url.search || url.hash) return;

		if (navigate(url.pathname, true))
			ev.preventDefault();
	}, false);

	/* Warm the view module cache when the pointer enters a nav link. `pointerover` bubbles from
	 * EVERY element the pointer crosses — dragging across the process table fires it hundreds of
	 * times — so bail on the element first: the same <a> re-fires this for every child span it
	 * contains, and a non-link target is the overwhelmingly common case. */
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
		/* an entry carrying a query belongs to a full load (we only ever push bare paths):
		 * replaying it as a bare-path SPA nav would drop the query the view expects */
		if (window.location.search) {
			window.location.reload();
			return;
		}

		/* A FRAGMENT CHANGE IS NOT A NAVIGATION. Chrome fires `popstate` for a same-document
		 * fragment nav, so clicking an `<a href="#">` inside a view — a very common idiom for
		 * in-page controls — arrived here as if the user had pressed Back, and we re-ran navigate()
		 * for the path already on screen, RE-INSTANTIATING the view and wiping the state the click
		 * had just set (issue #3, "luci-app-filemanager does not work": its tab strip is four
		 * `<a href="#">` links whose handler does not preventDefault). The view changed only if the
		 * PATH changed; if just the fragment moved, the page owns it. */
		if (window.location.pathname === _curPath)
			return;

		if (!navigate(window.location.pathname, false))
			window.location.reload();
	});
}

/* ---- the poll indicator must not outlive the poll ----
 *
 * LuCI shows the "Refreshing" pill on `poll-start`, flips it to "Paused" on `poll-stop`, and never
 * hides it again (core calls ui.hideIndicator() only for `uci-changes`). Invisible on a full load,
 * because Poll.start() dispatches `poll-start` only when the queue is non-empty — an unpolled page
 * never grows a pill. But our router flushes the queue and calls stop() on every nav, and stop()
 * DOES dispatch `poll-stop`, so walking from a polled page to an unpolled one left a "Paused" pill
 * reporting on a poll that does not exist there. Rule: the pill exists iff there is something to
 * poll. Registered at module eval, i.e. AFTER luci.js's own listener, so ours runs second and can
 * take back what that one just painted. */
document.addEventListener('poll-stop', () => {
	if (L.Poll && L.Poll.queue && L.Poll.queue.length === 0) {
		try { ui.hideIndicator('poll-status'); } catch (e) {}
	}
});

/* Pause LuCI's 1s poll loop while the tab is hidden: LuCI has no visibilitychange handler, so an
 * overview left open in a background tab hammers ubus 24/7 (notably the pricey iwinfo getAssocList)
 * on a low-power router. stop() only clearInterval()s (the queue survives); start() re-arms and runs
 * one immediate step(), so data is fresh on refocus. A poller added while hidden will not auto-start
 * (stop() deletes the tick) — start() picks it up on show: deferred, not lost. docs/14. */
let _visWired = false;
function wireVisibility() {
	if (_visWired) return;
	_visWired = true;
	/* respect a manual pause: the user can stop polling from the "Refreshing" indicator, and an
	 * unconditional start() on tab-show would silently undo it. Resume only what we paused. */
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

/* How close a popup may come to the viewport edge before it is nudged back in. Read by BOTH popups
 * the theme places by hand — the Appearance popover below and the menu's dropdown edge-clamp
 * (menu-footstrap.js) — which had each written their own `8`. */
const EDGE_GAP = 8;

/* Place the popover next to its trigger and keep it inside the viewport. It is position:fixed on
 * <body> because the sidebar is `overflow-y: auto` (which computes overflow-x to `auto` too), so
 * an absolutely-positioned popover parented to the Appearance row was clipped off the sidebar
 * edge. The top bar opens downward from the button's right edge, the sidebar sideways out of the
 * rail; both are then clamped. */
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

/* ---- theme version + update check ----
 * FS_VERSION is stamped at build/deploy: the package Makefile (Build/Prepare) and dev-sync.sh
 * rewrite the '0.0.0-dev' literal below. An unstamped source checkout stays 'dev' and skips the
 * check. The ROUTER asks GitHub, not the browser (`footstrap-selfupdate.sh check`, the ACL-gated
 * script the Update button runs): a LAN client often has no route to the internet while the router
 * does, and it keeps the check off the user's own IP rate limit. Cached an hour by the script,
 * memoised here per page load. Fails silent: no reachable API → no badge, the version still shows. */
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

/* The parentheses around the regex are load-bearing — do not "tidy" them away. luci.mk minifies
 * this file with jsmin, whose regex-vs-division test is a ONE-character lookback against a fixed
 * allow-list. `n` (the last letter of `return`) is not on it, so `return /re/` is read as a
 * division and the regex's `//` swallows the rest of the file — exiting 0 (openwrt/luci#8299).
 * `(` IS on the allow-list. tools/jsmin-verify.mjs is the gate; this is the fix. */
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
			/* "v1.2.3" on success; "ERR: …" when the router could not reach the API, or
			 * "ERR: unknown argument" from a backend older than this JS. All three: no badge. */
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

	/* Axes in order: Layout, Theme, Palette, Wallpaper, Tint, Accent, Rounding, Submenus (sidebar
	 * only), Updates.
	 *
	 * EVERY LABEL IN HERE CARRIES THE 'footstrap' CONTEXT (`_(str, ctx)`, key `ctx\1str`). LuCI
	 * serves ONE MERGED catalogue — load_catalog() loads every *.<lang>.lmo in
	 * /usr/lib/lua/luci/i18n and a lookup returns the first archive holding the hash — so a msgid is
	 * a GLOBAL name shared with every luci-app, and readdir order picks the winner: the layout
	 * toggle rendered "Максимум" on a Russian router (issue #6), because another catalogue
	 * translates the msgid "Top" as "maximum". Contexting cannot be selective — whatever we leave
	 * bare is a name anyone may take. The chrome and the login/notice sentences are deliberately
	 * bare (inheriting luci-base's translation is a feature in the ~40 languages we have no
	 * catalogue for), as are System/Memory/Storage in 05_footstrap_overview_layout.js, which MATCH
	 * the stock headings. */
	const groups = [
		E('div', { 'class': 'fs-ap-group' }, [
			E('div', { 'class': 'fs-ap-label' }, [ _('Layout', 'footstrap') ]),
			segControl(currentLayout(), [
				{ val: 'sidebar', label: _('Sidebar', 'footstrap') },
				{ val: 'top',     label: _('Top', 'footstrap') }
			], applyLayout, _('Layout', 'footstrap'))
		]),
		E('div', { 'class': 'fs-ap-group' }, [
			E('div', { 'class': 'fs-ap-label' }, [ _('Theme', 'footstrap') ]),
			segControl(currentMode(), [
				{ val: 'auto',  label: _('Auto', 'footstrap') },
				{ val: 'light', label: _('Light', 'footstrap') },
				{ val: 'dark',  label: _('Dark', 'footstrap') }
			], applyMode, _('Theme', 'footstrap'))
		]),
		E('div', { 'class': 'fs-ap-group' }, [
			E('div', { 'class': 'fs-ap-label' }, [ _('Palette', 'footstrap') ]),
			segControl(currentPalette(), [
				{ val: 'footstrap',  label: 'Footstrap' },
				{ val: 'hicontrast', label: 'Hi-Contrast' }
			], applyPalette, _('Palette', 'footstrap'))
		]),
		E('div', { 'class': 'fs-ap-group' }, [
			E('div', { 'class': 'fs-ap-label' }, [ _('Wallpaper', 'footstrap') ]),
			segControl(currentWallpaper(), [
				{ val: 'off',  label: _('Off', 'footstrap') },
				{ val: 'cats', label: _('Cats', 'footstrap') }
			], applyWallpaper, _('Wallpaper', 'footstrap'))
		]),
		E('div', { 'class': 'fs-ap-group' }, [
			/* the caption says what the axis is FOR: "Tint" alone reads as decoration and
			 * nobody would look for the router-identity cue under it */
			E('div', { 'class': 'fs-ap-label' }, [ _('Tint (router identification)', 'footstrap') ]),
			/* step 5 = 72 hues, which is finer than anyone can name and coarse enough
			 * that the same router lands on the same colour when it is set again. */
			sliderControl(currentTint(), 0, 360, applyTint, _('Tint (router identification)', 'footstrap'), {
				step: 5,
				cls: 'fs-range-hue',
				fmt: v => (v ? v + '°' : _('Off', 'footstrap'))
			})
		]),
		E('div', { 'class': 'fs-ap-group' }, [
			E('div', { 'class': 'fs-ap-label' }, [ _('Accent', 'footstrap') ]),
			/* recolours the accented CONTROLS (buttons/toggles/sliders/focus rings), not
			 * the canvas the way Tint does — same hue slider, off at 0 = palette default */
			sliderControl(currentAccent(), 0, 360, applyAccent, _('Accent', 'footstrap'), {
				step: 5,
				cls: 'fs-range-hue fs-range-accent',
				fmt: v => (v ? v + '°' : _('Off', 'footstrap'))
			})
		]),
		E('div', { 'class': 'fs-ap-group' }, [
			E('div', { 'class': 'fs-ap-label' }, [ _('Rounding', 'footstrap') ]),
			sliderControl(currentRadius(), 0, 20, applyRadius, _('Rounding', 'footstrap'))
		])
	];

	/* The top layout has no accordion (its sections are hover dropdowns, already exclusive), so this
	 * switch is meaningless there. ALWAYS BUILT, HIDDEN BY CSS (:root[data-layout="top"]
	 * .fs-ap-submenus, theme/20-shell.css). Do NOT put an `if (currentLayout() !== 'top')` around the
	 * push: the popover is built ONCE, in init(), so the branch froze the control to the layout the
	 * PAGE LOADED in — it stayed on screen after a switch to the bar, and never appeared after a
	 * switch away from it. Toggling the layout re-renders nothing; CSS morphs the chrome. */
	groups.push(E('div', { 'class': 'fs-ap-group fs-ap-submenus' }, [
		E('div', { 'class': 'fs-ap-label' }, [ _('Submenus', 'footstrap') ]),
		segControl(currentAutoCollapse() ? 'on' : 'off', [
			{ val: 'off', label: _('Keep open', 'footstrap') },
			{ val: 'on',  label: _('Auto-collapse', 'footstrap') }
		], applyAutoCollapse, _('Submenus', 'footstrap'))
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
		E('div', { 'class': 'fs-ap-label' }, [ _('Updates', 'footstrap') ]),
		segControl(currentUpdateCheck() ? 'on' : 'off', [
			{ val: 'on',  label: _('Check', 'footstrap') },
			{ val: 'off', label: _('Off', 'footstrap') }
		], applyUpdateCheck, _('Updates', 'footstrap'))
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

	/* reveal the badge + Update button and mark the trigger (green dot) when a newer release
	 * exists. Runs once per page load, and again when the Updates toggle flips. */
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

	/* one-click self-update: confirm, then run the ACL-gated backend via fs.exec, which installs the
	 * latest release with apk (25.12) or opkg (24.10) and reloads the page. No user input reaches the
	 * script — the ACL grants exec of that fixed path only and the arguments below are literals.
	 *
	 * The install outlives the RPC path: rpc.js aborts the XHR after `L.env.rpctimeout` (20 s) and
	 * rpcd kills the exec'd process after its own `timeout` (30 s). So the script spawns a detached
	 * worker and returns STARTED; we poll `status` until it flips to OK or ERR. */
	const FS_UPDATE_POLL_MS = 2000;
	const FS_UPDATE_LIMIT_MS = 300000;

	function runSelfUpdate() {
		close(false);	/* the modal takes focus from here */
		/* Everything below belongs to THIS run. navigate() bumps _updGen, so a resolved RPC from
		 * a run the user has navigated away from does nothing instead of rescheduling itself and
		 * popping a modal over the new page. */
		const gen = ++_updGen;
		const stale = () => gen !== _updGen;
		const modal = (body) => { if (!stale()) ui.showModal(_('Update Footstrap'), body); };
		/* The message is an ARRAY child, and that is not a style choice: dom.append() assigns a
		 * BARE STRING child via `node.innerHTML`, and only an array becomes a text node. What
		 * lands here is raw installer output (`ERR: install failed: <apk/opkg stderr>`) plus RPC
		 * exception text — the one string in this theme neither the theme nor LuCI composed.
		 * Markup in it would be parsed. */
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

		/* The update no longer logs you out — postinst does `rpcd reload` (SIGHUP; re-reads the ACL
		 * dir, all this package needs) instead of `rpcd restart`, which destroys every in-memory
		 * session. Keep the branch anyway: an expired session arriving after the installer ran means
		 * the package DID install (postinst is the last thing to run), and "sign in again" is the
		 * right answer whatever killed it — a hand-rolled rpcd restart, a luci-base upgrade
		 * alongside, a reboot. The reload also re-fetches the cache-busted CSS/JS. */
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
				/* RUNNING, or IDLE if the worker has not written the file yet. Tracked in
				 * _updTimer so navigate() can cancel the chain. */
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

	/* Clicking outside means the user is going elsewhere — closing must not yank their focus back
	 * to the trigger. Escape and the trigger itself do. */
	function outside(e) { if (!pop.contains(e.target) && !btn.contains(e.target) && e.target !== btn) close(false); }
	function reposition() { placePopover(btn, pop); }

	/* role="dialog" is a promise about keyboard behaviour the popover was not keeping: focus
	 * stayed on the page behind, Tab walked straight out of the open dialog into the view
	 * underneath, and a click-outside close dropped focus on the floor. */
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
	/* NO stopPropagation here: it is not needed (outside() is registered in the CAPTURE phase and
	 * already excludes clicks on btn) and it broke the sidebar — menu-footstrap.js closes an open
	 * flyout from a BUBBLE-phase click listener on document, which never saw the event, so opening
	 * Appearance from a collapsed rail left the flyout hanging open underneath. */
	btn.addEventListener('click', () => { pop.hidden ? open() : close(); });
}

/* Sidebar rail toggle: collapse the sidebar to an icon-only strip. The state lives on
 * <html data-rail> (head.ut re-applies it before paint) and in localStorage; everything else —
 * flyout submenus, hidden labels — is CSS keyed off that attribute. */
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
		/* the sidebar's cut just changed by ~156px, so the content column may now clear (or fall
		 * below) --fs-content-min: re-measure rather than wait for a resize that is not coming */
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

	/* entry point: load the menu tree, render the mode menu (which drives the injected
	 * renderMainMenu) and the section tabs, and wire the chrome. */
	init(renderMainMenu) {
		ui.menu.load().then((tree) => {
			_tree = tree;
			_renderMain = renderMainMenu;

			/* The page we are standing on arrived as a full load, so LuCI has ALREADY required —
			 * hence instantiated and rendered — its view. Seed `_seen`, or the first SPA nav BACK
			 * to this page would take require()'s cached instance, skip the re-instantiation and
			 * render nothing at all. */
			const here = viewClassFor(nodeForSegs(L.env.dispatchpath || []));
			if (here)
				_seen.add(here);

			/* the bar's "does the menu fit beside the brand" measurement joins the engine the
			 * tables use: it re-runs on every #view resize (a rail collapse and a layout toggle
			 * produce one) and on content mutations */
			fit.add(fitChrome);

			renderChrome();
			wireAppearance();
			wireRail();
			wireRouter();
			wireVisibility();
			wireTabFit();
			watchViewSheets();
		/* renderTabMenu warns about exactly this, and the root chain was left bare: a throw
		 * anywhere in the calls above took out the menu, the router and the Appearance popover
		 * together, silently. It still fails — there is no sane partial recovery — but loudly. */
		}).catch((e) => console.error('footstrap: chrome init failed', e));
	}
});
