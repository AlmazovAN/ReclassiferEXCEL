# KPI calculation architecture contract

Status: accepted architecture baseline for the current Reclassifier KPI work.

Target extension for KPI passports, card comparisons, dynamics and audit trace:
[docs/architecture/kpi_passport_target_model.md](kpi_passport_target_model.md) (Step 1 design contract).
This does not replace the calculation architecture, KPI Results or Report Snapshot.

Implemented read-only KPI Catalog (Step 2): [catalog documentation](kpi_catalog_step2.md).
It binds existing Calculator definitions to audited source-field, join, filter, aggregation and time declarations; it is not a new calculation engine.

Step 3 binds Catalog IDs/source dependencies to the existing Report Service and adds an optional immutable `snapshot.kpiView` projection for card comparison and KPI month series: [Step 3 contract](kpi_report_view_step3.md). The legacy Report Snapshot WEB/PDF fields remain compatible.


## 1. Purpose

This contract fixes the boundaries between processed source Datasets, KPI preparation logic,
mathematical KPI formulas, report results and presentation layers.

It deliberately does not define the business formula of any specific KPI. Those formulas and
their official methodologies are implemented and versioned separately.

## 2. Current source model

The current event sources are:

- ITSM Sirius Data;
- Mobile Brigade Data.

Reference and equipment Datasets may enrich those event Datasets through existing processing
and calculated fields.

The wide processed ITSM and Mobile Brigade Datasets remain the analytical fact base. They must
not be replaced by one universal physical KPI aggregate table.

Future sources such as costs or spare parts are outside the current scope. When introduced,
they are added as independent Datasets and connected only to the KPI modules that need them.

## 3. Canonical calculation flow

```text
Processed Dataset(s)
        |
        v
KPI preparation
        |
        v
Calculation components
        |
        v
KPI formula
        |
        v
KPI Result
        |
        v
Report Snapshot
      /        \
     v          v
    WEB        PDF
```

### Processed Dataset

Owns row-level processed facts, semantic calculated fields, source links and Dataset metadata.

It may contain wide records because preserving detail is intentional.

It must not contain presentation-specific KPI status, chart data or PDF formatting.

### KPI preparation

Owns the extraction, filtering, joining and aggregation required by one KPI or one closely
related KPI family.

Examples:

- derive `failureCount` from post-reclassification INC with `ИсклВБР-Спутник = Считать отказом` (completedAt first, closedAt fallback), and `equipmentCount` from valid Drivers quantities in `шт` for VBR;
- derive `avrLaborHours` and `totalLaborHours` for AVR labor share;
- derive SLA numerator and denominator.

Preparation logic is expected to change more often than the mathematical formula.

Preparation must use semantic Dataset fields/contracts, not visible Excel captions or UI labels.

Different KPI modules may use different aggregation grain. No common mega-grain is required.

### KPI formula

Owns only the mathematical transformation of already prepared calculation components.

A formula must be pure: no UI, no SQLite, no Excel parsing, no Dataset mutation and no hidden
source lookups.

Formula changes are expected to be rare and must be independently versioned and tested.

### KPI Result

Represents the result of one KPI calculation.

The target contract is expected to carry at least:

- KPI identifier;
- value;
- unit;
- numerator / denominator or other named components where applicable;
- data state;
- methodology / calculation version;
- requested period and filters;
- source Dataset revisions / provenance;
- calculation timestamp.

The exact runtime schema will be introduced together with the KPI Calculator layer.

### Report Snapshot

Owns one coherent, immutable report calculation for a selected period and filter state.

It combines KPI Results. It does not recalculate source facts.

WEB and PDF must render the same Report Snapshot. Neither renderer may independently calculate
official KPI values.

## 4. Existing KPI Source status

`src/js/modules/itsm/kpi_source.js` is an existing compact monthly aggregate of processed ITSM
rows.

Its current role is auxiliary and ITSM-specific.

It is not:

