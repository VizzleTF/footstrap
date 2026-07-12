'use strict';
'require baseclass';

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
 * Installed to the global include dir, so it loads under every theme; gate on a
 * footstrap theme being active (see 05_footstrap_dashboard.js rationale). */
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
	let pending = false;
	observer = new MutationObserver(() => {
		if (pending) return;
		pending = true;
		requestAnimationFrame(() => { pending = false; arrange(); });
	});
	observer.observe(view, { childList: true, subtree: true });
}

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
