import js from '@eslint/js';
import globals from 'globals';

/* ESLint for the theme's browser JS.
 *
 * This runs in CI and locally — never on the OpenWrt buildbot, which has no node
 * and does not need one: luci.mk copies htdocs/ verbatim.
 *
 * THE ONE NON-OBVIOUS BIT: `globalReturn`. A LuCI resource file is not a script and
 * not an ES module — luci.js fetches it and evaluates the body INSIDE a function
 * wrapper, which is why every one of these files ends in a bare
 * `return baseclass.extend({...})` and starts with `'require ui'` pragma strings.
 * A stock parser rejects a top-level `return` outright, so without this the whole
 * tree fails to parse and the lint is worthless.
 */
export default [
	/* eslint:recommended as the FLOOR. The rule list below used to be the whole of it —
	 * eighteen rules picked by hand — which quietly meant that every OTHER free
	 * correctness rule was off: no-dupe-keys, no-unreachable, no-duplicate-case,
	 * no-prototype-builtins, no-async-promise-executor, getter-return, no-sparse-arrays,
	 * no-cond-assign, no-misleading-character-class and ~30 more. None of them is a style
	 * opinion; each is a bug that compiles. Turning the set on found ZERO new violations in
	 * this codebase, so it costs nothing today and catches the next one for free — which is
	 * the only reason to have a linter at all. The hand-picked rules below still stand:
	 * they are the ones recommended does NOT give you (no-var, eqeqeq, wrap-regex, …). */
	{ files: ['luci-theme-footstrap/htdocs/**/*.js'], ...js.configs.recommended },
	{
		files: ['luci-theme-footstrap/htdocs/**/*.js'],
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
			/* An empty `catch {}` is the deliberate idiom here: every localStorage access is
			 * wrapped in one, because a browser in private mode THROWS on getItem, and a theme
			 * preference that cannot be read is not an error — it is a default. Same for the
			 * ui.hideModal() guard. Empty blocks anywhere ELSE stay an error. */
			'no-empty': ['error', { allowEmptyCatch: true }],

			/* correctness — these are the ones that catch real bugs */
			'no-unused-vars': ['error', { args: 'none', caughtErrors: 'none' }],
			'no-undef': 'error',
			'no-implicit-globals': 'error',
			'no-shadow': 'warn',
			'no-var': 'error',
			'prefer-const': 'warn',
			eqeqeq: ['warn', 'smart'],
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

			/* JSMIN SAFETY — this one is not style, it is correctness.
			 *
			 * luci.mk minifies this file with jsmin, whose regex-vs-division test is a
			 * ONE-character lookback against a fixed allow-list. `n` (the last letter of
			 * `return`) and `>` (from `=>`) are NOT on it. So a regex literal written
			 * directly after `return` or `=>` is read as a division, and if the regex body
			 * then contains `//` or `/*`, jsmin swallows the rest of the file — and exits
			 * 0 while doing it (openwrt/luci#8299). `(` IS on the allow-list.
			 *
			 * `wrap-regex` forces `(/re/).test(x)`, which puts a `(` in front of every
			 * regex that is the object of a member expression — exactly the hazardous
			 * shape. A regex passed as an argument (`s.replace(/x/, y)`) already sits
			 * behind `(` or `,` and is not flagged.
			 *
			 * tools/jsmin-verify.mjs is the backstop that proves the minified output is
			 * token-identical to the source; this rule stops the breakage being written. */
			'wrap-regex': 'error',
		},
	},
	{
		/* `'require menu-footstrap-common as common';` — the same pragma mechanism as
		 * `ui`/`baseclass` above: luci.js resolves the module and binds it into this
		 * file's scope under the alias. It is a real binding at runtime; ESLint just
		 * cannot see the pragma that creates it. */
		files: [
			'luci-theme-footstrap/htdocs/luci-static/resources/menu-footstrap.js',
		],
		languageOptions: { globals: { common: 'readonly' } },
	},
	{
		/* `'require fs-fit as fit';` — same pragma mechanism; a real binding at runtime
		 * that ESLint cannot see. */
		files: [
			'luci-theme-footstrap/htdocs/luci-static/resources/fs-select.js',
			'luci-theme-footstrap/htdocs/luci-static/resources/menu-footstrap.js',
			'luci-theme-footstrap/htdocs/luci-static/resources/menu-footstrap-common.js',
			'luci-theme-footstrap/htdocs/luci-static/resources/view/status/include/05_footstrap_overview_layout.js',
		],
		languageOptions: { globals: { fit: 'readonly' } },
	},
];
