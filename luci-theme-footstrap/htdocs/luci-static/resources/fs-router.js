'use strict';
'require baseclass';
'require ui';
'require fs-menutree as tree';
'require fs-chrome as chrome';
'require fs-sheets as sheets';

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
 * what a full load does anyway. docs/14.
 *
 * The path->node half lives in fs-menutree.js (the chrome needs it too); the "has a view poisoned
 * this document with its CSS?" half in fs-sheets.js. */

/* --- stray-interval teardown for SPA nav ---
 * A full load kills every window.setInterval the outgoing page set; SPA nav does not, so a view's
 * poller keeps firing against a page that is gone (luci-app-podkop's log tailer runs
 * `podkop check_logs` forever after you navigate away). Track view-set ids and clear them on nav,
 * keeping L.Poll's own 1s tick (also a setInterval); L.Poll's queue is flushed in navigate().
 * Hooked at module eval — before any view render can set a timer, and LuCI resolves a module's
 * dependencies BEFORE running the dependent's factory, so this runs no later than it used to when
 * it sat in menu-footstrap-common.js itself. */
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

let _wired = false;
/* The pathname whose view is CURRENTLY rendered — popstate compares against it to tell a real
 * navigation from a mere fragment change (see there). Seeded from the served page. */
let _curPath = window.location.pathname;
/* nav generation token: two quick clicks race their async require()s, and without it the FIRST
 * view could render into #view after the second, leaving stale content under the newer
 * URL/title/chrome. A resolved require whose generation is stale renders nothing. */
let _navGen = 0;

/* ---- Back must restore the sidebar layout's scroll, and the DOCUMENT is not the scroller there ----
 * In the top layout the document scrolls and the browser's own scrollRestoration ('auto') restores it
 * on popstate. In the sidebar layout the scroller is #maincontent (.fs-main owns overflow-y), and a
 * browser restores INNER scrollable regions only across full loads, never on a same-document
 * traversal — measured (docs/22 §2): Back opened the incoming page at 0, because the swap empties
 * #view, scrollHeight collapses and the browser clamps scrollTop. So the router records the offset
 * itself. NOT by replaceState on scroll: Safari rate-limits history writes (100 per 30 s) and a
 * scroll listener trips it. Each SPA entry instead carries a session-unique id (fsid) in
 * history.state, and the offsets live in this in-memory Map — lost on a full load, which is exactly
 * when the browser's own scrollable-region restoration takes over. The id is session-prefixed
 * because a bare counter restarts with every document: an entry stamped by a PREVIOUS document of
 * this tab would collide with a fresh one and restore another page's offset. */
const _scrollMem = new Map();
const _scrollSess = Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36);
let _histN = 0;
let _curId = null;
function newEntryId() { return _scrollSess + ':' + (++_histN); }

/* adopt the entry we are standing on: reuse its fsid if it has one, stamp one otherwise (entries
 * created by a full load carry state === null). replaceState keeps the entry's own scroll record. */
function adoptEntry() {
	const st = history.state;
	if (st && st.fsid) { _curId = st.fsid; return; }
	_curId = newEntryId();
	try { history.replaceState(Object.assign({}, st, { fsid: _curId }), '', window.location.href); } catch (e) {}
}

/* the outgoing DOM is still on screen at both call sites (the click, the popstate), so this must
 * run BEFORE _curId moves on to the incoming entry */
function saveScroll() {
	const sc = document.getElementById('maincontent');
	if (_curId && sc) _scrollMem.set(_curId, sc.scrollTop);
}

/* Put #maincontent back where the entry left it — but only once the incoming view has grown that
 * much height (docs/22 §5: restoring before the content exists is clamped to 0 and reads as
 * "worked"). The view renders behind an RPC, so poll by frame; a newer navigation cancels via the
 * generation, and a page that never reaches the old height again is simply left at the top. */
function restoreScroll(top, gen) {
	if (!top) return;
	let tries = 300; /* ~5 s at 60 fps — outlasts a slow RPC without polling forever */
	(function tick() {
		if (gen !== _navGen || --tries < 0) return;
		const sc = document.getElementById('maincontent');
		if (sc && sc.scrollHeight - sc.clientHeight >= top) sc.scrollTop = top;
		else requestAnimationFrame(tick);
	})();
}

/* The view class the page CURRENTLY on screen wants (what _curPath resolves to). Read by the
 * stale-render repair below to tell "the superseded render happened to paint the right view
 * anyway" from "it painted the wrong one". */
