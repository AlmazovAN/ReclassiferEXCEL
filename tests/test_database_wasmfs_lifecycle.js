// Step 10: real SQLite/WASM VFS lifecycle regression.
// The Repository must not leak obsolete internal /reclassifier-N.db files across
// successful replacement, rejected candidates or final close.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const dist = path.resolve(process.env.RECLASSIFIER_HTML_DIR || path.join(root, 'dist'));
const outputs = fs.readdirSync(dist)
  .filter(name => /^Reclassifier_v.*_CORE\.html$/.test(name));
assert.equal(outputs.length, 1, 'Exactly one CORE HTML artifact is required.');

const html = fs.readFileSync(path.join(dist, outputs[0]), 'utf8');
const vendor = html.match(/<script id="sqliteVendorSource">([\s\S]*?)<\/script>/);
const wasm = html.match(/"sqliteWasmBase64": "([A-Za-z0-9+/=]+)"/);
assert(vendor && wasm, 'FULL HTML must embed SQLite JS/WASM.');

vm.runInThisContext(vendor[1], { filename: 'sqlite-vendor.js' });
const originalInit = globalThis.sqlite3InitModule;
let sqliteRuntime = null;
globalThis.sqlite3InitModule = async options => {
  sqliteRuntime = await originalInit(options);
  return sqliteRuntime;
};

vm.runInThisContext(
  fs.readFileSync(path.join(root, 'src/js/app/dataset_catalog.js'), 'utf8'),
  { filename: 'dataset_catalog.js' }
);
vm.runInThisContext(
  fs.readFileSync(path.join(root, 'src/js/app/database_contract.js'), 'utf8'),
  { filename: 'database_contract.js' }
);
new Function(
  'assets',
  'build',
  'log',
  fs.readFileSync(path.join(root, 'src/js/app/database_core.js'), 'utf8')
)(
  { sqliteWasmBase64: wasm[1] },
  { version: 'step10-wasmfs', sqliteVersion: '3.53.4' },
  () => {}
);

function databaseVfs(db) {
  const fn = sqliteRuntime.capi?.sqlite3_js_db_vfs;
  assert.equal(typeof fn, 'function', 'Bundled SQLite is missing sqlite3_js_db_vfs.');
  return db?.pointer ? (fn(db.pointer, 0) || 0) : 0;
}

function unlinkScratchFile(fileName, pVfs = 0) {
  const unlink = sqliteRuntime.wasm?.exports?.sqlite3__wasm_vfs_unlink;
  assert.equal(typeof unlink, 'function', 'Bundled SQLite is missing raw sqlite3__wasm_vfs_unlink.');
  const pFilename = sqliteRuntime.wasm.allocCString(fileName);
  try {
    return Number(unlink(pVfs || 0, pFilename)) === 0;
  } finally {
    sqliteRuntime.wasm.dealloc(pFilename);
  }
}

function canOpenReadOnly(fileName) {
  let raw = null;
  try {
    raw = new sqliteRuntime.oo1.DB(fileName, 'r');
    raw.exec('SELECT count(*) FROM sqlite_master');
    return true;
  } catch (_) {
    return false;
  } finally {
    try { raw?.close(); } catch (_) {}
  }
}

function incompatibleCopy(bytes) {
  const tempName = '/step10-incompatible-source.db';
  sqliteRuntime.capi.sqlite3_js_posix_create_file(tempName, bytes);
  const raw = new sqliteRuntime.oo1.DB(tempName, 'w');
  let pVfs = 0;
  try {
    raw.exec(
      "UPDATE dataset_registry " +
      "SET dataset_schema_version='0.0.0' " +
      "WHERE dataset_id='drivers'"
    );
    const exported = sqliteRuntime.capi.sqlite3_js_db_export(raw);
    return Uint8Array.from(exported);
  } finally {
    pVfs = databaseVfs(raw);
    raw.close();
    assert(
      unlinkScratchFile(tempName, pVfs),
      'Unable to remove parity scratch DB from SQLite VFS.'
    );
  }
}

function nextInternalFileName(current) {
  const match = String(current).match(/^\/reclassifier-(\d+)\.db$/);
  assert(match, 'Unexpected Repository internal filename: ' + current);
  return '/reclassifier-' + (Number(match[1]) + 1) + '.db';
}

(async () => {
  const repository = globalThis.ReclassifierDatabaseRepository;

  await repository.createDatabase({
    fileName: 'first.db',
    appVersion: 'step10-wasmfs'
  });
  const first = repository.getDatabaseInfo();
  assert(canOpenReadOnly(first.internalFileName), 'First internal DB file is not readable.');
  const firstBytes = repository.exportDatabase();

  await repository.openDatabase(firstBytes, { fileName: 'replacement.db' });
  const second = repository.getDatabaseInfo();
  assert.notEqual(second.internalFileName, first.internalFileName);
  assert.equal(
    canOpenReadOnly(first.internalFileName),
    false,
    'Successful openDatabase leaked the previous SQLite VFS file.'
  );
  assert(canOpenReadOnly(second.internalFileName), 'Replacement DB file is not readable.');

  await repository.createDatabase({
    fileName: 'third.db',
    appVersion: 'step10-wasmfs'
  });
  const third = repository.getDatabaseInfo();
  assert.notEqual(third.internalFileName, second.internalFileName);
  assert.equal(
    canOpenReadOnly(second.internalFileName),
    false,
    'Successful createDatabase leaked the previous SQLite VFS file.'
  );
  assert(canOpenReadOnly(third.internalFileName), 'Newly created DB file is not readable.');

  const incompatible = incompatibleCopy(repository.exportDatabase());
  const rejectedCandidate = nextInternalFileName(third.internalFileName);
  await assert.rejects(
    () => repository.openDatabase(incompatible, { fileName: 'incompatible.db' }),
    /Dataset Registry несовместим/
  );
  const afterRejected = repository.getDatabaseInfo();
  assert.equal(
    afterRejected.internalFileName,
    third.internalFileName,
    'Rejected candidate replaced the active DB.'
  );
  assert(
    canOpenReadOnly(third.internalFileName),
    'Rejected candidate damaged or removed the active DB file.'
  );
  assert.equal(
    canOpenReadOnly(rejectedCandidate),
    false,
    'Rejected replacement candidate leaked a SQLite VFS file.'
  );

  const activeFile = third.internalFileName;
  repository.closeDatabase();
  assert.equal(repository.hasOpenDatabase(), false);
  assert.equal(
    canOpenReadOnly(activeFile),
    false,
    'closeDatabase leaked the final SQLite VFS file.'
  );

  console.log(
    'SQLite WASM VFS lifecycle: replace/create/rejected-candidate/close cleanup: OK'
  );
})().catch(error => {
  try { globalThis.ReclassifierDatabaseRepository?.closeDatabase?.(); } catch (_) {}
  console.error(error);
  process.exitCode = 1;
});
