#!/usr/bin/env bash
# TEST_17_PR332: Codespaces regression diagnostics + CORE build.
set -uo pipefail
cd "$(dirname "$0")/.."
mkdir -p diagnostics
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
LOG="$PWD/diagnostics/TEST_17_codespaces_$STAMP.log"
exec > >(tee -a "$LOG") 2>&1
echo "=== TEST_17_PR332 ==="
echo "Log: $LOG"
echo "Branch: $(git branch --show-current)"
echo "HEAD: $(git rev-parse HEAD)"
node --version || true
python --version || true
FAILED=0
run() {
  echo
  printf '>>>'
  printf ' %q' "$@"
  echo
  if "$@"; then
    echo "PASS: $*"
  else
    rc=$?
    echo "FAILED (exit=$rc): $*"
    FAILED=$((FAILED+1))
  fi
}
for test in \
  tests/test_kpi_sql_projection_test17.js \
  tests/test_runtime_kpi_projection_test17.js \
  tests/test_diagnostic_v2_test16.js \
  tests/test_heavy_job_gate_test15.js \
  tests/test_kpi_preemption_test15.js \
  tests/test_diagnostic_sessions_test15.js \
  tests/test_kpi_task_scheduler.js \
  tests/test_runtime_derived_lazy_test14.js \
  tests/test_kpi_snapshot_cache_test14.js \
  tests/test_runtime_lazy_test13.js \
  tests/test_runtime_data_repository.js \
  tests/test_reliability_report_service.js \
  tests/test_diagnostics_history_test13.js \
  tests/test_diagnostics_indexeddb_test13.js \
  tests/test_diagnostics_test12.js \
  tests/test_xlsx_export_diagnostics_test11.js \
  tests/test_database_oom_diagnostics.js \
  tests/test_dataset_single_xlsx_protocol.js \
  tests/test_dataset_single_xlsx_stream.js \
  tests/test_sqlite_mobile_brigade_paged_export.js \
  tests/test_dataset_export_long_text.js \
  tests/test_worker_client.js \
  tests/test_mb_worker_recycling.js \
  tests/test_database_oom_post_commit_release.js
do
  if [[ -f "$test" ]]; then
    run node "$test"
  else
    echo "FAILED: missing $test"
    FAILED=$((FAILED+1))
  fi
done
for test in test_js_fragment_contract.py test_database_workspace_contract.py test_build_test_label.py test_architecture_guardrails.py; do
  run python -m unittest discover -s tests -p "$test"
done
echo "TOTAL FAILED CHECKS: $FAILED"
if (( FAILED > 0 )); then
  echo "CORE build skipped. Full log: $LOG"
  exit 1
fi
run python build/build.py --test-label TEST_17_PR332
if (( FAILED > 0 )); then
  echo "CORE build failed. Full log: $LOG"
  exit 1
fi
echo "=== BUILT ==="
if ! ls -lh dist/*_CORE_TEST_17_PR332.html; then
  echo "FAILED: CORE artifact missing after successful build"
  echo "Full log: $LOG"
  exit 1
fi
echo "=== LOG: $LOG ==="
