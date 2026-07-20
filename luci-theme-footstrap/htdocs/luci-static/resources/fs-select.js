'use strict';
'require baseclass';
'require ui';
'require dom';
'require fs-fit as fit';

/* Theme plain LuCI <select> fields (ui.Select, widget:'select') by rendering a styled
 * cbi-dropdown beside them — a native <select> popup cannot be CSS-styled.
 *
 * The native <select> stays the form field and MUST remain frameEl.firstChild:
 * ui.Select.getValue() returns `this.node.firstChild.value`. Inserting our widget BEFORE it made
 * getValue read a <div> and return `undefined`, which broke Save. So insert AFTER, and mirror the
 * value both ways. Sharing the frameEl also ties our node to the widget's lifecycle, so a CBI
 * re-render disposes of it — no orphans.
 *
 * Runs theme-wide (required from the footer); watches for selects added later by client CBI. */

function readChoices(sel) {
	const choices = {};
	Array.prototype.forEach.call(sel.options, (o) => { choices[o.value] = o.textContent; });
	return choices;
}

/* cheap identity of the option list, to detect a script rebuilding it
 * (select.replaceChildren, dependency-driven re-population, …) */
function choicesKey(sel) {
	return Array.prototype.map.call(sel.options, (o) => o.value + '\u0000' + o.textContent).join('\u0001');
}

/* undo enhance(): drop the widget, unhide the select, and — critically — cut every listener
 * enhance() installed. The `change` listener used to survive teardown, and resync() calls
 * teardown()+enhance() every time a script rebuilds the option list (CBI dependencies do this
 * constantly on the firewall/network forms) — so the select accumulated one live listener per
 * rebuild, each closing over a dead ui.Dropdown and its detached subtree: a leak that grew with
 * every interaction. AbortController is the only way to drop an anonymous listener. */
function teardown(sel) {
	if (sel._fsAbort) sel._fsAbort.abort();
	if (sel._fsNode && sel._fsNode.parentNode)
		sel._fsNode.parentNode.removeChild(sel._fsNode);
	delete sel.dataset.fsSelect;
	sel._fsDd = sel._fsNode = sel._fsKey = sel._fsAbort = null;
	sel.removeAttribute('aria-hidden');
	sel.style.display = '';
}

/* keep an enhanced select and its widget in step when a script drives the native element
 * directly: ui.Select.setValue() rewrites value/options WITHOUT dispatching `change`, so
 * enhance()'s mirror never fires and the widget went stale — showed the old value while Save
 * read the new one. */
function resync(sel) {
	const dd = sel._fsDd;
	if (!dd || !sel._fsNode) return;
	if (sel.disabled) { teardown(sel); return; }	/* disabled later: back to native */
	const key = choicesKey(sel);
	if (key !== sel._fsKey) {
		/* option list rebuilt — recreate the widget from the fresh options */
		teardown(sel);
		enhance(sel);
		return;
	}
	if (dd.getValue() !== sel.value)
		dd.setValue(sel.value);
}

function enhance(sel) {
	if (sel.dataset.fsSelect || sel.disabled) return;	/* disabled: NOT marked — it may be enabled later */
	/* `multiple` and "not in a CBI field" are permanent, so mark it and stop re-testing on
	 * every scan */
	if (sel.multiple || !sel.closest('.cbi-value-field, .td.cbi-value-field, .cbi-value')) {
		sel.dataset.fsSelect = 'skip';
		return;
	}

	const choices = readChoices(sel);

	let dd;
	try {
		dd = new ui.Dropdown(sel.value, choices, {
			sort: false,
			optional: Object.prototype.hasOwnProperty.call(choices, '')
		});
	} catch (e) { return; }

	const node = dd.render();
	const ac = new AbortController();
	sel.dataset.fsSelect = '1';
	sel.style.display = 'none';
	/* The hidden <select> leaves the CBI <label for=…> pointing at something no screen reader
	 * announces, and the visible widget nameless. Move the name over, drop the select from the
	 * a11y tree. */
	const title = sel.closest('.cbi-value')?.querySelector('.cbi-value-title');
	if (title && title.textContent.trim())
		node.setAttribute('aria-label', title.textContent.trim());
	sel.setAttribute('aria-hidden', 'true');
	sel._fsDd = dd;
	sel._fsNode = node;
	sel._fsKey = choicesKey(sel);
	sel._fsAbort = ac;

	/* AFTER the select: it must stay frameEl.firstChild for ui.Select to read its value on save */
	sel.parentNode.insertBefore(node, sel.nextSibling);

	/* stops our own dd->sel dispatch from echoing back through the sel->dd listener */
	let syncing = false;

	/* our widget -> native select (user picked an option) */
	node.addEventListener('cbi-dropdown-change', () => {
		const v = dd.getValue();
		if (sel.value === v) return;
		syncing = true;
		sel.value = v;
		sel.dispatchEvent(new Event('change', { bubbles: true }));
		syncing = false;
	}, { signal: ac.signal });

	/* native select -> our widget (a script/CBI dependency changed and dispatched change on
	 * the select) — keeps the visible widget from going stale */
	sel.addEventListener('change', () => {
		if (syncing) return;
		if (dd.getValue() !== sel.value)
			dd.setValue(sel.value);
	}, { signal: ac.signal });
}

