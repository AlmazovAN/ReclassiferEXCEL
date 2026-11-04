'use strict';
const assert=require('node:assert/strict');
// Exercise the real KPI catalog, not a fabricated stand-in for the engine.
require('../src/js/app/reliability_dashboard_data.js');
require('../src/js/modules/itsm/mb_presence.js');
require('../src/js/kpi/source_facts.js');
for(const id of ['common','failures','equipment','labor','sla','classification','prb','ktg','index'])
  require('../src/js/kpi/preparation/'+id+'.js');
require('../src/js/kpi/calculator/common.js');
require('../src/js/kpi/calculator/definitions.js');
for(const id of ['vbr','ktg','sla','classification_quality','classification_quality_cgps','labor','problem_management'])
  require('../src/js/kpi/calculator/'+id+'/calculate.js');
require('../src/js/kpi/calculator/index.js');
require('../src/js/kpi/catalog/contracts.js');
require('../src/js/kpi/catalog/index.js');
const engine=require('../src/js/kpi/forecast_engine.js');

const days=period=>new Date(Date.UTC(Number(period.slice(0,4)),Number(period.slice(5,7)),0)).getUTCDate();
const months=Array.from({length:8},(_,i)=>'2026-'+String(i+1).padStart(2,'0'));
const historical=months.map((period,i)=>{
  const numberOfDays=days(period);
  const plannedRate=[1,2,3,4,5,6,6,6][i];
  const planned=plannedRate*numberOfDays;
  const incident=(2+i*.25)*numberOfDays;
  const unplanned=0.5*numberOfDays,other=.25*numberOfDays;
  const calendarHours=24*numberOfDays*10;
  return {
    period,dataState:'available',value:95,
    components:{
      equipmentCount:1000,failureCount:(1+i*.1)*numberOfDays,
      incidentHours:incident,plannedMaintenanceHours:planned,
      unplannedMaintenanceHours:unplanned,otherHours:other,
      calendarHours,availableHours:calendarHours-planned,
      productiveHours:calendarHours-incident-planned-unplanned-other
    },diagnostics:{partialCoverage:false}
  };
});
const currentVbr={dataState:'available',value:98,
  components:{failureCount:20,equipmentCount:1000},diagnostics:{partialCoverage:false}};
const currentKtg={dataState:'available',value:98,
  components:{calendarHours:7200,equipmentUnits:10,
    incidentHours:40,plannedMaintenanceHours:60,
    unplannedMaintenanceHours:7,otherHours:4},
  diagnostics:{partialCoverage:false}};
const coverage={
  sourceId:'itsm_data',reportMonth:'2026-09',
  reportMonthStatus:'incomplete',coverageBasis:'source-export-cutoff',
  coverageFrom:'2026-01-01',coverageThrough:'2026-09-15'
};
const run=(kpiId,current,methodId='linear-trend',extra={})=>
  engine.predictReportingMonth({
    kpiId,selectedMonth:'2026-09',reportingCoverage:coverage,
    current,points:historical,methodId,...extra
  });

assert.equal(engine.REPORTING_STRATEGY.defaultMethodId,'linear-trend');
assert.equal(engine.REPORTING_METHODS['observed-run-rate'].historyMonths,0);
assert.equal(engine.REPORTING_METHODS['last-value'].historyMonths,1);
assert.equal(engine.REPORTING_METHODS['linear-trend'].historyMonths,8);
assert(Object.isFrozen(engine.REPORTING_METHODS));

