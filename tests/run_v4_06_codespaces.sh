#!/usr/bin/env bash
# Run as a child process: bash tests/run_v4_06_codespaces.sh [quick|full]
# Never source this file. Default exit 0 protects an interactive errexit shell;
# FAIL count is authoritative. For automation use V4_06_STRICT=1.
set +e
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT" || exit 0
MODE="${1:-quick}"
LOG="${V4_06_LOG_PATH:-$HOME/v4-06-codespaces.log}"
PASSED=0
FAILED=0
BUILD_RC=1
if [[ "$MODE" != quick && "$MODE" != full ]]; then
  printf 'Usage: bash tests/run_v4_06_codespaces.sh [quick|full]\n'
  exit 0
fi
# Existing Excel-date contract compares ISO UTC days. Pin it for reproducibility.
export TZ=UTC
printf '\nV4-06 %s: %s\n' "$MODE" "$(date -u +%FT%TZ)" >> "$LOG"
git rev-parse HEAD >> "$LOG" 2>/dev/null
step() {
  local title="$1"
  shift
  printf '\n>>> %s\n' "$title" | tee -a "$LOG"
  "$@" >> "$LOG" 2>&1
  local code=$?
  LAST_RC=$code
  if (( code == 0 )); then
    PASSED=$((PASSED + 1))
    printf 'PASS: %s\n' "$title" | tee -a "$LOG"
  else
    FAILED=$((FAILED + 1))
    printf 'FAIL (%s): %s\n' "$code" "$title" | tee -a "$LOG"
    tail -n 30 "$LOG"
  fi
}
step 'V4-05 revised technical facts' node tests/test_reclassification_facts_v4_05.js
step 'V4-06 event assessment' node tests/test_reclassification_event_v4_06.js
step 'V4-06 readable diagnostic columns' node tests/test_reclassification_diagnostics_v4_06.js
step 'V4-04 index, collisions, aliases, cause semantics and immutability' node tests/test_reclassification_classifier_index_v4_04.js
step 'V4-04 existing normalizer integration' node tests/test_reclassification_classifier_normalizer_v4_04.js
step 'V4-04 public baseline: every one of 6587 paths' python tests/test_reclassification_classifier_baseline_v4_04.py
step 'Existing Failure Classifier normalizer' node tests/test_failure_classifier_normalizer.js
step 'Existing Failure Classifier baseline contract' python tests/test_failure_classifier_baseline_contract.py
step 'V4-03 synthetic corpus' node tests/test_reclassification_v4_03_corpus.js
step 'V4-03 local manifest syntax' node --check tools/reclassification/v4_03_private_manifest.js
step 'V4-02 engine isolation and fail-fast' node tests/test_reclassification_engines_v4_02.js
step 'V4-01 frozen legacy, A:AH and ReClass 10 golden exports' node tests/test_reclassification_legacy_v4_01.js
step 'Existing legacy rules' node tests/test_reclassification_rules.js
step 'Worker and A:AH and ReClass 10 XLSX contracts (UTC)' node tests/test_reclassification_worker_processor.js
step 'Active Runtime source' node tests/test_reclassification_runtime_source.js
step 'Re-Class UPSERT' node tests/test_reclass_upsert.js
step 'Legacy blob unchanged' bash -c '
  blob="$(git hash-object src/js/modules/reclassification/rules.js)" || exit 1
  echo "$blob"
  test "$blob" = 8918f6079b5d18ca78074e831d2555eea7faeda7
'
if [[ "$MODE" == full ]]; then
  step '5000-row synthetic load' node --max-old-space-size=2048 tests/test_reclassification_load_pr7.js
  step 'Build CORE single HTML' python build/build.py
  BUILD_RC=$LAST_RC
  if (( BUILD_RC == 0 )); then
    step 'V4-02 browser/worker assembly' node tests/test_reclassification_v4_02_build.js
    step 'V4-04 browser/worker index assembly and JS syntax' node tests/test_reclassification_v4_04_build.js
    step 'V4-05 facts assembly' node tests/test_reclassification_v4_05_build.js
    step 'V4-06 facts/event/diagnostics assembly' node tests/test_reclassification_v4_06_build.js
  else
    printf 'SKIP: build inspection; build failed\n' | tee -a "$LOG"
  fi
  step 'Application startup/navigation smoke' node tests/smoke_app_runtime.js
fi
printf '\nV4-06 %s: %s passed / %s failed. Log: %s\n' "$MODE" "$PASSED" "$FAILED" "$LOG" | tee -a "$LOG"
if (( FAILED > 0 )); then
  printf 'FAILED: do not merge. Read FAIL lines and log.\n' | tee -a "$LOG"
else
  printf 'All executed V4-06 checks passed. Real engineering-data acceptance remains separate.\n' | tee -a "$LOG"
fi
if [[ "${V4_06_STRICT:-0}" == 1 ]] && (( FAILED > 0 )); then exit 1; fi
exit 0
