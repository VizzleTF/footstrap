#!/usr/bin/env node
/* Structural duplicate detector: the SAME declaration body written under DIFFERENT guards.
 *
 * WHY THIS EXISTS, AND WHY NO LINTER DOES IT
 * -----------------------------------------
 * stylelint's `no-duplicate-selectors` catches the same selector twice in a file, and
 * `declaration-block-no-duplicate-properties` catches a property twice in a block. Neither
 * can see THIS: two rules with different selectors, under mutually-exclusive guards
 * (a media query vs an attribute selector, or two @container queries), carrying an
 * IDENTICAL set of declarations.
 *
 * To a cascade-aware tool those two rules are not redundant — they are both required,
 * because only one of them ever matches. So no linter will ever call it an error. It is
 * only findable as a STRUCTURAL duplicate, and it is exactly the shape that drifts: the
 * two copies are correct today and silently disagree six months from now (this theme had
 * the same bar written under `@media(max-width:767px)` and under `:root[data-layout=top]`
 * — 55 of ~75 declarations identical).
 *
 * WHAT IT DOES ABOUT IT — and why there is no budget
 * ---------------------------------------------------
 * There used to be a numeric BUDGET here (2), and it was the wrong instrument: a number
 * nobody defends, which lets the next unexplained copy in for free the moment somebody
 * raises it by one. Duplication a CSS-language limit FORCES on you is legitimate; it just
 * has to be a decision rather than an accident.
 *
 * So every duplicated body must be one of two things:
 *   - folded into a single rule, or
 *   - PINNED: each copy wrapped in `/* @mirror <group>/<role> *\/ … /* @endmirror *\/`
 *     (the tag goes INSIDE the braces — the selectors legitimately differ, only the
 *     declarations must match). tools/mirror.mjs then holds the copies byte-identical.
 * An untagged duplicate is a hard failure.
 *
 * The pin is not ceremony. THIS detector only finds bodies that are IDENTICAL — so the
 * moment two copies diverge they stop looking like a duplicate and it goes quiet, exactly
 * when you need it to shout. mirror.mjs is what closes that: together they turn duplication
 * you cannot delete into duplication that cannot rot.
 *
 * Usage: node tools/css-dup.mjs [--min N] [--json]
 */
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as csstree from 'css-tree';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const MIN_DECLS = Number(process.argv[includesIdx('--min') + 1]) || 3;
function includesIdx(f) { return process.argv.indexOf(f); }

/* build the real stylesheet the router serves */
const tmp = join(mkdtempSync(join(tmpdir(), 'cssdup-')), 'cascade.css');
execFileSync(join(ROOT, 'luci-theme-footstrap', 'build-css.sh'), [tmp, '--dev'], { stdio: 'ignore' });
const css = readFileSync(tmp, 'utf8');

/* css-tree drops comments from the AST, so the pin has to be collected on the side and
 * matched back by LINE. onComment gives us both. */
const mirrorAt = new Map();		/* line -> "group/role" */
const ast = csstree.parse(css, {
	positions: true,
	onComment(value, loc) {
		const m = value.match(/@mirror\s+([A-Za-z0-9_-]+\/[A-Za-z0-9_-]+)/);
		if (m) mirrorAt.set(loc.start.line, m[1]);
	},
});

/* the pin sits INSIDE the rule's braces, so it is a comment on some line between the
 * block's first and last */
function mirrorFor(node) {
	const a = node.block?.loc?.start.line, b = node.block?.loc?.end.line;
	if (!a) return null;
	for (const [line, name] of mirrorAt)
		if (line >= a && line <= b) return name;
	return null;
}

/* The "guard" of a rule = the chain of at-rules it sits inside (media/container/supports)
 * plus its cascade layer. Two rules under the same guard with the same body are a plain
 * duplicate (stylelint's job); two under DIFFERENT guards are what we are hunting. */
