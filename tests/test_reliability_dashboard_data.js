const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const source = fs.readFileSync('src/js/app/reliability_dashboard_data.js', 'utf8');
vm.runInThisContext(source, { filename: 'reliability-dashboard-data.js' });

const data = globalThis.ReclassifierReliabilityDashboardData;
assert(data, 'Dashboard presentation template API is missing');
assert.strictEqual(data.schemaVersion, '2.0.0');
assert.strictEqual(data.mode, 'report-snapshot');
assert.strictEqual(data.report.title, 'Отчёт по надёжности СДГР');
assert(data.filters.disclaimer.includes('Report Snapshot'));

assert.strictEqual(data.kpiGroups.dataQuality.length, 5);
assert.strictEqual(data.kpiGroups.technicalReliability.length, 2);
assert.strictEqual(data.kpiGroups.organizationalReadiness.length, 3);
assert.strictEqual(data.labor.summaryKpis.length, 5);
assert.strictEqual(data.problemManagement.summaryKpis.length, 6);

const allKpis = [
  ...data.kpiGroups.dataQuality,
  ...data.kpiGroups.technicalReliability,
  ...data.kpiGroups.organizationalReadiness,
  ...data.labor.summaryKpis,
  ...data.problemManagement.summaryKpis,
];
assert.strictEqual(allKpis.length, 21);
for (const item of allKpis) {
  assert(Object.prototype.hasOwnProperty.call(item, 'id'), 'KPI template id is missing');
  assert(Object.prototype.hasOwnProperty.call(item, 'title'), 'KPI template title is missing');
  assert(Object.prototype.hasOwnProperty.call(item, 'unit'), 'KPI template unit is missing');
  assert(!Object.prototype.hasOwnProperty.call(item, 'value'),
    'Presentation template must not embed calculated/demo KPI values: ' + item.id);
  assert(!Object.prototype.hasOwnProperty.call(item, 'target'),
    'Presentation template must not embed KPI targets: ' + item.id);
}

for (const id of [
  'required_fields_completeness',
  'confirmed_failures_share',
  'data_freshness',
  'kog',
  'service_level',
  'confirmed_labor_reduction'
]) {
  const item = allKpis.find(candidate => candidate.id === id);
  assert(item, 'Unsupported KPI placeholder is missing: ' + id);
  assert.strictEqual(item.calculationState, 'not-implemented');
}

for (const id of [
  'classification_quality',
  'classification_quality_cgps',
  'vbr',
  'ktg',
  'sla',
  'total_labor',
  'avr_labor',
  'maintenance_labor',
  'corrective_labor',
  'reactive_share',
  'problem_coverage_absolute',
  'problem_coverage_relative'
]) {
  assert(allKpis.some(item => item.id === id), 'Implemented KPI template is missing: ' + id);
}

assert(!source.includes('volumeFactor'));
assert(!source.includes('qualityOffset'));
assert(!source.includes('technicalOffset'));
assert(!source.includes('serviceOffset'));
assert(!source.includes('problemShareOffset'));
assert(!source.includes("mode: 'demo'"));
assert(!source.includes('94.2'));
assert(!source.includes('41136.1'));

assert(Object.isFrozen(data));
assert(Object.isFrozen(data.kpiGroups));
assert(Object.isFrozen(data.kpiGroups.dataQuality));
assert(Object.isFrozen(data.problemManagement));

console.log('Reliability dashboard Report Snapshot presentation template: OK');
