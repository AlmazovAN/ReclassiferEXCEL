# Forecast Engine 2.0 — PR-2: methods for incomplete reporting months

## Scope

This PR adds a pure, offline `predictReportingMonth()` API and an auditable
registry of component forecast methods. It neither changes KPI Calculator
formulas nor replaces the existing report/chart renderers.

**Important:** PR-2 adds the computation API; PR-3 is responsible for
connecting `Report Snapshot.reportingCoverage.kpis[kpiId]`, monthly history,
and the selected KPI Result to it, then storing the forecast with the
actual result.

The previous `predictCurrentMonth()` API remains available for
backward compatibility. Its clock-based semantics are not a substitute for
certified dataset cut-offs. Callers must migrate to the reporting-month API.

## Contract

```js
ReclassifierKpiForecastEngine.predictReportingMonth({
  kpiId: 'vbr', // or 'ktg'
  selectedMonth: '2026-09', // optional validation of the requested period
  methodId: 'linear-trend', // optional; default is linear-trend
  reportingCoverage: snapshot.reportingCoverage.kpis.vbr,
  current: { // factual result calculated for September
    dataState: 'available', value: 98,
    components: { failureCount: 20, equipmentCount: 1000 }
  },
  points: [ /* factual monthly KPI Results from previous periods */ ]
});
```

The coverage object must have:

- `reportMonthStatus: 'incomplete'`;
- `coverageBasis: 'source-export-cutoff'`;
- `coverageFrom` no later than the first day of the report month;
- `coverageThrough` within the report month, strictly before its last day;
- `reportMonth` matching the certified `coverageThrough` month.

No current date or `new Date()` is consulted by this API. A historical
incomplete month remains eligible for projection when the report runs later.
Missing or uncertified coverage is `insufficient`, not an invitation to
assume that the last observed incident date marks completeness.

A minimum of four certified elapsed reporting days is required in this
experimental implementation.

## Methods

| Method ID | Purpose | Required completed history | Validation |
|---|---|---:|---|
| `observed-run-rate` | Project current observed component count/duration per day to remaining calendar days | 0 months | No independent out-of-sample validation |
| `last-value` | Use the last completed month’s per-day component intensity | 1 month | Baseline, no independent validation |
| `linear-trend` | Fit each component’s historical per-day trend | 8 months (6 training + 2 validation) | Compare MAE against last-value, fallback component-by-component |
| `mixed-components` | Output descriptor only if different components choose different models | Depends on requested method | Per-component |

The `REPORTING_METHODS` registry freezes each method's identifier, version,
label, minimum historical window and validation policy.

For a month `m`, with `d` certified elapsed calendar days and `D` days
in the month, projected component `c` is:

```
projected_c = observed_c + max(0, estimated_daily_rate_c) * (D - d)
```

- `observed-run-rate`: `estimated_daily_rate_c = observed_c / d`.
- `last-value`: `estimated_daily_rate_c = preceding_month_c / preceding_month_days`.
- `linear-trend`: fit the historical daily rates, then validate against
  last-value on the two most recent complete periods; fallback to last-value
  when the linear model's MAE is greater.

The historical component window must be consecutive, fully available, have
nonnegative finite values, and be inside the certified coverage interval.
Invalid months *earlier than the required suffix* do not invalidate that
suffix. Missing/partial months inside it cannot be imputed as zero.

### Formula application (unchanged)

VBR is computed from projected failures and the fixed Drivers population:

`VBR = (1 - projected_failureCount / equipmentCount) * 100`.

KTG projects `incidentHours`, `plannedMaintenanceHours`,
`unplannedMaintenanceHours` and `otherHours`, then applies the existing
component formula and preserves the full monthly calendar fund. Percentages
are bounded to 0–100, and every bound is reported. The fixed Drivers fleet
is **not** a historically reconstructed inventory.

## Auditable forecast result

On success, the immutable object records:

- `forecastType: 'reporting-month-nowcast'` and `horizon` — the reporting month;
- `value`, `observedValue` and `change` — projection, original KPI and delta;
- `strategyId`/`strategyVersion` — month-completion strategy;
- `requestedMethodId` — requested model, e.g. `linear-trend`;
- `methodId`/`methodVersion` — **actual** uniform method, or
  `mixed-components` when component methods differ;
- `methodComponents` — actual model ID, version, rate and validation metrics
  for **each** projected component (no falsely reported linear regression
  when a fallback was used);
- `appliedMethodIds`, `quality`, `bounded`, `caveats`;
- `asOf`, `coverageFrom`, `coverageThrough`, `coverageBasis`,
  `calendarDays`, `elapsedDays`, `remainingDays`;
- `observedComponents` and `projectedComponents`.

Unavailable results have `value:null`, a `dataState` and a `reason`,
e.g. `reporting-cutoff-unconfirmed`, `history-not-certified`,
`noncontiguous-component-history`, `previous-month-missing` or
`invalid-current-component`.

The forecast remains an **experimental projection**, not an official KPI
Result or an approved forecast method. Actual KPI values are never overwritten.

## Scope explicitly deferred

- PR-3: connect the API to a shared Report Snapshot and chart data, with
  independent 8-month forecasting history that does not depend on viewport.
- PR-4: consistent visible forecast, labeled method and numeric provenance in
  KPI passport, dashboard SVG and PDF.
- Certified Dataset cut-off **producer**: the PR-1 consumer contract does not
  invent a source declaration for legacy ITSM/MB datasets.
- Model authorization/selection UI or corporate ML integration: not in scope.
