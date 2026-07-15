'use strict';
'require baseclass';
'require fs-prefs as prefs';
'require fs-widgets as widgets';
'require fs-update as update';

/* The Appearance popover: the DOM that presents the axes. It owns no preference and no update
 * machinery — fs-prefs.js holds the axes, fs-update.js the version check and the installer; this
 * file is the dialog they are shown in. */

function wireAppearance() {
	const btn = document.getElementById('fs-appearance');
	if (!btn) return;

	/* every saved axis re-checks the Save button after it applies, so the button greys the moment
	 * this browser matches the saved default again and un-greys the moment it diverges. Wrapped
	 * around the appliers because the seg/slider controls call them directly and have no other seam
	 * back to here. refreshSave is a hoisted function declaration; saveBtn it reads is assigned
	 * below, before any of these fire (all are user events). */
	const bump = fn => v => { fn(v); refreshSave(); };

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
		E('div', { 'class': 'fs-ap-group' }, [
			E('div', { 'class': 'fs-ap-label' }, [ _('Layout', 'footstrap') ]),
			widgets.segControl(prefs.currentLayout(), [
				{ val: 'sidebar', label: _('Sidebar', 'footstrap') },
				{ val: 'top',     label: _('Top', 'footstrap') }
			], bump(prefs.applyLayout), _('Layout', 'footstrap'))
		]),
		E('div', { 'class': 'fs-ap-group' }, [
			E('div', { 'class': 'fs-ap-label' }, [ _('Theme', 'footstrap') ]),
			widgets.segControl(prefs.currentMode(), [
				{ val: 'auto',  label: _('Auto', 'footstrap') },
				{ val: 'light', label: _('Light', 'footstrap') },
				{ val: 'dark',  label: _('Dark', 'footstrap') }
			], bump(prefs.applyMode), _('Theme', 'footstrap'))
		]),
		E('div', { 'class': 'fs-ap-group' }, [
			E('div', { 'class': 'fs-ap-label' }, [ _('Palette', 'footstrap') ]),
			widgets.segControl(prefs.currentPalette(), [
				{ val: 'footstrap',  label: 'Footstrap' },
				{ val: 'hicontrast', label: 'Hi-Contrast' }
			], bump(prefs.applyPalette), _('Palette', 'footstrap'))
		]),
		E('div', { 'class': 'fs-ap-group' }, [
			E('div', { 'class': 'fs-ap-label' }, [ _('Wallpaper', 'footstrap') ]),
			widgets.segControl(prefs.currentWallpaper(), [
				{ val: 'off',  label: _('Off', 'footstrap') },
				{ val: 'cats', label: _('Cats', 'footstrap') }
			], bump(prefs.applyWallpaper), _('Wallpaper', 'footstrap'))
		]),
		E('div', { 'class': 'fs-ap-group' }, [
			/* the caption says what the axis is FOR: "Tint" alone reads as decoration and
			 * nobody would look for the router-identity cue under it */
			E('div', { 'class': 'fs-ap-label' }, [ _('Tint (router identification)', 'footstrap') ]),
			/* step 5 = 72 hues, which is finer than anyone can name and coarse enough
			 * that the same router lands on the same colour when it is set again. */
			widgets.sliderControl(prefs.currentTint(), 0, 360, bump(prefs.applyTint), _('Tint (router identification)', 'footstrap'), {
				step: 5,
				cls: 'fs-range-hue',
				fmt: v => (v ? v + '°' : _('Off', 'footstrap'))
			})
		]),
		E('div', { 'class': 'fs-ap-group' }, [
			E('div', { 'class': 'fs-ap-label' }, [ _('Accent', 'footstrap') ]),
			/* recolours the accented CONTROLS (buttons/toggles/sliders/focus rings), not
			 * the canvas the way Tint does — same hue slider, off at 0 = palette default */
			widgets.sliderControl(prefs.currentAccent(), 0, 360, bump(prefs.applyAccent), _('Accent', 'footstrap'), {
				step: 5,
				cls: 'fs-range-hue fs-range-accent',
				fmt: v => (v ? v + '°' : _('Off', 'footstrap'))
			})
		]),
		E('div', { 'class': 'fs-ap-group' }, [
			E('div', { 'class': 'fs-ap-label' }, [ _('Rounding', 'footstrap') ]),
			widgets.sliderControl(prefs.currentRadius(), 0, 20, bump(prefs.applyRadius), _('Rounding', 'footstrap'))
		])
	];

	/* The top layout has no accordion (its sections are hover dropdowns, already exclusive), so this
	 * switch is meaningless there. ALWAYS BUILT, HIDDEN BY CSS (:root[data-layout="top"]
	 * .fs-ap-submenus, theme/20-shell.css). Do NOT put an `if (currentLayout() !== 'top')` around the
	 * push: the popover is built ONCE, in init(), so the branch froze the control to the layout the
	 * PAGE LOADED in — it stayed on screen after a switch to the bar, and never appeared after a
	 * switch away from it. Toggling the layout re-renders nothing; CSS morphs the chrome. */
	groups.push(E('div', { 'class': 'fs-ap-group fs-ap-submenus' }, [
		E('div', { 'class': 'fs-ap-label' }, [ _('Submenus', 'footstrap') ]),
		widgets.segControl(prefs.currentAutoCollapse() ? 'on' : 'off', [
			{ val: 'off', label: _('Keep open', 'footstrap') },
			{ val: 'on',  label: _('Auto-collapse', 'footstrap') }
		], bump(prefs.applyAutoCollapse), _('Submenus', 'footstrap'))
	]));

	/* version line + "new version" badge + one-click Update button (the last two
	 * are revealed by the update check below when a newer release exists). */
	const badge = E('a', {
		'class': 'fs-ap-badge', 'hidden': '',
		'href': update.LATEST_URL,
		'target': '_blank', 'rel': 'noopener'
	}, [ _('New version available') ]);
	const updateBtn = E('button', { 'class': 'fs-ap-update', 'type': 'button', 'hidden': '' }, [ _('Update now') ]);

	/* opt-out toggle for the update check */
	groups.push(E('div', { 'class': 'fs-ap-group' }, [
		E('div', { 'class': 'fs-ap-label' }, [ _('Updates', 'footstrap') ]),
		widgets.segControl(update.currentUpdateCheck() ? 'on' : 'off', [
			{ val: 'on',  label: _('Check', 'footstrap') },
			{ val: 'off', label: _('Off', 'footstrap') }
		], update.applyUpdateCheck, _('Updates', 'footstrap'))
	]));

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
	const resetBtn = E('button', { 'class': 'btn', 'type': 'button' }, [ _('Reset', 'footstrap') ]);
	groups.push(E('div', { 'class': 'fs-ap-group fs-ap-actions' }, [
		E('div', { 'class': 'fs-ap-label' }, [ _('Router default', 'footstrap') ]),
		E('div', { 'class': 'fs-ap-actrow' }, [ saveBtn, resetBtn ])
	]));

	groups.push(E('div', { 'class': 'fs-ap-footer' }, [
		E('div', { 'class': 'fs-ap-verrow' }, [
			E('a', {
				'class': 'fs-ap-version',
				'href': update.REPO_URL,
				'target': '_blank',
				'rel': 'noopener noreferrer'
			}, [ update.versionLabel() ]),
			badge
		]),
		updateBtn
	]));

	const pop = E('div', { 'class': 'fs-appearance-pop', 'role': 'dialog', 'aria-label': _('Appearance'), 'hidden': '' }, groups);
	document.body.appendChild(pop);

	/* reveal the badge + Update button and mark the trigger (green dot) when a newer release
	 * exists. Runs once per page load, and again when the Updates toggle flips — fs-update.js
	 * calls back into this through onUI(). */
	function applyUpdateUI() {
		if (!update.currentUpdateCheck()) {
			btn.classList.remove('fs-has-update');
			badge.hidden = true; updateBtn.hidden = true;
			return;
		}
		update.check().then(u => {
			btn.classList.toggle('fs-has-update', !!u.hasUpdate);
			badge.hidden = !u.hasUpdate; updateBtn.hidden = !u.hasUpdate;
			if (u.hasUpdate)
				badge.textContent = _('New version available') + (u.latest ? ' (' + u.latest + ')' : '');
		});
	}
	update.onUI(applyUpdateUI);
	applyUpdateUI();

	updateBtn.addEventListener('click', () => {
		close(false);	/* the modal takes focus from here */
		update.run();
	});

	/* the Save button IS the status: match -> disabled "Saved as default", diverged -> enabled
	 * "Save as default". Called after every axis change (via bump) and on open. */
	function refreshSave() {
		const saved = prefs.matchesSavedDefault();
		saveBtn.disabled = saved;
		saveBtn.textContent = saved ? _('Saved as default', 'footstrap') : _('Save as default', 'footstrap');
	}
	saveBtn.addEventListener('click', () => {
		saveBtn.disabled = true;
		prefs.saveAsDefault()
			.then(() => { saveBtn.removeAttribute('title'); })
			/* no status text (only two buttons) — on failure re-enable so the user can retry, and
			 * park the rpc error in a title tooltip for debugging. An rpc error string is the one
			 * string here neither the theme nor LuCI composed; a title attribute never parses it. */
			.catch((e) => { saveBtn.title = _('Could not save the default.', 'footstrap') + ' ' + String((e && e.message) || e); })
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
	function keydown(e) {
		if (e.key === 'Escape') { close(); return; }
		if (e.key !== 'Tab') return;
		const items = [...pop.querySelectorAll(FOCUSABLE)].filter((el) => !el.disabled && el.offsetParent !== null);
		if (!items.length) return;
		const first = items[0], last = items[items.length - 1];
		/* wrap at both ends so focus cannot leave an open dialog */
		if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
		else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
	}
	function open() {
		pop.hidden = false; btn.setAttribute('aria-expanded', 'true');
		refreshSave();	/* the saved default may have changed since this popover was built */
		reposition();
		pop.querySelector(FOCUSABLE)?.focus();
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
			resetBtn.textContent = _('Reset', 'footstrap');
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
	wire: wireAppearance
});