- the universal analytical storage for every KPI;
- the mandatory source for all future KPI calculations;
- the Report Snapshot;
- a substitute for the wide ITSM or Mobile Brigade Dataset.

During the current architecture work it remains unchanged unless a later KPI implementation
demonstrates a concrete need to reuse or refactor it.

## 5. No universal KPI mega-table

A single physical table containing all KPI dimensions is not an architectural requirement.

Different subjects naturally require different grain, for example:

- failures: period x mine x equipment type;
- labor: period x mine x work type x equipment;
- SLA: period x mine x service/request type;
- future costs: their own source-specific grain.

Forcing these facts into one shared mega-grain risks sparse dimensions, duplicated values,
incorrect denominators and unnecessary loss of row-level detail.

If a KPI needs an aggregate, that aggregate belongs to its preparation logic or subject family.

## 6. Source fact semantics

`src/js/kpi/source_facts.js` is the pure semantic projection boundary between processed
Datasets and KPI-specific preparation.

It does not calculate final KPI coefficients. It only turns already-processed fields into
stable source facts and rejects unsafe implicit interpretations.

### Drivers — VBR equipment denominator (KPI-01)

The validated `drivers` reference is the VBR equipment population. Each normalized Drivers
cell has `mine`, `name` (the ITSM `Наим1` equipment label), `service`, `system`,
`value`, `unit`, and `valueState`. Select only non-negative integer values marked as
`value` with `unit = шт`, and recognizable service class (`mounted` / `stationary`).
Exclude the aggregate mine `Все рудники` to prevent double counting. Sum all valid source
rows by physical mine, service and equipment name; multiple systems may contribute to the
same group. Never multiply a Driver quantity by the number of ITSM incidents.

The legacy repeated ITSM field `driversByMine` is **not** summed: it repeats reference data
for every request and would overstate the denominator. Non-count units such as `км` are
excluded, with diagnostics.

Drivers is a **fixed undated reference**, not an equipment-history table. Use its current
quantities as an explicitly disclosed constant monthly baseline. For multi-month ranges,
the denominator is the sum of monthly exposures (`baseline units × number of selected
calendar months`); this is an equipment-month convention, not a historical inventory or
an estimate of equipment additions/decommissions.

### Equipment catalogs (not VBR denominator)

`Equipment_Combined` remains a separate runtime Dataset for equipment catalog purposes.
Its `equipmentPopulationSnapshot` source helper still supports unique active-ID snapshots
and has `supportsHistoricalPeriods = false`, but the VBR Calculator no longer consumes it.

### ITSM

Processed ITSM rows expose semantic source facts for:

- request type after reclassification;
- failure-accounting decision;
- classification quality inclusion/success;
- SLA state when the raw overdue flag is available;
- linked PRB identifier;
- already-calculated ITSM durations and linked MB labor.

These facts interpret processed semantic fields; they do not re-run ITSM classification.

### Mobile Brigade and Problem Management

Mobile Brigade remains the primary row-level labor source.

For Problem Management analysis, MB task rows are joined to processed ITSM by request number.
The resulting rows preserve `finalTaskType`, labor value/state and PRB link per MB task.
Missing/invalid/legacy-unknown labor is not converted to zero.

This preserves the ability to calculate PRB coverage by labor and by work type later without
collapsing all MB work into ITSM `result6LaborHours`.

### Existing KPI Source

The persisted ITSM KPI Source may still contain the `equipmentCount` field for compatibility,
but processed ITSM rows no longer populate it from `driversByMine`.

`equipmentCount` can only be set through the explicit equipment seed API until a later KPI
preparation layer connects a validated Equipment snapshot.

## 7. Preparation layer implementation

Step 4 implements KPI preparation as a set of independent subject component tables under
`src/js/kpi/preparation/`.

The orchestrator returns `architecture = subject-component-tables`. It deliberately does not
return one shared `rows` array.

Current component families are:

