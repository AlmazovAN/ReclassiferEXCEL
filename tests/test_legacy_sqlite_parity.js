// Step 9 architecture regression: the same Dataset state must expose equivalent
// runtime semantics before and after Legacy HTML -> SQLite bootstrap.
// Uses synthetic records only; SQLite JS/WASM is the exact runtime embedded in FULL HTML.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const dist = path.resolve(process.env.RECLASSIFIER_HTML_DIR || path.join(root, 'dist'));
const outputs = fs.readdirSync(dist)
  .filter(name => /^Reclassifier_v.*_CORE\.html$/.test(name));
assert.equal(outputs.length, 1, 'Exactly one CORE HTML artifact is required.');

const html = fs.readFileSync(path.join(dist, outputs[0]), 'utf8');
const vendor = html.match(/<script id="sqliteVendorSource">([\s\S]*?)<\/script>/);
const wasm = html.match(/"sqliteWasmBase64": "([A-Za-z0-9+/=]+)"/);
assert(vendor && wasm, 'FULL HTML must embed SQLite JS/WASM.');

vm.runInThisContext(vendor[1], { filename: 'sqlite-vendor.js' });
vm.runInThisContext(
  fs.readFileSync(path.join(root, 'src/js/app/dataset_catalog.js'), 'utf8'),
  { filename: 'dataset_catalog.js' }
);
vm.runInThisContext(
  fs.readFileSync(path.join(root, 'src/js/app/database_contract.js'), 'utf8'),
  { filename: 'database_contract.js' }
);

const catalog = globalThis.ReclassifierDatasetCatalog;
const contract = globalThis.ReclassifierDatabaseContract;

function validation() {
  return { status: 'valid', errors: [], warnings: [] };
}

function baseMeta(id, definition, records) {
  return {
    schemaVersion: definition.schemaVersion,
    sourceType: 'embedded',
    sourceKind: 'parity-fixture',
    fileName: id + '.xlsx',
    fileSize: 100 + records.length,
    sourceRows: records.length,
    normalizedRows: records.length,
    dataFingerprint: 'parity-' + id,
    earliestSourceDate: '2026-09-01',
    latestSourceDate: '2026-09-30'
  };
}

function instance(id, records, extraMeta = {}, joinIndex = null) {
  const definition = catalog.get(id);
  const result = {
    id,
    file: null,
    records,
    validation: validation(),
    meta: {
      ...baseMeta(id, definition, records),
      ...extraMeta
    }
  };
  if (joinIndex instanceof Map) result.joinIndex = joinIndex;
  return result;
}

const instances = new Map();
for (const definition of catalog.list()) {
  if (definition.persisted === false) continue;
  const records = definition.allowEmpty
    ? []
    : [{ dataset: definition.id, value: 'fixture-' + definition.id }];
  instances.set(definition.id, instance(definition.id, records));
}

instances.set('itsm_data', instance('itsm_data', [
  ['INC-100', 'Первая заявка'],
  ['INC-200', 'Вторая заявка']
], {
  fields: ['number', 'shortDescription'],
  columns: ['Номер', 'Краткое описание'],
  fieldCount: 2,
  sourceFileSha256: 'sha256-parity-itsm',
  processingAsOfDate: '2026-09-30'
}));

instances.set('mobile_brigade_data', instance('mobile_brigade_data', [
  {
    site: 'Северный',
    taskNumber: 'TASK-1',
    taskForShiftId: 'SHIFT-1',
    recordKey: 'северный|task-1',
    request: 'INC-100',
    laborHours: 2.5
  },
  {
    site: 'Таймырский',
    taskNumber: 'TASK-2',
    taskForShiftId: 'SHIFT-2',
    recordKey: 'таймырский|task-2',
    request: 'INC-200',
    laborHours: 4
  }
], {
  freshnessByScope: {
    'Северный': '2026-09-30',
    'Таймырский': '2026-09-29'
  }
}));

const mountedJoinKey = 'unit 1\u001floader a';
instances.set('mounted', instance('mounted', [{
  source_catalog: 'Mounted',
  id: 'EQ-M1',
  unit: 'Unit 1',
  name: 'Камера',
  equipment_type: 'Video',
  location: 'Horizon 1',
  transport: 'Loader A',
  not_working_since: null,
  customer: 'Customer A',
  parent: null,
  commissioning_date: '2025-01-10'
}], {
  approvedColumns: [
    'source_catalog', 'id', 'unit', 'name', 'equipment_type', 'location',
    'transport', 'not_working_since', 'customer', 'parent', 'commissioning_date'
  ],
  freshness: '2026-09-30',
  latestSourceDate: '2026-09-30'
}, new Map([['mounted-index', { id: 'EQ-M1' }]])));

