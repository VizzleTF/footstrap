import js from '@eslint/js';
import globals from 'globals';
import stylistic from '@stylistic/eslint-plugin';
import { readFileSync, readdirSync } from 'node:fs';
import { utProcessor } from './tools/lib/ut-scripts.mjs';

/* ESLint for the theme's browser JS. Runs in CI and locally, never on the OpenWrt buildbot: it
 * has no node and needs none — luci.mk copies htdocs/ verbatim.
 *
 * THE NON-OBVIOUS BIT: `globalReturn`. A LuCI resource file is neither a script nor an ES module
 * — luci.js evaluates its body INSIDE a function wrapper, which is why every one of these files
 * ends in a bare `return baseclass.extend({...})` and opens with `'require ui'` pragma strings.
 * A stock parser rejects a top-level `return`, so without this the whole tree fails to parse and
 * the lint is worthless.
 */

/* Every resource module, with the alias each one binds via a `'require <mod> as <alias>'` pragma.
 * `'require ui'` with no alias binds the bare name and is already a global below; only the aliased
 * form needs deriving. See the config entry at the bottom for why this is read from the source rather
 * than written out.
 *
 * TWO packages ship browser JS into /www/luci-static/resources: the theme, and the optional updater
 * (luci-app-footstrap-updater/htdocs/.../fs-update.js, which requires the theme's fs-version/fs-prefs/
 * fs-router at runtime). Both land in the same directory on the router and both are minified by jsmin,
 * so both must be linted — a package left out silently drops the wrap-regex/jsmin safety on it. */
const HTDOCS_GLOBS = [
	'luci-theme-footstrap/htdocs/**/*.js',
	'luci-app-footstrap-updater/htdocs/**/*.js',
];
const RESOURCE_DIRS = [
	'luci-theme-footstrap/htdocs/luci-static/resources',
	'luci-app-footstrap-updater/htdocs/luci-static/resources',
];
function resourceFiles() {
	return RESOURCE_DIRS.flatMap((dir) => readdirSync(dir, { recursive: true })
		.filter((f) => f.endsWith('.js'))
		.map((f) => {
			const file = `${dir}/${f}`.replace(/\\/g, '/');
			const src = readFileSync(file, 'utf8');
			const aliases = [...src.matchAll(/^'require\s+\S+\s+as\s+(\w+)'/gm)].map((m) => m[1]);
			return { file, aliases };
		}))
		.filter((e) => e.aliases.length);
}

