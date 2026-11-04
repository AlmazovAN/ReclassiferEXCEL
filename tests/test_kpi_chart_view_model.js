// Step 7: moving KPI projection uses numerator/denominator totals and does not bridge gaps.
'use strict';
const assert=require('node:assert/strict');
require('../src/js/app/reliability_dashboard_data.js');
require('../src/js/modules/itsm/mb_presence.js');
require('../src/js/kpi/source_facts.js');
for(const path of ['common','failures','equipment','labor','sla','classification','prb','ktg','index'])
  require('../src/js/kpi/preparation/'+path+'.js');
require('../src/js/kpi/calculator/common.js');
require('../src/js/kpi/calculator/definitions.js');
for(const path of ['vbr','ktg','sla','classification_quality','classification_quality_cgps','labor','problem_management'])
  require('../src/js/kpi/calculator/'+path+'/calculate.js');
require('../src/js/kpi/calculator/index.js');
require('../src/js/kpi/catalog/contracts.js');
require('../src/js/kpi/catalog/index.js');
require('../src/js/kpi/forecast_engine.js');
require('../src/js/kpi/report_view_model.js');
require('../src/js/kpi/chart_view_model.js');

const chart=globalThis.ReclassifierKpiChartViewModel;
assert.equal(chart.version,'1.1.0');
const p=(period,value,components)=>({period,value,components,dataState:'available'});
const sla=[
  p('2026-01',90,{slaSuccessCount:9,slaTotalCount:10}),
  p('2026-02',50,{slaSuccessCount:1,slaTotalCount:2}),
  p('2026-03',90,{slaSuccessCount:18,slaTotalCount:20}),
  p('2026-04',60,{slaSuccessCount:3,slaTotalCount:5})
];
const x=chart.rolling({kpiId:'sla',points:sla,window:3});
assert.equal(x.supported,true);
assert.equal(x.method,'ratio-of-sums');
assert.equal(x.numerator,'slaSuccessCount');
assert.equal(x.denominator,'slaTotalCount');
assert.equal(x.points[0].value,null);
assert.equal(x.points[1].value,null);
assert.equal(x.points[2].value,87.5); // 28 successes / 32 included, not arithmetic average of percentages.
assert(Math.abs(x.points[3].value- (22/27*100))<1e-10);
assert(Object.isFrozen(x));
assert(Object.isFrozen(x.points[2]));
const reactive=[
 p('2026-01',50,{reactiveLaborHours:5,totalLaborHours:10}),
 p('2026-02',10,{reactiveLaborHours:1,totalLaborHours:10})
];
const r=chart.rolling({kpiId:'reactive_share',points:reactive,window:2});
assert.equal(r.points[1].value,30);
const prb=[
 p('2026-01',100,{linkedLaborHours:1,laborHours:1}),
 p('2026-02',10,{linkedLaborHours:1,laborHours:10})
];
assert(Math.abs(chart.rolling({kpiId:'problem_coverage_relative',points:prb,window:2}).points[1].value- (2/11*100))<1e-9);
const absolute=[
 p('2026-01',10,{laborHours:10}),
 p('2026-02',20,{laborHours:20}),
 p('2026-03',40,{laborHours:40})
];
const mean=chart.rolling({kpiId:'total_labor',points:absolute,window:3});
assert.equal(mean.method,'average');
assert.equal(mean.points[2].value,70/3);
const incomplete=[
 p('2026-01',90,{slaSuccessCount:9,slaTotalCount:10}),
 {period:'2026-02',value:null,dataState:'no-data',reason:'no-source',components:{}},
 p('2026-03',70,{slaSuccessCount:7,slaTotalCount:10})
];
assert.equal(chart.rolling({kpiId:'sla',points:incomplete,window:3}).points[2].value,null);
assert.equal(chart.rolling({kpiId:'sla',points:incomplete,window:3}).points[2].reason,'missing-or-unavailable-month');
const gap=[sla[0],sla[2]];
assert.equal(chart.rolling({kpiId:'sla',points:gap,window:2}).points[1].reason,'missing-or-unavailable-month');
const incompleteParts=[sla[0],p('2026-02',100,{slaSuccessCount:1})];
assert.equal(chart.rolling({kpiId:'sla',points:incompleteParts,window:2}).points[1].reason,'missing-ratio-components');
const vbr=[
 p('2026-01',95,{failureCount:5,equipmentCount:100}),
 p('2026-02',90,{failureCount:10,equipmentCount:100}),
 p('2026-03',85,{failureCount:15,equipmentCount:100})
];
const vbrRoll=chart.rolling({kpiId:'vbr',points:vbr,window:3});
assert.equal(vbrRoll.supported,true);
assert.equal(vbrRoll.method,'vbr-fixed-population');
assert.equal(vbrRoll.points[2].value,90);
const ktg=[
 p('2026-01',90,{productiveHours:90,availableHours:100}),
 p('2026-02',60,{productiveHours:30,availableHours:50}),
 p('2026-03',50,{productiveHours:100,availableHours:200})
];
const ktgRoll=chart.rolling({kpiId:'ktg',points:ktg,window:3});
assert.equal(ktgRoll.supported,true);
assert.equal(ktgRoll.points[2].value,220/350*100);
const switchedOff=chart.rolling({kpiId:'vbr',points:vbr,window:1});
assert(switchedOff.points.every(p=>p.value===null&&p.reason==='trend-disabled'));
assert.equal(switchedOff.window,1);
assert.throws(()=>chart.rolling({kpiId:'sla',points:sla,window:13}),/moving window/);
assert.equal(chart.preceding('2026-01',1),'2025-12');
assert.equal(chart.preceding('2026-06',5),'2026-01');
const projection=chart.project({kpiId:'sla',series:{kpiId:'sla',points:sla},
  selectedMonth:'2026-04',axisStep:'quarter',window:2});
