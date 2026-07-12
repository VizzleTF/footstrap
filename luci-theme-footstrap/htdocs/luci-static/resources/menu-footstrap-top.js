'use strict';
'require baseclass';
'require ui';
'require menu-footstrap-common as common';

/* Footstrap TOP-nav menu (variant 1B): horizontal #topmenu with one level of
 * hover dropdowns. Shared mode/tab/toggle logic lives in menu-footstrap-common
 * (composed via common.init). Only renderMainMenu is layout-specific.
 * Spec: docs/10-realizatsiya-topnav.md */

/* Each dropdown hangs off its own item (CSS anchors it at left:0 of the li), so
 * an item near the right edge would push its panel past the viewport. Nudge it
 * back inside. Measured after a frame: on pointerenter the :hover rule that
 * reveals the panel has not been applied yet, so it still measures 0x0. */
const EDGE_GAP = 8;
function clampDropdown(li) {
	const menu = li.querySelector(':scope > .dropdown-menu');
	if (!menu) return;

	/* One pending measure per item. Sweeping the pointer across the bar used to
	 * queue a frame per item crossed, each doing a write-then-read of layout, and
	 * none of them cancelled when the pointer had already moved on. */
	if (li._fsClampRaf) window.cancelAnimationFrame(li._fsClampRaf);
	li._fsClampRaf = window.requestAnimationFrame(() => {
		li._fsClampRaf = 0;
		menu.style.left = '0px';
		const r = menu.getBoundingClientRect();
		if (!r.width) return;			/* still hidden — nothing to place */

		const overflowRight = r.right - (window.innerWidth - EDGE_GAP);
		if (overflowRight > 0)
			menu.style.left = -Math.min(overflowRight, r.left - EDGE_GAP) + 'px';
	});
}

/* Open state lives in ONE place. It used to be carried by the `.open` class alone,
 * which told a sighted user everything and a screen-reader user nothing: the
 * section trigger announced itself as a link, with no hint that it controlled a
 * collapsible panel or whether that panel was open. */
function setOpen(li, on) {
	li.classList.toggle('open', on);
	li.querySelector(':scope > a.menu')?.setAttribute('aria-expanded', on ? 'true' : 'false');
	if (on) clampDropdown(li);
}
function closeAll(root) {
	(root || document).querySelectorAll('.fs-mainmenu > li.open, #topmenu > li.open').forEach((o) => setOpen(o, false));
}

/* main sections -> horizontal top menu with one level of dropdowns */
function renderMainMenu(tree, url, level) {
	const ul = level ? E('ul', { 'class': 'dropdown-menu' }) : document.querySelector('#topmenu');
	const children = ui.menu.getChildren(tree);

	if (!ul || children.length === 0 || level > 1)
		return E([]);

	children.forEach(child => {
		const submenu = renderMainMenu(child, url + '/' + child.name, (level || 0) + 1);
		const hasSub = !level && submenu.firstElementChild;
		const subclass = hasSub ? 'dropdown' : '';
		const linkclass = hasSub ? 'menu' : '';
		const linkurl = hasSub ? '#' : L.url(url, child.name);
		const active = (L.env.dispatchpath[(level || 0) + 1] === child.name);

		const link = E('a', { 'class': linkclass, 'href': linkurl }, [ _(child.title) ]);
		const li = E('li', { 'class': (subclass + (active ? ' active' : '')).trim() }, [ link, submenu ]);

		/* touch/click support: hover-only dropdowns are unusable on mobile, so
		 * tapping a section toggles its submenu open (and keeps it open until
		 * another is tapped or you tap outside — see the document handler). */
		if (hasSub) {
			/* The disclosure-navigation pattern (W3C APG): the trigger is a button
			 * that owns a panel, NOT a link — it goes nowhere, and href="#" made
			 * assistive tech announce it as one. role=button + aria-expanded +
			 * aria-controls is the whole contract. Deliberately NOT role="menu":
			 * APG says site navigation should not claim the menubar pattern, whose
			 * arrow-key/roving-tabindex behaviour users do not expect from a nav. */
			const subId = 'fs-topsub-' + url.replace(/[^a-z0-9]+/gi, '-') + '-' + child.name;
			submenu.id = subId;
			link.setAttribute('role', 'button');
			link.setAttribute('aria-haspopup', 'true');
			link.setAttribute('aria-expanded', 'false');
			link.setAttribute('aria-controls', subId);

			link.addEventListener('click', (ev) => {
				ev.preventDefault();
				const open = li.classList.contains('open');
				closeAll(ul);
				if (!open) setOpen(li, true);
			});
			/* An <a role="button"> gets Enter from the browser but not Space, and a
			 * disclosure must answer both. */
			link.addEventListener('keydown', (ev) => {
				if (ev.key !== ' ' && ev.key !== 'Spacebar') return;
				ev.preventDefault();
				link.click();
			});
			/* hybrid devices (desktop + touch): once a real MOUSE enters the
			 * menu, drop any tap-opened .open so hover becomes authoritative and
			 * you don't get a tapped menu stacked under a hovered one.
			 * Guard on pointerType === 'mouse' — a tap fires pointerenter with
			 * type 'touch' before click, and clearing .open there would break
			 * the second-tap-to-close on real touch devices. */
			li.addEventListener('pointerenter', (ev) => {
				if (ev.pointerType === 'mouse')
					closeAll(ul);
				clampDropdown(li);
			});
		}

		ul.appendChild(li);
	});

	ul.style.display = '';
	return ul;
}

return baseclass.extend({
	__init__() {
		common.init(renderMainMenu);
		/* close any open top-nav dropdown when tapping outside it */
		document.addEventListener('click', (ev) => {
			if (!ev.target.closest('.fs-mainmenu > li.dropdown'))
				closeAll();
		});
		/* WCAG 2.2 SC 1.4.13 (Content on Hover or Focus): content revealed by hover
		 * or focus must be DISMISSIBLE without moving the pointer. There was no way
		 * to close a dropdown from the keyboard at all. Focus goes back to the
		 * trigger, as the disclosure pattern requires. */
		document.addEventListener('keydown', (ev) => {
			if (ev.key !== 'Escape') return;
			const open = document.querySelector('.fs-mainmenu > li.open, #topmenu > li.open');
			if (!open) return;
			const trigger = open.querySelector(':scope > a.menu');
			closeAll();
			trigger?.focus();
		});
		/* a nudge computed for the old width is wrong at the new one; drop it and
		 * let the next hover/tap recompute. Coalesced into a frame: `resize` fires
		 * dozens of times a second while a window is dragged, and this used to walk
		 * the document and write inline styles on every single one. */
		let resizePending = false;
		window.addEventListener('resize', () => {
			if (resizePending) return;
			resizePending = true;
			window.requestAnimationFrame(() => {
				resizePending = false;
				document.querySelectorAll('.fs-mainmenu .dropdown-menu').forEach((m) => { m.style.left = ''; });
			});
		});
	}
});
