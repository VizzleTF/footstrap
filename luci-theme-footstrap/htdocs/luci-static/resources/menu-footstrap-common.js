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
 * common.init(renderMainMenu). */

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
	const first = ul.firstElementChild, last = ul.lastElementChild;
	/* one row iff first and last item share a top edge */
	return !first || !last || first.offsetTop === last.offsetTop;
}
function fitTabStrips() {
	document.querySelectorAll('#tabmenu ul.tabs, .tabs, .cbi-tabmenu, .fs-topnav .fs-mainmenu').forEach((ul) => {
		ul.classList.remove('fs-dense1', 'fs-dense2');
		if (ul.children.length < 2 || stripFitsOneRow(ul)) return;
		ul.classList.add('fs-dense1');
		if (stripFitsOneRow(ul)) return;
		ul.classList.remove('fs-dense1');
		ul.classList.add('fs-dense2');	/* floor: leave wrapped if it still overflows */
	});
}
let _tabFitPending = false;
function scheduleTabFit() {
	if (_tabFitPending) return;
	_tabFitPending = true;
	requestAnimationFrame(() => { _tabFitPending = false; fitTabStrips(); });
}
let _tabFitWired = false;
function wireTabFit() {
	if (_tabFitWired) return;
	_tabFitWired = true;
	window.addEventListener('resize', scheduleTabFit);
	/* catch a view rendering its own .cbi-tabmenu after navigation */
	new MutationObserver(scheduleTabFit).observe(document.body, { childList: true, subtree: true });
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
	const root = document.querySelector(':root');
	if (val === 'cats') { lsSet('fs-wallpaper', 'cats'); root.setAttribute('data-wallpaper', 'cats'); }
	else { lsDel('fs-wallpaper'); root.removeAttribute('data-wallpaper'); }
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
	/* hicontrast = the base :root tokens (no data-palette attr); footstrap (default,
	 * GitHub colors) sets the explicit attr. Only these two remain. */
	if (val === 'hicontrast') { lsSet('fs-palette', 'hicontrast'); root.removeAttribute('data-palette'); }
	else { lsDel('fs-palette'); root.setAttribute('data-palette', 'footstrap'); }
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
	const root = document.querySelector(':root');
	const v = Math.max(0, Math.min(20, px | 0));
	if (v === FS_RADIUS_DEFAULT) { lsDel('fs-radius'); root.style.removeProperty('--fs-radius-base'); }
	else { lsSet('fs-radius', String(v)); root.style.setProperty('--fs-radius-base', v + 'px'); }
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

/* a range slider with a live px readout; onInput fires continuously as it drags */
function sliderControl(current, min, max, onInput) {
	const out = E('span', { 'class': 'fs-range-val' }, [ current + 'px' ]);
	const input = E('input', {
		'type': 'range', 'class': 'fs-range',
		'min': String(min), 'max': String(max), 'step': '1', 'value': String(current)
	});
	input.addEventListener('input', () => {
		const v = parseInt(input.value, 10);
		out.firstChild.data = v + 'px';
		onInput(v);
	});
	return E('div', { 'class': 'fs-rangewrap' }, [ input, out ]);
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

	scheduleTabFit();
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

/* ---- theme version + update check --------------------------------------
 * FS_VERSION is stamped at build/deploy: the package Makefile (Build/Compile)
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
	if (val === 'off') { lsSet('fs-update-check', 'off'); document.getElementById('fs-appearance')?.classList.remove('fs-has-update'); }
	else lsDel('fs-update-check');
	/* re-evaluate so turning it back on within the same session shows the state */
	_fsUpdatePromise = null;
	if (typeof window.__fsUpdateApply == 'function') window.__fsUpdateApply();
}

function fsVersionReal() { return /^\d+\.\d+/.test(FS_VERSION) && FS_VERSION !== '0.0.0-dev'; }
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
	_fsUpdatePromise = L.require('fs')
		.then(fs => fs.exec(FS_UPDATE_SCRIPT, [ 'check' ]))
		.then(res => {
			/* "v1.2.3" on success, "ERR: …" when the router could not reach the
			 * API — and "ERR: unknown argument" from a pre-check script, i.e. the
			 * installed backend is older than this JS. All three mean: no badge. */
			const out = String((res && res.stdout) || '').trim();
			const latest = /^v?\d/.test(out) ? out : null;
			return { current: FS_VERSION, latest, hasUpdate: !!(latest && fsVerCmp(latest, FS_VERSION) > 0) };
		})
		.catch(() => ({ current: FS_VERSION, latest: null, hasUpdate: false }));
	return _fsUpdatePromise;
}

