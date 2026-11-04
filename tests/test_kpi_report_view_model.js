// Step 3: pure Snapshot KPI view projector, calendar gaps and no artificial forecasts.
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
require('../src/js/kpi/forecast_engine.js');
require('../src/js/kpi/report_view_model.js');

const api = globalThis.ReclassifierKpiReportViewModel;
const catalog = globalThis.ReclassifierKpiCatalog;
assert.equal(api.version, '1.0.0');
assert.equal(api.previousMonth('2026-01'), '2025-12');
assert.equal(api.previousMonth('2026-10'), '2026-09');
assert.equal(api.previousMonth('wrong'), null);
const ok = (id, value, components = {}) => ({
  id, value, components, dataState:'available', reason:null, formulaVersion:'1.0.0'
});
const noData = (id, reason) => ({ id, value:null, dataState:'unavailable', reason, components:{} });
const source = {id:'itsm_data', available:true, activeRevision:7, contentHash:'abc', freshness:'2026-10-06'};
const state = api.create({
  selectedMonth:'2026-10',
  filters:{mine:'Северный', equipmentClass:'mounted'},
  sources:[source,{id:'combined', available:false, activeRevision:null, contentHash:null, freshness:null}],
  currentResults:{
    sla:ok('sla',90,{slaSuccessCount:9,slaTotalCount:10}),
    vbr:ok('vbr',95,{failureCount:5,equipmentCount:100}),
    total_labor:ok('total_labor',10,{laborHours:10})
  },
  monthlyResults:[
    {period:'2026-09',sla:ok('sla',80,{slaSuccessCount:8,slaTotalCount:10}),
      vbr:noData('vbr','equipment-snapshot-period-mismatch'), total_labor:ok('total_labor',8)},
    {period:'2026-10',sla:ok('sla',90,{slaSuccessCount:9,slaTotalCount:10}),
      vbr:ok('vbr',95,{failureCount:5,equipmentCount:100}), total_labor:ok('total_labor',10)}
  ]
});
assert.equal(Object.keys(state.cards).length,22);
assert.equal(Object.keys(state.seriesById).length,22);
assert.equal(state.catalogVersion,catalog.version);
assert.equal(state.selectedMonth,'2026-10');
assert.equal(state.previousMonth,'2026-09');
assert.equal(state.cards.sla.current.value,90);
assert.equal(state.cards.sla.previous.value,80);
assert.equal(state.cards.sla.change,10);
assert.equal(state.cards.sla.changeUnit,'п.п.');
assert.equal(state.cards.sla.status,'neutral');
assert.equal(state.cards.sla.target,null);
assert.equal(state.cards.sla.passportRef.kpiId,'sla');
assert.equal(state.cards.sla.passportRef.catalogVersion,catalog.version);
assert.equal(state.cards.sla.passportRef.contractVersion,'1.0.0');
assert.deepEqual(state.cards.sla.sourceRevisions,[
  {datasetId:'itsm_data',available:true,revision:7,contentHash:'abc',freshness:'2026-10-06'}
]);
assert.equal(state.cards.sla.forecast.value,null);
assert.equal(state.cards.sla.forecast.methodId,'linear-trend');
assert.equal(state.cards.sla.forecast.horizon,null);
assert.equal(state.cards.sla.forecast.dataState,'insufficient');
assert.equal(state.cards.vbr.previous.value,null);
assert.equal(state.cards.vbr.change,null);
assert.equal(state.cards.vbr.previous.reason,'equipment-snapshot-period-mismatch');
assert.equal(state.cards.total_labor.change,2);
assert.equal(state.cards.total_labor.changeUnit,'чел.-ч');
assert.equal(state.cards.ktg.current.dataState,'no-data');
assert.equal(state.cards.ktg.previous.dataState,'no-data');
assert.equal(state.cards.ktg.forecast.dataState,'insufficient');
assert.equal(state.cards.ktg.forecast.reason,'reporting-cutoff-unconfirmed');
assert.equal(state.cards.ktg.passportRef.contractVersion,'1.0.0');
assert.deepEqual(state.seriesById.sla.points.map(p=>p.period),['2026-09','2026-10']);
assert.deepEqual(state.seriesById.sla.points.map(p=>p.value),[80,90]);
assert.equal(state.seriesById.sla.points[0].components.slaSuccessCount,8);
assert.equal(state.seriesById.vbr.points[0].value,null);
assert.equal(state.seriesById.vbr.points[0].reason,'equipment-snapshot-period-mismatch');
assert.equal(state.seriesById.sla.slice.mine,'Северный');
assert(Object.isFrozen(state));
assert(Object.isFrozen(state.cards.sla));
assert(Object.isFrozen(state.cards.sla.current));
assert(Object.isFrozen(state.seriesById.sla.points[0].components));

// Nonconsecutive history must NOT replace missing September with August.
const gaps = api.create({
  selectedMonth:'2026-10',
  currentResults:{sla:ok('sla',90)},
  monthlyResults:[
    {period:'2026-08',sla:ok('sla',70)},
    {period:'2026-10',sla:ok('sla',90)}
  ]
});
assert.deepEqual(gaps.seriesById.sla.points.map(p=>p.period),['2026-08','2026-09','2026-10']);
assert.equal(gaps.seriesById.sla.points[1].value,null);
assert.equal(gaps.seriesById.sla.points[1].reason,'period-not-in-source-calendar');
assert.equal(gaps.cards.sla.previous.value,null);
assert.equal(gaps.cards.sla.previous.period,'2026-09');
assert.equal(gaps.cards.sla.previous.reason,'previous-period-not-in-source-calendar');
assert.equal(gaps.cards.sla.change,null);

