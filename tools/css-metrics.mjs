#!/usr/bin/env node
/* A RATCHET on the stylesheet's shape — same idea as the CSS size budget in build-css.sh and the
 * font-byte budget in CI: pin the numbers that only get worse by accident, so they cannot drift
 * up one commit at a time. Not style opinions; each is an invariant CLAUDE.md states in prose and
 * nothing enforced:
 *
 *   IMPORTANTS — which declarations may carry `!important` is documented (16 in theme+pages, each
 *     fighting an inline or unlayered declaration; 17 in base): a fact about the cascade, not a
 *     preference. stylelint's `declaration-no-important` + allowlist stops a NEW file adding one;
 *     this stops the allowlisted files growing more.
 *   MAX SPECIFICITY — "do not let source order carry meaning… win on specificity instead." A rule
 *     needing a wilder selector than anything else is usually fighting a battle a cascade layer
 *     should have won for it.
 *   EMPTY RULES — always a mistake, and the concatenating build cannot see one.
 *
 * Lower a number when you make it true. Raising one is a decision, and wants a comment.
 *
 * Usage: node tools/css-metrics.mjs [--show]
 */
import { readFileSync, mkdtempSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyze } from '@projectwallace/css-analyzer';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const LIMITS = {
	/* 16 (theme+pages, each fighting an inline or unlayered declaration) + 17 (base) */
	importants: 33,
	/* The widest selector the theme needs; see the layer rules in CLAUDE.md.
	 *
	 * Raised 6 -> 7 when the vertical sidebar's guard gained `:not([data-narrow])`. Not sprawl:
	 * the sidebar gives way to the bar when the CONTENT column would be too narrow, and that
	 * depends on the sidebar's own cut (224px expanded, 68px as a rail) — so it cannot be a
	 * media query and has to be an attribute. Every rule in the vertical and rail blocks
	 * therefore carries one attribute more; the deepest is the rail's paused-poll glyph at
	 * [1,7,0]. The ratchet did its job: it made the increase a decision, not a drift. */
	maxSpecificity: [1, 7, 0],
	emptyRules: 0,
};

const tmp = join(mkdtempSync(join(tmpdir(), 'cssmetrics-')), 'cascade.css');
execFileSync(join(ROOT, 'luci-theme-footstrap', 'build-css.sh'), [tmp], { stdio: 'ignore' });
const result = analyze(readFileSync(tmp, 'utf8'));

const importants = result.declarations.importants.total;
const spec = result.selectors.specificity.max;			/* [a, b, c] */
const empty = result.rules.empty.total;

const cmp = (a, b) => (a[0] - b[0]) || (a[1] - b[1]) || (a[2] - b[2]);

if (process.argv.includes('--show')) {
	console.log(`rules            ${result.rules.total}`);
	console.log(`selectors        ${result.selectors.total} (${result.selectors.totalUnique} unique)`);
	console.log(`declarations     ${result.declarations.total} (${result.declarations.totalUnique} unique)`);
}

const fails = [];
console.log(`importants       ${importants}  (max ${LIMITS.importants})`);
if (importants > LIMITS.importants)
	fails.push(`importants ${importants} > ${LIMITS.importants}`);

console.log(`max specificity  [${spec}]  (max [${LIMITS.maxSpecificity}])`);
if (cmp(spec, LIMITS.maxSpecificity) > 0)
	fails.push(`max specificity [${spec}] > [${LIMITS.maxSpecificity}]`);

console.log(`empty rules      ${empty}  (max ${LIMITS.emptyRules})`);
if (empty > LIMITS.emptyRules)
	fails.push(`empty rules ${empty} > ${LIMITS.emptyRules}`);

if (fails.length) {
	console.error(`\nFAIL:\n  ${fails.join('\n  ')}`);
	console.error('\nEach limit is an invariant, not a preference — read the note at the top of');
	console.error('tools/css-metrics.mjs before raising one.');
	process.exit(1);
}
console.log('\nok — the sheet is within every budget.');
