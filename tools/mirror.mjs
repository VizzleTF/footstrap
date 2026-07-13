#!/usr/bin/env node
/* @mirror — enforce that duplication you cannot delete is duplication that cannot ROT.
 *
 * WHY THIS EXISTS
 * ---------------
 * Some duplication in this project is forced by the language, not chosen:
 *
 *   - CSS cannot share a declaration block across two mutually-exclusive guards. The card
 *     layout for a stacked table is needed under a CLASS (.fs-stacked, the measured data
 *     table) and under a CONTAINER QUERY (the config table, which cannot be measured — see
 *     fs-select.js). No selector ORs those, so the block is written twice.
 *   - `install.sh` is fetched with `curl | sh` and runs BEFORE the package exists, so it
 *     cannot `source` a library that ships inside the package. Yet it must do exactly what
 *     `footstrap-selfupdate.sh` does: fetch over a verified channel, pin the asset host,
 *     check the sha256. So those blocks are written twice too.
 *
 * The trap — and the whole reason for this tool — is that a STRUCTURAL duplicate detector
 * (tools/css-dup.mjs) finds bodies that are IDENTICAL. The moment two copies diverge they
 * stop being a "duplicate" and the detector goes QUIET — exactly when you need it to shout.
 * That is not hypothetical: `fetch()` in install.sh and footstrap-selfupdate.sh had already
 * drifted three ways (different backend order, one with no timeout on its first-choice tool,
 * one missing the https redirect pin) and nothing said a word.
 *
 * So: tag every copy, and this asserts they stay byte-identical.
 *
 *   shell / JS:   # @mirror <group>/<role>      …lines…      # @endmirror
 *   CSS:          /* @mirror <group>/<role> *\/  …rule…      /* @endmirror *\/
 *
 * Comparison ignores the common leading indentation and trailing whitespace, so the same
 * block may sit at a different nesting depth in each file. EVERYTHING else must match.
 *
 * A group/role with only ONE copy is an error too: a mirror of one is a tag someone forgot to
 * delete when the other copy died, and it would silently accept any future edit.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/* Where a mirror may live. Deliberately explicit: a mirror is a decision, and a glob that
 * silently picks up a new tree would let one appear without anybody choosing it. */
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

/* `@mirror name` opens, `@endmirror` closes. The tag may sit inside any comment syntax —
 * we only look for the token, and the closing line is not part of the body. */
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

/* Strip the common leading indentation and any trailing whitespace: the same block may be
 * nested one level deeper in one file than in the other, and that is not a divergence. */
function normalise(body) {
	const kept = body.filter(l => l.trim() !== '');
	if (!kept.length) return '';
	const indent = Math.min(...kept.map(l => l.match(/^[ \t]*/)[0].length));
	return kept.map(l => l.slice(indent).replace(/\s+$/, '')).join('\n');
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