| Family | Main grain | Components / rule |
| --- | --- | --- |
| failures.events | completion month for request counts; completion-or-closure month for VBR failures x branch x mine x equipment type x equipment name | INC/RITM counts by completion only, VBR failures by first valid completion/closure date, integrated failures, duration sums |
| failures.downtime | creation month x branch x mine x equipment type x equipment name | failure downtime hours; kept separate because its period basis differs |
| equipment | Drivers reference: physical mine x service x equipment name | sum of valid integer quantities in шт.; aggregate «Все рудники» excluded |
| labor | MB fact month x site x final task type x equipment placement/type/name | task counts, usable/unusable labor rows, labor hours |
| SLA | close month x branch x mine x equipment type x equipment name | success, overdue and denominator counts |
| classification | close month x branch x mine x equipment type x equipment name | success, failure and denominator counts |
| PRB | MB fact month x branch x mine x final task type x PRB-link state x PRB | task/labor totals and linked task/labor totals |

The families must not be joined into one physical mega-grain during preparation.

### Data quality is part of the component contract

Preparation never silently converts an unavailable value into a valid zero.

Examples:

- MB labor with `missing`, `invalid` or `legacy_unknown` is excluded from labor-hour sums
  and counted in unusable-row diagnostics;
- unknown SLA state is excluded from the SLA denominator and counted separately;
- classification categories outside the approved denominator are counted as not applicable;
- Drivers is an undated fixed reference and keeps `supportsHistoricalPeriods = false`; the KPI explicitly uses its quantities as a constant baseline over report months.

The future formula layer must receive these prepared components and their diagnostics. It must
not re-read raw source rows to reconstruct a different denominator.

### No final KPI calculation in preparation

Preparation may calculate additive facts such as counts and duration sums.

It must not calculate final ratios, percentages, targets, statuses or report-card values.
Those belong to the formula / KPI Result layer.

## 8. Formula / KPI Calculator implementation

Step 5 implements the first real formulas under `src/js/kpi/calculator/`.

The calculator accepts only the Step 4 subject component tables. It does not read processed
ITSM/MB rows, source facts, SQLite, Excel or UI state.

Implemented KPI IDs:

| KPI | Formula / meaning |
| --- | --- |
| `vbr` | `(1 - FailureCount / EquipmentCount) x 100` |
| `sla` | `SlaSuccessCount / SlaTotalCount x 100` |
| `classification_quality` | `ClassificationSuccessCount / ClassificationTotalCount x 100` |
| `total_labor` | sum of usable MB labor hours |
| `avr_labor` | labor hours where FinalTaskType = `АВР` |
| `avr_share` | `AvrLaborHours / TotalLaborHours x 100` |
| `maintenance_labor` | labor hours for `ТО по графику` + `ТО вне графика` |
| `corrective_labor` | labor hours for `Корректирующее воздействие` |
| `reactive_share` | `(АВР + Корректирующее воздействие) / TotalLaborHours x 100` |
| `problem_coverage_absolute` | linked-to-PRB usable labor hours |
| `problem_coverage_relative` | `LinkedLaborHours / LaborHours x 100` |

### KPI Result contract

Each formula returns an immutable KPI Result with:

- stable KPI ID and title;
- numeric value or `null`;
- unit;
- `dataState` and machine-readable `reason`;
- formula text and formula version;
- methodology status;
- named calculation components;
- normalized requested period / filters;
- source component-table IDs;
- diagnostics.

The pure calculator does not add a current timestamp. `calculatedAt` belongs to the future
Report Snapshot builder so repeated calls with identical inputs remain deterministic.

Targets, traffic-light status and presentation formatting are also outside the formula layer.

### KTG aggregation grain and VBR January observation integrity (0.32.22)

KTG fleet and work rows have potentially different equipmentType taxonomies.
For the displayed mine/class aggregate (and for multi-mine/class unions),
matching is based on `mine × equipmentClass`; equipmentType is still
retained in the work/fleet preparation dimensions and surfaced as divergence
diagnostics. Only explicit equipmentType query filters require identical types,
to avoid attributing known MB hours to a nonmatching type. The candidate
equipment population always remains uniquely active Equipment_Combined IDs.
No proportional allocation or ITSM equipment-name matching is invented.
MB `finalTaskType` is the analytical field «Итоговый тип задачи»; when this
analytical field is absent and the row-aligned Full Dataset exists, either the
current or older full-column title may recover the exact value.

