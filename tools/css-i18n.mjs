#!/usr/bin/env node
/* Gate: no CSS rule may key off a `data-title` VALUE.
 *
 * `data-title` is what LuCI stamps on a data cell so a carded table can print the column label
 * (`content: attr(data-title)`). Reading it is fine. MATCHING it is not, and it fails in two
 * independent ways, both of them silent:
 *
 *   1. IT IS TRANSLATED. LuCI fills the attribute from the column HEADING, so on a Russian router
 *      the cell says `data-title="MAC-адрес"`. A selector carrying the English literal matches
 *      nothing — the rule is dead in ~40 languages while looking perfectly alive on the dev box.
 *      This is not hypothetical: the MAC-address nowrap in pages/60-assoclist.css was fixed,
 *      released, and the reporter (on a Russian router) still had his MAC split over two lines
 *      (issue #7).
 *
 *   2. IT IS RENDER-DEPENDENT. For the tables LuCI builds from the heading's `innerText`, the value
 *      is what the heading RENDERS — and theme/30-tables.css sets `text-transform: uppercase` on
 *      `.th`. So the attribute really reads `data-title="DESCRIPTION"`, and the theme's own CSS was
 *      rewriting the very string the theme's own CSS matched on. pages/30-software.css's
 *      `[data-title="Description"]` rule matched ZERO elements on every router, in every language.
 *
 * Anchor on the COLUMN instead (`.td:nth-child(4)`): a translation cannot reorder columns, and a
 * `text-transform` cannot touch an index. Presence tests (`[data-title]`, `:not([data-title])`,
 * `[data-title=""]`) are fine and stay allowed — they ask whether there IS a label, not what it says.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const STYLES = 'luci-theme-footstrap/styles';

/* any data-title comparison carrying a NON-EMPTY value: =, ^=, $=, *=, ~=, |= */
const BAD = /\[\s*data-title\s*[~^$*|]?=\s*(?:"([^"]+)"|'([^']+)'|([^\]\s"']+))/g;

const files = readdirSync(join(ROOT, STYLES), { recursive: true }).filter((f) => f.endsWith('.css'));
const hits = [];

for (const f of files) {
	const rel = `${STYLES}/${f}`.replace(/\\/g, '/');
	const src = readFileSync(join(ROOT, rel), 'utf8');
	/* strip comments: this file's own rationale quotes the very selectors it bans */
	const code = src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
	code.split('\n').forEach((line, i) => {
		for (const m of line.matchAll(BAD))
			hits.push({ file: rel, line: i + 1, value: m[1] ?? m[2] ?? m[3] });
	});
}

if (hits.length) {
	console.error('FAIL: a CSS rule keys off a data-title VALUE — a translated, render-dependent string.\n');
	for (const h of hits)
		console.error(`  ${h.file}:${h.line}  [data-title="${h.value}"]`);
	console.error('\nOn a localised router that value is the TRANSLATION, so the rule matches nothing and');
	console.error('dies silently (issue #7). Anchor on the column instead — `.td:nth-child(N)` — which no');
	console.error('translation can reorder. `[data-title]` on its own (presence) is fine.');
	process.exit(1);
}

console.log(`css-i18n: ${files.length} files, no rule keys off a translated data-title value.`);
