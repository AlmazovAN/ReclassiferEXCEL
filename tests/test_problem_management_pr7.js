'use strict';
// PR7: independent tasks, percentages, distinct PRB count, eight charts, PDF.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
require('../src/js/app/reliability_dashboard_data.js');
require('../src/js/kpi/calculator/common.js');
require('../src/js/kpi/calculator/definitions.js');
const pm=require('../src/js/kpi/calculator/problem_management/calculate.js');
const analytics=require('../src/js/kpi/problem_management_analytics.js');
const prepared={prb:{id:'problem_management',rows:[
  {period:'2026-10-01',mine:'Северный',equipmentClass:'mounted',finalTaskType:'АВР',
    problemLinkState:'linked',problemId:'PRB001047',
    taskCount:6,usableLaborTaskCount:6,unusableLaborTaskCount:0,
    linkedTaskCount:6,laborHours:30,linkedLaborHours:30},
  {period:'2026-10-01',mine:'Северный',equipmentClass:'mounted',finalTaskType:'ТО',
    problemLinkState:'linked',problemId:'PRB001048',
    taskCount:2,usableLaborTaskCount:1,unusableLaborTaskCount:1,
    linkedTaskCount:2,laborHours:6,linkedLaborHours:6},
  {period:'2026-10-01',mine:'Северный',equipmentClass:'mounted',finalTaskType:'ТО',
    problemLinkState:'not-linked',problemId:null,
    taskCount:4,usableLaborTaskCount:4,unusableLaborTaskCount:0,
    linkedTaskCount:0,laborHours:20,linkedLaborHours:0},
  {period:'2026-10-01',mine:'Северный',equipmentClass:'mounted',finalTaskType:'АВР',
    problemLinkState:'request-not-found',problemId:null,
    taskCount:2,usableLaborTaskCount:0,unusableLaborTaskCount:2,
    linkedTaskCount:0,laborHours:0,linkedLaborHours:0},
  {period:'2026-10-01',mine:'Северный',equipmentClass:'mounted',finalTaskType:'АВР',
    problemLinkState:'ambiguous',problemId:null,
    taskCount:1,usableLaborTaskCount:1,unusableLaborTaskCount:0,
    linkedTaskCount:0,laborHours:10,linkedLaborHours:0},
  {period:'2026-11-01',mine:'Северный',equipmentClass:'mounted',finalTaskType:'АВР',
    problemLinkState:'linked',problemId:'PRB001047',
    taskCount:4,usableLaborTaskCount:4,unusableLaborTaskCount:0,
    linkedTaskCount:4,laborHours:12,linkedLaborHours:12}
],meta:{source:'fixture'}}};
const october={period:'2026-10-01',filters:{mine:'Северный'}};
const expected={
  problem_linked_tasks:8,
  problem_task_coverage:8/15*100,
  problem_active_count:2
};
const methods={
  problem_linked_tasks:'calculateLinkedTasks',
  problem_task_coverage:'calculateTaskCoverage',
  problem_active_count:'calculateActiveProblemCount'
};
for(const [id,value] of Object.entries(expected)){
  const result=pm[methods[id]](prepared,october);
  assert.equal(result.id,id);
  assert.equal(result.dataState,'available');
  assert(Math.abs(result.value-value)<1e-10,id+' computed '+result.value);
  assert.equal(result.methodologyStatus,'draft');
}
assert.equal(pm.calculateActiveProblemCount(prepared,{
  period:{from:'2026-10',to:'2026-11'},filters:{mine:'Северный'}
}).value,2,'one PRB repeated in different months counts only once');
const november=pm.calculateActiveProblemCount(prepared,{
  period:'2026-11-01',filters:{mine:'Северный'}
});
assert.equal(november.value,1);
assert.equal(pm.calculateTaskCoverage(prepared,{
  period:'2026-11-01',filters:{mine:'Северный'}
}).value,100);
assert.equal(pm.calculateTaskCoverage(prepared,{
  period:'2026-10-01',filters:{mine:'Несуществующий'}
}).value,null,'no tasks cannot be 0%');
assert.equal(pm.calculateTaskCoverage(prepared,{
  period:'2026-10-01',filters:{unsupported:'x'}
}).reason,'unsupported-filter');
assert.equal(pm.calculateActiveProblemCount(prepared,{
  period:'2026-10-01',filters:{problemId:'PRB001048'}
}).value,1,'problem filter must not bleed across other problems');
const month=(period,label,count,total,labor)=>({period,label,
  problem_linked_tasks:{value:count,dataState:'available'},
  problem_task_coverage:{value:total,dataState:'available'},
  problem_coverage_relative:{value:labor,dataState:'available'}});
