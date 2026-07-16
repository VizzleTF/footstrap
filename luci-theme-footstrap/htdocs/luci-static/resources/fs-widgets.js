'use strict';
'require baseclass';
'require fs-prefs as prefs';

/* The theme's own UI primitives: the disclosure pair the menu is built on, the two controls the
 * Appearance popover is built on, and the popup placement both hand-placed popups share. Nothing
 * here knows what it is being used FOR — that is the point, and it is why the menu and the popover
 * can each take what they need without either requiring the other. */

/* ---- disclosure primitives, shared by the menu ----
 * A section header is a W3C-APG disclosure control: an <a role="button"> owning a panel it shows and
 * hides. These lived once per menu file back when there were two, and the copies had already drifted
 * (only one Escape handler learnt to check flyout mode). The trigger SELECTOR stays a parameter. */

/* `.open` and aria-expanded must never disagree — `.open` alone told a sighted user everything and
 * a screen-reader user nothing — so every open and close goes through this one function.
 * `linkSel` is the layout's trigger (the menu's `:scope > a`). */
function setOpen(li, on, linkSel) {
	li.classList.toggle('open', on);
	li.querySelector(linkSel)?.setAttribute('aria-expanded', on ? 'true' : 'false');
}

/* An <a role="button"> is given Enter by the browser but NOT Space, and a
 * disclosure control has to answer both. */
function wireSpaceKey(link) {
	link.addEventListener('keydown', (ev) => {
		if (ev.key !== ' ' && ev.key !== 'Spacebar') return;
		ev.preventDefault();
		link.click();
	});
}

/* Dismissal both ways: a click outside closes; and WCAG 2.2 SC 1.4.13 (Content on Hover or Focus)
 * requires a hover/focus panel to be dismissible from the KEYBOARD, with focus handed back to the
 * trigger. `when` restricts both to flyout mode, where `.open` means "popup panel" — closing an
 * unfolded ACCORDION because the user clicked elsewhere on the page would be wrong. */
function wireDismiss(opts) {
	const active = () => (opts.when ? opts.when() : true);

	document.addEventListener('click', (ev) => {
		if (active() && !ev.target.closest(opts.inside))
			opts.close();
	});

	document.addEventListener('keydown', (ev) => {
		if (ev.key !== 'Escape' || !active()) return;
		const open = document.querySelector(opts.open);
		if (!open) return;
		const trigger = open.querySelector(opts.trigger);
		opts.close();
		trigger?.focus();
	});
}

/* One segmented control; highlights the active option, calls onPick on change.
 * `label` is not decoration: the visible caption is a sibling <div> nothing associated with the
 * control, and the selection was carried by a CSS class alone — a screen reader got an unnamed
 * group of unrelated buttons with no indication of which was in effect. It is a radio group. */
function segControl(current, opts, onPick, label) {
	const wrap = E('div', { 'class': 'fs-seg', 'role': 'radiogroup', 'aria-label': label || '' });

	/* Select one option and make it the group's single tab stop. role="radio" is a PROMISE of APG
	 * behaviour, and it was half-kept: the roles were there but every button stayed natively
	 * tabbable and the arrows did nothing, so a keyboard user tabbed through N stops in a control
	 * a screen reader had told them was one radio group. axe cannot catch this (it checks names and
	 * roles, not key handling), which is why `npm run a11y` was green over it. */
	function select(b, focus) {
		wrap.querySelectorAll('button').forEach(x => {
			const on = (x === b);
			x.classList.toggle('active', on);
			x.setAttribute('aria-checked', on ? 'true' : 'false');
			/* roving tabindex: only the checked radio is in the tab sequence, so Tab enters and
			 * leaves the GROUP once and the arrows move within it. */
			x.tabIndex = on ? 0 : -1;
		});
		if (focus) b.focus();
	}

	opts.forEach(o => {
		const active = (o.val === current);
		const b = E('button', {
			'type': 'button',
			'class': active ? 'active' : '',
			'role': 'radio',
			'aria-checked': active ? 'true' : 'false',
			'tabindex': active ? '0' : '-1',
			'data-val': o.val
		}, [ o.label ]);
		b.addEventListener('click', () => { onPick(o.val); select(b, false); });
		wrap.appendChild(b);
	});

	/* In a radiogroup an arrow both MOVES and SELECTS (APG), and the ends wrap. Home/End are the
	 * same move to the first/last. Space/Enter reach the button as a native click already. */
	wrap.addEventListener('keydown', (ev) => {
		const KEYS = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1, Home: 0, End: 0 };
		if (!(ev.key in KEYS)) return;
		const list = [ ...wrap.querySelectorAll('button') ];
		if (!list.length) return;
		const at = list.indexOf(document.activeElement);
		if (at < 0) return;
		ev.preventDefault();
		const next = ev.key === 'Home' ? list[0]
			: ev.key === 'End' ? list[list.length - 1]
			: list[(at + KEYS[ev.key] + list.length) % list.length];
		onPick(next.getAttribute('data-val'));
		select(next, true);
	});

	return wrap;
}

/* A range slider with a live readout; onInput fires continuously as it drags. Without the label
 * and valuetext a screen reader announced a bare "slider, 12" — no unit, no idea what it adjusts.
 * `opts.fmt` is what the READOUT says AND what the reader is told, so it is not cosmetic: the tint
 * slider's 0 means "off", and announcing "0 degrees" would announce a hue that is not applied. */
function sliderControl(current, min, max, onInput, label, opts) {
	const o = opts || {};
	const fmt = o.fmt || (v => v + 'px');
	const out = E('span', { 'class': 'fs-range-val' }, [ fmt(current) ]);
	const input = E('input', {
		'type': 'range', 'class': 'fs-range' + (o.cls ? ' ' + o.cls : ''),
		'min': String(min), 'max': String(max), 'step': String(o.step || 1), 'value': String(current),
		'aria-label': label || '',
		'aria-valuetext': fmt(current)
	});
	input.addEventListener('input', () => {
		const v = parseInt(input.value, 10);
		out.firstChild.data = fmt(v);
		input.setAttribute('aria-valuetext', fmt(v));
		onInput(v);
	});
	return E('div', { 'class': 'fs-rangewrap' }, [ input, out ]);
}

/* How close a popup may come to the viewport edge before it is nudged back in. Read by BOTH popups
 * the theme places by hand — the Appearance popover (fs-appearance.js) and the menu's dropdown
 * edge-clamp (menu-footstrap.js) — which had each written their own `8`. */
const EDGE_GAP = 8;

/* Place the popover next to its trigger and keep it inside the viewport. It is position:fixed on
 * <body> because the sidebar is `overflow-y: auto` (which computes overflow-x to `auto` too), so
 * an absolutely-positioned popover parented to the Appearance row was clipped off the sidebar
 * edge. The top bar opens downward from the button's right edge, the sidebar sideways out of the
 * rail; both are then clamped. */
function placePopover(btn, pop) {
	const gap = EDGE_GAP, r = btn.getBoundingClientRect();
	const w = pop.offsetWidth, h = pop.offsetHeight;
	const vw = document.documentElement.clientWidth;
	const vh = document.documentElement.clientHeight;
	const top_layout = prefs.isTopLayout();

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

return baseclass.extend({
	setOpen,
	wireSpaceKey,
	wireDismiss,
	segControl,
	sliderControl,
	EDGE_GAP,
	placePopover
});
