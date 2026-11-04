const assert = require('node:assert/strict');
const facts = require('../src/js/kpi/source_facts.js');

const certified=facts.certifyReportingCoverage({
  coverageFrom:'2026-01-01',coverageThrough:'2026-09-15'
},{datasetId:'itsm_data',confirmed:true,timestamp:'2026-10-10T10:00:00Z'});
assert.equal(certified.confirmed,true);
assert.equal(certified.certifiedBy,'user-explicit-dataset-attestation');
assert.equal(certified.scope,'entire-accumulated-dataset');
assert.equal(facts.sourceReportingCoverage('itsm_data',{
  meta:{reportingCoverage:certified}
}).status,'confirmed');
assert.equal(facts.reportingMonthStatus('2026-09',facts.sourceReportingCoverage(
  'itsm_data',{meta:{reportingCoverage:certified}}
)).status,'incomplete');
assert.throws(()=>facts.certifyReportingCoverage({
  coverageFrom:'2026-01-01',coverageThrough:'2026-09-15'
},{datasetId:'itsm_data',confirmed:false,timestamp:'2026-10-10T10:00:00Z'}),
/подтверждение/);
assert.throws(()=>facts.certifyReportingCoverage({
  coverageFrom:'2026-09-31',coverageThrough:'2026-10-09'
},{datasetId:'itsm_data',confirmed:true,timestamp:'2026-10-10T10:00:00Z'}),
/корректный интервал/);
assert.throws(()=>facts.certifyReportingCoverage({
  coverageFrom:'2026-01-01',coverageThrough:'2026-09-15'
},{datasetId:'drivers',confirmed:true,timestamp:'2026-10-10T10:00:00Z'}),
/только для ITSM и Мобильных бригад/);
assert.equal(facts.sourceReportingCoverage('itsm_data',{
  meta:{latestSourceDate:'2026-09-15'}
}).status,'unknown');
const contradicted=facts.sourceReportingCoverage('itsm_data',{
  meta:{latestSourceDate:'2026-09-22',reportingCoverage:certified}
});
assert.equal(contradicted.status,'unknown');
assert.equal(contradicted.reason,'observations-after-certified-cutoff');



// Canonical place identity is shared by ITSM, MB and Drivers.
for(const [source,canonical] of [
  ['Ангидрит','Ангидрит'],['ш. Ангидрит','Ангидрит'],
  ['шахта Ангидрит','Ангидрит'],
  ['Известняков','Известняков'],['ш. Известняков','Известняков'],
  ['шахта Известняков','Известняков'],
  ['Кауль-Котсельваара','Кауль-Котсельваара']
]) assert.equal(facts.mineName(source),canonical);
assert.equal(facts.itsmFact({territory:'шахта Ангидрит'}).mine,'Ангидрит');
assert.equal(facts.driverFact({mine:'ш. Ангидрит'}).mine,'Ангидрит');
assert.equal(facts.mobileLaborFact({site:'шахта Известняков'}).site,'Известняков');

const failure = facts.itsmFact({
  number: 'INC-100',
  typeAfterReclassification: 'INC',
  sputnikVbrDecision: 'Считать отказом',
  openedBy: 'Интеграция с МБ',
  classificationQuality: 'INC без изм',
  slaOverdue: 'Нет',
  problemLink: 'PRB001047',
  division: 'ЗФ',
  territory: 'Октябрьский',
  sdgrService: 'Стационарное оборудование',
  reclassifiedEquipment: 'Коммутатор',
  preBacklogHours: 4.5,
  slaHours: 2,
  result6LaborHours: 7.25
});
assert.equal(failure.failure, true);
assert.equal(failure.integratedFromMobileBrigade, true);
assert.equal(failure.classificationIncluded, true);
assert.equal(failure.classificationSuccess, true);
assert.equal(failure.classificationState, 'success');
assert.equal(failure.slaState, 'success');
assert.equal(failure.problemLinked, true);
assert.equal(failure.problemId, 'PRB001047');
assert.equal(failure.equipmentClass, 'stationary');
assert.equal(failure.linkedMobileBrigadeLaborHours, 7.25);

