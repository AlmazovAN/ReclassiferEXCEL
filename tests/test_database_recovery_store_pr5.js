// PR-5 recovery store: synthetic IndexedDB transactions, quota, atomic replace.
// No real corporate data, IndexedDB mocks represent origin storage only.
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const values = new Map();
const instances = { closes: 0, opens: 0, puts: 0 };
let availableQuota = 8 * 1024 * 1024;
function request(action, transaction) {
  const req = { result: undefined, error: null };
  setImmediate(() => {
    try {
      req.result = action();
      req.onsuccess?.();
      setImmediate(() => transaction?.oncomplete?.());
    } catch (e) {
      req.error = e;
      req.onerror?.();
      setImmediate(() => transaction?.onabort?.());
    }
  });
  return req;
}
const indexedDB = {
  open() {
    const requestObject = { result: null, error: null };
    const connection = {
      objectStoreNames: { contains: () => false },
      createObjectStore: () => {},
      close() { instances.closes++; },
      transaction(name, mode) {
        assert.equal(name, 'checkpoints');
        const tx = {
          objectStore() {
            return {
              put(value) {
                assert.equal(mode, 'readwrite');
                return request(() => {
                  values.set(value.key, value);
                  instances.puts++;
                  return value.key;
                }, tx);
              },
              get(key) { return request(() => values.get(key), tx); },
              delete(key) {
                assert.equal(mode, 'readwrite');
                return request(() => values.delete(key), tx);
              }
            };
          }
        };
        return tx;
      }
    };
    requestObject.result = connection;
    instances.opens++;
    setImmediate(() => {
      requestObject.onupgradeneeded?.();
      requestObject.onsuccess?.();
    });
    return requestObject;
  }
};

const sandbox = {
  indexedDB, Blob, Uint8Array, Date, Number, String, Promise,
  navigator: { storage: { estimate: async () => ({ quota: availableQuota, usage: 0 }) } },
  globalThis: null
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync('src/js/app/database_recovery_store.js', 'utf8'), sandbox);
const store = sandbox.ReclassifierSqliteRecoveryStore;
(async () => {
  assert.equal(await store.latest(), null);
  const bytes = new Uint8Array(1536);
  bytes.set(Buffer.from('SQLite format 3\0'));
  const meta = { databaseUuid: 'synthetic-uuid', fileName: 'synthetic.db', workingRevision: 5 };
  const saved = await store.save(bytes, meta);
  assert.equal(saved.size, 1536);
  assert.equal(saved.revision, 5);
  let checkpoint = await store.latest();
  assert.equal(checkpoint.fileName, 'synthetic.db');
  assert.equal(checkpoint.bytes.size, 1536);
  assert.equal(checkpoint.databaseUuid, 'synthetic-uuid');
  assert.equal(values.size, 1, 'only one rolling checkpoint allowed');

  bytes[400] = 42;
  await store.save(bytes, { ...meta, workingRevision: 6 });
  checkpoint = await store.latest();
  const actual = new Uint8Array(await checkpoint.bytes.arrayBuffer());
  assert.equal(actual[400], 42);
  assert.equal(checkpoint.revision, 6);
  assert.equal(values.size, 1);

  availableQuota = 100;
  await assert.rejects(() => store.save(bytes, meta), /недостаточно свободной квоты/);
  assert.equal((await store.latest()).revision, 6, 'quota failure must retain last valid snapshot');
  availableQuota = 8 * 1024 * 1024;
  values.set('latest', { ...checkpoint, size: checkpoint.size + 1 });
  await assert.rejects(() => store.latest(), /повреждена/);
  await store.remove();
  assert.equal(await store.latest(), null);
  assert.equal(instances.opens, instances.closes, 'every transaction must close IndexedDB');
  assert(instances.puts >= 2);
  console.log('PASS PR5 browser recovery checkpoint quota, replacement, corruption, deletion');
})().catch(error => { console.error(error); process.exitCode = 1; });
