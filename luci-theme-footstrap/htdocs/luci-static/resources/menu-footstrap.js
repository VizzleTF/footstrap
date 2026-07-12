'use strict';
'require baseclass';
'require ui';
'require menu-footstrap-common as common';

/* Footstrap SIDEBAR menu (variant 1A): vertical #topmenu with icons and
 * collapsible sections. Shared mode/tab/toggle logic lives in
 * menu-footstrap-common (composed via common.init). Only renderMainMenu is
 * layout-specific. Spec: docs/09-realizatsiya-sidebar.md */

const ICONS = {
	status:   '<rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/>',
	system:   '<rect x="5" y="5" width="14" height="14" rx="2"/><rect x="9" y="9" width="6" height="6" rx="1"/><path d="M9 2v3M15 2v3M9 19v3M15 19v3M2 9h3M2 15h3M19 9h3M19 15h3"/>',
	services: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="2.6"/>',
	network:  '<circle cx="6" cy="18" r="2.4"/><circle cx="18" cy="6" r="2.4"/><circle cx="18" cy="18" r="2.4"/><path d="M8 16 16 8M8 18h7.5M18 8.5V16"/>',
	vpn:      '<rect x="4" y="10" width="16" height="10" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
	docker:   '<rect x="3" y="11" width="4" height="4" rx=".7"/><rect x="8" y="11" width="4" height="4" rx=".7"/><rect x="13" y="11" width="4" height="4" rx=".7"/><rect x="8" y="6" width="4" height="4" rx=".7"/><path d="M18 13c0 4-3 6-8 6-4 0-7-2-7-4"/>',
	_default: '<circle cx="12" cy="12" r="8.5"/>'
};

function iconSvg(name) {
	const key = String(name || '').toLowerCase();
	const body = ICONS[key]
		|| ((/vpn|wireguard|openvpn/).test(key) ? ICONS.vpn : null)
		|| ((/dock|container|lxc/).test(key) ? ICONS.docker : null)
		|| ((/net|wifi|wireless|firewall|dhcp/).test(key) ? ICONS.network : null)
		|| ((/serv|dnsmasq|cron/).test(key) ? ICONS.services : null)
		|| ((/stat|overview|dash/).test(key) ? ICONS.status : null)
		|| ICONS._default;
	return '<svg class="fs-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
		'stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">' + body + '</svg>';
}

/* The sidebar shows a section's children two different ways, and `.open` means
 * something different in each:
 *   - expanded sidebar (desktop, no rail): an inline accordion. Several sections
 *     may be open at once and the active one starts open.
 *   - collapsed rail, or the mobile top bar: a flyout/popup panel. Exactly one
 *     may be open, hover drives it on a mouse, and a tap toggles it — so `.open`
 *     must behave like the top-nav dropdown (exclusive, cleared on outside click
 *     and once a real mouse enters the menu). */
/* one MediaQueryList for the mobile breakpoint — flyoutMode() runs on every
 * click/pointerenter/render item, and allocating a fresh MQL each time is
 * wasted work. Must track the 767px breakpoint in 20-shell-sidebar.css /
 * 90-responsive.css. */
const _mqMobile = window.matchMedia('(max-width: 767px)');
function flyoutMode() {
	return document.documentElement.getAttribute('data-rail') === 'true' ||
	       _mqMobile.matches;
}

/* `.open` is the only thing that told a sighted user a section was unfolded, and
 * it told a screen-reader user nothing: the trigger announced itself as a link
 * (href="#"), with no indication that it controlled a panel or what state that
 * panel was in. Every open/close now goes through here so the class and
 * aria-expanded cannot drift apart. */
function setOpen(li, on) {
	li.classList.toggle('open', on);
	li.querySelector(':scope > a')?.setAttribute('aria-expanded', on ? 'true' : 'false');
}

function closeFlyouts(except) {
	document.querySelectorAll('#topmenu > li.open').forEach((o) => {
		if (o !== except) setOpen(o, false);
	});
}

/* Restore the accordion after LEAVING flyout mode (rail expanded, or the window
 * grew past the phone breakpoint).
 *
 * closeFlyouts() alone used to run on both transitions, which was right going IN
 * (a stuck popup panel is worse than a folded one) and wrong coming OUT: it
 * stripped `.open` from every section, and since the markup is not rebuilt on a
 * rail toggle, the remembered set was never re-applied. Expanding the rail folded
 * everything the user had open and "Keep open" quietly stopped meaning anything. */
