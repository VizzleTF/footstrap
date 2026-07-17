'use strict';
'require baseclass';
'require fs-prefs as prefs';
'require fs-widgets as widgets';
'require fs-version as ver';

/* The Appearance popover: the DOM that presents the axes. It owns no preference and no update
 * machinery — fs-prefs.js holds the axes, fs-version.js the version string; this file is the dialog
 * they are shown in.
 *
 * The update CHECK and the one-click self-update live in the OPTIONAL luci-app-footstrap-updater
 * package (fs-update.js). This file does not statically require it — a missing updater would then be
 * a DependencyError that takes out the whole chrome. Instead wire() loads it at runtime and hands it
 * to wireAppearance() as `update` (null when the updater is not installed): with it, the popover
 * grows the Updates toggle, the "new version" badge and the Update button; without it, the popover
 * looks the same minus those three, and the version still shows. */

function wire() {
	/* fs-update ships in the optional updater package; resolve it to null when absent so the popover
	 * degrades to version-only instead of failing to build. */
	return window.L.require('fs-update').then((m) => m, () => null).then(wireAppearance);
}

function wireAppearance(update) {
	const btn = document.getElementById('fs-appearance');
	if (!btn) return;

	/* every saved axis re-checks the Save button after it applies, so the button greys the moment
	 * this browser matches the saved default again and un-greys the moment it diverges. Wrapped
	 * around the appliers because the seg/slider controls call them directly and have no other seam
	 * back to here. refreshSave is a hoisted function declaration; saveBtn it reads is assigned
	 * below, before any of these fire (all are user events). */
	const bump = (fn) => (v) => { fn(v); refreshSave(); };

	/* One captioned row: `<div class=fs-ap-group>` + its label + the control. `make` is handed the
	 * SAME label string the caption renders, because every control in here needs it a second time as
	 * its aria-label (segControl/sliderControl take it as their last argument) — and stating it twice
	 * is how the visible caption and what a screen reader announces drift apart. One literal per axis,
	 * used by both, with nothing to keep in sync. `extra` is for the rows that carry more than a
	 * control (the Save row's action pair and its error line), `opts.cls` for the one row CSS has to
	 * be able to single out. */
	const group = (label, make, opts) => {
		const o = opts || {};
		return E('div', { 'class': 'fs-ap-group' + (o.cls ? ' ' + o.cls : '') }, [
			E('div', { 'class': 'fs-ap-label' }, [ label ]),
			make(label)
		].concat(o.extra || []));
	};

	/* Axes in order: Layout, Theme, Palette, Wallpaper, Tint, Accent, Rounding, Submenus (sidebar
	 * only), Updates.
	 *
	 * EVERY LABEL IN HERE CARRIES THE 'footstrap' CONTEXT (`_(str, ctx)`, key `ctx\1str`). LuCI
	 * serves ONE MERGED catalogue — load_catalog() loads every *.<lang>.lmo in
	 * /usr/lib/lua/luci/i18n and a lookup returns the first archive holding the hash — so a msgid is
	 * a GLOBAL name shared with every luci-app, and readdir order picks the winner: the layout
	 * toggle rendered "Максимум" on a Russian router (issue #6), because another catalogue
	 * translates the msgid "Top" as "maximum". Contexting cannot be selective — whatever we leave
	 * bare is a name anyone may take. The chrome and the login/notice sentences are deliberately
	 * bare (inheriting luci-base's translation is a feature in the ~40 languages we have no
	 * catalogue for), as are System/Memory/Storage in 05_footstrap_overview_layout.js, which MATCH
	 * the stock headings. */
	const groups = [
		group(_('Layout', 'footstrap'), (label) => widgets.segControl(prefs.currentLayout(), [
			{ val: 'sidebar', label: _('Sidebar', 'footstrap') },
			{ val: 'top',     label: _('Top', 'footstrap') }
		], bump(prefs.applyLayout), label)),

		group(_('Theme', 'footstrap'), (label) => widgets.segControl(prefs.currentMode(), [
			{ val: 'auto',  label: _('Auto', 'footstrap') },
			{ val: 'light', label: _('Light', 'footstrap') },
			{ val: 'dark',  label: _('Dark', 'footstrap') }
		], bump(prefs.applyMode), label)),

		group(_('Palette', 'footstrap'), (label) => widgets.segControl(prefs.currentPalette(), [
			{ val: 'footstrap',  label: 'Footstrap' },
			{ val: 'hicontrast', label: 'Hi-Contrast' }
		], bump(prefs.applyPalette), label)),

		group(_('Wallpaper', 'footstrap'), (label) => widgets.segControl(prefs.currentWallpaper(), [
			{ val: 'off',  label: _('Off', 'footstrap') },
			{ val: 'cats', label: _('Cats', 'footstrap') }
		], bump(prefs.applyWallpaper), label)),

		/* the caption says what the axis is FOR: "Tint" alone reads as decoration and nobody would
		 * look for the router-identity cue under it.
		 * step 5 = 72 hues, which is finer than anyone can name and coarse enough that the same
		 * router lands on the same colour when it is set again. */
		group(_('Tint (router identification)', 'footstrap'),
			(label) => widgets.sliderControl(prefs.currentTint(), 0, 360, bump(prefs.applyTint), label, {
				step: 5,
				cls: 'fs-range-hue',
				fmt: (v) => (v ? v + '°' : _('Off', 'footstrap'))
			})),

		/* recolours the accented CONTROLS (buttons/toggles/sliders/focus rings), not the canvas
		 * the way Tint does — same hue slider, off at 0 = palette default */
		group(_('Accent', 'footstrap'),
			(label) => widgets.sliderControl(prefs.currentAccent(), 0, 360, bump(prefs.applyAccent), label, {
				step: 5,
				cls: 'fs-range-hue fs-range-accent',
				fmt: (v) => (v ? v + '°' : _('Off', 'footstrap'))
			})),

		group(_('Rounding', 'footstrap'),
			(label) => widgets.sliderControl(prefs.currentRadius(), 0, 20, bump(prefs.applyRadius), label))
	];

	/* The top layout has no accordion (its sections are hover dropdowns, already exclusive), so this
	 * switch is meaningless there. ALWAYS BUILT, HIDDEN BY CSS (:root[data-layout="top"]
	 * .fs-ap-submenus, theme/20-shell.css). Do NOT put an `if (currentLayout() !== 'top')` around the
	 * push: the popover is built ONCE, in init(), so the branch froze the control to the layout the
	 * PAGE LOADED in — it stayed on screen after a switch to the bar, and never appeared after a
	 * switch away from it. Toggling the layout re-renders nothing; CSS morphs the chrome. */
	groups.push(group(
		_('Submenus', 'footstrap'),
		(label) => widgets.segControl(prefs.currentAutoCollapse() ? 'on' : 'off', [
			{ val: 'off', label: _('Keep open', 'footstrap') },
			{ val: 'on',  label: _('Auto-collapse', 'footstrap') }
		], bump(prefs.applyAutoCollapse), label),
		{ cls: 'fs-ap-submenus' }));

	/* version line + "new version" badge + one-click Update button. The badge and button exist only
	 * when the updater is installed (`update` non-null); they are revealed by the update check below
	 * when a newer release exists. */
	const badge = update ? E('a', {
		'class': 'fs-ap-badge', 'hidden': '',
		'href': update.LATEST_URL,
		'target': '_blank', 'rel': 'noopener'
	}, [ _('New version available') ]) : null;
	const updateBtn = update
		? E('button', { 'class': 'fs-ap-update', 'type': 'button', 'hidden': '' }, [ _('Update now') ])
		: null;

	/* opt-out toggle for the update check — ONLY when the updater is installed. NOT bump()-ed: it is
	 * not one of the saved axes, so it cannot move this browser toward or away from the router default.
	 * Without the updater there is nothing to check, so the row is omitted entirely. */
	if (update)
		groups.push(group(_('Updates', 'footstrap'), (label) =>
			widgets.segControl(update.currentUpdateCheck() ? 'on' : 'off', [
				{ val: 'on',  label: _('Check', 'footstrap') },
				{ val: 'off', label: _('Off', 'footstrap') }
			], update.applyUpdateCheck, label)));

	/* Save the current look as the ROUTER-WIDE default (fs-prefs writes it to /etc/config/footstrap
	 * via the scoped uci ACL). It does NOT change this browser — localStorage keeps overriding, so
	 * the saved default only shows on a fresh browser/device. "Reset" is the escape hatch: it clears
	 * this browser's overrides and reloads onto the saved default (a two-click confirm, since it
	 * discards local tweaks).
	 *
	 * No status text — the Save BUTTON itself is the status: enabled "Save as default" when this
	 * browser diverges from the saved default, disabled "Saved as default" when it already matches
	 * (nothing to save). refreshSave() below drives that from prefs.matchesSavedDefault(). */
	const saveBtn = E('button', { 'class': 'btn cbi-button-action', 'type': 'button' }, [ _('Save as default', 'footstrap') ]);
	const resetBtn = E('button', { 'class': 'btn', 'type': 'button' }, [ _('Reset to default', 'footstrap') ]);
	/* Save's only visible failure surface. saveAsDefault() writes /etc/config/footstrap over the
	 * scoped uci ACL; the realistic failure is the rpc REJECTING — an expired session (403), a
	 * missing ACL, ubus down — which the old code buried in a title tooltip nobody sees. (A DELETED
	 * config is NOT caught here: rpcd stages the set in the session and commit then silently no-ops
	 * without writing the file, returning success — measured on the router. The package owns that
	 * file and the read side falls back to built-in defaults, so that edge is left to the package.) */
	const saveErr = E('div', { 'class': 'fs-ap-err', 'role': 'alert', 'hidden': '' });
	/* the one row whose "control" is a pair of buttons, each already named by its own text — so the
	 * caption is not re-used as an aria-label here and `make` ignores it */
	groups.push(group(
		_('Router default', 'footstrap'),
		() => E('div', { 'class': 'fs-ap-actrow' }, [ saveBtn, resetBtn ]),
		{ extra: saveErr }));

	/* the version row is always present (it reads fs-version.js, the theme's own); the badge sits
	 * beside it and the Update button below it only when the updater is installed. */
	const versionLink = E('a', {
		'class': 'fs-ap-version',
		'href': ver.REPO_URL,
		'target': '_blank',
		'rel': 'noopener noreferrer'
	}, [ ver.label() ]);
	groups.push(E('div', { 'class': 'fs-ap-footer' }, [
		E('div', { 'class': 'fs-ap-verrow' }, [ versionLink ].concat(badge ? [ badge ] : [])),
	].concat(updateBtn ? [ updateBtn ] : [])));

	/* aria-modal matches what the popover already DOES: keydown() traps Tab inside it and Escape
	 * closes it, so without the attribute it announced as a non-modal dialog while behaving as a
	 * modal one — a screen reader would offer the page behind it that Tab cannot actually reach. */
	/* data-fs-chrome marks a Zone 1 root, and this one is the reason the mark exists rather than a
	 * class list: the popover is OURS but it is not inside the <nav>, so a fence that named
	 * `.fs-sidebar` protected the menu from openclash's `*{padding:0!important}` and flattened this
	 * dialog in the same document. It hangs off <body> because it is position:fixed and an ancestor
	 * with a transform/filter would re-root it (the sidebar is such an ancestor), so it cannot simply
	 * live in the <nav> and inherit the fence that way. See header.ut for the roots-only rule. */
	const pop = E('div', { 'class': 'fs-appearance-pop', 'data-fs-chrome': '', 'role': 'dialog', 'aria-modal': 'true', 'aria-label': _('Appearance'), 'hidden': '' }, groups);
	document.body.appendChild(pop);

	/* reveal the badge + Update button and mark the trigger (green dot) when a newer release exists.
	 * Runs once per page load, and again when the Updates toggle flips — fs-update.js calls back into
	 * this through onUI(). All of it is skipped when the updater is not installed (no badge, no button,
	 * no check). */
	if (update) {
		const applyUpdateUI = () => {
			if (!update.currentUpdateCheck()) {
				btn.classList.remove('fs-has-update');
				badge.hidden = true; updateBtn.hidden = true;
				return;
			}
			update.check().then((u) => {
				btn.classList.toggle('fs-has-update', !!u.hasUpdate);
				badge.hidden = !u.hasUpdate; updateBtn.hidden = !u.hasUpdate;
				if (u.hasUpdate)
					badge.textContent = _('New version available') + (u.latest ? ' (' + u.latest + ')' : '');
			});
		};
		update.onUI(applyUpdateUI);
		applyUpdateUI();

		updateBtn.addEventListener('click', () => {
			close(false);	/* the modal takes focus from here */
			update.run();
		});
	}

	/* the Save button IS the status: match -> disabled "Saved as default", diverged -> enabled
	 * "Save as default". Called after every axis change (via bump) and on open. */
	function refreshSave() {
		const saved = prefs.matchesSavedDefault();
		saveBtn.disabled = saved;
		saveBtn.textContent = saved ? _('Saved as default', 'footstrap') : _('Save as default', 'footstrap');
	}
	saveBtn.addEventListener('click', () => {
		saveBtn.disabled = true;
		saveErr.hidden = true;
		prefs.saveAsDefault()
			.then(() => { saveErr.hidden = true; })
			/* On failure re-enable (refreshSave, below) so the user can retry. The usual cause is a
			 * stale session, which a reload fixes — so say that. The raw rpc error — the one string
			 * here neither the theme nor LuCI composed — stays in a title tooltip for debugging. */
			.catch((e) => {
				saveErr.textContent = _('Could not save the default. Reload the page and try again.', 'footstrap');
				saveErr.title = String((e && e.message) || e);
				saveErr.hidden = false;
			})
			.finally(refreshSave);
	});
	/* two-click confirm: the first click arms, the second resets — clearing this browser's overrides
	 * and reloading is destructive of local tweaks, and a native confirm() is banned in this UI. */
	let resetArmed = false;
	resetBtn.addEventListener('click', () => {
		if (!resetArmed) {
			resetArmed = true;
			resetBtn.textContent = _('Confirm reset', 'footstrap');
			resetBtn.classList.add('fs-ap-armed');
			return;
		}
		prefs.resetToDefault();
		location.reload();
	});
	refreshSave();	/* correct label/enabled state before the first open */

	/* Clicking outside means the user is going elsewhere — closing must not yank their focus back
	 * to the trigger. Escape and the trigger itself do. */
	function outside(e) { if (!pop.contains(e.target) && !btn.contains(e.target) && e.target !== btn) close(false); }
	function reposition() { widgets.placePopover(btn, pop); }

	/* role="dialog" is a promise about keyboard behaviour the popover was not keeping: focus
	 * stayed on the page behind, Tab walked straight out of the open dialog into the view
	 * underneath, and a click-outside close dropped focus on the floor. */
	const FOCUSABLE = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';
	/* The tab sequence inside the popover, in DOM order. `tabIndex >= 0` is load-bearing, not
	 * belt-and-braces: segControl's radiogroups use a roving tabindex, so an unchecked radio is
	 * still a <button> (i.e. still matches FOCUSABLE) but is NOT in the tab sequence. Counting one
	 * made `first` an element Tab can never land on, so shift+Tab off the checked radio matched no
	 * boundary and walked straight out of the dialog. */
	function tabbables() {
		return [...pop.querySelectorAll(FOCUSABLE)]
			.filter((el) => !el.disabled && el.offsetParent !== null && el.tabIndex >= 0);
	}
	function keydown(e) {
		if (e.key === 'Escape') { close(); return; }
		if (e.key !== 'Tab') return;
		const items = tabbables();
		if (!items.length) return;
		const first = items[0], last = items[items.length - 1];
		/* wrap at both ends so focus cannot leave an open dialog */
		if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
		else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
	}
	function open() {
		pop.hidden = false; btn.setAttribute('aria-expanded', 'true');
		saveErr.hidden = true;	/* a stale save error must not greet the next open */
		refreshSave();	/* the saved default may have changed since this popover was built */
		reposition();
		tabbables()[0]?.focus();	/* the first TABBABLE, so a roving-tabindex group opens on its checked radio */
		document.addEventListener('click', outside, true);
		document.addEventListener('keydown', keydown);
		window.addEventListener('resize', reposition);
		window.addEventListener('scroll', reposition, true);
	}
	function close(returnFocus = true) {
		if (pop.hidden) return;
		pop.hidden = true; btn.setAttribute('aria-expanded', 'false');
		/* disarm a primed Reset, so re-opening never carries a live "Confirm reset" a stray click
		 * would fire */
		if (resetArmed) {
			resetArmed = false;
			resetBtn.textContent = _('Reset to default', 'footstrap');
			resetBtn.classList.remove('fs-ap-armed');
		}
		document.removeEventListener('click', outside, true);
		document.removeEventListener('keydown', keydown);
		window.removeEventListener('resize', reposition);
		window.removeEventListener('scroll', reposition, true);
		if (returnFocus) btn.focus();
	}

	pop.id = 'fs-appearance-pop';
	btn.setAttribute('aria-haspopup', 'dialog');
	btn.setAttribute('aria-expanded', 'false');
	btn.setAttribute('aria-controls', pop.id);
	/* NO stopPropagation here: it is not needed (outside() is registered in the CAPTURE phase and
	 * already excludes clicks on btn) and it broke the sidebar — menu-footstrap.js closes an open
	 * flyout from a BUBBLE-phase click listener on document, which never saw the event, so opening
	 * Appearance from a collapsed rail left the flyout hanging open underneath. */
	btn.addEventListener('click', () => { pop.hidden ? open() : close(); });
}

return baseclass.extend({
	wire
});
