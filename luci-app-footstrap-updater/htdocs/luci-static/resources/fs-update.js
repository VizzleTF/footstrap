'use strict';
'require baseclass';
'require ui';
'require fs-prefs as prefs';
'require fs-version as ver';
'require fs-router as router';

/* ---- the GitHub update check + the one-click self-update ----
 *
 * THIS FILE SHIPS IN THE OPTIONAL luci-app-footstrap-updater PACKAGE, not in the theme. The theme
 * loads it at runtime with L.require('fs-update') and lights up the Appearance popover's update rows
 * only when the require resolves — a router without the updater installed simply shows its version
 * (from fs-version.js, which is the theme's) and no update controls. So nothing here may be
 * statically required by a theme module: that would turn a missing updater into a DependencyError
 * that takes out the whole chrome.
 *
 * The version to compare against comes from the THEME (ver.VERSION, fs-version.js): the updater
 * updates the theme, so the theme's installed version is what the latest release is measured against.
 *
 * The ROUTER asks GitHub, not the browser (`footstrap-selfupdate.sh check`, the ACL-gated script the
 * Update button runs): a LAN client often has no route to the internet while the router does, and it
 * keeps the check off the user's own IP rate limit. Cached an hour by the script, memoised here per
 * page load. Fails silent: no reachable API → no badge, the version still shows.
 *
 * The Appearance popover (the theme's fs-appearance.js) presents this; the DOM lives there, the
 * machinery here. Navigation cancels the poll chain: the SPA router (fs-router.js) has no static
 * dependency on this optional module, so instead of the router reaching in, THIS module registers
 * cancel() with router.onNavigate() below. */
const FS_UPDATE_SCRIPT = '/usr/libexec/footstrap-selfupdate.sh';
const LATEST_URL = 'https://github.com/' + ver.REPO + '/releases/latest';
let _fsUpdatePromise = null;

/* the self-update poll chain reschedules with a raw setTimeout (only setInterval is hooked by the
 * router), so navigation must be able to cancel it — or it keeps firing fs.exec RPCs and can pop its
 * modal onto an unrelated page.
 *
 * ...and clearing the timer is not enough: if an fs.exec('status') is ALREADY in flight when the
 * user navigates (rpctimeout is 20 s, so the window is wide) there is no timer to clear, and on
 * resolve it reschedules the chain and throws its modal over the new page. The generation token
 * kills the chain at the point where it would resurrect itself. */
let _updTimer = null;
let _updGen = 0;

function cancel() {
	if (_updTimer) { window.clearTimeout(_updTimer); _updTimer = null; }
	_updGen++;	/* and disown any fs.exec already in flight */
}

/* The popover registers its badge/button refresh here, so the Updates toggle below can re-run it
 * without reaching across into the DOM the popover owns. It used to be parked on
 * `window.__fsUpdateApply`, i.e. a global anyone could clobber, for want of a seam. */
let _onUI = null;
function onUI(fn) { _onUI = fn; }

/* opt-out toggle for the GitHub update check (Appearance -> Updates). Default on;
 * off means no network call, no badge/dot. The key lives with the updater it switches off. */
function currentUpdateCheck() { return prefs.lsGet('fs-update-check') !== 'off'; }
function applyUpdateCheck(val) {
	/* the badge/dot cleanup happens in the popover's applyUpdateUI, invoked via _onUI below */
	if (val === 'off') prefs.lsSet('fs-update-check', 'off');
	else prefs.lsDel('fs-update-check');
	/* re-evaluate so turning it back on within the same session shows the state */
	_fsUpdatePromise = null;
	if (typeof _onUI === 'function') _onUI();
}

function fsParseVer(s) { return String(s).replace(/^v/, '').split(/[.\-+]/).map((n) => parseInt(n, 10) || 0); }
function fsVerCmp(a, b) {
	a = fsParseVer(a); b = fsParseVer(b);
	for (let i = 0; i < Math.max(a.length, b.length); i++) {
		const d = (a[i] || 0) - (b[i] || 0);
		if (d) return d > 0 ? 1 : -1;
	}
	return 0;
}
function checkFootstrapUpdate() {
	if (_fsUpdatePromise) return _fsUpdatePromise;
	if (!ver.isReal() || !currentUpdateCheck())
		return (_fsUpdatePromise = Promise.resolve({ current: ver.VERSION, latest: null, hasUpdate: false }));
	_fsUpdatePromise = window.L.require('fs')	/* window.L, not the module L — the two-L trap, docs/14 */
		.then((fs) => fs.exec(FS_UPDATE_SCRIPT, [ 'check' ]))
		.then((res) => {
			/* "v1.2.3" on success; "ERR: …" when the router could not reach the API, or
			 * "ERR: unknown argument" from a backend older than this JS. All three: no badge. */
			const out = String((res && res.stdout) || '').trim();
			const latest = (/^v?\d/).test(out) ? out : null;
			return { current: ver.VERSION, latest, hasUpdate: !!(latest && fsVerCmp(latest, ver.VERSION) > 0) };
		})
		.catch(() => ({ current: ver.VERSION, latest: null, hasUpdate: false }));
	return _fsUpdatePromise;
}

