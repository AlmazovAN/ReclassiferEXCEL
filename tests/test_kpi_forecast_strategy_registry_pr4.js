// PR-4: Strategy Registry integration and exact legacy parity.
// Real catalog + engine, synthetic records. No change to Calculator or SVG.
'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
require('../src/js/app/reliability_dashboard_data.js');
require('../src/js/modules/itsm/mb_presence.js');
require('../src/js/kpi/source_facts.js');
for(const p of ['common','failures','equipment','labor','sla','classification','prb','ktg','index'])
  require('../src/js/kpi/preparation/'+p+'.js');
require('../src/js/kpi/calculator/common.js');
require('../src/js/kpi/calculator/definitions.js');
for(const p of ['vbr','ktg','sla','classification_quality',
  'classification_quality_cgps','labor','problem_management'])
  require('../src/js/kpi/calculator/'+p+'/calculate.js');
require('../src/js/kpi/calculator/index.js');
require('../src/js/kpi/catalog/contracts.js');
const catalog=require('../src/js/kpi/catalog/index.js');
const engine=require('../src/js/kpi/forecast_engine.js');
const view=require('../src/js/kpi/report_view_model.js');
const registry=engine.strategyRegistry;

assert(Object.isFrozen(registry));
assert.equal(registry.version,'1.0.0');
assert.deepEqual(registry.list().map(x=>x.id),
  ['historical-next-month','reporting-month-components','reporting-month-volume']);
assert.deepEqual(registry.list().map(x=>x.status),['connected','connected','connected']);
assert.equal(registry.forKpi('missing'),null);
assert.equal(registry.forKpi('kog'),null);
assert.equal(registry.forMetric('unknown'),null);
assert.equal(registry.forMetric('inc').policy,'reporting-month-volume');
assert.equal(registry.forMetric('labor').policy,'reporting-month-volume');
assert.equal(registry.forKpi('vbr').policy,'reporting-month-components');
assert.equal(registry.forKpi('ktg').policy,'reporting-month-components');
assert.equal(registry.forKpi('sla').policy,'historical-next-month');
assert.equal(registry.forKpi('total_labor').policy,'reporting-month-volume');
assert.equal(registry.forKpi('classification_quality').policy,'historical-next-month');
for(const v2 of catalog.listV2()){
  const meta=registry.forKpi(v2.kpiId);
  assert.equal(meta?.policy||'none',v2.forecast.policy,v2.kpiId);
  if(meta){
    assert.deepEqual(meta.methodIds,v2.forecast.methodIds,v2.kpiId);
    assert(Object.isFrozen(meta));
    assert(Object.isFrozen(meta.methodIds));
  }
}
assert.equal(registry.forKpi('vbr').defaultDependsOnCoverage,true);
assert.equal(registry.forKpi('sla').defaultDependsOnCoverage,false);

const months=Array.from({length:12},(_,i)=>'2025-'+String(i+1).padStart(2,'0'));
const samples=(values)=>values.map((value,i)=>({period:months[i],value,dataState:'available'}));
const historical={
  kpiId:'sla',selectedMonth:'2025-12',points:samples(Array(12).fill(93))
};
for(const id of ['sla','classification_quality','reactive_share']){
  for(const methodId of ['linear-trend','last-value']){
    const input={...historical,kpiId:id,overrides:{[id]:{methodId}}};
    const legacy=engine.predict(input);
    const dispatched=registry.predictForKpi(input);
    assert.deepEqual(dispatched,legacy,id+'/'+methodId);
    assert(Object.isFrozen(dispatched));
  }
}
assert.equal(registry.predictForKpi({
  ...historical,points:samples([1,2,3])
}).reason,'insufficient-history');

const coverage={sourceId:'itsm_data',reportMonth:'2026-09',
  reportMonthStatus:'incomplete',coverageBasis:'source-export-cutoff',
  coverageFrom:'2026-01-01',coverageThrough:'2026-09-15'};
const vbrCurrent={dataState:'available',value:98,
  components:{failureCount:20,equipmentCount:1000},
  diagnostics:{partialCoverage:false}};
const vbr={kpiId:'vbr',selectedMonth:'2026-09',
  reportingCoverage:coverage,current:vbrCurrent,points:[]};
for(const methodId of ['observed-run-rate','last-value','linear-trend']){
  const input={...vbr,methodId};
  assert.deepEqual(registry.predictForKpi(input),engine.predictReportingMonth(input));
}
const reported=registry.predictForKpi({...vbr,methodId:'observed-run-rate'});
assert.equal(reported.value,96);
assert.equal(reported.observedValue,98);
assert.equal(reported.forecastType,'reporting-month-nowcast');
assert.equal(registry.predictForKpi({...vbr,reportingCoverage:null}).reason,
  engine.predictReportingMonth({...vbr,reportingCoverage:null}).reason);

const c2={...coverage,sourceId:'mobile_brigade_data'};
const labor={kpiId:'avr_labor',selectedMonth:'2026-09',
  reportingCoverage:c2,current:{dataState:'available',value:847},points:[]};
