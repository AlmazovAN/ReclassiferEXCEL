const assert = require('node:assert/strict');

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

const api = globalThis.ReclassifierKpiPreparation;
assert.ok(api, 'KPI Preparation API was not exported.');
assert.equal(api.version, '1.0.0');

const itsmFields = [
  'number', 'createdAt', 'completedAt', 'closedAt', 'territory',
  'sourceEquipment', 'reclassifiedEquipment', 'openedBy',
  'classificationQuality', 'typeAfterReclassification',
  'sputnikVbrDecision', 'sdgrService', 'division',
  'slaHours', 'preBacklogHours', 'problemLink', 'result6LaborHours'
];

const itsmRecords = [
  [
    'INC-1', '2026-06-30T22:00:00', '2026-07-01T02:30:00', '2026-08-02T09:00:00',
    'Октябрьский', 'БКМ', 'БКМ', 'Интеграция с МБ',
    'INC без изм', 'INC', 'Считать отказом', 'Навесное оборудование', 'ЗФ',
    2, 4.5, 'PRB001047', 2
  ],
  [
    'RITM-1', '2026-07-05', '2026-07-06', '2026-07-07',
    'Октябрьский', 'БКМ', 'БКМ', 'Пользователь',
    'RITM вместо INC', 'RITM', 'Исключить', 'Навесное оборудование', 'ЗФ',
    1, 3, 'нет', 3
  ],
  [
    'INC-2', '2026-07-10', '2026-07-11', '2026-07-12',
    'Октябрьский', 'БКМ', 'БКМ', 'Пользователь',
    'INC с исправлением', 'INC', 'Исключить', 'Навесное оборудование', 'ЗФ',
    0.5, 1.5, 'нет', 1
  ]
];

const fullDataset = {
  columns: ['Номер', 'Просрочен по разрешению'],
  rows: [
    ['RITM-1', 'Да'],
    ['INC-1', 'Нет'],
    ['INC-2', '']
  ],
  recordKeys: ['ritm-1', 'inc-1', 'inc-2']
};

const mobileRecords = [
  {
    recordKey: 'oct|1', request: 'INC-1', factDate: '2026-07-01',
    site: 'Октябрьский', finalTaskType: 'АВР',
    laborHours: 2, laborState: 'valid',
    equipmentPlacement: 'Навесное', equipmentType: 'БКМ',
    transport: 'ПДМ-17', equipmentUnit: 'UNIT-X'
  },
  {
    recordKey: 'oct|2', request: 'INC-1', factDate: '2026-07-01',
    site: 'Октябрьский', finalTaskType: 'АВР',
    laborHours: null, laborState: 'missing',
    equipmentPlacement: 'Навесное', equipmentType: 'БКМ',
    transport: 'ПДМ-17', equipmentUnit: 'UNIT-X'
  },
  {
    recordKey: 'oct|3', request: 'RITM-1', factDate: '2026-07-06',
    site: 'Октябрьский', finalTaskType: 'ТО',
    laborHours: 3, laborState: 'valid',
    equipmentPlacement: 'Стационарное', equipmentType: 'БКМ',
    equipmentUnit: 'БКМ-1', transport: 'IGNORED'
  },
  {
    recordKey: 'oct|4', request: 'INC-404', factDate: '2026-07-08',
    site: 'Октябрьский', finalTaskType: 'Прочее',
    laborHours: 1, laborState: 'valid',
    equipmentPlacement: 'Стационарное', equipmentType: 'БКМ',
    equipmentUnit: 'БКМ-2'
  },
  {
    recordKey: 'oct|5', request: 'INC-1', factDate: null,
    site: 'Октябрьский', finalTaskType: 'АВР',
    laborHours: 4, laborState: 'valid',
    equipmentPlacement: 'Навесное', equipmentType: 'БКМ',
    transport: 'ПДМ-18'
  }
];

const equipment = {
  meta: { freshness: '2026-10-01' },
  records: [
    {
      id: 'M-1', source_catalog: 'Mounted', unit: 'Октябрьский',
      equipment_type: 'Навесное оборудование', name: 'БКМ',
      'Статус эксплуатации': 'Активен'
    },
    {
      id: 'M-2', source_catalog: 'Mounted', unit: 'Октябрьский',
      equipment_type: 'Навесное оборудование', name: 'БКМ',
      'Статус эксплуатации': 'Активен'
    },
    {
      id: 'M-3', source_catalog: 'Mounted', unit: 'Октябрьский',
      equipment_type: 'Навесное оборудование', name: 'БКМ',
      'Статус эксплуатации': 'Не активен'
    },
    {
      id: 'M-2', source_catalog: 'Mounted', unit: 'Октябрьский',
      equipment_type: 'Навесное оборудование', name: 'БКМ',
      'Статус эксплуатации': 'Активен'
    }
  ]
};

const drivers = {
  meta:{freshness:'2026-10-01'},
  records:[
    {mine:'Октябрьский',name:'БКМ',service:'Навесное оборудование',system:'СДГР',value:2,unit:'шт',valueState:'value'},
    {mine:'Все рудники',name:'БКМ',service:'Навесное оборудование',system:'СДГР',value:2,unit:'шт',valueState:'value'}
  ]
};