const excluded = facts.itsmFact({
  number: 'RITM-1',
  typeAfterReclassification: 'RITM',
  sputnikVbrDecision: 'Исключить',
  classificationQuality: 'RITM без изм',
  slaOverdue: '',
  problemLink: 'нет'
});
assert.equal(excluded.failure, false);
assert.equal(excluded.classificationIncluded, false);
assert.equal(excluded.classificationState, 'not-applicable');
assert.equal(excluded.slaState, 'unknown');
assert.equal(excluded.problemLinked, false);
assert.equal(excluded.problemId, null);

const countDriver = facts.driverFact({
  mine: 'Северный',
  name: 'БКМ',
  value: 12,
  unit: 'шт',
  valueState: 'value'
});
assert.equal(countDriver.equipmentCountCandidate, 12);
assert.equal(countDriver.equipmentCountCandidateState, 'candidate-only');
assert.equal(countDriver.officialEquipmentPopulation, false);

const driverStock = facts.driverPopulationSnapshot({
  meta:{freshness:'2026-10-08'},
  records:[
    {mine:'Октябрьский',name:'БКМ',service:'Стационарное оборудование',system:'A',value:290,unit:'шт',valueState:'value'},
    {mine:'Октябрьский',name:'БКМ',service:'Стационарное оборудование',system:'B',value:4,unit:'шт',valueState:'value'},
    {mine:'Октябрьский',name:'БКМ',service:'Навесное оборудование',system:'A',value:7,unit:'шт',valueState:'value'},
    {mine:'Таймырский',name:'БКМ',service:'Стационарное оборудование',system:'A',value:20,unit:'шт',valueState:'value'},
    {mine:'Все рудники',name:'БКМ',service:'Стационарное оборудование',system:'A',value:314,unit:'шт',valueState:'value'},
    {mine:'Октябрьский',name:'Кабель',service:'Стационарное оборудование',system:'A',value:12,unit:'км',valueState:'value'},
    {mine:'Октябрьский',name:'БКМ',service:'Стационарное оборудование',system:'A',value:1.5,unit:'шт',valueState:'value'},
    {mine:'Октябрьский',name:'БКМ',service:'Стационарное оборудование',system:'A',value:'-',unit:null,valueState:'dash'},
    {mine:'Октябрьский',name:'БКМ',service:null,system:'A',value:100,unit:'шт',valueState:'value'},
  ]
});
assert.equal(driverStock.sourceDataset,'drivers');
assert.equal(driverStock.snapshotKind,'fixed-reference');
assert.equal(driverStock.records.length,3);
assert.equal(driverStock.records.find(r=>r.organizationalUnit==='Октябрьский' &&
  r.equipmentName==='БКМ' && r.equipmentClass==='stationary').equipmentCount,294);
assert.equal(driverStock.records.find(r=>r.organizationalUnit==='Октябрьский' &&
  r.equipmentClass==='mounted').equipmentCount,7);
assert.equal(driverStock.records.find(r=>r.organizationalUnit==='Таймырский').equipmentCount,20);
assert.equal(driverStock.summaryRowsSkipped,1);
assert.equal(driverStock.unusableQuantityRows,3);
assert.equal(driverStock.unidentifiedRows,1);
assert.equal(driverStock.usableRows,4);
assert.equal(driverStock.supportsHistoricalPeriods,false);

const lengthDriver = facts.driverFact({
  mine: 'Северный',
  name: 'Кабель',
  value: 12,
  unit: 'км',
  valueState: 'value'
});
assert.equal(lengthDriver.quantityValue, 12);
assert.equal(lengthDriver.quantityUnit, 'км');
assert.equal(lengthDriver.equipmentCountCandidate, null);
assert.equal(lengthDriver.equipmentCountCandidateState, 'wrong-unit');
assert.equal(lengthDriver.officialEquipmentPopulation, false);

