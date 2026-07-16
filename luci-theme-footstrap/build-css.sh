#!/bin/sh
# Concatenate the styles/ tree into a single cascade.css.
#
#   ./build-css.sh [outfile] [--dev]
#
# Dir order = layer order (styles/, base/, theme/, pages/); filename order = source
# order within a dir. A later layer beats an earlier one whatever the specificity, so
# nothing needs !important to override base (declared in styles/00-header.css).
#
# Minified unless --dev: ~255 KB of source -> ~112 KB (-56%). uhttpd serves CSS with NO
# gzip, so every byte is a wire byte. Comments and whitespace go; a selector or a
# declaration is never rewritten, which is why LuCI's csstidy stays off (it mangles
# :has()/color-mix()). Needs only cat/awk, so an OpenWrt buildbot can run it.
set -e

D="$(cd "$(dirname "$0")" && pwd)"
OUT=""
DEV=0
for a in "$@"; do
	case "$a" in
		--dev) DEV=1 ;;
		# An unknown option used to fall through to `OUT="$a"`: a typo like `--devv`
		# wrote the stylesheet to a file named "--devv".
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

# Strip /* ... */, keep /*! ... */ (the licence banner), drop indentation/blank lines.
#
# STRING-AWARE: the old scanner just hunted for the next "/*", so `content: "/*"` would
# open a comment and eat every rule up to the next "*/". Its only guard was the brace
# count below, and two such literals balance each other — rules could vanish in silence.
# Quoted data-URIs run through here on every build.
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

# Squeeze the whitespace CSS ignores — wire AND flash bytes, since uhttpd does not compress.
#
# REMOVED (~9.5 KB): the space after `:`, the spaces around `{ } ; ,`, the last `;` of a block,
# the newline after every declaration (one line per RULE). lightningcss would save ~13 KB, but
# its extra 3.5 KB comes from rewriting colours and merging rules — transforms that can change
# behaviour. These cannot.
#
# LEFT ALONE, each for a reason:
#   - the single space between selectors: `.a .b` is a DESCENDANT combinator, `.a.b` is not.
#     Whitespace runs collapse to one space; that one stays.
#   - spaces inside calc(): required around `*` `/` and the `-` of `calc(100% - 8px)`.
#   - the LINE BREAK inside a declaration — whitespace too. This line-oriented scanner used to
#     join lines with nothing between them, so a wrapped calc() came out `…))- .004 …`; a `-`
#     with no space BEFORE it is a parse error, so the declaration dropped, --fs-tint-c went
#     undefined, --fs-bg became invalid at computed-value time and the canvas fell back to
#     white — silently (export-tier.mjs caught it: contrast 1.5:1). A newline is now treated
#     exactly like a space run.
#   - `>` `+` `~` spaces: stripping them is safe but buys only ~200 bytes.
#   - anything inside a string: every data-URI here is quoted and full of `:` `;` and spaces.
#   - one newline after `}`, so the shipped file stays greppable.
squeeze() {
	awk '
		BEGIN { q = ""; ban = 0; lastc = ""; buf = ""; lastreal = "" }
		{
			line = $0
			# The /*! banner is an Apache-2.0 attribution, not formatting: it must survive
			# BYTE FOR BYTE. Squeezing it made "Twitter, Inc" into "Twitter,Inc" and glued its
			# lines together. Copy it out untouched.
			if (ban) { print line; lastc = ""; lastreal = ""; if (index(line, "*/")) ban = 0; next }
			if (substr(line, 1, 3) == "/*!") {
				print line; lastc = ""; lastreal = ""
				if (!index(substr(line, 4), "*/")) ban = 1
				next
			}
			# The line BREAK we are about to swallow is whitespace, and a declaration may be
			# wrapped across it. Feed it to the whitespace-run logic below as a leading space:
			# it survives only where a space would (between two tokens) and is dropped next to
			# { } ; , : — lastc == "" means output is already at the start of a line, with
			# nothing to glue to.
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
					# the last char EMITTED, which on a continuation line lives on the
					# previous output line — hence lastc, not just `out`.
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
				# THE LAST `;` OF A BLOCK IS REDUNDANT — dropped as the `}` is emitted, i.e.
				# INSIDE the string-aware scanner. It used to be a `| sed "s/;}/}/g"` bolted onto
				# the awk output, and sed cannot see strings: `content: ";}"` came out as
				# `content: "}"`, and a data-URI containing `;}` was corrupted the same way (both
				# reproduced). Nothing in the tree holds that byte pair today — which is how such
				# a bug waits for whoever adds the first one.
				#
				# The `;` may already sit in the previous line output, so text is held in `buf`
				# until the rule closes: a `;` already printed cannot be taken back.
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
			# newline only after a closing brace — one rule per line. lastreal, not lastc: a
			# line ending in a QUOTED `}` (content: "}") is not the end of a rule, and flushing
			# there would split the rule and lose the space before its next token.
			if (lastreal == "}") { print buf; buf = ""; lastc = ""; lastreal = "" }
		}
		END { if (length(buf)) print buf; else printf "\n" }
	' "$1"
}

