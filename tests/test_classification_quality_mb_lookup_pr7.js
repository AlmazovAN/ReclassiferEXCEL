'use strict';
// PR 7: request ID is the ONLY MB membership condition. A missing
// initiator mapping is a distinct reason for excluding D/RITM, not INC.
const assert=require('node:assert/strict');
const presence=require('../src/js/modules/itsm/mb_presence.js');
require('../src/js/kpi/source_facts.js');
require('../src/js/kpi/preparation/common.js');
require('../src/js/kpi/preparation/classification.js');
require('../src/js/kpi/calculator/common.js');
require('../src/js/kpi/calculator/definitions.js');
require('../src/js/kpi/calculator/classification_quality/calculate.js');
require('../src/js/kpi/calculator/classification_quality_cgps/calculate.js');
const facts=globalThis.ReclassifierKpiSourceFacts;
const prep=globalThis.ReclassifierKpiPrepareClassification;
const general=globalThis.ReclassifierKpiCalculateClassificationQuality.calculate;
const cgps=globalThis.ReclassifierKpiCalculateClassificationQualityCgps.calculate;
const period={period:'2026-09-01'};
const make=(number,cat,group='ЦГПС',extra={})=>facts.itsmFact({
  number,classificationQuality:cat,initiatorGroup:group,
  createdAt:'2026-01-01',completedAt:'2026-09-25',closedAt:'2026-09-26',
  territory:'р. Северный',sdgrService:'Навесное оборудование',
  reclassifiedEquipment:'БКМ',...extra
});
const rows=[];
for(let i=0;i<90;i++)rows.push(make('INC-'+i,'INC без изм'));
for(let i=0;i<5;i++)rows.push(make('RITM-CGPS-'+i,'RITM вместо INC'));
for(let i=0;i<5;i++)rows.push(make('RITM-OTHER-'+i,'RITM вместо INC','Единство'));
for(let i=0;i<3;i++)rows.push(make('RITM-UNMAPPED-'+i,'RITM вместо INC',''));
rows.push(make('INC-BLANK-1','INC без изм',''));
rows.push(make('INC-BLANK-2','INC без изм',' '));
rows.push(make('INC-NOMATCH','INC без изм','ЦГПС',{createdAt:'2026-01-01'}));
rows.push(make('','INC без изм','ЦГПС'));
const mb=rows.filter(row=>row.requestNumber&&row.requestNumber!=='INC-NOMATCH')
  .map(row=>({recordKey:'TASK-'+row.requestNumber,request:row.requestNumber}));
mb.push({recordKey:'TASK-DUP',request:'  inc-0  '});
const mk=(records,options={})=>({
  classification:prep.prepare(records),
  classificationCgps:prep.prepareCgps(records,{
    records:mb,available:true,
    meta:{earliestSourceDate:'2026-09-21',latestSourceDate:'2026-09-30'},
    ...options
  })
});
const all=mk(rows);
assert.equal(general(all,period).components.classificationTotalCount,107);
assert.equal(general(all,period).components.classificationSuccessCount,94);
const quality=cgps(all,period);
assert.equal(quality.dataState,'available');
assert.equal(quality.components.classificationTotalCount,97);
assert.equal(quality.components.classificationSuccessCount,92);
assert(Math.abs(quality.value-92/97*100)<1e-10);
assert.equal(quality.components.excludedNoMbCount,1);
assert.equal(quality.components.unknownMbCoverageCount,0);
assert.equal(quality.components.excludedOtherInitiatorRitmCount,5);
assert.equal(quality.components.excludedUnknownInitiatorRitmCount,3);
assert.equal(quality.components.excludedMissingRequestCount,1);
assert.equal(quality.diagnostics.selectedExcludedOtherInitiatorRitm,5);
assert.equal(quality.diagnostics.selectedExcludedUnknownInitiatorRitm,3);
assert.equal(quality.diagnostics.selectedExcludedMissingRequest,1);
assert.equal(all.classificationCgps.meta.excludedUnknownInitiatorRitmRows,3);
assert.equal(all.classificationCgps.meta.missingRequestRows,1);
assert.equal(all.classificationCgps.meta.mbRule,'exact-current-request-id-no-date-coverage');

const index=presence.buildIndex(mb);
const dates=[null,'','2020-01-01','2026-09-26','2099-12-31'];
for(const date of dates) {
  assert.equal(presence.evaluate(index,'inc-0',date,{latestSourceDate:'1900-01-01'}),'Есть в МБ');
  assert.equal(presence.evaluate(index,'INC-NOMATCH',date,{earliestSourceDate:'2099-01-01'}),'Нет в МБ');
}
assert.equal(index.size,106-1,'Duplicate task in MB does not duplicate request ID'); // 107 rows - 1 absent - 1 empty
assert.equal(presence.evaluate(index,'',null,{},true),'Нет данных МБ');
assert.equal(presence.evaluate(index,'INC-0',null,{},false),'Нет данных МБ');
assert.equal(presence.evaluate(null,'INC-0',null,{},true),'Нет данных МБ');
assert.equal(presence.fromCurrentDatasets('INC-NOMATCH',null,{records:mb,meta:{}}),'Нет в МБ');
assert.equal(presence.fromCurrentDatasets('INC-0',null,null),'Нет данных МБ');

const noMetadata=mk(rows,{meta:{}});
assert.equal(cgps(noMetadata,period).value,quality.value);
const noCoverageDates=mk(rows,{meta:{earliestSourceDate:'2099-01-01',latestSourceDate:'2099-01-02'}});
assert.equal(cgps(noCoverageDates,period).value,quality.value);
const absentDataset=mk(rows,{records:[],available:false,meta:{}});
const unavailable=cgps(absentDataset,period);
assert.equal(unavailable.value,null);
assert.equal(unavailable.dataState,'no-data');
assert.equal(unavailable.reason,'mb-coverage-unknown');
assert.equal(unavailable.components.excludedNoMbCount,0);
assert.equal(unavailable.components.unknownMbCoverageCount,98); // 90 + 5 CGPS D + 2 blank INC + 1 nomatch
assert.equal(unavailable.components.excludedUnknownInitiatorRitmCount,3);
assert.equal(unavailable.components.excludedMissingRequestCount,1);

const onlyUnmapped=mk([
  make('RITM-X','RITM вместо INC',''),
  make('RITM-Y','RITM вместо INC','Другая группа')
]);
assert.equal(cgps(onlyUnmapped,period).reason,'classification-denominator-zero');
assert.equal(cgps(onlyUnmapped,period).components.excludedUnknownInitiatorRitmCount,1);
assert.equal(cgps(onlyUnmapped,period).components.excludedOtherInitiatorRitmCount,1);

const onlyMissingId=mk([make(null,'INC без изм','')]);
assert.equal(cgps(onlyMissingId,period).reason,'classification-denominator-zero');
assert.equal(cgps(onlyMissingId,period).components.excludedMissingRequestCount,1);
assert.equal(cgps(all,{period:'2026-08-01'}).reason,'classification-denominator-zero');
assert.equal(cgps(all,{period:'2026-09-01',filters:{mine:'Таймырский'}}).reason,
  'classification-denominator-zero');
console.log('PR7 MB matching: ID-only independent of dates, explicit unknown dataset, blank/other RITM initiators, missing IDs, duplicate tasks, unchanged formula OK');
