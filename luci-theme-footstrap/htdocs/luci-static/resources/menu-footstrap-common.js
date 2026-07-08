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
	if (s === 'hicontrast') return 'hicontrast';
	if (s === 'rvht' || s === 'roman') return 'rvht';	/* roman = legacy name */
	return 'footstrap';	/* default = GitHub colors; legacy 'github'/null map here */
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
	/* hicontrast = the base :root tokens (no data-palette attr); footstrap
	 * (default, GitHub colors) and rvht set an explicit attr. */
	if (val === 'hicontrast') { lsSet('fs-palette', 'hicontrast'); root.removeAttribute('data-palette'); }
	else if (val === 'footstrap') { lsDel('fs-palette'); root.setAttribute('data-palette', 'footstrap'); }
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

/* ---- SPA client router (variant C) ---------------------------------------
 *
 * Kills the full page reload for `view`-type menu nodes (~89% of pages). LuCI
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
}

/* /cgi-bin/luci/admin/status/overview -> ['admin','status','overview'] */
function segsFromPath(pathname) {
	const base = L.env.scriptname || '';
	if (base && pathname.indexOf(base) !== 0)
		return null;
	const rest = pathname.slice(base.length).replace(/^\/+|\/+$/g, '');
	return rest.length ? rest.split('/') : null;
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

/* Attempt an in-place navigation to `pathname`. Returns true if handled as a
 * SPA nav (caller should preventDefault), false to let the browser do a normal
 * full navigation. `push` adds a history entry (false when replaying popstate). */
function navigate(pathname, push) {
	const segs = segsFromPath(pathname);
	if (!segs) return false;

	const node = nodeForSegs(segs);
	if (!node || !node.action || node.action.type !== 'view' || node.satisfied === false)
		return false;

	/* Ensure a #view container. On view pages the dispatcher emits one; on a
	 * `template` page (e.g. the status overview) it doesn't — inject one into
	 * .fs-content, dropping the stale template content, so we can SPA *away* from
	 * overview too. Navigating back TO overview stays a full reload (it's a
	 * template node → navigate() bails), so it always re-renders fresh. */
	if (!document.getElementById('view')) {
		const host = document.querySelector('.fs-content');
		if (!host) return false;
		Array.from(host.children).forEach(c => {
			if (c.id !== 'tabmenu' && !c.classList.contains('alert-message') && c.nodeName !== 'NOSCRIPT')
				c.remove();
		});
		const v = document.createElement('div');
		v.id = 'view';
		host.appendChild(v);
	}

	const className = 'view.' + String(node.action.path).replace(/\//g, '.');

	/* teardown: drop the outgoing view's pollers so they stop hitting detached
	 * DOM / wasting RPCs. Flush the queue but do NOT Poll.stop() — stop() deletes
	 * the internal tick and the incoming view's poll.add() would never auto-start.
	 * The only non-view poller LuCI adds is the transient apply/reboot reachability
	 * check, so a flush here is safe. */
	if (L.Poll && L.Poll.queue)
		L.Poll.queue.length = 0;
	try { if (typeof ui.hideModal == 'function') ui.hideModal(); } catch (e) {}

	/* point the runtime env at the new node so views, tabs and highlighting read
	 * the right path. For a fully-matched leaf, request == dispatch path. */
	L.env.requestpath  = segs.slice();
	L.env.dispatchpath = segs.slice();
	L.env.pathinfo     = '/' + segs.join('/');
	L.env.nodespec     = { satisfied: true, action: node.action, title: node.title, depends: node.depends };

	if (push)
		history.pushState({ fsnav: true }, '', pathname);

	/* titles: <host> | <page> */
	const host = (document.title.split('|')[0] || '').trim();
	document.title = node.title ? (host + ' | ' + _(node.title)) : host;
	const tmain = document.querySelector('.fs-title-main');
	if (tmain && node.title)
		tmain.textContent = _(node.title);

	renderChrome();

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
	 * Fresh instance -> fresh __init__ -> renders into #view. require/instanceof
	 * errors fall back to a real navigation; render-time errors are handled inside
	 * LuCI.view (shows the stock error), same as a full load. */
	const RT = window.L;
	RT.require(className).then(view => {
		if (!(view instanceof RT.view))
			throw new TypeError('Loaded class ' + className + ' is not a view');
		new view.constructor();
	}).catch(() => { window.location = pathname; });

	return true;
}

function wireRouter() {
	if (_wired) return;
	_wired = true;

	document.addEventListener('click', (ev) => {
		if (ev.defaultPrevented || ev.button !== 0 ||
		    ev.ctrlKey || ev.metaKey || ev.shiftKey || ev.altKey)
			return;

		const a = ev.target.closest('a[href]');
		if (!a) return;
		if (a.target && a.target !== '_self') return;
		if (a.hasAttribute('download')) return;

		const raw = a.getAttribute('href');
		if (!raw || raw.charAt(0) === '#') return;

		let url;
		try { url = new URL(a.href, window.location.href); } catch (e) { return; }
		if (url.origin !== window.location.origin) return;

		if (navigate(url.pathname, true))
			ev.preventDefault();
	}, false);

	window.addEventListener('popstate', () => {
		if (!navigate(window.location.pathname, false))
			window.location.reload();
	});
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
				{ val: 'footstrap',  label: 'Footstrap' },
				{ val: 'hicontrast', label: 'Hi-Contrast' },
				{ val: 'rvht',       label: 'Rvht' }
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
			_tree = tree;
			_renderMain = renderMainMenu;

			renderChrome();
			wireAppearance();
			wireRouter();
		});
	}
});
