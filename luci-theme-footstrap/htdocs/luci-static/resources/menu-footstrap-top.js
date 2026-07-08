'use strict';
'require baseclass';
'require ui';
'require menu-footstrap-common as common';

/* Footstrap TOP-nav menu (variant 1B): horizontal #topmenu with one level of
 * hover dropdowns. Shared mode/tab/toggle logic lives in menu-footstrap-common
 * (composed via common.bootstrap). Only renderMainMenu is layout-specific.
 * Spec: docs/10-realizatsiya-topnav.md */

/* main sections -> horizontal top menu with one level of dropdowns */
function renderMainMenu(tree, url, level) {
	const ul = level ? E('ul', { 'class': 'dropdown-menu' }) : document.querySelector('#topmenu');
	const children = ui.menu.getChildren(tree);

	if (children.length == 0 || level > 1)
		return E([]);

	children.forEach(child => {
		const submenu = renderMainMenu(child, url + '/' + child.name, (level || 0) + 1);
		const hasSub = !level && submenu.firstElementChild;
		const subclass = hasSub ? 'dropdown' : '';
		const linkclass = hasSub ? 'menu' : '';
		const linkurl = hasSub ? '#' : L.url(url, child.name);
		const active = (L.env.dispatchpath[(level || 0) + 1] == child.name);

		const link = E('a', { 'class': linkclass, 'href': linkurl }, [ _(child.title) ]);
		const li = E('li', { 'class': (subclass + (active ? ' active' : '')).trim() }, [ link, submenu ]);

		/* touch/click support: hover-only dropdowns are unusable on mobile, so
		 * tapping a section toggles its submenu open (and keeps it open until
		 * another is tapped or you tap outside — see the document handler). */
		if (hasSub) {
			link.addEventListener('click', (ev) => {
				ev.preventDefault();
				const open = li.classList.contains('open');
				ul.querySelectorAll('li.open').forEach((o) => o.classList.remove('open'));
				if (!open) li.classList.add('open');
			});
			/* hybrid devices (desktop + touch): once a real MOUSE enters the
			 * menu, drop any tap-opened .open so hover becomes authoritative and
			 * you don't get a tapped menu stacked under a hovered one.
			 * Guard on pointerType === 'mouse' — a tap fires pointerenter with
			 * type 'touch' before click, and clearing .open there would break
			 * the second-tap-to-close on real touch devices. */
			li.addEventListener('pointerenter', (ev) => {
				if (ev.pointerType === 'mouse')
					ul.querySelectorAll('li.open').forEach((o) => o.classList.remove('open'));
			});
		}

		ul.appendChild(li);
	});

	ul.style.display = '';
	return ul;
}

return baseclass.extend({
	__init__() {
		common.bootstrap(renderMainMenu);
		/* close any open top-nav dropdown when tapping outside it */
		document.addEventListener('click', (ev) => {
			if (!ev.target.closest('.fs-mainmenu > li.dropdown'))
				document.querySelectorAll('.fs-mainmenu > li.open').forEach((o) => o.classList.remove('open'));
		});
	}
});
