// PR: direct persistence into a user-authorized FileSystemFileHandle.
// Tests real CORE SQLite WASM and a writable OS handle double, without disk/corporate data.
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const version = process.env.RECLASSIFIER_VERSION ||
  fs.readFileSync(path.join(root, 'VERSION'), 'utf8').trim();
const html = fs.readFileSync(
  path.join(root, 'dist', 'Reclassifier_v' + version + '_CORE.html'), 'utf8');
const vendor = html.match(/<script id="sqliteVendorSource">([\s\S]*?)<\/script>/);
const wasm = html.match(/"sqliteWasmBase64": "([A-Za-z0-9+/=]+)"/);
assert(vendor && wasm, 'CORE must ship SQLite WASM');
vm.runInThisContext(vendor[1], { filename: 'sqlite-vendor.js' });
for (const fragment of ['src/js/app/dataset_catalog.js','src/js/app/database_contract.js']) {
  vm.runInThisContext(fs.readFileSync(path.join(root, fragment), 'utf8'),
    { filename: fragment });
}
new Function('assets', 'build', 'log',
  fs.readFileSync(path.join(root, 'src/js/app/database_core.js'), 'utf8')
)({ sqliteWasmBase64: wasm[1] }, { version, sqliteVersion: '3.53.4' }, () => {});
const db = globalThis.ReclassifierDatabaseRepository;
const datasetId = 'mobile_brigade_data';
const state = { schemaVersion: '1.4.0' };

