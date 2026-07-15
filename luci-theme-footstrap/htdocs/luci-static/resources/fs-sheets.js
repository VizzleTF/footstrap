'use strict';
'require baseclass';

/* ---- a view's injected CSS: never DELETE it; leave a poisoned document by a real load ----
 *
 * A view's <style> dies with the document on a full load; SPA nav never reloads, so it restyles
 * every page after. `luci-app-filemanager` injects `.cbi-button-apply, .cbi-button-reset,
 * .cbi-button-save:not(.custom-save-button) { display: none !important }` — unlayered + important,
 * outranking every cascade layer: one visit and Save/Reset are gone from every config page.
 *
 * But DELETING them on nav broke SSClash. A poller can be re-registered by re-rendering the view;
 * a stylesheet only returns if its injector runs AGAIN, and a library importing CSS at MODULE EVAL
 * never will (module cached for the life of the document). ACE's ace_editor.css (14 KB of
 * absolutely-positioned layers, gutter, line boxes) is imported once — after the sweep, navigating
 * back to its editor gave a black rectangle 2 007 346 px tall. Deletion was silently one-way.
 *
 * So: a sheet matching only its OWN app's widgets (`.ace_*`, `.cpu-status-view-mode-entry`) is
 * inert elsewhere — LEAVE it. One reaching into the widget universe the THEME styles
 * (`.cbi-button-save`, `pre`, `:root`) can repaint any page: that document is spent, so refuse to
 * hand it to another view and fall back to a REAL page load — speed traded, never correctness, and
 * the fresh document carries no view CSS, so SPA nav resumes right after. That refusal is the SPA
 * router's (fs-router.js) — this module only answers the question.
 *
 * `invasiveSheet()` is that test; its universe is read back from cascade.css itself (same-origin,
 * so `cssRules` is readable) rather than a hand-written list, so it tracks the theme. 0.3 ms per
 * nav. Exempt: `[data-fs-shell]` (the one <style> the server emits — marked, not guessed at) and
 * anything inside `#view` (dies with the content swap); LuCI core injects no <style> at runtime at
 * all (checked: luci.js, ui.js, cbi.js). If cascade.css cannot be read, EVERY view sheet counts as
 * invasive: fail to the slow path, never the broken one. */
let _themeNames = null;

