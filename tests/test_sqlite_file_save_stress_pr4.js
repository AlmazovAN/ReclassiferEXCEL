// PR-4: synthetic multi-chunk persistence through real CORE SQLite WASM.
// No corporate data or filesystem writes; the writable handle models an OS file.
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
assert(vendor && wasm, 'CORE must contain SQLite WASM');
vm.runInThisContext(vendor[1], { filename: 'sqlite-vendor.js' });
for (const fragment of ['src/js/app/dataset_catalog.js', 'src/js/app/database_contract.js']) {
  vm.runInThisContext(fs.readFileSync(path.join(root, fragment), 'utf8'),
    { filename: fragment });
}
new Function('assets', 'build', 'log',
  fs.readFileSync(path.join(root, 'src/js/app/database_core.js'), 'utf8')
)({ sqliteWasmBase64: wasm[1] }, { version, sqliteVersion: '3.53.4' }, () => {});
const db = globalThis.ReclassifierDatabaseRepository;
const MiB = 1024 * 1024;
const CHUNK = 4 * MiB;

function syntheticHandle(name, original) {
  let disk = Uint8Array.from(original);
  let lastModified = 1700000000000;
  let mode = 'normal';
  let active = false;
  let writes = 0;
  let maxWritten = 0;
  let maxRead = 0;
  let readSlices = 0;
  let aborts = 0;
  return {
    name,
    get lastModified() { return lastModified; },
    get size() { return disk.length; },
    get disk() { return disk; },
    get stats() { return { writes, maxWritten, maxRead, readSlices, aborts }; },
    setMode(value) { mode = value; },
    async getFile() {
      const view = disk;
      const timestamp = lastModified;
      return {
        name, size: view.length, lastModified: timestamp,
        slice(start, end) {
          const length = end - start;
          maxRead = Math.max(maxRead, length);
          readSlices++;
          assert(length <= CHUNK, 'disk verification must use bounded reads');
          return new Blob([view.subarray(start, end)]);
        }
      };
    },
    async createWritable({ mode: kind }) {
      assert.equal(kind, 'exclusive');
      assert.equal(active, false, 'second stream must not open concurrently');
      active = true;
      const chunks = [];
      return {
        async write(chunk) {
          assert.throws(() => db.closeDatabase(),
            e => e.code === 'RECLASSIFIER_DATABASE_BUSY');
          maxWritten = Math.max(maxWritten, chunk.length);
          assert(chunk.length <= CHUNK, 'write must use bounded chunks');
          if (mode === 'write-failure' && chunks.length >= 1) {
            throw new Error('synthetic write failure');
          }
          chunks.push(Uint8Array.from(chunk));
          writes++;
        },
        async close() {
          const length = chunks.reduce((n, c) => n + c.length, 0);
          const output = new Uint8Array(length);
          let offset = 0;
          for (const chunk of chunks) { output.set(chunk, offset); offset += chunk.length; }
          if (mode === 'truncate') {
            disk = output.subarray(0, output.length - 13);
          } else {
            disk = output;
          }
          if (mode === 'corrupt') disk[Math.min(8192, disk.length - 1)] ^= 1;
          lastModified += 2000;
          active = false;
          if (mode === 'close-failure') throw new Error('synthetic ambiguous close');
        },
        async abort() { aborts++; active = false; }
      };
    }
  };
}
function smallRecord(key) {
  return { recordKey: key, request: 'INC-' + key, factDate: '2026-10-15',
    laborHours: 1 };
}
async function main() {
  await db.createDatabase({ fileName: 'stress.db', appVersion: version });
  db.upsertDataset('mobile_brigade_data', [smallRecord('seed')],
    { state: { schemaVersion: '1.4.0' } });
  const original = db.exportDatabase();
  const file = syntheticHandle('stress.db', original);
  const expected = () => ({ size: file.size, lastModified: file.lastModified });

  // Build actual SQLite pages with non-confidential repetitive test strings.
  const payload = 'STRESS-' + 'x'.repeat(4096);
  const records = Array.from({ length: 6200 }, (_, i) => ({
    ...smallRecord('large-' + i), notes: payload + '-' + i
  }));
  db.upsertDataset('mobile_brigade_data', records,
    { state: { schemaVersion: '1.4.0' } });
  const phases = [];
  const progressEvents = [];
  let mostRss = process.memoryUsage().rss;
  const sample = setInterval(() => {
    mostRss = Math.max(mostRss, process.memoryUsage().rss);
  }, 25);
  const start = performance.now();
  let saved;
  try {
    saved = await db.saveDatabaseToFile(file, expected(), {
      onProgress(p) {
        phases.push(p.phase);
        progressEvents.push(p);
      }
    });
  } finally { clearInterval(sample); }
  const elapsedMs = performance.now() - start;
  assert(saved.size >= 20 * MiB, 'stress fixture must produce a multi-chunk SQLite');
  assert(saved.verifiedBytes === saved.size);
  assert(saved.timing.exportMs >= 0 && saved.timing.writeMs >= 0 &&
    saved.timing.verifyMs >= 0 && saved.timing.totalMs >= 0);
  assert(phases.includes('exporting') && phases.includes('writing') &&
    phases.includes('verifying') && phases.at(-1) === 'complete');
  const previous = {};
  for (const event of progressEvents) {
    assert(Object.isFrozen(event), 'progress snapshot must be immutable');
    if (!event.totalBytes) continue;
    assert(event.completedBytes >= (previous[event.phase] || 0),
      'progress must be monotonic inside a stage');
    assert(event.completedBytes <= event.totalBytes);
    previous[event.phase] = event.completedBytes;
  }
  assert.equal(previous.writing, saved.size);
  assert.equal(previous.verifying, saved.size);
  assert(file.stats.writes >= 6 && file.stats.readSlices >= 6);
  assert(file.stats.maxWritten <= CHUNK && file.stats.maxRead <= CHUNK);
  assert.equal(db.getDatabaseInfo().dirty, false);
  assert.equal(db.getDatabaseInfo().storage.diskCurrent, true);
  let baseline = expected();

  // Error *before* close: abort preserves previously verified disk revision.
  db.upsertDataset('mobile_brigade_data', [smallRecord('new-1')]);
  const verifiedBeforeWriteFailure = db.getDatabaseInfo().storage.confirmedFileRevision;
  const intact = Uint8Array.from(file.disk);
  file.setMode('write-failure');
  await assert.rejects(() => db.saveDatabaseToFile(file, baseline),
    /synthetic write failure/);
  assert.deepEqual(file.disk, intact);
  assert(file.stats.aborts > 0);
  assert.equal(db.getDatabaseInfo().storage.confirmedFileRevision, verifiedBeforeWriteFailure);
  assert.equal(db.getDatabaseInfo().dirty, true);

  // Recover safely and then simulate *after-close* disk corruption.
  file.setMode('normal');
  saved = await db.saveDatabaseToFile(file, baseline);
  assert.equal(db.getDatabaseInfo().storage.diskCurrent, true);
  baseline = expected();
  db.upsertDataset('mobile_brigade_data', [smallRecord('new-2')]);
  file.setMode('corrupt');
  await assert.rejects(() => db.saveDatabaseToFile(file, baseline),
    /несовпадение байтов/);
  assert.equal(db.getDatabaseInfo().dirty, true);
  assert.equal(db.getDatabaseInfo().storage.confirmedFileRevision, null,
    'ambiguous on-disk bytes invalidate prior confirmed disk state');
  // An attempted retry using stale metadata must refuse to overwrite.
  await assert.rejects(() => db.saveDatabaseToFile(file, baseline),
    /изменился после подключения/);

  // Reconcile expected metadata; application SQLite remains the source.
  file.setMode('normal');
  saved = await db.saveDatabaseToFile(file, expected());
  assert.equal(db.getDatabaseInfo().storage.diskCurrent, true);
  baseline = expected();
  db.upsertDataset('mobile_brigade_data', [smallRecord('new-3')]);
  file.setMode('truncate');
  await assert.rejects(() => db.saveDatabaseToFile(file, baseline),
    /Размер сохранённого файла не совпадает/);
  assert.equal(db.getDatabaseInfo().storage.confirmedFileRevision, null);
  assert.equal(db.getDatabaseInfo().dirty, true);

  file.setMode('normal');
  saved = await db.saveDatabaseToFile(file, expected());
  baseline = expected();
  db.upsertDataset('mobile_brigade_data', [smallRecord('new-4')]);
  file.setMode('close-failure');
  await assert.rejects(() => db.saveDatabaseToFile(file, baseline),
    /synthetic ambiguous close/);
  assert.equal(db.getDatabaseInfo().storage.confirmedFileRevision, null);
  assert.equal(db.getDatabaseInfo().dirty, true);
  db.closeDatabase();
  console.log('PASS PR4 SQLite ' + (saved.size / MiB).toFixed(1) +
    ' MiB multi-chunk save, corruption/truncation/close/write failures; ' +
    'first save ' + elapsedMs.toFixed(0) + 'ms; sampled RSS ' +
    (mostRss / MiB).toFixed(1) + ' MiB (indicative, not true peak)');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