instances.set('stationary', instance('stationary', [{
  source_catalog: 'Stationary',
  id: 'EQ-S1',
  unit: 'Unit 2',
  unit_department: 'Department A',
  name: 'Коммутатор',
  equipment_type: 'Network',
  location: 'Node 2',
  address: 'Address 2',
  horizon: 'H-200',
  transport: null,
  not_working_since: '2026-09-20',
  customer: 'Customer B',
  parent: null,
  commissioning_date: '2024-05-01'
}], {
  approvedColumns: [
    'source_catalog', 'id', 'unit', 'unit_department', 'name', 'equipment_type',
    'location', 'address', 'horizon', 'transport', 'not_working_since',
    'customer', 'parent', 'commissioning_date'
  ],
  freshness: '2026-09-29',
  latestSourceDate: '2026-09-29'
}));

instances.set('transport', instance('transport', [{
  transport__id: 'TR-1',
  transport__transport_type: 'ПДМ',
  transport__description: 'Loader A',
  transport__location: 'Horizon 1',
  transport__self_moving_type: 'Самоходный'
}], {
  approvedColumns: [
    'transport__id', 'transport__transport_type', 'transport__description',
    'transport__location', 'transport__self_moving_type'
  ],
  freshness: '2026-09-28',
  latestSourceDate: '2026-09-28'
}, new Map([[mountedJoinKey, {
  transport__id: 'TR-1',
  transport__transport_type: 'ПДМ',
  transport__description: 'Loader A',
  transport__location: 'Horizon 1',
  transport__self_moving_type: 'Самоходный'
}]])));

instances.set('transport_start_points', instance(
  'transport_start_points',
  [],
  { approvedColumns: [], freshness: '2026-09-27', latestSourceDate: '2026-09-27' },
  new Map([['unit 1\u001floader a', {
    maintenance_date: '2026-09-25',
    maintenance_position: 'Start A',
    maintenance_type: 'TO'
  }]])
));

instances.set('zabbix', instance('zabbix', [
  {
    zabbix__id: 'Z-1',
    zabbix__name: 'Camera monitor',
    zabbix__site_address_b: 'B1',
    zabbix__site_address_c: 'C1',
    zabbix__zabbix_equipment_type__name: 'Camera',
    zabbix__update: '2026-09-30 10:00:00'
  },
  {
    zabbix__id: 'Z-2',
    zabbix__name: 'Switch monitor',
    zabbix__site_address_b: 'B2',
    zabbix__site_address_c: 'C2',
    zabbix__zabbix_equipment_type__name: 'Switch',
    zabbix__update: '2026-09-29 11:00:00'
  }
], {
  approvedColumns: [
    'zabbix__id', 'zabbix__name', 'zabbix__site_address_b',
    'zabbix__site_address_c', 'zabbix__zabbix_equipment_type__name',
    'zabbix__update'
  ],
  freshness: '2026-09-30',
  latestSourceDate: '2026-09-30'
}, new Map([
  ['EQ-M1', [{
    zabbix__id: 'Z-1',
    zabbix__name: 'Camera monitor',
    zabbix__site_address_b: 'B1',
    zabbix__site_address_c: 'C1',
    zabbix__zabbix_equipment_type__name: 'Camera',
    zabbix__update: '2026-09-30 10:00:00'
  }]],
  ['EQ-S1', [{
    zabbix__id: 'Z-2',
    zabbix__name: 'Switch monitor',
    zabbix__site_address_b: 'B2',
    zabbix__site_address_c: 'C2',
    zabbix__zabbix_equipment_type__name: 'Switch',
    zabbix__update: '2026-09-29 11:00:00'
  }]]
])));

instances.set('failure_classifier', instance('failure_classifier', [
  {
    service: 'Video',
    equipment: 'Camera',
    element: 'Cable',
    failure: 'No signal',
    cause: 'Cable damage'
  },
  {
    service: 'Network',
    equipment: 'Switch',
    element: 'Power',
    failure: 'Offline',
    cause: 'External power'
  }
], {
  latestChangedAt: '2026-09-30',
  format: 'normalized',
  formatLabel: 'Normalized classifier',
  candidateRows: 3,
  filteredRows: 2,
  filteredServiceRows: 1,
  filteredDeactivatedRows: 0,
  filteredSaduRows: 0,
  filteredUnknownDeactivatedRows: 0,
  filteredUnknownSaduRows: 0,
  serviceCount: 2,
  equipmentCount: 2,
  elementCount: 2,
  failureCount: 2,
  causeCount: 2,
  duplicatesRemoved: 1,
  incompleteRows: 0
}));

const legacyStore = {
  get(id) {
    return instances.get(id) || null;
  },
  records(id) {
    return this.get(id)?.records || [];
  },
  list() {
    return catalog.list().map(definition => ({
      id: definition.id,
      kind: definition.kind,
      schemaVersion: definition.schemaVersion,
      allowEmpty: definition.allowEmpty,
      active: instances.get(definition.id) || null
    }));
  }
};

