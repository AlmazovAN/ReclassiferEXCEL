// PR-2: additive Definition V2 registry; no Calculator, UI, PDF or forecast changes.
'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
require('../src/js/app/reliability_dashboard_data.js');
require('../src/js/modules/itsm/mb_presence.js');
require('../src/js/kpi/source_facts.js');
for(const id of ['common','failures','equipment','labor','sla','classification','prb','ktg','index'])
  require('../src/js/kpi/preparation/'+id+'.js');
require('../src/js/kpi/calculator/common.js');
require('../src/js/kpi/calculator/definitions.js');
for(const id of ['vbr','ktg','sla','classification_quality',
  'classification_quality_cgps','labor','problem_management'])
  require('../src/js/kpi/calculator/'+id+'/calculate.js');
require('../src/js/kpi/calculator/index.js');
require('../src/js/kpi/catalog/contracts.js');
const catalog=require('../src/js/kpi/catalog/index.js');
const engine=require('../src/js/kpi/forecast_engine.js');
const base=path.resolve(__dirname,'..');
const schema=JSON.parse(fs.readFileSync(path.join(base,
  'docs/contracts/kpi_definition_v2.schema.json'),'utf8'));
const example=JSON.parse(fs.readFileSync(path.join(base,
  'docs/contracts/examples/kpi_definition_v2_sla.example.json'),'utf8'));

assert.equal(catalog.version,'1.0.0','V1 Catalog identity remains unchanged');
assert.equal(catalog.definitionSchemaVersion,'2.0.0');
assert.equal(schema.properties.schemaVersion.const,'2.0.0');
assert.equal(schema.additionalProperties,false);
assert.equal(catalog.list().length,22);
assert.equal(catalog.listV2().length,22);
assert.equal(catalog.getV2('missing'),null);
assert.deepEqual(catalog.getV2('sla'),example,'Documented example must reflect the real source contract');
assert.equal(catalog.list({calculationState:'implemented'}).length,16);
assert.equal(catalog.list({calculationState:'not-implemented'}).length,6);
assert.deepEqual(catalog.listV2({calculationState:'implemented'}).map(x=>x.kpiId),
  catalog.list({calculationState:'implemented'}).map(x=>x.id));
assert.deepEqual(catalog.listV2({category:'technicalReliability'}).map(x=>x.kpiId),
  ['vbr','ktg']);

// The V2 projection must reference, never replace, the actual Calculator.
// This is a regression guard against a second formula engine or invented sources.
const allIds=catalog.list().map(x=>x.id);
for(const entry of catalog.list()){
  const v2=catalog.getV2(entry.id);
  assert(v2,'V2 missing '+entry.id);
  assert.equal(v2.kpiId,entry.id);
  assert.equal(v2.schemaVersion,'2.0.0');
  assert.equal(v2.identity.category,entry.definition.category);
  assert.equal(v2.identity.visibleInReport,entry.visibleInReport);
  assert.equal(v2.measurement.unit,entry.definition.unit);
  assert.equal(v2.presentation.passport,'shared-four-tabs');
  assert.equal(v2.presentation.visualStyle,'unchanged');
  assert(Object.isFrozen(v2),entry.id);
  assert(Object.isFrozen(v2.components),entry.id);
  assert(Object.isFrozen(v2.relatedMetrics),entry.id);
  assert(Object.isFrozen(v2.forecast.methodIds),entry.id);
  assert(Object.isFrozen(v2.data.sourceRefs),entry.id);
  assert(Object.isFrozen(v2.data.filterDimensions),entry.id);
  const expectedEnabled=entry.calculationState==='implemented';
  assert.equal(v2.calculator.integration,
    expectedEnabled?'existing-calculator':'not-implemented');
  assert.equal(v2.presentation.card,!entry.visibleInReport?'hidden':
    expectedEnabled?'existing':'placeholder',entry.id);
  assert.equal(v2.presentation.chart,!entry.visibleInReport?'hidden':
    expectedEnabled?'existing-line-svg':'not-implemented',entry.id);
  assert.equal(v2.presentation.pdf,
    expectedEnabled?'existing-snapshot-renderer':'not-implemented',entry.id);
  if(!expectedEnabled){
    assert.equal(v2.measurement.kind,'unconfigured');
    assert.equal(v2.components.length,0);
    assert.equal(v2.relatedMetrics.length,0);
    assert.equal(v2.data.sourceRefs.length,0);
    assert.equal(v2.forecast.policy,'none');
    assert.equal(v2.forecast.chartNowcastConnected,false);
    assert.equal(v2.calculator.handlerRef,null);
    assert.equal(v2.calculator.contractRef,null);
    continue;
  }
  const calc=entry.calculation;
  assert.equal(v2.calculator.contractRef,entry.id);
  assert.equal(v2.calculator.handlerRef,calc.formulaHandler);
  assert.equal(v2.calculator.formulaVersion,calc.formula.formulaVersion);
  assert.equal(v2.calculator.calculationContractVersion,calc.contractVersion);
  assert.equal(v2.data.periodGrain,calc.temporal.periodGrain);
  assert.deepEqual(v2.data.sourceRefs.map(s=>s.datasetId),
    calc.sources.map(s=>s.datasetId),entry.id);
  assert.deepEqual(v2.data.sourceRefs.map(s=>s.semanticFields),
    calc.sources.map(s=>s.fields.map(f=>f.field)),entry.id);
  assert(v2.data.filterDimensions.length>0,entry.id);
  assert.equal(new Set(v2.data.filterDimensions).size,v2.data.filterDimensions.length);
  assert.equal(new Set(v2.components.map(c=>c.key)).size,v2.components.length);
  for(const component of v2.components){
    assert(component.label&&component.unit,entry.id+'/'+component.key);
    assert.equal(component.valuePath,'components.'+component.key);
  }
  for(const metric of v2.relatedMetrics){
    assert(v2.components.some(c=>c.key===metric.componentKey),entry.id+'/'+metric.id);
    assert.equal(metric.presentation,'defined-not-connected',
      'PR-2 must never turn metadata into a rendered series');
  }
  const kind=v2.measurement.kind;
  assert(['coefficient','ratio','sum','count'].includes(kind),entry.id);
}
assert.deepEqual(catalog.listV2().map(x=>x.kpiId),allIds);
assert.equal(catalog.getV2('avr_share').identity.visibleInReport,false);
assert.equal(catalog.getV2('vbr').measurement.kind,'coefficient');
assert.equal(catalog.getV2('ktg').measurement.kind,'coefficient');
assert.equal(catalog.getV2('sla').measurement.kind,'ratio');
assert.equal(catalog.getV2('classification_quality').measurement.kind,'ratio');
assert.equal(catalog.getV2('total_labor').measurement.kind,'sum');
assert.equal(catalog.getV2('vbr').components.find(c=>c.key==='equipmentCount').unit,
  'обор.-мес.','VBR denominator represents equipment-month exposure');
