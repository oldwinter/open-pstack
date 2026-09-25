#!/usr/bin/env bash
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOG_SH="$HERE/log.sh"
WORK="$(mktemp -d "${TMPDIR:-/tmp}/pstack-log-test.XXXXXX")"

cleanup() {
  rm -rf -- "$WORK"
}
trap cleanup EXIT

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

run_log() {
  set +e
  "$@" >"$WORK/stdout" 2>"$WORK/stderr"
  status=$?
  set -e
}

run_log bash "$LOG_SH" --help
[ "$status" -eq 2 ] || fail "bare --help should exit 2, got $status"
grep -Fq 'usage: log.sh <logfile> <phase> <decision> <why> <evidence> <result>' "$WORK/stderr" ||
  fail "missing usage"
grep -Fq 'try: log.sh decisions.tsv frame decided because evidence accepted' "$WORK/stderr" ||
  fail "missing try line"
[ ! -e "$HERE/--help" ] || fail "created a --help logfile next to the script"

run_log bash "$LOG_SH" --help frame decided because evidence result extra
[ "$status" -eq 2 ] || fail "--help with extra args should exit 2, got $status"
[ ! -e "$HERE/--help" ] || fail "treated --help as a logfile"
[ ! -d "$HERE/--help" ] || fail "mkdir --help"

run_log bash "$LOG_SH" -h
[ "$status" -eq 2 ] || fail "bare -h should exit 2, got $status"

logfile="$WORK/decisions.tsv"
run_log bash "$LOG_SH" "$logfile" frame decided because evidence accepted
[ "$status" -eq 0 ] || fail "valid row should exit 0, got $status"
[ -f "$logfile" ] || fail "expected $logfile"
grep -Fq $'phase\tdecision\twhy\tevidence\tresult' "$logfile" || fail "missing header"
grep -Fq $'frame\tdecided\tbecause\tevidence\taccepted' "$logfile" || fail "missing row"

echo "log.sh help and append tests passed."