export default [
	/* eslint:recommended as the FLOOR. The hand-picked list below used to be the whole config,
	 * which quietly left every other free correctness rule off (no-dupe-keys, no-unreachable,
	 * no-duplicate-case, no-prototype-builtins, getter-return, no-cond-assign, ~30 more — each a
	 * bug that compiles, none a style opinion). Turning the set on found ZERO new violations
	 * here: it costs nothing today and catches the next one for free. The rules below are the
	 * ones recommended does NOT give you (no-var, eqeqeq, wrap-regex, …). */
	{ files: HTDOCS_GLOBS, ...js.configs.recommended },
	{
		files: HTDOCS_GLOBS,
		plugins: { '@stylistic': stylistic },
		languageOptions: {
			ecmaVersion: 2023,
			sourceType: 'script',
			parserOptions: {
				ecmaFeatures: { globalReturn: true },
			},
			globals: {
				...globals.browser,
				/* injected by luci.js into every resource file's scope */
				L: 'readonly',
				E: 'readonly',
				_: 'readonly',
				baseclass: 'readonly',
				ui: 'readonly',
				dom: 'readonly',
				fs: 'readonly',
				uci: 'readonly',
				rpc: 'readonly',
				form: 'readonly',
				network: 'readonly',
				poll: 'readonly',
				request: 'readonly',
				validation: 'readonly',
			},
		},
		rules: {
			/* An empty `catch {}` is the deliberate idiom: every localStorage access is wrapped in
			 * one, because a browser in private mode THROWS on getItem, and a theme preference
			 * that cannot be read is not an error — it is a default. Same for the ui.hideModal()
			 * guard. Empty blocks anywhere ELSE stay an error. */
			'no-empty': ['error', { allowEmptyCatch: true }],

			/* correctness — these are the ones that catch real bugs */
			'no-unused-vars': ['error', { args: 'none', caughtErrors: 'none' }],
			'no-undef': 'error',
			'no-implicit-globals': 'error',
			'no-shadow': 'warn',
			'no-var': 'error',
			'prefer-const': 'warn',
			/* `always`, NOT `smart`. Both allow the deliberate `x != null` idiom (hence
			 * null: 'ignore'), but `smart` ALSO waves through `typeof x == 'function'` — and
			 * that is the one this codebase had drifted on: 5 loose sites against 9 strict,
			 * with no gate able to say which was the house style. Loose == on a typeof is
			 * never wrong, which is exactly why it goes unnoticed and spreads. */
			eqeqeq: ['error', 'always', { null: 'ignore' }],
			'no-eval': 'error',
			'no-implied-eval': 'error',
			'no-new-func': 'error',
			'no-return-await': 'warn',
			'no-unsafe-optional-chaining': 'error',
			'no-constant-binary-expression': 'error',
			'no-self-compare': 'error',
			'no-template-curly-in-string': 'warn',
			'require-atomic-updates': 'warn',

			/* the theme's own house rules, from CLAUDE.md */
			'no-alert': 'error',
			'no-console': ['warn', { allow: ['warn', 'error'] }],

			/* JSMIN SAFETY — correctness, not style. luci.mk minifies this file with jsmin, whose
			 * regex-vs-division test is a ONE-char lookback against a fixed allow-list: `n` (last
			 * letter of `return`) and `>` (from `=>`) are NOT on it, `(` is. So a regex literal
			 * straight after `return` or `=>` is read as a division, and if its body contains `//`
			 * jsmin swallows the rest of the file — exiting 0 while doing it (openwrt/luci#8299).
			 *
			 * `wrap-regex` forces `(/re/).test(x)`, putting a `(` in front of every regex that is
			 * the object of a member expression — exactly the hazardous shape. A regex passed as an
			 * argument (`s.replace(/x/, y)`) already sits behind `(` or `,`; not flagged.
			 * tools/jsmin-verify.mjs is the backstop; this rule stops the breakage being written. */
			'wrap-regex': 'error',

			/* ---- the two FORMATTING rules, and they are @stylistic/* for a reason ----
			 * ESLint deprecated every formatting rule in core (8.53) and @stylistic is where they
			 * live maintained now. Both close a drift that was MEASURED here, not a taste:
			 * arrow-parens stood at 62 with / 21 without — mixed inside single files, twice within
			 * twenty lines of each other — and no-mixed-operators covers `e && e.message || e`,
			 * which is correct by precedence and unreadable by design (the parenthesised twin was
			 * already written three files away). Neither can change behaviour; both are autofixable,
			 * which is the whole reason they are cheap to keep. */
			'@stylistic/arrow-parens': ['error', 'always'],
			'@stylistic/no-mixed-operators': 'error',
		},
	},
	/* `'require fs-prefs as prefs';` — the same pragma mechanism as `ui`/`baseclass` above: luci.js
	 * resolves the module and passes it into this file's factory as a formal PARAMETER, so the alias
	 * is a real binding at runtime with no declaration ESLint could see. Without a global it is a
	 * `no-undef` error in every file that composes with another module.
	 *
	 * DERIVED FROM THE PRAGMAS, not listed: each file gets exactly the aliases it actually requires.
	 * The two shapes this avoids are both real. A hand-written per-file list is what dev-sync.sh had,
	 * and it silently stopped covering the next module somebody added. Declaring every alias for the
	 * whole tree is worse in the other direction: `no-undef` is precisely the check that catches a
	 * file USING `prefs.` without requiring it — a ReferenceError at load — and a blanket global
	 * switches that check off. Per file, from the file's own text, is the only version that keeps it.
	 */
	...resourceFiles().map(({ file, aliases }) => ({
		files: [ file ],
		languageOptions: { globals: Object.fromEntries(aliases.map((a) => [ a, 'readonly' ])) },
	})),

	/* THE TEMPLATES' INLINE <script>s — the theme's other browser JS, and until this entry the only
	 * JS here that NOTHING checked. eslint walked htdocs/ and jsmin (via luci.mk) minifies that same
	 * tree, while a .ut is copied to the router verbatim: both gates looked straight past the
	 * pre-paint in partials/head.ut, which stamps :root before the first frame and whose only
	 * failure symptom is one wrong frame that nobody reports and no other gate catches.
	 * tools/lib/ut-scripts.mjs pulls each non-interpolated <script> body out as a virtual `<n>.js`,
	 * padded so line/column point back at the .ut. See there for why an interpolated block is
	 * exempt and what it must be instead. */
	{ files: [ '**/*.ut' ], processor: utProcessor },
	{ files: [ '**/*.ut/*.js' ], ...js.configs.recommended },
	{
		files: [ '**/*.ut/*.js' ],
		plugins: { '@stylistic': stylistic },
		languageOptions: {
			ecmaVersion: 2023,
			sourceType: 'script',
			globals: {
				...globals.browser,
				L: 'readonly',
				/* the pre-paint's own channel for server values: head.ut and sysauth.ut each emit one
				 * interpolated data blob (see ut-scripts.mjs) that the linted blocks below read. */
				__fsSD: 'readonly',
				__fsHttps: 'readonly',
			},
		},
		rules: {
			/* the same reason as htdocs: every localStorage read here is wrapped in an empty catch,
			 * because a browser in private mode THROWS and an unreadable preference is a default,
			 * not an error. */
			'no-empty': [ 'error', { allowEmptyCatch: true } ],
			'no-unused-vars': [ 'error', { args: 'none', caughtErrors: 'none' } ],
			'no-undef': 'error',
			'no-shadow': 'warn',
			'no-var': 'error',
			'prefer-const': 'warn',
			eqeqeq: [ 'error', 'always', { null: 'ignore' } ],
			'no-eval': 'error',
			'no-implied-eval': 'error',
			'no-new-func': 'error',
			'no-constant-binary-expression': 'error',
			'no-self-compare': 'error',
			'no-alert': 'error',
			'no-console': [ 'warn', { allow: [ 'warn', 'error' ] } ],
			/* Same three as htdocs, and they matter MORE here, not less: this is the pre-paint, the
			 * one copy of every axis that runs before the module loader exists. Zero violations
			 * today — so they cost nothing and hold the next edit to the house style. */
			'@stylistic/arrow-parens': [ 'error', 'always' ],
			'@stylistic/no-mixed-operators': 'error',
			/* NO `wrap-regex` here, and no `no-implicit-globals`. jsmin never sees a template —
			 * luci.mk copies ucode/ verbatim — so the regex-vs-division hazard that rule exists for
			 * cannot arise; and these blocks are IIFEs in real global scope, where a top-level
			 * declaration is the point, not a mistake. */
		},
	},
];