for(const id of ['avr_labor','maintenance_labor','corrective_labor']){
  assert(catalog.getV2(id).components.some(c=>c.key==='taskCount'),
    'Task count still exists in the audited Result context');
  assert(!catalog.getV2(id).relatedMetrics.some(m=>m.componentKey==='taskCount'),
    'Unfiltered taskCount must not be promoted as count of subset jobs');
}

assert.equal(catalog.getV2('problem_coverage_relative').measurement.kind,'ratio');

// Existing component nowcast vs generic future-month trend MUST NOT be conflated.
const componentNowcast=['vbr','ktg'];
const volumeNowcast=['total_labor','avr_labor','maintenance_labor','corrective_labor'];
for(const id of componentNowcast){
  const forecast=catalog.getV2(id).forecast;
  assert.equal(forecast.policy,'reporting-month-components');
  assert.equal(forecast.chartNowcastConnected,true);
  assert.equal(forecast.chartPresentation,'percentage-month-endpoint');
  assert.equal(forecast.selectionSurface,'kpi-chart');
}
for(const id of volumeNowcast){
  const forecast=catalog.getV2(id).forecast;
  assert.equal(forecast.policy,'reporting-month-volume');
  assert.equal(forecast.chartNowcastConnected,true);
  assert.equal(forecast.chartPresentation,'absolute-current-to-month-end');
  // Operational INC/labor selector is not a per-KPI preference yet.
  assert.equal(forecast.selectionSurface,'none');
}
for(const entry of catalog.list({calculationState:'implemented'})){
  const forecast=catalog.getV2(entry.id).forecast;
  if([...componentNowcast,...volumeNowcast].includes(entry.id))continue;
  if(['problem_linked_tasks','problem_task_coverage','problem_active_count'].includes(entry.id)){
    assert.equal(forecast.policy,'none');
    assert.equal(forecast.chartNowcastConnected,false);
    continue;
  }
  assert.equal(forecast.policy,'historical-next-month');
  assert.equal(forecast.chartNowcastConnected,false);
  assert.equal(forecast.chartPresentation,'no-reporting-month-overlay');
}
assert.deepEqual(catalog.getV2('vbr').forecast.methodIds,
  ['observed-run-rate','last-value','linear-trend']);
assert.deepEqual(catalog.getV2('sla').forecast.methodIds,
  ['linear-trend','last-value']);
assert.equal(engine.REPORTING_STRATEGY.defaultMethodId,'linear-trend',
  'Definition V2 must not change existing auto forecast defaults');
assert.deepEqual(Object.keys(engine.REPORTING_VOLUME_METRICS).sort(),
  ['avr_labor','corrective_labor','inc','labor','maintenance_labor','total_labor']);

// Neither caller mutations nor dynamic metadata are allowed to mutate the
// authoritative V1 Calculation Contract or globally change presentation.
const original=catalog.getCalculation('sla').formula.expression;
assert.throws(()=>{catalog.getV2('sla').forecast.methodIds.push('corporate-ml-api');},TypeError);
assert.throws(()=>{catalog.getV2('vbr').data.sourceRefs[0].semanticFields.push('fabricated');},TypeError);
assert.equal(catalog.getCalculation('sla').formula.expression,original);
assert.equal(catalog.get('sla').definition.target,null);
console.log('PR-2 KPI Definition V2: 22 validated additive declarations, immutable source/field refs, actual components, forecast boundaries, V1 API preserved');
