// PR-07: exercise the real intake and integration UI functions using isolated stubs.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const integration = read('src/js/app/database_integration_ui.js');
const intake = read('src/js/app/database_intake_ui.js');
const connection = read('src/js/app/database_connection_ui.js');

function createFixture(options = {}) {
  const entries = [];
  const status = {
    intake: [], busy: false, lastError: null, queuePreparationGeneration: 0,
    // Suppress automatic queue scheduling while testing each phase explicitly.
    queuePreparationRunning: true, queuePreparationCurrentIndex: null,
    commitCancelRequested: false, synchronization: {lastAt: 'mock-time'}
  };
  const planFor = item => ({
    inspection: item.inspection,
    definition: {kind: options.equipment ? 'equipment' : 'itsm'},
    preview: {partitions: []}, records: [{key: 'dummy'}], options: {}
  });
  const repository = {downloadDatabase() {return 4096;}};
  const engine = {
    async prepare(item) {
      if (options.prepareFailure) throw Error('Prepare rejected');
      if (options.supersedePrepare) status.queuePreparationGeneration += 1;
      return planFor(item);
    },
    async commit() {
      if (options.rollback) {
        status.commitCancelRequested = true;
        throw Error('отменён');
      }
      if (options.commitFailure) throw Error('COMMIT rejected');
      return {
        title: 'ITSM', strategy: 'UPSERT', rowsBefore: 1, rowsIncoming: 1,
        rowsInserted: 1, rowsUpdated: 0, rowsUnchanged: 0, rowsDeleted: 0, rowsAfter: 2
      };
    },
    async commitBatch(plans) {
      if (options.batchFailure) throw Error('Batch rejected');
      return {
        batchId: 'test-batch', results: plans.map(() => ({rowsAfter: 1})),
        changedDatasetIds: new Set(['mounted']), derivedCandidates: {},
        combinedPreview: {rows: 2}
      };
    }
  };
  const sandbox = {
    state: {route: 'home'},
    databaseWorkspaceState: status,
    databaseMemoryDiagnostics: {begin() {}, mark() {}, finish() {}},
    databaseCurrentInfo: () => ({fileName: 'local.db', databaseUuid: 'test'}),
    databaseNextPaint: async () => {},
    databasePauseQueuePreparation() {status.queuePreparationGeneration += 1;},
    databaseRequestQueuePreparation() {},
    databaseReprepareQueueCandidates() {},
    databaseUpdateCommitProgress() {},
    databaseRunHealthCheck: () => ({ok: true}),
    databaseSynchronizeWorkspace: () =>
      options.syncFailure ? {ok: false, error: 'mock Runtime mismatch'} : {ok: true},
    renderDatabaseWorkspace() {},
    databaseResetIntegrationState() {},
    databaseQueueDatasetId: () => 'itsm_data',
    databaseQueueStrategy: () => 'UPSERT',
    formatBytes: value => value + ' B',
    getDatabaseRepository: () => repository,
    document: {getElementById: () => null},
    setTimeout: callback => callback(),
    confirm: () => true,
    alert(message) {status.lastAlert = String(message);},
    log(message, level = 'INFO', category = 'general') {
      entries.push({message: String(message), level, category});
    },
    ReclassifierDatabaseIntegration: engine,
    ReclassifierDatabaseContract: {datasets: {mounted: {kind: 'equipment'}}},
    ReclassifierDatasetRecognizer: {
      async inspectFile(file) {
        return {
          ready: true, datasetId: options.equipment ? 'mounted' : 'itsm_data',
          classification: {label: 'Known data'}, fileName: file.name,
          validation: {status: 'valid'}
        };
      }
    }
  };
  vm.createContext(sandbox);
  vm.runInContext(integration + '\n' + intake +
    '\n' + connection.slice(connection.indexOf('  function databaseExportCurrent()'),
      connection.indexOf('\n  function databaseCloseCurrent()')) +
    '\n globalThis.testApi = {' +
    'databaseAcceptExcelFiles,databasePrepareCandidate,databaseCommitIntegration,' +
    'databaseCommitEquipmentBatch,databaseCancelIntegration,databaseExportCurrent};', sandbox);
  return {api: sandbox.testApi, status, entries, options};
}
function phases(fixture) {
  return fixture.entries.filter(e => e.message.startsWith('[DBOP-'))
    .map(e => {
      const m = e.message.match(/^\[DBOP-(\d+)\] ([A-Z_]+) · Dataset ([a-zA-Z0-9_.-]+)$/);
      assert.ok(m, 'Invalid trace format: ' + e.message);
      assert.equal(e.category, 'import_export');
      return {id: m[1], phase: m[2], dataset: m[3], level: e.level};
    });
}
function checkPhases(fixture, expected) {
  const actual = phases(fixture);
  assert.deepEqual(actual.map(e => e.phase), expected);
  if (actual.length) assert.equal(new Set(actual.map(e => e.id)).size, 1);
  assert.ok(actual.every(e => e.dataset === (fixture.options.equipment ? 'mounted' : 'itsm_data')));
  return actual;
}
async function addAndPrepare(fixture) {
  await fixture.api.databaseAcceptExcelFiles([
    {name: 'sample.xlsx', size: 10, lastModified: 1}
  ]);
  assert.equal(fixture.status.intake.length, 1);
  assert.ok(fixture.entries.some(e => e.message.includes('Приёмник БД: добавлено Excel-файлов')));
  await fixture.api.databasePrepareCandidate(0);
}

