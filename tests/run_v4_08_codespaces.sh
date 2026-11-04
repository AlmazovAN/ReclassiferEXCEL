#!/usr/bin/env bash
# V4-08 strict Codespaces acceptance runner (execute with bash).
# No interactive shell termination; the script itself returns nonzero on failure.
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG="${HOME}/v4-08-codespaces.log"
PASS=0
FAIL=0
: > "$LOG"
cd "$ROOT" || exit 2
check(){
  local label="$1"; shift
  printf 'RUN %s\n' "$label" | tee -a "$LOG"
  if "$@" >> "$LOG" 2>&1; then
    PASS=$((PASS+1)); printf 'PASS %s\n' "$label" | tee -a "$LOG"
  else
    FAIL=$((FAIL+1)); printf 'FAIL %s\n' "$label" | tee -a "$LOG"
  fi
}
check "V4-08 independent element" node tests/test_reclassification_elements_v4_08.js
check "V4-07 object regression" node tests/test_reclassification_objects_v4_07.js
check "V4-06 evidence regression" node tests/test_reclassification_diagnostics_v4_06.js
check "V4-01 legacy" node tests/test_reclassification_legacy_v4_01.js
check "CORE build" python build/build.py
check "V4-06 Browser/Worker integration" node tests/test_reclassification_v4_06_build.js
check "V4-07 Browser/Worker integration" node tests/test_reclassification_v4_07_build.js
check "Reclassification worker XLSX" node tests/test_reclassification_worker_processor.js
check "Reclassification load 5k" node tests/test_reclassification_load_pr7.js
printf 'V4-08: %s PASS / %s FAIL\n' "$PASS" "$FAIL" | tee -a "$LOG"
if [ "$FAIL" -gt 0 ]; then printf 'See %s\n' "$LOG"; exit 1; fi