function wireAppearance() {
	const btn = document.getElementById('fs-appearance');
	if (!btn) return;

	/* Popover axes: Theme, Palette, Wallpaper, plus Submenus (sidebar) and Updates.
	 * Palette dropped its third "Rvht" option — it set no colours, only the cats
	 * wallpaper, which is now its own Wallpaper axis (composes with either palette). */
	const groups = [
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
				{ val: 'hicontrast', label: 'Hi-Contrast' }
			], applyPalette)
		]),
		E('div', { 'class': 'fs-ap-group' }, [
			E('div', { 'class': 'fs-ap-label' }, [ _('Wallpaper') ]),
			segControl(currentWallpaper(), [
				{ val: 'off',  label: _('Off') },
				{ val: 'cats', label: _('Cats') }
			], applyWallpaper)
		]),
		E('div', { 'class': 'fs-ap-group' }, [
			E('div', { 'class': 'fs-ap-label' }, [ _('Rounding') ]),
			sliderControl(currentRadius(), 0, 20, applyRadius)
		])
	];

	/* the top-nav layout has no accordion — its sections are hover dropdowns,
	 * already exclusive — so the switch is offered on the sidebar layout only */
	if (!document.body.classList.contains('fs-top')) {
		groups.push(E('div', { 'class': 'fs-ap-group' }, [
			E('div', { 'class': 'fs-ap-label' }, [ _('Submenus') ]),
			segControl(currentAutoCollapse() ? 'on' : 'off', [
				{ val: 'off', label: _('Keep open') },
				{ val: 'on',  label: _('Auto-collapse') }
			], applyAutoCollapse)
		]));
	}

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
		], applyUpdateCheck)
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
		close();
		const modal = (body) => ui.showModal(_('Update Footstrap'), body);
		const fail = (msg) => modal([
			E('p', {}, _('Update failed') + ': ' + String(msg || _('unknown error')).replace(/^ERR:\s*/, '').trim()),
			E('div', { 'class': 'right' }, E('button', { 'class': 'btn', 'click': ui.hideModal }, _('Close')))
		]);
		modal([
			E('p', {}, _('Download and install the latest Footstrap release from GitHub? The page reloads when done.')),
			E('div', { 'class': 'right' }, [
				E('button', { 'class': 'btn', 'click': ui.hideModal }, _('Cancel')), ' ',
				E('button', { 'class': 'btn cbi-button-action', 'click': doUpdate }, _('Update'))
			])
		]);

		/* The package's postinst restarts rpcd (it must: a reload would leave stale
		 * ACLs and a half-updated backend). rpcd keeps sessions in memory, so the
		 * restart logs this browser out and every further RPC answers "Login
		 * session is expired" / "Access denied". That is the SUCCESS path, not a
		 * failure: postinst only runs once the package installed. Say so and offer
		 * a fresh login — a full reload also re-fetches the new CSS/JS, whose
		 * cache-buster changed with the install. */
		const sessionGone = (m) =>
			/session is expired|Access denied|-32002|\b403\b/i.test(String(m));
		const relogin = () => modal([
			E('p', {}, _('Update installed. The router restarted its session service, so you have been logged out — sign in again to load the new theme.')),
			E('div', { 'class': 'right' }, E('button', {
				'class': 'btn cbi-button-action',
				'click': () => location.reload()
			}, _('Log in again')))
		]);

		function poll(fs, deadline) {
			if (Date.now() > deadline)
				return fail(_('timed out waiting for the installer'));

			return fs.exec(FS_UPDATE_SCRIPT, [ 'status' ]).then(res => {
				const out = String((res && res.stdout) || '').trim();
				if (/^OK$/.test(out)) {
					modal([ E('p', {}, _('Updated. Reloading…')) ]);
					window.setTimeout(() => location.reload(), 1200);
					return;
				}
				if (/^ERR:/.test(out))
					return fail(out);
				/* RUNNING, or IDLE if the worker has not written the file yet */
				window.setTimeout(() => poll(fs, deadline), FS_UPDATE_POLL_MS);
			}).catch(e => sessionGone(e && e.message || e) ? relogin() : fail(e && e.message || e));
		}

		function doUpdate() {
			modal([ E('p', { 'class': 'spinning' }, _('Downloading and installing…')) ]);
			L.require('fs')
				.then(fs => fs.exec(FS_UPDATE_SCRIPT).then(res => {
					const out = String((res && res.stdout) || '').trim();
					if (!/^(STARTED|RUNNING)$/.test(out))
						return fail((res && (res.stderr || res.stdout)) || '');
					poll(fs, Date.now() + FS_UPDATE_LIMIT_MS);
				}))
				.catch(e => fail(e && e.message || e));
		}
	}
	updateBtn.addEventListener('click', runSelfUpdate);

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
	/* menu-footstrap.js asks before unfolding a section (see applyAutoCollapse) */
	autoCollapse: currentAutoCollapse,

	/* entry point: load the menu tree, render mode menu (which drives the
	 * injected renderMainMenu), the section tabs, and wire the theme toggle. */
	init(renderMainMenu) {
		ui.menu.load().then((tree) => {
			_tree = tree;
			_renderMain = renderMainMenu;

			renderChrome();
			wireAppearance();
			wireRail();
			wireRouter();
			wireVisibility();
			wireTabFit();
		});
	}
});
