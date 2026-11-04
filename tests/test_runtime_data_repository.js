const fs = require('fs');
const vm = require('vm');

const source = fs.readFileSync('src/js/app/data_repository.js', 'utf8');

let open = false;
let getDatasetCalls = 0;
let metadataError = false;
let metadataInvalid = false;
let registryError = false;
let recordError = false;
let registry = [
  {
    dataset_id: 'drivers',
    title: 'Drivers',
    kind: 'reference',
    dataset_schema_version: '1.0.0',
    integration_strategy: 'REPLACE',
    active_revision: 1,
    record_count: 1,
    freshness_from: null,
    freshness_to: null,
    source_file_name: 'Drivers.sqlite.xlsx',
    content_hash: 'hash-1',
    updated_at: '2026-09-29T20:00:00.000Z',
    persisted: 1
  },
  {
    dataset_id: 'mounted',
    title: 'Mounted',
    kind: 'equipment',
    dataset_schema_version: '1.0.0',
    integration_strategy: 'REPLACE',
    active_revision: 1,
    record_count: 1,
    freshness_from: '2026-09-01',
    freshness_to: '2026-09-29',
    source_file_name: 'Mounted.xlsx',
    content_hash: 'mounted-1',
    updated_at: '2026-09-29T20:00:00.000Z',
    persisted: 1
  },
  {
    dataset_id: 'customers',
    title: 'Customers',
    kind: 'reference',
    dataset_schema_version: '1.1.0',
    integration_strategy: 'REPLACE',
    active_revision: 0,
    record_count: 0,
    freshness_from: null,
    freshness_to: null,
    source_file_name: null,
    content_hash: null,
    updated_at: '2026-09-29T20:00:00.000Z',
    persisted: 1
  }
];

const payloads = {
  drivers: {
    id: 'drivers',
    records: [{ mine: 'Северный', value: 2 }],
    state: { sourceSheet: 'Drivers' },
    fullDataset: {
      schemaVersion: '1.0.0',
      package: 'test-full-dataset',
      aggregation: 'per-source-row',
      fieldCount: 2,
      columns: ['Mine', 'TEST_UNKNOWN_COLUMN'],
      rows: [['Северный', 'preserved']],
      coverage: 'complete'
    }
  },
  mounted: {
    id: 'mounted',
    records: [{ id: 'EQ-1', name: 'Камера' }],
    state: { joinIndex: [['unit|camera', { id: 'TR-1' }]] }
  }
};

const legacy = {
  get(id) {
    return {
      id,
      records: [{ legacy: id }],
      validation: { status: 'valid', errors: [], warnings: [] },
      meta: { sourceType: 'embedded', fileName: 'legacy-' + id }
    };
  },
  records(id) {
    return this.get(id).records;
  },
  list() {
    return [
      { id: 'drivers', kind: 'reference', schemaVersion: '1.0.0', allowEmpty: false, active: this.get('drivers') },
      { id: 'customers', kind: 'reference', schemaVersion: '1.1.0', allowEmpty: false, active: this.get('customers') },
      { id: 'mounted', kind: 'equipment', schemaVersion: '1.0.0', allowEmpty: false, active: this.get('mounted') },
      { id: 'combined', kind: 'equipment', schemaVersion: '1.1.0', allowEmpty: false, active: null }
    ];
  }
};

const database = {
  hasOpenDatabase() { return open; },
  getDatabaseInfo() {
    if (!open) throw new Error('closed');
    if (metadataError) throw new Error('SQLite header read failed');
    if (metadataInvalid) return { valid: false, errors: ['Metadata mismatch'] };
    return {
      valid: true,
      databaseUuid: 'db-1',
      fileName: 'Reclassifier.db'
    };
  },
  listDatasets() {
    if (!open) throw new Error('closed');
    if (registryError) throw new Error('sqlite registry I/O error');
    return registry.map(row => ({ ...row }));
  },
  getDataset(id) {
    if (!open) throw new Error('closed');
    getDatasetCalls += 1;
    if (recordError) throw new Error('SQLite page corrupt');
    const row = registry.find(item => item.dataset_id === id);
    if (!row) throw new Error('missing');
    return {
      ...payloads[id],
      registry: { ...row }
    };
  }
};