const bundle = api.prepare({
  itsm: { fields: itsmFields, records: itsmRecords, fullDataset },
  mobileBrigade: { records: mobileRecords },
  equipment,
  drivers
});

assert.equal(bundle.architecture, 'subject-component-tables');
assert.equal(bundle.itsmFactCount, 3);
assert.equal(bundle.mobileBrigadeRowCount, 5);
assert.ok(!Object.prototype.hasOwnProperty.call(bundle, 'rows'),
  'Preparation must not create a shared mega-table.');

const failureEvents = bundle.families.failures.events;
assert.deepEqual(Array.from(failureEvents.grain), [
  'period', 'branch', 'mine', 'equipmentClass', 'equipmentType', 'equipmentName'
]);
assert.equal(failureEvents.rows.length, 1);
assert.equal(failureEvents.rows[0].period, '2026-07-01');
assert.equal(failureEvents.rows[0].incCount, 2);
assert.equal(failureEvents.rows[0].ritmCount, 1);
assert.equal(failureEvents.rows[0].failureCount, 1);
assert.equal(failureEvents.rows[0].integratedFailureCount, 1);
assert.equal(failureEvents.rows[0].incidentDurationHours, 6);
assert.equal(failureEvents.rows[0].requestDurationHours, 9);
assert.equal(failureEvents.rows[0].failureWorkHours, 2);

const failureDowntime = bundle.families.failures.downtime;
assert.equal(failureDowntime.rows.length, 1);
assert.equal(failureDowntime.rows[0].period, '2026-06-01');
assert.equal(failureDowntime.rows[0].failureDowntimeHours, 4.5);
assert.equal(failureDowntime.meta.periodBasis, 'createdAt');

const sla = bundle.families.sla;
assert.equal(sla.rows.length, 2);
const julySla = sla.rows.find(row => row.period === '2026-07-01');
const augustSla = sla.rows.find(row => row.period === '2026-08-01');
assert.equal(julySla.slaTotalCount, 1);
assert.equal(julySla.slaSuccessCount, 0);
assert.equal(julySla.slaOverdueCount, 1);
assert.equal(augustSla.slaTotalCount, 1);
assert.equal(augustSla.slaSuccessCount, 1);
assert.equal(sla.meta.unknownSlaRows, 1);

const classification = bundle.families.classification;
assert.equal(classification.rows.length, 1);
const julyClassification = classification.rows.find(row => row.period === '2026-07-01');
assert.equal(julyClassification.classificationTotalCount, 3);
assert.equal(julyClassification.classificationSuccessCount, 1);
assert.equal(julyClassification.classificationFailureCount, 2);
assert.equal(julyClassification.classificationIncUnchangedCount, 1);
assert.equal(julyClassification.classificationIncCorrectedCount, 1);
assert.equal(julyClassification.classificationIncUnclassifiedCount, 0);
assert.equal(julyClassification.classificationRitmInsteadOfIncCount, 1);
assert.equal(classification.meta.periodBasis, 'completedAt-or-closedAt');
assert.equal(classification.meta.countedUsingCompletionDate, 3);
assert.equal(classification.meta.countedUsingCloseDate, 0);
assert.equal(classification.meta.includedRowsWithoutEventDate, 0);

const labor = bundle.families.labor;
assert.equal(labor.meta.rowsWithoutFactDate, 1);
const avrLabor = labor.rows.find(row =>
  row.period === '2026-07-01' && row.finalTaskType === 'АВР'
);
assert.ok(avrLabor);
assert.equal(avrLabor.taskCount, 2);
assert.equal(avrLabor.usableLaborTaskCount, 1);
assert.equal(avrLabor.unusableLaborTaskCount, 1);
assert.equal(avrLabor.laborHours, 2);
assert.equal(avrLabor.equipmentName, 'ПДМ-17',
  'Mounted equipment must use transport identity for MB labor.');

const toLabor = labor.rows.find(row => row.finalTaskType === 'ТО');
assert.equal(toLabor.laborHours, 3);
assert.equal(toLabor.equipmentName, 'БКМ-1',
  'Stationary equipment must use equipmentUnit identity for MB labor.');

const prb = bundle.families.prb;
assert.equal(prb.meta.rowsWithoutFactDate, 1);
assert.equal(prb.meta.linkage.rows, 5);
assert.equal(prb.meta.linkage.problemLinkedRows, 3);
assert.equal(prb.meta.linkage.requestUnmatched, 1);
const linkedPrb = prb.rows.find(row =>
  row.problemId === 'PRB001047' && row.finalTaskType === 'АВР'
);
assert.ok(linkedPrb);
assert.equal(linkedPrb.taskCount, 2);
assert.equal(linkedPrb.linkedTaskCount, 2);
assert.equal(linkedPrb.usableLaborTaskCount, 1);
assert.equal(linkedPrb.unusableLaborTaskCount, 1);
assert.equal(linkedPrb.laborHours, 2);
assert.equal(linkedPrb.linkedLaborHours, 2,
  'One MB task must contribute labor once even though ITSM is enrichment source.');

