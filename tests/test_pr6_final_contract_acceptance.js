'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
for(const path of [
  '../src/js/app/reliability_dashboard_data.js',
  '../src/js/modules/itsm/mb_presence.js',
  '../src/js/kpi/source_facts.js',
  ...['common','failures','equipment','labor','sla','classification',
    'prb','ktg','index'].map(id=>'../src/js/kpi/preparation/'+id+'.js'),
  '../src/js/kpi/calculator/common.js',
  '../src/js/kpi/calculator/definitions.js',
  ...['vbr','ktg','sla','classification_quality','classification_quality_cgps',
    'labor','problem_management'].map(id=>
      '../src/js/kpi/calculator/'+id+'/calculate.js'),
  '../src/js/kpi/calculator/index.js',
  '../src/js/kpi/catalog/contracts.js',
  '../src/js/kpi/catalog/index.js',
  '../src/js/kpi/forecast_engine.js',
  '../src/js/kpi/report_view_model.js'
])require(path);
const facts=globalThis.ReclassifierKpiSourceFacts;
const prepare=globalThis.ReclassifierKpiPrepareClassification;
const quality=globalThis.ReclassifierKpiCalculateClassificationQuality;
const vm=globalThis.ReclassifierKpiReportViewModel;
const engine=globalThis.ReclassifierKpiForecastEngine;
const pdf=require('../src/js/app/reliability_pdf.js');

const days=id=>new Date(Date.UTC(Number(id.slice(0,4)),
  Number(id.slice(5,7)),0)).getUTCDate();
const source={id:'itsm_data',available:true,activeRevision:7,
  contentHash:'fixture-source-hash',freshness:'2026-09-15'};
const noMb={id:'mobile_brigade_data',available:false,activeRevision:null,
  contentHash:null};
const cov=id=>({
  sourceId:'itsm_data',kpiId:id,reportMonth:'2026-09',
  reportMonthStatus:'incomplete',coverageBasis:'source-export-cutoff',
  coverageFrom:'2026-01-01',coverageThrough:'2026-09-15'
});
const coverage={kpis:{vbr:cov('vbr'),ktg:cov('ktg')}};
const ok=(id,value,components)=>({id,value,dataState:'available',
  reason:null,formulaVersion:'1.0.0',components,diagnostics:{}});
const months=Array.from({length:8},(_,index)=>'2026-'+
  String(index+1).padStart(2,'0'));
const history=months.map((period,i)=>{
  const d=days(period);
  const incidents=(2+i*.25)*d,planned=[1,2,3,4,5,6,6,6][i]*d;
  const unplanned=.5*d,other=.25*d;
  const fund=24*d*10;
  return {period,
    vbr:ok('vbr',99,{
      failureCount:(1+i*.1)*d,equipmentCount:1000
    }),
    ktg:ok('ktg',96,{
      calendarHours:fund,incidentHours:incidents,
      plannedMaintenanceHours:planned,unplannedMaintenanceHours:unplanned,
      otherHours:other
    })
  };
});
const september={
  period:'2026-09',
  vbr:ok('vbr',98,{failureCount:20,equipmentCount:1000}),
  ktg:ok('ktg',98,{
    calendarHours:7200,equipmentUnits:10,incidentHours:40,
    plannedMaintenanceHours:60,unplannedMaintenanceHours:7,otherHours:4
  })
};
const sourceRows=[...history,september];
const input={monthlyResults:sourceRows,reportingCoverage:coverage,
  sources:[source,noMb]};
const rows=vm.withForecasts(input);
const actual=rows.at(-1);
const v=actual.forecasts.vbr,k=actual.forecasts.ktg;
assert.equal(v.forecastType,'reporting-month-nowcast');
assert.equal(k.forecastType,'reporting-month-nowcast');
assert.equal(v.dataState,'available');
assert.equal(k.dataState,'available');
assert.equal(v.horizon,'2026-09');
assert.equal(v.asOf,'2026-09-15');
assert.notEqual(v.value,98);
assert.equal(actual.vbr.value,98);
assert.equal(actual.ktg.value,98);
assert.equal(v.requestedMethodId,'linear-trend');
assert.equal(k.requestedMethodId,'linear-trend');
assert(v.methodVersion);
assert(k.methodComponents.incidentHours.methodVersion);
assert.equal(v.sourceRevisions.find(item=>
  item.datasetId==='itsm_data').revision,7);
assert(Object.isFrozen(v));
assert(Object.isFrozen(rows));
assert(Object.isFrozen(actual.forecasts));

const render=calculatedAt=>vm.create({selectedMonth:'2026-09',
  currentResults:{vbr:september.vbr,ktg:september.ktg},
  monthlyResults:rows,reportingCoverage:coverage,
  sources:input.sources,calculatedAt});