VBR requires an ITSM observation basis in each reported calendar month.
The report calendar can also include MB-only months, but these MUST NOT be
treated as proven zero-failure ITSM months simply because Drivers stock exists.
A period with no dated ITSM INC/RITM source events has a no-data VBR; an
interval with only partial ITSM observation is insufficient. A mine/class with
zero selected failures remains a valid zero when the global reporting period
contains ITSM observations. VBR diagnostics record global and filtered INC
and failure counts, unidentified classes and missing source-observation months,
and the passport displays this evidence. Two confirmed compound Kaierkansky
shaft labels are normalized to the physical Ангидрит and Известняков mines;
other compound territories are not guessed.

that a user's private SQLite has the same content. Browser-level checks must
compare the active embedded SQLite chart against these aggregated source facts.

### KTG MB astronomical-hour recovery and selected population composition (0.32.21)

KTG keeps the original Equipment_Combined unique-active-stock × 24h × calendar
days model and only four effective Mobile Brigade final task categories:
АВР, ТО по графику, ТО вне графика, Корректирующее воздействие.
`mobile_brigade_data.records` may lack `finalTaskType` or `astroHours`
even though those fields exist in the corresponding row of the Full Dataset.
The KTG preparer accepts row-aligned `fullDataset` and recovers missing
analytical fields from its named original columns, but **only** when
`fullDataset.rows.length === records.length`; it never joins unrelated
files by a guessed position. It parses finite nonnegative numeric and
comma-decimal astronomical hour values, never uses labor-hours as an
estimated substitute. Source and transformation quality counters are
reported in KTG `ktg_work.meta` and attached to the passport's preparation
trace.

Each KTG group uses `period × mine × equipmentClass × equipmentType`.
Equipment names from ITSM and Equipment_Combined are NOT used for the
work-hour grouping. Row-aligned MB task types with missing classification
are retained as unclassified group counts. The calculator returns
`insufficient/task-classification-incomplete` for a selected group with
unclassified tasks rather than assuming zero downtime and displaying 100%.
Missing astro hours and unmatched Equipment_Combined groups likewise
remain unavailable. Selected source work quantities and hours for AVR,
scheduled TO, unscheduled TO and corrective are included in the result
diagnostics; the actual components remain the sole source for the formula.
The passport explicitly separates full-input preparation diagnostics from
selected groups and their component sums.

The chart's KTG formula now reuses `buildKpiSelectionSummary('ktg',...)`
over the UNION of selected mines/equipment classes and month range; its
independent selectors for series/month are removed. It displays
`(calendarHours - avrHours - actualMaintenanceHours - correctiveHours) /
(calendarHours - plannedMaintenanceHours) × 100`, where
`actualMaintenanceHours = plannedMaintenanceHours + unplannedMaintenanceHours`.
No second sum of unscheduled TO occurs. VBR and the other KPI calculators
are unchanged.

### VBR combined selector and calendar-interval evaluation (0.32.20)

The VBR formula underneath the comparative chart is a SINGLE Calculator result
for the UNION of selected physical mines and selected equipment classes, for
the exact inclusive calendar-month interval. «Все» absorbs every overlapping
mine selection; «ЗФ» expands to individual Zapolyarny branch mines; Sets
deduplicate overlapping selections. Failure events and equipment are filtered
with the same union. No sum or arithmetic average of existing mine KPI
percentages is used. Calendar exposure is the current reference Drivers stock
multiplied by the number of selected calendar months, not just months with
recorded failure events. The canonical KPI fields `completedAt` first and
`closedAt` fallback determine the event month, not an unrelated display
field «МесЗакр». Month abbreviations are presentation aliases for this
canonical event period.

