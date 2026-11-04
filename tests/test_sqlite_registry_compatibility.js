// Real SQLite/WASM regression for Dataset Registry ↔ current Dataset Catalog compatibility.
// Uses the built FULL HTML runtime and intentionally tampers only test databases.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const dist = path.resolve(process.env.RECLASSIFIER_HTML_DIR || path.join(root, 'dist'));
const outputs = fs.readdirSync(dist)
  .filter(name => /^Reclassifier_v.*_CORE\.html$/.test(name))
  .map(name => path.join(dist, name));
assert.strictEqual(outputs.length, 1, 'Expected one CORE HTML artifact.');

const html = fs.readFileSync(outputs[0], 'utf8');
const vendor = html.match(/<script id="sqliteVendorSource">([\s\S]*?)<\/script>/);
const wasm = html.match(/"sqliteWasmBase64": "([A-Za-z0-9+/=]+)"/);
assert(vendor && wasm, 'CORE HTML does not embed SQLite JS/WASM.');

vm.runInThisContext(vendor[1], { filename: 'sqlite-vendor.js' });
const originalSqliteInit = globalThis.sqlite3InitModule;
let sqliteRuntime = null;
globalThis.sqlite3InitModule = async options => {
  sqliteRuntime = await originalSqliteInit(options);
  return sqliteRuntime;
};

vm.runInThisContext(
  fs.readFileSync(path.join(root, 'src/js/app/dataset_catalog.js'), 'utf8'),
  { filename: 'dataset-catalog.js' }
);
vm.runInThisContext(
  fs.readFileSync(path.join(root, 'src/js/app/database_contract.js'), 'utf8'),
  { filename: 'database-contract.js' }
);
new Function(
  'assets', 'build', 'log',
  fs.readFileSync(path.join(root, 'src/js/app/database_core.js'), 'utf8')
)(
  { sqliteWasmBase64: wasm[1] },
  { version: 'registry-compat-test', sqliteVersion: '3.53.4' },
  () => {}
);

function mutateDatabaseFile(fileName, statements) {
  assert(sqliteRuntime?.oo1?.DB, 'SQLite runtime was not captured.');
  const raw = new sqliteRuntime.oo1.DB(fileName, 'w');
  try {
    raw.exec('PRAGMA foreign_keys=OFF;');
    for (const statement of statements) raw.exec(statement);
  } finally {
    raw.close();
  }
}

let candidateSequence = 0;
function tamperedCopy(bytes, statements) {
  candidateSequence += 1;
  const fileName = '/registry-compat-candidate-' + candidateSequence + '.db';
  sqliteRuntime.capi.sqlite3_js_posix_create_file(fileName, bytes);
  mutateDatabaseFile(fileName, statements);
  const raw = new sqliteRuntime.oo1.DB(fileName, 'r');
  try {
    const exported = sqliteRuntime.capi.sqlite3_js_db_export(raw);
    return Uint8Array.from(exported);
  } finally {
    raw.close();
    try { sqliteRuntime.capi.sqlite3_wasmfs_unlink?.(fileName); } catch (_) {}
  }
}

