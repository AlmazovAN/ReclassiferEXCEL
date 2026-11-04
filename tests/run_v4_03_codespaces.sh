#!/usr/bin/env bash
# V4-03 quick tests only. Logs failures and leaves the interactive Codespaces terminal open.
set +e
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT" || exit 0
LOG="$HOME/v4-03-codespaces.log"
PASS=0
FAIL=0
run() {
  local title="$1"
  shift
  printf '\n>>> %s\n' "$title" | tee -a "$LOG"
  "$@" >>"$LOG" 2>&1
  local code=$?
  if (( code == 0 ));then
    PASS=$((PASS+1))
    printf 'PASS: %s\n' "$title" | tee -a "$LOG"
  else
    FAIL=$((FAIL+1))
    printf 'FAIL (%s): %s\n' "$code" "$title" | tee -a "$LOG"
    tail -n 30 "$LOG"
  fi
}
printf '\nV4-03 Codespaces run: %s\n' "$(date -u +%FT%TZ)" >>"$LOG"
run "Synthetic corpus/schema and split tests" node tests/test_reclassification_v4_03_corpus.js
run "Private-manifest script parses and supports help" node --check tools/reclassification/v4_03_private_manifest.js
run "Validator parses" node --check tests/reclassification_v4_03_validator.js
run "Engine/legacy Git blob unchanged" bash -c '
  hash="$(git hash-object src/js/modules/reclassification/rules.js)" || exit 1
  echo "$hash"
  test "$hash" = "8918f6079b5d18ca78074e831d2555eea7faeda7"
'
printf '\nV4-03: %s passed / %s failed. Log: %s\n' "$PASS" "$FAIL" "$LOG"
if (( FAIL == 0 ));then
  printf 'All V4-03 quick checks passed (this does not clear pending V4-02 acceptance).\n'
else
  printf 'Some checks failed. Send the last lines of the log; no merge until validated.\n'
fi
# Preserve terminal even if parent shell enabled errexit. Read printed FAIL count.
exit 0
