#!/usr/bin/env bash
# Run as child: bash tests/run_v4_05_codespaces.sh [quick|full]
# The inherited runner records failures without closing an interactive terminal.
set +e
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT" || exit 1
MODE="${1:-quick}"
if [[ "$MODE" != quick && "$MODE" != full ]]; then
  printf 'Usage: bash tests/run_v4_05_codespaces.sh [quick|full]\n'
  exit 1
fi
LOG="${V4_05_LOG_PATH:-$HOME/v4-05-codespaces.log}"
export TZ=UTC
FAILED=0
step() {
  printf '\n>>> %s\n' "$1" | tee -a "$LOG"
  "$@" >> "$LOG" 2>&1
  local code=$?
  if (( code != 0 )); then
    FAILED=$((FAILED + 1))
    printf 'FAIL (%s): %s\n' "$code" "$*" | tee -a "$LOG"
    tail -n 30 "$LOG"
  else
    printf 'PASS: %s\n' "$*" | tee -a "$LOG"
  fi
}
printf '\nV4-05 %s %s\n' "$MODE" "$(date -u +%FT%TZ)" >> "$LOG"
step node tests/test_reclassification_facts_v4_05.js
step env V4_04_STRICT=1 V4_04_LOG_PATH="$LOG" bash tests/run_v4_04_codespaces.sh "$MODE"
if [[ "$MODE" == full ]]; then
  step node tests/test_reclassification_v4_05_build.js
fi
printf '\nV4-05: %s failed groups. Log: %s\n' "$FAILED" "$LOG" | tee -a "$LOG"
if [[ "${V4_05_STRICT:-0}" == 1 ]] && (( FAILED > 0 )); then exit 1; fi
exit 0
