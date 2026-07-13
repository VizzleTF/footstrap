'use strict';
'require baseclass';
'require ui';
'require fs-fit as fit';

/* Theme plain LuCI <select> fields (ui.Select, widget:'select') by rendering a
 * styled cbi-dropdown beside them — native <select> popups can't be CSS-styled.
 *
 * The native <select> stays the form field / source of truth. It MUST remain
 * frameEl.firstChild: ui.Select.getValue() returns `this.node.firstChild.value`
 * and setValue() writes `this.node.firstChild.options`. Inserting our widget
 * BEFORE the select made getValue read a <div> and return `undefined`, which
 * broke Save. So we insert AFTER the select (it stays firstChild) and mirror the
 * value both ways. Living inside the same frameEl also ties our node to the
 * widget's lifecycle, so a CBI re-render disposes of it — no orphaned widgets.
 *
 * Runs theme-wide (required from the footer) and watches for selects added later
 * by client-side CBI. */

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

/* undo enhance(): drop the widget, unhide the native select, and — critically —
 * cut every listener enhance() installed.
 *
 * The `change` listener on the native select used to survive teardown, and
 * resync() calls teardown()+enhance() every time a script rebuilds the option
 * list (CBI dependencies do this constantly on the firewall/network forms). So
 * the select accumulated one live listener per rebuild, each closing over a dead
 * ui.Dropdown and its detached subtree: a leak that grew with every interaction,
 * and N redundant handlers firing on every change. AbortController is the only
 * way to drop an anonymous listener without keeping a reference to it. */
function teardown(sel) {
	if (sel._fsAbort) sel._fsAbort.abort();
	if (sel._fsNode && sel._fsNode.parentNode)
		sel._fsNode.parentNode.removeChild(sel._fsNode);
	delete sel.dataset.fsSelect;
	sel._fsDd = sel._fsNode = sel._fsKey = sel._fsAbort = null;
	sel.removeAttribute('aria-hidden');
	sel.style.display = '';
}

/* keep an enhanced select and its widget in step when a script drives the
 * native element directly: ui.Select.setValue() rewrites value/options WITHOUT
 * dispatching `change`, so the change-event mirror in enhance() never fires and
 * the visible widget went stale (showed the old value while Save read the new
 * one). Runs from the scan() pass on every observed mutation. */
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
	/* `multiple` and "not in a CBI field" are permanent properties of this element,
	 * so mark it and stop re-testing it on every single scan. */
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
	/* The <select> is hidden, so the CBI <label for=…> now points at something no
	 * screen reader will announce, and the visible widget has no accessible name.
	 * Move the name onto the widget and take the dead select out of the a11y tree. */
	const title = sel.closest('.cbi-value')?.querySelector('.cbi-value-title');
	if (title && title.textContent.trim())
		node.setAttribute('aria-label', title.textContent.trim());
	sel.setAttribute('aria-hidden', 'true');
	sel._fsDd = dd;
	sel._fsNode = node;
	sel._fsKey = choicesKey(sel);
	sel._fsAbort = ac;

	/* AFTER the select: it must stay frameEl.firstChild for ui.Select to read
	 * its value on save. */
	sel.parentNode.insertBefore(node, sel.nextSibling);

	/* `syncing` stops our own dd->sel dispatch from echoing back through the
	 * sel->dd listener. */
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

	/* native select -> our widget (a script/CBI dependency changed & dispatched
	 * change on the select) — keep the visible widget from going stale. */
	sel.addEventListener('change', () => {
		if (syncing) return;
		if (dd.getValue() !== sel.value)
			dd.setValue(sel.value);
	}, { signal: ac.signal });
}

/* Tag standalone data tables so the stacking rules can key off a static `.fs-dt` class
 * instead of a live `:has(.tr.table-titles)` that the style engine re-evaluated on every
 * mutation of these polled tables (Processes/routes/leases). Match = <table class="table">
 * with a table-titles header, not a .cbi-section-table (config forms keep their own
 * layout). */
/* `.table`, not `table.table` — the SAME selector `relevant()` and STACKABLE use.
 *
 * These three used to disagree: the tagger was tag-qualified while the mutation filter right
 * below it carries a comment explaining that it must NOT be ("LuCI renders most of these as
 * DIVs"). Checked against the live router: every `.table` stock LuCI emits really is a
 * `<table>` with `<tr>` rows, so the tag qualifier cost nothing *here* — but that is luck, not
 * a contract. The coverage rule in CLAUDE.md is that a third-party `luci-app-*` renders what
 * stock never does, and a `<div class="table">` with a `.tr.table-titles` header would have
 * been passed over by the tagger and could then never card. One selector, three places. */
function tagDataTables() {
	document.querySelectorAll('#view .table:not(.cbi-section-table):not(.fs-dt)').forEach((t) => {
		/* TWO header markups, and missing the second one is why the package list needed a
		 * hand-written stacking block of its own. L.ui.Table emits `.tr.table-titles`; the
		 * apk Software page emits `<table class="table" id="packages">` — no
		 * .cbi-section-table class at all — whose header row is `.tr.cbi-section-table-titles`.
		 * A `.table` with EITHER header is a data table; a `.table` with NEITHER is a
		 * key/value include (System, Memory) and must never be carded. */
		if (t.querySelector('.tr.table-titles, .tr.cbi-section-table-titles'))
			t.classList.add('fs-dt');
	});
}