The VBR-only paired range handles drive both the visual chart viewport and
the single period Calculator summary. The four preset buttons reset both
handles. The series continue to use the previously introduced cache and
moving-trend lookback. Other KPI formula panels keep their independent
selectors to avoid mixing unrelated calculation aggregation rules. Numeric
point labels are opt-in and all actual series lines are solid; the branch and
equipment class are distinguished by tone.

VBR's formal passport defines exposure as \(E=\sum N_m\) and under the
current fixed-Drivers assumption \(E=N_0\times M\) equipment-months.
KTG's formal passport expands Tпростоя into planned ТО, АВР and
unscheduled maintenance/corrective works exactly once. No original KPI
Calculator formula is changed; weekly VBR requires a separately approved
reporting grain and day-level preparation.

### Comparative chart viewport and performance profiling (PR 6)

`buildKpiChartMultiData` accepts optional fifth argument
`{range:'1m'|'3m'|'1y'|'all', window:1..12}`. Legacy callers with no
fifth argument still request all history. The modal passes its selected
viewport and rolling window. 1M/3M/1G fetch only 2/4/13 most recent
calendar months ending in the selected reporting month, with `window-1`
older months included for valid left-edge rolling results. "Все"
fetches the full history. Sparse month sequences preserve chronological
gaps, which appear as no-data points, not synthetic events.

A bounded, source-version-invalidated point cache stores immutable single-KPI
calculator results keyed by KPI, calendar month and normalized mine/equipment
filters. Cold first viewport executes only requested month/line combinations;
growing a range or adding another mine only computes missing keys. This avoids
repeated use of `ReportViewModel.create` for all catalog KPIs and their
forecasts for each comparative chart series. The single-KPI result projection
preserves `value`, `dataState`, `reason`, `components` and
`formulaVersion` of the original report view. Placeholder KPIs still report
`not-applicable` without calling a nonexistent calculator. Invalidation
follows the same source revision, fingerprint and object-identity checks as
the PR4 snapshot caches.

Offline Chromium acceptance profiles cold/warm Report Snapshot, six chart
series with 13 months, warm chart, full history and the passport's initial
DOM/first frame versus completed calculations. CI logs timings as diagnostics
and does not claim a speedup without measuring the same baseline on matched
hardware. Separate numeric equivalence tests cover the correct lookback and
full-vs-cropped moving series. KPI formulas and PDF exports are unchanged.

### Indexed monthly KPI component selection (PR 5)

`CalculatorCommon.selectRows` preserves its legacy filter sequence, returned
rows, period semantics and exact Execution Trace selection stages. Frozen
ComponentTable objects and frozen row arrays receive an internal lazy WeakMap
index of `period → rows`, and lazily indexed first-dimensional scalar filters
for unperiodized selections (e.g. Drivers/active fleet). Repeated one-month
queries retrieve the period bucket directly, without scanning all historical
rows or reparsing dates. Multi-month range filters keep the previous full-scan
path to guarantee the original row order and trace counts; array-valued
filters and mutable legacy tables use their original selection semantics.

`CalculatorCommon.latestMonth` finds and caches the latest month as part
of the period index, without sorting arrays. VBR and KTG call this helper only
when no explicit period was supplied. The Report Service also memoizes its
immutable filter catalog by prepared bundle identity, avoiding repeated
catalog scans for additional periods or slices on the same Dataset revision.

Indexes and catalogs are strictly performance aids, not additional data
sources, and are collected with old prepared tables after Dataset revision.
All formulas, selected sums, source/trace diagnostics and status rules remain
unchanged. Performance is not asserted against a fragile fixed wall-time
threshold in CI; PR 6 will add representative browser timing profiles.

### Runtime calculation caching and passport first paint (PR 4)

