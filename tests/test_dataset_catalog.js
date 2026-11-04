const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const read = path => fs.readFileSync(path, 'utf8');
const context = vm.createContext({
  console,
  Date,
  Map,
  Set,
  Object,
  Array,
  String,
  Number,
  Error,
  state: {},
  window: {},
  referenceConfig: {},
  equipmentConfig: {},
  globalThis: null
});
context.globalThis = context;

vm.runInContext(read('src/js/app/dataset_catalog.js'), context, { filename: 'dataset_catalog.js' });
vm.runInContext(read('src/js/app/field_registry.js'), context, { filename: 'field_registry.js' });
vm.runInContext(read('src/js/modules/itsm/dataset_schema.js'), context, { filename: 'itsm_dataset_schema.js' });
vm.runInContext(read('src/js/app/database_contract.js'), context, { filename: 'database_contract.js' });
vm.runInContext(read('src/js/app/dataset_pipeline.js'), context, { filename: 'dataset_pipeline.js' });

const catalog = context.ReclassifierDatasetCatalog;
const contract = context.ReclassifierDatabaseContract;
const pipeline = vm.runInContext('datasetPipeline', context);
const fieldRegistry = context.ReclassifierFieldRegistry;

assert.ok(catalog, 'Dataset Catalog API was not exported.');
assert.ok(contract, 'Database Contract API was not exported.');
assert.ok(fieldRegistry, 'Field Registry API was not exported.');

const expectedIds = [
  'reclassification', 'drivers', 'customers', 'type_request', 'initiators',
  'exceptions', 'problem_grade', 'mobile_brigade_data', 'itsm_data', 'kpi_source',
  'mounted', 'stationary', 'transport', 'transport_start_points', 'zabbix',
  'combined', 'failure_classifier'
];
assert.deepEqual(Array.from(catalog.list(), item => item.id), expectedIds);

for (const definition of catalog.list()) {
  assert.ok(Object.isFrozen(definition), 'Catalog definition must be frozen: ' + definition.id);
  assert.ok(definition.kind, 'Dataset kind missing: ' + definition.id);
  assert.ok(definition.schemaVersion, 'Dataset schemaVersion missing: ' + definition.id);
  assert.ok(definition.strategy, 'Dataset strategy missing: ' + definition.id);
  if (definition.strategy === catalog.strategy.UPSERT) {
    assert.ok(definition.keyField, 'UPSERT Dataset must define keyField: ' + definition.id);
  }
  if (definition.strategy === catalog.strategy.DERIVED) {
    assert.equal(definition.persisted, false, 'DERIVED Dataset must not be persisted: ' + definition.id);
  }

  const sqlite = contract.datasets[definition.id];
  assert.ok(sqlite, 'Database Contract missing Dataset: ' + definition.id);
  assert.equal(sqlite.kind, definition.kind, 'kind drift: ' + definition.id);
  assert.equal(sqlite.schemaVersion, definition.schemaVersion, 'schemaVersion drift: ' + definition.id);
  assert.equal(sqlite.allowEmpty, definition.allowEmpty, 'allowEmpty drift: ' + definition.id);
  assert.equal(sqlite.persisted, definition.persisted, 'persisted drift: ' + definition.id);
  assert.equal(sqlite.strategy, definition.strategy, 'strategy drift: ' + definition.id);
  assert.equal(sqlite.keyField, definition.keyField, 'keyField drift: ' + definition.id);
  assert.equal(sqlite.partitionField, definition.partitionField, 'partitionField drift: ' + definition.id);
  assert.deepEqual(Array.from(sqlite.dependencies || []), Array.from(definition.dependencies || []),
    'dependencies drift: ' + definition.id);
}

const runtime = pipeline.list().map(item => ({
  id: item.id,
  kind: item.kind,
  schemaVersion: item.schemaVersion,
  allowEmpty: item.allowEmpty
}));
const expectedRuntime = catalog.list().map(item => ({
  id: item.id,
  kind: item.kind,
  schemaVersion: item.schemaVersion,
  allowEmpty: item.allowEmpty
}));
assert.deepEqual(JSON.parse(JSON.stringify(runtime)), JSON.parse(JSON.stringify(expectedRuntime)));

assert.equal(catalog.get('itsm_data').keyField, 'number');
assert.deepEqual(Array.from(catalog.get('itsm_data').dependencies), [
  'reclassification', 'drivers', 'customers', 'type_request',
  'initiators', 'exceptions', 'problem_grade', 'mobile_brigade_data'
]);
assert.equal(catalog.get('mobile_brigade_data').keyField, 'recordKey');

