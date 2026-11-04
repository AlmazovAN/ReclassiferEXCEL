'use strict';
const assert = require('node:assert/strict');
require('../src/js/modules/itsm/mb_presence.js');
require('../src/js/kpi/source_facts.js');
require('../src/js/kpi/preparation/common.js');
require('../src/js/kpi/preparation/classification.js');
require('../src/js/kpi/calculator/common.js');
require('../src/js/kpi/calculator/definitions.js');
require('../src/js/kpi/calculator/classification_quality/calculate.js');
require('../src/js/kpi/calculator/classification_quality_cgps/calculate.js');

const source = globalThis.ReclassifierKpiSourceFacts;
const preparation = globalThis.ReclassifierKpiPrepareClassification;
const general = globalThis.ReclassifierKpiCalculateClassificationQuality.calculate;
const cgps = globalThis.ReclassifierKpiCalculateClassificationQualityCgps.calculate;
const meta = {earliestSourceDate:'2026-01-01',latestSourceDate:'2026-10-31'};
function request(number, category, options={}) {
  return source.itsmFact({
    number, classificationQuality: category, createdAt:'2026-08-10',
    completedAt:'2026-09-21',closedAt:'2026-09-25',division:'КФ',
    territory:'р. Северный',sdgrService:'Навесное оборудование',
    reclassifiedEquipment:'БКМ',initiatorGroup:'ЦГПС',
    openedBy:'Пользователь',mbPresence:'Нет в МБ', // deliberately stale
    ...options
  });
}
function prepared(facts, records, override={}) {
  return {
    classification: preparation.prepare(facts),
    classificationCgps: preparation.prepareCgps(facts, {
      records,meta,...override
    })
  };
}
const rows = [];
for(let i=0;i<90;i++) rows.push(request('INC-'+i,'INC без изм'));
for(let i=0;i<5;i++) rows.push(request('RITM-CGPS-'+i,'RITM вместо INC'));
for(let i=0;i<5;i++) rows.push(request('RITM-OTHER-'+i,'RITM вместо INC',{
  initiatorGroup:'СДГР'
}));
const mb = rows.map(item=>({recordKey:'MB-'+item.requestNumber,request:item.requestNumber}));
mb.push({recordKey:'MB-EXTRA',request:'INC-0'}); // duplicate MB tasks don't duplicate requests
const p = prepared(rows,mb);
const q = {period:'2026-09-01'};
assert.equal(general(p,q).value,90);
const quality = cgps(p,q);
assert.equal(quality.dataState,'available');
assert(Math.abs(quality.value-100*90/95)<1e-10);
assert.equal(quality.components.classificationSuccessCount,90);
assert.equal(quality.components.classificationTotalCount,95);
assert.equal(quality.components.classificationRitmInsteadOfIncCount,5);
assert.equal(quality.components.excludedOtherInitiatorRitmCount,5);
assert.equal(quality.components.excludedNoMbCount,0);
assert.equal(quality.components.unknownMbCoverageCount,0);
assert.equal(quality.formulaVersion,'1.0.0');

const incOtherInitiators = [
  request('INC-B','INC с исправлением',{initiatorGroup:'СДГР'}),
  request('INC-C','INC не классифицирован',{initiatorGroup:'Администраторы'})
];
const all = rows.concat(incOtherInitiators);
const m2 = mb.concat(incOtherInitiators.map(item=>({request:item.requestNumber})));
const p2 = prepared(all,m2);
assert.equal(cgps(p2,q).components.classificationTotalCount,97,
  'All three INC categories must ignore the initiator group.');
assert.equal(cgps(p2,q).components.classificationIncCorrectedCount,1);
assert.equal(cgps(p2,q).components.classificationIncUnclassifiedCount,1);

const missingOne = mb.filter(item=>item.request!=='INC-1');
const withoutMb = prepared(rows,missingOne);
assert.equal(general(withoutMb,q).components.classificationTotalCount,100);
assert.equal(cgps(withoutMb,q).components.classificationTotalCount,94);
assert.equal(cgps(withoutMb,q).components.excludedNoMbCount,1);
assert.equal(cgps(withoutMb,q).components.classificationSuccessCount,89);
assert.equal(cgps(withoutMb,q).diagnostics.selectedExcludedNoMb,1);
assert.equal(cgps(prepared(rows,mb),q).value,quality.value,
  'New MB Dataset should restore the request without reprocessing ITSM.');
