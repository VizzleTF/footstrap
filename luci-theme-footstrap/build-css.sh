#!/bin/sh
# Concatenate the styles/ tree into a single cascade.css.
#
#   ./build-css.sh [outfile] [--dev]
#
# One directory per cascade layer, joined in this order; inside each, files are
# joined in filename order, so the numeric prefix IS the source order:
#
#   styles/*.css        the banner, @font-face and the design tokens
#   styles/base/*.css   @layer base    widget defaults every LuCI view assumes
#   styles/theme/*.css  @layer theme   footstrap components and layouts
#   styles/pages/*.css  @layer page    per-page corrections
#
# A later layer beats an earlier one whatever the selector specificity, so a
# theme file always wins over base, and a page file over a component, without
# !important. Layer precedence is declared once in styles/00-header.css.
#
# Without --dev the output is minified: comments dropped (except the /*! banner),
# indentation and blank lines collapsed. That cuts it by ~61% (284 KB of source -> ~112 KB shipped), and it
# matters — uhttpd serves /www/luci-static/*.css with no gzip, so the browser
# downloads every byte. The transform never touches selectors or declarations,
# which is why LuCI's own csstidy pass stays off (it mangles :has()/color-mix()).
#
# Called by the package Makefile (Build/Prepare) and by dev-sync.sh. Nothing in
# the source tree is written unless [outfile] points there.
set -e

D="$(cd "$(dirname "$0")" && pwd)"
OUT=""
DEV=0
for a in "$@"; do
	case "$a" in
		--dev) DEV=1 ;;
		# An unknown option used to fall through to `OUT="$a"` — so a typo like
		# `--devv` silently made the script write the stylesheet to a file called
		# "--devv" (and `dirname --devv` then died under set -e). Fail on it.
		-*) echo "build-css: unknown option: $a" >&2; exit 1 ;;
		*) OUT="$a" ;;
	esac
done
[ -n "$OUT" ] || OUT="$D/htdocs/luci-static/footstrap/cascade.css"

for d in styles styles/base styles/theme styles/pages; do
	[ -d "$D/$d" ] || { echo "build-css: $D/$d missing" >&2; exit 1; }
done

TMP="$OUT.tmp.$$"
# $TMP.min too: an awk failure used to leave it behind next to the real output.
trap 'rm -f "$TMP" "$TMP.min"' EXIT
mkdir -p "$(dirname "$OUT")"