/* Tag standalone data tables so the stacking rules key off a static `.fs-dt` instead of a live
 * `:has(.tr.table-titles)` the style engine re-evaluated on every mutation of these polled tables
 * (Processes/routes/leases). Not a .cbi-section-table — config forms keep their own layout.
 *
 * `.table`, not `table.table` — the SAME selector relevant() and STACKABLE use. Stock LuCI
 * happens to emit only real <table>s, but a third-party luci-app-* may emit a <div class="table">
 * (coverage rule, CLAUDE.md), which a tag qualifier would pass over so it could never card. */
function tagDataTables() {
	document.querySelectorAll('#view .table:not(.cbi-section-table):not(.fs-dt)').forEach((t) => {
		/* TWO header markups, and missing the second is why the package list once needed a
		 * stacking block of its own: L.ui.Table emits `.tr.table-titles`, the apk Software page
		 * emits `.tr.cbi-section-table-titles`. EITHER header = a data table; NEITHER = a
		 * key/value include (System, Memory), which must never card. */
		if (t.querySelector('.tr.table-titles, .tr.cbi-section-table-titles'))
			t.classList.add('fs-dt');
	});
}

/* ---- CARD-STACK A DATA TABLE THAT NO LONGER FITS --------------------------------
 *
 * Measuring, scheduling and the observers are fs-fit.js; this file supplies only the DECISION.
 * A data table used to card by @container at THREE thresholds (568 plain, 780 leases, 800 apk
 * package list), the last two each carrying their own COPY of the card rules — CSS cannot share
 * a block across two thresholds. All were really asking "does it OVERFLOW?", a fact the browser
 * computes, so it is measured instead: the card rules live once in theme/30-tables.css on
 * .fs-stacked, and a third-party table of unknowable width works too.
 *
 * A CONFIG table (.cbi-section-table) keeps its @container (960, theme/65-dropdown.css) and must
 * NOT be measured: its rows hold widgets (enhance() above turns every <select> into a
 * ui.Dropdown) and a widget bakes in the width of the layout it was laid out in, so
 * un-collapsing it to read it CHANGES what is read. Measured on the router: the firewall zone
 * table then reported needing 1747px where it really needs 1190px and overflowed its section by
 * 557px — an overflow the CSS-only version never had. A data table has no widgets, which is why
 * it is the one that gets measured. */
const STACKABLE = '#view .table.fs-dt';

/* "Too cramped to be a table any more" — a DESIGN judgement. It has to be one: these tables do
 * NOT overflow when the room runs out (their cells break anywhere), they compress into an
 * unreadable ribbon. Do NOT give the cells a min-width so that "cramped" MANUFACTURES an
 * overflow: tried, and it carded the firewall's zone table at 1420px and still overflowed by
 * 39px once carded — a floor big enough to force the overflow is big enough to break the card. */
const CRAMPED = 568;	/* stock LuCI cards its tables at a 600px viewport; below the 767px
						 * tier .fs-content pads 16px a side, so 600 -> 568 of room */

