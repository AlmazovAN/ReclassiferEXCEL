const fs = require('fs');
const vm = require('vm');

const source = fs.readFileSync('src/js/app/database_integration_ui.js', 'utf8');

const prepareCalls = [];
let commitCalls = 0;
let previewPass = 0;

function makeItem(name, datasetId, strategy) {
  return {
    key: name,
    name,
    file: { name },
    inspection: {
      ready: true,
      datasetId,
      strategy,
      classification: { id: datasetId, label: datasetId }
    },
    classification: { id: datasetId, label: datasetId }
  };
}

const intake = [
  makeItem('A.xlsx', 'mobile_brigade_data', 'UPSERT'),
  makeItem('B.xlsx', 'drivers', 'REPLACE'),
  makeItem('C.xlsx', 'failure_classifier', 'REPLACE'),
  {
    key: 'bad',
    name: 'bad.xlsx',
    inspection: {
      ready: false,
      datasetId: null,
      validation: { status: 'invalid', errors: ['bad file'], warnings: [] }
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
  Array,
  Object,
  Number,
  String,
  Promise,
  Error,
  setTimeout,
  clearTimeout,
  globalThis: null,
  state: { route: 'database' },
  databaseMemoryDiagnostics: { mark() {}, begin() {}, finish() {} },
  databaseWorkspaceState: {
    intake,
    busy: false,
    lastError: null,
    commitProgress: null,
    commitCancelRequested: false,
    queuePreparationRunning: false,
    queuePreparationRequested: false,
    queuePreparationGeneration: 0,
    queuePreparationCurrentIndex: null,
    queuePreparationReason: null,
    health: null,
    synchronization: { status: 'idle' }
  },
  databaseCurrentInfo() {
    return { fileName: 'Reclassifier.db', databaseUuid: 'db-1' };
  },
  databaseNextPaint() {
    return Promise.resolve();
  },
  databaseFormatTimestamp(value) { return String(value || '—'); },
  databaseSynchronizeWorkspace() {
    return { ok: true };
  },
  renderDatabaseWorkspace() {},
  log() {},
  alert(message) {
    throw new Error('Unexpected alert during background preparation: ' + message);
  },
  escapeHtml(value) { return String(value ?? ''); },
  ReclassifierDatabaseIntegration: {
    async prepare(item) {
      prepareCalls.push(item.name);
      const order = prepareCalls.length;
      await new Promise(resolve => setTimeout(resolve, 1));
      const pass = previewPass;
      return {
        inspection: {
          ...item.inspection,
          classification: item.classification
        },
        records: [{ id: item.name }],
        preview: {
          datasetId: item.inspection.datasetId,
          strategy: item.inspection.strategy,
          rowsBefore: 100 + pass,
          rowsIncoming: 1,
          rowsInserted: item.inspection.strategy === 'UPSERT' ? 1 : 1,
          rowsUpdated: 0,
          rowsUnchanged: 0,
          rowsDeleted: item.inspection.strategy === 'REPLACE' ? 100 + pass : 0,
          rowsAfter: item.inspection.strategy === 'UPSERT' ? 101 + pass : 1,
          testOrder: order
        }
      };
    },
    async commit() {
      commitCalls += 1;
      throw new Error('Background preparation must not commit.');
    }
  }
};
context.globalThis = context;

vm.createContext(context);
vm.runInContext(source, context, { filename: 'database_integration_ui.js' });

async function waitUntilIdle(timeoutMs = 2000) {
  const start = Date.now();
  while (context.databaseWorkspaceState.queuePreparationRunning ||
         context.databaseWorkspaceState.queuePreparationRequested) {
    if (Date.now() - start > timeoutMs) throw new Error('Background queue preparation timed out.');
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  await new Promise(resolve => setTimeout(resolve, 5));
}

(async () => {
  vm.runInContext("databaseRequestQueuePreparation('unit-test')", context);
  await waitUntilIdle();

  if (prepareCalls.join(',') !== 'A.xlsx,B.xlsx,C.xlsx') {
    throw new Error('Candidates were not prepared sequentially in queue order: ' + prepareCalls.join(','));
  }
  if (commitCalls !== 0) {
    throw new Error('Background preparation unexpectedly committed data.');
  }

  for (const item of intake.slice(0, 3)) {
    if (item.integrationStatus !== 'prepared' || !item.pendingPlan || !item.integrationPreview) {
      throw new Error('Ready queue item did not become a prepared candidate: ' + item.name);
    }
  }
  if (intake[3].pendingPlan || intake[3].integrationStatus === 'prepared') {
    throw new Error('Invalid Excel must not be prepared.');
  }

  previewPass = 10;
  vm.runInContext("databaseReprepareQueueCandidates('db-changed')", context);
  await waitUntilIdle();

  if (prepareCalls.join(',') !== 'A.xlsx,B.xlsx,C.xlsx,A.xlsx,B.xlsx,C.xlsx') {
    throw new Error('Candidates were not recalculated after DB change: ' + prepareCalls.join(','));
  }
  for (const item of intake.slice(0, 3)) {
    if (item.integrationPreview.rowsBefore !== 110) {
      throw new Error('Reprepared candidate still contains stale DB preview: ' + item.name);
    }
  }
  if (commitCalls !== 0) {
    throw new Error('Reprepare pass must remain read-only.');
  }

  console.log('Database queue background preparation: OK');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