assert.deepEqual(projection.points.map(t=>t.period),['2026-01','2026-02','2026-03','2026-04']);
assert.equal(projection.points[0].rollingValue,null);
assert.equal(projection.points[1].rollingValue,(10/12)*100);
assert.equal(projection.rollingSupported,true);
assert.equal(projection.axisStep,'quarter');
assert.deepEqual(projection.axisTicks.map(t=>t.period),['2026-01','2026-04']);
assert.equal(projection.axisTicks[0].label,'1 кв. 2026');
assert.equal(projection.axisTicks[1].label,'2 кв. 2026');
const allMonths=Array.from({length:30},(_,i)=>{
  const date=new Date(Date.UTC(2024,i,1));
  return p(date.toISOString().slice(0,7),i+1,{laborHours:i+1});
});
const allSeries={kpiId:'total_labor',points:allMonths};
const scales=['month','quarter','halfyear','year'];
const views=scales.map(axisStep=>chart.project({
  kpiId:'total_labor',series:allSeries,selectedMonth:'2026-06',axisStep,window:4
}));
assert(views.every(view=>view.points.length===30),'Axis selection must never crop history.');
assert(views.every(view=>view.points[0].period==='2024-01'));
assert(views.every(view=>view.points.at(-1).period==='2026-06'));
assert(views.every(view=>view.points.map(t=>t.value).join(',')===views[0].points.map(t=>t.value).join(',')));
assert.deepEqual(views.map(view=>view.axisTicks.length),[30,10,5,3]);
assert.deepEqual(views[3].axisTicks.map(t=>t.label),['2024','2025','2026']);
assert.deepEqual(views[2].axisTicks.map(t=>t.label),['I п/г 2024','II п/г 2024','I п/г 2025','II п/г 2025','I п/г 2026']);
assert(views.every(view=>Object.isFrozen(view.axisTicks)));
assert.deepEqual(chart.axisSteps,['month','quarter','halfyear','year']);
const viewport=(range)=>chart.project({
 kpiId:'total_labor',series:allSeries,selectedMonth:'2026-06',
 range,axisStep:'month',window:1
});
assert.deepEqual(['1m','3m','1y','all'].map(range=>viewport(range).points.length),[2,4,13,30]);
assert.equal(viewport('1m').points[0].period,'2026-05');
assert.equal(viewport('3m').points[0].period,'2026-03');
assert.equal(viewport('1y').points[0].period,'2025-06');
assert.equal(viewport('all').points[0].period,'2024-01');
assert.throws(()=>viewport('invalid'),/range/);
assert.throws(()=>chart.project({kpiId:'sla',series:{kpiId:'vbr',points:sla},axisStep:'month'}),/mismatch/);
assert.throws(()=>chart.project({kpiId:'sla',series:{kpiId:'sla',points:sla},axisStep:'week'}),/axis step/);
const prior=chart.project({kpiId:'total_labor',series:allSeries,
  selectedMonth:'2025-12',axisStep:'year',window:4});
assert.equal(prior.points.length,24,'Selected report month remains the upper bound.');
assert.equal(prior.points.at(-1).period,'2025-12');
console.log('KPI chart axis step 1: full history, aligned month/quarter/half-year/year ticks, rolling, gaps and bounds OK');
