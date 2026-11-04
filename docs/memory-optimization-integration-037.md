# Memory optimization integration against Reclassifier 0.37.0

## Baseline
- Base: `main` with `VERSION=0.37.0`.
- Previous validated branch: `feature/v4-pr5-integration-regression`, commit `6da8d4fc`.
- User's Codespaces: quick=12/12, full=16/16, stress=18/18 PASS **on old branch only**.
- Previous stack: #309 diagnostics, #310 deferred export, #311 SheetJS optimization, #312 SQLite batch/ACK, #313 acceptance.

## Integration decisions
1. Start with #309 observability on current `main`; retain newer multisheet `sheetDetails`, skipped-sheet warnings, duplicate logic and XLSX cap. This branch presently implements **only this step**.
2. Transfer #310 and #311 with explicit legacy XLSX export shape checks.
3. Rebase #312 staging onto the current Worker, preserving 21,103-row two-sheet parity and suffix allocation on repeated task IDs; validate rollback and idempotent re-import.
4. Restore #313 regression gate adapted to current paths. Synthetic 50k/120k pass is not proof of Opera RAM safety.
5. Run in corporate Opera: year-long workbook, duplicate tasks, both ZF/KF worksheets, active SQLite DB, repeat UPSERT, optional export, memory checkpoints and crash-free acceptance.

## Compatibility blockers
- `XLSX.read()` still materializes whole XLSX; browser OOM at input parsing is not solved by SQLite batches.
- Existing #313 notes ITSM manual XLSX sheet mismatch vs old `Обращение` + `KPI_Source`; restore compatibility before merge.
- Workers retain dynamically generated Excel in some flows; verify expiry and retry.
- SQLite TEMP table is in WASM memory, not a zero-memory stream.
- Do not merge integration PR without full regression on current main and Opera acceptance.

## Commands, current partial integration
```bash
git fetch origin
git switch integration/memory-optimization-v0.37.0
node tests/test_mb_memory_diagnostics.js
node tests/test_mobile_brigade_multisheet.js
node tests/test_mobile_brigade_zf_kf_21k.js
node tests/test_mobile_brigade_duplicate_recordkeys.js
python build/build.py --core
```


## SQLite batch integration — 5000 rows (2026-10-26)

**Implemented in the integration branch, not in main; Codespaces/Opera acceptance pending.**

- For an active writable SQLite runtime, Mobile Brigade imports use `TEMP.mb_processing_stage`, keep in-Worker staging buffers bounded, send sequential Worker batches, and await ACK after each SQLite write.
- Default `batchSize=5000`; UI choices 500, 1000, 2000, 5000, 10000. Both Worker and SQLite validate 500–10000 and reject oversized batches.
- Duplicate `recordKey` allocation occurs once over the full ordered SQLite stage after every sheet/batch is received. The original key is retained for the first occurrence; subsequent keys use `-dN` and task numbers `-DN`, avoiding genuine-key collisions.
- Preview reports incoming/inserted/matched, duplicate/missing keys, and per-sheet source/accepted/skipped counts. The authoritative Dataset is changed only by a separate explicit atomic `commitMobileBrigadeStage`.
- Excel is **not** generated automatically. Manual export of prepared data and manual period export remain separate actions.
- SQLite TEMP staging consumes WASM memory; initial `XLSX.read` and selected sheet AOA remain in memory. Browser peak RAM must be measured.

### Verify in Codespaces
```bash
git fetch origin
git switch integration/memory-optimization-v0.37.0
git pull --ff-only origin integration/memory-optimization-v0.37.0
node --check src/js/workers/mobile_brigade_processor.js
node --check src/js/modules/mobile_brigade/ui.js
node --check src/js/worker.js
node --check src/js/app/database_core.js
node --check src/js/app/worker_client.js
node tests/test_mb_batch_backpressure.js
node tests/test_mb_worker_sqlite_batches.js
node tests/test_mb_batch_5000_multisheet.js
node tests/test_mobile_brigade_multisheet.js
node tests/test_mobile_brigade_zf_kf_21k.js
node tests/test_mobile_brigade_duplicate_recordkeys.js
node tests/test_mb_memory_diagnostics.js
python build/build.py --core
node tests/test_mb_sqlite_staging.js
```

On an explicit user request, optionally run:
```bash
node --max-old-space-size=4096 tests/test_mb_staging_load.js 50000
node --max-old-space-size=4096 tests/test_mb_staging_load.js 120000
```

**Browser acceptance required:** corporate Opera + actual annual source workbook + connected `Reclassifier.db`; verify both worksheets, 5000-row batches, duplicate suffix allocation, preview, atomic commit/rollback, persisted DB save, and repeat UPSERT.

Do not merge the PR until current-branch checks and browser acceptance have passed.
