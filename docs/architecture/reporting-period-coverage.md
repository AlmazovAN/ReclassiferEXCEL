# Reporting period coverage — PR-1

## Purpose and boundary

Reporting coverage is **source provenance**, separate from KPI values and from the
forecast method. It tells future forecast consumers which calendar days an
export *certifiably* covers. It does not perform any forecasting, change the
KPI Calculator, impute missing requests, or replace the actual monthly series.

In particular:

- `meta.latestSourceDate` for ITSM is the maximum **createdAt of an observed
  request**, not the declared boundary of a complete export.
- `meta.freshness`, `meta.loadedAt`, MB task-date maxima and
  `sourceFreshness`/file-name-derived date ranges are likewise **not** proof
  that all records up to a day were exported.
- `calculatedAt` is the timestamp of running the report, not the report month.
- The fixed Drivers population reference has no observed reporting calendar.

## Opt-in certified source metadata contract

A producer may attach the following object to an ITSM or Mobile Brigade
**runtime Dataset instance**. It must certify the **whole source scope**
(including every relevant mine/site), not just a row, a task, or a file name.

```json
{
  "meta": {
    "reportingCoverage": {
      "confirmed": true,
      "basis": "source-export-cutoff",
      "coverageFrom": "2026-09-01",
      "coverageThrough": "2026-09-15"
    }
  }
}
```

`coverageFrom` and `coverageThrough` must be genuine ISO calendar dates
(`YYYY-MM-DD`) and include the endpoints. The producer must assert that the
export includes all records relevant to its source contract for that interval.
This metadata **must never be generated** from a maximum event date or the
current clock. The producer of future snapshots/imports is responsible for
providing auditable evidence of the declared export boundaries.

If the declaration is absent, unconfirmed, unsupported, invalid, or has
`coverageFrom > coverageThrough`, the coverage status remains `unknown`.
If the source is missing, it is `unavailable`. Neither state implies an
absence of incidents.

At PR-1, existing legacy Datasets do **not** automatically gain a confirmed
cut-off: they expose `unknown` until a producer supplies the certified
metadata. The actual import/export metadata producer is a separate integration
task; PR-1 establishes the consumer contract without fabricating coverage.

## Month classification

For a valid `YYYY-MM` month:

- `complete`: confirmed coverage begins no later than its first day and
  extends through its last calendar day.
- `incomplete`: confirmed coverage begins no later than its first day but
  ends during the month, before its last day.
- `unknown`: no certified cut-off, invalid period, missing beginning of
  the month, or month later than the declared cut-off.

Month length is computed from the reporting month (including leap years), **not
from the machine date**. The primary source used for the reporting calendar is
ITSM for VBR, KTG, SLA and both classification KPI; MB for labor and PRB KPI.
Other dependencies (Drivers, MB linkage) remain required for their KPI
calculation but do not supply the reporting calendar of ITSM metrics.

## Report Snapshot shape

`snapshot.reportingCoverage` is a deeply frozen, additive object:

```js
{
  version: '1.0.0',
  selectedMonth: '2026-09',
  sources: {
    itsm_data: {
      status: 'confirmed',
      coverageFrom: '2026-09-01',
      coverageThrough: '2026-09-15',
      basis: 'source-export-cutoff',
      observedLatestDate: null
    },
    mobile_brigade_data: {status: 'unknown', /* ... */ }
  },
  kpis: {
    vbr: {
      kpiId: 'vbr',
      sourceId: 'itsm_data',
      latestObservedMonth: '2026-09',
      reportMonth: '2026-09',
      reportMonthStatus: 'incomplete',
      selectedMonthStatus: 'incomplete',
      coverageThrough: '2026-09-15'
      // also: reasons, source requirements, period basis, coverageFrom
    }
  }
}
```

The `reportMonth` is the month of the certified source cut-off when known.
Otherwise, it is the most recent observed month from the KPI's prepared
component table, with status `unknown`. A prepared event month newer than a
certified reporting month flags `observations-after-certified-cutoff`;
a forecast must **not** be enabled from such contradictory provenance.

The `selectedMonthStatus` independently describes the month selected in the
report, which can differ from the latest month of the KPI's main source.

Report Snapshot `results`, `series.monthly`, existing card forecasts,
their formulas and current forecast triggers are **unchanged** in PR-1.
PR-2/PR-3 will consume this provenance to select the appropriate historical
incomplete month and record the applied forecast method.

## Acceptance

- 10 October with an ITSM source certified **only through 15 September**:
  September is **incomplete** irrespective of the current calendar month.
- An ITSM source certified through **30 September** with coverage from its
  start: September is **complete**.
- Latest observed ITSM request created on 15 September with no declaration:
  September remains **unknown**, not automatically incomplete.
- An export starting on 5 September cannot certify September as a
  month observed from day one.
- An unavailable MB Dataset stays `unavailable`, not a fake zero.
- Switching report selection does not modify source cut-off metadata or
  recompute KPI formulas.

## Explicit deferred work

1. Wire certified cut-off metadata into the trusted Dataset import/save pipeline
   after the production source can guarantee the boundaries.
2. Have the Forecast Engine consume `reportingCoverage` instead of comparing
   the selected month to the runtime `new Date()`.
3. Publish user-facing explanations and forecast method details in dashboards,
   SVG, PDF and the KPI passport.
