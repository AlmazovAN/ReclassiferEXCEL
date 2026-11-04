'use strict';
const assert=require('node:assert/strict');
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
require('../src/js/kpi/catalog/index.js');
const engine=require('../src/js/kpi/forecast_engine.js');
const view=require('../src/js/kpi/report_view_model.js');
const days=period=>new Date(Date.UTC(Number(period.slice(0,4)),
  Number(period.slice(5,7)),0)).getUTCDate();
const months=Array.from({length:8},(_,i)=>'2026-'+
  String(i+1).padStart(2,'0'));
const points=months.map((period,i)=>({
  period,value:(10+i)*days(period),dataState:'available'
}));
const coverage=(sourceId,opts={})=>({
  reportMonth:'2026-09',reportMonthStatus:'incomplete',
  sourceId,coverageBasis:'source-export-cutoff',
  coverageFrom:'2026-01-01',coverageThrough:'2026-09-15',...opts
});
const current={dataState:'available',value:847};
const run=(metricId,methodId='linear-trend',other={})=>
  engine.predictReportingMetric({
    metricId,selectedMonth:'2026-09',
    reportingCoverage:coverage(metricId==='inc'?'itsm_data':
      'mobile_brigade_data'),
    current,points,methodId,...other
  });
assert.deepEqual(Object.keys(engine.REPORTING_VOLUME_METRICS).sort(),[
  'avr_labor','corrective_labor','inc','labor','maintenance_labor',
  'total_labor'
]);
const observed=run('labor','observed-run-rate');
assert.equal(observed.forecastType,'reporting-month-volume-nowcast');
assert.equal(observed.unit,'чел.-ч');
assert.equal(observed.dataState,'available');
assert.equal(observed.observedValue,847);
assert.equal(observed.remainingDays,15);
assert.equal(observed.remainingValue,847);
assert.equal(observed.value,1694);
assert.equal(observed.requestedMethodId,'observed-run-rate');
assert.equal(observed.methodId,'observed-run-rate');
assert.equal(observed.methodComponents.laborHours.methodVersion,'1.0.0');
assert.equal(observed.asOf,'2026-09-15');
assert.equal(observed.sourceId,'mobile_brigade_data');
assert(Object.isFrozen(observed));
assert(Object.isFrozen(observed.methodComponents));
const august=points.at(-1);
const last=run('labor','last-value');
assert.equal(last.dataState,'available');
assert.equal(last.quality.historicalMonths,1);
assert(Math.abs(last.value-(847+15*august.value/31))<1e-9);
const trend=run('inc');
assert.equal(trend.dataState,'available');
assert.equal(trend.unit,'шт');
assert.equal(trend.rounding,'nearest-integer');
assert(Number.isInteger(trend.value));
assert.equal(trend.observedValue,847);
assert.equal(trend.horizon,'2026-09');
assert.equal(trend.quality.historicalMonths,8);
assert.equal(trend.quality.validationMonths,2);
assert.equal(trend.methodComponents.incCount.validation.metric,'MAE/day');
const later=run('inc','linear-trend',{asOf:'2027-05-25',now:'2027-05-25'});
assert.deepEqual(trend,later,'Wall-clock date never changes last reporting month');
for(const id of ['total_labor','avr_labor','maintenance_labor','corrective_labor']){
  const result=run(id,'last-value');
  assert.equal(result.dataState,'available');
  assert.equal(result.kpiId,id);
  assert.equal(result.unit,'чел.-ч');
  assert.equal(result.rounding,'none');
}
assert.equal(run('labor','observed-run-rate',{
  reportingCoverage:null
}).reason,'reporting-cutoff-unconfirmed');
assert.equal(run('labor','observed-run-rate',{
  reportingCoverage:coverage('mobile_brigade_data',{
    reportMonthStatus:'complete',coverageThrough:'2026-09-30'
  })
}).reason,'report-month-complete');
assert.equal(run('inc','last-value',{
  reportingCoverage:coverage('mobile_brigade_data')
}).reason,'metric-source-coverage-mismatch');
assert.equal(run('inc','last-value',{
  reportingCoverage:coverage('itsm_data',{
    coverageFrom:'2026-09-05'
  })
}).reason,'invalid-reporting-cutoff');
assert.equal(run('inc','last-value',{
  reportingCoverage:coverage('itsm_data',{
    coverageThrough:'2026-09-30'
  })
}).reason,'invalid-reporting-cutoff');
assert.equal(run('inc','last-value',{
  selectedMonth:'2026-10'
}).reason,'selected-report-month-mismatch');
assert.equal(run('inc','observed-run-rate',{
  current:{dataState:'available',value:-4}
}).reason,'invalid-current-component');
assert.equal(run('labor','observed-run-rate',{
  current:{dataState:'available',value:10,partialCoverage:true}
}).reason,'current-volume-partial-coverage');
assert.equal(run('labor','last-value',{
  points:[]
}).reason,'previous-month-missing');
assert.equal(run('inc','linear-trend',{
  points:points.slice(2)
}).reason,'insufficient-complete-history');
assert.equal(run('inc','linear-trend',{
  reportingCoverage:coverage('itsm_data',{
    coverageFrom:'2026-02-01'
  })
}).reason,'history-not-certified');
const broken=[...points];broken[2]={...broken[2],period:'2025-12'};
assert.equal(run('labor','linear-trend',{points:broken}).reason,
  'noncontiguous-component-history');
