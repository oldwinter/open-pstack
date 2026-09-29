#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PROBE="$REPO_ROOT/scripts/upstream-merge-probe.py"
MERGE="$REPO_ROOT/scripts/upstream-merge.py"
AUDIT="$REPO_ROOT/scripts/upstream-audit.py"

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

set +e
invalid_ref_output=$(python3 "$AUDIT" --port does-not-exist --upstream also-missing 2>&1)
invalid_ref_status=$?
set -e

[[ "$invalid_ref_status" -eq 2 ]] || fail "invalid audit ref exited $invalid_ref_status instead of 2"
[[ "$invalid_ref_output" == *"port ref 'does-not-exist' is not a commit"* ]] || fail "invalid audit ref did not identify the port ref"
[[ "$invalid_ref_output" != *"Traceback"* ]] || fail "invalid audit ref printed a traceback"

scope_root=$(mktemp -d "${TMPDIR:-/tmp}/open-pstack-merge-scope.XXXXXX")
scope_tree="$scope_root/tree"
cleanup_scope() {
  git -C "$REPO_ROOT" worktree remove --force "$scope_tree" >/dev/null 2>&1 || true
  rmdir "$scope_root" >/dev/null 2>&1 || true
}
trap cleanup_scope EXIT
git -C "$REPO_ROOT" worktree add --detach -q "$scope_tree" HEAD
cp "$MERGE" "$scope_tree/scripts/upstream-merge.py"
scope_head=$(git -C "$scope_tree" rev-parse HEAD)
python3 - "$scope_tree/audit.json" "$scope_head" <<'PY'
import json
import sys

path, head = sys.argv[1:]
json.dump({
    "port_commit": head,
    "upstream_base": head,
    "upstream_target": head,
    "changes": [{
        "upstream_path": "UPSTREAM.md",
        "port_path": "README.md",
        "change": "add",
        "comparison": "upstream-addition",
        "target": {"mode": "100644"},
    }],
}, open(path, "w"))
PY
set +e
scope_output=$(cd "$scope_tree" && python3 scripts/upstream-merge.py audit.json 2>&1)
scope_status=$?
set -e
[[ "$scope_status" -eq 2 ]] || fail "out-of-scope merge path exited $scope_status instead of 2"
[[ "$scope_output" == *"outside the mapped port tree: README.md"* ]] || fail "out-of-scope merge path lacked a boundary error"
[[ -z "$(git -C "$scope_tree" status --porcelain -- README.md)" ]] || fail "out-of-scope merge path changed README.md"
cleanup_scope
trap - EXIT

echo "Upstream script CLI boundaries passed"
