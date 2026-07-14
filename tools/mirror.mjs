#!/usr/bin/env node
/* @mirror — turn duplication you cannot delete into duplication that cannot ROT.
 *
 * Some duplication is forced, not chosen: CSS cannot share a declaration block across two
 * mutually-exclusive guards (the stacked table's card layout is needed under a CLASS —
 * .fs-stacked, the measured data table — AND under a CONTAINER QUERY: the config table, which
 * cannot be measured, see fs-select.js); and `install.sh` is fetched with `curl | sh` and runs
 * BEFORE the package exists, so it cannot source a library shipping inside the package — yet it
 * must do exactly what `footstrap-selfupdate.sh` does (fetch over a verified channel, pin the
 * asset host, check the sha256).
 *
 * THE TRAP, and the reason for this tool: a structural duplicate detector (tools/css-dup.mjs)
 * matches bodies that are IDENTICAL, so the moment two copies diverge it goes QUIET — exactly
 * when it should shout. Not hypothetical: `fetch()` in install.sh and footstrap-selfupdate.sh
 * had ALREADY drifted three ways (different backend order, one with no timeout on its
 * first-choice tool, one missing the https redirect pin) and nothing said a word. So: tag every
 * copy, assert they stay byte-identical.
 *
 *   shell / JS:   # @mirror <group>/<role>      …lines…      # @endmirror
 *   CSS:          /* @mirror <group>/<role> *\/  …rule…      /* @endmirror *\/
 *
 * Comparison ignores common leading indent and trailing whitespace (a copy may nest deeper);
 * everything else must match. A group with only ONE copy is an error too: a mirror of one is a
 * tag someone forgot to delete when the other copy died, and it enforces nothing.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/* Whole FILES pinned byte-identical — the same argument one level up: duplication a tool forces
 * on you, made un-rottable. The Apache-2.0 text must exist twice and neither copy can go:
 *   LICENSE                        — the repo root, the only place GitHub looks
 *   luci-theme-footstrap/LICENSE   — the PACKAGE: PKG_LICENSE_FILES resolves against
 *                                    $(PKG_BUILD_DIR), into which luci.mk copies only the
 *                                    package source dirs; CI rsyncs only the package dir into
 *                                    the SDK, so the root file is unreachable from $(CURDIR).
 * A licence text cannot carry an @mirror comment without ceasing to be the licence text. */
const SAME_FILE = [
	['LICENSE', 'luci-theme-footstrap/LICENSE'],
];

/* Where a mirror may live. Explicit on purpose: a mirror is a decision, and a glob picking up a
 * new tree would let one appear without anybody choosing it. */
const SEARCH = [
	'luci-theme-footstrap/styles',
	'luci-theme-footstrap/root',
	'luci-theme-footstrap/htdocs/luci-static/resources',
	'luci-theme-footstrap/Makefile',
	'install.sh',
];
const EXT = /\.(css|js|sh|ut)$|(^|\/)(Makefile|30_luci-theme-footstrap)$/;

const files = [];
for (const s of SEARCH) {
	const p = join(ROOT, s);
	(function walk(f) {
		const st = statSync(f);
		if (st.isDirectory()) { for (const e of readdirSync(f)) walk(join(f, e)); return; }
		if (EXT.test(f)) files.push(f);
	})(p);
}

/* `@mirror name` opens, `@endmirror` closes. The tag may sit inside any comment syntax — we
 * match the token only, and the closing line is not part of the body. */
const OPEN = /@mirror\s+([A-Za-z0-9_-]+\/[A-Za-z0-9_-]+)/;
const CLOSE = /@endmirror/;

const groups = new Map();		/* "group/role" -> [{file, line, body}] */
const errors = [];

