'use strict';
'require baseclass';

/* The menu tree as a ROUTING TABLE: path <-> node, with LuCI's alias/firstchild resolution.
 *
 * Pure lookup — it renders nothing and touches no DOM. Both the chrome (which walks the tree to
 * draw the mode menu and the section tabs) and the SPA router (which asks "what view does this URL
 * open?") need it, and a module they both require is the only way to give them one copy without a
 * cycle: LuCI's require() raises DependencyError on a dependency loop, so the shared half has to
 * come OUT rather than be reached across. */

/* the ACL-filtered tree from /admin/menu, handed over once by the chrome's init() */
let _tree = null;

function setTree(tree) {
	_tree = tree;
}

/* /cgi-bin/luci/admin/status/overview -> ['admin','status','overview'].
 * The bare base (what build_url() emits for the brand wordmark) yields an EMPTY seg list, NOT null:
 * the dispatcher's root node is itself a `firstchild`, so resolveSegs([]) walks to the overview
 * exactly as the server does — returning null made the wordmark un-routable and full-reload. null
 * stays reserved for a path outside LuCI's scriptname. */
function segsFromPath(pathname) {
	const base = L.env.scriptname || '';
	if (base && pathname.indexOf(base) !== 0)
		return null;
	const rest = pathname.slice(base.length).replace(/^\/+|\/+$/g, '');
	return rest.length ? rest.split('/') : [];
}

/* walk the (scrubbed, ACL-filtered) menu tree to the node for a path */
function nodeForSegs(segs) {
	let node = _tree;
	for (let i = 0; i < segs.length; i++) {
		node = node && node.children && node.children[segs[i]];
		if (!node) return null;
	}
	return node;
}

/* ---- alias / firstchild resolution ----
 *
 * 7 of the 27 menu links are redirects, not pages: 4 `alias` (Firewall, System Log, Realtime
 * Graphs) and 3 `firstchild` (Administration, Terminal, Attended Sysupgrade) — i.e. the
 * most-clicked entries were the ones still doing a full load.
 *
 * The server does not redirect them: a full GET of /admin/status/logs answers 200 at that URL and
 * stamps the RESOLVED leaf into requestpath/dispatchpath/nodespec, keeping `pathinfo` as requested.
 * The client must resolve EXACTLY as dispatcher.uc does, or a click and an F5 on the same URL would
 * open different pages — nodeWeight() and firstChildOf() are ports, not approximations. Only the
 * ACL check is skipped: the tree from /admin/menu is already ACL-filtered for this session.
 *
 * `rewrite` is deliberately NOT followed: the tree has none, and a wrong guess at its splice
 * semantics would silently open the WRONG page — worse than the full load it falls back to. */

/* node_weight() from dispatcher.uc: lower wins; a login node sorts last. */
function nodeWeight(node) {
	return Math.min(node.order ?? 9999, 9999) + (node.auth && node.auth.login ? 10000 : 0);
}

/* resolve_firstchild() from dispatcher.uc: the eligible child of lowest weight. Ties go to tree
 * order (the comparison is strict, as upstream's is, and JSON.parse preserves key order). A
 * `firstchild` child is eligible only if it resolves to something itself — recursively. */
function firstChildOf(node) {
	let bestName = null, best = null;
	const kids = node.children || {};
	for (const name in kids) {
		const child = kids[name];
		if (!child.satisfied || !child.title || !child.action || typeof child.action !== 'object')
			continue;
		if (child.action.type === 'firstchild') {
			if ((!best || nodeWeight(best) > nodeWeight(child)) && firstChildOf(child)) {
				best = child; bestName = name;
			}
		} else if (!child.firstchild_ineligible) {
			if (!best || nodeWeight(best) > nodeWeight(child)) {
				best = child; bestName = name;
			}
		}
	}
	return best ? { name: bestName, node: best } : null;
}

/* Follow alias/firstchild to the real page: {segs, node} of the leaf the dispatcher would have
 * rendered, or null when nothing resolves (the server would 404 — let it). The hop cap is a cycle
 * guard: an alias loop in some app's menu.d must not hang the UI. */
function resolveSegs(segs) {
	let node = nodeForSegs(segs);
	for (let hops = 0; node && node.action && hops < 8; hops++) {
		const type = node.action.type;
		if (type === 'alias') {
			segs = String(node.action.path).split('/');
			node = nodeForSegs(segs);
		} else if (type === 'firstchild') {
			const pick = firstChildOf(node);
			if (!pick) return null;
			segs = segs.concat([ pick.name ]);
			node = pick.node;
		} else {
			return { segs, node };
		}
	}
	return null;
}

/* The view class a menu node instantiates, or null if the node isn't SPA-able. The Status→Overview
 * `template` node maps to view.status.index (its server template just instantiates that — see
 * ensureOverviewHelpers in fs-router.js). Shared by navigate() and the hover prefetch. */
function viewClassFor(node) {
	if (!node || !node.action || node.satisfied === false)
		return null;
	if (node.action.type === 'view')
		return 'view.' + String(node.action.path).replace(/\//g, '.');
	if (node.action.type === 'template' && node.action.path === 'admin_status/index')
		return 'view.status.index';
	return null;
}

/* The node the CURRENT full-load landed on, i.e. what L.env.dispatchpath points at. */
function currentNode() {
	return nodeForSegs(L.env.dispatchpath || []);
}

return baseclass.extend({
	setTree,
	tree: () => _tree,
	segsFromPath,
	nodeForSegs,
	currentNode,
	nodeWeight,
	firstChildOf,
	resolveSegs,
	viewClassFor
});