(async () => {
  const repository = globalThis.ReclassifierDatabaseRepository;
  await repository.createDatabase({
    fileName: 'registry-health.db',
    appVersion: 'registry-compat-test'
  });

  const cleanHealth = repository.runHealthCheck();
  assert.strictEqual(cleanHealth.ok, true);
  assert.strictEqual(cleanHealth.validation.registryContract.compatible, true);
  assert.deepStrictEqual(cleanHealth.registryContractMismatches, []);
  assert.deepStrictEqual(cleanHealth.missingRegistryDatasets, []);
  assert.deepStrictEqual(cleanHealth.unexpectedRegistryDatasets, []);

  // A schema-v2 database legitimately has no KPI Source registry row.
  // Opening it must migrate via v3 to v4 and add an empty KPI Source contract entry.
  const v4Bytes = repository.exportDatabase();
  const legacyV2Bytes = tamperedCopy(v4Bytes, [
    "DELETE FROM dataset_registry WHERE dataset_id='kpi_source'",
    "UPDATE dataset_registry SET dataset_schema_version='1.1.0' WHERE dataset_id='itsm_data'",
    "UPDATE app_metadata SET schema_version=2",
    "PRAGMA user_version=2"
  ]);
  await repository.openDatabase(legacyV2Bytes, { fileName: 'legacy-v2.db' });
  const migratedInfo = repository.getDatabaseInfo();
  assert.strictEqual(migratedInfo.schemaVersion, 5);
  const migratedKpi = repository.getDatasetRegistry('kpi_source');
  assert(migratedKpi, 'v2→v3 migration did not add KPI Source registry row.');
  assert.strictEqual(Number(migratedKpi.active_revision), 0);
  assert.strictEqual(Number(migratedKpi.record_count), 0);
  assert.strictEqual(repository.runHealthCheck().ok, true);

  // A populated DB v3 must extend historical ITSM rows without changing any
  // of their 51 original values, and mark the new MB relation as unknown.
  repository.closeDatabase();
  await repository.createDatabase({ fileName: 'populated-itsm-v3-fixture.db' });
  const oldItsmFields = Array.from({ length: 51 }, (_, i) => 'field-' + i);
  oldItsmFields[0] = 'createdAt';
  oldItsmFields[3] = 'number';
  oldItsmFields[50] = 'completedLast14Days';
  const storedItsmRow = Array(52).fill(null);
  storedItsmRow[0] = '2026-09-20';
  storedItsmRow[3] = 'INC-V3-MIGRATION';
  storedItsmRow[24] = 12.5;
  storedItsmRow[50] = 'нет';
  storedItsmRow[51] = 'Есть в МБ';
  repository.upsertDataset('itsm_data', [storedItsmRow], {
    state: { fields: oldItsmFields.concat('mbPresence'),
      columns: oldItsmFields.concat('Наличие заявки в МБ'),
      fieldCount: 52, schemaVersion: '1.2.0' }
  });
  const oldState = {
    fields: oldItsmFields,
    columns: oldItsmFields,
    fieldCount: 51,
    schemaVersion: '1.1.0'
  };
  const oldStateSql = "'" + JSON.stringify(oldState).replace(/'/g, "''") + "'";
  const schemaV3Bytes = tamperedCopy(repository.exportDatabase(), [
    "UPDATE dataset_records SET record_json = json_remove(record_json, '$[51]') " +
      "WHERE dataset_id='itsm_data'",
    "UPDATE dataset_state SET state_json=" + oldStateSql + " WHERE dataset_id='itsm_data'",
    "UPDATE dataset_registry SET dataset_schema_version='1.1.0' WHERE dataset_id='itsm_data'",
    "UPDATE app_metadata SET schema_version=3",
    "PRAGMA user_version=3"
  ]);
  await repository.openDatabase(schemaV3Bytes, { fileName: 'populated-itsm-v3.db' });
  assert.strictEqual(repository.getDatabaseInfo().schemaVersion, 5);
  const extended = repository.getDataset('itsm_data');
  assert.deepStrictEqual(extended.records[0].slice(0, 51), storedItsmRow.slice(0, 51));
  assert.strictEqual(extended.records[0][51], 'Нет данных МБ');
  assert.strictEqual(extended.state.fields[51], 'mbPresence');
  assert.strictEqual(extended.registry.dataset_schema_version, '1.2.0');
  assert.strictEqual(repository.runHealthCheck().ok, true);

  const active = repository.getDatabaseInfo();
  mutateDatabaseFile(active.internalFileName, [
    "UPDATE dataset_registry SET " +
      "kind='reference', " +
      "dataset_schema_version='9.9.9', " +
      "integration_strategy='REPLACE', " +
      "key_field='wrong-key', " +
      "allow_empty=1, " +
      "persisted=0 " +
      "WHERE dataset_id='itsm_data'",
    "DELETE FROM dataset_registry WHERE dataset_id='drivers'",
    "INSERT INTO dataset_registry (" +
      "dataset_id, title, kind, dataset_schema_version, integration_strategy, key_field, " +
      "allow_empty, persisted, active_revision, record_count, updated_at" +
      ") VALUES (" +
      "'future_dataset', 'Future Dataset', 'events', '1.0.0', 'REPLACE', NULL, " +
      "0, 1, 0, 0, '2026-10-01T00:00:00.000Z'" +
      ")"
  ]);

  const health = repository.runHealthCheck();
  assert.strictEqual(health.ok, false);
  assert.strictEqual(health.validation.registryContract.compatible, false);
  assert(health.missingRegistryDatasets.includes('drivers'),
    'Missing catalog Dataset was not reported.');
  assert(health.unexpectedRegistryDatasets.includes('future_dataset'),
    'Unexpected registry Dataset was not reported.');

  const itsmMismatches = health.registryContractMismatches
    .filter(item => item.datasetId === 'itsm_data');
  const mismatchFields = new Set(itsmMismatches.map(item => item.field));
  for (const field of [
    'kind',
    'dataset_schema_version',
    'integration_strategy',
    'key_field',
    'allow_empty',
    'persisted'
  ]) {
    assert(mismatchFields.has(field), 'Registry contract mismatch not reported: ' + field);
  }
  assert(health.errors.some(message =>
    message.includes('Dataset Registry несовместим с текущим Dataset Catalog')
  ));
  assert(health.errors.some(message =>
    message.includes('itsm_data.dataset_schema_version')
  ));

  // Recreate a clean active database. An incompatible replacement candidate
  // must fail before publication and must not close or replace this handle.
  repository.closeDatabase();
  await repository.createDatabase({
    fileName: 'active-clean.db',
    appVersion: 'registry-compat-test'
  });
  const activeBefore = repository.getDatabaseInfo();
  const validBytes = repository.exportDatabase();
  const incompatibleBytes = tamperedCopy(validBytes, [
    "UPDATE dataset_registry SET dataset_schema_version='0.9.0' WHERE dataset_id='customers'"
  ]);

  await assert.rejects(
    () => repository.openDatabase(incompatibleBytes, { fileName: 'incompatible.db' }),
    error => {
      assert(error.message.includes('Dataset Registry несовместим с текущим Dataset Catalog'));
      assert(error.message.includes('customers.dataset_schema_version'));
      return true;
    }
  );

  const activeAfter = repository.getDatabaseInfo();
  assert.strictEqual(activeAfter.databaseUuid, activeBefore.databaseUuid,
    'Failed compatibility validation replaced the active database.');
  assert.strictEqual(activeAfter.fileName, activeBefore.fileName,
    'Failed compatibility validation changed active database metadata.');
  assert.strictEqual(repository.runHealthCheck().ok, true,
    'Active database became unhealthy after rejected candidate.');

  console.log('SQLite Dataset Registry compatibility: health details + safe open rejection: OK');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
