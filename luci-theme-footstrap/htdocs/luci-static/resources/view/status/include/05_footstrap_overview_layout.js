'use strict';
'require baseclass';
'require dom';
'require network';
'require fs-fit as fit';

/* Footstrap overview LAYOUT-only include.
 *
 * Unlike the old 05_footstrap_dashboard.js (which re-rendered a whole custom
 * tree every poll and flickered/reset scroll on mobile), this include renders
 * NOTHING itself. It only re-arranges the STOCK overview sections: it wraps the
 * System / Memory / Storage sections in a grid container so Memory and Storage
 * sit in a right column beside System — the rest of the stock content, data and
 * per-section styling stay exactly as luci-mod-status renders them.
 *
 * The stock poll (index.js) updates each section IN PLACE via
 * dom.content(container, ...) — it never rebuilds the .cbi-section wrapper — so
 * once we move those wrappers into our grid they stay put across polls, and only
 * each section's small inner body repaints (minimal flicker, no full-tree swap).
 *
 * Installed to the global include dir, so LuCI loads it under EVERY theme — including
 * bootstrap, if the user switches away. Hence the gate: do nothing unless a footstrap
 * theme is the active one (L.env.media). */
function isFootstrapTheme() {
	return String(L.env.media || '').indexOf('footstrap') >= 0;
}

/* section title -> grid role. Titles via _() to match the stock locale. Built once
 * at module load: it used to be rebuilt on every call, i.e. an object allocation
 * plus three _() lookups on every poll tick. */
const ROLES = { [_('System')]: 'sys', [_('Memory')]: 'mem', [_('Storage')]: 'sto' };

function sectionTitle(sec) {
	const h = sec.querySelector('.cbi-title h3');
	return (h && h.firstChild) ? String(h.firstChild.nodeValue || '').trim() : '';
}

/* the wrapper we built, so the poll-tick fast path costs one property read */
let wrapEl = null;

function arrange() {
	/* the theme's SPA nav can leave this observer wired while another page
	 * renders into #view — detach as soon as the route stops being the overview,
	 * instead of re-running on every mutation of every subsequent page. Both the
	 * server template and the SPA router stamp body[data-page] with the DISPATCH
	 * path, so /admin/status (firstchild -> overview) matches too. */
	if ((document.body.getAttribute('data-page') || '') !== 'admin-status-overview') {
		stopWatch();
		return;
	}
	const view = document.getElementById('view');
	if (!view) return;

	/* Fast path — this is where the poll lands, once a second, forever.
	 *
	 * The stock poll updates each section IN PLACE (dom.content) and never
	 * rebuilds the .cbi-section wrappers, so our grid survives untouched and there
	 * is nothing to do. Proving that used to cost a querySelectorAll over #view's
	 * children plus a sectionTitle() DOM dig per section, every tick, before
	 * reaching the "already wrapped" bail-out at the bottom. Now it costs an
	 * isConnected check. Deliberately NOT a disconnect(): if some future
	 * luci-mod-status ever DOES rebuild a section, the wrapper loses its children
	 * and the slow path below rebuilds the grid — the layout self-heals instead of
	 * being permanently broken by a stale assumption. */
	if (wrapEl && wrapEl.isConnected && wrapEl.parentElement === view && wrapEl.children.length === 3)
		return;

	const found = {};
	view.querySelectorAll(':scope > .cbi-section').forEach((sec) => {
		const r = ROLES[sectionTitle(sec)];
		if (r && !found[r]) found[r] = sec;
	});
	/* wait until all three stock sections exist */
	if (!(found.sys && found.mem && found.sto)) return;
	/* already wrapped? (first tick after a rebuild re-finds the existing grid) */
	if (found.sys.parentElement && found.sys.parentElement.classList.contains('fs-ovl')) {
		wrapEl = found.sys.parentElement;
		return;
	}
	const wrap = document.createElement('div');
	wrap.className = 'fs-ovl';
	found.sys.parentNode.insertBefore(wrap, found.sys);
	found.sys.classList.add('fs-ovl-sys'); wrap.appendChild(found.sys);
	found.mem.classList.add('fs-ovl-mem'); wrap.appendChild(found.mem);
	found.sto.classList.add('fs-ovl-sto'); wrap.appendChild(found.sto);
	wrapEl = wrap;
}

/* Stock sections render/re-render async (they sort after us and repaint every
 * poll), so watch #view and re-run arrange() on change (debounced, ONE observer
 * per #view node — a per-poll observer leak would slow the page down). The SPA
 * router may REPLACE the #view element between visits, so watch() re-attaches
 * whenever the node it observed is no longer the current one; a singleton bound
 * forever to the first #view would silently watch a detached tree and the grid
 * would never apply on a later SPA visit. */
let observer = null, observedView = null;
function stopWatch() {
	if (observer) observer.disconnect();
	observer = null;
	observedView = null;
	wrapEl = null;	/* the grid belongs to the #view we are leaving */
}
function watch() {
	const view = document.getElementById('view');
	if (observer && observedView !== view)
		stopWatch();
	arrange();
	if (observer || !view) return;
	observedView = view;
	/* one arrange() per frame, however many mutations a poll tick delivers — fit.frame is
	 * the theme's shared coalescer (fs-fit.js) */
	observer = new MutationObserver(fit.frame(arrange));
	observer.observe(view, { childList: true, subtree: true });
}

