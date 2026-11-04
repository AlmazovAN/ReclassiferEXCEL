# PR-3: Shared KPI monthly facts and forecast results

## Reporting model

The Report Service stores the forecast in the **same immutable monthly result**
that contains KPI Calculator values. Its shape is additive:

```js
snapshot.series.monthly.find(row => row.period === '2026-09')
// {
//   period: '2026-09',
//   vbr: { value: /* factual value */, components: /* factual components */ },
//   ktg: { value: /* factual value */, components: /* factual components */ },
//   forecasts: {
//     vbr: {
//       forecastType: 'reporting-month-nowcast',
//       horizon: '2026-09',
//       value: /* projected end-of-month value */,
//       methodId: 'linear-trend', // or actual last-value / mixed-components
//       methodVersion: '1.0.0',
//       requestedMethodId: 'linear-trend',
//       methodComponents: { failureCount: { methodId: '...', validation: {} } },
//       coverageFrom: '2026-01-01',
//       coverageThrough: '2026-09-15',
//       sourceRevisions: [/* exact source hash/revision provenance */]
//     }
//   }
// }
```

The factual `row.vbr`, `row.ktg`, `snapshot.results`, the official
Calculator and their formula versions remain unchanged. An unavailable
forecast has `value:null`, `dataState` and `reason`. Forecasts are
experimental estimates and must never be exported or labeled as actual KPI.

A single forecast object is shared by:

- `snapshot.series.monthly[].forecasts[kpiId]`;
- `snapshot.kpiView.cards[kpiId].forecast`;
- `snapshot.kpiView.seriesById[kpiId].points[].forecast`.

The linked report method is
`ReclassifierKpiReportViewModel.withForecasts({monthlyResults,reportingCoverage,sources})`.
It reads already calculated actual KPI components and certified coverage from
PR-1, then calls the PR-2 `predictReportingMonth()`. No formulas are
duplicated inside the View Model.

## Cache and filter behavior

The Report Service caches the **decorated monthly array** by source revision
and selected mine/class filters. Changing only the selected report month
reuses the exact monthly array and its forecast objects.

A changed source revision, identity or confirmed reporting cut-off invalidates
the current Snapshot and monthly results. The source cut-off is part of the
existing Report Service source signature. A change in cut-off never modifies
a previously recorded factual KPI value.

For the multi-mine/class/equipment detail chart, a forecast uses the **same
Calculator filters** as the displayed series and an independent preceding
8-calendar-month training window. The forecast's history is not restricted by
the visible `1m`, `3m`, `1y` or `all` viewport. Shared chart-point caches
reuse matching historical Calculator results.

For a custom chart ending **before** the last incomplete reporting month,
no forecast is appended to that historical display. A selected chart ending
at the last incomplete reporting month may show its separate forecast.

## Source and safety requirements

- No cut-off synthesized from the latest incident or today's date.
- Existing legacy datasets without certified `meta.reportingCoverage` have
  unavailable forecasting diagnostics, not an invented forecast.
- The first-stage Snapshot avoids costly full monthly history and therefore
  does not claim a prediction. The full-stage Snapshot calculates and stores
  it when sufficient history is available.
- No cloud services or network requests.

## Follow-ups

- PR-4 will update SVG/card/PDF rendering of
  `forecastType:'reporting-month-nowcast'`, including dashed segments,
  muted values and forecast methodology in KPI passports.
- A separate trusted import/export change is needed to provide certified
  `meta.reportingCoverage` for real ITSM/MB datasets. Without that source
  certificate, the forecast remains unavailable by design.
