# ITSM module boundary

ITSM is split into five responsibilities.

## `src/js/modules/itsm/dataset_schema.js`

Versioned `itsm_data` contract. Dataset schema 1.2.0 stores one record per processed
ITSM row and contains 51 fields:

- 17 lifecycle/source-context fields, including full request description and closure note;
- all 34 result fields produced by ITSM Rules.

The full processed XLSX remains a 61-column deliverable. The Dataset is the persistent
analytical projection, not a replacement for that workbook.

## `src/js/modules/itsm/rules.js`

Pure business rules. It does not read Excel, touch the DOM, download files, or depend on application state.

Public contract:

- `buildLookups(references)` — prepares normalized lookup indexes;
- `evaluateRow(input, lookups, { asOfDate })` — calculates one ITSM row;
- `outputColumns` — fixed 34-column result contract;
- `version` — ITSM Rules version.

The golden regression fixture in `tests/fixtures/itsm/golden_cases.json` protects this layer.

## `src/js/modules/itsm/config.js`

Declarative module metadata and required Reference dependencies. It also registers
`itsm_data` in Dataset Pipeline as a non-empty `events` Dataset.

## `src/js/modules/itsm/ui.js`

Browser adapter and Dataset lifecycle:

1. restores only a user-provided local HTML snapshot when the legacy local-only mode is used;
2. validates that the eight required Reference datasets are ready;
3. reads the selected File to an ArrayBuffer;
4. transfers the buffer and references to the WebWorker;
5. receives the finished XLSX and normalized ITSM Dataset;
6. downloads the XLSX immediately;
7. exposes the Dataset as a candidate;
8. commits the candidate only after the user presses «Применить данные»;
9. exposes the active set through `ReclassifierItsmDataset`.

A committed non-embedded ITSM Dataset is automatically eligible for the common HTML snapshot.

## `src/js/workers/itsm_processor.js`

Worker-side Excel processor:

1. reads XLSX with SheetJS;
2. maps source columns to normalized ITSM input;
3. calls `ReclassifierItsmRules.evaluateRow()`;
4. writes the 34 returned values to AB:BI;
5. builds the 51-field ITSM Dataset from 17 source/context fields and the same 34 returned values;
6. serializes the finished workbook to an ArrayBuffer.

The Dataset therefore does not recalculate ITSM business logic independently. Its final
34 fields are the exact array already written to the output workbook.

## Runtime data

The repository and CORE build contain no ITSM records or embedded baseline. ITSM
records are created from user-selected workbooks and persisted in the connected
SQLite database. The CORE build starts empty and does not fetch corporate data.

## Business algorithm 1.2.0

For each source row the rules perform this sequence:

1. determine INC/RITM from the request number; user-cancelled requests follow the exclusion branch;
2. enrich the row from Mobile Brigade Data by request number: mounted equipment uses `transport`, stationary equipment uses `equipmentUnit`; unique identifiers are joined and labor hours are summed across all matching MB tasks. If the request is missing, compare its `Дата создания Вызова` with `latestSourceDate` MB: a covered date returns `нет в МБ`, a newer/unknown date returns `нет данных МБ`; `рез6` is `0` in both missing cases;
3. apply Reclassification by request number and use the resulting equipment / element / fault / reason as the final classification;
4. resolve Drivers by final equipment and calculate total quantity, territory quantity, service and system;
5. resolve Initiators, Customers and TypeRequest;
6. calculate classification quality and the request type after reclassification;
7. resolve ProblemGrade by the exact four-level classifier key and determine PRB / normalization;
8. calculate Sputnik exclusion: cancelled/RITM first, then the dedicated Северный reason table, otherwise general Exceptions;
9. calculate ЦГПС normalization;
10. calculate SLA hours, pre-backlog, backlog level, opening/closing calendar fields and completion within the last 14 days;
11. return the fixed 34-column output contract written to AB:BI and reused verbatim in ITSM Dataset.

Backlog thresholds for open requests are: BL1 0–7 days, BL2 >7–14, BL3 >14–21, BL4-A >21–30, BL5-F >30 days.

All Excel pickers and dropzones use the shared selection adapter in
`app/dataset_pipeline.js`. Candidate rejection never changes the active ITSM Dataset.


## Input safety

The Worker scans up to the first 100 rows of every worksheet and accepts only a row
that satisfies the complete required ITSM header contract. A partial four-column row
cannot shadow a valid header below it. User-facing validation reports the actual
Russian column names rather than internal field ids.

The calculated output remains fixed at AB:BI for compatibility. Before writing, the
Worker verifies that this region is empty or already contains the exact ITSM output
headers. Unknown headers or values in AB:BI stop processing so source data cannot be
silently overwritten.

The browser shell also locks source selection, clearing and navigation while baseline
data is still loading or while a module Worker operation is active. ITSM checks the
operation id and selected File again before downloading or publishing a candidate
Dataset, which prevents stale Worker results from being applied.

## PR 1 — связь с Мобильными бригадами по номеру обращения

Независимый модуль `mb_presence.js` сопоставляет `ITSM.number` и `mobile_brigade_data.request` и формирует человекочитаемое поле `Наличие заявки в МБ` (`mbPresence`). В Excel колонка BJ добавлена после неизменённых 34 расчётных полей AB:BI, в компактном Dataset — 52-е поле. Для старой сохранённой истории статус `Нет данных МБ` означает отсутствие подтверждения, а не отсутствие заявки. При последующей оценке качества классификации связь следует определять по актуальным данным МБ (не по сохранённому снимку). Подробнее: `docs/architecture/itsm_mb_presence_pr1.md`.
