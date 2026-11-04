const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const sourceFacts = fs.readFileSync('src/js/kpi/source_facts.js', 'utf8');
const source = fs.readFileSync('src/js/modules/itsm/kpi_source.js', 'utf8');
const context = vm.createContext({
  console,
  Date,
  Map,
  Set,
  Object,
  Array,
  String,
  Number,
  JSON,
  Error,
  globalThis: null
});
context.globalThis = context;
vm.runInContext(sourceFacts, context, { filename: 'source_facts.js' });
vm.runInContext(source, context, { filename: 'kpi_source.js' });

const api = context.ReclassifierKpiSource;
assert.ok(api, 'KPI Source API was not exported.');
assert.equal(api.id, 'kpi_source');
assert.equal(api.schemaVersion, '1.0.0');
assert.equal(api.fields.length, 22);
assert.deepEqual(Array.from(api.labels), [
  'RowType', 'Year', 'Month', 'Period', 'Branch', 'Mine', 'EquipmentType',
  'EquipmentName', 'EquipmentCount', 'FailureCount', 'IntegratedFailureCount',
  'IncCount', 'RitmCount', 'IncidentDurationHours', 'RequestDurationHours',
  'FailureDowntimeHours', 'FailureWorkHours', 'SlaSuccessCount', 'SlaTotalCount',
  'ClassificationSuccessCount', 'ClassificationTotalCount', 'PersonnelCount'
]);

const aggregator = api.createAggregator();

// One failure deliberately crosses three months:
// creation -> June, completion -> July, close -> August.
aggregator.consume({
  createdAt: '2026-06-30T22:00:00',
  completedAt: '2026-07-01T02:30:00',
  closedAt: '2026-08-02T09:00:00',
  state: 'Закрыт',
  slaOverdue: 'Нет',
  territory: 'Октябрьский',
  sourceEquipment: 'Бортовой комплект АСУГР Pitram',
  openedBy: 'Интеграция с МБ',
  classificationQuality: 'INC без изм',
  typeAfterReclassification: 'INC',
  sputnikVbrDecision: 'Считать отказом',
  sdgrService: 'Навесное оборудование',
  division: 'ЗФ',
  slaHours: 2,
  preBacklogHours: 4.5
});

// RITM contributes to requests and classification denominator, but not failures.
aggregator.consume({
  createdAt: '2026-07-05',
  completedAt: '2026-07-06',
  closedAt: '2026-07-07',
  state: 'Закрыт',
  slaOverdue: 'Да',
  territory: 'Октябрьский',
  sourceEquipment: 'Бортовой комплект АСУГР Pitram',
  openedBy: 'Пользователь',
  classificationQuality: 'RITM вместо INC',
  typeAfterReclassification: 'RITM',
  sputnikVbrDecision: 'Исключить',
  sdgrService: 'Навесное оборудование',
  division: 'ЗФ',
  slaHours: 1,
  preBacklogHours: 3
});

// Non-failure INC remains an INC but must not enter failure numerators.
aggregator.consume({
  createdAt: '2026-07-10',
  completedAt: '2026-07-11',
  closedAt: '2026-07-12',
  state: 'Закрыт',
  slaOverdue: 'Нет',
  territory: 'Октябрьский',
  sourceEquipment: 'Бортовой комплект АСУГР Pitram',
  openedBy: 'Пользователь',
  classificationQuality: 'INC с исправлением',
  typeAfterReclassification: 'INC',
  sputnikVbrDecision: 'Исключить',
  sdgrService: 'Навесное оборудование',
  division: 'ЗФ',
  slaHours: 0.5,
  preBacklogHours: 1.5
});

// Equipment base can create a zero-event monthly row and must not be multiplied by requests.
aggregator.seedEquipmentCount({
  period: '2026-07-01',
  division: 'ЗФ',
  territory: 'Октябрьский',
  sdgrService: 'Навесное оборудование',
  sourceEquipment: 'Бортовой комплект АСУГР Pitram',
  equipmentCount: 100
});
aggregator.seedEquipmentCount({
  period: '2026-09-01',
  division: 'ЗФ',
  territory: 'Октябрьский',
  sdgrService: 'Навесное оборудование',
  sourceEquipment: 'Бортовой комплект АСУГР Pitram',
  equipmentCount: 100
});

// Personnel is intentionally stored on a separate REFERENCE row to avoid duplication.
aggregator.seedPersonnelCount({
  period: '2026-07-01',
  branch: 'ЗФ',
  mine: 'Октябрьский',
  personnelCount: 42
});

const result = aggregator.finalize();
assert.equal(result.id, 'kpi_source');
assert.equal(result.schemaVersion, '1.0.0');
assert.equal(result.records.length, 5);

function row(period, rowType = 'ITSM') {
  return result.records.find(item => item.period === period && item.rowType === rowType);
}

const june = row('2026-06-01');
assert.ok(june, 'Creation-period KPI row is missing.');
assert.equal(june.failureDowntimeHours, 4.5);
assert.equal(june.failureCount, 0, 'FailureCount must follow completion period.');

const july = row('2026-07-01');
assert.ok(july, 'Completion-period KPI row is missing.');
assert.equal(july.equipmentCount, 100);
assert.equal(july.failureCount, 1);
assert.equal(july.integratedFailureCount, 1);
assert.equal(july.incCount, 2);
assert.equal(july.ritmCount, 1);
assert.equal(july.incidentDurationHours, 6);
assert.equal(july.requestDurationHours, 9);
assert.equal(july.failureWorkHours, 2);
assert.equal(july.failureDowntimeHours, 0);
assert.equal(july.slaTotalCount, 2);
assert.equal(july.slaSuccessCount, 1);
assert.equal(july.classificationTotalCount, 3);
assert.equal(july.classificationSuccessCount, 1);