const observed=run('vbr',currentVbr,'observed-run-rate');
assert.equal(observed.dataState,'available');
assert.equal(observed.horizon,'2026-09');
assert.equal(observed.forecastType,'reporting-month-nowcast');
assert.equal(observed.asOf,'2026-09-15');
assert.equal(observed.elapsedDays,15);
assert.equal(observed.remainingDays,15);
assert.equal(observed.calendarDays,30);
assert.equal(observed.value,96);
assert.equal(observed.requestedMethodId,'observed-run-rate');
assert.equal(observed.methodId,'observed-run-rate');
assert.equal(observed.methodComponents.failureCount.methodVersion,'1.0.0');
assert.equal(observed.quality.historicalMonths,0);
assert.equal(observed.source,'local-offline');
assert(Object.isFrozen(observed));
assert(Object.isFrozen(observed.methodComponents));
assert(Object.isFrozen(observed.projectedComponents));
assert.equal(observed.coverageThrough,'2026-09-15');
assert.equal(observed.coverageBasis,'source-export-cutoff');

const last=run('vbr',currentVbr,'last-value');
assert.equal(last.dataState,'available');
assert.equal(last.methodId,'last-value');
assert.equal(last.quality.historicalMonths,1);
assert(Math.abs(last.value-95.45)<1e-9);

const trend=run('vbr',currentVbr);
assert.equal(trend.dataState,'available');
assert.equal(trend.methodId,'linear-trend');
assert.equal(trend.requestedMethodId,'linear-trend');
assert.equal(trend.quality.historicalMonths,8);
assert.equal(trend.quality.validationMonths,2);
assert.equal(trend.methodComponents.failureCount.methodId,'linear-trend');
assert.equal(trend.methodComponents.failureCount.methodVersion,'1.0.0');
assert.equal(trend.methodComponents.failureCount.validation.metric,'MAE/day');
assert(Math.abs(trend.value-95.3)<1e-9);
// The forecast uses the report's data boundary, not a system clock: it
// remains September even when the application is opened later.
const later=run('vbr',currentVbr,'linear-trend',{
  asOf:'2027-05-20',now:'2027-05-20T15:00:00Z'
});
assert.deepEqual(later,trend);

// Input method controls the strategy, fallback details disclose the actual model.
const mixed=run('ktg',currentKtg);
assert.equal(mixed.dataState,'available');
assert.equal(mixed.methodId,'mixed-components');
assert.equal(mixed.requestedMethodId,'linear-trend');
assert.equal(mixed.methodComponents.incidentHours.methodId,'linear-trend');
assert.equal(mixed.methodComponents.plannedMaintenanceHours.methodId,'last-value');
assert(mixed.appliedMethodIds.includes('linear-trend'));
assert(mixed.appliedMethodIds.includes('last-value'));
assert.equal(mixed.projectedComponents.calendarHours,7200);
assert.equal(mixed.projectedComponents.equipmentUnits,10);
assert(Math.abs(mixed.value-100*mixed.projectedComponents.productiveHours/
  mixed.projectedComponents.availableHours)<1e-9);
assert(Object.isFrozen(mixed.methodComponents.plannedMaintenanceHours.validation));
const partial=run('ktg',{
  ...currentKtg,diagnostics:{partialCoverage:true}
});
assert.equal(partial.quality.status,'provisional-partial');

const noData=run('vbr',currentVbr,'observed-run-rate',{reportingCoverage:null});
assert.equal(noData.dataState,'insufficient');
assert.equal(noData.value,null);
assert.equal(noData.reason,'reporting-cutoff-unconfirmed');
assert.equal(run('vbr',currentVbr,'observed-run-rate',{
  reportingCoverage:{...coverage,reportMonthStatus:'unknown',reportMonthReason:'reporting-cutoff-unconfirmed'}
}).dataState,'insufficient');
assert.equal(run('vbr',currentVbr,'observed-run-rate',{
  reportingCoverage:{...coverage,reportMonthStatus:'complete'}
}).value,null);
assert.equal(run('vbr',currentVbr,'observed-run-rate',{
  reportingCoverage:{...coverage,coverageBasis:null}
}).value,null);
assert.equal(run('vbr',currentVbr,'observed-run-rate',{
  reportingCoverage:{...coverage,coverageFrom:'2026-09-05'}
}).reason,'invalid-reporting-cutoff');
assert.equal(run('vbr',currentVbr,'observed-run-rate',{
  reportingCoverage:{...coverage,coverageThrough:'2026-09-30'}
}).reason,'invalid-reporting-cutoff');
assert.equal(run('vbr',currentVbr,'observed-run-rate',{
  reportingCoverage:{...coverage,coverageThrough:'2026-10-15'}
}).reason,'invalid-reporting-cutoff');
assert.equal(run('vbr',currentVbr,'observed-run-rate',{
  reportingCoverage:{...coverage,coverageThrough:'2026-09-03'}
}).reason,'early-report-month');
assert.equal(run('vbr',currentVbr,'observed-run-rate',{
  selectedMonth:'2026-10'
}).reason,'selected-report-month-mismatch');
assert.equal(run('sla',currentVbr,'observed-run-rate').reason,'kpi-nowcast-not-supported');
assert.equal(run('vbr',currentVbr,'hypothetical-model').reason,
  'forecast-method-not-connected');
