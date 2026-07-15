'use strict';
'require baseclass';
'require ui';
'require fs-fit as fit';
'require fs-prefs as prefs';
'require fs-menutree as tree';

/* The chrome AROUND the content: the mode menu, the section tabs, the rail toggle, and the
 * measurements that decide how much room any of it gets. The MAIN menu is not here — it is injected
 * by menu-footstrap.js as a callback (renderMainMenu), because LuCI instantiates every required
 * module into a singleton and so a renderer cannot be a subclass of the chrome (docs/11). */

/* the injected main-menu renderer; handed over once by the theme's init() */
let _renderMain = null;
function setRenderMain(fn) {
	_renderMain = fn;
}

/* section tabs -> #tabmenu (horizontal) */
function renderTabMenu(node, url, level) {
	const container = document.querySelector('#tabmenu');
	/* a template without the container must not reject: an unhandled rejection here kills the
	 * whole ui.menu.load() chain, i.e. every menu */
	if (!container)
		return E([]);
	const ul = E('ul', { 'class': 'tabs' });
	const children = ui.menu.getChildren(node);
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
	if (prefs.currentLayout() === 'top') {		/* no sidebar, no cut, nothing to decide */
		root.removeAttribute('data-narrow');
		return;
	}
	const g = shellGeometry();
	const cut = prefs.currentRail() ? g.railW : g.sidebarW;
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
	window.addEventListener('resize', () => fit.schedule());
	/* catch a view rendering its own .cbi-tabmenu after navigation */
	new MutationObserver((mutations) => {
		if (tabStripTouched(mutations)) fit.schedule();
	}).observe(document.body, { childList: true, subtree: true });
}

/* modes -> #modemenu; drives the injected renderMainMenu for the active mode */
function renderModeMenu(node, renderMainMenu) {
	const ul = document.querySelector('#modemenu');
	const children = ui.menu.getChildren(node);

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

/* rebuild mode menu + main menu + section tabs from the current L.env; on first load and after
 * every SPA nav. Containers are cleared first so a re-render does not stack duplicates. */
function renderChrome() {
	const root = tree.tree();
	const modemenu = document.querySelector('#modemenu');
	const topmenu  = document.querySelector('#topmenu');
	const tabmenu  = document.querySelector('#tabmenu');

	if (modemenu) { modemenu.innerHTML = ''; modemenu.style.display = 'none'; modemenu.classList.remove('single'); }
	if (topmenu)  topmenu.innerHTML = '';
	if (tabmenu)  { tabmenu.innerHTML = ''; tabmenu.style.display = 'none'; }

	renderModeMenu(root, _renderMain);

	if (L.env.dispatchpath.length >= 3) {
		let node = root, url = '';
		for (let i = 0; i < 3 && node; i++) {
			node = node.children[L.env.dispatchpath[i]];
			url = url + (url ? '/' : '') + L.env.dispatchpath[i];
		}
		if (node)
			renderTabMenu(node, url);
	}

	fit.schedule();
}

/* Sidebar rail toggle: collapse the sidebar to an icon-only strip. The state lives on
 * <html data-rail> (head.ut re-applies it before paint) and in localStorage; everything else —
 * flyout submenus, hidden labels — is CSS keyed off that attribute. */
function wireRail() {
	const btn = document.getElementById('fs-rail-toggle');
	if (!btn) return;

	function sync() {
		const on = prefs.currentRail();
		btn.setAttribute('aria-expanded', on ? 'false' : 'true');
		const label = on ? _('Expand menu') : _('Collapse menu');
		btn.setAttribute('aria-label', label);
		btn.setAttribute('title', label);
	}

	btn.addEventListener('click', () => {
		prefs.applyRail(!prefs.currentRail());
		sync();
		/* the sidebar's cut just changed by ~156px, so the content column may now clear (or fall
		 * below) --fs-content-min: re-measure rather than wait for a resize that is not coming */
		fit.schedule();
	});

	sync();
}

return baseclass.extend({
	setRenderMain,
	renderChrome,
	/* registered with fs-fit by the theme's init(): the bar's "does the menu fit beside the brand"
	 * measurement rides the same engine as the data tables' */
	fitChrome,
	wireTabFit,
	wireRail
});
