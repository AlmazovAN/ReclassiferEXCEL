const fs = require('fs');
const vm = require('vm');

const source = fs.readFileSync('src/js/app/database_ui_state.js', 'utf8');

let invalidations = 0;
let lastInvalidatedDatasetIds = null;
let derivedRefreshes = 0;
let lastChangedDatasetIds = null;
let mode = 'ok';
const logs = [];

const repository = {
  hasOpenDatabase() { return true; },
  getDatabaseInfo() {
    return {
      fileName: 'Reclassifier.db',
      databaseUuid: 'db-sync-1',
      schemaVersion: 2,
      valid: true,
      dirty: true,
      errors: [],
      updatedAt: '2026-10-01T14:30:00Z'
    };
  },
  runHealthCheck() {
    return {
      ok: true,
      checkedAt: '2026-10-01T14:30:01Z',
      durationMs: 1,
      estimatedBytes: 1024,
      journalMode: 'delete',
      quickCheck: { ok: true, messages: ['ok'] },
      foreignKeyViolations: [],
      registryMismatches: [],
      missingRegistryDatasets: [],
      datasetStorage: [],
      errors: [],
      warnings: []
    };
  },
  listDatasets() { return []; },
  getImportOverview() {
    return {
      attempts: 0,
      committed: 0,
      failed: 0,
      latestCommittedAt: null,
      latestFailedAt: null,
      latestAttempt: null,
      latestAttemptByDataset: [],
      latestCommittedByDataset: []
    };
  }
};

const context = {
  console,
  Map,
  Set,
  Array,
  Object,
  Number,
  String,
  Date,
  Promise,
  Error,
  setTimeout,
  clearTimeout,
  globalThis: null,
  state: { route: 'database' },
  build: { sqliteVersion: '3.53.4' },
  formatBytes(value) { return String(value); },
  escapeHtml(value) { return String(value ?? ''); },
  log(message, level = 'INFO') { logs.push({ message, level }); },
  renderDatabaseWorkspace() {},
  ReclassifierDatabaseRepository: repository,
  ReclassifierRuntimeDataRepository: {
    invalidate(changedDatasetIds) {
      invalidations += 1;
      lastInvalidatedDatasetIds = Array.isArray(changedDatasetIds)
        ? Array.from(changedDatasetIds)
        : null;
    },
    refreshDerived(changedDatasetIds) {
      derivedRefreshes += 1;
      lastChangedDatasetIds = Array.isArray(changedDatasetIds)
        ? Array.from(changedDatasetIds)
        : null;
      return [{ id: 'combined', records: 2 }];
    }
  },
  ReclassifierDatasetDbStateModel: {
    snapshot() {
      if (mode === 'ok') {
        return {
          database: { open: true, databaseUuid: 'db-sync-1' },
          queue: [],
          datasets: [
            {
              id: 'drivers',
              active: {
                startHtml: true,
                sqliteDb: true,
                activeRuntime: true,
                runtimeSource: 'sqlite'
              }
            },
            {
              id: 'customers',
              active: {
                startHtml: true,
                sqliteDb: false,
                activeRuntime: false,
                runtimeSource: 'missing'
              }
            }
          ]
        };
      }
      return {
        database: { open: true, databaseUuid: 'db-sync-1' },
        queue: [],
        datasets: [
          {
            id: 'drivers',
            active: {
              startHtml: true,
              sqliteDb: true,
              activeRuntime: false,
              runtimeSource: 'missing'
            }
          }
        ]
      };
    }
  }
};
context.globalThis = context;

vm.createContext(context);
vm.runInContext(source, context, { filename: 'database_ui_state.js' });

vm.runInContext(
  "databaseWorkspaceState.intake.push({ integrationStatus: 'committed', synchronizationError: 'stale' });",
  context
);

vm.runInContext(
  "globalThis.__syncResult = databaseSynchronizeWorkspace('unit-test', { checkHealth: true, render: false, changedDatasetIds: ['stationary'] });" +
  "globalThis.__syncState = databaseWorkspaceState.synchronization;" +
  "globalThis.__syncText = databaseSynchronizationText();",
  context
);

if (!context.__syncResult?.ok) throw new Error('Expected successful synchronization.');
if (invalidations !== 1 ||
    JSON.stringify(lastInvalidatedDatasetIds) !== JSON.stringify(['stationary'])) {
  throw new Error('Runtime invalidation must be scoped to the committed Dataset.');
}
if (derivedRefreshes !== 1 || JSON.stringify(lastChangedDatasetIds) !== JSON.stringify(['stationary'])) {
  throw new Error('Synchronization must rebuild derived datasets for the committed source.');
}
if (context.__syncState.derivedRebuilt !== 1 ||
    JSON.stringify(context.__syncState.derivedIds) !== JSON.stringify(['combined'])) {
  throw new Error('Synchronization state must expose rebuilt derived datasets.');
}
if (context.__syncState.status !== 'ready') throw new Error('Sync state must be ready.');
if (context.__syncState.databaseUuid !== 'db-sync-1') throw new Error('Database UUID was not captured.');
if (context.__syncState.sqliteDatasets !== 1) throw new Error('SQLite Dataset count is incorrect.');
if (context.__syncState.runtimeDatasets !== 1) throw new Error('Runtime Dataset count is incorrect.');
if (!String(context.__syncText).startsWith('OK · ')) throw new Error('Sync label must expose OK state.');

vm.runInContext(
  "globalThis.__queueSyncError = databaseWorkspaceState.intake[0].synchronizationError || null;" +
  "globalThis.__queueSyncedAt = databaseWorkspaceState.intake[0].synchronizedAt || null;",
  context
);
if (context.__queueSyncError !== null) {
  throw new Error('Successful synchronization must clear stale queue synchronization error.');
}
if (!context.__queueSyncedAt) {
  throw new Error('Successful synchronization must stamp committed queue rows.');
}

mode = 'mismatch';
vm.runInContext(
  "globalThis.__mismatch = databaseSynchronizeWorkspace('mismatch-test', { checkHealth: false, render: false });" +
  "globalThis.__mismatchState = databaseWorkspaceState.synchronization;" +
  "globalThis.__mismatchError = databaseWorkspaceState.lastError;",
  context
);

if (context.__mismatch?.ok !== false) throw new Error('SQLite/Runtime mismatch must fail synchronization.');
if (context.__mismatchState.status !== 'error') throw new Error('Mismatch must be visible as sync error.');
if (!String(context.__mismatchError).includes('drivers')) {
  throw new Error('Mismatch error must identify the Dataset.');
}
if (invalidations !== 2 || lastInvalidatedDatasetIds !== null) {
  throw new Error('Generic synchronization must invalidate all Runtime caches.');
}
if (derivedRefreshes !== 2 || lastChangedDatasetIds !== null) {
  throw new Error('Generic synchronization must refresh all registered derived datasets.');
}
