'use strict';
const assert=require('node:assert/strict');
const {performance}=require('node:perf_hooks');
const source=require('../src/js/kpi/source_facts.js');
require('../src/js/modules/itsm/mb_presence.js');
require('../src/js/kpi/preparation/common.js');
const prepare=require('../src/js/kpi/preparation/classification.js');
require('../src/js/kpi/calculator/common.js');
require('../src/js/kpi/calculator/definitions.js');
const calculator=require('../src/js/kpi/calculator/classification_quality/calculate.js');
// Synthetic only. No real ITSM/MB identifiers, names, texts or raw records printed.
const N=12000;
const itsm=Array.from({length:N},(_,i)=>source.itsmFact({
  number:'SYN-'+i,completedAt:'2026-09-17',
  classificationQuality:i%4===0?'INC с исправлением':'INC без изм',
  typeAfterReclassification:'INC',
  initiatorGroup:['ЦГПС','СДГР','Заказчик','APIN'][i%4],
  division:'ЗФ',territory:'Северный',
  sdgrService:'Навесное оборудование',reclassifiedEquipment:'БКМ'
}));
const mobile=[];
for(let i=0;i<N/2;i++){
  for(let task=0;task<3;task++){
    mobile.push({recordKey:'SYN-TASK-'+i+'-'+task,
      request:'SYN-'+i,factDate:'2026-09-18',
      site:'Северный',equipmentPlacement:'Навесное',
      equipmentType:'БКМ',transport:'Синтетический объект'});
  }
}
for(let i=0;i<1000;i++)
  mobile.push({recordKey:'ORPHAN-'+i,request:'SYN-MB-'+i,
    factDate:'2026-09-18',site:'Северный',
    equipmentPlacement:'Навесное'});
const mbMeta={reportingCoverage:{
  confirmed:true,basis:'source-export-cutoff',
  coverageFrom:'2026-01-01',coverageThrough:'2026-09-30'
}};
const itMeta=mbMeta;
const before=process.memoryUsage().heapUsed,t0=performance.now();
const components=prepare.prepare(itsm);
const evidence=prepare.prepareDiagnostics(itsm,{available:true,records:mobile,meta:mbMeta},itMeta);
const elapsedMs=performance.now()-t0;
const riseMiB=(process.memoryUsage().heapUsed-before)/(1024*1024);
const query={period:'2026-09',filters:{mine:'Северный',
  equipmentClass:'mounted'}};
const result=calculator.calculate({
  classification:components,classificationDiagnostics:evidence
},query);
const diag=result.diagnostics.classificationCoverage;
assert.equal(result.components.classificationTotalCount,N);
assert.equal(result.components.classificationSuccessCount,N-N/4);
assert.equal(result.value,75);
assert.equal(diag.classifiedItsmCount,N);
assert.equal(diag.bothSameMonthCount,N/2);
assert.equal(diag.bothOtherMonthCount,0);
assert.equal(diag.itsmNotInLoadedMbCount,N/2);
assert.equal(diag.itsmConfirmedMbAbsenceCount,N/2);
assert.equal(diag.mbOnlyLoadedCount,1000);
assert.equal(diag.byInitiator.length,4);
assert.equal(diag.byInitiator.reduce((sum,g)=>sum+g.count,0),N);
assert(elapsedMs<30000,'Synthetic 12k ITSM/19k MB aggregation exceeded 30s safeguard');
assert(riseMiB<250,'Diagnostic aggregation exceeded conservative 250 MiB growth safeguard');
const t1=performance.now();
const repeat=calculator.calculate({classification:components,
  classificationDiagnostics:evidence},query);
const repeatMs=performance.now()-t1;
assert.equal(repeat.value,result.value);
assert.strictEqual(repeat.diagnostics.classificationCoverage.classifiedItsmCount,N);
// Diagnostic evidence never multiplies a single request by its MB task count.
assert.equal(diag.bothSameMonthCount,N/2);
console.log('PR-6 synthetic diagnostic profiling: '+JSON.stringify({
  itsmRequests:N,mbTasks:mobile.length,
  matchedUniqueRequests:diag.bothSameMonthCount,
  mbOnlyUniqueRequests:diag.mbOnlyLoadedCount,
  preparationMs:Math.round(elapsedMs),
  reusedCalculationMs:Math.round(repeatMs),
  heapGrowthMiB:Math.round(riseMiB*10)/10
}));