const rules = [];
const stack = [];
csstree.walk(ast, {
	enter(node) {
		if (node.type === 'Atrule' && node.prelude && ['media', 'container', 'supports', 'layer'].includes(node.name))
			stack.push(`@${node.name} ${csstree.generate(node.prelude)}`);
		if (node.type !== 'Rule' || node.block?.type !== 'Block') return;

		const decls = [];
		const mirror = mirrorFor(node);
		for (const d of node.block.children) {
			if (d.type !== 'Declaration') continue;
			decls.push(`${d.property}:${csstree.generate(d.value).replace(/\s+/g, ' ').trim()}${d.important ? '!' : ''}`);
		}
		if (decls.length < MIN_DECLS) return;

		rules.push({
			guard: stack.filter(g => !g.startsWith('@layer')).join(' & ') || '(none)',
			selector: csstree.generate(node.prelude).replace(/\s+/g, ' ').trim(),
			line: node.loc?.start.line ?? 0,
			key: decls.slice().sort().join('; '),
			n: decls.length,
			mirror,
		});
	},
	leave(node) {
		if (node.type === 'Atrule' && node.prelude && ['media', 'container', 'supports', 'layer'].includes(node.name))
			stack.pop();
	},
});

/* group by identical declaration body, keep only groups spanning >1 DISTINCT guard */
const byBody = new Map();
for (const r of rules) {
	if (!byBody.has(r.key)) byBody.set(r.key, []);
	byBody.get(r.key).push(r);
}

const findings = [];
for (const [key, group] of byBody) {
	if (group.length < 2) continue;
	const guards = new Set(group.map(r => r.guard));
	if (guards.size < 2) continue;			/* same guard = plain dup, stylelint owns it */
	findings.push({ key, n: group[0].n, group });
}
findings.sort((a, b) => b.n * b.group.length - a.n * a.group.length);

const wasted = findings.reduce((s, f) => s + f.n * (f.group.length - 1), 0);

/* A finding is ACCEPTED only if every copy carries the same @mirror pin. */
const unpinned = findings.filter(f => {
	const pins = f.group.map(r => r.mirror);
	return pins.some(p => !p) || new Set(pins).size !== 1;
});

if (process.argv.includes('--json')) {
	console.log(JSON.stringify({ findings, wasted, unpinned: unpinned.length }, null, 2));
} else {
	for (const f of findings) {
		const pins = new Set(f.group.map(r => r.mirror));
		const tag = (pins.size === 1 && !pins.has(null)) ? `pinned @mirror ${[...pins][0]}` : 'UNPINNED';
		console.log(`\n--- ${f.n} decls x ${f.group.length} occurrences   [${tag}]`);
		for (const r of f.group)
			console.log(`    L${String(r.line).padEnd(6)} guard=${r.guard.padEnd(42)} ${r.selector}`);
		console.log(`    decls: ${f.key}`);
	}
	console.log(`\n${findings.length} duplicated declaration bodies across differing guards `
		+ `(>= ${MIN_DECLS} decls); ~${wasted} redundant declarations. `
		+ `${unpinned.length ? `${unpinned.length} UNPINNED.` : 'all pinned.'}`);
}

if (unpinned.length) {
	console.error(`\nFAIL: ${unpinned.length} duplicated declaration body/bodies are not pinned.`);
	console.error('Fold them into one rule. If the guards genuinely cannot be merged in CSS (a');
	console.error('media query vs an attribute selector, a class vs a container query, two');
	console.error('@container thresholds), then this duplication is forced on you — say so, by');
	console.error('wrapping the declarations of EVERY copy in:');
	console.error('    /* @mirror <group>/<role> */  …declarations…  /* @endmirror */');
	console.error('tools/mirror.mjs then holds the copies byte-identical, so they cannot drift.');
	console.error('There is no budget: a number nobody defends lets the next copy in for free.');
	process.exit(1);
}