const fromItsm = catalog.fieldDependents('itsm_data', 'createdAt');
assert.equal(fromItsm.length, 1);
assert.equal(fromItsm[0].datasetId, 'mobile_brigade_data');
assert.deepEqual(Array.from(fromItsm[0].sourceFields), ['number', 'createdAt']);
assert.deepEqual(Array.from(fromItsm[0].targetFields), ['itsmCreatedAt']);
assert.equal(catalog.fieldDependents('itsm_data', 'closedAt').length, 0);
const fromMb = catalog.fieldDependents('mobile_brigade_data', 'laborHours');
assert.equal(fromMb.length, 1);
assert.equal(fromMb[0].datasetId, 'itsm_data');
assert.deepEqual(Array.from(fromMb[0].targetFields),
  ['equipmentName', 'result6LaborHours', 'mbPresence']);
assert.equal(Object.isFrozen(catalog.get('mobile_brigade_data').fieldDependencies), true);
assert.equal(Object.isFrozen(fromItsm[0]), true);
// Field-level lineage is not a dataset-wide dependency: introducing
// a cycle here would make both saved datasets perpetually stale.
assert.deepEqual(Array.from(catalog.get('mobile_brigade_data').dependencies), []);
assert.equal(catalog.get('itsm_data').dependencies.includes('mobile_brigade_data'), true);

assert.equal(catalog.get('kpi_source').persisted, true);
assert.deepEqual(Array.from(catalog.get('kpi_source').dependencies), ['itsm_data']);
assert.equal(catalog.get('kpi_source').strategy, catalog.strategy.REPLACE);
assert.equal(catalog.get('kpi_source').allowEmpty, true);
assert.equal(catalog.get('stationary').partitionField, 'unit');
assert.equal(catalog.get('combined').persisted, false);
assert.deepEqual(Array.from(catalog.get('combined').dependencies), [
  'mounted', 'stationary', 'transport', 'transport_start_points', 'zabbix'
]);
assert.equal(catalog.get('exceptions').allowEmpty, true);
assert.equal(catalog.get('transport_start_points').allowEmpty, true);
assert.throws(() => catalog.get('unknown_dataset'), /Dataset Catalog/);

assert.equal(fieldRegistry.hasDataset('itsm_data'), true);
assert.equal(fieldRegistry.list('itsm_data').length, 52);
assert.equal(fieldRegistry.get('itsm_data', 'result6LaborHours').sourceLabel, 'рез6');
assert.equal(fieldRegistry.get('itsm_data', 'result6LaborHours').semanticName, 'mb_labor_total_hh');
assert.equal(
  fieldRegistry.get('itsm_data', 'result6LaborHours').label,
  'Трудоёмкость суммарно из МБ, ч-ч'
);
assert.equal(fieldRegistry.resolveField('itsm_data', 'mb_labor_total_hh'), 'result6LaborHours');
assert.equal(fieldRegistry.resolveField('itsm_data', 'рез6'), 'result6LaborHours');
assert.equal(context.ReclassifierItsmDatasetSchema.sourceLabels[24], 'рез6');
assert.equal(
  context.ReclassifierItsmDatasetSchema.labels[24],
  'Трудоёмкость суммарно из МБ, ч-ч'
);
assert.equal(context.ReclassifierItsmDatasetSchema.fields[24], 'result6LaborHours');

const itsmAccessor = fieldRegistry.createAccessor(
  'itsm_data',
  context.ReclassifierItsmDatasetSchema.fields
);
assert.equal(itsmAccessor.field('mb_labor_total_hh'), 'result6LaborHours');
assert.equal(itsmAccessor.index('mb_labor_total_hh'), 24);
assert.equal(itsmAccessor.label('mb_labor_total_hh'), 'Трудоёмкость суммарно из МБ, ч-ч');
const sampleRow = Array(52).fill(null);
sampleRow[24] = 7.5;
assert.equal(itsmAccessor.value(sampleRow, 'mb_labor_total_hh'), 7.5);
assert.deepEqual(
  Array.from(itsmAccessor.column([sampleRow, sampleRow], 'mb_labor_total_hh')),
  [7.5, 7.5]
);
assert.throws(
  () => itsmAccessor.index('unknown_semantic_field'),
  /Field Registry/
);

console.log('Dataset Catalog parity: OK');