# Fail loudly rather than let an unbalanced block ship. Braces matched as bracket
# expressions: a bare /{/ is an interval-expression ambiguity some awks reject.
brace_count() {
	awk '{ o += gsub(/[{]/, "&"); c += gsub(/[}]/, "&") } END {
		if (o != c) { printf "build-css: %s: unbalanced braces (%d { vs %d })\n", FILENAME, o, c > "/dev/stderr"; exit 1 }
		if (o < 100) { printf "build-css: %s: suspiciously few rules (%d)\n", FILENAME, o > "/dev/stderr"; exit 1 }
		print o
	}' "$1"
}

# Always brace-check a COMMENT-STRIPPED copy, --dev included: counting braces in the raw
# file made a stray "{" in prose fail the build on perfectly valid CSS.
strip_comments "$TMP" > "$TMP.min"
RULES_BEFORE=$(brace_count "$TMP.min") || exit 1

if [ "$DEV" -eq 0 ]; then
	# comments gone; now squeeze the whitespace CSS ignores
	squeeze "$TMP.min" > "$TMP"
	rm -f "$TMP.min"

	# AND AGAIN, on what actually ships: the check above only saw the squeeze's INPUT, yet
	# the squeeze is the pass most able to corrupt the sheet — it tracks strings, joins lines
	# and deletes the `;` before a `}`. An unchanged rule count is what says it did not.
	RULES_AFTER=$(brace_count "$TMP") || exit 1
	if [ "$RULES_BEFORE" != "$RULES_AFTER" ]; then
		echo "build-css: the squeeze changed the rule count ($RULES_BEFORE -> $RULES_AFTER)." >&2
		exit 1
	fi
else
	# --dev keeps comments AND formatting: this output is for reading, not shipping
	rm -f "$TMP.min"
fi

# BROKEN-BUILD FLOOR (no upper size budget — removed). With only an upper bound, every way of
# producing a SHORT file — a truncated write, a full disk, a squeeze that ate the tail — passed
# and shipped a stylesheet with its second half missing. The floor catches that; it is a
# correctness guard, not a size limit.
#
# Measured on $TMP and BEFORE the mv, with the EXIT trap still armed — like the brace checks above,
# which had this order right. It used to run after, so the guard's own failure path LEFT the mangled
# sheet at $OUT with nothing to clean it up: make aborts in Build/Prepare, fine, but dev-sync.sh
# writes straight into htdocs/luci-static/footstrap/cascade.css, so a truncated sheet stayed in the
# working tree and the CSS-only iterate loop (scp that same file) would ship it.
SIZE=$(wc -c < "$TMP" | tr -d ' ')
FLOOR=${FS_CSS_FLOOR:-81920}      # 80 KB — well under the real sheet; only a mangled build lands here
if [ "$DEV" -eq 0 ] && [ "$SIZE" -lt "$FLOOR" ]; then
	echo "build-css: cascade.css would be only $SIZE bytes, under the $FLOOR-byte floor." >&2
	echo "build-css: that is not a smaller stylesheet, that is a broken one. $OUT left untouched." >&2
	exit 1
fi

mv "$TMP" "$OUT"
trap - EXIT

echo "build-css: $SIZE bytes -> $OUT"
