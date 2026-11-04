const fs = require('fs');
const vm = require('vm');

const source = fs.readFileSync('src/js/app/dataset_db_state_model.js', 'utf8');

let open = true;

const legacyItems = [
  {
    id: 'drivers',
    active: {
      records: [{ id: 1 }, { id: 2 }],
      meta: {
        fileName: 'Drivers.html.xlsx',
        latestSourceDate: '2026-09-20'
      }
    }
  },
  {
    id: 'failure_classifier',
    active: {
      records: [{ id: 1 }],
      meta: {
        fileName: 'classifier.html.xlsx',
        freshness: '2026-09-26'
      }
    }
  }
];

const registry = [
  {
    dataset_id: 'drivers',
    dataset_schema_version: '1.0.0',
    integration_strategy: 'REPLACE',
    active_revision: 3,
    record_count: 10,
    freshness_from: '2026-01-01',
    freshness_to: '2026-10-01',
    source_file_name: 'Drivers.sqlite.xlsx',
    updated_at: '2026-10-01T12:00:00Z'
  },
  {
    dataset_id: 'failure_classifier',
    dataset_schema_version: '1.9.0',
    integration_strategy: 'REPLACE',
    active_revision: 0,
    record_count: 0,
    freshness_from: null,
    freshness_to: null,
    source_file_name: null,
    updated_at: '2026-10-01T12:00:00Z'
  }
];

const context = {
  console,
  Map,
  Set,
  Object,
  String,
  Number,
  Array,
  Error,
  globalThis: null,
  window: null,
  ReclassifierDatasetCatalog: {
    datasets: {},
    list() {
      return [
        {
          id: 'drivers',
          databaseTitle: 'Drivers',
          kind: 'reference',
          schemaVersion: '1.0.0',
          persisted: true,
          strategy: 'REPLACE',
          keyField: null
        },
        {
          id: 'mobile_brigade_data',
          databaseTitle: 'Mobile Brigade Data',
          kind: 'events',
          schemaVersion: '1.4.0',
          persisted: true,
          strategy: 'UPSERT',
          keyField: 'recordKey'
        },
        {
          id: 'failure_classifier',
          databaseTitle: 'Классификатор отказов',
          kind: 'classifier',
          schemaVersion: '2.0.0',
          persisted: true,
          strategy: 'REPLACE',
          keyField: null
        },
        {
          id: 'combined',
          databaseTitle: 'Combined',
          kind: 'equipment',
          schemaVersion: '1.0.0',
          persisted: false,
          strategy: 'DERIVED',
          keyField: null
        }
      ];
    }
  },
  ReclassifierDatabaseRepository: {
    hasOpenDatabase() { return open; },
    getDatabaseInfo() {
      return {
        valid: true,
        fileName: 'Reclassifier.db',
        schemaVersion: 2,
        databaseUuid: 'db-1',
        dirty: true
      };
    },
    listDatasets() {
      return registry.map(row => ({ ...row }));
    },
    getImportOverview() {
      return {
        latestAttemptByDataset: [
          {
            dataset_id: 'drivers',
            status: 'COMMITTED',
            started_at: '2026-10-01T11:59:00Z',
            finished_at: '2026-10-01T12:00:00Z',
            source_file_name: 'Drivers.sqlite.xlsx',
            rows_before: 9,
            rows_incoming: 10,
            rows_inserted: 1,
            rows_updated: 0,
            rows_unchanged: 9,
            rows_deleted: 0,
            rows_after: 10
          }
        ]
      };
    }
  },
  ReclassifierRuntimeDataRepository: {
    embeddedList() {
      return legacyItems;
    },
    source(id) {
      if (open) return id === 'drivers' ? 'sqlite' : 'missing';
      return legacyItems.some(item => item.id === id && item.active) ? 'legacy' : 'missing';
    }
  }
};
context.ReclassifierDatasetCatalog.datasets = Object.fromEntries(
  context.ReclassifierDatasetCatalog.list().map(item => [item.id, item])
);
context.globalThis = context;
context.window = context;