function restoreAccordion() {
	const auto = common.autoCollapse();
	document.querySelectorAll('#topmenu > li.has-sub').forEach((li) => {
		const name = li.dataset.name || '';
		setOpen(li, li.classList.contains('active') || (!auto && _openSections.has(name)));
	});
}

/* Which top-level sections are unfolded, by node name. renderChrome() wipes and
 * rebuilds #topmenu on every SPA nav, so without this a section the user opened
 * (Keep open mode) would refold the moment they switch tab — only the active
 * section, re-derived from the path, would stay open. We remember the accordion
 * state here and restore it in renderMainMenu. Only consulted in the expanded
 * sidebar with auto-collapse off; flyouts and auto-collapse are exclusive by
 * design and re-open just the active one.
 *
 * Persisted in localStorage: a module-level Set alone survives SPA navs but NOT a
 * full page load — and plenty of LuCI pages are not SPA-able (non-`view` nodes,
 * or any hard reload / F5), which would reset the Set and refold every section but
 * the active one. Backing it with localStorage keeps the unfolded set stable across
 * both kinds of navigation. */
const OPEN_KEY = 'fs-menu-open';
function loadOpenSections() {
	try {
		const a = JSON.parse(localStorage.getItem(OPEN_KEY) || '[]');
		return new Set(Array.isArray(a) ? a : []);
	} catch (e) { return new Set(); }
}
function saveOpenSections() {
	try { localStorage.setItem(OPEN_KEY, JSON.stringify(Array.from(_openSections))); } catch (e) {}
}
const _openSections = loadOpenSections();

/* main sections -> vertical sidebar list (#topmenu), collapsible */
function renderMainMenu(tree, url, level) {
	const ul = level ? E('ul', {}) : document.querySelector('#topmenu');
	const children = ui.menu.getChildren(tree);

	if (!ul || children.length === 0 || level > 1)
		return E([]);

	/* dispatchpath = [mode, section, subsection, …]; sections sit at
	 * index (level+1) because the first call gets the mode. */
	const idx = (level || 0) + 1;

	children.forEach(child => {
		/* the sidebar carries its own Logout entry at the bottom (header.ut), so
		 * drop the menu tree's top-level admin/logout node — otherwise it shows up
		 * twice. The top-nav layout has no footer link and keeps its own copy. */
		if (!level && child.name === 'logout')
			return;

		const submenu = renderMainMenu(child, url + '/' + child.name, (level || 0) + 1);
		const hasSub = !!submenu.firstElementChild;
		const isActive = (L.env.dispatchpath[idx] === child.name);

		/* expanded sidebar, Keep open: a section starts open if it is the active
		 * one OR it was left open before this re-render. Remembered so the state
		 * survives a SPA nav (renderChrome rebuilds #topmenu). Auto-collapse and
		 * flyout mode ignore the remembered set — they only ever open the active. */
		const keepOpen = hasSub && !level && !flyoutMode() && !common.autoCollapse();
		const startOpen = hasSub && !flyoutMode() &&
			(isActive || (keepOpen && _openSections.has(child.name)));
		if (keepOpen && startOpen && !_openSections.has(child.name)) {
			_openSections.add(child.name);
			saveOpenSections();
		}
		const chevron = hasSub
			? '<svg class="fs-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"/></svg>'
			: '';

		const link = E('a', {
			'href': hasSub ? '#' : L.url(url, child.name),
			'class': (isActive && !hasSub) ? 'active' : ''
		});
		link.innerHTML = (level ? '' : iconSvg(child.name)) + '<span class="fs-label"></span>' + chevron;
		link.querySelector('.fs-label').textContent = _(child.title);

		/* collapsed rail: the label is hidden, so carry it as an attribute — CSS
		 * renders it as the flyout's heading (sections) or as a tooltip (leaves). */
		if (!level) {
			link.setAttribute('data-label', _(child.title));
			if (hasSub)
				submenu.setAttribute('data-title', _(child.title));
		}

		const li = E('li', {
			'class': [
				isActive ? 'active' : '',
				hasSub ? 'has-sub' : '',
				/* pre-opening the active section is an accordion affordance; in
				 * flyout mode it would pop a panel open on page load */
				startOpen ? 'open' : ''
			].join(' ').trim()
		}, [ link, submenu ]);
		/* the node name, for restoreAccordion(): the markup is not rebuilt on a rail
		 * toggle, so the remembered set has to be matched back to live <li>s */
		if (!level) li.dataset.name = child.name;

		if (hasSub) {
			/* W3C APG disclosure-navigation pattern: a section header is a BUTTON that
			 * owns a panel, not a link to "#". Deliberately not role="menu" — APG is
			 * explicit that site navigation should not take on the menubar pattern's
			 * arrow-key semantics, which users do not expect here. */
			const subId = 'fs-sub-' + String(child.name).replace(/[^a-z0-9]+/gi, '-') + '-' + idx;
			submenu.id = subId;
			link.setAttribute('role', 'button');
			link.setAttribute('aria-controls', subId);
			link.setAttribute('aria-expanded', startOpen ? 'true' : 'false');

			link.addEventListener('click', (ev) => {
				ev.preventDefault();
				const open = li.classList.contains('open');
				/* flyout panels are always exclusive, but they must NOT touch the
				 * remembered accordion set — it mirrors the desktop "Keep open"
				 * state, and wiping it here meant one tap in the phone flyout lost
				 * the user's open sections after a resize back to desktop. */
				if (flyoutMode()) {
					closeFlyouts();
					setOpen(li, !open);
					return;
				}
				/* the expanded-sidebar accordion folds the others back only when
				 * asked (Appearance -> Submenus) */
				if (common.autoCollapse()) { closeFlyouts(); _openSections.clear(); }
				setOpen(li, !open);
				/* remember the accordion state so any navigation restores it (Keep open) */
				if (!open) _openSections.add(child.name);
				else _openSections.delete(child.name);
				saveOpenSections();
			});

			/* <a role="button"> is given Enter by the browser but not Space; a
			 * disclosure control must answer both. */
			link.addEventListener('keydown', (ev) => {
				if (ev.key !== ' ' && ev.key !== 'Spacebar') return;
				ev.preventDefault();
				link.click();
			});

			/* hybrid devices: once a real MOUSE enters the menu, drop the tap-opened
			 * panel so hover is authoritative and two panels never stack. Guarded on
			 * pointerType — a touch tap fires pointerenter (type 'touch') before the
			 * click, and clearing there would break tap-to-close. */
			li.addEventListener('pointerenter', (ev) => {
				if (ev.pointerType === 'mouse' && flyoutMode())
					closeFlyouts();
			});
		}

		ul.appendChild(li);
	});

	return ul;
}