const unlinkedPrb = prb.rows.find(row => row.problemLinkState === 'not-linked');
assert.ok(unlinkedPrb);
assert.equal(unlinkedPrb.linkedLaborHours, 0);

const missingRequest = prb.rows.find(row => row.problemLinkState === 'request-not-found');
assert.ok(missingRequest);
assert.equal(missingRequest.laborHours, 1);
assert.equal(missingRequest.linkedLaborHours, 0);

const equipmentTable = bundle.families.equipment;
assert.deepEqual(Array.from(equipmentTable.grain), [
  'organizationalUnit', 'equipmentClass', 'equipmentType', 'equipmentName', 'sourceCatalog'
]);
assert.equal(equipmentTable.rows.length, 1);
assert.equal(equipmentTable.rows[0].sourceCatalog, 'Drivers');
assert.equal(equipmentTable.rows[0].equipmentCount, 2);
assert.equal(equipmentTable.meta.supportsHistoricalPeriods, false);
assert.equal(equipmentTable.meta.sourceDataset, 'drivers');
assert.equal(equipmentTable.meta.summaryRowsSkipped, 1);
assert.equal(equipmentTable.meta.usableRows, 1);

assert.notDeepEqual(Array.from(labor.grain), Array.from(equipmentTable.grain),
  'Subject families must keep independent grains.');


 // KPI-01: only post-reclassification INC with a positive Sputnik VBR decision is a failure.
 // Date priority: completedAt -> closedAt -> exclusion, without changing unrelated INC/RITM counts.
 function vbrRecord(number, {completedAt=null,closedAt=null,mine='Октябрьский',name='БКМ',type='INC',decision='Считать отказом'}={}) {
   const values=itsmRecords[0].slice();
   const set=(field,value)=>{values[itsmFields.indexOf(field)]=value;};
   set('number',number);
   set('completedAt',completedAt);
   set('closedAt',closedAt);
   set('territory',mine);
   set('reclassifiedEquipment',name);
   set('typeAfterReclassification',type);
   set('sputnikVbrDecision',decision);
   return values;
 }
 const vbrDateBundle=api.prepare({
   itsm:{fields:itsmFields,records:[
     vbrRecord('INC-FALLBACK-A',{closedAt:'2026-10-03'}),
     vbrRecord('INC-FALLBACK-B',{closedAt:'2026-10-04'}),
     vbrRecord('INC-PRIORITY',{completedAt:'2026-09-29',closedAt:'2026-10-05'}),
     vbrRecord('INC-EXCLUDED',{closedAt:'2026-10-06',decision:'Исключить'}),
     vbrRecord('RITM-NONFAILURE',{closedAt:'2026-10-07',type:'RITM'}),
     vbrRecord('INC-NODATE'),
     vbrRecord('INC-OTHER-MINE',{closedAt:'2026-10-09',mine:'Таймырский'}),
     vbrRecord('INC-OTHER-EQUIPMENT',{completedAt:'invalid-date',closedAt:'2026-10-10',name:'VIK MZ'}),
   ]},
   mobileBrigade:{records:[]},
   drivers
 });
 const vbrEvents=vbrDateBundle.families.failures.events;
 const vbrTotalFor=(period,mine,name)=>vbrEvents.rows
   .filter(row=>row.period===period && row.mine===mine && row.equipmentName===name)
   .reduce((count,row)=>count+row.failureCount,0);
 assert.equal(vbrTotalFor('2026-10-01','Октябрьский','БКМ'),2,
   'Two events on the same equipment group must both be counted using close-date fallback.');
 assert.equal(vbrTotalFor('2026-09-01','Октябрьский','БКМ'),1,
   'Completion date must win over later closure date.');
 assert.equal(vbrTotalFor('2026-10-01','Таймырский','БКМ'),1);
 assert.equal(vbrTotalFor('2026-10-01','Октябрьский','VIK MZ'),1,
   'Invalid completion date must fall back to valid closure date.');
 assert.equal(vbrEvents.rows.reduce((count,row)=>count+row.failureCount,0),5);
 assert.equal(vbrEvents.rows.reduce((count,row)=>count+row.incCount,0),1,
   'Completion-only request counters must not be re-bucketed by fallback.');
 assert.equal(vbrEvents.meta.inputItsmFactRows,8);
 assert.equal(vbrEvents.meta.reclassifiedIncRows,7);
 assert.equal(vbrEvents.meta.excludedByVbrDecisionRows,1);
 assert.equal(vbrEvents.meta.failureRowsUsingCompletionDate,1);
 assert.equal(vbrEvents.meta.failureRowsUsingCloseDate,4);
 assert.equal(vbrEvents.meta.failureRowsWithoutEventDate,1);
 assert.equal(vbrEvents.meta.failurePeriodBasis,'completedAt-or-closedAt');

console.log('KPI Preparation: independent failure/equipment/labor/SLA/classification/PRB component tables OK');