const fractionalCount = facts.driverFact({
  value: 2.5,
  unit: 'шт',
  valueState: 'value'
});
assert.equal(fractionalCount.equipmentCountCandidate, null);
assert.equal(fractionalCount.equipmentCountCandidateState, 'non-integer');

const equipmentSnapshot = facts.equipmentPopulationSnapshot({
  meta: { freshness: '2026-10-01' },
  records: [
    {
      id: 'A-1', source_catalog: 'Mounted', unit: 'Северный', equipment_type: 'Навесное',
      name: 'БКМ', 'Статус эксплуатации': 'Активен'
    },
    {
      id: 'A-2', source_catalog: 'Mounted', unit: 'Северный', equipment_type: 'Навесное',
      name: 'БКМ', 'Статус эксплуатации': 'Активен'
    },
    {
      id: 'S-1', source_catalog: 'Stationary', unit: 'Северный', equipment_type: 'Стационарное',
      name: 'Коммутатор', 'Статус эксплуатации': 'Не активен'
    },
    {
      id: 'A-2', source_catalog: 'Mounted', unit: 'Северный', equipment_type: 'Навесное',
      name: 'БКМ', 'Статус эксплуатации': 'Активен'
    },
    {
      id: '', source_catalog: 'Mounted', unit: 'Северный', equipment_type: 'Навесное',
      name: 'Камера', 'Статус эксплуатации': 'Активен'
    }
  ]
});
assert.equal(equipmentSnapshot.snapshotKind, 'current-snapshot');
assert.equal(equipmentSnapshot.snapshotDate, '2026-10-01');
assert.equal(equipmentSnapshot.supportsHistoricalPeriods, false);
assert.equal(equipmentSnapshot.activeEquipmentCount, 2);
assert.equal(equipmentSnapshot.inactiveEquipmentCount, 1);
assert.equal(equipmentSnapshot.duplicateIdCount, 1);
assert.equal(equipmentSnapshot.missingIdCount, 1);
assert.equal(equipmentSnapshot.records.length, 1);
assert.equal(equipmentSnapshot.records[0].equipmentCount, 2);
assert.equal(equipmentSnapshot.records[0].equipmentName, 'БКМ');
assert.equal(equipmentSnapshot.records[0].equipmentClass, 'mounted');
assert.equal(facts.equipmentClass('Навесное оборудование'), 'mounted');
assert.equal(facts.equipmentClass('Stationary'), 'stationary');
assert.equal(facts.mineName('Рудник Северный'), 'Северный');
assert.equal(facts.mineName('р. Кайерканский, ш. Ангидрит'), 'Ангидрит');
assert.equal(facts.mineName('р. Кайерканский, ш. Известняков'), 'Известняков');
assert.equal(facts.mineName('ш. Ангидрит'), 'Ангидрит');
assert.equal(facts.mineName('р. Кайерканский, ш. Неизвестная'), 'Кайерканский, ш. Неизвестная',
 'Unreviewed compound territories must not be silently remapped.');

const linked = facts.linkMobileBrigadeToProblems([
  {
    recordKey: 'north|1',
    request: 'INC-100',
    finalTaskType: 'АВР',
    laborHours: 2,
    laborState: 'valid'
  },
  {
    recordKey: 'north|2',
    request: 'INC-100',
    finalTaskType: 'Корректирующее воздействие',
    laborHours: 0,
    laborState: 'valid_zero'
  },
  {
    recordKey: 'north|3',
    request: 'INC-404',
    finalTaskType: 'Прочее',
    laborHours: null,
    laborState: 'missing'
  }
], [
  {
    number: 'INC-100',
    typeAfterReclassification: 'INC',
    sputnikVbrDecision: 'Считать отказом',
    problemLink: 'PRB001047'
  }
]);
assert.equal(linked.stats.rows, 3);
assert.equal(linked.stats.requestMatched, 2);
assert.equal(linked.stats.requestUnmatched, 1);
assert.equal(linked.stats.problemLinkedRows, 2);
assert.equal(linked.stats.usableLaborRows, 2);
assert.equal(linked.stats.unusableLaborRows, 1);
assert.equal(linked.records[0].problemId, 'PRB001047');
assert.equal(linked.records[0].laborHours, 2);
assert.equal(linked.records[1].laborHours, 0);
assert.equal(linked.records[2].problemLinkState, 'request-not-found');

