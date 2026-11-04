// Real SQLite 3.53.4 WASM regression using the exact CORE HTML artifact.
// Run after build/build.py; does not hydrate or expose private baseline data.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const dist = path.resolve(process.env.RECLASSIFIER_HTML_DIR || path.join(__dirname, '..', 'dist'));
const htmlPath = fs.readdirSync(dist)
  .filter(name => /^Reclassifier_v.*_CORE\.html$/.test(name))
  .map(name => path.join(dist, name));
assert.strictEqual(htmlPath.length, 1, 'Expected one CORE HTML artifact.');

const html = fs.readFileSync(htmlPath[0], 'utf8');
const vendor = html.match(/<script id="sqliteVendorSource">([\s\S]*?)<\/script>/);
const wasm = html.match(/"sqliteWasmBase64": "([A-Za-z0-9+/=]+)"/);
assert(vendor && wasm, 'CORE HTML does not embed the SQLite JS/WASM runtime.');
vm.runInThisContext(vendor[1], { filename: 'sqlite-vendor.js' });
vm.runInThisContext(fs.readFileSync(path.join(__dirname, '..', 'src/js/app/dataset_catalog.js'), 'utf8'));
vm.runInThisContext(fs.readFileSync(path.join(__dirname, '..', 'src/js/app/database_contract.js'), 'utf8'));
new Function('assets', 'build', 'log',
  fs.readFileSync(path.join(__dirname, '..', 'src/js/app/database_core.js'), 'utf8')
)({ sqliteWasmBase64: wasm[1] }, { version: 'test', sqliteVersion: '3.53.4' }, () => {});