globalThis.window = globalThis;
globalThis.state = {
  equipmentHistory: {},
  activeEquipmentId: null,
  pendingEquipmentId: null,
  equipmentStaging: { files: [], catalogs: {}, combined: null, messages: [], processedAt: null }
};
globalThis.ReclassifierLegacyDatasetStore = legacyStore;
globalThis.ReclassifierItsmDatasetSchema = {
  fields: ['number', 'shortDescription'],
  labels: ['Номер', 'Краткое описание']
};
globalThis.ReclassifierDatasetLifecycleManager = {
  activate(_id, value) { return value; }
};

new Function(
  'assets',
  'build',
  'log',
  fs.readFileSync(path.join(root, 'src/js/app/database_core.js'), 'utf8')
)(
  { sqliteWasmBase64: wasm[1] },
  { version: 'step9-parity', sqliteVersion: '3.53.4' },
  () => {}
);

vm.runInThisContext(
  fs.readFileSync(path.join(root, 'src/js/app/database_bootstrap.js'), 'utf8'),
  { filename: 'database_bootstrap.js' }
);
vm.runInThisContext(
  fs.readFileSync(path.join(root, 'src/js/app/data_repository.js'), 'utf8'),
  { filename: 'data_repository.js' }
);

const equipmentBundle = [
  fs.readFileSync(path.join(root, 'src/js/modules/equipment/equipment_config.js'), 'utf8'),
  fs.readFileSync(path.join(root, 'src/js/modules/equipment/equipment_logic.js'), 'utf8'),
  'globalThis.__parityBuildCombined = buildEquipmentCombinedFromCatalogs;'
].join('\n');
vm.runInThisContext(equipmentBundle, { filename: 'equipment-parity-bundle.js' });

const equipmentCatalogs = Object.fromEntries(
  ['mounted', 'stationary', 'transport', 'transport_start_points', 'zabbix']
    .map(id => [id, instances.get(id)])
);
const legacyCombined = globalThis.__parityBuildCombined(equipmentCatalogs, 'derived');
assert(legacyCombined, 'Legacy Equipment_Combined fixture was not created.');
instances.set('combined', legacyCombined);

const runtime = globalThis.ReclassifierRuntimeDataRepository;
const bootstrap = globalThis.ReclassifierDatabaseBootstrap;
const database = globalThis.ReclassifierDatabaseRepository;

function mapEntries(value) {
  return value instanceof Map ? Array.from(value.entries()) : [];
}

function semanticMeta(instance) {
  const meta = instance?.meta || {};
  const keys = [
    'schemaVersion', 'fileName', 'sourceRows', 'normalizedRows',
    'dataFingerprint', 'fields', 'columns', 'fieldCount', 'sourceFileSha256',
    'processingAsOfDate', 'approvedColumns', 'freshnessByScope',
    'format', 'formatLabel', 'candidateRows', 'filteredRows',
    'filteredServiceRows', 'filteredDeactivatedRows', 'filteredSaduRows',
    'filteredUnknownDeactivatedRows', 'filteredUnknownSaduRows',
    'serviceCount', 'equipmentCount', 'elementCount', 'failureCount',
    'causeCount', 'duplicatesRemoved', 'incompleteRows'
  ];
  const result = {};
  for (const key of keys) {
    if (meta[key] !== undefined) result[key] = meta[key];
  }
  result.earliestSourceDate = meta.earliestSourceDate || null;
  result.latestSourceDate = meta.latestSourceDate || null;
  if (instance?.id === 'failure_classifier') {
    result.latestChangedAt = meta.latestChangedAt || null;
  }
  if (catalog.get(instance.id).kind === 'equipment') {
    result.joinIndex = mapEntries(instance.joinIndex);
  }
  return result;
}

function semanticCombined(instance) {
  const meta = instance.meta || {};
  return {
    records: instance.records,
    validation: instance.validation,
    joinIndex: mapEntries(instance.joinIndex),
    meta: {
      schemaVersion: meta.schemaVersion,
      sourceRows: meta.sourceRows,
      normalizedRows: meta.normalizedRows,
      approvedColumns: meta.approvedColumns,
      freshness: meta.freshness,
      transportCandidates: meta.transportCandidates,
      transportMatches: meta.transportMatches,
      transportUnmatched: meta.transportUnmatched,
      zabbixEquipmentMatches: meta.zabbixEquipmentMatches,
      duplicateBaseIds: meta.duplicateBaseIds,
      sourceCatalogs: meta.sourceCatalogs
    }
  };
}