/* ---- CARD-STACK A DATA TABLE THAT NO LONGER FITS --------------------------------
 *
 * The measuring, the scheduling and the observers are NOT here — they are the shared engine
 * in fs-fit.js, which the top bar's menu uses too. This file supplies only the DECISION.
 *
 * WHAT THIS REPLACED. A data table used to be carded by a container query, and there were
 * THREE different thresholds for it: 568 for a plain table (theme/30-tables.css), 780 for
 * the DHCP leases (their 8 nowrap mono columns hold a ~736px floor, so they must card
 * earlier) and 800 for the apk package list. Each of the last two carried its own COPY of
 * the card rules, because CSS cannot share a declaration block across two @container
 * thresholds. Both of those were really asking "does it OVERFLOW?" — a FACT the browser
 * computes — so both are gone: the overflow is measured, each table discovers its own
 * width, and the card rules live once, in theme/30-tables.css, keyed on .fs-stacked. A
 * table from a third-party luci-app-*, whose column count we cannot know, is now handled
 * too.
 *
 * WHAT THIS DELIBERATELY DOES NOT TOUCH. A CONFIG table (.cbi-section-table) keeps its own
 * container query (960, theme/65-dropdown.css). It is NOT measurable: its rows are full of
 * widgets (fs-select turns every <select> into a ui.Dropdown), and a widget bakes in a
 * width from the layout it was laid out in — so un-collapsing it to take a reading changes
 * the very thing being read. Measured on the live router: after that toggle the firewall's
 * zone table reported it needed 1747px where it really needs 1190px, and then overflowed
 * its section by 557px — an overflow the CSS-only version never had. A data table has no
 * widgets, which is exactly why it is the one that gets measured. */
const STACKABLE = '#view .table.fs-dt';

/* "Too cramped to be a table any more" — a DESIGN judgement, and the only number left here.
 * It has to be a number: these tables do NOT overflow when the room runs out, because their
 * cells break anywhere, so the table just compresses into an unreadable ribbon and there is
 * no fact for anyone to read. A config row needs more room than a data row because a
 * dropdown needs more than a text column — which is exactly why its old container query said
 * 960 where the data table's said 568. The values are unchanged; what changed is that there
 * is now ONE of them here (568) and one still a @container in theme/65-dropdown.css (960 —
 * the config table, which must not be measured), instead of five spread across four files.
 *
 * (Do not try to make these measurable by giving the cells a min-width so that "cramped"
 * MANUFACTURES an overflow. That was tried: it carded the firewall's zone table at 1420px
 * and still overflowed by 39px once carded. A floor big enough to force the overflow is a
 * floor big enough to break the card.) */
const CRAMPED = 568;	/* stock LuCI cards its tables at a 600px viewport; below the 767px
						 * tier .fs-content pads 16px a side, so 600 -> 568 of room */

function fitTables() {
	document.querySelectorAll(STACKABLE).forEach((t) => {
		const was = t.classList.contains('fs-stacked');

		/* Rule 1 of the engine: a stacked table is a pile of flex rows and always "fits", so
		 * reading it as it stands un-stacks it and the next frame stacks it again. */
		t.classList.remove('fs-stacked');
		const room = fit.roomFor(t);
		if (!(room > 0)) { if (was) t.classList.add('fs-stacked'); return; }

		const stack = room < CRAMPED || fit.overflows(t);
		/* write only on a real change: the poll re-renders these tables once a second, and
		 * toggling the class off and on again each tick would invalidate style for every row
		 * of Processes/Leases for nothing */
		if (stack) t.classList.add('fs-stacked');
		else if (was) t.classList.remove('fs-stacked');
	});
}

/* Does this batch of mutations contain anything we could possibly care about?
 *
 * Without this test, EVERY mutation scheduled a full scan — and LuCI's poll
 * rewrites page content once a second via dom.content(), so on Overview,
 * Processes or Leases we ran three document-wide querySelectorAll plus a
 * choicesKey() over every option of every enhanced select (thousands of
 * characters on the firewall page) every second, forever, to discover that
 * nothing had changed. The interesting mutations are: a <select> (or a subtree
 * containing one) appearing, a data table appearing, or one of the watched
 * attributes flipping on a <select>. Everything else is someone else's text. */
function relevant(mutations) {
	/* attributeFilter narrows the ATTRIBUTE, not the element: `value` and `disabled` live on
	 * inputs and buttons too, and a poll rewriting an input's value would otherwise wake the
	 * whole scan. This half is ours alone; the added-node walk below is the shared one. */
	for (const m of mutations)
		if (m.type === 'attributes' && m.target.tagName === 'SELECT')
			return true;
	/* `.table`, not `table.table` — the same selector tagDataTables() and STACKABLE use.
	 * Additions only: a select or a table going away costs us nothing to notice. */
	return fit.touches(mutations, 'select.cbi-input-select, .table');
}

return baseclass.extend({
	__init__() {
		const scan = () => {
			document.querySelectorAll('select.cbi-input-select:not([data-fs-select])').forEach(enhance);
			document.querySelectorAll('select.cbi-input-select[data-fs-select="1"]').forEach(resync);
		};
		scan();

		/* A table has to be TAGGED .fs-dt before it can be fitted, and the tagging has to be
		 * re-done whenever the poll brings a fresh table back — so the two travel together
		 * as one fitter. fs-fit runs it now, on every content mutation (synchronously,
		 * before paint) and on every resize of #view. */
		fit.add(() => { tagDataTables(); fitTables(); });

		/* one scan per frame, however many mutations arrive — fit.frame is the shared
		 * coalescer (fs-fit.js owns the frame batching for the whole theme) */
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