const report=render('2026-10-10T10:00:00Z');
const later=render('2027-03-09T10:00:00Z');
for(const id of ['vbr','ktg']){
  assert.strictEqual(report.cards[id].forecast,
    rows.at(-1).forecasts[id]);
  assert.strictEqual(report.seriesById[id].points.at(-1).forecast,
    report.cards[id].forecast);
  assert.strictEqual(later.cards[id].forecast,report.cards[id].forecast,
    'Opening a historical report later must not change the prediction');
  assert.equal(report.cards[id].current.value,98);
}
const revised=vm.withForecasts({...input,reportingCoverage:{
  kpis:{
    vbr:{...cov('vbr'),reportMonthStatus:'complete',coverageThrough:'2026-09-30'},
    ktg:{...cov('ktg'),reportMonthStatus:'complete',coverageThrough:'2026-09-30'}
  }
}});
assert.equal(revised.at(-1).forecasts.vbr.value,null);
assert.equal(revised.at(-1).forecasts.ktg.value,null);
assert.equal(revised.at(-1).forecasts.vbr.reason,'report-month-complete');
const uncertified=vm.withForecasts({...input,reportingCoverage:{kpis:{
  vbr:{...cov('vbr'),reportMonthStatus:'unknown',coverageBasis:null},
  ktg:{...cov('ktg'),reportMonthStatus:'unknown',coverageBasis:null}
}}});
assert.equal(uncertified.at(-1).forecasts.vbr.value,null);
assert.equal(uncertified.at(-1).forecasts.ktg.value,null);
// Changing only a report display range never changes the source forecast.
const august=vm.create({selectedMonth:'2026-08',
  currentResults:history.at(-1),monthlyResults:rows,
  reportingCoverage:coverage,sources:input.sources});
assert.strictEqual(august.cards.vbr.forecast,v);

const raw=id=>facts.itsmFact({
  number:id,classificationQuality:'INC без изм',
  completedAt:'2026-09-20',initiatorGroup:'ЦГПС',
  territory:'Северный',sdgrService:'Навесное оборудование'
});
const classified=[raw('INC-1'),facts.itsmFact({
  number:'INC-2',classificationQuality:'INC с исправлением',
  completedAt:'2026-09-18',initiatorGroup:'Заказчик',
  territory:'Северный',sdgrService:'Навесное оборудование'
})];
const qualityFacts=prepare.prepare(classified);
const mb={available:true,records:[
  {recordKey:'t1',request:'INC-1',factDate:'2026-09-19',
    site:'Северный',equipmentPlacement:'Навесное'},
  {recordKey:'t2',request:'inc-1',factDate:'2026-09-20',
    site:'Северный',equipmentPlacement:'Навесное'}
],meta:{}};
const diag=prepare.prepareDiagnostics(classified,mb,{});
const q=quality.calculate({classification:qualityFacts,
  classificationDiagnostics:diag},{period:'2026-09'});
assert.equal(q.value,50);
assert.equal(q.components.classificationTotalCount,2);
assert.equal(q.diagnostics.classificationCoverage.bothSameMonthCount,1);
assert.equal(q.diagnostics.classificationCoverage.itsmNotInLoadedMbCount,1);
const qUnlinked=quality.calculate({classification:qualityFacts,
  classificationDiagnostics:prepare.prepareDiagnostics(classified,{
    available:false,records:[]
  },{})},{period:'2026-09'});
assert.equal(qUnlinked.value,q.value,'MB loss must not alter overall classification');
const pdfSnapshot={
  type:'reliability-report',schemaVersion:'1.0.0',
  calculatedAt:'2027-03-09T10:00:00Z',
  query:{period:{id:'2026-09',month:'2026-09'},
    mine:{id:'all'},equipmentClass:{id:'all'}},
  results:{
    vbr:september.vbr,ktg:september.ktg,
    classification_quality:q
  },
  series:{monthly:rows},
  kpiView:report,
  sources:[source,noMb],
  breakdowns:{labor:[],problemManagement:[]}
};
const pdfPlan=pdf.createPlan(pdfSnapshot);
assert.strictEqual(pdfPlan.forecastVbr,v);
assert.strictEqual(pdfPlan.forecastKtg,k);
assert.strictEqual(pdfPlan.results.find(item=>
  item.id==='classification_quality'),q);
const digest=pdf.snapshotFingerprint(pdfSnapshot);
assert.equal(digest,pdfPlan.fingerprint);
assert.notEqual(pdf.snapshotFingerprint({
  ...pdfSnapshot,results:{...pdfSnapshot.results,classification_quality:{
    ...q,diagnostics:{classificationCoverage:{
      ...q.diagnostics.classificationCoverage,bothSameMonthCount:0
    }}
  }}
}),digest,'PDF identity must track classification diagnostics');
assert.equal(pdfSnapshot.results.vbr.value,98);
assert.equal(pdfSnapshot.results.classification_quality.value,50);
assert.equal(globalThis.ReclassifierKpiDefinitions.classification_quality.formulaVersion,'1.1.0');
const uiTitle=globalThis.ReclassifierReliabilityDashboardData.kpiGroups.dataQuality
  .find(entry=>entry.id==='classification_quality').title;
assert.equal(uiTitle,'Качество классификации общее');
assert(!fs.readFileSync('src/js/app/reliability_pdf.js','utf8')
  .includes('Качество классификации — общее'));
console.log('PR-6 integration: certified historical forecast → shared KPI Snapshot → PDF, full-month/unknown guard, unchanged A/B/C/D and source revision OK');