Report Service memoizes immutable full Report Snapshots by the selected
period/mine/equipmentClass and current source fingerprint. A separate bounded
cache holds monthly KPI Results by mine/equipment filters and the same source
fingerprint; changing only the selected month reuses that series. Both caches
have an 8-entry upper bound (LRU eviction) and are entirely in-memory.
Any ITSM, MB, Drivers or Equipment_Combined revision, hash, freshness,
source object identity or explicit `invalidate()` resets both caches as well
as prepared components. `getCachedSnapshot(state)` only returns an identical
previously built report and never silently computes a new one.
An explicitly supplied `buildSnapshot(...,{now})` bypasses the full-snapshot
cache so caller-requested timestamps remain faithful, while still using
safe immutable component history if unchanged.

The KPI passports route paints its 18 catalog definitions immediately and
schedules a snapshot read/recalculation only after initial rendering; on
return from the dashboard a warm cached snapshot can populate the current
passport without recalculating. The delayed handler checks DOM route identity
and query filters before work and before updating output, so it does not
overwrite another route or a changed report selection. Source-trace data
still comes only from the actual Calculator. No KPI formula is changed.
PR 5 will optimize repeated selection within the first cold calculation.

### KPI chart numerical tiles (PR 3)

The chart modal has an interactive month and series selector. The tiles read ONLY
already-calculated monthly KPI Result components from `seriesById.points[].components`;
they never recompute the classification, work hours, fleet, filter selection or KPI.

For KTG, the displayed fraction is
`(calendarHours - avrHours - actualMaintenanceHours - correctiveHours)
 / (calendarHours - plannedMaintenanceHours) × 100`.
`actualMaintenanceHours` includes planned and unscheduled maintenance;
`plannedMaintenanceHours` is only actual scheduled TO (temporary planning
assumption). KFRV and DFRV explanations disclose the fixed-current fleet and
astronomical-work-hour unavailability approximation.
For VBR, tiles show
`(equipmentCount - failureCount) / equipmentCount × 100`, algebraically
equivalent to the Calculator's `(1 - failureCount/equipmentCount) × 100`.
Other KPI cards show their source components with a link to the passport
methodology, without depicting a made-up formula.
No chart points without an `available` KPI Result may display fake zero
components. Monthly numerical tiles are not rolling-period totals.

### Comparative KPI charts (PR 2)

Comparative series are independent Calculator results using exactly the same prepared
component bundle; mine filters can be a list of physical mines. "ЗФ" covers the
eight named Zapolyarny branch mines, excluding "Северный" (КФ); "Все" uses no
mine filter. A global/multi-mine coefficient is never an arithmetic average of
percentages or of rounded mine results. At most 3 mine/aggregate selections and
2 equipment classes create up to 6 lines. Stationary is blue, mounted green,
with separate dash patterns for the mine selections.

The right edge is the selected report month. Buttons 1М / 3М / 1Г / Все display
2 / 4 / 13 / all months without changing the calculation date grain. Full
history is retained in the series and rolling computations before viewport clipping.
Rolling window 1 disables the trend; 2–12 use complete consecutive periods and
do not bridge gaps. For VBR the rolling value is
`(1 - sum(failureCount)/sum(equipmentCount)) * 100`; for KTG it is
`sum(productiveHours)/sum(availableHours) * 100`. Both use fixed present-day
equipment reference data over historical months and are estimates, never evidence
of historically unchanged inventory. PR 3 will add dynamic arithmetic tiles.

### KTG: calendar fund and MB astronomical duration (draft)

`ktg` uses independent `mobile_brigade_data` and `combined` sources. The KTG fleet
component counts distinct active equipment IDs by mine, Mounted/Stationary class and
equipment_type; the operational status is already calculated from `not_working_since`.
The KTG work component groups `astroHours` by MB factDate, site, class, equipmentType
and finalTaskType. No row-level equipment-ID JOIN is performed. Tasks with unmatched
equipment types or missing astro hours cause an unavailable selected result, not a zero.

CalendarHours = active equipment units × 24 × calendar days (including leap years).
ActualDowntimeHours includes АВР, ТО по графику, ТО вне графика and
Корректирующее воздействие. PlannedMaintenanceHours equals fact duration of
ТО по графику as a temporary approximation with no maintenance schedule:
KTG = (CalendarHours − ActualDowntimeHours) /
(CalendarHours − PlannedMaintenanceHours) × 100%.

