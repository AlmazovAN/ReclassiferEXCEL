// Step 2: actual immutable Catalog bound to existing KPI handlers (not a formula interpreter).
'use strict';
const assert = require('node:assert/strict');
require('../src/js/app/reliability_dashboard_data.js');
require('../src/js/modules/itsm/mb_presence.js');
require('../src/js/kpi/source_facts.js');
require('../src/js/kpi/preparation/common.js');
require('../src/js/kpi/preparation/failures.js');
require('../src/js/kpi/preparation/equipment.js');
require('../src/js/kpi/preparation/labor.js');
require('../src/js/kpi/preparation/sla.js');
require('../src/js/kpi/preparation/classification.js');
require('../src/js/kpi/preparation/prb.js');
require('../src/js/kpi/preparation/ktg.js');
require('../src/js/kpi/preparation/index.js');
require('../src/js/kpi/calculator/common.js');
require('../src/js/kpi/calculator/definitions.js');
require('../src/js/kpi/calculator/vbr/calculate.js');
require('../src/js/kpi/calculator/ktg/calculate.js');
require('../src/js/kpi/calculator/sla/calculate.js');
require('../src/js/kpi/calculator/classification_quality/calculate.js');
require('../src/js/kpi/calculator/classification_quality_cgps/calculate.js');
require('../src/js/kpi/calculator/labor/calculate.js');
require('../src/js/kpi/calculator/problem_management/calculate.js');
require('../src/js/kpi/calculator/index.js');
require('../src/js/kpi/catalog/contracts.js');
require('../src/js/kpi/catalog/index.js');

const catalog = globalThis.ReclassifierKpiCatalog;
const formula = globalThis.ReclassifierKpiDefinitions;
const dashboardTemplate = globalThis.ReclassifierReliabilityDashboardData;
assert.ok(catalog, 'Catalog API absent');
assert.equal(catalog.version, '1.0.0');
assert.equal(catalog.ids.length, 22); // 21 visible cards + hidden avr_share
assert.equal(catalog.list({calculationState:'implemented'}).length, 16);
assert.equal(catalog.list({calculationState:'not-implemented'}).length, 6);
assert.equal(catalog.list().filter(entry => entry.visibleInReport).length, 21);
assert.equal(catalog.get('nonexistent'), null);
assert.ok(catalog.getCalculation('ktg'));
assert.equal(catalog.get('avr_share').visibleInReport, false);
assert.equal(catalog.get('classification_quality_cgps').visibleInReport, true);
assert.equal(catalog.get('classification_quality').visibleInReport, true);
assert.equal(catalog.get('avr_share').definition.category, 'labor');
assert.ok(Object.isFrozen(catalog));
assert.ok(Object.isFrozen(catalog.ids));
assert.ok(Object.isFrozen(catalog.groups));

const reportIds = [
  ...dashboardTemplate.kpiGroups.dataQuality,
  ...dashboardTemplate.kpiGroups.technicalReliability,
  ...dashboardTemplate.kpiGroups.organizationalReadiness,
  ...dashboardTemplate.labor.summaryKpis,
  ...dashboardTemplate.problemManagement.summaryKpis
].map(item => item.id);
assert.equal(new Set(reportIds).size, 21, 'Dashboard template has duplicate IDs.');
assert.deepEqual(new Set(catalog.list().filter(entry => entry.visibleInReport).map(entry => entry.id)), new Set(reportIds));
assert.deepEqual(new Set(Object.keys(formula)), new Set(catalog.list({calculationState:'implemented'}).map(entry => entry.id)));

