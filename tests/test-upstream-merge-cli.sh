#!/usr/bin/env bash
set -euo pipefail

repo="$(cd "$(dirname "$0")/.." && pwd)"
merge="$repo/scripts/upstream-merge.py"
fail=0
note() { printf '%s\n' "$*"; }

tmpdir="$(mktemp -d "${TMPDIR:-/tmp}/pstack-merge.XXXXXX")"
trap 'rm -rf "$tmpdir"' EXIT

if python3 "$merge" >/dev/null 2>"$tmpdir/usage.err"; then
  note "FAIL: merge with no args should exit 2"
  fail=1
else
  code=$?
  if [ "$code" -eq 2 ] && grep -q 'usage: python3 scripts/upstream-merge.py' "$tmpdir/usage.err"; then
    note "ok: missing argv exits 2 with usage"
  else
    note "FAIL: missing argv code=$code stderr=$(cat "$tmpdir/usage.err")"
    fail=1
  fi
fi

if python3 "$merge" "$tmpdir/missing.json" >/dev/null 2>"$tmpdir/missing.err"; then
  note "FAIL: missing audit file should exit 2"
  fail=1
else
  if grep -q 'cannot read audit' "$tmpdir/missing.err"; then
    note "ok: missing audit file is refused"
  else
    note "FAIL: missing file stderr=$(cat "$tmpdir/missing.err")"
    fail=1
  fi
fi

printf '{' >"$tmpdir/bad.json"
if python3 "$merge" "$tmpdir/bad.json" >/dev/null 2>"$tmpdir/bad.err"; then
  note "FAIL: invalid JSON should exit 2"
  fail=1
else
  if grep -q 'invalid audit JSON' "$tmpdir/bad.err"; then
    note "ok: invalid JSON is refused"
  else
    note "FAIL: invalid JSON stderr=$(cat "$tmpdir/bad.err")"
    fail=1
  fi
fi

printf '{}' >"$tmpdir/empty.json"
if python3 "$merge" "$tmpdir/empty.json" >/dev/null 2>"$tmpdir/empty.err"; then
  note "FAIL: empty object should exit 2"
  fail=1
else
  if grep -q 'missing required fields' "$tmpdir/empty.err"; then
    note "ok: incomplete audit is refused"
  else
    note "FAIL: empty object stderr=$(cat "$tmpdir/empty.err")"
    fail=1
  fi
fi

if [ "$fail" -ne 0 ]; then
  exit 1
fi
note "ok: upstream-merge CLI contract"
