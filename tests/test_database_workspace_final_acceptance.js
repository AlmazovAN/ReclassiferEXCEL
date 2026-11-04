const fs = require('fs');
const vm = require('vm');

const stateModelSource = fs.readFileSync('src/js/app/dataset_db_state_model.js', 'utf8');
const renderersSource = fs.readFileSync('src/js/app/database_view_renderers.js', 'utf8');
const intakeSource = fs.readFileSync('src/js/app/database_intake_ui.js', 'utf8');

let renderCount = 0;
const logs = [];

const definitions = [
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
    databaseTitle: 'Equipment Combined',
    kind: 'equipment',
    schemaVersion: '1.0.0',
    persisted: false,
    strategy: 'DERIVED',
    keyField: null
  }
];

const catalogMap = Object.fromEntries(definitions.map(item => [item.id, item]));

const legacyItems = definitions
  .filter(item => item.persisted !== false)
  .map(item => ({
    id: item.id,
    active: {
      records: [{ id: item.id }],
      meta: {
        fileName: item.id + '.embedded.xlsx',
        earliestSourceDate: '2026-09-01',
        latestSourceDate: '2026-09-20'
      }
    }
  }));

const registry = [
  {
    dataset_id: 'drivers',
    dataset_schema_version: '1.0.0',
    active_revision: 2,
    record_count: 4,
    freshness_from: '2026-09-01',
    freshness_to: '2026-09-30',
    source_file_name: 'Drivers.sqlite.xlsx',
    updated_at: '2026-10-01T15:00:00Z'
  },
  {
    dataset_id: 'mobile_brigade_data',
    dataset_schema_version: '1.4.0',
    active_revision: 7,
    record_count: 10,
    freshness_from: '2026-09-04',
    freshness_to: '2026-09-25',
    source_file_name: 'MB.sqlite.xlsx',
    updated_at: '2026-10-01T15:01:00Z'
  },
  {
    dataset_id: 'failure_classifier',
    dataset_schema_version: '1.9.0',
    active_revision: 1,
    record_count: 3,
    freshness_from: null,
    freshness_to: '2026-09-26',
    source_file_name: 'classifier.sqlite.xlsx',
    updated_at: '2026-10-01T15:02:00Z'
  }
];

const intake = [
  {
    key: 'upsert-1',
    name: 'MB_2026-10-01.xlsx',
    size: 2850000,
    lastModified: 1,
    inspection: {
      datasetId: 'mobile_brigade_data',
      datasetTitle: 'Mobile Brigade Data',
      datasetSchemaVersion: '1.4.0',
      strategy: 'UPSERT',
      sourceRows: 2,
      normalizedRows: 2,
      freshness: { from: '2026-09-24', to: '2026-10-01', source: 'content' },
      ready: true,
      validation: { status: 'valid', errors: [], warnings: [] }
    },
    integrationPreview: {
      rowsBefore: 10,
      rowsIncoming: 2,
      rowsInserted: 0,
      rowsUpdated: 0,
      rowsUnchanged: 2,
      rowsDeleted: 0,
      rowsAfter: 10
    }
  },
  {
    key: 'replace-1',
    name: 'Drivers_new.xlsx',
    size: 12000,
    lastModified: 2,
    inspection: {
      datasetId: 'drivers',
      datasetTitle: 'Drivers',
      datasetSchemaVersion: '1.0.0',
      strategy: 'REPLACE',
      sourceRows: 4,
      normalizedRows: 4,
      freshness: { from: null, to: null, source: 'not-applicable' },
      ready: true,
      validation: { status: 'valid', errors: [], warnings: [] }
    },
    integrationPreview: {
      rowsBefore: 4,
      rowsIncoming: 4,
      rowsInserted: 4,
      rowsUpdated: 0,
      rowsUnchanged: 0,
      rowsDeleted: 4,
      rowsAfter: 4
    }
  },
  {
    key: 'bad-1',
    name: 'unknown.xlsx',
    size: 100,
    lastModified: 3,
    inspection: {
      datasetId: null,
      datasetTitle: null,
      datasetSchemaVersion: null,
      strategy: null,
      sourceRows: 1,
      normalizedRows: null,
      freshness: {},
      ready: false,
      validation: {
        status: 'invalid',
        errors: ['Файл не распознан как поддерживаемый Dataset.'],
        warnings: []
      }
    }
  }
];