const partial=[...points];
partial[3]={...partial[3],partialCoverage:true};
assert.equal(run('labor','linear-trend',{points:partial}).reason,
  'missing-or-partial-component-history');
assert.equal(run('inc','linear-trend',{points:[...points,points[0]]}).reason,
  'duplicate-component-period');
assert.equal(run('inc','fake-model').reason,'forecast-method-not-connected');
assert.equal(run('not-a-metric').reason,'absolute-metric-not-supported');
const leap=engine.predictReportingMetric({
  metricId:'inc',methodId:'observed-run-rate',
  selectedMonth:'2024-02',current:{dataState:'available',value:56},
  points:[],reportingCoverage:{
    sourceId:'itsm_data',reportMonth:'2024-02',
    reportMonthStatus:'incomplete',coverageBasis:'source-export-cutoff',
    coverageFrom:'2024-01-01',coverageThrough:'2024-02-28'
  }
});
assert.equal(leap.calendarDays,29);
assert.equal(leap.remainingDays,1);
assert.equal(leap.value,58);

// Shared monthly facts and labor forecasts are independent of the viewport.
const ids=['total_labor','avr_labor','maintenance_labor','corrective_labor'];
const rows=[...points.map(p=>({
  period:p.period,
  ...Object.fromEntries(ids.map((id,i)=>[id,{
    id,dataState:'available',value:p.value/(i+1)
  }]))
})),{
  period:'2026-09',...Object.fromEntries(ids.map((id,i)=>[id,{
    id,dataState:'available',value:847/(i+1),
    components:{laborHours:847/(i+1)}
  }]))
}];
const cov={kpis:Object.fromEntries(ids.map(id=>[
  id,coverage('mobile_brigade_data',{kpiId:id})
]))};
const sources=[{id:'mobile_brigade_data',activeRevision:42,
  contentHash:'hash-mb',available:true}];
const decorated=view.withForecasts({
  monthlyResults:rows,reportingCoverage:cov,sources
});
const late=decorated.at(-1);
for(const id of ids){
  assert.strictEqual(late[id],rows.at(-1)[id],
    'Observed KPI calculator result is preserved');
  assert.equal(late.forecasts[id].dataState,'available');
  assert.equal(late.forecasts[id].sourceRevisions[0].revision,42);
  assert.equal(late.forecasts[id].forecastType,'reporting-month-volume-nowcast');
}
const overview=view.create({
  selectedMonth:'2026-09',
  currentResults:rows.at(-1),monthlyResults:decorated,
  reportingCoverage:cov,sources
});
for(const id of ids){
  assert.strictEqual(overview.cards[id].forecast,late.forecasts[id]);
  assert.strictEqual(overview.seriesById[id].points.at(-1).forecast,
    overview.cards[id].forecast);
  assert.equal(overview.cards[id].current.value,late[id].value);
}
const differentMonth=view.create({
  selectedMonth:'2026-08',
  currentResults:rows.at(-2),monthlyResults:decorated,
  reportingCoverage:cov,sources
});
assert.strictEqual(differentMonth.cards.total_labor.forecast,
  overview.cards.total_labor.forecast);
assert(Object.isFrozen(decorated));
assert(Object.isFrozen(late.forecasts));
console.log('PR-7 volume: INC/labor source cutoffs, 3 methods, same-month fact + forecast, MAE, leap, missing history, immutable Snapshot OK');
