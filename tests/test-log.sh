#!/usr/bin/env bash
set -euo pipefail

repo="$(cd "$(dirname "$0")/.." && pwd)"
logsh="$repo/plugins/pstack/skills/show-me-your-work/scripts/log.sh"
fail=0
note() { printf '%s\n' "$*"; }

tmpdir="$(mktemp -d "${TMPDIR:-/tmp}/pstack-log.XXXXXX")"
trap 'rm -rf "$tmpdir"' EXIT

if "$logsh" >/dev/null 2>"$tmpdir/usage.err"; then
  note "FAIL: log.sh with no args should exit 1"
  fail=1
else
  if grep -q 'usage: log.sh' "$tmpdir/usage.err"; then
    note "ok: missing args print usage"
  else
    note "FAIL: missing args did not print usage"
    fail=1
  fi
fi

logfile="$tmpdir/nested/dir/decisions.tsv"
"$logsh" "$logfile" "phase one" $'line\twith\ttabs' "=SUM(A1)" $'evidence\nnewline' "@cmd"
header="$(sed -n '1p' "$logfile")"
row="$(sed -n '2p' "$logfile")"
if [ "$header" = $'ts\tphase\tdecision\twhy\tevidence\tresult' ]; then
  note "ok: first write creates the TSV header"
else
  note "FAIL: header: $header"
  fail=1
fi
if printf '%s' "$row" | grep -q $'\t'; then
  :
else
  note "FAIL: row is not TSV"
  fail=1
fi
if printf '%s' "$row" | grep -q $'\tphase one\t'; then
  note "ok: phase cell is preserved"
else
  note "FAIL: phase cell missing: $row"
  fail=1
fi
if printf '%s' "$row" | grep -q $'\tline with tabs\t'; then
  note "ok: tabs in cells become spaces"
else
  note "FAIL: tabs not stripped: $row"
  fail=1
fi
if printf '%s' "$row" | grep -q $'\t\'=SUM(A1)\t'; then
  note "ok: formula-leading why is quoted"
else
  note "FAIL: formula why not quoted: $row"
  fail=1
fi
if printf '%s' "$row" | grep -q $'\tevidence newline\t'; then
  note "ok: newlines in cells become spaces"
else
  note "FAIL: newlines not stripped: $row"
  fail=1
fi
if printf '%s' "$row" | grep -q $'\t\'@cmd$'; then
  note "ok: @-leading result is quoted"
else
  note "FAIL: @ result not quoted: $row"
  fail=1
fi

"$logsh" "$logfile" phase-two decision why evidence result
if [ "$(wc -l < "$logfile" | tr -d ' ')" = 3 ]; then
  note "ok: second write appends without a second header"
else
  note "FAIL: expected 3 lines after second write"
  fail=1
fi

if [ "$fail" -ne 0 ]; then
  exit 1
fi
note "ok: log.sh contract"