const context = {
  console,
  Date,
  Math,
  JSON,
  Map,
  Set,
  Object,
  String,
  Number,
  Array,
  Error,
  Promise,
  globalThis: null,
  window: null,
  state: { route: 'database' },
  databaseWorkspaceState: {
    intake,
    busy: false,
    lastError: null,
    commitProgress: null
  },
  ReclassifierDatasetCatalog: {
    datasets: catalogMap,
    list() { return definitions; }
  },
  ReclassifierDatabaseRepository: {
    hasOpenDatabase() { return true; },
    getDatabaseInfo() {
      return {
        valid: true,
        fileName: 'Reclassifier.db',
        schemaVersion: 2,
        databaseUuid: 'acceptance-db',
        dirty: true
      };
    },
    listDatasets() { return registry.map(row => ({ ...row })); },
    getImportOverview() {
      return {
        latestAttemptByDataset: [
          {
            dataset_id: 'drivers',
            status: 'COMMITTED',
            started_at: '2026-10-01T14:58:00Z',
            finished_at: '2026-10-01T15:00:00Z',
            source_file_name: 'Drivers.sqlite.xlsx',
            rows_before: 3,
            rows_incoming: 4,
            rows_inserted: 4,
            rows_updated: 0,
            rows_unchanged: 0,
            rows_deleted: 3,
            rows_after: 4
          },
          {
            dataset_id: 'failure_classifier',
            status: 'FAILED',
            started_at: '2026-10-01T15:02:00Z',
            finished_at: '2026-10-01T15:02:01Z',
            source_file_name: 'classifier_bad.xlsx',
            rows_before: 3,
            rows_incoming: 2,
            rows_inserted: 0,
            rows_updated: 0,
            rows_unchanged: 0,
            rows_deleted: 0,
            rows_after: 3
          }
        ]
      };
    }
  },
  ReclassifierRuntimeDataRepository: {
    embeddedList() { return legacyItems; },
    source(id) {
      return registry.some(row => row.dataset_id === id && Number(row.active_revision) > 0)
        ? 'sqlite'
        : 'missing';
    }
  },
  ReclassifierDatabaseIntegration: {
    prepare() {},
    commit() {}
  },
  databaseCurrentInfo() {
    return context.ReclassifierDatabaseRepository.getDatabaseInfo();
  },
  databaseHistoryStatusBadge(status) {
    return '<span class="status-badge">' + String(status || '—').toUpperCase() + '</span>';
  },
  databaseFormatTimestamp(value) {
    return value ? String(value) : '—';
  },
  formatBytes(value) {
    return Number(value || 0).toLocaleString('ru-RU') + ' Б';
  },
  escapeHtml(value) {
    return String(value ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;');
  },
  log(message, level = 'INFO') {
    logs.push({ message, level });
  },
  renderDatabaseWorkspace() {
    renderCount += 1;
  },
  databasePauseQueuePreparation() {},
  databaseRequestQueuePreparation() {}
};
context.globalThis = context;
context.window = context;

vm.createContext(context);
vm.runInContext(stateModelSource, context, { filename: 'dataset_db_state_model.js' });
vm.runInContext(renderersSource, context, { filename: 'database_view_renderers.js' });
vm.runInContext(intakeSource, context, { filename: 'database_intake_ui.js' });

function count(haystack, needle) {
  return haystack.split(needle).length - 1;
}

// 1. Several Excel files appear as one row per file.
const queueHtml = vm.runInContext('databaseRenderIntakeCards()', context);
if (count(queueHtml, '<article class="database-intake-row') !== 3) {
  throw new Error('Multi-file queue must render exactly one compact row per Excel file.');
}

// 2. UPSERT and REPLACE modes are both visible.
if (!queueHtml.includes('UPSERT') || !queueHtml.includes('REPLACE')) {
  throw new Error('Queue must expose UPSERT and REPLACE modes.');
}

// 3. No-change UPSERT keeps the arithmetic stable.
if (!queueHtml.includes('до 10 · вход 2 · +0 · ~0 · =2 · после 10')) {
  throw new Error('No-change UPSERT arithmetic is not rendered correctly.');
}
if (!queueHtml.includes('upsert: <strong>0 (+0 · ~0)</strong>')) {
  throw new Error('No-change UPSERT affected-row count must be zero with inserted/updated detail.');
}

// 4. REPLACE arithmetic is deterministic.
if (!queueHtml.includes('до 4 · вход 4 · −4 · +4 · после 4')) {
  throw new Error('REPLACE arithmetic must show removed old rows and written replacement rows.');
}

// 5. Bad files remain in the queue, show the validation reason and cannot load.
if (!queueHtml.includes('Файл не распознан как поддерживаемый Dataset.')) {
  throw new Error('Invalid file validation reason is missing.');
}
const badRowStart = queueHtml.indexOf('unknown.xlsx');
const badRowEnd = queueHtml.indexOf('</article>', badRowStart);
const badRow = queueHtml.slice(badRowStart, badRowEnd);
if (!badRow.includes('database-confirm-integration-button') || !badRow.includes(' disabled')) {
  throw new Error('Invalid file must have a disabled confirmation button.');
}

// 6. Successful commit is retained as session history and shows final DB change.
intake[0].integrationStatus = 'committed';
intake[0].integrationResult = {
  rowsBefore: 10,
  rowsIncoming: 2,
  rowsInserted: 2,
  rowsUpdated: 0,
  rowsUnchanged: 0,
  rowsDeleted: 0,
  rowsAfter: 12,
  committedAt: '2026-10-01T15:10:00Z',
  revision: 8
};
const committedHtml = vm.runInContext('databaseRenderIntakeCards()', context);
const committedStart = committedHtml.indexOf('MB_2026-10-01.xlsx');
const committedEnd = committedHtml.indexOf('</article>', committedStart);
const committedRow = committedHtml.slice(committedStart, committedEnd);
if (!committedRow.includes('Загружено') || !committedRow.includes('до 10 · вход 2 · +2 · ~0 · после 12')) {
  throw new Error('Committed queue row must preserve result and final DB arithmetic.');
}

// 7. Removing a queue row removes only that row and does not mutate the DB mock.
const registryBeforeRemove = JSON.stringify(registry);
vm.runInContext('databaseRemoveIntakeItem(1)', context);
if (context.databaseWorkspaceState.intake.length !== 2) {
  throw new Error('Per-file remove must remove exactly one queue item.');
}
if (JSON.stringify(registry) !== registryBeforeRemove) {
  throw new Error('Queue removal must not mutate database state.');
}
if (renderCount !== 1) {
  throw new Error('Queue removal must refresh Database Workspace exactly once.');
}

// 8. Active references expose all three source states and both schema versions.
const activeRows = context.ReclassifierDatasetDbStateModel.datasets();
const activeHtml = context.databaseRenderActiveReferenceRows(activeRows);
if (!activeHtml.includes('start HTML') ||
    !activeHtml.includes('SQLite DB') ||
    !activeHtml.includes('active Runtime')) {
  throw new Error('Active References must always expose all three source-state badges.');
}
if (!activeHtml.includes('SchAPP') || !activeHtml.includes('SchDB')) {
  throw new Error('Active References must expose SchAPP and SchDB.');
}

// 9. Schema mismatch remains visible rather than being silently reconciled.
const classifierStart = activeHtml.indexOf('Классификатор отказов');
const classifierEnd = activeHtml.indexOf('</tr>', classifierStart);
const classifierRow = activeHtml.slice(classifierStart, classifierEnd);
if (!classifierRow.includes('database-schema-pair mismatch') ||
    !classifierRow.includes('2.0.0') ||
    !classifierRow.includes('1.9.0')) {
  throw new Error('SchAPP/SchDB mismatch must remain explicit in the UI.');
}

// 10. Last attempt shows both COMMITTED and FAILED states from SQLite history.
if (!activeHtml.includes('COMMITTED') || !activeHtml.includes('FAILED')) {
  throw new Error('Active References must expose the latest import-attempt status.');
}

console.log('Database Workspace final acceptance: OK');