vm.createContext(context);
vm.runInContext(source, context, { filename: 'dataset_db_state_model.js' });

const model = context.ReclassifierDatasetDbStateModel;
if (!model) throw new Error('Dataset DB State Model was not exported.');

const queue = model.queueItem({
  key: 'file-1',
  name: 'tasks.xlsx',
  size: 2850000,
  lastModified: 1,
  inspection: {
    datasetId: 'mobile_brigade_data',
    datasetTitle: 'Mobile Brigade Data',
    datasetSchemaVersion: '1.4.0',
    strategy: 'UPSERT',
    sourceRows: 9037,
    normalizedRows: 9037,
    freshness: { from: '2026-01-01', to: '2026-09-04', source: 'content' },
    confidence: 100,
    ready: true,
    validation: { status: 'valid' }
  },
  integrationPreview: {
    rowsBefore: 126124,
    rowsIncoming: 9037,
    rowsInserted: 1021,
    rowsUpdated: 0,
    rowsUnchanged: 8016,
    rowsDeleted: 0,
    rowsAfter: 127145
  }
});

if (queue.mode !== 'UPSERT' || queue.sourceRows !== 9037 || queue.schemaApp !== '1.4.0') {
  throw new Error('Queue metadata was not normalized.');
}
if (queue.databaseChange.rowsBefore !== 126124 ||
    queue.databaseChange.rowsInserted !== 1021 ||
    queue.databaseChange.rowsAfter !== 127145) {
  throw new Error('Queue DB change preview was not normalized.');
}
if (queue.status !== 'READY') throw new Error('Queue READY status is incorrect.');

const snapshot = model.snapshot([]);
const drivers = snapshot.datasets.find(item => item.id === 'drivers');
const classifier = snapshot.datasets.find(item => item.id === 'failure_classifier');

if (!snapshot.database.open || snapshot.database.schemaVersion !== 2 || !snapshot.database.dirty) {
  throw new Error('Database state was not exposed.');
}
if (!drivers.active.startHtml || !drivers.active.sqliteDb || !drivers.active.activeRuntime) {
  throw new Error('Drivers three-source activity state is incorrect.');
}
if (drivers.active.runtimeSource !== 'sqlite') {
  throw new Error('Runtime source must report sqlite.');
}
if (drivers.schemaApp !== '1.0.0' || drivers.schemaDb !== '1.0.0') {
  throw new Error('App/DB schema versions were not separated.');
}
if (drivers.freshnessFrom !== '2026-01-01' || drivers.freshnessTo !== '2026-10-01') {
  throw new Error('SQLite freshness was not exposed.');
}
if (drivers.latestAttempt?.status !== 'COMMITTED' ||
    drivers.latestAttempt?.timestamp !== '2026-10-01T12:00:00Z') {
  throw new Error('Latest attempt was not exposed.');
}
if (!classifier.active.startHtml || classifier.active.sqliteDb || classifier.active.activeRuntime) {
  throw new Error('Classifier source activity state is incorrect.');
}
if (classifier.schemaApp !== '2.0.0' || classifier.schemaDb !== '1.9.0') {
  throw new Error('Classifier schema mismatch must remain visible.');
}
if (snapshot.datasets.some(item => item.id === 'combined')) {
  throw new Error('Derived non-persisted Dataset must not appear in DB state rows.');
}

open = false;
const legacySnapshot = model.snapshot([]);
const legacyDrivers = legacySnapshot.datasets.find(item => item.id === 'drivers');
if (legacyDrivers.active.sqliteDb || !legacyDrivers.active.startHtml ||
    !legacyDrivers.active.activeRuntime || legacyDrivers.active.runtimeSource !== 'legacy') {
  throw new Error('Closed DB must expose HTML as the active runtime source.');
}
