# Database Workspace · OOM correction · PR 2/5

## Report-driven motivation

Real Opera trace of 26,934,184-byte annual Excel, 72,283 data rows and
54,753 ITSM records completes `mb-worker-classify/end` but has no subsequent
Worker checkpoints. This does **not** prove the allocation that caused the crash,
but the next steps in the existing code include duplicate key resolution and
automatic construction of a 38-column downloadable XLSX.

## Changes

1. `database_integration.js / integrationPrepareMobileBrigade`: sets
   `deferExport: true` for `PROCESS_MOBILE_BRIGADE` in the **Database Workspace
   candidate** path. The Worker still returns `mobileBrigadeData.records` and
   `mobileBrigadeFullDataset.rows`, and **does not** run `aoa_to_sheet`,
   `sheet_add_aoa` or `XLSX.write`. The standalone explicit export flow
   (without deferExport) remains unchanged. No automatic candidate commit.
2. `database_core.js / getItsmMobileBrigadeLinkRows`: uses a read-only
   prepared SQLite query to select only the `number` and `createdAt` JSON
   positions, based on `dataset_state.fields` and ordered by
   `ordinal, record_key`. It supports legacy object records, checks array
   width/field uniqueness and closes the statement in `finally`.
   **Does not read `dataset_full_records`** or build an in-memory 52-field
   `getDataset('itsm_data')` copy. The returned small rows still go to the
   existing Worker index via `itsmData` unchanged.
3. Repository API contract updated; no database migration or SQL writes.
4. Existing memory diagnostic markers from #317 remain available. The previous
   `mb-itsm-dataset` full-load checkpoint should no longer appear.
   `mb-itsm-projection` now represents the lightweight SQLite projection.

## Explicitly preserved

- ITSM → MB: request number and original creation timestamp, including
  whitespace, absent values and legacy field order.
- MB → ITSM: existing task matching, equipment identity and total labor-hour
  calculations (`НаименованиеТехники`, `рез6`, request presence).
- Mobile Brigade worker output: analytic record keys, `-D1/-D2` duplicate
  handling, `Full Dataset`, stats, timestamps and candidate diff.
- Explicit user download functionality and the existing transactional
  `Подтвердить` workflow.

## Regression commands (Codespaces)

```bash
git fetch origin
git switch feature/pr318-database-oom-defer-export-itsm-links
git pull --ff-only origin feature/pr318-database-oom-defer-export-itsm-links

node tests/test_itsm_sqlite_link_projection.js
node tests/test_mobile_brigade_sqlite_itsm_link.js
node tests/test_mobile_brigade_worker_processor.js
node tests/test_itsm_mobile_brigade_enrichment.js
node tests/test_itsm_mb_link_contract_pr2.js
node tests/test_database_integration.js
node tests/test_database_oom_diagnostics.js
node tests/test_mobile_brigade_zf_kf_21k.js
node tests/test_mb_memory_diagnostics.js
python build/build.py --core
```

If a FULL HTML test artifact is available, run
`node tests/test_sqlite_embedded_itsm_roundtrip.js`. This asserts that **all**
when read from the real WASM SQLite backend. A CORE build alone does not
provide the required FULL artifact.

## Opera acceptance

- Build CORE from this branch, open a **copy** of `Reclassifier.db` and enable
  #317's diagnostic checkbox in **Работа с базой → Загрузить Excel**.
- Import **the same** annual 72,283-row, 26.9 MB Mobile Brigade Excel.
- Confirm that the candidate reaches `candidate-prepare/end` and
  `candidate-sqlite-preview/end`, not merely `mb-worker-classify/end`.
- Inspect the candidate preview; do **not** press `Подтвердить` unless the
  before/incoming/changes/after counts and linked fields are validated.
- Copy the trace and record Opera process memory. If it still fails after
  `classify`, proceed to PR3 (XLSX repeat parsing) / PR4 (SQLite staging)
  instead of increasing batch size in the unused standalone module.

A successful import on one PC is not sufficient to establish a universal memory
limit. This PR has no guarantee of resolving the OOM; it removes two concrete
unnecessary allocations and leaves the deeper architecture for PR3/PR4.
