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
const _prefetched = new Set();
function prefetchView(pathname) {
	const segs = segsFromPath(pathname);
	if (!segs) return;
	const className = viewClassFor(nodeForSegs(segs));
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
}

/* Attempt an in-place navigation to `pathname`. Returns true if handled as a
 * SPA nav (caller should preventDefault), false to let the browser do a normal
 * full navigation. `push` adds a history entry (false when replaying popstate). */
function navigate(pathname, push) {
	const segs = segsFromPath(pathname);
	if (!segs) return false;

	const node = nodeForSegs(segs);
	const className = viewClassFor(node);
	if (!className)
		return false;

	/* Ensure a #view container. View pages and the overview template both emit
	 * one; a `cbi`/other template page may not — inject one into .fs-content,
	 * dropping the stale content, so we can SPA there. When arriving via SPA the
	 * previous view's #view is reused and LuCI.view replaces its content. */
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

	/* teardown: drop the outgoing view's pollers so they stop hitting detached
	 * DOM / wasting RPCs. Flush the queue but do NOT Poll.stop() — stop() deletes
	 * the internal tick and the incoming view's poll.add() would never auto-start.
	 * The only non-view poller LuCI adds is the transient apply/reboot reachability
	 * check, so a flush here is safe. */
	if (L.Poll && L.Poll.queue)
		L.Poll.queue.length = 0;
	/* also kill the outgoing view's plain setInterval pollers (e.g. podkop's log
	 * tailer) — a full load would have; the SPA must do it explicitly. Keeps
	 * L.Poll's own tick alive. */
	clearViewIntervals();
	try { if (typeof ui.hideModal == 'function') ui.hideModal(); } catch (e) {}

	/* point the runtime env at the new node so views, tabs and highlighting read
	 * the right path. For a fully-matched leaf, request == dispatch path. */
	L.env.requestpath  = segs.slice();
	L.env.dispatchpath = segs.slice();
	L.env.pathinfo     = '/' + segs.join('/');
	L.env.nodespec     = { satisfied: true, action: node.action, title: node.title, depends: node.depends };

	/* Keep <body data-page> in sync with the route. The server template stamps
	 * `data-page="{{ join('-', request_path) }}"` on every full load, and LuCI's
	 * page-scoped CSS (and any per-page hook) keys off it. A SPA nav swaps the
	 * view without reloading, so — like requestpath/dispatchpath/title above —
	 * the router must re-stamp it, or the incoming page keeps the previous page's
	 * data-page and its scoped styles silently don't apply. This is route-state
	 * sync the router already owns, not a per-page patch: it fixes every
	 * body[data-page=…] rule at once. */
	document.body.setAttribute('data-page', segs.join('-'));

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
	if (className === 'view.status.index')
		ensureOverviewHelpers();

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

	/* warm the view module cache when the pointer enters a nav link */
	document.addEventListener('pointerover', (ev) => {
		const a = ev.target.closest && ev.target.closest('a[href]');
		if (!a || (a.target && a.target !== '_self') || a.hasAttribute('download'))
			return;
		const raw = a.getAttribute('href');
		if (!raw || raw.charAt(0) === '#') return;
		let url;
		try { url = new URL(a.href, window.location.href); } catch (e) { return; }
		if (url.origin === window.location.origin)
			prefetchView(url.pathname);
	}, false);

	window.addEventListener('popstate', () => {
		if (!navigate(window.location.pathname, false))
			window.location.reload();
	});
}

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
	document.addEventListener('visibilitychange', () => {
		if (!L.Poll) return;
		try { document.hidden ? L.Poll.stop() : L.Poll.start(); } catch (e) {}
	});
}

/* Place the popover next to its trigger and keep it inside the viewport.
 * It is position:fixed and lives on <body> — the sidebar is `overflow-y: auto`
 * (which computes overflow-x to `auto` too), so an absolutely-positioned popover
 * parented to the Appearance row was clipped/scrolled off the sidebar edge.
 * Top-nav opens downward from the right edge of the button; the sidebar opens
 * sideways out of the rail. Both are then clamped to the viewport. */
function placePopover(btn, pop) {
	const gap = 8, r = btn.getBoundingClientRect();
	const w = pop.offsetWidth, h = pop.offsetHeight;
	const vw = document.documentElement.clientWidth;
	const vh = document.documentElement.clientHeight;
	const top_layout = document.body.classList.contains('fs-top');

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
	document.body.appendChild(pop);

	function outside(e) { if (!pop.contains(e.target) && !btn.contains(e.target) && e.target !== btn) close(); }
	function esc(e) { if (e.key === 'Escape') { close(); btn.focus(); } }
	function reposition() { placePopover(btn, pop); }
	function open() {
		pop.hidden = false; btn.setAttribute('aria-expanded', 'true');
		reposition();
		document.addEventListener('click', outside, true);
		document.addEventListener('keydown', esc);
		window.addEventListener('resize', reposition);
		window.addEventListener('scroll', reposition, true);
	}
	function close() {
		pop.hidden = true; btn.setAttribute('aria-expanded', 'false');
		document.removeEventListener('click', outside, true);
		document.removeEventListener('keydown', esc);
		window.removeEventListener('resize', reposition);
		window.removeEventListener('scroll', reposition, true);
	}

	btn.setAttribute('aria-haspopup', 'dialog');
	btn.setAttribute('aria-expanded', 'false');
	btn.addEventListener('click', (e) => { e.stopPropagation(); pop.hidden ? open() : close(); });
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
	});

	sync();
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
			wireRail();
			wireRouter();
			wireVisibility();
		});
	}
});