async function main() {
  const db = globalThis.ReclassifierDatabaseRepository;
  await db.createDatabase({ appVersion: 'test' });
  db.upsertDataset('mobile_brigade_data', [
    { recordKey: 'MB1', request: 'INC-100', laborHours: 2 },
    { recordKey: 'MB2', request: 'INC-200', laborHours: 3 },
    { recordKey: 'MB3', request: 'INC-300', laborHours: 4 }
  ], { state: { schemaVersion: '1.4.0' } });
  assert.deepStrictEqual(
    db.getMobileBrigadeRowsForRequests(['  inc-100  ', 'INC-300']).map(r => r.recordKey),
    ['MB1', 'MB3'], 'Selective MB enrichment returned unrelated tasks.'
  );

  const stress = process.argv.includes('--stress');
  const initialCount = stress ? 50000 : 8000;
  const incomingCount = stress ? 25000 : 4000;
  const overlapCount = stress ? 15000 : 2500;
  const fields = ['number', ...Array.from({ length: 50 }, (_, i) => 'field' + i)];
  const value = 'Проверка записей ITSM / связь / диагностика / ' + 'x'.repeat(14);
  const rows = (offset, count, changed = false) => Array.from({ length: count }, (_, n) =>
    ['INC-' + (offset + n), ...Array(50).fill(changed ? value + ' (updated)' : value)]
  );

  const base = rows(0, initialCount);
  const first = db.upsertDataset('itsm_data', base, { state: { fields } });
  assert.strictEqual(first.rowsAfter, initialCount);
  const incoming = [
    ...rows(initialCount - overlapCount, overlapCount, true),
    ...rows(initialCount, incomingCount - overlapCount)
  ];
  const options = { state: { fields } };
  const preview = db.previewDatasetChange('itsm_data', incoming, options);
  assert.strictEqual(preview.rowsBefore, initialCount);
  assert.strictEqual(preview.rowsIncoming, incomingCount);
  assert.strictEqual(preview.rowsInserted, incomingCount - overlapCount);
  assert.strictEqual(preview.rowsUpdated, overlapCount);
  assert.strictEqual(preview.rowsAfter, initialCount + incomingCount - overlapCount);

  const commit = db.upsertDataset('itsm_data', incoming, options);
  for (const field of ['rowsBefore', 'rowsIncoming', 'rowsInserted', 'rowsUpdated', 'rowsUnchanged', 'rowsAfter']) {
    assert.strictEqual(commit[field], preview[field], 'Preview and COMMIT mismatch: ' + field);
  }
  const registry = db.getDatasetRegistry('itsm_data');
  assert.strictEqual(Number(registry.record_count), preview.rowsAfter);

  // Large repeated import must be idempotent, even across asynchronous batches.
  // While the transaction yields to the event loop, no second public Repository
  // operation may read uncommitted rows, export/close the handle or start another write.
  const progress = [];
  let mutexProbed = false;
  let concurrentWriteFailure = null;
  const repeated = await db.upsertDatasetAsync('itsm_data', incoming, options, p => {
    progress.push(p.processedRows);
    if (mutexProbed) return;
    mutexProbed = true;

    const active = db.getOperationState();
    assert.strictEqual(active.busy, true);
    assert.strictEqual(active.name, 'upsertDatasetAsync');

    for (const probe of [
      () => db.getDatasetRegistry('itsm_data'),
      () => db.exportDatabase(),
      () => db.closeDatabase()
    ]) {
      assert.throws(
        probe,
        error => error?.code === 'RECLASSIFIER_DATABASE_BUSY' &&
          error?.activeOperation === 'upsertDatasetAsync'
      );
    }

    concurrentWriteFailure = db.upsertDatasetAsync(
      'itsm_data',
      [['INC-MUTEX-PROBE', ...Array(50).fill(value)]],
      options
    ).then(() => null, error => error);
  });
  assert(mutexProbed, 'Async UPSERT never reached a mutex-observable yield.');
  const concurrentError = await concurrentWriteFailure;
  assert.strictEqual(concurrentError?.code, 'RECLASSIFIER_DATABASE_BUSY');
  assert.strictEqual(concurrentError?.activeOperation, 'upsertDatasetAsync');
  assert.strictEqual(concurrentError?.requestedOperation, 'upsertDatasetAsync');
  assert.strictEqual(db.getOperationState().busy, false,
    'Repository mutex was not released after async COMMIT.');

  assert.strictEqual(repeated.rowsInserted, 0);
  assert.strictEqual(repeated.rowsUpdated, 0);
  assert.strictEqual(repeated.rowsUnchanged, incomingCount);
  assert.strictEqual(repeated.rowsAfter, commit.rowsAfter);
  assert(progress.length > 1 && progress[progress.length - 1] === incomingCount,
    'Async UPSERT progress was not emitted in bounded batches.');

  // The cancellation callback is triggered *after* real writes, so this
  // exercises rollback rather than only rejecting at the beginning.
  const countBeforeCancel = Number(db.getDatasetRegistry('itsm_data').record_count);
  let cancel = false;
  await assert.rejects(
    () => db.upsertDatasetAsync('itsm_data',
      rows(initialCount + incomingCount + 300, 800), options,
      p => { if (p.processedRows >= 500) cancel = true; },
      () => cancel
    ),
    /прервана пользователем/
  );
  assert.strictEqual(Number(db.getDatasetRegistry('itsm_data').record_count), countBeforeCancel,
    'Cancellation leaked uncommitted event records.');
  assert(db.getImportHistory('itsm_data', 3).some(row => row.status === 'ROLLED_BACK'),
    'Interrupted transaction was not identified in import_history.');

  // A late invalid record must rollback earlier batches as well.
  const duplicateRows = rows(initialCount + incomingCount + 1200, 320);
  duplicateRows.push(duplicateRows[0].slice());
  await assert.rejects(
    () => db.upsertDatasetAsync('itsm_data', duplicateRows, options),
    /Повторный ключ/
  );
  assert.strictEqual(Number(db.getDatasetRegistry('itsm_data').record_count), countBeforeCancel,
    'A late error caused partial dataset persistence.');

  const countBeforeFailure = Number(db.getDatasetRegistry('itsm_data').record_count);
  assert.throws(
    () => db.upsertDataset('itsm_data', [
      ['INC-999999', ...Array(50).fill(value)],
      [' inc-999999 ', ...Array(50).fill(value)]
    ], options),
    /Повторный ключ/
  );
  assert.strictEqual(Number(db.getDatasetRegistry('itsm_data').record_count), countBeforeFailure,
    'Failed transaction changed committed records.');
  const health = db.runHealthCheck();
  assert(health.ok, 'SQLite health failed after rollback: ' + health.errors.join('; '));
  const storage = health.datasetStorage.find(row => row.dataset_id === 'itsm_data');
  assert.strictEqual(Number(storage.rows), countBeforeFailure);
  assert(Number(storage.json_bytes) > 0);
  if (!stress) {
    // Binary export → close → reopen is tested against the real embedded WASM.
    const saved = db.exportDatabase();
    assert(saved instanceof Uint8Array && saved.byteLength > 100);
    db.closeDatabase();
    await db.openDatabase(saved, { fileName: 'reopened.db' });
    assert.strictEqual(Number(db.getDatasetRegistry('itsm_data').record_count), countBeforeCancel);
    const uuid = db.getDatabaseInfo().databaseUuid;
    await assert.rejects(
      () => db.openDatabase(new Blob([Uint8Array.from([1, 2, 3])])),
      /100 байт/
    );
    await assert.rejects(
      () => db.openDatabase({ size: 1024 * 1024 * 1024 + 1 }),
      /1 ГиБ/
    );
    assert.strictEqual(db.getDatabaseInfo().databaseUuid, uuid,
      'Invalid replacement file disconnected the active DB.');
    assert(db.runHealthCheck().ok);
  }
  console.log(
    'Real SQLite WASM UPSERT: OK; ' + initialCount + ' existing / ' + incomingCount +
    ' incoming / ' + overlapCount + ' updated / ' + preview.rowsInserted +
    ' inserted / ' + countBeforeFailure + ' final; SQLite ' + health.estimatedBytes +
    ' bytes; RSS ' + Math.round(process.memoryUsage().rss / 1024 / 1024) + ' MiB.'
  );
  db.closeDatabase();
}

main().catch(error => { console.error(error); process.exitCode = 1; });
