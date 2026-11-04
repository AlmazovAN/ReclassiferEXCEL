#!/usr/bin/env bash
# V4-02 Codespaces acceptance runner.
# Run with "bash tests/run_v4_02_codespaces.sh quick" first, then "... full".
# Unlike an interactive "set -e", a failed test will not close the terminal.
set +e

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT" || exit 0
MODE="${1:-quick}"
LOG="${V4_02_LOG_PATH:-$HOME/v4-02-codespaces.log}"
FAILURES=0
SUCCESS=0
LAST_RC=0

if [[ "$MODE" != "quick" && "$MODE" != "full" ]]; then
  printf 'Usage: bash tests/run_v4_02_codespaces.sh [quick|full]\n'
  exit 0
fi

{
  printf '\n===================================================\n'
  printf 'V4-02 Codespaces check (%s)\n' "$MODE"
  date -u '+UTC: %Y-%m-%d %H:%M:%S' 2>/dev/null
  git rev-parse --short HEAD 2>/dev/null
  printf '===================================================\n'
} >> "$LOG"

step() {
  local label="$1"
  shift
  printf '\n>>> %s\n' "$label" | tee -a "$LOG"
  "$@" >> "$LOG" 2>&1
  LAST_RC=$?
  if (( LAST_RC == 0 )); then
    SUCCESS=$((SUCCESS + 1))
    printf 'PASS (code 0): %s\n' "$label" | tee -a "$LOG"
  else
    FAILURES=$((FAILURES + 1))
    printf 'FAIL (code %s): %s\n' "$LAST_RC" "$label" | tee -a "$LOG"
    printf '%s\n' '--- Tail of log (last 35 lines) ---'
    tail -n 35 "$LOG"
    printf '%s\n' '--- End of excerpt ---'
  fi
}

step 'V4-02 engine isolation' node tests/test_reclassification_engines_v4_02.js
step 'V4-01 golden legacy 3.3.0' node tests/test_reclassification_legacy_v4_01.js
step 'Legacy classification rules' node tests/test_reclassification_rules.js
step 'Reclassification worker and 75/10 XLSX' node tests/test_reclassification_worker_processor.js
step 'Active Runtime source' node tests/test_reclassification_runtime_source.js
step 'Re-Class UPSERT' node tests/test_reclass_upsert.js
step 'Frozen legacy blob' bash -c '
  value="$(git hash-object src/js/modules/reclassification/rules.js)" || exit 1
  echo "$value"
  test "$value" = "8918f6079b5d18ca78074e831d2555eea7faeda7"
'

if [[ "$MODE" == "full" ]]; then
  step '5000-row synthetic load' node --max-old-space-size=2048 tests/test_reclassification_load_pr7.js
  step 'Python unittest discovery' python -m unittest discover -s tests -p 'test_*.py'
  step 'Build CORE single HTML' python build/build.py
  BUILD_RC=$LAST_RC
  if (( BUILD_RC == 0 )); then
    step 'Check V4-02 engine scripts in CORE HTML and WebWorker' node tests/test_reclassification_v4_02_build.js
  else
    printf 'SKIP: HTML bundle inspection (CORE build failed)\n' | tee -a "$LOG"
  fi
  step 'Browser app startup smoke test' node tests/smoke_app_runtime.js
fi

printf '\n====================================\n' | tee -a "$LOG"
printf 'V4-02 %s: %s passed; %s failed\n' "$MODE" "$SUCCESS" "$FAILURES" | tee -a "$LOG"
printf 'Complete log: %s\n' "$LOG" | tee -a "$LOG"
if (( FAILURES > 0 )); then
  printf 'TESTS FAILED: send the FAIL lines and their preceding error excerpt.\n' | tee -a "$LOG"
else
  printf 'ALL EXECUTED STEPS PASSED (%s).\n' "$MODE" | tee -a "$LOG"
fi

# Intentionally exit zero: never close an interactive Codespaces terminal because
# its shell happened to inherit errexit. Failure is reported prominently above.
exit 0
