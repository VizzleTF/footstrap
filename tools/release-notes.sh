#!/bin/sh
# Build the GitHub-release body from the CHANGELOG — it is GENERATED, never hand-written,
# so the changelog stays the single source.
#
# Every bullet is `- **one-line effect.** then the rationale` (CLAUDE.md). The bold lead is
# what a release reader wants; the rationale is for maintainers. So the notes are just those
# leads, grouped under their `### Fixed`/`### Added`/… headers. Consequences: a bullet with
# NO bold lead is silently omitted, and an empty section prints no header.
#
# CHANGELOG.md is primary; the CHANGELOG_ru.md mirror's summary is appended under a divider,
# so the release page carries both languages.
#
# Usage: release-notes.sh <version> [changelog-file]
#   <version>  e.g. 0.7.18 (no leading v); matches the `## [0.7.18]` heading.
# Prints to stdout. Pure sh + awk, so the release job needs no node.
set -eu

ver="${1:?usage: release-notes.sh <version> [changelog]}"
changelog="${2:-CHANGELOG.md}"
# the RU mirror sits beside it: CHANGELOG.md -> CHANGELOG_ru.md
changelog_ru="${changelog%.md}_ru.md"

[ -f "$changelog" ] || { echo "no such changelog: $changelog" >&2; exit 1; }

# extract(file): the bold lead of every bullet in the [ver] section, grouped under its `###`
# headers (rationale and empty sections dropped). Same logic for either language. Prints
# nothing if the section is absent.
extract() {
	awk -v ver="$ver" '
		# Print the finished bold title, emitting its section header first the one time a
		# header is still pending — so an empty section never prints a lone header.
		function flush(   t) {
			if (!collecting) return
			t = title
			gsub(/[ \t]+/, " ", t); sub(/^ +/, "", t); sub(/ +$/, "", t)
			if (pending_hdr != "") {
				if (started) print ""        # blank line between sections
				print pending_hdr; pending_hdr = ""; started = 1
			}
			print "- " t
			collecting = 0; title = ""
		}

		# enter the target version section; leave at the next "## [" heading
		$0 ~ ("^## \\[" ver "\\]") { insec = 1; next }
		insec && /^## \[/          { insec = 0 }
		!insec                     { next }

		# a bold title that ran onto the next line(s): accumulate until the closing **
		collecting {
			e = index($0, "**")
			if (e > 0) { title = title " " substr($0, 1, e - 1); flush() }
			else         title = title " " $0
			next
		}

		/^### / { flush(); pending_hdr = $0; next }   # header, held until a bullet prints

		/^- \*\*/ {                                   # bullet: keep only its **bold lead**
			rest = substr($0, index($0, "**") + 2)
			e = index(rest, "**")
			collecting = 1
			if (e > 0) { title = substr(rest, 1, e - 1); flush() }  # closes on this line
			else         title = rest                               # continues below
			next
		}
		# any other line (rationale continuation, blank) is dropped
		END { flush() }
	' "$1"
}

# A tag whose changelog section does not exist is a FAILED release, not a thin one. This is
# the only enforcement of CLAUDE.md's rule (rename [Unreleased], commit that, then tag THAT
# commit): warning to stderr and exiting 0 published a release page reading "See the
# CHANGELOG" for a version the changelog had never heard of.
summary="$(extract "$changelog")"
if [ -z "$summary" ]; then
	echo "error: no '## [$ver]' section in $changelog." >&2
	echo "       Tag a commit that already carries its own changelog entry:" >&2
	echo "       rename [Unreleased] -> [$ver], commit, then tag that commit." >&2
	exit 1
fi

# The RU mirror must carry the section too. A mirror that lags is worse than none: the release
# page would show the English half only and nobody could tell which file was stale. Both are
# edited in the same commit.
summary_ru=""
if [ -f "$changelog_ru" ]; then
	summary_ru="$(extract "$changelog_ru")"
	if [ -z "$summary_ru" ]; then
		echo "error: no '## [$ver]' section in $changelog_ru (the EN file has one)." >&2
		echo "       CHANGELOG.md and CHANGELOG_ru.md are kept in lockstep." >&2
		exit 1
	fi
fi

cat <<EOF
## luci-theme-footstrap v$ver

$summary
EOF

if [ -n "$summary_ru" ]; then
cat <<EOF

---

$summary_ru
EOF
fi

cat <<EOF

<details><summary>Install</summary>

One-liner (auto-detects apk/ipk):
\`\`\`sh
wget -qO- https://raw.githubusercontent.com/VizzleTF/luci-theme-footstrap/main/install.sh | sh
\`\`\`
</details>
EOF