assert.equal(run('vbr',currentVbr,'mixed-components').reason,
  'forecast-method-not-connected');
assert.equal(run('vbr',{...currentVbr,dataState:'no-data'},
  'observed-run-rate').reason,'current-components-unavailable');
assert.equal(run('vbr',{...currentVbr,components:{...currentVbr.components,failureCount:-3}},
  'observed-run-rate').reason,'invalid-current-component');
assert.equal(run('vbr',{...currentVbr,components:{...currentVbr.components,equipmentCount:0}},
  'observed-run-rate').reason,'equipment-baseline-missing');
assert.equal(run('ktg',{...currentKtg,components:{...currentKtg.components,calendarHours:0}},
  'last-value').reason,'calendar-or-equipment-baseline-missing');

assert.equal(run('vbr',currentVbr,'last-value',{points:[]}).reason,
  'previous-month-missing');
assert.equal(run('vbr',currentVbr,'linear-trend',{points:historical.slice(3)}).reason,
  'insufficient-complete-history');
assert.equal(run('vbr',currentVbr,'linear-trend',{
  reportingCoverage:{...coverage,coverageFrom:'2026-04-01'}
}).reason,'history-not-certified');
assert.equal(run('vbr',currentVbr,'linear-trend',{
  points:[...historical.slice(0,5),{...historical[5],period:'2025-11'},
    ...historical.slice(6)]
}).reason,'noncontiguous-component-history');
assert.equal(run('vbr',currentVbr,'linear-trend',{
  points:[...historical.slice(0,3),{
    ...historical[3],diagnostics:{partialCoverage:true}
  },...historical.slice(4)]
}).reason,'missing-or-partial-component-history');
assert.equal(run('vbr',currentVbr,'linear-trend',{
  points:[...historical,historical[2]]
}).reason,'duplicate-component-period');
// An invalid older month does not disable a valid eight-month suffix.
const previous={...historical[0],period:'2025-12',value:null,dataState:'no-data'};
assert.equal(run('vbr',currentVbr,'linear-trend',{
  points:[previous,...historical]
}).dataState,'available');
// Leap-year September-like use: February 2024 is only incomplete through 28.
const february=engine.predictReportingMonth({
  kpiId:'vbr',methodId:'observed-run-rate',selectedMonth:'2024-02',
  reportingCoverage:{
    reportMonth:'2024-02',reportMonthStatus:'incomplete',
    coverageBasis:'source-export-cutoff',
    coverageFrom:'2024-01-01',coverageThrough:'2024-02-28'
  },
  current:currentVbr,points:[]
});
assert.equal(february.calendarDays,29);
assert.equal(february.remainingDays,1);
// Existing future-month VBR/KTG forecast remains disallowed.
assert.equal(engine.predict({
  kpiId:'vbr',selectedMonth:'2026-08',points:historical
}).reason,'historical-data-required');
console.log('PR-2 forecast: certified historical incomplete months, three methods, MAE fallback, provenance and guards OK');
