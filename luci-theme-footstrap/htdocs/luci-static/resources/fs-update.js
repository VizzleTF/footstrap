'use strict';
'require baseclass';
'require ui';
'require fs-prefs as prefs';

/* ---- theme version + update check + the one-click self-update ----
 * FS_VERSION is stamped at build/deploy: the package Makefile (Build/Prepare) and dev-sync.sh
 * rewrite the '0.0.0-dev' literal below — BY FILE NAME, so this constant cannot move to another
 * file without changing both. An unstamped source checkout stays 'dev' and skips the check.
 *
 * The ROUTER asks GitHub, not the browser (`footstrap-selfupdate.sh check`, the ACL-gated script
 * the Update button runs): a LAN client often has no route to the internet while the router does,
 * and it keeps the check off the user's own IP rate limit. Cached an hour by the script, memoised
 * here per page load. Fails silent: no reachable API → no badge, the version still shows.
 *
 * The Appearance popover (fs-appearance.js) presents this; the DOM lives there, the machinery here.
 * The SPA router (fs-router.js) calls cancel() on every navigation — see _updGen below. */
const FS_VERSION = '0.0.0-dev';
const FS_REPO = 'VizzleTF/luci-theme-footstrap';
const FS_UPDATE_SCRIPT = '/usr/libexec/footstrap-selfupdate.sh';
let _fsUpdatePromise = null;

/* the self-update poll chain reschedules with a raw setTimeout (only setInterval is hooked by the
 * router), so navigate() must be able to cancel it — or it keeps firing fs.exec RPCs and can pop
 * its modal onto an unrelated page.
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
 * off means no network call, no badge/dot. */
function currentUpdateCheck() { return prefs.lsGet('fs-update-check') !== 'off'; }
function applyUpdateCheck(val) {
	/* the badge/dot cleanup happens in the popover's applyUpdateUI, invoked via _onUI below */
	if (val === 'off') prefs.lsSet('fs-update-check', 'off');
	else prefs.lsDel('fs-update-check');
	/* re-evaluate so turning it back on within the same session shows the state */
	_fsUpdatePromise = null;
	if (typeof _onUI == 'function') _onUI();
}

/* The parentheses around the regex are load-bearing — do not "tidy" them away. luci.mk minifies
 * this file with jsmin, whose regex-vs-division test is a ONE-character lookback against a fixed
 * allow-list. `n` (the last letter of `return`) is not on it, so `return /re/` is read as a
 * division and the regex's `//` swallows the rest of the file — exiting 0 (openwrt/luci#8299).
 * `(` IS on the allow-list. tools/jsmin-verify.mjs is the gate; this is the fix. */
function fsVersionReal() { return ((/^\d+\.\d+/).test(FS_VERSION)) && FS_VERSION !== '0.0.0-dev'; }
function fsParseVer(s) { return String(s).replace(/^v/, '').split(/[.\-+]/).map(n => parseInt(n, 10) || 0); }
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
	if (!fsVersionReal() || !currentUpdateCheck())
		return (_fsUpdatePromise = Promise.resolve({ current: FS_VERSION, latest: null, hasUpdate: false }));
	_fsUpdatePromise = window.L.require('fs')	/* window.L, not the module L — the two-L trap, docs/14 */
		.then(fs => fs.exec(FS_UPDATE_SCRIPT, [ 'check' ]))
		.then(res => {
			/* "v1.2.3" on success; "ERR: …" when the router could not reach the API, or
			 * "ERR: unknown argument" from a backend older than this JS. All three: no badge. */
			const out = String((res && res.stdout) || '').trim();
			const latest = (/^v?\d/).test(out) ? out : null;
			return { current: FS_VERSION, latest, hasUpdate: !!(latest && fsVerCmp(latest, FS_VERSION) > 0) };
		})
		.catch(() => ({ current: FS_VERSION, latest: null, hasUpdate: false }));
	return _fsUpdatePromise;
}

/* one-click self-update: confirm, then run the ACL-gated backend via fs.exec, which installs the
 * latest release with apk (25.12) or opkg (24.10) and reloads the page. No user input reaches the
 * script — the ACL grants exec of that fixed path only and the arguments below are literals.
 *
 * The install outlives the RPC path: rpc.js aborts the XHR after `L.env.rpctimeout` (20 s) and
 * rpcd kills the exec'd process after its own `timeout` (30 s). So the script spawns a detached
 * worker and returns STARTED; we poll `status` until it flips to OK or ERR. */
const FS_UPDATE_POLL_MS = 2000;
const FS_UPDATE_LIMIT_MS = 300000;

function runSelfUpdate() {
	/* Everything below belongs to THIS run. navigate() bumps _updGen via cancel(), so a resolved
	 * RPC from a run the user has navigated away from does nothing instead of rescheduling itself
	 * and popping a modal over the new page. */
	const gen = ++_updGen;
	const stale = () => gen !== _updGen;
	const modal = (body) => { if (!stale()) ui.showModal(_('Update Footstrap'), body); };
	/* The message is an ARRAY child, and that is not a style choice: dom.append() assigns a
	 * BARE STRING child via `node.innerHTML`, and only an array becomes a text node. What
	 * lands here is raw installer output (`ERR: install failed: <apk/opkg stderr>`) plus RPC
	 * exception text — the one string in this theme neither the theme nor LuCI composed.
	 * Markup in it would be parsed. */
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

	/* The update no longer logs you out — postinst does `rpcd reload` (SIGHUP; re-reads the ACL
	 * dir, all this package needs) instead of `rpcd restart`, which destroys every in-memory
	 * session. Keep the branch anyway: an expired session arriving after the installer ran means
	 * the package DID install (postinst is the last thing to run), and "sign in again" is the
	 * right answer whatever killed it — a hand-rolled rpcd restart, a luci-base upgrade
	 * alongside, a reboot. The reload also re-fetches the cache-busted CSS/JS. */
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

		return fs.exec(FS_UPDATE_SCRIPT, [ 'status' ]).then(res => {
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
			/* RUNNING, or IDLE if the worker has not written the file yet. Tracked in
			 * _updTimer so navigate() can cancel the chain. */
			_updTimer = window.setTimeout(() => poll(fs, deadline), FS_UPDATE_POLL_MS);
		}).catch(e => {
			if (stale()) return;
			return sessionGone(e && e.message || e) ? relogin() : fail(e && e.message || e);
		});
	}

	function doUpdate() {
		modal([ E('p', { 'class': 'spinning' }, _('Downloading and installing…')) ]);
		window.L.require('fs')
			.then(fs => fs.exec(FS_UPDATE_SCRIPT).then(res => {
				if (stale()) return;
				const out = String((res && res.stdout) || '').trim();
				if (!(/^(STARTED|RUNNING)$/).test(out))
					return fail((res && (res.stderr || res.stdout)) || '');
				poll(fs, Date.now() + FS_UPDATE_LIMIT_MS);
			}))
			.catch(e => { if (!stale()) fail(e && e.message || e); });
	}
}

return baseclass.extend({
	REPO_URL: 'https://github.com/' + FS_REPO,
	LATEST_URL: 'https://github.com/' + FS_REPO + '/releases/latest',
	/* what the popover's footer prints */
	versionLabel: () => (fsVersionReal() ? ('Footstrap v' + FS_VERSION) : 'Footstrap (dev)'),

	currentUpdateCheck,
	applyUpdateCheck,
	check: checkFootstrapUpdate,
	onUI,
	run: runSelfUpdate,
	cancel
});