function assertPersistedParity(label) {
  for (const definition of catalog.list().filter(item => item.persisted !== false)) {
    const expected = instances.get(definition.id);
    const actual = runtime.get(definition.id);
    assert(actual, label + ': missing runtime Dataset ' + definition.id);
    assert.deepStrictEqual(
      actual.records,
      expected.records,
      label + ': records changed for ' + definition.id
    );
    assert.deepStrictEqual(
      actual.validation,
      expected.validation,
      label + ': validation changed for ' + definition.id
    );
    assert.deepStrictEqual(
      semanticMeta(actual),
      semanticMeta(expected),
      label + ': semantic metadata changed for ' + definition.id
    );
    assert.equal(runtime.source(definition.id), 'sqlite',
      label + ': SQLite source label missing for ' + definition.id);
    assert.equal(actual.meta.sourceType, 'sqlite',
      label + ': SQLite adapter sourceType missing for ' + definition.id);
    assert.equal(actual.meta.activeRevision, 1,
      label + ': initial active revision must be 1 for ' + definition.id);
  }
}

(async () => {
  assert.equal(runtime.mode(), 'legacy');
  for (const definition of catalog.list()) {
    assert.strictEqual(
      runtime.get(definition.id),
      instances.get(definition.id) || null,
      'Legacy facade changed identity for ' + definition.id
    );
  }

  const legacyList = runtime.list().map(item => ({
    id: item.id,
    rows: item.active?.records?.length ?? null
  }));

  const seeds = bootstrap.collectSeeds();
  assert.equal(
    seeds.length,
    catalog.list().filter(item => item.persisted !== false).length,
    'Bootstrap did not collect every persisted Dataset.'
  );
  assert(!seeds.some(seed => seed.id === 'combined'),
    'Derived combined Dataset must not be persisted.');

  await database.createDatabase({
    fileName: 'Reclassifier.db',
    appVersion: 'step9-parity'
  });
  const outcome = await database.bootstrapDatasets(seeds);
  assert.equal(outcome.completedDatasets, seeds.length);
  assert(database.runHealthCheck().ok, 'SQLite health failed after parity bootstrap.');

  runtime.invalidate();
  assert.equal(runtime.mode(), 'sqlite');
  assertPersistedParity('initial SQLite bootstrap');

  const sqliteCombined = runtime.get('combined');
  assert(sqliteCombined, 'SQLite derived Equipment_Combined is missing.');
  assert.deepStrictEqual(
    semanticCombined(sqliteCombined),
    semanticCombined(legacyCombined),
    'Derived Equipment_Combined differs between Legacy and SQLite.'
  );
  assert.equal(sqliteCombined.meta.sourceType, 'sqlite');
  assert.equal(runtime.source('combined'), 'sqlite');

  const sqliteList = runtime.list().map(item => ({
    id: item.id,
    rows: item.active?.records?.length ?? null
  }));
  assert.deepStrictEqual(
    sqliteList,
    legacyList,
    'Runtime list() changed Dataset presence or row counts after switching to SQLite.'
  );

  assert.equal(runtime.source('unknown_dataset'), 'missing');
  assert.equal(runtime.get('unknown_dataset'), null);

  // Binary export/reopen must preserve the same runtime semantics too.
  const exported = database.exportDatabase();
  assert(exported instanceof Uint8Array && exported.byteLength > 100);
  database.closeDatabase();
  runtime.invalidate();
  assert.equal(runtime.mode(), 'legacy');
  assert.strictEqual(runtime.get('drivers'), instances.get('drivers'),
    'Closing SQLite did not restore the untouched Legacy Dataset.');

  await database.openDatabase(exported, { fileName: 'parity-reopened.db' });
  runtime.invalidate();
  assert.equal(runtime.mode(), 'sqlite');
  assertPersistedParity('reopened SQLite');
  assert.deepStrictEqual(
    semanticCombined(runtime.get('combined')),
    semanticCombined(legacyCombined),
    'Derived Equipment_Combined changed after SQLite export/reopen.'
  );

  const registry = database.listDatasets();
  for (const definition of catalog.list().filter(item => item.persisted !== false)) {
    const row = registry.find(item => item.dataset_id === definition.id);
    assert(row, 'Registry row missing for ' + definition.id);
    assert.equal(Number(row.record_count), instances.get(definition.id).records.length);
    assert.equal(Number(row.active_revision), 1);
  }

  assert(database.runHealthCheck().ok, 'SQLite health failed after parity reopen.');
  database.closeDatabase();
  runtime.invalidate();

  console.log(
    'Legacy ↔ SQLite parity: ' + seeds.length +
    ' persisted Dataset + derived combined; records/meta/list/export-reopen: OK'
  );
})().catch(error => {
  try { globalThis.ReclassifierDatabaseRepository?.closeDatabase?.(); } catch (_) {}
  console.error(error);
  process.exitCode = 1;
});