const context = {
  console,
  JSON,
  Map,
  Set,
  Object,
  String,
  Number,
  Error,
  Array,
  globalThis: null,
  ReclassifierLegacyDatasetStore: legacy,
  ReclassifierDatabaseRepository: database,
  ReclassifierDatabaseContract: {
    datasets: {
      drivers: {
        title: 'Drivers',
        kind: 'reference',
        schemaVersion: '1.0.0',
        persisted: true
      },
      customers: {
        title: 'Customers',
        kind: 'reference',
        schemaVersion: '1.1.0',
        persisted: true
      },
      mounted: {
        title: 'Mounted',
        kind: 'equipment',
        schemaVersion: '1.0.0',
        persisted: true
      },
      combined: {
        title: 'Equipment_Combined',
        kind: 'equipment',
        schemaVersion: '1.1.0',
        persisted: false,
        dependencies: ['mounted']
      }
    }
  }
};
context.globalThis = context;

vm.createContext(context);
vm.runInContext(source, context, { filename: 'data_repository.js' });

const runtime = context.ReclassifierRuntimeDataRepository;
if (!runtime) throw new Error('Runtime Data Repository was not exported.');

if (runtime.mode() !== 'legacy') throw new Error('Closed DB must use legacy mode.');
if (runtime.get('drivers')?.meta?.sourceType !== 'embedded') {
  throw new Error('Legacy Dataset was not returned while DB is closed.');
}

open = true;
runtime.invalidate();

if (runtime.mode() !== 'sqlite') throw new Error('Open valid DB must become authoritative.');
if (runtime.source('drivers') !== 'sqlite' || runtime.source('customers') !== 'missing' ||
    getDatasetCalls !== 0) {
  throw new Error('Lightweight Dataset source labels must only read Registry metadata.');
}

const drivers = runtime.get('drivers');
if (drivers?.meta?.sourceType !== 'sqlite' || drivers.records[0]?.mine !== 'Северный') {
  throw new Error('SQLite Dataset was not adapted to runtime instance.');
}
if (drivers.meta.schemaVersion !== '1.0.0' || drivers.meta.activeRevision !== 1) {
  throw new Error('SQLite registry metadata was not exposed.');
}
if (drivers.fullDataset?.columns?.[1] !== 'TEST_UNKNOWN_COLUMN' ||
    drivers.fullDataset?.rows?.[0]?.[1] !== 'preserved' ||
    drivers.meta.fullDatasetFieldCount !== 2 ||
    drivers.meta.fullDatasetScope !== 'complete') {
  throw new Error('SQLite Full Dataset was not restored into the runtime instance.');
}

runtime.get('drivers');
runtime.records('drivers');
if (getDatasetCalls !== 1) {
  throw new Error('Repeated reads must use cached SQLite Dataset instance.');
}

if (runtime.get('customers') !== null) {
  throw new Error('Missing SQLite Dataset must not fall back to legacy baseline.');
}

const mounted = runtime.get('mounted');
if (!(mounted.joinIndex instanceof Map) || mounted.joinIndex.get('unit|camera')?.id !== 'TR-1') {
  throw new Error('Equipment joinIndex was not restored from dataset_state.');
}

let derivedCalls = 0;
runtime.registerDerived('combined', () => {
  derivedCalls += 1;
  return {
    id: 'combined',
    records: [{ combined: true }],
    validation: { status: 'valid', errors: [], warnings: [] },
    meta: { sourceType: 'sqlite' }
  };
});
if (runtime.get('combined')?.records?.[0]?.combined !== true) {
  throw new Error('Derived SQLite Dataset resolver failed.');
}
runtime.get('combined');
if (derivedCalls !== 1) throw new Error('Derived Dataset must be cached.');

runtime.invalidate(['drivers']);
runtime.get('combined');
if (derivedCalls !== 1) {
  throw new Error('Unrelated Dataset invalidation must preserve Equipment_Combined cache.');
}

