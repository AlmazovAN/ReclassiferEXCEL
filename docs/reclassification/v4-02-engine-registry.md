# V4-02 — isolated engine registry (internal contract)

Baseline: `e70de867f929acca6d8ac61b7d2ad1c856816907`, merged PR #287.

## Engine contract

- `globalThis.ReclassifierReclassificationRules` (unchanged source and Git blob `8918f6079b5d18ca78074e831d2555eea7faeda7`) remains the legacy 3.3.0 implementation.
- `globalThis.ReclassifierReclassificationRulesV4` is a distinct **unimplemented** 4.0 module.
- `globalThis.ReclassifierReclassificationEngineRegistry` publishes `defaultId`, `ids`, `list()`, `resolve(engineId)`, `requireAvailable(engineId)`.
- Each engine adapter exposes `id`, `version`, `available`, `globalName`, `buildContext(records, options)`, `evaluateRow({row, context})`, `adaptStatus(status)`, `classificationQuality(...)`, `assertAvailable()`.
- The legacy adapter directly delegates original methods. Legacy status mapping is identity for `KEEP`, `CHANGE`, `BASELINE`, `REVIEW`, `RITM_OK`, `PENDING`, `CANCELLED`. No V4 status translation is invented in this PR.
- `resolve(undefined|null)` selects `legacy-3.3`. Unknown or empty IDs raise `RECLASS_ENGINE_UNKNOWN`.
- The V4 placeholder raises `V4_NOT_IMPLEMENTED` with a diagnostic containing `status: UNAVAILABLE`, `engineId`, `version`, `readyForApply: false`. This is an **error**, not a `REVIEW` row or silent legacy fallback.

The worker calls `requireAvailable(payload.engineId)` before classifier/context, standard ITSM processing, workbook creation, exports or UPSERT preparation. The existing UI still passes no engine ID, therefore runs legacy as before. The UI selector is reserved for V4-13.

`rules_v4.js.projectRow()` accepts an allowlist of source facts (request text and service metadata) and drops primary/engineer classification, standard Re-Class, and derived values. V4 is not executed on any row in this PR. Later V4 PRs must not use engineer labels or standard baseline as inference features.

## Verification in GitHub Codespaces

Run from the repository root on branch `feature/v4-02-engine-registry`. Avoid `set -e` in the interactive shell: it exits the terminal at the first failed command, hiding the reason.

```bash
git fetch origin
git switch feature/v4-02-engine-registry
git pull --ff-only origin feature/v4-02-engine-registry
bash tests/run_v4_02_codespaces.sh quick
```

If the quick check reports no failed steps, run the full suite separately:

```bash
bash tests/run_v4_02_codespaces.sh full
```

The runner does not close the terminal on failed tests. Each test's exit code is recorded in `~/v4-02-codespaces.log`; the runner's own exit status intentionally does not indicate success/failure. **Read the final PASS/FAIL summary**, not just the command exit code. To inspect the journal use `tail -n 90 ~/v4-02-codespaces.log`. The full mode includes 5,000-row load, all Python tests, CORE HTML build, embedded worker checks and app smoke test.

The expected hash-object output is `8918f6079b5d18ca78074e831d2555eea7faeda7`. Build products in `dist/` should not be committed. Capture the exit status/results of each command; an unstarted GitHub Actions job is **not a successful CI run**.

Invariants: no changed 3.3.0 decisions, 75-column ITSM and 10-column Reclassification exports, source XLSX/Active Runtime, no generation-time SQLite writes. V4-03 and the later user selector are outside this PR.