const january = api.create({
  selectedMonth:'2026-01',
  currentResults:{sla:ok('sla',92)},
  monthlyResults:[{period:'2025-12',sla:ok('sla',91)},{period:'2026-01',sla:ok('sla',92)}]
});
assert.equal(january.cards.sla.previous.period,'2025-12');
assert.equal(january.cards.sla.change,1);

assert.throws(()=>api.create({monthlyResults:[{period:'2026-10'},{period:'2026-10'}]}),
  /duplicate monthly period/);

// PR-3: a certified incomplete reporting month is projected from independent
// full-history monthly Results. A calendar date alone never starts a forecast.
const componentHistory=Array.from({length:9},(_,i)=>{
  const period=new Date(Date.UTC(2026,i,1)).toISOString().slice(0,7);
  const days=new Date(Date.UTC(2026,i+1,0)).getUTCDate();
  const count=(i+2)*days/4;
  const hours={incidentHours:days*(2+i/10),plannedMaintenanceHours:days,
    unplannedMaintenanceHours:days/2,otherHours:days/3};
  const calendarHours=days*24*10;
  const ktgValue=(calendarHours-hours.incidentHours-hours.plannedMaintenanceHours-
    hours.unplannedMaintenanceHours-hours.otherHours)/
    (calendarHours-hours.plannedMaintenanceHours)*100;
  return {period,vbr:{...ok('vbr',(1-count/1000)*100,{failureCount:count,equipmentCount:1000}),
      diagnostics:{partialCoverage:false}},
    ktg:{...ok('ktg',ktgValue,{...hours,calendarHours,equipmentUnits:10}),
      diagnostics:{partialCoverage:false}}};
});
const octoberVbr=ok('vbr',98,{failureCount:20,equipmentCount:1000});
const octoberKtg=ok('ktg',99,{incidentHours:25,plannedMaintenanceHours:12,
  unplannedMaintenanceHours:8,otherHours:4,calendarHours:7440,equipmentUnits:10});
const reportingCoverage={kpis:{
  vbr:{kpiId:'vbr',reportMonth:'2026-10',reportMonthStatus:'incomplete',
    coverageFrom:'2026-01-01',coverageThrough:'2026-10-10',
    coverageBasis:'source-export-cutoff'},
  ktg:{kpiId:'ktg',reportMonth:'2026-10',reportMonthStatus:'incomplete',
    coverageFrom:'2026-01-01',coverageThrough:'2026-10-10',
    coverageBasis:'source-export-cutoff'}
}};
const forecastInput={calculatedAt:'2026-12-10T10:00:00Z',
  selectedMonth:'2026-10',currentResults:{vbr:octoberVbr,ktg:octoberKtg},
  reportingCoverage,
  sources:[source],
  monthlyResults:[...componentHistory,{period:'2026-10',vbr:octoberVbr,ktg:octoberKtg}]};
const enriched=api.withForecasts(forecastInput);
const nowcastView=api.create({...forecastInput,monthlyResults:enriched});
assert.equal(nowcastView.cards.vbr.forecast.forecastType,'reporting-month-nowcast');
assert.equal(nowcastView.cards.ktg.forecast.forecastType,'reporting-month-nowcast');
assert.equal(nowcastView.cards.vbr.forecast.horizon,'2026-10');
assert.equal(nowcastView.cards.vbr.forecast.asOf,'2026-10-10');
assert.equal(nowcastView.cards.vbr.current.value,98,'Observed VBR must not become a prediction');
assert.equal(nowcastView.seriesById.vbr.points.at(-1).value,98);
assert.strictEqual(nowcastView.seriesById.vbr.points.at(-1).forecast,
  nowcastView.cards.vbr.forecast,'Monthly and card forecasts share the same object');
assert.strictEqual(enriched.at(-1).forecasts.vbr,nowcastView.cards.vbr.forecast);
assert.equal(nowcastView.cards.ktg.current.value,99);
assert(Object.isFrozen(nowcastView.cards.vbr.forecast));
assert(Object.isFrozen(enriched.at(-1).forecasts));
const historicalView=api.create({...forecastInput,selectedMonth:'2026-09',monthlyResults:enriched});
assert.strictEqual(historicalView.cards.vbr.forecast,
  nowcastView.cards.vbr.forecast,
  'Forecast must remain anchored to latest incomplete reporting month');
assert.equal(historicalView.cards.ktg.forecast.horizon,'2026-10');
const primaryView=api.create({...forecastInput,monthlyResults:[]});
assert.equal(primaryView.cards.vbr.forecast.reason,'current-components-unavailable');
assert.equal(api.withForecasts({...forecastInput,monthlyResults:[]}).length,0);
const missingBoundary=api.withForecasts({...forecastInput,reportingCoverage:null});
assert.equal(missingBoundary.at(-1).forecasts,undefined);

console.log('KPI Report View Model: 18 cards, calendar comparison, gaps, source provenance and no forecast OK');