# glob expands in filename order
cat "$D"/styles/*.css \
    "$D"/styles/base/*.css \
    "$D"/styles/theme/*.css \
    "$D"/styles/pages/*.css > "$TMP"

# Strip /* ... */ comments, keeping /*! ... */ (the licence banner), and drop
# indentation and blank lines.
#
# STRING-AWARE, deliberately. The old scanner just hunted for the next "/*" — it
# had no idea what a string was, so `content: "/*"` would have opened a comment and
# eaten every rule up to the next "*/". Nothing in the tree does that today, which
# is exactly why it was worth fixing before something does: the only guard was the
# brace counter below, and two such literals can balance each other and let whole
# rules disappear in silence. url(...) data-URIs (quoted, full of punctuation) run
# through here on every build, so this path has to be correct, not lucky.
strip_comments() {
	awk '
		BEGIN { inc = 0; q = "" }
		{
			line = $0; out = ""; i = 1; n = length(line)
			while (i <= n) {
				c = substr(line, i, 1)
				if (inc) {                                  # inside /* ... */
					if (c == "*" && substr(line, i + 1, 1) == "/") { inc = 0; i += 2; continue }
					i++; continue
				}
				if (q != "") {                              # inside a "..." or '"'"'...'"'"' string
					out = out c
					if (c == "\\") { out = out substr(line, i + 1, 1); i += 2; continue }
					if (c == q) q = ""
					i++; continue
				}
				if (c == "\"" || c == "'"'"'") { q = c; out = out c; i++; continue }
				if (c == "/" && substr(line, i + 1, 1) == "*") {
					# the banner: keep it, and everything after it on this line
					if (substr(line, i + 2, 1) == "!") { out = out substr(line, i); break }
					inc = 1; i += 2; continue
				}
				out = out c; i++
			}
			sub(/^[ \t]+/, "", out)
			sub(/[ \t]+$/, "", out)
			if (length(out)) print out
		}
	' "$1"
}

# Squeeze the whitespace the comment stripper leaves behind. uhttpd does not
# compress, so every one of these bytes is a wire byte AND a flash byte.
#
# WHAT IS REMOVED (all of it mechanical, none of it clever):
#   - the space after `:` in `color: red`
#   - spaces either side of `{ } ; ,`
#   - the last `;` before `}`
#   - the newline after every declaration (one line per RULE, not per declaration)
# Worth ~9.5 KB on this sheet. A real minifier (lightningcss) gets ~13 KB, but the
# extra 3.5 KB comes from rewriting colours and merging rules — transforms that can
# change behaviour. These cannot: they only delete whitespace that CSS ignores.
#
# WHAT IS DELIBERATELY LEFT ALONE:
#   - a single space between selectors: `.a .b` is a DESCENDANT combinator, and
#     `.a.b` is a different selector entirely. Runs of whitespace collapse to one
#     space; that last space stays.
#   - spaces inside calc(): `calc(var(--x) * 5 / 6)` REQUIRES them around `*` and
#     `/`, and `calc(100% - 8px)` around the `-`. Nothing here touches those.
#   - the LINE BREAK inside a declaration, which is whitespace too. This scanner is
#     line-oriented and used to join lines with nothing between them, so a
#     declaration wrapped onto a second line came out with its lines glued:
#         calc(.011 + .016 * max(0, cos(…))
#             - .004 * max(0, cos(…)))
#     minified to `…))- .004 * …`, and a calc() `-` with no space BEFORE it is a
#     parse error. The declaration then dropped, --fs-tint-c went undefined, --fs-bg
#     became invalid at computed-value time and the canvas fell back to white — with
#     no error anywhere. (export-tier.mjs caught it: contrast collapsed to 1.5:1.)
#     A newline between two tokens is now treated exactly like a space run: kept when
#     it separates two tokens, dropped next to a delimiter, so nothing else moves.
#   - `>` `+` `~` keep their spaces. Stripping them is safe but buys ~200 bytes.
#   - anything inside a string. This scanner is string-aware, like the comment one:
#     every data-URI in the tree is quoted and full of `:`, `;` and spaces.
#   - one newline after `}`, so the shipped file is still greppable and a devtools
#     line number still means something.
squeeze() {
	awk '
		BEGIN { q = ""; ban = 0; lastc = ""; buf = ""; lastreal = "" }
		{
			line = $0
			# The /*! ... */ licence banner is the one comment strip_comments keeps, and
			# it must survive BYTE FOR BYTE: it is an Apache-2.0 attribution notice, not
			# formatting. Squeezing it turned "Twitter, Inc" into "Twitter,Inc" and glued
			# every line together. Copy it out untouched, newlines and all.
			if (ban) { print line; lastc = ""; lastreal = ""; if (index(line, "*/")) ban = 0; next }
			if (substr(line, 1, 3) == "/*!") {
				print line; lastc = ""; lastreal = ""
				if (!index(substr(line, 4), "*/")) ban = 1
				next
			}
			# The line BREAK we are about to swallow is whitespace, and a declaration may
			# be wrapped across it (a long calc(), a gradient). Feed it to the same
			# whitespace-run logic below as a leading space: it survives only where a
			# space would — between two tokens — and is dropped next to { } ; , : as
			# before. lastc == "" means the output is already at the start of a line
			# (after a `}` or the banner), where there is nothing to glue to.
			if (lastc != "" && q == "") line = " " line
			out = ""; i = 1; n = length(line)
			while (i <= n) {
				c = substr(line, i, 1)
				if (q != "") {                       # inside a string: copy verbatim
					out = out c
					if (c == "\\") { out = out substr(line, i + 1, 1); i += 2; continue }
					if (c == q) q = ""
					lastreal = ""                # a char inside a string is not structure
					i++; continue
				}
				if (c == "\"" || c == "'"'"'") { q = c; out = out c; lastreal = ""; i++; continue }
				if (c == " " || c == "\t") {         # collapse a run of whitespace to one space
					while (i <= n && (substr(line, i, 1) == " " || substr(line, i, 1) == "\t")) i++
					# prev is the last character EMITTED, which on a continuation line
					# lives on the previous output line — hence lastc, not just `out`.
					prev = (length(out) ? substr(out, length(out), 1) : lastc)
					nxt  = (i <= n ? substr(line, i, 1) : "")
					# drop it entirely next to a delimiter; otherwise it may be a combinator
					if (prev == "" || prev == "{" || prev == "}" || prev == ";" || prev == "," || prev == ":")
						continue
					if (nxt == "{" || nxt == "}" || nxt == ";" || nxt == "," || nxt == "")
						continue
					out = out " "; lastreal = " "
					continue
				}
				# THE LAST `;` OF A BLOCK IS REDUNDANT — drop it as the closing brace is
				# emitted, i.e. INSIDE the string-aware scanner.
				#
				# This used to be a `| sed "s/;}/}/g"` bolted onto the awk output, and sed
				# cannot see strings: `content: ";}"` came out as `content: "}"`, and a
				# data-URI containing `;}` was silently corrupted. Both reproduced. Nothing
				# in the tree happens to contain that byte pair today — which is precisely
				# how a bug like this waits to be found by whoever adds the first one.
				#
				# The `;` may already be sitting in the previous input line''s output, so the
				# emitted text is held in `buf` until the rule closes rather than streamed:
				# a `;` printed to stdout cannot be taken back.
				if (c == "}") {
					if (length(out) && substr(out, length(out), 1) == ";")
						out = substr(out, 1, length(out) - 1)
					else if (!length(out) && length(buf) && substr(buf, length(buf), 1) == ";")
						buf = substr(buf, 1, length(buf) - 1)
				}
				out = out c; lastreal = c; i++
			}
			buf = buf out
			if (length(out)) lastc = substr(out, length(out), 1)
			# a newline only after a closing brace — keeps rules on their own lines.
			# lastreal, not lastc: a line ending in a QUOTED `}` (content: "}") is not the
			# end of a rule, and flushing there would break the rule across two lines and
			# lose the space that separates its next token.
			if (lastreal == "}") { print buf; buf = ""; lastc = ""; lastreal = "" }
		}
		END { if (length(buf)) print buf; else printf "\n" }
	' "$1"
}

# Count the braces in a file and echo "<open> <close>". Fails loudly rather than let an
# unbalanced block ship. The braces are matched as bracket expressions: a bare /{/ is an
# interval-expression ambiguity that some awks warn about or reject.
brace_count() {
	awk '{ o += gsub(/[{]/, "&"); c += gsub(/[}]/, "&") } END {
		if (o != c) { printf "build-css: %s: unbalanced braces (%d { vs %d })\n", FILENAME, o, c > "/dev/stderr"; exit 1 }
		if (o < 100) { printf "build-css: %s: suspiciously few rules (%d)\n", FILENAME, o > "/dev/stderr"; exit 1 }
		print o
	}' "$1"
}

# The brace check runs on a COMMENT-STRIPPED copy, always — including in --dev,
# where comments survive into the output. It used to count braces in the raw file,
# so a comment containing a stray "{" (prose, an example) failed the build on
# perfectly valid CSS.
strip_comments "$TMP" > "$TMP.min"
RULES_BEFORE=$(brace_count "$TMP.min") || exit 1

if [ "$DEV" -eq 0 ]; then
	# comments gone; now squeeze the whitespace CSS ignores
	squeeze "$TMP.min" > "$TMP"
	rm -f "$TMP.min"

	# AND CHECK AGAIN, on what actually ships. The check above validated the squeeze's
	# INPUT — while the squeeze is the pass most capable of corrupting the sheet: it is the
	# one that tracks strings, joins lines and deletes the `;` before a `}`. Its output was
	# never looked at. A rule count that survives it unchanged is what says so.
	RULES_AFTER=$(brace_count "$TMP") || exit 1
	if [ "$RULES_BEFORE" != "$RULES_AFTER" ]; then
		echo "build-css: the squeeze changed the rule count ($RULES_BEFORE -> $RULES_AFTER)." >&2
		exit 1
	fi
else
	# --dev keeps comments AND formatting: this output is for reading, not shipping
	rm -f "$TMP.min"
fi

mv "$TMP" "$OUT"
trap - EXIT

SIZE=$(wc -c < "$OUT" | tr -d ' ')
echo "build-css: $SIZE bytes -> $OUT"

# SIZE BUDGET. uhttpd ships no compression at all (there is no gzip code in it —
# docs/18), so every byte here is a byte on the wire, on a device whose whole point
# is to be small. The gate is deliberately checked only for the real minified build.
# Raise it consciously, or not at all.
#
# The FLOOR is not symmetry for its own sake: the only gate on the finished file used to be
# an upper bound, so every way of producing a *short* file — a truncated write, a full disk,
# a squeeze that ate the tail — passed the build and shipped a stylesheet with its second
# half missing. An upper bound cannot see that; the rule-count check above catches the gross
# case, and this catches the rest.
BUDGET=${FS_CSS_BUDGET:-117760}   # 115 KB — the sheet is ~109 KB, so this is real headroom, not slack
FLOOR=${FS_CSS_FLOOR:-81920}      # 80 KB — well under the real sheet; only a mangled build lands here
if [ "$DEV" -eq 0 ] && [ "$SIZE" -gt "$BUDGET" ]; then
	echo "build-css: cascade.css is $SIZE bytes, over the $BUDGET-byte budget." >&2
	echo "build-css: uhttpd cannot compress it, so this is $SIZE bytes on the wire." >&2
	exit 1
fi
if [ "$DEV" -eq 0 ] && [ "$SIZE" -lt "$FLOOR" ]; then
	echo "build-css: cascade.css is only $SIZE bytes, under the $FLOOR-byte floor." >&2
	echo "build-css: that is not a smaller stylesheet, that is a broken one." >&2
	exit 1
fi