return baseclass.extend({
	__init__() {
		common.init(renderMainMenu);

		/* close an open flyout when clicking outside the menu, and drop stale
		 * `.open` state whenever the two meanings swap (rail toggled, window
		 * crossing the mobile breakpoint) — an accordion left open would otherwise
		 * come back as a popup panel stuck on screen. */
		document.addEventListener('click', (ev) => {
			if (flyoutMode() && !ev.target.closest('#topmenu > li.has-sub'))
				closeFlyouts();
		});

		/* WCAG 2.2 SC 1.4.13: a panel opened by hover or focus must be dismissible
		 * from the keyboard, and the disclosure pattern wants focus back on the
		 * trigger that opened it. Neither existed. */
		document.addEventListener('keydown', (ev) => {
			if (ev.key !== 'Escape') return;
			const open = document.querySelector('#topmenu > li.open');
			if (!open || !flyoutMode()) return;
			const trigger = open.querySelector(':scope > a');
			closeFlyouts();
			trigger?.focus();
		});

		/* Entering flyout mode: fold everything, or a section left open as an
		 * accordion reappears as a popup panel stuck on screen. LEAVING it: put the
		 * accordion back the way the user had it — see restoreAccordion().
		 *
		 * Watch the ATTRIBUTE, not the rail button. common.wireRail() registers its
		 * own click handler from inside the ui.menu.load() promise, i.e. after this
		 * runs — so a click listener added here would fire FIRST and read the old
		 * data-rail. The attribute change is the state transition itself, and it
		 * cannot be observed too early. */
		const modeChanged = () => { flyoutMode() ? closeFlyouts() : restoreAccordion(); };
		new MutationObserver(modeChanged).observe(document.documentElement, {
			attributes: true, attributeFilter: [ 'data-rail' ]
		});
		_mqMobile.addEventListener('change', modeChanged);

		/* Appearance -> Submenus -> auto-collapse is handled in common.js, which can
		 * only reach the DOM: the remembered set and the aria-expanded state live
		 * here. Without this, switching auto-collapse ON folded the sections on
		 * screen but left them in the remembered set, and the next navigation
		 * unfolded every one of them again. */
		document.addEventListener('fs-autocollapse', (ev) => {
			if (ev.detail && ev.detail.on) {
				_openSections.clear();
				saveOpenSections();
			}
			document.querySelectorAll('#topmenu > li.has-sub')
				.forEach((li) => setOpen(li, li.classList.contains('open')));
		});
	}
});
