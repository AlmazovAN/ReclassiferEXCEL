// PR-1: CORE-only SQLite accumulation and reopen regression.
// Uses the shipped CORE SQLite WASM bytes; never reads a corporate database.
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
// main auto-release builds override VERSION with the next free patch tag.
const version = process.env.RECLASSIFIER_VERSION || fs.readFileSync(path.join(root, 'VERSION'), 'utf8').trim();
const htmlPath = path.join(root, 'dist', 'Reclassifier_v' + version + '_CORE.html');
const html = fs.readFileSync(htmlPath, 'utf8');
const vendor = html.match(/<script id="sqliteVendorSource">([\s\S]*?)<\/script>/);
const wasm = html.match(/"sqliteWasmBase64": "([A-Za-z0-9+/=]+)"/);
assert(vendor && wasm, 'CORE must embed standalone SQLite WASM.');
vm.runInThisContext(vendor[1], { filename: 'sqlite-vendor.js' });
for (const name of ['src/js/app/dataset_catalog.js', 'src/js/app/database_contract.js']) {
  vm.runInThisContext(fs.readFileSync(path.join(root, name), 'utf8'), { filename: name });
}
new Function('assets', 'build', 'log',
  fs.readFileSync(path.join(root, 'src/js/app/database_core.js'), 'utf8')
)({ sqliteWasmBase64: wasm[1] },
  { version, sqliteVersion: '3.53.4' }, () => {});

const repository = globalThis.ReclassifierDatabaseRepository;
const id = 'mobile_brigade_data';
const state = { schemaVersion: '1.4.0' };
const first = [
  { recordKey: 'mine|task-1', request: 'INC-1', laborHours: 2, factDate: '2026-09-22' },
  { recordKey: 'mine|task-2', request: 'INC-2', laborHours: 3, factDate: '2026-09-23' }
];
const second = [
  { recordKey: 'mine|task-2', request: 'INC-2', laborHours: 5, factDate: '2026-10-13' },
  { recordKey: 'mine|task-3', request: 'INC-3', laborHours: 4, factDate: '2026-10-14' }
];
const snapshot = () => repository.getDataset(id).records
  .slice().sort((a, b) => a.recordKey.localeCompare(b.recordKey));
const verify = (expected, phase) => {
  assert.deepEqual(snapshot(), expected, phase + ': actual SQLite records');
  assert.equal(Number(repository.getDatasetRegistry(id).record_count), expected.length,
    phase + ': persisted registry count');
  const health = repository.runHealthCheck();
  assert.equal(health.ok, true, phase + ': ' + health.errors.join('; '));
};
async function main() {
  await repository.createDatabase({ fileName: 'core-accumulation.db', appVersion: version });
  assert.equal(repository.getDatabaseInfo().valid, true);

  const firstCommit = repository.upsertDataset(id, first, {
    state, freshnessFrom: '2026-09-22', freshnessTo: '2026-09-23'
  });
  assert.equal(firstCommit.rowsInserted, 2);
  const preview = repository.previewDatasetChange(id, second, {
    state, freshnessTo: '2026-10-14'
  });
  assert.equal(preview.rowsBefore, 2);
  assert.equal(preview.rowsInserted, 1);
  assert.equal(preview.rowsUpdated, 1);
  assert.equal(preview.rowsAfter, 3);
  const committed = repository.upsertDataset(id, second, {
    state, freshnessFrom: '2026-09-22', freshnessTo: '2026-10-14'
  });
  for (const key of ['rowsInserted', 'rowsUpdated', 'rowsAfter']) {
    assert.equal(committed[key], preview[key], 'Preview/COMMIT mismatch: ' + key);
  }
  const expected = [first[0], second[0], second[1]];
  verify(expected, 'after accumulated COMMIT');
  assert.equal(repository.getDatasetRegistry(id).freshness_to, '2026-10-14');

  const committedHistory = repository.getImportHistory(id, 20)
    .filter(row => row.status === 'COMMITTED').length;
  assert.equal(committedHistory, 2, 'Two source transactions must be auditable.');

  const diskImage = repository.exportDatabase();
  assert(diskImage.byteLength > 100, 'Export must contain SQLite bytes.');
  repository.closeDatabase();
  await repository.openDatabase(diskImage, { fileName: 'core-accumulation.db' });
  verify(expected, 'after exported DB reopen');
  assert.equal(repository.getDatasetRegistry(id).freshness_to, '2026-10-14');
  assert.equal(repository.getImportHistory(id, 20)
    .filter(row => row.status === 'COMMITTED').length, 2,
  'History must survive SQLite export/reopen.');

  const repeat = repository.upsertDataset(id, second, {
    state, freshnessFrom: '2026-09-22', freshnessTo: '2026-10-14'
  });
  assert.equal(repeat.rowsInserted, 0, 'Repeated import must not duplicate tasks.');
  assert.equal(repeat.rowsUpdated, 0, 'Repeated import must preserve unchanged tasks.');
  verify(expected, 'after idempotent repeat');

  const finalImage = repository.exportDatabase();
  repository.closeDatabase();
  await repository.openDatabase(finalImage, { fileName: 'core-accumulation.db' });
  verify(expected, 'after second export/reopen');
  repository.closeDatabase();
  console.log('PASS CORE SQLite accumulation: UPSERT, preview, metadata, history, export/reopen, idempotency');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