for(const methodId of ['observed-run-rate','last-value','linear-trend']){
  const input={...labor,methodId};
  const legacy=engine.predictReportingMetric({...input,metricId:'avr_labor'});
  assert.deepEqual(registry.predictForKpi(input),legacy,methodId);
}
const projected=registry.predictForKpi({...labor,methodId:'observed-run-rate'});
assert.equal(projected.value,1694);
assert.equal(projected.forecastType,'reporting-month-volume-nowcast');
assert.equal(projected.observedValue,847);
assert.deepEqual(registry.predictForMetric({
  metricId:'labor',selectedMonth:'2026-09',reportingCoverage:c2,
  current:{dataState:'available',value:847},points:[],
  methodId:'observed-run-rate'
}),engine.predictReportingMetric({
  metricId:'labor',selectedMonth:'2026-09',reportingCoverage:c2,
  current:{dataState:'available',value:847},points:[],
  methodId:'observed-run-rate'
}));
assert.deepEqual(registry.predictForMetric({
  metricId:'inc',selectedMonth:'2026-09',
  reportingCoverage:{...coverage},
  current:{dataState:'available',value:120},points:[],
  methodId:'observed-run-rate'
}),engine.predictReportingMetric({
  metricId:'inc',selectedMonth:'2026-09',
  reportingCoverage:{...coverage},
  current:{dataState:'available',value:120},points:[],
  methodId:'observed-run-rate'
}));

// Custom registration is developer-only and never silently replaces a
// built-in strategy. Use a separate instance to avoid touching the main app.
const isolated=engine.createStrategyRegistry();
const reportInput={...historical,kpiId:'classification_quality'};
const before=JSON.stringify(reportInput);
const def={
  id:'review-lag-model',version:'0.1.0',policy:'historical-next-month',
  methodIds:['review-lag-adjustment'],kpiIds:['classification_quality'],
  predict:()=>({
    dataState:'available',value:78,horizon:'2026-01',reason:null,
    methodId:'review-lag-adjustment',methodVersion:'0.1.0'
  })
};
const installed=isolated.registerStrategy(def);
assert.equal(installed.id,'review-lag-model');
assert.equal(installed.kind,'custom');
assert.deepEqual(isolated.forKpi('classification_quality'),
  registry.forKpi('classification_quality'),
  'Registration alone must not activate a custom strategy');
assert.throws(()=>isolated.registerStrategy(def),/Invalid or incompatible/);
assert.throws(()=>isolated.registerStrategy({...def,id:'wrong-kpi',kpiIds:['vbr']}),
  /Invalid or incompatible/);
assert.throws(()=>isolated.assignKpi('sla','review-lag-model'),
  /cannot be assigned/);
assert.throws(()=>isolated.assignKpi('classification_quality','historical-next-month'),
  /cannot be assigned/);
const active=isolated.assignKpi('classification_quality','review-lag-model');
assert.equal(active.id,'review-lag-model');
const custom=isolated.predictForKpi(reportInput);
assert.equal(custom.value,78);
assert.equal(custom.methodId,'review-lag-adjustment');
assert.equal(custom.strategyId,'review-lag-model');
assert.equal(custom.strategyVersion,'0.1.0');
assert(Object.isFrozen(custom));
assert.equal(JSON.stringify(reportInput),before);
assert.deepEqual(isolated.restoreDefault('classification_quality'),
  registry.forKpi('classification_quality'));
assert.deepEqual(isolated.predictForKpi(reportInput),engine.predict(reportInput));

// Invalid predictions are rejected instead of becoming visible as facts.
const invalidRegistry=engine.createStrategyRegistry();
for(const [id,value,horizon] of [
  ['bad-over-100',140,'2026-01'],
  ['bad-negative',-1,'2026-01'],
  ['bad-wrong-month',80,'2026-02'],
  ['bad-nan',NaN,'2026-01']
]){
  invalidRegistry.registerStrategy({
    ...def,id,
    predict:()=>({dataState:'available',value,horizon,
      methodId:'review-lag-adjustment',methodVersion:'0.1.0'})
  });
  invalidRegistry.assignKpi('classification_quality',id);
  const rejected=invalidRegistry.predictForKpi(reportInput);
  assert.equal(rejected.dataState,'unavailable');
  assert.equal(rejected.reason,'forecast-strategy-invalid-result');
  assert.equal(rejected.value,null);
}
assert.equal(engine.externalAdapter.status,'not-connected');
assert.equal(registry.list().length,3,'Custom test adapters are isolated');
assert.equal(registry.forKpi('classification_quality').kind,'builtin');

// Runtime paths must actually use the registry and keep the same output
// contracts; existing PR-1 and reporting-nowcast numeric tests cover the math.
const read=path=>fs.readFileSync(path,'utf8');
assert(read('src/js/kpi/report_view_model.js')
  .includes('strategyRegistry.predictForKpi'));
assert(read('src/js/app/reliability_report_service.js')
  .includes('strategyRegistry.predictForMetric'));
assert(read('src/js/app/reliability_report_service.js')
  .includes('strategyRegistry.predictForKpi'));
assert.equal(typeof view.withForecasts,'function');
console.log('PR-4: 19 strategy mappings, exact legacy numerical/output parity, operational forecasts, custom opt-in, error guards and call-site routing OK');