/* ---- progressive paint -----------------------------------------------------
 *
 * The overview is the slowest page in LuCI, and almost none of that is rendering.
 * Stock `view.status.index` builds the section frames, then calls
 * poll_status(first_load=true), which does `Promise.all` over EVERY include's
 * load() and only resolves when the last one answers — and render() does not
 * return the tree until then. So #view stays **empty** for the duration of the
 * slowest include. Measured on the dev router (warm, SPA nav): 182 ms of blank
 * page, of which System / CPU / Memory / Storage / DHCP / Network were ready at
 * 88 ms and were simply waiting on 29_ports and 60_wifi (180 ms each).
 *
 * Two things this changes, both by replacing poll_status:
 *
 * 1. Each section paints as soon as ITS OWN data lands, instead of the whole page
 *    waiting for the slowest one. Time to first content halves (182 -> ~90 ms);
 *    ports and wifi fill in place a beat later. The frames are already in the DOM
 *    by then — they were built before poll_status is ever called — so nothing
 *    jumps: a section switches from hidden to filled, exactly as it does on a
 *    stock poll tick.
 *
 * 2. The redundant immediate re-fetch is gone. Stock adds the poller only after
 *    the first load completes, and `Poll.add()` steps at once — so the overview
 *    fetched EVERYTHING a second time, ~250 ms of ubus work, immediately after
 *    the first paint. An in-flight guard collapses that second run into the one
 *    already running. Nothing is lost: the data it would have fetched is the data
 *    the first run is already fetching.
 *
 * Deliberately NOT a re-implementation of the overview: the section frames, the
 * hide/show toggles, the includes and their render() output all stay upstream's.
 * fillSection() is a transcription of stock's own loop, kept in the same order so
 * it can be diffed against index.js when luci-mod-status changes. If the shape it
 * expects is not there, the patch is skipped and the page runs stock. */
function fillSection(inc, container, res) {
	if (inc.failed)
		return;
	let content = null;
	if (typeof inc.render === 'function')
		content = inc.render(res);
	else if (inc.content != null)
		content = inc.content;
	if (typeof inc.oneshot === 'function') {
		inc.oneshot(res);
		inc.oneshot = null;
	}
	if (content != null) {
		container.parentNode.style.display = '';
		container.parentNode.classList.add('fade-in');
		if (!inc.hide)
			dom.content(container, content);
	}
}

let inflight = null;

function pollProgressive(includes, containers, first_load) {
	/* A run is already fetching exactly this data — join it instead of starting a
	 * second stampede of the same RPCs. This is what kills the duplicate load. */
	if (inflight)
		return first_load ? Promise.resolve() : inflight;

	const run = network.flushCache().then(() => Promise.all(
		includes.map((inc, i) => {
			if (inc.hide && !first_load)
				return null;
			const loaded = (typeof inc.load === 'function')
				? Promise.resolve(inc.load()).catch(() => { inc.failed = true; })
				: Promise.resolve(null);
			/* the point of the whole patch: fill THIS section the moment ITS data is
			 * here, rather than at the end of a Promise.all over all of them */
			return loaded.then((res) => {
				try { fillSection(inc, containers[i], res); }
				catch (e) { console.error('footstrap: overview section failed', e); }
			});
		}).filter(Boolean)
	)).then(() => {
		const ssi = document.querySelector('div.includes');
		if (ssi) { ssi.style.display = ''; ssi.classList.add('fade-in'); }
	});

	inflight = run.finally(() => { inflight = null; });

	/* On the first load, resolve NOW so index.render() returns its tree and the
	 * frames reach #view immediately; the sections above fill themselves. On a poll
	 * tick, resolve when the data is in — that is what the poller expects. */
	return first_load ? Promise.resolve() : inflight;
}

/* Patch the stock overview view. Runs while index.load() is requiring its includes
 * — i.e. after the instance exists and before render() is called, which is the one
 * window where replacing poll_status is safe. Applies on a full page load and on a
 * SPA nav alike, because both go through index.load(). */
function patchOverview() {
	L.require('view.status.index').then((idx) => {
		const proto = idx ? Object.getPrototypeOf(idx) : null;
		if (!proto || proto.__fsProgressive || typeof proto.poll_status !== 'function')
			return;
		proto.__fsProgressive = true;
		proto.poll_status = function(includes, containers, first_load) {
			return pollProgressive(includes, containers, first_load);
		};
	}).catch((e) => console.error('footstrap: overview progressive paint not applied', e));
}

/* At module-evaluation time, which is inside index.load() — before render(). Doing
 * it from render() would be too late: poll_status has already been called by then. */
if (isFootstrapTheme())
	patchOverview();

return baseclass.extend({
	title: '',            /* no section title -> stock renders an empty wrapper */
	render() {
		if (!isFootstrapTheme())
			return E([]);
		watch();
		/* marker lets CSS hide our own empty stock .cbi-section wrapper */
		return E('div', { 'class': 'fs-ovl-marker', 'style': 'display:none' });
	}
});
