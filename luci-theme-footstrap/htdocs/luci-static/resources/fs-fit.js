'use strict';
'require baseclass';

/* fs-fit — the theme's ONE "does it still fit?" engine; add fit logic here, do not grow a second
 * observer. No CSS query can ask what the CONTENT needs (media = viewport, container =
 * container): does the menu fit beside the brand, is a table still readable? Both were once
 * breakpoints (one @media, five @container thresholds) — guessed numbers that real routers got
 * wrong, useless for a third-party luci-app-* table of unknown column count.
 *
 * THREE RULES, each a bug that was hit:
 *  1. MEASURE UNCOLLAPSED — a collapsed thing always "fits" (a stacked table is a pile of flex
 *     rows): read it as it stands and it un-collapses, next frame re-collapses. Oscillation.
 *  2. RE-FIT SYNCHRONOUSLY ON A MUTATION — the poll re-renders content once a second and the
 *     fresh element has lost our class. A MutationObserver callback is a microtask (pre-paint),
 *     rAF runs AT paint: deferring there painted a stacked table one frame at full width —
 *     19-109px of overflow, once a second, on Firewall/DHCP/Wireless.
 *  3. COALESCE ON RESIZE — every fit forces a synchronous layout.
 *
 * ResizeObserver, not onresize: a rail collapse and a layout toggle change the content width
 * without resizing the window. */

const _fitters = [];
let _rafPending = false;
let _ro = null, _mo = null;

/* Run every fitter NOW, synchronously. A fitter must be idempotent — this fires on every
 * relevant mutation. */
function run() {
	for (const fit of _fitters) {
		try { fit(); }
		/* one broken fitter must take neither the others nor the poll's MutationObserver
		 * callback with it — that would silently stop ALL re-fitting */
		catch (e) { console.error('fs-fit: a fitter threw', e); }
	}
}

/* Next frame, at most once per frame (rule 3). */
function schedule() {
	if (_rafPending) return;
	_rafPending = true;
	requestAnimationFrame(() => { _rafPending = false; run(); });
}

/* Watch an element's size. Any change re-fits everything — the fitters are cheap and few. */
function watch(el) {
	if (!el) return;
	if (!_ro) {
		if (!window.ResizeObserver) {			/* no RO: fall back to the window */
			window.addEventListener('resize', schedule);
			return;
		}
		_ro = new ResizeObserver(schedule);
	}
	_ro.observe(el);
}

/* Rule 2's mutation side. Deliberately NOT filtered by node type: a filter is a second place to
 * get wrong (the table fitter's own once said `table.table`, and LuCI renders most of its tables
 * as DIVs — so the poll never re-measured at all), and run() is a handful of measurements. */
function observeContent() {
	if (_mo) return;
	const host = document.getElementById('view') || document.body;
	_mo = new MutationObserver(run);
	_mo.observe(host, { childList: true, subtree: true });
	watch(host);
}

return baseclass.extend({
	/* Register a fitter and run it once. A fitter selects its own elements, strips its class
	 * (rule 1), measures, re-applies. */
	add(fit) {
		if (typeof fit !== 'function') return;
		_fitters.push(fit);
		observeContent();
		fit();
	},

	/* Re-fit now, synchronously — from a place that has just changed the room available (layout
	 * toggle, icon-rail collapse). */
	run,

	/* Re-fit on the next frame, coalesced. */
	schedule,

	/* Coalesce ANY callback into one call per frame (rule 3, for non-fitters): schedule() runs
	 * EVERY fitter, so a caller wanting only its own work batched cannot use it — three had
	 * hand-rolled the identical five lines. NOT for the per-element case: menu-footstrap.js's
	 * clamp keeps a rAF handle per <li> so it can CANCEL a pending measure, which a one-flag
	 * coalescer cannot express. */
	frame(fn) {
		let pending = false;
		return () => {
			if (pending) return;
			pending = true;
			requestAnimationFrame(() => { pending = false; fn(); });
		};
	},

	/* Also watch this element's size (beyond #view, which is watched automatically). */
	watch,

	/* Did this batch add (or, with {removed: true}, remove) anything matching `sel`? The poll
	 * rewrites content once a second, so every MutationObserver here needs that cheap question
	 * before its document-wide queries; two had written the identical triple loop. Each caller
	 * keeps its OWN `sel` — a shared filter would start lying to one of them. */
	touches(mutations, sel, opts) {
		const lists = (opts && opts.removed) ? [ 'addedNodes', 'removedNodes' ] : [ 'addedNodes' ];
		for (const m of mutations)
			for (const which of lists)
				for (const n of m[which]) {
					if (n.nodeType !== 1) continue;
					if (n.matches(sel) || n.querySelector(sel)) return true;
				}
		return false;
	},

	/* Room for `el` = its PARENT's content box. Measuring against ITSELF does not work: a
	 * `display: table` box with width:100% still grows past it when min-content needs more (auto
	 * layout beats the declared width), so scrollWidth and clientWidth grow together and the
	 * overflow is invisible. The parent is an ordinary block and does not grow. */
	roomFor(el) {
		const p = el && el.parentElement;
		if (!p) return Infinity;
		const cs = getComputedStyle(p);
		return p.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
	},

	/* Does `el` need more width than it has been given? */
	overflows(el) {
		return el.scrollWidth > this.roomFor(el) + 1;	/* +1: sub-pixel rounding */
	}
});