assert.equal(prepared(rows,mb).classificationCgps.meta.mbLinkage,
  'current-mobile-brigade-request');
assert.equal(rows[0].storedMbPresence,'Нет в МБ',
  'The stale human-readable ITSM column must not filter the live KPI.');
assert.equal(rows[0].equipmentName,'БКМ');

const missingCoverage = prepared(rows,missingOne,{
  meta:{earliestSourceDate:'2026-09-01',latestSourceDate:'2026-10-31'}
});
const incomplete = cgps(missingCoverage,q);
assert.equal(incomplete.dataState,'available');
assert.equal(incomplete.reason,null);
assert.equal(incomplete.components.unknownMbCoverageCount,0);
assert.equal(incomplete.components.excludedNoMbCount,1);
assert.equal(incomplete.components.excludedMissingRequestCount,0);
assert.equal(cgps(prepared(rows,[],{available:false}),q).reason,'mb-coverage-unknown');
assert.equal(cgps(prepared([],[],{meta}),q).reason,'classification-denominator-zero');

const august = request('INC-AUG','INC без изм',{
  completedAt:'2026-08-31',closedAt:'2026-09-05'
});
const september = request('INC-SEP','INC с исправлением',{
  completedAt:null,closedAt:'2026-09-05',initiatorGroup:'не ЦГПС'
});
const ranges = prepared([august,september],[
  {request:'INC-AUG'},{request:'INC-SEP'}
]);
assert.equal(cgps(ranges,{period:'2026-08-01'}).value,100);
assert.equal(cgps(ranges,{period:'2026-09-01'}).value,0);
assert.equal(cgps(ranges,{
  period:{start:'2026-08-01',end:'2026-09-30'}
}).value,50,'Range quality must be ratio of sums, not mean of percents.');
assert.equal(cgps(p,{period:'2026-09-01',filters:{mine:'Незнакомый'}}).reason,
  'classification-denominator-zero');
assert.equal(cgps(p,{period:'2026-09-01',filters:{unrecognized:'x'}}).reason,
  'unsupported-filter');

// An unmatched ID in another month must not disable the selected month.
const extra = request('INC-NOV','INC без изм',{
  createdAt:'2026-11-01',completedAt:'2026-11-05',closedAt:'2026-11-06'
});
const selected = prepared(rows.concat(extra),mb);
assert.equal(cgps(selected,q).dataState,'available');
assert.equal(cgps(selected,{period:'2026-11-01'}).reason,'classification-denominator-zero');
// Equipment-name aggregation uses the exact prepared ITSM classification
// name, and must change BOTH general and CGPS A/B/C/D denominators.
const equipmentCases=[
  request('INC-BKM-NAME','INC без изм',{reclassifiedEquipment:'БКМ'}),
  request('INC-SVR-NAME','INC с исправлением',{reclassifiedEquipment:'СВР'})
];
const equipmentData=prepared(equipmentCases,equipmentCases.map(f=>({request:f.requestNumber})));
for(const calculate of [general,cgps]){
  const allNames=calculate(equipmentData,q);
  const bkmOnly=calculate(equipmentData,{...q,filters:{equipmentName:'БКМ'}});
  const svrOnly=calculate(equipmentData,{...q,filters:{equipmentName:'СВР'}});
  const both=calculate(equipmentData,{...q,filters:{equipmentName:['БКМ','СВР']}});
  assert.equal(allNames.value,50);
  assert.equal(bkmOnly.value,100,'Selecting БКМ must actually filter the KPI');
  assert.equal(svrOnly.value,0,'Selecting СВР must actually filter the KPI');
  assert.equal(both.value,50,'Multiple names must aggregate counts, not KPI percentages');
  assert.equal(bkmOnly.components.classificationTotalCount,1);
  assert.equal(svrOnly.components.classificationTotalCount,1);
  assert.equal(both.components.classificationTotalCount,2);
}
console.log('PR3 CGPS KPI: 90/95, A/B/C/D scope, current MB, ID-only matching, absent/unavailable data, equipment-name filtering and diagnostics OK');
