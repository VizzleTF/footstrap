#!/usr/bin/env node
/* Structural duplicate detector: the SAME declaration body under DIFFERENT guards.
 *
 * NO LINTER DOES THIS. stylelint catches one selector twice in a file, or one property twice in
 * a block; neither sees two rules with different selectors, under mutually-exclusive guards (a
 * media query vs an attribute selector, two @container thresholds), carrying an IDENTICAL
 * declaration set. To a cascade-aware tool both are REQUIRED — only one ever matches — so it is
 * findable only structurally, and it is exactly the shape that drifts: this theme had the same
 * bar under `@media(max-width:767px)` and under `:root[data-layout=top]`, 55 of ~75 declarations
 * identical.
 *
 * NO BUDGET, deliberately: there used to be a numeric one (2), and a number nobody defends lets
 * the next unexplained copy in for free the moment somebody raises it. Duplication a CSS-language
 * limit forces on you is legitimate; it just has to be a decision. So every duplicated body is
 * folded into one rule, or PINNED: each copy wrapped in
 * `/* @mirror <group>/<role> *\/ … /* @endmirror *\/` — INSIDE the braces, since the selectors
 * legitimately differ and only the declarations must match — which tools/mirror.mjs then holds
 * byte-identical. Untagged = hard failure. The pin is not ceremony: THIS detector matches only
 * IDENTICAL bodies, so it goes quiet the moment two copies diverge, exactly when it should shout.
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

/* css-tree drops comments from the AST, so the pin is collected on the side and matched back by
 * LINE. */
const mirrorAt = new Map();		/* line -> "group/role" */
const ast = csstree.parse(css, {
	positions: true,
	onComment(value, loc) {
		const m = value.match(/@mirror\s+([A-Za-z0-9_-]+\/[A-Za-z0-9_-]+)/);
		if (m) mirrorAt.set(loc.start.line, m[1]);
	},
});

/* the pin sits INSIDE the braces: a comment on some line between the block's first and last */
function mirrorFor(node) {
	const a = node.block?.loc?.start.line, b = node.block?.loc?.end.line;
	if (!a) return null;
	for (const [line, name] of mirrorAt)
		if (line >= a && line <= b) return name;
	return null;
}

/* A rule's "guard" = the chain of at-rules it sits inside (media/container/supports). Same guard
 * + same body = a plain duplicate (stylelint's job); DIFFERENT guards is what we hunt. */
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

/* group by identical body, keep only groups spanning >1 DISTINCT guard */
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

/* accepted only if every copy carries the SAME @mirror pin */
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
