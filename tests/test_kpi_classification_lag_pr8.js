// PR-8: historical as-of snapshots, immutable matched populations, causal
// backtest, and fail-closed diagnostics. No modifications to the real KPI.
'use strict';
const assert=require('node:assert/strict');
const model=require('../src/js/kpi/classification_lag_forecast.js');
assert(Object.isFrozen(model));
assert.equal(model.version,'0.1.0');
assert.equal(model.methodId,'revision-lag-median-delta');
assert.deepEqual(model.supported,['classification_quality','classification_quality_cgps']);
const iso=(year,month,day)=>new Date(Date.UTC(year,month,day)).toISOString().slice(0,10);
const end=(month)=>{const [y,m]=month.split('-').map(Number);return Date.UTC(y,m,0);};
const sources=(cgps=false)=>[
  {datasetId:'itsm_data',revision:3,contentHash:'itms-hash-1234'},
  ...(cgps?[{datasetId:'mobile_brigade_data',revision:4,
    contentHash:'mb-hash-5678'}]:[])
];
const state=(month,offset,successCount,totalCount,hash,cgps=false)=>{
  const time=iso(2025,0,1); // Avoid relying on wall clock.
  return {observedAt:new Date(end(month)+offset*86400000).toISOString().slice(0,10),
    successCount,totalCount,populationHash:hash,sources:sources(cgps)};
};
function fixture(kpiId='classification_quality'){
  const cgps=kpiId==='classification_quality_cgps';
  const history=Array.from({length:10},(_,i)=>{
    const month=iso(2025,i,1).slice(0,7);
    const hash='matched-population-'+i;
    return {cohortMonth:month,
      early:state(month,4,60+i,100,hash,cgps),
      final:state(month,24,70+i,100,hash,cgps)};
  });
  const currentMonth='2026-09';
  return {kpiId,auditBasis:'case-level-versioned-asof',
    asOf:'2026-10-06',cohortMonth:currentMonth,
    current:{...state(currentMonth,4,70,100,'current-fixed-cohort',cgps),
      observedAt:'2026-10-05'},history};
}
const input=fixture(),original=JSON.stringify(input);
const result=model.predict(input);
assert.equal(result.dataState,'available');
assert.equal(result.value,80);
assert.equal(result.observedValue,70);
assert.equal(result.change,10);
assert.equal(result.horizon,'2026-09');
assert.equal(result.forecastType,'same-cohort-reclassification-lag');
assert.equal(result.status,'experimental-not-approved');
assert.equal(result.target,'eventual-quality-of-same-closed-cohort');
assert.equal(result.methodId,'revision-lag-median-delta');
assert(result.quality.validationPairs>=3);
assert.equal(result.quality.mae,0);
assert(result.quality.baselineMae>0);
assert.equal(result.quality.passed,true);
assert(Object.isFrozen(result));
assert(Object.isFrozen(result.sourceRevisions));
assert.equal(JSON.stringify(input),original,'Model must never mutate audit trail');
assert.equal(model.predict(fixture('classification_quality_cgps')).value,80);
assert.equal(model.predict({...fixture(),kpiId:'sla'}).reason,
  'unsupported-classification-kpi');

const snapshot={
  results:{
    classification_quality:{dataState:'available',value:70,
      components:{classificationSuccessCount:70,classificationTotalCount:100}},
    classification_quality_cgps:{dataState:'available',value:70,
      components:{classificationSuccessCount:70,classificationTotalCount:100}}
  },
  kpiView:{cards:{classification_quality:{forecast:{
    dataState:'available',value:74,methodId:'last-value',horizon:'2026-10'}}}}
};
const before=JSON.stringify(snapshot);
assert.equal(model.evaluateSnapshot(snapshot,'classification_quality',input).value,80);
assert.equal(snapshot.kpiView.cards.classification_quality.forecast.value,74);
assert.equal(model.evaluateSnapshot(snapshot,'classification_quality',
  {...input,current:{...input.current,successCount:71}}).reason,
  'snapshot-component-mismatch');
assert.equal(JSON.stringify(snapshot),before,'Report Snapshot is read-only');

// No data or non-audited history: never infer engineering change dates from
// ticket close time, snapshot load time, dictionary revision or source hash.
for(const bad of [
  {...input,auditBasis:'dataset-upload-history'},
  {...input,auditBasis:null},
]){
  const r=model.predict(bad);
  assert.equal(r.dataState,'insufficient');
  assert.equal(r.value,null);
  assert.equal(r.reason,'no-versioned-asof-audit-history');
}
const insufficient=model.predict({...input,history:input.history.slice(0,4)});
assert.equal(insufficient.reason,'insufficient-audited-cohorts');
assert.equal(insufficient.value,null);
assert.equal(model.predict({...input,asOf:'2026-09-28'}).reason,
  'cohort-not-closed-or-asof-invalid');
assert.equal(model.predict({...input,asOf:'2026-10-40'}).reason,
  'cohort-not-closed-or-asof-invalid');
assert.equal(model.predict({...input,current:{
  ...input.current,observedAt:'2026-10-10'}}).reason,
  'current-vintage-unverified');
assert.equal(model.predict({...input,current:{
  ...input.current,sources:[{datasetId:'itsm_data',revision:1,
    contentHash:'too-short'}]}}).reason,null,
  'A valid separate revision may be given, but it cannot change the protected fact.');
assert.equal(model.predict({...input,current:{
  ...input.current,populationHash:''}}).reason,
  'current-vintage-unverified');
assert.equal(model.predict({...input,history:[
  {...input.history[0],final:{...input.history[0].final,totalCount:101}},
  ...input.history.slice(1)
]}).reason,'invalid-or-leaking-vintage-pair');
assert.equal(model.predict({...input,history:[
  {...input.history[0],final:{...input.history[0].final,
    populationHash:'not-the-same-population'}},...input.history.slice(1)
]}).reason,'invalid-or-leaking-vintage-pair');
assert.equal(model.predict({...input,history:[
  {...input.history[0],final:{...input.history[0].final,
    observedAt:'2026-10-12'}},...input.history.slice(1)
]}).reason,'invalid-or-leaking-vintage-pair');
assert.equal(model.predict({...input,history:[
  input.history[0],input.history[0],...input.history.slice(2)
]}).reason,'invalid-or-leaking-vintage-pair');
assert.equal(model.predict({...input,history:input.history.map(x=>({
  ...x,final:{...x.final,successCount:x.early.successCount}
}))}).reason,'not-better-than-unchanged-quality');
const cgpsBad=fixture('classification_quality_cgps');
cgpsBad.history[0].early.sources=[cgpsBad.history[0].early.sources[0]];
assert.equal(model.predict(cgpsBad).reason,'invalid-or-leaking-vintage-pair');

// All finalized cohorts are valid as of today, but when finals arrive much
// later than subsequent observations the backtest must not learn the future.
const delayed=fixture();
delayed.history=delayed.history.map(x=>({
  ...x,final:{...x.final,
    observedAt:new Date(end(x.cohortMonth)+150*86400000).toISOString().slice(0,10)}
}));
const lagged=model.predict(delayed);
assert(['insufficient-causal-backtests','invalid-or-leaking-vintage-pair']
  .includes(lagged.reason));
assert.equal(lagged.value,null);

console.log('PR-8 audited classification lag: verified matched vintages, rolling causal MAE, CGPS MB, no leakage, no silent updates to Snapshot OK');