for (const f of files) {
	const lines = readFileSync(f, 'utf8').split('\n');
	let open = null;
	for (let i = 0; i < lines.length; i++) {
		const m = lines[i].match(OPEN);
		if (m) {
			if (open) errors.push(`${rel(f)}:${i + 1}: @mirror ${m[1]} opened while ${open.name} is still open`);
			open = { name: m[1], line: i + 1, body: [] };
			continue;
		}
		if (CLOSE.test(lines[i])) {
			if (!open) { errors.push(`${rel(f)}:${i + 1}: @endmirror with no open @mirror`); continue; }
			if (!groups.has(open.name)) groups.set(open.name, []);
			groups.get(open.name).push({ file: rel(f), line: open.line, body: normalise(open.body) });
			open = null;
			continue;
		}
		if (open) open.body.push(lines[i]);
	}
	if (open) errors.push(`${rel(f)}:${open.line}: @mirror ${open.name} is never closed (@endmirror)`);
}

function rel(f) { return relative(ROOT, f); }

/* Strip common leading indent and trailing whitespace: a block nested one level deeper in one
 * file is not a divergence. */
function normalise(body) {
	const kept = body.filter(l => l.trim() !== '');
	if (!kept.length) return '';
	const indent = Math.min(...kept.map(l => l.match(/^[ \t]*/)[0].length));
	return kept.map(l => l.slice(indent).replace(/\s+$/, '')).join('\n');
}

/* whole-file pins (see SAME_FILE) */
for (const [a, b] of SAME_FILE) {
	let ta, tb;
	try { ta = readFileSync(join(ROOT, a)); } catch { errors.push(`@same-file: ${a} is missing`); continue; }
	try { tb = readFileSync(join(ROOT, b)); } catch { errors.push(`@same-file: ${b} is missing`); continue; }
	if (!ta.equals(tb))
		errors.push(`@same-file: ${a} and ${b} have DRIFTED apart — they must be byte-identical ` +
			`(${ta.length} vs ${tb.length} bytes).`);
	else
		console.log(`  ok   @same-file ${a} == ${b}   (${ta.length} bytes)`);
}

let bad = 0;
const names = [...groups.keys()].sort();
for (const name of names) {
	const copies = groups.get(name);
	if (copies.length < 2) {
		errors.push(`@mirror ${name}: only ONE copy (${copies[0].file}:${copies[0].line}). ` +
			`A mirror of one enforces nothing — delete the tag, or restore the copy it was pinning.`);
		bad++;
		continue;
	}
	const first = copies[0];
	const drifted = copies.filter(c => c.body !== first.body);
	if (drifted.length) {
		bad++;
		errors.push(`@mirror ${name}: the copies have DRIFTED apart.`);
		for (const c of copies)
			errors.push(`    ${c.file}:${c.line}${c.body === first.body ? '' : '   <-- differs'}`);
		/* show the first differing line, so the failure is actionable */
		const a = first.body.split('\n'), b = drifted[0].body.split('\n');
		for (let i = 0; i < Math.max(a.length, b.length); i++) {
			if (a[i] !== b[i]) {
				errors.push(`    first difference at body line ${i + 1}:`);
				errors.push(`      ${first.file}: ${a[i] ?? '(end of block)'}`);
				errors.push(`      ${drifted[0].file}: ${b[i] ?? '(end of block)'}`);
				break;
			}
		}
	} else {
		console.log(`  ok   @mirror ${name.padEnd(22)} ${copies.length} copies, byte-identical   ` +
			copies.map(c => `${c.file}:${c.line}`).join('  '));
	}
}

if (!names.length) console.log('  (no @mirror groups found)');

if (errors.length) {
	console.error('\nFAIL: @mirror');
	for (const e of errors) console.error('  ' + e);
	console.error('\nA @mirror block is duplication the language forces on you. The tag is the promise');
	console.error('that the copies stay identical; this is what keeps that promise. Fix the copies —');
	console.error('or, if they are genuinely meant to differ now, they were never a mirror: untag them');
	console.error('and write down why they diverged.');
	process.exit(1);
}

console.log(`\n@mirror: ${names.length} group(s), every copy byte-identical.`);
