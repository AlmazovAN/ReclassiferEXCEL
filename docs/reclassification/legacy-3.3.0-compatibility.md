# Legacy Re-Class 3.3.0 — frozen compatibility contract (V4-01)

## Purpose

Preserve the last verified legacy engine while an independent V4 implementation is introduced.
This document describes **legacy behavior**, not the methodology to be used by V4.

Baseline: `main` commit `fc8db4035b619058337f1511c32ac7c337f8bf14` (18 October 2026).

## Source identity and API

- Frozen source: `src/js/modules/reclassification/rules.js`.
- Git blob SHA-1: `8918f6079b5d18ca78074e831d2555eea7faeda7`.
- Rules version: `3.3.0`.
- Global public object: `globalThis.ReclassifierReclassificationRules` (frozen).
- Public API: `version`, `buildContext`, `evaluateRow`, `classificationQuality`, `stages`, `ordinaryRitmTemplates`.
- Worker entry: `ReclassifierReclassificationWorkerProcessor.process`.
- Front-end calls the `PROCESS_RECLASSIFICATION` worker request.

**Do not replace or edit the legacy source to implement V4.** V4-02 must introduce a separate module and engine selection. If business requirements for V4 differ from legacy (e.g. treatment of ordinary RITM), keep both behaviors testable rather than changing legacy in place.

## Pinned scenarios

`tests/fixtures/reclassification_legacy_v4_01_golden.json` contains synthetic source rows, exact classification tree and expected results for seven cases:

- `KEEP`: retain supported full path;
- `CHANGE`: independently supported corrected full path;
- `RITM_OK`: legacy planned RITM;
- `REVIEW`: partial path without proven cause;
- `BASELINE`: preserved source when evidence is insufficient;
- `PENDING`: no completion or closing date;
- `CANCELLED`: explicit cancellation.

These snapshots are **behavior locks**, not training examples and not labels from an engineer. No corporate descriptions or personnel data are committed.

## XLSX contract

Legacy comparison report: 75 columns on `ITSM`, in the **exact frozen order** of the fixture; first two rows are headings (group headers D:H, I:N, O:T), data starts on row 3, freeze at A3, filter A2:BW(last row). Additional worksheets: `KPI_Source`, `Reclassification`, `Сводка алгоритма`; source workbook supplementary sheets are preserved when supplied.

Separate Re-Class workbook: exactly 10 named columns on a single `Reclassification` sheet. Only `readyForApply=true` records (`CHANGE` and `KEEP`) are exportable. Generating either workbook **does not** apply the proposal to the working reference/SQLite. Applying prepared data remains an explicit user action; the SQLite runtime path must remain read-only for generation.

Both source XLSX and Active Runtime (complete ITSM Full Dataset from HTML or SQLite) remain supported by the existing worker. The fixture test asserts the source-workbook path, exported record content and no in-place reference mutation. The existing tests `test_reclassification_worker_processor.js`, `test_reclassification_runtime_source.js`, `test_reclass_upsert.js`, `test_reclassification_load_pr7.js` provide the expanded runtime, explicit apply, formatting and load coverage.

## How to verify

```bash
node tests/test_reclassification_legacy_v4_01.js
node tests/test_reclassification_rules.js
node tests/test_reclassification_worker_processor.js
node tests/test_reclassification_runtime_source.js
node tests/test_reclass_upsert.js
node --max-old-space-size=2048 tests/test_reclassification_load_pr7.js
python -m unittest discover -s tests -p 'test_*.py'
```

GitHub Actions runs the new V4-01 test alongside the established legacy tests.

## Future rollback

The V4 engine must be integrated through an explicit selector with the unchanged 3.3.0 engine available as a fallback. Re-selecting legacy must route to its original `buildContext/evaluateRow` code and produce the frozen output without using V4 parsing, evidence scoring or candidate selection.

A change to the pinned Git blob hash is **not** an accepted way to fix V4; make a new V4 module or raise an explicit independent legacy-change proposal.