const ambiguous = facts.linkMobileBrigadeToProblems([
  { recordKey: 'x|1', request: 'INC-X', laborHours: 1, laborState: 'valid' }
], [
  { number: 'INC-X', problemLink: 'PRB1' },
  { number: 'INC-X', problemLink: 'PRB2' }
]);
assert.equal(ambiguous.stats.ambiguousRequestCount, 1);
assert.equal(ambiguous.records[0].problemId, null);
assert.equal(ambiguous.records[0].problemLinkState, 'ambiguous');

assert.deepEqual(
  facts.rowsToObjects(['a', 'b'], [[1, 2], [3, null]]),
  [{ a: 1, b: 2 }, { a: 3, b: null }]
);

// PR-1: event maxima / upload freshness are observations, NOT certified cut-offs.
const unconfirmed = facts.sourceReportingCoverage('itsm_data', {
  records: [], meta:{latestSourceDate:'2026-09-15',freshness:'2026-10-05'}
});
assert.equal(unconfirmed.status,'unknown');
assert.equal(unconfirmed.coverageThrough,null);
assert.equal(unconfirmed.observedLatestDate,'2026-09-15');
assert.equal(facts.reportingMonthStatus('2026-09',unconfirmed).status,'unknown');

const completeDeclaration = (coverageFrom,coverageThrough)=>({
  records: [],meta:{reportingCoverage:{
    confirmed:true,basis:'source-export-cutoff',coverageFrom,coverageThrough
  }}
});
const september = facts.sourceReportingCoverage('itsm_data',
  completeDeclaration('2025-01-01','2026-09-15'));
assert.equal(september.status,'confirmed');
assert.equal(september.coverageFrom,'2025-01-01');
assert.equal(facts.reportingMonthStatus('2026-09',september).status,'incomplete');
assert.equal(facts.reportingMonthStatus('2026-08',september).status,'complete');
assert.equal(facts.reportingMonthStatus('2026-10',september).status,'unknown');
assert.equal(facts.reportingMonthStatus('2026-10',september).reason,
  'report-month-after-cutoff');
const septemberComplete = facts.sourceReportingCoverage('itsm_data',
  completeDeclaration('2026-01-01','2026-09-30'));
assert.equal(facts.reportingMonthStatus('2026-09',septemberComplete).status,'complete');

const missingStart = facts.sourceReportingCoverage('itsm_data',
  completeDeclaration('2026-09-05','2026-09-15'));
assert.equal(facts.reportingMonthStatus('2026-09',missingStart).status,'unknown');
assert.equal(facts.reportingMonthStatus('2026-09',missingStart).reason,
  'report-month-start-uncovered');
assert.equal(facts.sourceReportingCoverage('itsm_data',
  completeDeclaration('2026-09-01','2026-09-31')).status,'unknown');
assert.equal(facts.sourceReportingCoverage('itsm_data',
  completeDeclaration('2026-09-16','2026-09-15')).status,'unknown');
assert.equal(facts.sourceReportingCoverage('itsm_data', {
  records:[],meta:{reportingCoverage:{
    confirmed:false,basis:'source-export-cutoff',
    coverageFrom:'2026-09-01',coverageThrough:'2026-09-15'
  }}
}).status,'unknown');
assert.equal(facts.sourceReportingCoverage('mobile_brigade_data',null).status,'unavailable');
assert.equal(facts.reportingDay('2024-02-29'),'2024-02-29');
assert.equal(facts.reportingDay('2025-02-29'),null);
assert(Object.isFrozen(september));

console.log('KPI source facts: ITSM + Drivers + Equipment snapshot + MB/PRB linkage OK');
