#!/usr/bin/env bash
# TEST_14: non-destructive diagnosis. Runs the known checks without hiding failures.
set -uo pipefail
cd "$(dirname "$0")/.."
mkdir -p diagnostics
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
LOG="$PWD/diagnostics/TEST_14_codespaces_${STAMP}.log"
exec > >(tee -a "$LOG") 2>&1
echo "=== TEST_14 codespaces diagnostic ==="
echo "Log: $LOG"
echo "UTC: $(date -u +%FT%TZ)"
echo "Branch: $(git branch --show-current 2>/dev/null || echo unknown)"
echo "Commit: $(git rev-parse HEAD 2>/dev/null || echo unknown)"
node --version || true
python --version || true
failures=0
declare -a failed_checks=()
run() {
  local rc
  echo
  printf '>>>'
  printf ' %q' "$@"
  echo
  if "$@"; then
    echo "PASS: $*"
  else
    rc=$?
    echo "FAILED (exit=$rc): $*"
    failures=$((failures+1))
    failed_checks+=("$*")
  fi
}
tests=(
  tests/test_runtime_derived_lazy_test14.js
  tests/test_kpi_snapshot_cache_test14.js
  tests/test_runtime_lazy_test13.js
  tests/test_runtime_data_repository.js
  tests/test_reliability_report_service.js
  tests/test_diagnostics_history_test13.js
  tests/test_diagnostics_indexeddb_test13.js
  tests/test_diagnostics_test12.js
  tests/test_xlsx_export_diagnostics_test11.js
  tests/test_database_oom_diagnostics.js
  tests/test_dataset_single_xlsx_protocol.js
  tests/test_dataset_single_xlsx_stream.js
  tests/test_sqlite_mobile_brigade_paged_export.js
  tests/test_dataset_export_long_text.js
  tests/test_worker_client.js
  tests/test_mb_worker_recycling.js
  tests/test_database_oom_post_commit_release.js
)
for test in "${tests[@]}"; do
  if [[ -f "$test" ]]; then
    run node "$test"
  else
    echo "FAILED: missing test file $test"
    failures=$((failures+1))
    failed_checks+=("missing $test")
  fi
done
for test in test_js_fragment_contract.py test_database_workspace_contract.py test_build_test_label.py test_architecture_guardrails.py; do
  run python -m unittest discover -s tests -p "$test"
done
echo
echo "=========================================="
echo "TOTAL FAILED CHECKS: $failures"
if (( failures > 0 )); then
  printf ' - %s\n' "${failed_checks[@]}"
  echo "Build skipped until failing checks are resolved."
  echo "Diagnostic log: $LOG"
  exit 1
fi
run python build/build.py --test-label TEST_14_PR322
if (( failures > 0 )); then
  echo "Build FAILED. Diagnostic log: $LOG"
  exit 1
fi
echo "Build complete:"
ls -lh dist/*_CORE_TEST_14_PR322.html
echo "Diagnostic log: $LOG"
