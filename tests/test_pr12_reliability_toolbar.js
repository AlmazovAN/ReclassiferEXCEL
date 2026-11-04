'use strict';
// PR12: presentation-only consolidation and explicit calculated KPI refresh.
// Prevent a silent return of stale SQLite Snapshot on an explicit refresh.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const ui=fs.readFileSync('src/js/app/reliability_dashboard.js','utf8');
const service=fs.readFileSync('src/js/app/reliability_report_service.js','utf8');
const css=fs.readFileSync('src/ui/style/05_reliability_dashboard.css','utf8');
const jobs=fs.readFileSync('src/js/app/kpi_background_jobs.js','utf8');
const worker=fs.readFileSync('src/js/workers/kpi_worker.js','utf8');
const expect=(term,msg)=>assert.ok(ui.includes(term),msg||term);
for(const id of ['reliabilityPeriodFilter','reliabilityMineFilter','reliabilityEquipmentFilter',
 'reliabilityFilterReset','reliabilityRefreshKpiButton','reliabilityPdfExportButton'])
 expect(id);
for(const label of ['Рассчитано KPI:','Доступно источников:','Наполнение:'])expect(label);
assert.equal((ui.match(/renderReliabilityFilters\(dashboard\)\}/g)||[]).length,1,
  'Filters belong to one toolbar only');
assert.equal((ui.match(/renderReliabilityEvidence\(snapshot\)\}/g)||[]).length,1);
assert.ok(!ui.includes('class="reliability-active-slice"'));
assert.ok(!ui.includes('class="reliability-report-meta"'));
assert.ok(!ui.includes('<small>текущий Snapshot</small>'));
assert.ok(!ui.includes('График · Report Snapshot'));
assert.ok(ui.indexOf('<a href="#reliability-technical">') <
  ui.indexOf('<a href="#reliability-data-quality">'));
assert.ok(ui.indexOf("id: 'reliability-technical'") <
  ui.indexOf("id: 'reliability-data-quality'"));
assert.ok(ui.includes('reliabilitySectionIcon(id)'));
assert.ok(ui.includes("renderReliabilityDashboard({forceRefresh:true})"));
assert.ok(ui.includes('forceRecalculate:forceRefresh'));
assert.ok(service.includes("!options.forceRecalculate && snapshotCache.has(cacheKey)"));
assert.ok(service.includes("!options.forceRecalculate)"));
assert.ok(service.includes('forceRecalculate:options.forceRecalculate === true'));
assert.ok(jobs.includes('forceRecalculate:forceRecalculate === true'));
assert.ok(worker.includes('forceRecalculate:payload.forceRecalculate === true'));
assert.ok(css.includes('.reliability-toolbar-row'));
assert.ok(css.includes('.reliability-evidence-line'));
console.log('PR12 toolbar: single filter owner, coverage summary, visual order and forced KPI refresh OK');
