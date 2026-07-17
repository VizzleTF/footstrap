'use strict';
'require baseclass';

/* ---- theme identity: the version footstrap SHIPS, and the repo it came from ----
 *
 * Shown in the Appearance popover's footer with NO network call and NO dependency on the optional
 * updater package (luci-app-footstrap-updater): a router that never installed the updater still sees
 * its own version and the repo link. This module is why the version can show while the whole update
 * machinery is a separate package the theme merely loads at runtime when present.
 *
 * FS_VERSION is stamped at build/deploy: the theme Makefile (Build/Prepare) and dev-sync.sh rewrite
 * the '0.0.0-dev' literal below — BY FILE NAME, so this constant cannot move to another file without
 * changing both seds. An unstamped source checkout stays 'dev'. The updater's fs-update.js reads
 * VERSION back from here to compare against the latest GitHub release. */
const FS_VERSION = '0.0.0-dev';
const FS_REPO = 'VizzleTF/luci-theme-footstrap';

/* The parentheses around the regex are load-bearing — do not "tidy" them away. luci.mk minifies
 * this file with jsmin, whose regex-vs-division test is a ONE-character lookback against a fixed
 * allow-list. `n` (the last letter of `return`) is not on it, so `return /re/` is read as a
 * division and the regex's `//` swallows the rest of the file — exiting 0 (openwrt/luci#8299). */
function isReal() { return ((/^\d+\.\d+/).test(FS_VERSION)) && FS_VERSION !== '0.0.0-dev'; }

return baseclass.extend({
	VERSION: FS_VERSION,
	REPO: FS_REPO,
	REPO_URL: 'https://github.com/' + FS_REPO,
	isReal,
	/* what the popover's version row prints */
	label: () => (isReal() ? ('Footstrap v' + FS_VERSION) : 'Footstrap (dev)')
});