for (const entry of catalog.list()) {
  assert.strictEqual(catalog.get(entry.id), entry);
  assert.ok(Object.isFrozen(entry));
  assert.ok(Object.isFrozen(entry.definition));
  assert.equal(entry.definition.id, entry.id);
  assert.ok(entry.definition.title);
  assert.equal(entry.definition.methodology.status, 'draft');
  assert.equal(entry.definition.methodology.reference, null);
  assert.equal(entry.definition.target, null, 'No invented targets.');
  if (entry.calculationState !== 'implemented') {
    assert.equal(entry.calculation, null, 'Placeholder must not have invented calculation.');
    continue;
  }
  const c = entry.calculation;
  assert.strictEqual(catalog.getCalculation(entry.id), c);
  assert.ok(Object.isFrozen(c));
  assert.ok(Object.isFrozen(c.sources));
  assert.ok(Object.isFrozen(c.steps));
  assert.ok(Object.isFrozen(c.temporal));
  assert.equal(c.kpiId, entry.id);
  assert.equal(c.formula.expression, formula[entry.id].formula, 'Formula must be inherited from actual calculator.');
  assert.equal(c.formula.formulaVersion, formula[entry.id].formulaVersion);
  assert.deepEqual(Array.from(c.sourceComponents), Array.from(formula[entry.id].sourceComponents));
  assert.ok(c.sources.length);
  assert.ok(c.steps.length);
  assert.ok(c.preparationHandler.includes('ReclassifierKpiPrepare'));
  assert.ok(c.formulaHandler.includes('ReclassifierKpiCalculate'));
  assert.equal(c.temporal.periodGrain, 'month');
  assert.equal(c.temporal.forecast.status, 'not-defined');
  assert.equal(c.temporal.forecast.horizon, null);
  assert.equal(c.temporal.rolling.defaultWindow, 4);
  assert.ok(c.temporal.rolling.requireCompleteWindow);
  assert.equal(c.temporal.previous.selection, 'previous-calendar-period');
  const stepIds = c.steps.map(s => s.id);
  assert.equal(new Set(stepIds).size, stepIds.length);
  for (const source of c.sources) {
    assert.ok(source.datasetId);
    assert.ok(source.grain.length);
    assert.ok(source.fields.length);
    assert.equal(new Set(source.fields.map(field => field.field)).size, source.fields.length,
      'Duplicate source column ' + entry.id + '/' + source.datasetId);
  }
}
const vbr = catalog.getCalculation('vbr');
assert.deepEqual(vbr.sources.map(s => s.datasetId), ['itsm_data','drivers']);
assert.equal(vbr.joins.length, 0, 'VBR is two independent sums, not a row-level JOIN.');
assert.equal(vbr.temporal.historicalSupported, false);
assert.equal(vbr.temporal.rolling.method, 'unavailable');
assert.equal(vbr.aggregation.combinePeriods, 'sum-components-then-formula');
assert.equal(vbr.temporal.periodBindings[0].field, 'completedAt');
assert.equal(vbr.temporal.periodBindings[1].field, 'closedAt');
assert.equal(vbr.temporal.periodBindings[2].field, 'value');
assert.ok(!vbr.sources.some(s => s.fields.some(f => f.field === 'driversByMine')));
assert.ok(vbr.sources[1].fields.some(f=>f.field==='unit'));
assert.ok(vbr.sources[1].fields.some(f=>f.field==='service'));
assert.ok(vbr.steps.some(step=>step.id==='exposure'&&step.operation==='MULTIPLY'));

assert.ok(vbr.sources[0].fields.some(f=>f.field==='closedAt'),
  'VBR passport must declare closure date as a fallback.');
assert.ok(vbr.sources[0].fields.some(f=>f.field==='reclassifiedReason'),
  'VBR passport must document the reason used by Exceptions.');
assert.ok(vbr.temporal.periodBindings.some(b=>b.field==='closedAt'),
  'VBR temporal contract must include closure date.');
assert.ok(vbr.steps.some(s=>s.id==='event-date' && s.operation==='MAP'));
assert.ok(vbr.filters.some(f=>f.field.field==='sputnikVbrDecision' &&
  f.note.includes('Exceptions') && f.note.includes('Северного')));
const sla = catalog.getCalculation('sla');
const quality = catalog.getCalculation('classification_quality');
assert.equal(sla.temporal.basis.field, 'closedAt');
assert.equal(quality.temporal.basis.field, 'completedAt');
assert.deepEqual(quality.temporal.periodBindings.map(binding=>binding.field),['completedAt','closedAt']);
assert.ok(quality.sources[0].fields.some(field=>field.field==='closedAt'));
assert.ok(quality.steps.some(step=>step.id==='period' && step.operation==='MAP'));
assert.equal(sla.temporal.rolling.method, 'ratio-of-sums');
assert.equal(quality.aggregation.combinePeriods, 'sum-components-then-formula');
assert.ok(sla.sources[0].fields.some(f => f.field === 'slaOverdue'));

const labor = catalog.getCalculation('reactive_share');
assert.equal(labor.temporal.basis.field, 'factDate');
assert.ok(labor.filters.some(f => f.appliesTo === 'numerator'));
assert.equal(labor.aggregation.combinePeriods, 'sum-components-then-formula');
assert.equal(catalog.getCalculation('total_labor').temporal.rolling.method, 'average');

const prb = catalog.getCalculation('problem_coverage_relative');
assert.deepEqual(prb.sources.map(s => s.datasetId), ['mobile_brigade_data','itsm_data']);
assert.equal(prb.joins.length, 1);
assert.equal(prb.joins[0].cardinality, 'N:1');
assert.equal(prb.joins[0].onUnmatched, 'preserve-null');
assert.ok(prb.joins[0].justification.includes('ambiguous'));
assert.ok(prb.filters.some(f => f.appliesTo === 'numerator'));

// A catalog entry may not be used to mutate the real calculator definition.
const current = catalog.getCalculation('sla').formula.expression;
try { catalog.getCalculation('sla').formula.expression = '0'; } catch (_) {}
assert.equal(catalog.getCalculation('sla').formula.expression, current);
assert.equal(formula.sla.formula, current);

// Optional pure JSON dump allows the stdlib Python regression to validate ALL records against Step 1 JSON Schema.
if (process.argv.includes('--dump')) {
  console.log(JSON.stringify(catalog.list()));
} else {
  console.log('KPI Catalog Step 2: 19 entries (13 implemented + 6 placeholders), audited immutable metadata OK');
}
