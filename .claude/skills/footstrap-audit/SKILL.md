---
name: footstrap-audit
description: Static-audit the CSS sources in styles/ and the theme JS for un-themed spots, duplication and breakage before deploying. Reports bracket balance, CSS custom properties used via var() but never defined (silently-dropped shadows/colors), declarations shadowed by a later rule on the same selector in the same layer, reads of the outbound --*-color-* export tier from inside the theme (a third-party luci-app-* can hijack those names from :root), base declarations a later layer repaints (dead bytes — plus the absorption backlog that must NOT be deleted), stray !important, and hardcoded color literals in styles/base that bypass the token bridge. A companion cssdiff.py compares computed styles of two stylesheets on a live page — use that to check a change altered nothing. Triggers: "audit css", "проверь css", "un-themed", "что не переопределили", "lint theme", "cssdiff".
---

# footstrap-audit

Fast, dependency-free static check of `luci-theme-footstrap` styles/scripts.

## Run

```sh
python3 .claude/skills/footstrap-audit/audit.py
```

Reports seven things:

1. **balance** — `{}`/`()`/`[]` counts for every CSS source file. Any mismatch =
   a broken block; fix before deploying. (JS correctness is eslint's job.)
2. **css vars used but not defined** — `var(--x)` with no `--x:` anywhere. These
   drop silently (missing shadows/borders/colors). Comments are stripped first,
   so a comment quoting `var(--x)` is not mistaken for a use. Only genuinely
   runtime-inline vars are allow-listed: `--zone-color-rgb` (written on a zone
   badge by `luci-mod-network`) and `--on-color`.
3. **declarations shadowed within a layer** — the same selector, in the same
   cascade layer and at-rule context, setting the same property twice. The
   earlier one is dead code, and it means a rule was appended at the bottom of
   the file instead of edited in place. Reported for `theme`/`page` only;
   `styles/base` re-states properties on purpose. The group-then-refine idiom
   (`input…, textarea { min-height: 38px }` then `textarea { min-height: 84px }`)
   is not reported.
4. **reads of the export tier (`--*-color-*`) from inside the theme** — those names
   are the LuCI convention footstrap exposes OUTWARD, for third-party `luci-app-*`
   stylesheets. The theme itself reads only its private `--fs-*` tokens. A theme
   rule reading an export name reopens the hole the split closed: an app declaring
   that name on the shared `:root` is unlayered, outranks every cascade layer, and
   repaints the theme silently. Measured on `docs/gallery.html` with a hostile
   `:root`: **312 of 336 elements repainted before the split, 0 after.**
   Element-scoped locals that merely end in `-color` (`--bd-color`, `--fg-color`,
   `--on-color`, `--focus-color`, `pre`'s `--border-color`) are not the bridge —
   they are declared inside the rule that reads them and cannot be hijacked.
5. **base declarations a later layer repaints on the same selector** — layers beat
   specificity, so `theme`/`page` outrank `base` unconditionally and such a base
   declaration can never apply. Split in two, and the split is the entire point:
   - **removable** — EVERY selector of the base rule is repainted, so deleting it
     changes no rendered style. Counted as a finding; `--strict` fails on it.
   - **absorption backlog** — only SOME members of the selector group are
     repainted. **Not a finding and not deletable.** Base groups upstream widgets
     together (`.cbi-button-positive, .cbi-button-fieldadd, .cbi-button-add`), and
     deleting the rule would un-theme the members no shipped LuCI page renders —
     which third-party `luci-app-*` packages do render. Absorb by writing the
     uncovered selectors into `theme` first; never by deleting here.
6. **stray `!important`** outside the files allowed to carry one.
7. **hardcoded colors in styles/base** — `#hex` / numeric `rgb()/hsl()` with
   file, line and selector. These bypass the token bridge, so a palette or
   dark-mode switch cannot reach them → candidates to map to tokens.

Caveat on #7: the script flags a base literal even when a `styles/theme` rule
already overrides that selector (it cannot track cascade order). Cross-check
before touching one — a live hit shows up as a colour that does not follow the
palette; a dead one changes nothing. `cssdiff.py` settles it either way.

Caveat on #5, and it matters: the check only matches **identical** selectors. A
base rule such as `.alert-message.warning { background }` that theme kills with a
plain `.alert-message { background }` is dead too, but is not reported — proving
that needs selector-superset reasoning, and a wrong matcher there would un-theme
somebody's app. Conservative on purpose. And note `cssdiff.py` cannot back you up
here: a widget no page renders produces no diff, so "0 diffs" never licenses
deleting a rule the backlog list is protecting.

## Also compile-check templates (printed as a tip by the script)

```sh
ssh router 'for f in /usr/share/ucode/luci/template/themes/footstrap*/*.ut; do
  ucode -T -c -o /dev/null "$f" && echo OK $f || echo FAIL $f; done'
```