function currentViewClass() {
	const segs = tree.segsFromPath(_curPath);
	const res = segs && tree.resolveSegs(segs);
	return tree.viewClassFor(res && res.node);
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

/* ---- the generation must be checked at the PAINT, not at the dispatch ----
 *
 * _navGen is checked once, in the require() callback, i.e. BEFORE `new view.constructor()`. But a
 * view's __init__ is async — `ready.then(this.load).then(this.render).then(nodes =>
 * dom.content(document.getElementById('view'), nodes))` — so the DOM write happens two awaits later,
 * and every await is a point at which the whole event loop runs, another navigation included. The
 * dispatch-time check has expired by the time it matters.
 *
 * Measured on the router: leave the (cached) package manager for System after 150 ms, and the paints
 * into #view land 16010 System, 16490 package-manager — the view we walked away from paints LAST and
 * wins, permanently. URL, <title>, data-page and the menu highlight all say System; #view shows
 * Software. Only a reload clears it. The cached path is the COMMON one — after warm-up every
 * navigation takes it — and it had no guard at all: repairStaleRender() is called only when !cached.
 *
 * The fix has to be a paint-time check, and there are two constraints on where it can live.
 * ClassConstructor DISCARDS __init__'s return value (`this.__init__.apply(this, arguments)`, no
 * return), so the construction promise is unreachable — nothing to await. But __init__ resolves
 * `this.render` while it builds its chain, i.e. during `new`, so a wrapper installed on the
 * prototype BEFORE the construct is the one that gets bound. `new` then returns synchronously (the
 * first load() is already a microtask), which is what makes stamping the generation on the INSTANCE
 * right after it safe — and it must be the instance, not a map keyed by class name, or A → B → A
 * with everything cached would have the second construct's generation overwrite the first's.
 *
 * A superseded render resolves to a promise that never settles: the chain simply stops before
 * dom.content(), so nothing paints and addFooter() never runs. Returning empty nodes instead would
 * paint the emptiness over the live page, and throwing would hand LuCI's own .catch an error box to
 * render into the page we just opened.
 *
 * A view instance we did not construct (the singleton require() builds on a FIRST visit — the render
 * IS the require, so there is no window in which to arm anything) carries no stamp and is left alone:
 * that path is repairStaleRender()'s, and stays its. */
const _guarded = new WeakSet();
function armRenderGuard(cls) {
	if (_guarded.has(cls)) return;
	_guarded.add(cls);
	const orig = cls.prototype.render;
	cls.prototype.render = function () {
		/* unstamped: not ours to judge (see above) */
		const stale = () => this.__fsGen !== undefined && this.__fsGen !== _navGen;
		if (stale())
			return new Promise(() => {});
		return Promise.resolve(orig.apply(this, arguments)).then((nodes) => {
			/* re-check: render() itself awaits (an RPC, usually), which re-opens the window */
			return stale() ? new Promise(() => {}) : nodes;
		});
	};
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
	const segs = tree.segsFromPath(pathname);
	if (!segs) return;
	const res = tree.resolveSegs(segs);
	const className = tree.viewClassFor(res && res.node);
	if (!className || _prefetched.has(className)) return;
	_prefetched.add(className);
	try { fetch(moduleUrl(className), { credentials: 'same-origin' }).catch(() => {}); } catch (e) {}
}

/* The page we are standing on arrived as a full load, so LuCI has ALREADY required — hence
 * instantiated and rendered — its view. Seed `_seen`, or the first SPA nav BACK to this page would
 * take require()'s cached instance, skip the re-instantiation and render nothing at all. */
function seed() {
	const here = tree.viewClassFor(tree.currentNode());
	if (here)
		_seen.add(here);
	/* the served page's entry needs an id too, or the first Back TO it has nothing to look up */
	adoptEntry();
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
	if (typeof window.progressbar !== 'function')
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
	if (typeof window.renderBox !== 'function')
		window.renderBox = function(title, active, childs) {
			childs = childs || [];
			childs.unshift(window.L.itemlist(E('span'), [].slice.call(arguments, 3)));
			return E('div', { class: 'ifacebox' }, [
				E('div', { class: 'ifacebox-head center ' + (active ? 'active' : '') },
					E('strong', title)),
				E('div', { class: 'ifacebox-body left' }, childs)
			]);
		};
	if (typeof window.renderBadge !== 'function')
		window.renderBadge = function(icon, title) {
			return E('span', { class: 'ifacebadge' }, [
				E('img', { src: icon, title: title || '' }),
				window.L.itemlist(E('span'), [].slice.call(arguments, 2))
			]);
		};
	/* eslint-enable no-var */
}

/* Attempt an in-place navigation to `pathname`. Returns true if handled as a
 * SPA nav (caller should preventDefault), false to let the browser do a normal
 * full navigation. `push` adds a history entry (false when replaying popstate).
 * `kbd` — the navigation was activated from the keyboard (see the focus block). */
function navigate(pathname, push, kbd) {
	const segs = tree.segsFromPath(pathname);
	if (!segs) return false;

	/* The view on screen injected CSS that can repaint any page: this document is spent, and
	 * the only exit that leaves BOTH pages correct is a real navigation. See fs-sheets.js. */
	if (sheets.documentPoisoned()) return false;

	/* `segs` is what the user clicked, `rsegs` the leaf it resolves to; they differ for an
	 * alias/firstchild link, and a full load keeps BOTH — URL and pathinfo as requested,
	 * requestpath/dispatchpath/nodespec/title resolved. Mirror that split exactly, or an F5
	 * lands somewhere the click did not. */
	const res = tree.resolveSegs(segs);
	const node = res && res.node;
	const className = tree.viewClassFor(node);
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
	Array.from(contentHost.children).forEach((c) => {
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
	/* run every registered navigation callback — today just the optional updater's poll-chain cancel
	 * (its setTimeout would otherwise keep firing fs.exec RPCs and pop its modal over the page we are
	 * about to open). The router carries NO static dependency on that optional module — a missing
	 * updater would be a DependencyError that takes out the whole chrome — so the edge is inverted:
	 * fs-update.js (when the updater is installed) registers its cancel via onNavigate() below. */
	for (const fn of _navCbs) { try { fn(); } catch (e) {} }
	try { if (typeof ui.hideModal === 'function') ui.hideModal(); } catch (e) {}

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
	if (push) {
		const same = pathname === window.location.pathname;
		if (_curId == null) _curId = newEntryId();
		/* a NEW entry gets a new id; re-navigating in place keeps the entry and therefore its id */
		if (!same) _curId = newEntryId();
		history[same ? 'replaceState' : 'pushState']({ fsnav: true, fsid: _curId }, '', pathname);
	}

	/* titles: <host> | <page> */
	const host = (document.title.split('|')[0] || '').trim();
	document.title = node.title ? (host + ' | ' + _(node.title)) : host;
	const tmain = document.querySelector('.fs-title-main');
	if (tmain && node.title)
		tmain.textContent = _(node.title);

	chrome.renderChrome();

	/* a full load starts at the top; the in-place swap must too, or navigating away from a long
	 * page opens the next one mid-scroll. In the desktop sidebar layout the window does NOT scroll —
	 * .fs-shell is exactly 100dvh with overflow:hidden and .fs-main owns overflow-y, so the sidebar
	 * can be static rather than a composited sticky layer (issue #7) — so reset it too; scrollTo on
	 * whichever of the two is not the scroller is a harmless no-op.
	 *
	 * A popstate replay resets nothing on purpose: the DOCUMENT scroller (top layout) is restored by
	 * the browser itself (scrollRestoration is 'auto'), and #maincontent (sidebar layout) is restored
	 * by the popstate handler from _scrollMem — see restoreScroll(), and do not reach for
	 * `history.scrollRestoration = 'manual'` here: it is inert for #maincontent and would take the
	 * top layout's working document restoration away (docs/22 §2). */
	if (push) {
		window.scrollTo(0, 0);
		const sc = document.getElementById('maincontent');
		if (sc) sc.scrollTo(0, 0);
	}

	/* ---- what a full load does for a keyboard/screen-reader user, and the SPA did not ----
	 * renderChrome() has just done `#topmenu.innerHTML = ''`, so the very <a> the user activated with
	 * Enter no longer exists: focus falls back to <body>, the next Tab restarts at the skip link, and
	 * nothing says the page changed — URL, title and #view all moved in silence. So do what a real
	 * navigation would, and where matters (Sutton's five-prototype study, docs/22 §3): a KEYBOARD
	 * activation (ev.detail === 0) moves focus to the skip link — a small target whose :focus overlay
	 * tells a sighted keyboard user where they are, with Enter jumping straight to the content; its
	 * text differs from the live region's announcement below, so the double announcement complements
	 * rather than repeats. A pointer activation (and a popstate replay, whose modality is unknowable)
	 * keeps the wrapper focus: focusing the skip link there would flash its overlay on every mouse
	 * click. <main> keeps tabindex="-1" and its outline-less :focus for exactly that path.
	 * preventScroll because the scroll position is decided just above — focus() would otherwise drag
	 * a popstate replay back to the top and undo the restoration. */
	const skip = kbd ? document.querySelector('.fs-skip') : null;
	const main = skip || document.getElementById('maincontent');
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
	RT.require(className).then((view) => {
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
		if (cached) {
			/* singleton: its __init__ already ran, re-run it. Arm the paint-time guard BEFORE the
			 * construct (__init__ binds this.render as it builds its chain) and stamp the
			 * generation right after it (the first load() is a microtask, so this lands first) —
			 * this navigation can still be superseded while that render awaits its RPC. */
			const cls = view.constructor;
			armRenderGuard(cls);
			const inst = new cls();
			inst.__fsGen = gen;
		}
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
	const a = ev.target.closest?.('a[href]');
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

		/* record the outgoing page's offset under the entry we are still ON; harmless when
		 * navigate() declines (a full load throws the whole Map away anyway) */
		saveScroll();
		if (navigate(url.pathname, true, ev.detail === 0))
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

		/* the outgoing DOM is still up: record its offset under the entry we are LEAVING, then
		 * adopt the entry we arrived on and look up what IT recorded when it was left */
		saveScroll();
		adoptEntry();
		const target = _scrollMem.get(_curId);
		if (!navigate(window.location.pathname, false))
			window.location.reload();
		else
			restoreScroll(target, _navGen);
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

/* Callbacks to run on every SPA navigation. The only registrant today is the optional updater's poll
 * cancel (see navigate()); the registry exists so router keeps no static dependency on that optional
 * module. */
const _navCbs = [];
function onNavigate(fn) { if (typeof fn === 'function') _navCbs.push(fn); }

return baseclass.extend({
	seed,
	wire: wireRouter,
	wireVisibility,
	onNavigate
});
