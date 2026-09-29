#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PROBE="$REPO_ROOT/scripts/upstream-merge-probe.py"
MERGE="$REPO_ROOT/scripts/upstream-merge.py"

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

set +e
missing_output=$(python3 "$PROBE" 2>&1)
missing_status=$?
set -e

[[ "$missing_status" -eq 2 ]] || fail "missing audit path exited $missing_status instead of 2"
[[ "$missing_output" == *"usage:"* ]] || fail "missing audit path did not print usage"
[[ "$missing_output" != *"Traceback"* ]] || fail "missing audit path printed a traceback"

help_output=$(python3 "$PROBE" --help)
[[ "$help_output" == *"audit JSON produced by upstream-audit.py"* ]] || fail "help omitted the audit argument"

set +e
merge_missing_output=$(python3 "$MERGE" 2>&1)
merge_missing_status=$?
set -e

[[ "$merge_missing_status" -eq 2 ]] || fail "merge missing audit path exited $merge_missing_status instead of 2"
[[ "$merge_missing_output" == *"usage:"* ]] || fail "merge missing audit path did not print usage"
[[ "$merge_missing_output" != *"Traceback"* ]] || fail "merge missing audit path printed a traceback"

echo "Upstream script CLI boundaries passed"