const unrelatedRebuild = runtime.refreshDerived(['drivers']);
if (unrelatedRebuild.length !== 0 || derivedCalls !== 1) {
  throw new Error('Unrelated Dataset change must not rebuild Equipment_Combined.');
}

const dependentRebuild = runtime.refreshDerived(['mounted']);
if (dependentRebuild.length !== 1 ||
    dependentRebuild[0].id !== 'combined' ||
    dependentRebuild[0].records !== 1 ||
    derivedCalls !== 2) {
  throw new Error('Mounted change must eagerly rebuild Equipment_Combined.');
}
runtime.get('combined');
if (derivedCalls !== 2) {
  throw new Error('Eagerly rebuilt derived Dataset must remain cached.');
}

const preparedCombined = {
  id: 'combined',
  records: [{ combined: 'prepared-batch' }],
  validation: { status: 'valid', errors: [], warnings: [] },
  meta: { sourceType: 'sqlite' }
};
runtime.invalidate(['mounted']);
const preparedRebuild = runtime.refreshDerived(['mounted'], {
  combined: preparedCombined
});
if (preparedRebuild.length !== 1 ||
    preparedRebuild[0].prepared !== true ||
    derivedCalls !== 2 ||
    runtime.get('combined') !== preparedCombined) {
  throw new Error('Prepared derived candidate must be published without a second resolver rebuild.');
}

let guarded = false;
try {
  runtime.assertLegacyWriteAllowed();
} catch (error) {
  guarded = /Reclassifier\.db/.test(error.message);
}
if (!guarded) throw new Error('Legacy writes were not blocked while SQLite is authoritative.');

registry = registry.map(row => row.dataset_id === 'drivers'
  ? { ...row, active_revision: 2, content_hash: 'hash-2', updated_at: '2026-09-29T21:00:00.000Z' }
  : row
);
payloads.drivers.records = [{ mine: 'Таймырский', value: 3 }];
runtime.invalidate();
if (runtime.get('drivers')?.records?.[0]?.mine !== 'Таймырский' || getDatasetCalls !== 3) {
  throw new Error('Cache invalidation did not reload changed SQLite Dataset.');
}

recordError = true;
runtime.invalidate();
let failedRecord = false;
try { runtime.get('drivers'); } catch (error) {
  failedRecord = /SQLite page corrupt/.test(error.message);
}
if (!failedRecord) throw new Error('An unreadable SQLite Dataset must not fall back to HTML.');
recordError = false;

registryError = true;
runtime.invalidate();
let failedRegistry = false;
try { runtime.source('drivers'); } catch (error) {
  failedRegistry = /Dataset Registry/.test(error.message);
}
if (!failedRegistry) throw new Error('A registry read error must not masquerade as an empty DB.');
registryError = false;

metadataInvalid = true;
runtime.invalidate();
let failedMetadata = false;
try { runtime.mode(); } catch (error) {
  failedMetadata = /Metadata mismatch/.test(error.message);
}
if (!failedMetadata) throw new Error('Invalid metadata on an open handle must fail closed.');
metadataInvalid = false;

metadataError = true;
runtime.invalidate();
let failedHeader = false;
try { runtime.get('drivers'); } catch (error) {
  failedHeader = /SQLite header read failed/.test(error.message);
}
if (!failedHeader) throw new Error('An open-handle read error must not enable HTML fallback.');
metadataError = false;

payloads.drivers.records.push({ mine: 'Unexpected duplicate' });
runtime.invalidate();
let failedCount = false;
try { runtime.get('drivers'); } catch (error) {
  failedCount = /не соответствует Dataset Registry/.test(error.message);
}
if (!failedCount) throw new Error('A corrupted record count must be diagnosed.');
payloads.drivers.records.pop();

open = false;
runtime.invalidate();
if (runtime.mode() !== 'legacy' || runtime.get('drivers')?.records?.[0]?.legacy !== 'drivers') {
  throw new Error('Closing DB did not restore legacy Dataset Store.');
}

console.log('Runtime SQLite-first Data Repository: OK');
