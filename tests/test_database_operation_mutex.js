const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const context = vm.createContext({
  console,
  Uint8Array,
  ArrayBuffer,
  Blob,
  Date,
  Math,
  JSON,
  Map,
  Set,
  Object,
  String,
  Number,
  Error,
  Promise,
  WebAssembly,
  setTimeout,
  clearTimeout,
  atob,
  globalThis: null
});
context.globalThis = context;
context.assets = {
  sqliteWasmBase64: Buffer.from([0, 97, 115, 109, 1, 0, 0, 0]).toString('base64')
};
context.build = { version: 'test', sqliteVersion: '3.53.4' };
context.log = () => {};
context.crypto = { randomUUID: () => '00000000-0000-4000-8000-000000000000' };

vm.runInContext(read('src/js/app/dataset_catalog.js'), context, { filename: 'dataset_catalog.js' });
vm.runInContext(read('src/js/app/database_contract.js'), context, { filename: 'database_contract.js' });
vm.runInContext(read('src/js/app/database_core.js'), context, { filename: 'database_core.js' });

const repository = context.ReclassifierDatabaseRepository;
assert.equal(typeof repository.getOperationState, 'function');
assert.deepEqual(
  JSON.parse(JSON.stringify(repository.getOperationState())),
  { busy: false, name: null, startedAt: null, sequence: null }
);

let rejectHeader;
class SlowBlob extends Blob {
  slice() {
    return {
      arrayBuffer() {
        return new Promise((resolve, reject) => {
          rejectHeader = reject;
        });
      }
    };
  }
}

(async () => {
  const slow = new SlowBlob([new Uint8Array(128)]);
  const first = repository.openDatabase(slow, { fileName: 'slow.db' });

  const active = repository.getOperationState();
  assert.equal(active.busy, true);
  assert.equal(active.name, 'openDatabase');
  assert.equal(typeof active.startedAt, 'string');
  assert.equal(active.sequence, 1);

  assert.throws(
    () => repository.closeDatabase(),
    error => error?.code === 'RECLASSIFIER_DATABASE_BUSY' &&
      error?.activeOperation === 'openDatabase' &&
      error?.requestedOperation === 'closeDatabase'
  );
  assert.throws(
    () => repository.getDatabaseInfo(),
    error => error?.code === 'RECLASSIFIER_DATABASE_BUSY' &&
      error?.requestedOperation === 'getDatabaseInfo'
  );

  const concurrent = repository.openDatabase(slow, { fileName: 'second.db' })
    .then(
      () => null,
      error => error
    );
  const concurrentError = await concurrent;
  assert.equal(concurrentError?.code, 'RECLASSIFIER_DATABASE_BUSY');
  assert.equal(concurrentError?.activeOperation, 'openDatabase');
  assert.equal(concurrentError?.requestedOperation, 'openDatabase');

  assert.equal(repository.hasOpenDatabase(), false,
    'Lock-free handle-state introspection must remain available while busy.');

  rejectHeader(new Error('Synthetic header stop'));
  await assert.rejects(first, /Synthetic header stop/);

  const idle = repository.getOperationState();
  assert.equal(idle.busy, false);
  assert.equal(idle.name, null);

  // Release must happen in finally even after failure; a later sync operation
  // must not inherit a stale busy state.
  repository.closeDatabase();
  assert.equal(repository.getOperationState().busy, false);

  console.log('SQLite Repository operation mutex: fail-fast concurrency and release: OK');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