/* one-click self-update: confirm, then run the ACL-gated backend via fs.exec, which installs the
 * latest release (theme AND updater) with apk (25.12) or opkg (24.10) and reloads the page. No user
 * input reaches the script — the ACL grants exec of that fixed path only and the arguments below are
 * literals.
 *
 * The install outlives the RPC path: rpc.js aborts the XHR after `L.env.rpctimeout` (20 s) and rpcd
 * kills the exec'd process after its own `timeout` (30 s). So the script spawns a detached worker and
 * returns STARTED; we poll `status` until it flips to OK or ERR. */
const FS_UPDATE_POLL_MS = 2000;
const FS_UPDATE_LIMIT_MS = 300000;

function runSelfUpdate() {
	/* Everything below belongs to THIS run. navigation bumps _updGen via cancel(), so a resolved RPC
	 * from a run the user has navigated away from does nothing instead of rescheduling itself and
	 * popping a modal over the new page. */
	const gen = ++_updGen;
	const stale = () => gen !== _updGen;
	const modal = (body) => { if (!stale()) ui.showModal(_('Update Footstrap'), body); };
	/* The message is an ARRAY child, and that is not a style choice: dom.append() assigns a BARE
	 * STRING child via `node.innerHTML`, and only an array becomes a text node. What lands here is raw
	 * installer output (`ERR: install failed: <apk/opkg stderr>`) plus RPC exception text — the one
	 * string in this UI neither the theme nor LuCI composed. Markup in it would be parsed. */
	const fail = (msg) => modal([
		E('p', {}, [ _('Update failed') + ': ' + String(msg || _('unknown error')).replace(/^ERR:\s*/, '').trim() ]),
		E('div', { 'class': 'right' }, E('button', { 'class': 'btn', 'click': ui.hideModal }, _('Close')))
	]);
	modal([
		E('p', {}, _('Download and install the latest Footstrap release from GitHub? The page reloads when done.')),
		E('div', { 'class': 'right' }, [
			E('button', { 'class': 'btn', 'click': ui.hideModal }, _('Cancel')), ' ',
			E('button', { 'class': 'btn cbi-button-action', 'click': doUpdate }, _('Update'))
		])
	]);

	/* The update no longer logs you out — postinst does `rpcd reload` (SIGHUP; re-reads the ACL dir,
	 * all these packages need) instead of `rpcd restart`, which destroys every in-memory session.
	 * Keep the branch anyway: an expired session arriving after the installer ran means the package
	 * DID install (postinst is the last thing to run), and "sign in again" is the right answer
	 * whatever killed it — a hand-rolled rpcd restart, a luci-base upgrade alongside, a reboot. The
	 * reload also re-fetches the cache-busted CSS/JS. */
	const sessionGone = (m) =>
		(/session is expired|Access denied|-32002|\b403\b/i).test(String(m));
	const relogin = () => modal([
		E('p', {}, _('Update installed. The router restarted its session service, so you have been logged out — sign in again to load the new theme.')),
		E('div', { 'class': 'right' }, E('button', {
			'class': 'btn cbi-button-action',
			'click': () => location.reload()
		}, _('Log in again')))
	]);

	function poll(fs, deadline) {
		if (stale()) return;
		if (Date.now() > deadline)
			return fail(_('timed out waiting for the installer'));

		return fs.exec(FS_UPDATE_SCRIPT, [ 'status' ]).then((res) => {
			/* the RPC was in flight while the user navigated: drop it on the floor */
			if (stale()) return;
			const out = String((res && res.stdout) || '').trim();
			if ((/^OK$/).test(out)) {
				modal([ E('p', {}, _('Updated. Reloading…')) ]);
				window.setTimeout(() => location.reload(), 1200);
				return;
			}
			if ((/^ERR:/).test(out))
				return fail(out);
			/* RUNNING, or IDLE if the worker has not written the file yet. Tracked in _updTimer so
			 * navigation can cancel the chain. */
			_updTimer = window.setTimeout(() => poll(fs, deadline), FS_UPDATE_POLL_MS);
		}).catch((e) => {
			if (stale()) return;
			return sessionGone((e && e.message) || e) ? relogin() : fail((e && e.message) || e);
		});
	}

	function doUpdate() {
		modal([ E('p', { 'class': 'spinning' }, _('Downloading and installing…')) ]);
		window.L.require('fs')
			.then((fs) => fs.exec(FS_UPDATE_SCRIPT).then((res) => {
				if (stale()) return;
				const out = String((res && res.stdout) || '').trim();
				if (!(/^(STARTED|RUNNING)$/).test(out))
					return fail((res && (res.stderr || res.stdout)) || '');
				poll(fs, Date.now() + FS_UPDATE_LIMIT_MS);
			}))
			.catch((e) => { if (!stale()) fail((e && e.message) || e); });
	}
}

/* Navigation must kill a live poll chain. The router carries no static dependency on this optional
 * module (that would make a missing updater a DependencyError), so the edge runs the other way: this
 * module, once loaded, registers its cancel with the router. cancel() is idempotent, so a single
 * registration covers every run. */
router.onNavigate(cancel);

return baseclass.extend({
	LATEST_URL,
	currentUpdateCheck,
	applyUpdateCheck,
	check: checkFootstrapUpdate,
	onUI,
	run: runSelfUpdate,
	cancel
});
