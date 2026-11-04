'use strict';
const assert=require('node:assert/strict');
const actual=require('../src/js/kpi/source_facts.js');
globalThis.ReclassifierKpiSourceFacts={
  ...actual,
  itsmDatasetFacts:(fields,rows)=>rows
};
const api=require('../src/js/kpi/operational_series.js');
assert.equal(api.dayId('2026-10-04T13:30:00'),'2026-10-04');
assert.equal(api.dayId('05.10.2026'),'2026-10-05');
assert.equal(api.dayId('2026-02-29'),null);
assert.equal(api.bucketId('2026-10-04','week'),'2026-09-28');
assert.equal(api.bucketId('2026-10-05','week'),'2026-10-05');
let itsm={
 meta:{sourceType:'sqlite',fields:['requestType','completedAt']},
 records:[
  {requestType:'INC',completedAt:'2026-10-04',mine:'Северный',equipmentClass:'mounted'},
  {requestType:'INC',completedAt:'2026-10-05',mine:'Северный',equipmentClass:'mounted'},
  {requestType:'INC',completedAt:'2026-10-05',mine:'Северный',equipmentClass:'mounted'},
  {requestType:'RITM',completedAt:'2026-10-05',mine:'Северный',equipmentClass:'mounted'},
  {requestType:'INC',completedAt:'2026-10-05',mine:'Таймырский',equipmentClass:'stationary'},
  {requestType:'INC',completedAt:'2026-10-05',mine:'Северный',equipmentClass:'stationary'},
  {requestType:'INC',completedAt:'invalid',mine:'Северный',equipmentClass:'mounted'}
 ]
};
let mb={meta:{sourceType:'sqlite'},records:[
 {factDate:'2026-10-04',site:'Северный',equipmentPlacement:'Навесное',
   laborState:'valid',laborHours:4},
 {factDate:'2026-10-05',site:'Северный',equipmentPlacement:'Навесное',
   laborState:'valid',laborHours:2.5},
 {factDate:'2026-10-05',site:'Северный',equipmentPlacement:'Навесное',
   laborState:'valid_zero',laborHours:0},
 {factDate:'2026-10-05',site:'Северный',equipmentPlacement:'Навесное',
   laborState:'invalid',laborHours:30}
]};
const groups=[{id:'all',label:'Все',mineValues:null},
  {id:'Северный',label:'р. Северный',mineValues:['Северный']}];
const classes=['mounted','stationary'];
function run(metric,scale){
 return api.series({instances:{itsm_data:itsm,mobile_brigade_data:mb},
  metric,scale,groups,classes,range:'all',window:2});
}
const find=(pack,id,cls)=>pack.series.find(s=>s.mineId===id&&s.equipmentClass===cls);
const daily=run('inc','day'),weekly=run('inc','week'),monthly=run('inc','month');
assert.equal(find(daily,'Северный','mounted').points.reduce((t,x)=>t+x.value,0),3);
assert.equal(find(weekly,'Северный','mounted').points.reduce((t,x)=>t+x.value,0),3);
assert.equal(find(monthly,'Северный','mounted').points.reduce((t,x)=>t+x.value,0),3);
assert.equal(find(monthly,'all','stationary').points[0].value,2);
assert.equal(find(monthly,'Северный','stationary').points[0].value,1);
assert.equal(daily.skippedRows,1);
const laborD=run('labor','day'),laborW=run('labor','week'),laborM=run('labor','month');
for(const pack of [laborD,laborW,laborM]){
 assert.equal(find(pack,'Северный','mounted').points.reduce((t,x)=>t+x.value,0),6.5);
}
assert.equal(laborD.skippedRows,1);
assert.equal(find(laborM,'Северный','mounted').points[0].value,6.5);
assert.equal(find(laborM,'Северный','mounted').points[0].rollingValue,null);
assert.equal(find(laborD,'Северный','mounted').points.at(-1).rollingValue,3.25);
assert.equal(daily.series[0].points.at(-1).period,'2026-10-05');
// Replacing the authoritative source instance must invalidate materialized
// daily aggregates. The old source and results stay untouched.
const old=monthly.series[0].points[0].value;
itsm={...itsm,records:[...itsm.records,{
 requestType:'INC',completedAt:'2026-10-05',mine:'Северный',equipmentClass:'mounted'}]};
assert.equal(find(run('inc','month'),'all','mounted').points[0].value,old+1);
assert.throws(()=>api.series({instances:{},metric:'vbr',scale:'day'}),/Недопустимые/);
// User-logic hardening: calendar months, not 32/96/371-day approximations.
// Selected October must still show October even if last INC was in September.
const calendarItsm={meta:{sourceType:'sqlite'},records:[
 {requestType:'INC',completedAt:'2024-02-29',mine:'Северный',equipmentClass:'mounted'},
 {requestType:'INC',completedAt:'2026-01-31',mine:'Северный',equipmentClass:'mounted'},
 {requestType:'INC',completedAt:'2026-08-31',mine:'Северный',equipmentClass:'mounted'},
 {requestType:'INC',completedAt:'2026-09-09',mine:'Северный',equipmentClass:'mounted'}
]};
const calendar={itsm_data:calendarItsm,mobile_brigade_data:{records:[],meta:{sourceType:'sqlite'}}};
const scoped=(scale,range,endMonth='2026-10')=>api.series({
 instances:calendar,metric:'inc',scale,groups,classes,range,endMonth,window:1
});
const octDaily=scoped('day','1m');
assert.equal(octDaily.start,'2026-10-01');
assert.equal(octDaily.end,'2026-10-31');
assert.equal(find(octDaily,'all','mounted').points.length,31);
assert.equal(find(octDaily,'all','mounted').points.reduce((sum,p)=>sum+p.value,0),0);
const three=scoped('month','3m');
assert.deepEqual(find(three,'all','mounted').points.map(p=>p.period),
 ['2026-08','2026-09','2026-10']);
assert.deepEqual(find(three,'all','mounted').points.map(p=>p.value),[1,1,0]);
const twelve=scoped('month','1y');
assert.equal(twelve.start,'2025-11');
assert.equal(twelve.end,'2026-10');
assert.equal(find(twelve,'all','mounted').points.length,12);
const leap=api.series({instances:calendar,metric:'inc',scale:'day',
 groups,classes,range:'1m',endMonth:'2024-02',window:1});
assert.equal(leap.start,'2024-02-29'); // series begins at first observed day
assert.equal(leap.end,'2024-02-29');
const noOctoberINC=scoped('week','1m');
assert.equal(noOctoberINC.end,'2026-10-26');
assert.equal(find(noOctoberINC,'all','mounted').points.at(-1).value,0);
console.log('Calendar operational range: February leap, October zero-event tail, 1/3/12 months and ISO week OK');
console.log('PR7 operational D/N/M: source date, ISO week, INC vs RITM, labor validity, scopes and revision parity OK');