This estimate is not direct telemetry of the outage duration. Equipment_Combined is
a current fixed snapshot without history. Location is preserved in fleet data, but
location filtering cannot be applied to downtime without a verified task-to-equipment
identifier join; this remains outside KPI-02 PR 1. Full assumptions and glossary:
[KTG draft methodology](../methodology/ktg_draft.md).

### VBR numerator: engineering reclassification and date fallback

The VBR numerator uses the already-processed ITSM fields `INC после рекласс` and `ИсклВБР-Спутник`: only final `INC` and `Считать отказом` contribute a failure event. The engineering classification fields (`Наим1`, `Элем1`, `Неис1`, `Прич1`) are calculated by ITSM processing, not recomputed in the KPI Calculator. Sputnik exclusions use `Прич1`: the Exceptions reference for general mines, with dedicated Northern mine rules applied by ITSM. The failure month comes from `Дата выполнения обращения` if valid, otherwise from `Дата закрытия`. With neither date, the event is excluded from monthly VBR; this is recorded diagnostically. Request counts and other KPI time bases are unchanged.

### VBR denominator and reporting periods

For a monthly KPI, count valid Driver quantities (`шт`) for the selected physical mine,
service (mounted/stationary) and ITSM equipment name `Наим1`. Do not include the `Все рудники`
summary column when physical mine rows are present. A month with zero recorded failures and
a positive Drivers denominator returns 100%.

For a quarterly, annual or custom multi-month KPI, sum failure events across selected months
and multiply the corresponding fixed Drivers baseline by the number of ITSM-observed calendar months (never unobserved months):
`VBR = (1 - Σ failures / (DriverEquipmentCount × MonthCount)) × 100%`. This is a
declared equipment-month convention using a **single undated reference revision**; when only some requested months have ITSM observations, the output is labeled partial and lists excluded months; an interval with zero observed months is unavailable. it
must never be presented as historical equipment stock. Snapshot/source trace retains the
Drivers revision and reference freshness.

The formula is not clamped to the interval 0..100. If FailureCount exceeds EquipmentCount,
the mathematical result is preserved and a diagnostic flag is added rather than silently
changing the approved components.

### Data-state rules

A zero denominator never causes a JavaScript division result to leak into reporting.

Examples:

- no valid Drivers denominator (шт) -> VBR `no-data`;
- no SLA denominator -> SLA `no-data`;
- no classification denominator -> classification quality `no-data`;
- labor rows with no usable labor values -> labor KPI `no-data`;
- Problem Management rows with no usable labor -> labor coverage `no-data`.

A real `valid_zero` labor observation remains a usable zero.

All currently implemented formula definitions carry `methodologyStatus = draft`. The code
therefore implements the current application calculation contract without claiming that an
external formal methodology has been approved.

## 9. Report Snapshot and Dashboard integration

Step 6 introduces `src/js/kpi/report_snapshot.js` as the immutable report hand-off contract
and `src/js/app/reliability_report_service.js` as the runtime adapter that produces it.

The runtime path is now:

```text
Runtime Dataset Repository
          |
          v
      Source Facts
          |
          v
   KPI Preparation
          |
          v
     KPI Calculator
          |
          v
    Report Snapshot
          |
          v
        WEB
          |
          +---- future PDF reads the same Snapshot
```

### Snapshot contents

One Reliability Report Snapshot freezes:

- resolved period, mine and equipment-class filters;
- all KPI Results for the selected slice;
- monthly KPI Results used by charts;
- report breakdowns such as MB labor structure and PRB linkage state;
- source availability, schema version, active revision, content hash and freshness where available;
- preparation/calculator versions;
- calculation timestamp;
- report diagnostics.

The Snapshot owns the timestamp. Formula modules remain deterministic and timestamp-free.

### Source revisions and cache invalidation

The report service reads current Dataset instances only through
`ReclassifierRuntimeDataRepository`.