const months=[month('2026-10','Окт',8,8/15*100,36/66*100),
  month('2026-11','Ноя',4,100,100)];
const selected=prepared.prb.rows.slice(0,5);
const charts=analytics.create(selected,months,[
  {id:'itsm_data',available:true},{id:'mobile_brigade_data',available:true}
]);
assert.equal(charts.length,8);
assert.deepEqual(charts.map(c=>c.id),[
  'prb-linkage','problem-link-labor','problem-linked-months',
  'problem-coverage-months','problem-labor-months',
  'problem-task-types','problem-mines','problem-identifiers'
]);
assert.equal(charts[0].items.reduce((sum,i)=>sum+i.value,0),15);
assert.equal(charts[1].items.reduce((sum,i)=>sum+i.value,0),66);
assert.equal(charts[2].items[0].value,8);
assert.equal(charts[6].items[0].value,36);
assert.equal(charts[7].items.reduce((sum,i)=>sum+i.value,0),36);
assert(Object.isFrozen(charts)&&Object.isFrozen(charts[0].items));
const withGap=analytics.create(selected,[months[0],{
  period:'2026-11',label:'Ноя',
  problem_linked_tasks:{dataState:'no-data',value:null}
}],[]);
assert.equal(withGap[2].items[1].value,null,
  'missing month must remain unavailable, never zero');
assert.equal(withGap[3].items[1].value,null);
const source=fs.readFileSync('src/js/app/reliability_dashboard.js','utf8');
const ctx={escapeHtml:v=>String(v??'').replaceAll('&','&amp;')
  .replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;')};
ctx.globalThis=ctx;vm.createContext(ctx);
vm.runInContext(source+'\nthis.renderManagement=renderReliabilityProblemChart;',ctx);
const html=ctx.renderManagement({charts,portfolio:[
  {title:'Связано с PRB',count:10},{title:'Без PRB',count:5}
]});
assert.equal((html.match(/data-chart-id=/g)||[]).length,1,
  'PR13 keeps one factual chart, not eight duplicate overview panels');
assert(html.includes('data-chart-id="prb-linkage"'));
assert(html.includes('Связь задач МБ с ИТ-проблемами'));
assert(!html.includes('reliability-management-charts'));
assert(!html.includes('Problem Management'));
const pdf=require('../src/js/app/reliability_pdf.js');
const snapshot={
  type:'reliability-report',status:'ready',calculatedAt:'2026-10-16T00:00:00Z',
  results:{},series:{monthly:months},query:{period:{id:'2026-10'}},
  breakdowns:{problemManagement:[],problemCharts:charts},sources:[]
};
const plan=pdf.createPlan(snapshot);
assert.equal(plan.problemCharts.length,8);
assert.notEqual(pdf.snapshotFingerprint(snapshot),pdf.snapshotFingerprint({
  ...snapshot,breakdowns:{...snapshot.breakdowns,
    problemCharts:charts.map((c,i)=>i===0?{...c,
      items:c.items.map((item,j)=>j===0?{...item,value:item.value+1}:item)}:c)}
}), 'any chart value change must change PDF identity');
console.log('PR7: three measured KPIs, unique PRB across months, eight underlying series, one overview chart and PDF identity OK');