(async () => {
  // Successful import -> prepare -> confirm/COMMIT -> SQLite export.
  const ok = createFixture();
  await addAndPrepare(ok);
  await ok.api.databaseCommitIntegration(0);
  ok.api.databaseExportCurrent();
  assert.equal(ok.status.intake.length, 0, 'successful COMMIT must release file');
  assert.equal(ok.status.busy, false);
  assert.ok(ok.entries.some(e => e.message.includes('SQLite интеграция:')));
  assert.ok(ok.entries.some(e => e.message.includes('Запрошено скачивание отдельной копии SQLite')));
  checkPhases(ok, ['PREPARE_STARTED', 'PREPARE_READY', 'COMMIT_STARTED', 'COMMIT_APPLIED']);

  // Commit error must never produce an applied marker.
  const failed = createFixture({commitFailure: true});
  await addAndPrepare(failed);
  await failed.api.databaseCommitIntegration(0);
  assert.equal(failed.status.intake[0].integrationStatus, 'error');
  assert.equal(failed.status.busy, false);
  const failedPhases = checkPhases(failed,
    ['PREPARE_STARTED', 'PREPARE_READY', 'COMMIT_STARTED', 'COMMIT_FAILED']);
  assert.equal(failedPhases.at(-1).level, 'ERROR');

  // Rollback after explicit cancellation remains WARN, not ERROR or COMMIT_APPLIED.
  const cancelled = createFixture({rollback: true});
  await addAndPrepare(cancelled);
  await cancelled.api.databaseCommitIntegration(0);
  assert.equal(cancelled.status.intake[0].integrationStatus, 'cancelled');
  assert.equal(cancelled.status.intake[0].cancelledDuringCommit, true);
  const rollback = checkPhases(cancelled,
    ['PREPARE_STARTED', 'PREPARE_READY', 'COMMIT_STARTED', 'COMMIT_ROLLED_BACK']);
  assert.equal(rollback.at(-1).level, 'WARN');

  // SQLite COMMIT success with Runtime sync failure: applied + separate warning.
  const partial = createFixture({syncFailure: true});
  await addAndPrepare(partial);
  await partial.api.databaseCommitIntegration(0);
  assert.equal(partial.status.intake[0].integrationStatus, 'committed');
  assert.ok(partial.status.intake[0].synchronizationError);
  const sync = checkPhases(partial,
    ['PREPARE_STARTED', 'PREPARE_READY', 'COMMIT_STARTED', 'COMMIT_APPLIED', 'RUNTIME_SYNC_FAILED']);
  assert.equal(sync.at(-1).level, 'WARN');

  // Preparation failure; no COMMIT is called.
  const prepError = createFixture({prepareFailure: true});
  await addAndPrepare(prepError);
  assert.equal(prepError.status.intake[0].integrationStatus, 'error');
  const preparation = checkPhases(prepError, ['PREPARE_STARTED', 'PREPARE_FAILED']);
  assert.equal(preparation.at(-1).level, 'ERROR');

  // The background candidate becomes stale and must not appear as ready.
  const stale = createFixture({supersedePrepare: true});
  await addAndPrepare(stale);
  checkPhases(stale, ['PREPARE_STARTED', 'PREPARE_SUPERSEDED']);
  assert.notEqual(stale.status.intake[0].integrationStatus, 'prepared');

  // User rejects a prepared candidate before COMMIT.
  const rejected = createFixture();
  await addAndPrepare(rejected);
  rejected.api.databaseCancelIntegration(0);
  assert.equal(rejected.status.intake[0].integrationStatus, 'cancelled');
  const rejectPhases = checkPhases(rejected, ['PREPARE_STARTED', 'PREPARE_READY', 'PREPARE_REJECTED']);
  assert.equal(rejectPhases.at(-1).level, 'WARN');

  // Equipment uses the same per-item identifiers across atomic batch commit.
  const batch = createFixture({equipment: true});
  await addAndPrepare(batch);
  await batch.api.databaseCommitEquipmentBatch(0);
  assert.equal(batch.status.intake.length, 0, 'successful batch COMMIT must release file');
  checkPhases(batch, ['PREPARE_STARTED', 'PREPARE_READY', 'BATCH_COMMIT_STARTED', 'BATCH_COMMIT_APPLIED']);

  // An unsuccessful Equipment batch emits no applied marker.
  const batchFailure = createFixture({equipment: true, batchFailure: true});
  await addAndPrepare(batchFailure);
  await batchFailure.api.databaseCommitEquipmentBatch(0);
  assert.equal(batchFailure.status.intake[0].integrationStatus, 'error');
  checkPhases(batchFailure,
    ['PREPARE_STARTED', 'PREPARE_READY', 'BATCH_COMMIT_STARTED', 'BATCH_COMMIT_FAILED']);

  console.log('PR-07 complete intake/prepare/commit/export, rollback, sync and batch traces: OK');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