Prepared components may be cached in memory, but the cache key includes source availability,
active revision, content hash, freshness, loaded timestamp, row count and validation/dependency
state. A changed Dataset therefore causes preparation to be rebuilt before the next Snapshot.

The Dashboard does not read SQLite, Dataset Registry or source rows directly.

### Shared filter dimensions

The report service normalizes two cross-source dimensions before the Dashboard sees them:

- mine names remove only the technical leading prefix `Рудник `;
- equipment class is the stable semantic value `mounted` / `stationary`.

The same selected filter is then applied to ITSM, Mobile Brigade and Drivers-derived equipment component
tables. Unsupported dimensions are never approximated by volume coefficients or offsets.

### No demo calculation path

`reliability_dashboard_data.js` is now a presentation template only. It contains card order,
titles and explicit placeholders, not KPI values.

The previous demo scaling/offset model is removed from the report path. The Dashboard must not
contain `volumeFactor`, quality/technical/service offsets or Problem Management share offsets.

A KPI that has no implemented calculator is rendered as `not-applicable` / not connected.
A KPI whose calculator exists but whose required source is missing keeps the calculator
metadata and returns `source-missing` / `no-data`.

This means the WEB report cannot silently fall back to prototype numbers.

### WEB/PDF boundary

WEB and PDF now consume the same already-built Report Snapshot.

`src/js/app/reliability_pdf.js` is a presentation-only renderer. The Dashboard passes its
current immutable Snapshot directly to `ReclassifierReliabilityPdfRenderer.download(snapshot)`.
The PDF layer must not read the Runtime Repository, Source Facts, Preparation, Calculator,
SQLite or XLSX and must not create a replacement Snapshot.

The renderer creates A4 canvas pages in the browser and packages the rendered JPEG pages into
a PDF 1.4 document locally. This keeps the release fully offline and avoids a second PDF font or
vendor dependency; Cyrillic text is rendered by the browser before PDF assembly.

Every PDF carries a deterministic Snapshot fingerprint in:

- the report header/footer;
- the downloaded filename;
- an ASCII PDF comment in the file bytes.

The fingerprint is derived from the selected query, KPI Results, component values, formula
versions and source revision/freshness metadata. It therefore provides a simple identity check
that WEB handed the intended Snapshot to PDF without recalculation.

## 10. Layer boundaries

### Presentation layer

`reliability_dashboard.js` and future PDF rendering code may:

- render KPI Results and Report Snapshot metadata;
- format values;
- draw cards, charts and KPI passports;
- manage transient presentation state.

They must not:

- query SQLite directly;
- parse Excel;
- classify source rows;
- derive official KPI numerators or denominators;
- duplicate KPI formulas;
- mutate source Datasets.

### KPI calculation layer

Future KPI preparation and formula modules may read source data only through approved runtime
Dataset/repository contracts.

They must not render UI or write source Datasets as a side effect of calculating a report.

### Storage / Dataset layer

Dataset Catalog, Dataset Lifecycle and Runtime Repository keep their existing responsibilities.

The KPI architecture does not replace or bypass them.

## 11. Change rule

When a KPI result must change, first classify the change:

1. Source or semantic field changed -> update Dataset processing / enrichment if required.
2. Definition of a calculation component changed -> update KPI preparation logic.
3. Mathematical relationship changed -> update the KPI formula and its methodology version.
4. Only appearance changed -> update WEB/PDF renderer; calculation code must remain untouched.

This separation is the primary maintenance rule for KPI development.

## 12. Guardrails

Automated architecture tests must keep at least these constraints:

- Dashboard cannot access SQLite/repository internals or the ITSM KPI Source directly.
- Dashboard must remain a renderer, not an official KPI calculator.
- Existing ITSM KPI Source must stay free of UI, persistence and Excel I/O.
- Future KPI formula modules must be pure.
- WEB and PDF must eventually consume Report Snapshot rather than calculate independently.

Business correctness is protected separately by KPI-specific golden/control tests introduced
when real formulas are implemented.