/* The ribbon has one more shape, and CRAMPED cannot see it: the table has room by the number
 * above and still shreds its FIRST column, because auto table layout hands width out by what
 * each column DEMANDS. The leftmost column is the row's identity and usually the least greedy —
 * a wide neighbour (a hostname plus an IPv6, a modulation string) simply takes the width, and
 * `overflow-wrap: anywhere` (theme/30-tables.css) lets the identity be squeezed with no floor:
 * it breaks mid-word rather than overflow, so there is no overflow for fit.overflows() to read.
 *
 * Measured on the router (Wireless, one station, `Access Point "vaka_devices" (phy6-ap0)`):
 * viewport 900 -> the column is 101px and 5 lines, 850 -> 80px and 7, 800 -> 76px and 8, and at
 * NO width did the table card — a nine-line tower of half-words next to columns with room to
 * spare (issue #7). Below 767 the MAC column drops out (the stock phone contract) and the
 * column springs back to 167px, which is why this only ever bit between roughly 780 and 900.
 *
 * So: past this many lines the identity has stopped being readable and the card view — which
 * gives every field its own labelled row — is simply better. A DESIGN judgement like CRAMPED,
 * and it has to be one: any number of lines is legible in isolation. 5 is what the reporter
 * asked for and what the measurements above bracket. Only the first column, and deliberately:
 * a value column wrapping to a few lines is a value being shown, not a table falling apart. */
const MAX_ID_LINES = 5;

/* Is any row's leftmost cell a tower? Text lines, not height — fs-fit.textLines() explains why.
 * The height gate in front of it is not premature: this runs on every poll tick (once a second,
 * every mutation), and Processes/Connections render hundreds of rows whose first cell is a PID
 * that cannot be a tower — one cheap read each keeps the Range walk for the cells that could. */
function idTower(t) {
	const cells = t.querySelectorAll('.tr > .td:first-child');
	if (!cells.length) return false;
	const cs = getComputedStyle(cells[0]);
	const lh = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.2 || 16;
	for (const cell of cells) {
		if (cell.clientHeight < MAX_ID_LINES * lh) continue;
		if (fit.textLines(cell) > MAX_ID_LINES) return true;
	}
	return false;
}

function fitTables() {
	document.querySelectorAll(STACKABLE).forEach((t) => {
		const was = t.classList.contains('fs-stacked');

		/* fs-fit rule 1: a stacked table is a pile of flex rows and always "fits", so reading
		 * it as it stands un-stacks it and the next frame stacks it again — oscillation. */
		t.classList.remove('fs-stacked');
		const room = fit.roomFor(t);
		if (!(room > 0)) { if (was) t.classList.add('fs-stacked'); return; }

		/* idTower last: it is the only one that walks the rows */
		const stack = room < CRAMPED || fit.overflows(t) || idTower(t);
		/* write only on a real change: the poll re-renders these tables once a second, and
		 * toggling the class off and on each tick would invalidate style for every row of
		 * Processes/Leases for nothing */
		if (stack) t.classList.add('fs-stacked');
		else if (was) t.classList.remove('fs-stacked');
	});
}

/* Does this batch contain anything we could care about? Without it EVERY mutation scheduled a
 * full scan — and the poll rewrites content once a second, so on Overview/Processes/Leases we
 * ran three document-wide querySelectorAll plus a choicesKey() over every option of every
 * enhanced select (thousands of characters on the firewall page) every second, forever, to
 * discover that nothing had changed. */
function relevant(mutations) {
	/* attributeFilter narrows the ATTRIBUTE, not the element: `value`/`disabled` live on inputs
	 * and buttons too, and a poll rewriting an input's value would otherwise wake the whole
	 * scan. This half is ours alone; the added-node walk below is fs-fit's shared one. */
	for (const m of mutations)
		if (m.type === 'attributes' && m.target.tagName === 'SELECT')
			return true;
	/* `.table`, not `table.table` — the same selector tagDataTables() and STACKABLE use.
	 * Additions only: a select or a table going away costs us nothing to notice. */
	return fit.touches(mutations, 'select.cbi-input-select, .table');
}

/* ---- TYPE-AHEAD: jump to an option by typing its first letters ---------------------
 *
 * A native <select> gives this for free, and it is the only way anyone picks a country out of
 * 248 entries. enhance() hides the native select, and ui.Dropdown.handleKeydown (luci-base) does
 * only Esc/Enter/Space/arrows — no letter search — so Wireless -> Country Code became 248 items
 * you could only scroll. (Stock LuCI never had it either; bootstrap only appears to, because it
 * leaves that field a real <select>.)
 *
 * One document-level listener (a dropdown's <ul> holds focus while open), for EVERY
 * .cbi-dropdown — ours and LuCI's own. Native semantics: only while OPEN; printable keys, no
 * modifiers; buffer resets after a pause; the SAME letter repeated cycles (how you reach the
 * second "Germany"); matches the LABEL first, then the value, so "RU" and "Russia" both find it.
 * SPACE is deliberately excluded: ui.Dropdown binds it to "toggle the focused item" and its
 * handler fires first, so treating it as a character would select something.
 *
 * Only HIGHLIGHTS (setFocus, as the arrows do); Enter/Esc stay ui.Dropdown's. */