function themeNames() {
	if (_themeNames) return _themeNames;
	const names = new Set();	/* every class and id the theme styles */
	const props = new Set();	/* every custom property it declares or reads */
	const walk = (rules) => {
		for (const r of rules) {
			if (r.selectorText)
				(r.selectorText.match(/[.#][A-Za-z_][\w-]*/g) || []).forEach((n) => names.add(n));
			if (r.cssText)
				(r.cssText.match(/--[A-Za-z_][\w-]*/g) || []).forEach((p) => props.add(p));
			if (r.cssRules) walk(r.cssRules);
		}
	};
	for (const ss of document.styleSheets) {
		if (!ss.href || !(/\/cascade\.css/).test(ss.href)) continue;
		try { walk(ss.cssRules); } catch (e) { return null; }
	}
	_themeNames = names.size ? { names, props } : null;
	return _themeNames;
}

/* A rule with a bare SELECTOR (`:root`, `pre`, `*`) still cannot touch us if none of its
 * DECLARATIONS can: a custom property this theme never reads is inert. That is the difference
 * between an app costing a full page load and not — `luci-app-temp-status` opens with
 * `:root { --app-temp-status-temp: #147aff; … }`, and both it and the file manager's hex editor
 * would otherwise read as "document spent" on the strength of the selector alone.
 *
 * Still invasive: any STANDARD property on a bare selector (the stock file manager writes
 * `:root { color-scheme: light dark }`, re-pointing every UA widget at the OS preference), and any
 * custom property the THEME reads — the point of the private `--fs-*` tier is that an app writing
 * `--accent`/`--radius` on `:root` cannot repaint us, and this must keep it so for names we read. */
function inertDeclarations(rule, props) {
	const st = rule.style;
	if (!st || !st.length) return false;	/* no declarations to judge -> judge by selector */
	for (let i = 0; i < st.length; i++) {
		const p = st.item(i);
		if (p.slice(0, 2) !== '--') return false;	/* a real property: it paints something */
		if (props.has(p)) return false;			/* a custom property the theme itself reads */
	}
	return true;
}

/* true when this sheet can repaint a page that is not its own. A sheet that is not readable —
 * still loading, 404, cross-origin — is invasive by default: unknown CSS takes the slow path,
 * never the broken one. */
function invasiveSheet(el, universe) {
	let sheet;
	try { sheet = el.sheet; } catch (e) { return true; }
	if (!sheet) return true;

	const { names, props } = universe;
	let invasive = false;
	const walk = (rules) => {
		for (const r of rules) {
			if (invasive) return;
			if (r.selectorText) {
				for (const part of r.selectorText.split(',')) {
					const p = part.trim();
					if (!p) continue;
					/* no class, no id, no attribute anywhere: a bare type/universal selector, which
					 * matches stock markup on every page (`pre`, `*`, `svg text`, `:root`) — unless
					 * everything it declares is inert here (see inertDeclarations) */
					if (!(/[.#[]/).test(p)) {
						if (inertDeclarations(r, props)) continue;
						invasive = true;
						return;
					}
					/* A rule may name a stock widget and still be harmless if it can only ever
					 * MATCH inside the app's own markup: `#cbi-podkop-section > .cbi-section-remove`
					 * needs podkop's section to exist. What pins it there is a name the theme does
					 * NOT know — the app's own. A selector made ENTIRELY of stock names has nothing
					 * pinning it, and matches the same widgets on every other page.
					 *
					 * Functional pseudo-class arguments are stripped before looking for that pin,
					 * and that is the whole difference between podkop and the file manager:
					 * `.cbi-button-save:not(.custom-save-button)` names an app class too, but
					 * inside a NEGATION — it does not require the app's markup, it excludes it. */
					const themeHit = (p.match(/[.#][A-Za-z_][\w-]*/g) || []).some((n) => names.has(n));
					if (!themeHit) continue;
					const pinned = (p.replace(/:[a-z-]+\([^)]*\)/gi, ' ').match(/[.#][A-Za-z_][\w-]*/g) || [])
						.some((n) => !names.has(n));
					if (!pinned) { invasive = true; return; }
				}
			}
			if (r.cssRules) walk(r.cssRules);
		}
	};
	try { walk(sheet.cssRules); } catch (e) { return true; }
	return invasive;
}

/* Both element kinds count; the <link> half is not hypothetical: `luci-app-banip` and
 * `luci-app-adblock` append `<link rel=stylesheet href=…/custom.css>` to <head> at MODULE EVAL,
 * and it styles `.cbi-input-text`/`.cbi-input-select` — stock widgets, every page, unlayered. A
 * <link> INSIDE the view tree (`luci-app-nlbwmon`) needs no handling: it dies with the swap. */
const VIEW_SHEETS = 'style:not([data-fs-shell]), link[rel~="stylesheet"]:not([data-fs-shell])';

function documentPoisoned() {
	const names = themeNames();
	return Array.prototype.some.call(
		document.querySelectorAll(VIEW_SHEETS),
		(el) => !el.closest('#view') && (!names || invasiveSheet(el, names)));
}

/* ---- the one thing that IS safe to remove: a byte-identical second copy ----
 *
 * Not deleting view CSS costs where an app injects on EVERY render: `luci-app-podkop` calls
 * injectGlobalStyles() from render() (4 KB, no guard) and `luci-app-mosdns` re-appends three
 * CodeMirror <link>s, so every SPA re-visit adds a copy that never stops being parsed. Dropping an
 * EXACT duplicate cannot break anyone, for the reason the sweep failed: the rules do not go away —
 * the surviving copy is byte-identical, and a library's "have I already imported this?" check (what
 * ACE died on) still finds its sheet. Keep the FIRST copy: it is what any handle the app kept
 * points at. */
function dedupeViewSheets() {
	const seen = new Set();
	document.querySelectorAll(VIEW_SHEETS).forEach((el) => {
		if (el.closest('#view')) return;
		const key = el.tagName + '|' + (el.tagName === 'LINK' ? el.href : el.textContent);
		if (seen.has(key)) el.remove();
		else seen.add(key);
	});
}

/* Watch <head> rather than deduping on navigation: the copy arrives too late otherwise — podkop
 * injects from its render(), which resolves AFTER the router's require() callback, so a nav-time
 * sweep left the document permanently carrying one stale duplicate (bounded, never zero). The
 * observer collapses the copy in the microtask it appears in. It cannot loop: a removal produces a
 * mutation with no ADDED nodes, and the handler bails unless a stylesheet was added. */
function watchViewSheets() {
	new MutationObserver((muts) => {
		for (const m of muts)
			for (const n of m.addedNodes)
				if (n.nodeName === 'STYLE' || n.nodeName === 'LINK') {
					dedupeViewSheets();
					return;
				}
	}).observe(document.head, { childList: true });
}

return baseclass.extend({
	documentPoisoned,
	dedupeViewSheets,
	watchViewSheets
});
