'use strict';
'require baseclass';
'require ui';

/* Shared menu logic for both footstrap layouts.
 *
 * LuCI instantiates every required baseclass module into a singleton, so a base
 * class can't be `extend`-ed across modules. The idiomatic workaround (as used
 * by luci-app-podkop: `require view.podkop.main as main; main.foo()`) is
 * COMPOSITION — export functions you call on the singleton, and inject the
 * variable part (the layout-specific renderMainMenu) as a callback.
 *
 * So: mode menu, section tabs and the theme toggle live here once; each layout
 * (menu-footstrap / menu-footstrap-top) only defines renderMainMenu and calls
 * common.bootstrap(renderMainMenu). */

/* section tabs -> #tabmenu (horizontal) */
function renderTabMenu(tree, url, level) {
	const container = document.querySelector('#tabmenu');
	const ul = E('ul', { 'class': 'tabs' });
	const children = ui.menu.getChildren(tree);
	let activeNode = null;

	children.forEach(child => {
		const isActive = (L.env.dispatchpath[3 + (level || 0)] == child.name);
		ul.appendChild(E('li', { 'class': 'tabmenu-item-%s %s'.format(child.name, isActive ? 'active' : '') }, [
			E('a', { 'href': L.url(url, child.name) }, [ _(child.title) ])
		]));
		if (isActive)
			activeNode = child;
	});

	if (ul.children.length == 0)
		return E([]);

	container.appendChild(ul);
	container.style.display = '';

	if (activeNode)
		renderTabMenu(activeNode, url + '/' + activeNode.name, (level || 0) + 1);

	return ul;
}

/* modes -> #modemenu; drives the injected renderMainMenu for the active mode */
function renderModeMenu(tree, renderMainMenu) {
	const ul = document.querySelector('#modemenu');
	const children = ui.menu.getChildren(tree);

	children.forEach((child, index) => {
		const isActive = L.env.requestpath.length
			? child.name === L.env.requestpath[0]
			: index === 0;

		ul.appendChild(E('li', { 'class': isActive ? 'active' : '' }, [
			E('a', { 'href': L.url(child.name) }, [ _(child.title) ])
		]));

		if (isActive)
			renderMainMenu(child, child.name);
	});

	if (children.length <= 1)
		ul.classList.add('single');
	if (ul.children.length > 1)
		ul.style.display = '';
}

/* header Appearance popover: Mode (auto/light/dark) + Palette (footstrap/github).
 * Both axes are client-side, instant, persisted in localStorage — no server, no
 * reload. head.ut's inline script applies both before paint (no flash). Layout
 * (sidebar/top) is a server choice and stays in the stock "Design" dropdown. */
function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
function lsDel(k) { try { localStorage.removeItem(k); } catch (e) {} }

function currentMode() {
	const s = lsGet('fs-darkmode');
	return s === 'true' ? 'dark' : (s === 'false' ? 'light' : 'auto');
}
function currentPalette() {
	const s = lsGet('fs-palette');
	if (s === 'roman') return 'rvht';	/* legacy name */
	return (s === 'github' || s === 'rvht') ? s : 'footstrap';
}
function applyMode(val) {
	const root = document.querySelector(':root');
	if (val === 'auto') lsDel('fs-darkmode');
	else lsSet('fs-darkmode', val === 'dark' ? 'true' : 'false');
	const dark = (val === 'dark') ||
		(val === 'auto' && window.matchMedia('(prefers-color-scheme: dark)').matches);
	root.setAttribute('data-darkmode', dark ? 'true' : 'false');
}
function applyPalette(val) {
	const root = document.querySelector(':root');
	if (val === 'footstrap') { lsDel('fs-palette'); root.removeAttribute('data-palette'); }
	else { lsSet('fs-palette', val); root.setAttribute('data-palette', val); }
}

/* one segmented control; highlights the active option, calls onPick on change */
function segControl(current, opts, onPick) {
	const wrap = E('div', { 'class': 'fs-seg', 'role': 'group' });
	opts.forEach(o => {
		const b = E('button', {
			'type': 'button',
			'class': o.val === current ? 'active' : '',
			'data-val': o.val
		}, [ o.label ]);
		b.addEventListener('click', () => {
			onPick(o.val);
			wrap.querySelectorAll('button').forEach(x => x.classList.toggle('active', x === b));
		});
		wrap.appendChild(b);
	});
	return wrap;
}

function wireAppearance() {
	const btn = document.getElementById('fs-appearance');
	if (!btn) return;

	const pop = E('div', { 'class': 'fs-appearance-pop', 'role': 'dialog', 'aria-label': _('Appearance'), 'hidden': '' }, [
		E('div', { 'class': 'fs-ap-group' }, [
			E('div', { 'class': 'fs-ap-label' }, [ _('Theme') ]),
			segControl(currentMode(), [
				{ val: 'auto',  label: _('Auto') },
				{ val: 'light', label: _('Light') },
				{ val: 'dark',  label: _('Dark') }
			], applyMode)
		]),
		E('div', { 'class': 'fs-ap-group' }, [
			E('div', { 'class': 'fs-ap-label' }, [ _('Palette') ]),
			segControl(currentPalette(), [
				{ val: 'footstrap', label: 'Footstrap' },
				{ val: 'github',    label: 'GitHub' },
				{ val: 'rvht',      label: 'Rvht' }
			], applyPalette)
		])
	]);
	btn.parentNode.classList.add('fs-appearance-wrap');
	btn.parentNode.appendChild(pop);

	function outside(e) { if (!pop.contains(e.target) && !btn.contains(e.target) && e.target !== btn) close(); }
	function esc(e) { if (e.key === 'Escape') { close(); btn.focus(); } }
	function open() {
		pop.hidden = false; btn.setAttribute('aria-expanded', 'true');
		document.addEventListener('click', outside, true);
		document.addEventListener('keydown', esc);
	}
	function close() {
		pop.hidden = true; btn.setAttribute('aria-expanded', 'false');
		document.removeEventListener('click', outside, true);
		document.removeEventListener('keydown', esc);
	}

	btn.setAttribute('aria-haspopup', 'dialog');
	btn.setAttribute('aria-expanded', 'false');
	btn.addEventListener('click', (e) => { e.stopPropagation(); pop.hidden ? open() : close(); });
}

return baseclass.extend({
	/* entry point: load the menu tree, render mode menu (which drives the
	 * injected renderMainMenu), the section tabs, and wire the theme toggle. */
	bootstrap(renderMainMenu) {
		ui.menu.load().then((tree) => {
			renderModeMenu(tree, renderMainMenu);

			if (L.env.dispatchpath.length >= 3) {
				let node = tree, url = '';
				for (let i = 0; i < 3 && node; i++) {
					node = node.children[L.env.dispatchpath[i]];
					url = url + (url ? '/' : '') + L.env.dispatchpath[i];
				}
				if (node)
					renderTabMenu(node, url);
			}

			wireAppearance();
		});
	}
});