const august = row('2026-08-01');
assert.ok(august, 'Close-period KPI row is missing.');
assert.equal(august.slaTotalCount, 1);
assert.equal(august.slaSuccessCount, 1);
assert.equal(august.classificationTotalCount, 0);
assert.equal(august.classificationSuccessCount, 0);

const september = row('2026-09-01');
assert.ok(september, 'Seeded zero-event equipment row is missing.');
assert.equal(september.equipmentCount, 100);
assert.equal(september.failureCount, 0);
assert.equal(september.incCount, 0);

const personnel = row('2026-07-01', 'REFERENCE');
assert.ok(personnel, 'Personnel reference row is missing.');
assert.equal(personnel.personnelCount, 42);
assert.equal(personnel.equipmentName, '');
assert.equal(personnel.failureCount, 0);

assert.throws(() => aggregator.seedEquipmentCount({
  period: '2026-07-01',
  division: 'ЗФ',
  territory: 'Октябрьский',
  sdgrService: 'Навесное оборудование',
  sourceEquipment: 'Бортовой комплект АСУГР Pitram',
  equipmentCount: 101
}), /конфликт значений EquipmentCount/);

assert.deepEqual(
  JSON.parse(JSON.stringify(api.monthPeriod('15.10.2026'))),
  { year: 2026, month: 10, period: '2026-10-01' }
);

const storedAggregate = api.aggregateItsmDataset(
  [
    'createdAt', 'completedAt', 'closedAt', 'territory', 'sourceEquipment',
    'reclassifiedEquipment', 'openedBy', 'classificationQuality',
    'typeAfterReclassification', 'sputnikVbrDecision', 'sdgrService',
    'division', 'slaHours', 'preBacklogHours', 'driversByMine'
  ],
  [[
    '2026-10-01', '2026-10-02', '2026-10-03', 'Северный', 'БКМ',
    'БКМ', 'Интеграция с МБ', 'INC без изм',
    'INC', 'Считать отказом', 'Навесное оборудование',
    'КФ', 2, 5, 10
  ]]
);
const storedPayload = api.datasetPayload(storedAggregate, 1);
assert.equal(storedPayload.records.length, 1);
assert.equal(storedPayload.sourceRows, 1);
assert.equal(storedPayload.earliestPeriod, '2026-10-01');
assert.equal(storedPayload.latestPeriod, '2026-10-01');
assert.equal(storedPayload.records[0][storedPayload.fields.indexOf('failureCount')], 1);
assert.equal(storedPayload.records[0][storedPayload.fields.indexOf('equipmentCount')], null,
  'Drivers quantity must never become the official EquipmentCount denominator.');
assert.equal(storedPayload.records[0][storedPayload.fields.indexOf('slaTotalCount')], 0,
  'Stored 51-field ITSM without SLA-overdue source must not invent SLA.');

const cumulativeFields = [
  'number', 'createdAt', 'completedAt', 'closedAt', 'territory', 'sourceEquipment',
  'reclassifiedEquipment', 'openedBy', 'classificationQuality',
  'typeAfterReclassification', 'sputnikVbrDecision', 'sdgrService',
  'division', 'slaHours', 'preBacklogHours', 'driversByMine'
];
const cumulativeRows = [
  [
    'INC-OLD', '2026-10-01', '2026-10-02', '2026-10-03', 'Северный', 'БКМ',
    'БКМ', 'Пользователь', 'INC без изм', 'INC', 'Считать отказом',
    'Навесное оборудование', 'КФ', 1, 2, 10
  ],
  [
    'INC-NEW', '2026-11-01', '2026-11-02', '2026-11-03', 'Северный', 'БКМ',
    'БКМ', 'Пользователь', 'INC без изм', 'INC', 'Считать отказом',
    'Навесное оборудование', 'КФ', 1, 3, 10
  ]
];
const cumulativeFullDataset = {
  columns: ['Номер', 'Просрочен по разрешению'],
  rows: [
    ['INC-NEW', 'Да'],
    ['INC-OLD', 'Нет']
  ],
  recordKeys: ['inc-new', 'inc-old']
};
const cumulativeAggregate = api.aggregateItsmDataset(
  cumulativeFields,
  cumulativeRows,
  cumulativeFullDataset
);
const cumulativePayload = api.datasetPayload(cumulativeAggregate, cumulativeRows.length);
const periodIndex = cumulativePayload.fields.indexOf('period');
const slaSuccessIndex = cumulativePayload.fields.indexOf('slaSuccessCount');
const slaTotalIndex = cumulativePayload.fields.indexOf('slaTotalCount');
const october = cumulativePayload.records.find(row => row[periodIndex] === '2026-10-01');
const november = cumulativePayload.records.find(row => row[periodIndex] === '2026-11-01');
assert.ok(october && november, 'Cumulative KPI must preserve old and new periods.');
assert.equal(october[slaTotalIndex], 1);
assert.equal(october[slaSuccessIndex], 1,
  'SLA must be restored from Full Dataset by request key, not row position.');
assert.equal(november[slaTotalIndex], 1);
assert.equal(november[slaSuccessIndex], 0);

console.log('KPI Source core: schema + multi-period O(n) aggregation + cumulative Full Dataset SLA OK');
