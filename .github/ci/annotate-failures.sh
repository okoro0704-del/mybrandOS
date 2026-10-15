#!/usr/bin/env bash
# Turn the failing tests of a node:test run (spec reporter) into GitHub annotations.
#   annotate-failures.sh <suite-log> [known-failures-file]
# A failure listed in the known-failures file is a warning; any other failure is an error that
# carries the first lines of its message. Always exits 0: it reports, the test step decides.
set -uo pipefail
log="$1"; known="${2:-/dev/null}"
[ -f "$log" ] || { echo "::error title=No test log::$log was not written"; exit 0; }
sed -n '/^✖ failing tests/,$p' "$log" | awk -v known="$known" '
  BEGIN { while ((getline k < known) > 0) if (k != "") isknown[k] = 1 }
  function esc(s) { gsub(/%/, "%25", s); gsub(/\r/, "", s); return s }
  function flush() {
    if (name == "") return
    if (name in isknown) printf "::warning title=Known baseline failure::%s\n", esc(name)
    else printf "::error title=Failing test::%s%%0A%s\n", esc(name), detail
    name = ""; detail = ""; lines = 0
  }
  /^test at / { flush(); next }
  /^✖ failing tests/ { next }
  /^✖ / { flush(); name = $0; sub(/^✖ /, "", name); sub(/ \([0-9.]+ms\)$/, "", name); next }
  name != "" && lines < 12 && $0 !~ /^[[:space:]]+at / && $0 !~ /^[[:space:]]*$/ {
    line = $0; sub(/^[[:space:]]+/, "", line); detail = detail (lines ? "%0A" : "") esc(line); lines++
  }
  END { flush() }
'
exit 0
