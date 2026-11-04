# TEST_13_PR322 — Persistent Diagnostics + Runtime selective cache

## Scope

- Only the diagnostic build label `TEST_13_PR322` enables the Runtime optimizations in this branch.
- Existing `main`, business rules, SQL table schema, imports, classification and XLSX contents remain unchanged.
- `runtimeList()` under SQLite returns metadata-first instances. Accessing `active.records` or `active.fullDataset` still loads the real SQLite data as required by consumers.
- Targeted `runtimeInvalidate(['changed_id'])` invalidates only the changed persisted Dataset cache and dependent derived caches. Full invalidation on database open/close still clears all caches.
- KPI `hasInputs` uses Registry counts in TEST_13, not `datasetStore.get(id).records.length`.

## Diagnostic retention and crash recovery

New `src/js/app/diagnostic_history.js` is included BEFORE the old Runtime log.
It collects both journal types: `runtime`, `xlsx`.

Each accepted event:
1. Gets an unambiguous session ID and sequential event number.
2. Is synchronously checkpointed as a separate `localStorage` WAL record.
3. Is queued for an IndexedDB transaction to append to the unbounded `events` store.
4. The WAL entry is removed **only after** transaction `complete`.
5. The two existing loggers keep small in-memory/latest-localStorage windows, but JSON exports merge **all** archive sessions and events, not just 320/360 recent events.

On reload `recoverWal()` replays WAL entries into IndexedDB; sessions and their entries are not purged on new imports/exports or on browser restart.

Status fields:
- `indexedDB: available | unavailable | blocked | error`
- `walPending`, `pendingWrites`, `error`
- `eventsRecovered` and `completenessKnown`.

**Important limitations:** neither JS IndexedDB nor localStorage guarantee durability if the OS/browser crashes before storage is committed, the browser clears site data, the private session ends, storage quota is exceeded, or `file://` uses a different storage partition. `completenessKnown=false` is expected when IndexedDB is unavailable; do not claim all events are guaranteed. Data is bound to the exact browser profile and file origin. A test browser restart is mandatory before relying on crash recovery.

No raw Excel/SQLite cells, record keys or user document names are added to journals. Downloading JSON is a requested operation, not proof of file persistence on OS disk.

### What the user should do

1. Close older test HTML tabs. Open `*_CORE_TEST_13_PR322.html` in Opera.
2. In **Работа с базой данных**, inspect the Runtime log status before connecting SQLite.
3. Connect the same read-only copy of `Reclassifier.db`.
4. Navigate the database/reference list and observe materialization count.
5. Export 2025-01-01 to 2025-01-31 Full Dataset (11,650 dated full rows in TEST_12).
6. Save XLSX and **both** reports (Runtime and XLSX). Opera may require multi-download permission.
7. Navigate/reopen the same HTML file and verify the buttons can export history again. If the
   report says `indexedDB=unavailable`, collect reports frequently; the localStorage WAL has a
   finite quota and a hard OS crash may lose it.
8. Optional second test: update one small reference Dataset on a **copy** of the DB; check that
   unrelated Dataset materializations are not repeated. Preserve the base DB separately.
9. Do not store corporate originals in GitHub.

### Follow-up

If TEST_13 confirms reduced Runtime `materializations` and no regressions, develop SQL
keyset export and streaming XLSX in separate changes. `TEST_13` does **not** repair the
original OOM cause; it addresses the eager Runtime path and makes crash diagnosis more resilient.

## Codespaces

```bash
cd /workspaces/Reclassifer
git fetch origin
git switch feature/pr322-sqlite-mb-paged-xlsx-export
git pull --ff-only origin feature/pr322-sqlite-mb-paged-xlsx-export
set -euo pipefail

node tests/test_diagnostics_history_test13.js
node tests/test_diagnostics_indexeddb_test13.js
node tests/test_runtime_lazy_test13.js
node tests/test_diagnostics_test12.js
node tests/test_xlsx_export_diagnostics_test11.js
node tests/test_database_oom_diagnostics.js
node tests/test_runtime_data_repository.js
node tests/test_dataset_single_xlsx_stream.js
node tests/test_dataset_single_xlsx_protocol.js
node tests/test_sqlite_mobile_brigade_paged_export.js
node tests/test_worker_client.js
node tests/test_mb_worker_recycling.js

python -m unittest discover -s tests -p 'test_js_fragment_contract.py'
python -m unittest discover -s tests -p 'test_database_workspace_contract.py'
python -m unittest discover -s tests -p 'test_architecture_guardrails.py'
python -m unittest discover -s tests -p 'test_build_test_label.py'

python build/build.py --core --test-label TEST_13_PR322
ls -lh dist/*_CORE_TEST_13_PR322.html
```

Do not merge PR #322 while Draft until verified in target Opera on a DB copy.
