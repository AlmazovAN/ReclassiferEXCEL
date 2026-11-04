const fs = require('fs');
const path = require('path');
const vm = require('vm');

const catalogSource = fs.readFileSync(
  path.join(__dirname, '..', 'src', 'js', 'app', 'dataset_catalog.js'),
  'utf8'
);
const contractSource = fs.readFileSync(
  path.join(__dirname, '..', 'src', 'js', 'app', 'database_contract.js'),
  'utf8'
);
const coreSource = fs.readFileSync(
  path.join(__dirname, '..', 'src', 'js', 'app', 'database_core.js'),
  'utf8'
);

const logs = [];
let receivedWasm = null;
const context = {
  console,
  Uint8Array,
  ArrayBuffer,
  Blob,
  TextDecoder,
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
  WebAssembly: {
    instantiate: async (bytes, imports) => {
      receivedWasm = bytes;
      return { instance: { exports: {} }, module: { imports } };
    }
  },
  setTimeout,
  clearTimeout,
  atob,
  globalThis: null
};
context.globalThis = context;
context.assets = {
  sqliteWasmBase64: Buffer.from([0, 97, 115, 109, 1, 0, 0, 0]).toString('base64')
};
context.build = { version: 'test', sqliteVersion: '3.53.4' };
context.log = (message, level = 'INFO') => logs.push({ message, level });
context.crypto = { randomUUID: () => '00000000-0000-4000-8000-000000000000' };
context.sqlite3InitModule = async options => {
  if (typeof options.instantiateWasm !== 'function') {
    throw new Error('Offline instantiateWasm callback is missing.');
  }
  let successCalled = false;
  options.instantiateWasm({}, () => { successCalled = true; });
  await Promise.resolve();
  if (!successCalled) throw new Error('Offline instantiateWasm did not call onSuccess.');
  return {
    version: { libVersion: '3.53.4' },
    oo1: { DB: class FakeDb {} },
    capi: {
      sqlite3_js_posix_create_file() {},
      sqlite3_js_db_export() { return new Uint8Array(); }
    }
  };
};

vm.createContext(context);
vm.runInContext(catalogSource, context, { filename: 'dataset_catalog.js' });
vm.runInContext(contractSource, context);
vm.runInContext(coreSource, context);

const repository = context.ReclassifierDatabaseRepository;
if (!repository) throw new Error('SQLite Repository is not exported.');

for (const method of context.ReclassifierDatabaseContract.repositoryApi) {
  if (typeof repository[method] !== 'function') {
    throw new Error('Repository method missing: ' + method);
  }
}

if (typeof repository.initialize !== 'function') throw new Error('initialize() is missing.');
if (typeof repository.downloadDatabase !== 'function') throw new Error('downloadDatabase() is missing.');
if (typeof repository.runHealthCheck !== 'function') throw new Error('runHealthCheck() is missing.');
if (repository.hasOpenDatabase() !== false) {
  throw new Error('SQLite handle must be closed before the first database is created.');
}

repository.initialize().then(sqlite => {
  if (sqlite.version.libVersion !== '3.53.4') throw new Error('Unexpected SQLite version.');
  if (!(receivedWasm instanceof Uint8Array)) throw new Error('Embedded WASM was not decoded.');
  if (receivedWasm.length !== 8 || receivedWasm[1] !== 97 || receivedWasm[2] !== 115 || receivedWasm[3] !== 109) {
    throw new Error('Embedded WASM bytes are incorrect.');
  }
  if (!logs.some(item => item.message.includes('SQLite WASM готов'))) {
    throw new Error('SQLite initialization was not logged.');
  }
  const disabledVfs = context.sqlite3ApiConfig?.disable?.vfs || {};
  for (const name of ['kvvfs', 'opfs', 'opfs-sahpool', 'opfs-wl']) {
    if (disabledVfs[name] !== true) throw new Error('External VFS was not disabled: ' + name);
  }
  console.log('SQLite repository core contract: OK');
}).catch(error => {
  console.error(error);
  process.exitCode = 1;
});
