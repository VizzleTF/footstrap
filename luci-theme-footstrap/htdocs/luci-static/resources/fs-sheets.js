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

/* What counts as a NAME — a class or an id — in a selector. This is the vocabulary the whole zone
 * test is written in: themeNames() harvests the theme's names with it, pinnedToApp() looks for the
 * app's own name with it, and judgeSheet() asks whether a part names anything of ours with it. Three
 * copies of the pattern sat under a comment explaining that two copies of the JUDGEMENT would drift
 * into disagreeing — and a vocabulary that disagrees with itself is the same bug one level down: widen
 * it in the harvester alone and names enter `names` that the other two can never match, so a selector
 * that does reach the chrome reads as pinned and is left unfenced.
 *
 * Shared safely BECAUSE every use is String.match(): a /g regex is stateful under .test(), but
 * [Symbol.match] resets lastIndex first. Do not call .test() on this one. */
const NAME_RE = /[.#][A-Za-z_][\w-]*/g;

/* a re-hosted <style>'s text is no longer what its app wrote — dedupeViewSheets keys on the
 * original, or the app's next identical copy stops looking like a duplicate (see there) */
const origText = new WeakMap();

function themeNames() {
	if (_themeNames) return _themeNames;
	const names = new Set();	/* every class and id the theme styles */
	const props = new Set();	/* every custom property it declares or reads */
	const walk = (rules) => {
		for (const r of rules) {
			if (r.selectorText)
				(r.selectorText.match(NAME_RE) || []).forEach((n) => names.add(n));
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

/* Is this selector part held inside the app's OWN markup by a name the theme does not know?
 * `#cbi-podkop-section > .cbi-section-remove` is: podkop's section has to exist for it to match
 * anything, so it can never reach another page — or our chrome. A part made ENTIRELY of names the
 * theme knows (`*`, `.nav`, `#indicators`, `ul.nav > li > a`) has nothing pinning it anywhere.
 *
 * Functional pseudo-class arguments are stripped before looking for the pin, and that is the whole
 * difference between podkop and the file manager: `.cbi-button-save:not(.custom-save-button)` names
 * an app class too, but inside a NEGATION — it does not require the app's markup, it excludes it.
 *
 * Shared by invasiveSheet() (is this sheet dangerous?) and fenceRules() (which parts get fenced?) —
 * they must agree by construction: a part judged able to reach another page is exactly a part able
 * to reach the chrome. Two copies of this test would drift into disagreeing. */
function pinnedToApp(part, names) {
	return (part.replace(/:[a-z-]+\([^)]*\)/gi, ' ').match(NAME_RE) || [])
		.some((n) => !names.has(n));
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

/* ---- the verdict is a property of the sheet, taken BEFORE we rewrite it -------------------
 *
 * An invasive verdict is STICKY, and it has to be: the moment rehostIntoThemeLayer() fences a sheet,
 * what stands in the DOM is no longer the CSS its app wrote, and re-judging our own edit answers a
 * different question than the one asked.
 *
 * It used to answer the right one BY ACCIDENT. The fence named a class (`.fs-sidebar`), so a fenced
 * selector still carried a name the theme styles, still tripped the `themeHit` test, and
 * documentPoisoned() went on reporting the document spent. Nothing said that was load-bearing —
 * moving the fence onto an attribute leaves no class name in the text, every fenced document would
 * have read CLEAN, and the SPA would have carried openclash's `*{padding:0!important}` into the next
 * page with the chrome fenced and the content flattened. Take the verdict once, keep it.
 *
 * Only `true` is kept. A clean sheet can still GROW hostile rules — an app that builds its CSS with
 * insertRule() has an EMPTY sheet the first time we look — so a clean verdict stays provisional and
 * is re-taken on every ask. */
const _invasive = new WeakSet();

function invasiveSheet(el, universe) {
	if (_invasive.has(el)) return true;
	const v = judgeSheet(el, universe);
	if (v) _invasive.add(el);
	return v;
}

/* true when this sheet can repaint a page that is not its own. A sheet that is not readable —
 * still loading, 404, cross-origin — is invasive by default: unknown CSS takes the slow path,
 * never the broken one. */
function judgeSheet(el, universe) {
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
					const themeHit = (p.match(NAME_RE) || []).some((n) => names.has(n));
					if (!themeHit) continue;
					if (!pinnedToApp(p, names)) { invasive = true; return; }
				}
			}
			if (r.cssRules) walk(r.cssRules);
			/* an @import's rules are not r.cssRules — follow it, or the verdict is blind to every
			 * rule behind it. Re-hosting a <link> produces exactly such a shim, and a sheet that
			 * judged its own shim inert would report a document clean while still carrying the
			 * poison into the next page. Unreadable (cross-origin) import: invasive, like any
			 * sheet we cannot read. */
			if (r.styleSheet) {
				let imported;
				try { imported = r.styleSheet.cssRules; } catch (e) { invasive = true; return; }
				if (imported) walk(imported);
			}
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

/* ---- an invasive sheet still has to render ITS page: re-host it into the theme LAYER ----
 *
 * documentPoisoned() saves every page AFTER this one. It cannot save this one — the sheet is
 * already applying. Every footstrap rule lives in a @layer, and an UNLAYERED normal declaration
 * beats a layered one at any specificity, so a third-party reset owns the chrome outright:
 * `luci-app-openclash` ships `* { margin: 0; padding: 0 }` (a log.htm reset, leaked document-wide
 * by a <link> its Lua template prints into .fs-content). Measured on the router with those two
 * rules and nothing else: menu text flush at x=0 with the icons clipped, submenu indent gone, tabs
 * collapsed to a bare text row. On stock luci-theme-bootstrap — no layers — the same `*` (0,0,0)
 * loses to any class selector on specificity and nobody ever noticed. That asymmetry is the whole
 * bug, and it is ours: the layers are what handed a 0,0,0 selector the win (issue #8).
 *
 * So put the sheet back on specificity footing: re-host it into the EXISTING `theme` layer. Only
 * same-layer arbitrates by specificity — which is exactly what makes bootstrap survive. Measured,
 * all three placements, on the real cascade:
 *
 *   app unlayered (today)        chrome BROKEN   app's own design OK
 *   app -> @layer theme          chrome OK       app's own design OK
 *   app -> @layer before theme   chrome OK       app's own design BROKEN
 *
 * The tempting shape is the third — give the app its own layer under the theme. Do NOT: the theme
 * then beats the app at ANY specificity, including the rules it aims at its own page. OpenClash
 * restyles its tabs with `#tab-header ul.cbi-tabmenu li` (1,1,2) and footstrap styles
 * `ul.cbi-tabmenu li` (0,1,2) — demote the app and footstrap repaints the app author's own tabs.
 * In `theme` the app keeps them, and `*` still loses to the chrome's 0,3,1. No new layer is
 * declared; a re-opened `@layer theme` block appends to the one 00-header.css already names.
 *
 * What this deliberately does NOT fix: `base`. The app must outrank `theme` for its own page to
 * work, so it sits above `base`, and `*` still wipes base's widget padding (cssdiff: `input`
 * 4px->0, `.ifacebadge`, `strong` margins). That is not a regression — an unlayered `*` beats base
 * today too — it is the price of the same trade, and the only way out would re-break the app.
 *
 * NEVER delete the sheet instead (see dedupeViewSheets below for what that cost). Re-hosting moves
 * where a rule lands in the cascade; every rule still exists, so a library's "did I already import
 * this?" check still finds its sheet. A <link> is DISABLED rather than removed, so an app that
 * looks its own <link> back up by href still finds the element. */
/* ---- the fence: the chrome is ours, so make a foreign rule unable to MATCH it ----
 *
 * Re-hosting into the theme layer settles a fight on specificity. It cannot settle one against
 * `!important`, because importance ranks ABOVE layers — measured: `* { padding: 0 !important }`
 * still owns the chrome after re-hosting, and so does `#indicators { display: none !important }`.
 * The only pure-CSS answer to a foreign flag is our own flag in an earlier layer (it wins — also
 * measured), but that means ~550 of them, and `color`/`background` among them would beat this
 * theme's OWN forced-colors block. Fixing the cascade by breaking high-contrast is not a fix.
 *
 * So do not out-rank the rule — put the chrome where it cannot be addressed. Appending
 * `:where(:not([data-fs-chrome], [data-fs-chrome] *))` to a foreign selector's SUBJECT leaves it
 * matching everything it used to except us. `!important` has nothing left to win.
 *
 * The chrome is NOT one element, and naming one is how this went wrong the first time: the fence
 * said `.fs-sidebar`, which is the menu in both layouts (the bar is the same markup) — but the skip
 * link is a sibling of .fs-shell and the Appearance popover hangs off <body>, so both stayed exposed
 * while every test said the chrome was defended. `data-fs-chrome` is the fix: an element DECLARES
 * that it is ours, where it is written (header.ut, fs-appearance.js), and the fence and the pin
 * follow without being told. A future chrome root cannot forget to edit a constant in this file,
 * because there is no constant naming it any more. `npm run chrome-fence` holds the three together.
 *
 * `:where()` is load-bearing and not cosmetic: it contributes ZERO specificity, so `*` stays 0,0,0
 * and `#indicators` stays 1,0,0 and the app's rules keep their exact weight against each other and
 * against the theme on its own page. A plain `:not(.fs-sidebar)` takes its argument's specificity
 * and would silently re-order the app's stylesheet against itself.
 *
 * Only UNPINNED parts are fenced. A part pinned by the app's own name cannot reach the chrome
 * anyway (proven by the same test invasiveSheet uses), so leaving it alone costs nothing and keeps
 * the surgery as small as the danger.
 *
 * Two silent traps, both measured on the real CSSOM, both of which cost the app its rule:
 *  - A selector LIST must be fenced part by part. Appending to the whole `selectorText` fences only
 *    the last part: `*, ul` came back as `*, ul:where(…)` — `*` unfenced, chrome still exposed.
 *  - A pseudo-element must stay LAST. `a::after` + a tail append serialised to `a::after:where()`
 *    — the argument silently EATEN, leaving an empty `:where()` that matches NOTHING, and the
 *    setter reported success. The fence goes before the pseudo-element: `a:where(…)::after`. */
const CHROME_FENCE = ':where(:not([data-fs-chrome],[data-fs-chrome] *))';

function fenceSelector(part) {
	/* the getter always normalises a pseudo-element to `::`, incl. legacy `:before` */
	const i = part.indexOf('::');
	return i < 0 ? part + CHROME_FENCE : part.slice(0, i) + CHROME_FENCE + part.slice(i);
}

function fenceRules(rules, names) {
	for (const r of rules) {
		if (r.selectorText) {
			const parts = r.selectorText.split(',').map((p) => p.trim()).filter(Boolean);
			if (parts.length && parts.some((p) => !pinnedToApp(p, names))) {
				/* The setter parses the whole selector and, on one it cannot parse, does NOTHING and
				 * does not throw — so it is atomic: never a half-written selector, and a failure just
				 * leaves the rule where it already was (unfenced, i.e. today's exposure). */
				try {
					r.selectorText = parts
						.map((p) => (pinnedToApp(p, names) ? p : fenceSelector(p))).join(', ');
				} catch (e) { /* left unfenced on purpose: the app keeps its rule */ }
			}
		}
		if (r.cssRules) fenceRules(r.cssRules, names);
	}
}

/* An @import's rules live in a sheet that is fetched separately, so they are not there the moment
 * the shim is inserted — retry until they are, then fence. Bounded: a sheet that never becomes
 * readable (404, cross-origin) simply stays unfenced, which is where we already were. */
function fenceImported(styleEl, names, tries) {
	let rules = null;
	try {
		const first = styleEl.sheet && styleEl.sheet.cssRules[0];
		rules = first && first.styleSheet && first.styleSheet.cssRules;
	} catch (e) { rules = null; }
	if (rules) { fenceRules(rules, names); return; }
	if (tries > 0) requestAnimationFrame(() => fenceImported(styleEl, names, tries - 1));
}

/* What a sheet IS, as text: the rules that are APPLYING, not the markup that may or may not have
 * produced them. Serialised only ever to COMPARE — never re-parsed, so the serialiser cannot cost
 * anyone a rule. */
const serializeRules = (rules) => Array.prototype.map.call(rules, (r) => r.cssText).join('\n');

/* ---- a <style>'s textContent is NOT its sheet, and both the wrap and the dedupe assumed it was ----
 *
 * Wrapping means re-setting textContent, which RE-PARSES: whatever the parse does not reproduce is
 * deleted — silently, by the one fix in this file whose entire thesis is that deleting a view's CSS
 * is one-way (see the head of the file). Two shapes where the text does not describe the sheet, and
 * they are one question, not two:
 *  - an app that builds its CSS with insertRule() — an empty <style> appended first, rules pushed in
 *    after: the text is EMPTY while the rules apply, so the wrap writes `@layer theme {}` over a live
 *    sheet and every rule in it is gone.
 *  - a <style> carrying @import: it is invalid inside @layer and has to sit at the top of a sheet, so
 *    the wrapped copy comes back without it.
 *
 * So ask the exact question once — does re-parsing this text give back the sheet that is applying? —
 * rather than enumerate the shapes that make it false; the enumeration is what missed insertRule().
 * The probe is a CONSTRUCTIBLE sheet: never adopted, so nothing paints, no <head> mutation, and our
 * own observer never sees it. It also drops @import (per spec), which is why that case needs no test
 * of its own — the serialisations differ and the answer is already no.
 *
 * No probe means no answer, and the honest answer to "may I re-parse this?" when we cannot check is
 * NO: the sheet keeps every rule and the fence still holds Zone 1 without it. */
let _probe = null;
function textIsSheet(el, live) {
	try {
		if (!_probe) _probe = new CSSStyleSheet();
		_probe.replaceSync(el.textContent);
		return serializeRules(_probe.cssRules) === serializeRules(live);
	} catch (e) { return false; }
}

function rehostIntoThemeLayer(el, universe) {
	if (el.dataset.fsLayered) return;

	if (el.tagName === 'LINK') {
		/* A <link>'s rules cannot be moved into a layer in place — but an @import CAN name one.
		 * The href is already absolute and same-origin, so the re-fetch is a cache hit. */
		const s = document.createElement('style');
		s.dataset.fsLayered = '1';
		s.textContent = '@import url("' + el.href.replace(/["\\]/g, '\\$&') + '") layer(theme);';
		el.dataset.fsLayered = '1';
		el.after(s);		/* keep source order: ties inside the layer still resolve as they did */
		el.disabled = true;
		fenceImported(s, universe.names, 60);	/* ~1s of frames; a cache hit lands on the first */
		return;
	}

	let rules;
	try { rules = el.sheet && el.sheet.cssRules; } catch (e) { return; }
	/* No rules yet: nothing to re-host, nothing to fence — and, crucially, nothing to MARK. An app
	 * that appends an empty <style> and fills it with insertRule() arrives here first; marking it
	 * handled now would leave the sheet it is about to build unfenced for the life of the document. */
	if (!rules || !rules.length) return;

	/* Handled — and never twice. fenceRules() is NOT idempotent: pinnedToApp() strips a functional
	 * pseudo-class before looking for the app's own name, so an already-fenced selector reads as
	 * unpinned all over again and a second pass appends a second fence. The mark is the only thing
	 * that says the work is done, so it has to be set for every path below, wrapped or not. */
	el.dataset.fsLayered = '1';

	/* Wrap only if the text still IS the sheet (see textIsSheet). When it is not, the sheet stays
	 * unlayered — Zone 2 exactly where it already was, which is a trade — rather than lose rules,
	 * and it is still FENCED below: the fence is pure CSSOM, needs no re-parse, and is the half that
	 * answers `!important` anyway.
	 *
	 * Layer by TEXT, fence by CSSOM, in that order: re-setting textContent re-parses the sheet and
	 * would throw away any selector we had already rewritten. A <style>'s url()s resolve against the
	 * document either way, so re-parsing costs nothing here — which is exactly NOT true of a <link>
	 * (measured: cssText serialises `url("img.png")` still relative, so inlining a linked sheet would
	 * silently re-base every image and font in it. That is why a <link> keeps its @import). */
	if (textIsSheet(el, rules)) {
		origText.set(el, el.textContent);	/* dedupeViewSheets keys on this — see there */
		el.textContent = '@layer theme {\n' + el.textContent + '\n}';
	}
	try { if (el.sheet) fenceRules(el.sheet.cssRules, universe.names); } catch (e) { /* unfenced, not broken */ }
}

/* Re-hosting needs the theme's own selectors to tell an invasive sheet from an inert one. If
 * cascade.css cannot be read we cannot classify, so re-host NOTHING and leave the cascade exactly
 * as it is: documentPoisoned() already fails every sheet to the slow path in that case, and
 * silently demoting an app we could not judge is the one move with no way back for its author. */
function rehostInvasiveSheets() {
	const universe = themeNames();		/* {names, props} — NOT a bare Set; the fence wants .names */
	if (!universe) return;
	document.querySelectorAll(VIEW_SHEETS).forEach((el) => {
		if (el.dataset.fsLayered) return;
		if (invasiveSheet(el, universe)) rehostIntoThemeLayer(el, universe);
	});
}

/* ---- the one thing that IS safe to remove: a byte-identical second copy ----
 *
 * Not deleting view CSS costs where an app injects on EVERY render: `luci-app-podkop` calls
 * injectGlobalStyles() from render() (4 KB, no guard) and `luci-app-mosdns` re-appends three
 * CodeMirror <link>s, so every SPA re-visit adds a copy that never stops being parsed. Dropping an
 * EXACT duplicate cannot break anyone, for the reason the sweep failed: the rules do not go away —
 * the surviving copy is byte-identical, and a library's "have I already imported this?" check (what
 * ACE died on) still finds its sheet. Keep the FIRST copy: it is what any handle the app kept
 * points at.
 *
 * Key a <style> on what its APP wrote, not on what stands in the DOM: re-hosting rewrites the text
 * (@layer wrapper), so a wrapped first copy and podkop's next byte-identical injection would no
 * longer match — the duplicate detector would go quiet exactly where it earns its keep, and the
 * copies would pile up again. A <link> keys on href, which re-hosting leaves alone.
 *
 * Re-hosting must therefore run BEFORE this, never after: a fresh copy of a <link> is appended to
 * <head>, which is EARLIER in document order than a template's <link> down in .fs-content, so the
 * "keep the first" rule would keep the raw copy, drop the re-hosted one, and strand its @import
 * shim — the chrome breaking again while shims pile up once per render (measured; that is the leak
 * this function exists to prevent). Re-host first and both copies are equivalent by the time they
 * are compared, so whichever survives is already layered and the loser's shim is a byte-identical
 * duplicate this same pass collapses. */
function sheetKey(el) {
	if (el.tagName === 'LINK') return 'LINK|' + el.href;
	const t = origText.get(el);
	if (t !== undefined) return 'STYLE|' + t;
	/* Not wrapped, so no original was kept — and this sheet's textContent may not BE its sheet (see
	 * textIsSheet): every insertRule-built <style> has an empty one, so keying on the text gave them
	 * all the same key and the second one was REMOVED as a "duplicate" of a sheet it shares nothing
	 * with. That is the deletion this file exists to prevent, dressed as a dedupe. Key on what is
	 * applying instead. */
	let rules;
	try { rules = el.sheet && el.sheet.cssRules; } catch (e) { return null; }
	/* A sheet with no rules is a duplicate of nothing — and it is very likely a <style> an app has
	 * appended but not yet filled: removing it strands the handle it is about to insertRule through. */
	if (!rules || !rules.length) return null;
	return 'STYLE|' + serializeRules(rules);
}

function dedupeViewSheets() {
	const seen = new Set();
	document.querySelectorAll(VIEW_SHEETS).forEach((el) => {
		if (el.closest('#view')) return;
		const key = sheetKey(el);
		if (key === null) return;
		if (seen.has(key)) el.remove();
		else seen.add(key);
	});
}

/* Watch <head> rather than deduping on navigation: the copy arrives too late otherwise — podkop
 * injects from its render(), which resolves AFTER the router's require() callback, so a nav-time
 * sweep left the document permanently carrying one stale duplicate (bounded, never zero). The
 * observer collapses the copy in the microtask it appears in. It cannot loop: a removal produces a
 * mutation with no ADDED nodes, and the handler bails unless a stylesheet was added.
 *
 * The immediate pass is not the observer's job and cannot be: a legacy Lua page's <link> is in the
 * SERVER's HTML (openclash prints it into .fs-content), so it is parsed and applying long before
 * this module is even fetched — there is no mutation to observe. It is re-hosted on the first pass
 * instead, which costs a brief flash of unstyled chrome before the modules land; the page then
 * settles correct, where today it stays broken. Runtime injections land in <head> (podkop, banip,
 * adblock, the file manager), which is what the observer watches — deliberately not the whole
 * document, since LuCI's poll rewrites content every second and this would fire on every tick. */
function watchViewSheets() {
	/* Dedupe the immediate pass too, in the observer's order (re-host strictly first — see there).
	 * It used to re-host only, which left the server-rendered duplicate — the one case this pass
	 * exists for — uncollapsed for the life of the document. Measured with the real
	 * luci-app-openclash: it prints the same <link href=oc.css> from three templates, so its
	 * Overwrite Settings page carried two identical links and the two @import shims we make for
	 * them, parsing 117 KB of CSS twice. The observer never fires for either: both are in the
	 * SERVER's HTML, so there is no mutation to see. */
	rehostInvasiveSheets();
	dedupeViewSheets();
	new MutationObserver((muts) => {
		for (const m of muts)
			for (const n of m.addedNodes)
				if (n.nodeName === 'STYLE' || n.nodeName === 'LINK') {
					rehostInvasiveSheets();	/* strictly before the dedupe — see there */
					dedupeViewSheets();
					return;
				}
	}).observe(document.head, { childList: true });
}

return baseclass.extend({
	documentPoisoned,
	watchViewSheets
});