const TYPEAHEAD_RESET_MS = 1000;
let _taBuf = '', _taTimer = null, _taLast = null;

function typeaheadItems(sb) {
	const ul = sb.querySelector('ul.dropdown') || sb.querySelector('ul');
	if (!ul) return [];
	return [...ul.children].filter((li) =>
		li.tagName === 'LI' &&
		/* the "custom value" row (options.create) is an input, not a choice */
		!li.querySelector('input:not([type="hidden"])') &&
		li.getClientRects().length > 0);
}

function typeaheadLabel(li) {
	return (li.textContent || '').trim().toLowerCase();
}

function wireTypeahead() {
	document.addEventListener('keydown', (ev) => {
		if (ev.ctrlKey || ev.altKey || ev.metaKey) return;
		if (!ev.key || ev.key.length !== 1 || ev.key === ' ') return;
		/* the create-item input is a text field — let the user type into it */
		if (ev.target && ev.target.matches && ev.target.matches('input, textarea')) return;

		const sb = ev.target.closest?.('.cbi-dropdown[open]');
		if (!sb) return;

		const items = typeaheadItems(sb);
		if (!items.length) return;

		/* a new dropdown starts a new search, however fast the user got here */
		if (sb !== _taLast) { _taBuf = ''; _taLast = sb; }

		const ch = ev.key.toLowerCase();
		/* repeating one letter cycles; anything else extends the search */
		const repeat = (_taBuf.length === 1 && _taBuf === ch);
		const needle = repeat ? ch : (_taBuf + ch);

		const start = items.findIndex((li) => li.classList.contains('focus'));
		/* on a repeat, look AFTER the current item so the same letter walks forward; otherwise
		 * the search restarts from the top, as a native select does */
		const from = repeat ? start + 1 : 0;

		/* matches the LABEL first, then the value, so "RU" and "Russia" both find it */
		const matches = (n) => (li) => typeaheadLabel(li).startsWith(n) ||
			String(li.getAttribute('data-value') || '').toLowerCase().startsWith(n);
		const match = matches(needle);

		/* wrap around: the second pass covers what the first skipped */
		let hit = items.slice(from).find(match) ?? items.find(match);
		if (!hit && !repeat) {
			/* the extended buffer matches nothing — treat this keystroke as a fresh search
			 * instead of swallowing it, so a mistyped letter is recoverable */
			hit = items.find(matches(ch));
			if (hit) _taBuf = '';
		}
		if (!hit) return;

		_taBuf = repeat ? ch : (_taBuf + ch);
		if (_taTimer) window.clearTimeout(_taTimer);
		_taTimer = window.setTimeout(() => { _taBuf = ''; _taLast = null; }, TYPEAHEAD_RESET_MS);

		/* the widget's own highlighter: adds .focus, scrolls the item into view and focuses it,
		 * so Enter (ui.Dropdown's handler) commits exactly what is highlighted */
		const inst = dom.findClassInstance(sb);
		if (inst && typeof inst.setFocus === 'function')
			inst.setFocus(sb, hit, true);
		else
			hit.focus();

		ev.preventDefault();
		ev.stopPropagation();
	});
}

return baseclass.extend({
	__init__() {
		wireTypeahead();

		const scan = () => {
			document.querySelectorAll('select.cbi-input-select:not([data-fs-select])').forEach(enhance);
			document.querySelectorAll('select.cbi-input-select[data-fs-select="1"]').forEach(resync);
		};
		scan();

		/* A table must be TAGGED .fs-dt before it can be fitted, and re-tagged whenever the poll
		 * brings a fresh one back — so the two travel as one fitter, which fs-fit runs now, on
		 * every content mutation (synchronously, pre-paint) and on every resize of #view. */
		fit.add(() => { tagDataTables(); fitTables(); });

		/* one scan per frame, however many mutations arrive (fit.frame — the theme's shared
		 * coalescer) */
		const scanSoon = fit.frame(scan);
		new MutationObserver((mutations) => {
			if (relevant(mutations)) scanSoon();
		}).observe(document.body, {
			childList: true, subtree: true,
			/* `disabled` flips and attr-driven value writes never mutate childList;
			 * watch them so resync()/enhance() notice (filtered — cheap) */
			attributes: true, attributeFilter: [ 'disabled', 'value', 'selected' ]
		});
	}
});