function writableHandle(name, initialBytes) {
  let disk = Uint8Array.from(initialBytes);
  let lastModified = 1700000000000;
  let failWrite = false;
  let aborted = false;
  let inWrite = false;
  return {
    name,
    get aborted() { return aborted; },
    get disk() { return disk; },
    get lastModified() { return lastModified; },
    setFailWrite(value) { failWrite = value; },
    externallyModify() { lastModified += 1000; },
    async getFile() {
      const blob = new Blob([disk]);
      Object.defineProperty(blob, 'name', { value: name });
      Object.defineProperty(blob, 'lastModified', { value: lastModified });
      return blob;
    },
    async createWritable(options) {
      assert.equal(options.mode, 'exclusive');
      assert.equal(inWrite, false);
      inWrite = true;
      const chunks = [];
      return {
        async write(chunk) {
          assert.throws(() => db.getDatabaseInfo(),
            error => error.code === 'RECLASSIFIER_DATABASE_BUSY',
            'save mutex must prevent interleaved SQLite reads/writes');
          if (failWrite) throw new Error('simulated OS write failure');
          chunks.push(Uint8Array.from(chunk));
        },
        async close() {
          const length = chunks.reduce((sum, row) => sum + row.length, 0);
          const replacement = new Uint8Array(length);
          let offset = 0;
          for (const chunk of chunks) { replacement.set(chunk, offset); offset += chunk.length; }
          disk = replacement;
          lastModified += 2000;
          inWrite = false;
        },
        async abort() { aborted = true; inWrite = false; }
      };
    }
  };
}
function record(key, hours) {
  return { recordKey: key, request: 'INC-' + key, laborHours: hours,
    factDate: '2026-10-15' };
}
async function main() {
  await db.createDatabase({ fileName: 'connected.db', appVersion: version });
  db.upsertDataset(datasetId, [record('A', 1)], { state });
  const createdInfo = db.getDatabaseInfo();
  assert.equal(createdInfo.dirty, true);
  assert.equal(createdInfo.storage.workingRevision, 2);
  assert.equal(createdInfo.storage.confirmedFileRevision, null);
  assert.equal(createdInfo.storage.diskCurrent, false);
  const original = db.exportDatabase();
  const file = writableHandle('connected.db', original);
  const initial = { size: original.byteLength, lastModified: file.lastModified };
  db.upsertDataset(datasetId, [record('A', 2), record('B', 3)], { state });
  const pendingInfo = db.getDatabaseInfo();
  assert.equal(pendingInfo.dirty, true);
  assert.equal(pendingInfo.storage.workingRevision, 3);
  let saved = await db.saveDatabaseToFile(file, initial);
  assert.equal(saved.size, file.disk.length);
  assert.equal(saved.verifiedBytes, saved.size);
  const savedInfo = db.getDatabaseInfo();
  assert.equal(savedInfo.dirty, false, 'verified save should clear dirty');
  assert.equal(saved.verifiedRevision, 3);
  assert.equal(savedInfo.storage.confirmedFileRevision, 3);
  assert.equal(savedInfo.storage.confirmedFileAt, saved.verifiedAt);
  assert.equal(savedInfo.storage.diskCurrent, true);
  const savedCopy = Uint8Array.from(file.disk);

  // User continues to import and saves a new revision to the SAME disk path.
  db.upsertDataset(datasetId, [record('C', 4)], { state });
  const afterNewCommit = db.getDatabaseInfo();
  assert.equal(afterNewCommit.storage.workingRevision, 4);
  assert.equal(afterNewCommit.storage.confirmedFileRevision, 3);
  assert.equal(afterNewCommit.storage.diskCurrent, false);
  saved = await db.saveDatabaseToFile(file,
    { size: saved.size, lastModified: saved.lastModified });
  assert.equal(db.getDatabaseInfo().dirty, false);
  assert.equal(db.getDatabaseInfo().storage.confirmedFileRevision, 4);
  const reopened = Uint8Array.from(file.disk);
  db.closeDatabase();
  await db.openDatabase(reopened, { fileName: 'connected.db' });
  const reopenedInfo = db.getDatabaseInfo();
  assert.equal(reopenedInfo.dirty, false);
  assert.equal(reopenedInfo.storage.workingRevision, 0);
  assert.equal(reopenedInfo.storage.confirmedFileRevision, null,
    'reopening a file is not a verified file-write operation');
  assert.equal(reopenedInfo.storage.diskCurrent, false);
  assert.equal(db.getDataset(datasetId).records.length, 3);
  assert.equal(db.getDataset(datasetId).records.find(r => r.recordKey === 'A').laborHours, 2);

  // Detect OS-side edit and refuse an overwrite even when size is the same.
  db.upsertDataset(datasetId, [record('D', 5)], { state });
  file.externallyModify();
  await assert.rejects(() => db.saveDatabaseToFile(file, {
    size: saved.size, lastModified: saved.lastModified
  }), /изменился после подключения/);
  assert.equal(db.getDatabaseInfo().dirty, true);
  assert.equal(db.getDatabaseInfo().storage.workingRevision, 1);
  assert.equal(db.getDatabaseInfo().storage.confirmedFileRevision, null);
  assert.deepEqual(file.disk, reopened, 'conflict must not overwrite OS file');

  // A failed temporary-file write aborts and retains the original disk bytes.
  const current = { size: file.disk.length, lastModified: file.lastModified };
  file.setFailWrite(true);
  await assert.rejects(() => db.saveDatabaseToFile(file, current),
    /simulated OS write failure/);
  assert.equal(file.aborted, true);
  assert.equal(db.getDatabaseInfo().dirty, true);
  assert.equal(db.getDatabaseInfo().storage.confirmedFileRevision, null);
  assert.deepEqual(file.disk, reopened, 'failed save must not replace disk bytes');

  // Download a separate OS copy via browser: a click is never a verified save,
  // and must not dismiss the unsaved-changes warning for the connected file.
  const beforeDownload = db.getDatabaseInfo().storage;
  const previousDocument = globalThis.document;
  const createObjectURL = URL.createObjectURL;
  const revokeObjectURL = URL.revokeObjectURL;
  let downloadClicks = 0;
  try {
    URL.createObjectURL = () => 'blob:synthetic-backup';
    URL.revokeObjectURL = () => {};
    globalThis.document = {
      createElement: () => ({
        click: () => { downloadClicks += 1; },
        remove: () => {}
      }),
      body: { appendChild: () => {} }
    };
    const count = db.downloadDatabase('separate-copy.db');
    assert(count > 100);
    assert.equal(downloadClicks, 1);
    const afterDownload = db.getDatabaseInfo();
    assert.equal(afterDownload.storage.downloadRequestedRevision,
      beforeDownload.workingRevision);
    assert(afterDownload.storage.downloadRequestedAt);
    assert.equal(afterDownload.storage.confirmedFileRevision, null);
    assert.equal(afterDownload.storage.diskCurrent, false);
    assert.equal(afterDownload.dirty, true);
    assert.deepEqual(file.disk, reopened, 'copy request does not write original file');
  } finally {
    globalThis.document = previousDocument;
    URL.createObjectURL = createObjectURL;
    URL.revokeObjectURL = revokeObjectURL;
  }
  db.closeDatabase();
  assert(savedCopy.byteLength > 100);
  // Browser recovery must not be mistaken for a verified disk save, even when
  // the snapshot bytes are internally valid.
  await db.openDatabase(savedCopy, { fileName: 'connected.db', recovered: true });
  const restored = db.getDatabaseInfo();
  assert.equal(restored.dirty, true);
  assert.equal(restored.storage.workingRevision, 1);
  assert.equal(restored.storage.confirmedFileRevision, null);
  assert.equal(restored.storage.diskCurrent, false);
  assert.equal(db.getDataset(datasetId).records.length, 2);
  db.closeDatabase();
  console.log('PASS CORE storage revisions, direct disk save, reopen, recovery dirty state, conflict and abort');
}
main().catch(e => { console.error(e); process.exitCode = 1; });
