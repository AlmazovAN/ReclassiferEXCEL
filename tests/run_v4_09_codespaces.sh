#!/usr/bin/env bash
# Strict V4-09 acceptance; does not exit the caller's interactive shell.
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG="${HOME}/v4-09-codespaces.log"
PASS=0; FAIL=0
: > "$LOG"
cd "$ROOT" || exit 2
check(){
  local label="$1"; shift
  printf 'RUN %s\n' "$label" | tee -a "$LOG"
  if "$@" >> "$LOG" 2>&1; then PASS=$((PASS+1)); printf 'PASS %s\n' "$label" | tee -a "$LOG"
  else FAIL=$((FAIL+1)); printf 'FAIL %s\n' "$label" | tee -a "$LOG"; fi
}
check "V4-09 failure selection" node tests/test_reclassification_failure_v4_09.js
check "V4-08 element regression" node tests/test_reclassification_elements_v4_08.js
check "V4-07 object regression" node tests/test_reclassification_objects_v4_07.js
check "V4-06 evidence regression" node tests/test_reclassification_diagnostics_v4_06.js
check "V4-01 legacy" node tests/test_reclassification_legacy_v4_01.js
check "CORE build" python build/build.py
check "V4-06 Browser/Worker bundle" node tests/test_reclassification_v4_06_build.js
check "V4-07 Browser/Worker bundle" node tests/test_reclassification_v4_07_build.js
check "XLSX worker integration" node tests/test_reclassification_worker_processor.js
check "5k synthetic load" node tests/test_reclassification_load_pr7.js
printf 'V4-09: %s PASS / %s FAIL\n' "$PASS" "$FAIL" | tee -a "$LOG"
[ "$FAIL" -eq 0 ]
