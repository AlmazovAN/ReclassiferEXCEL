const fs = require('fs');
const path = require('path');
const vm = require('vm');

const catalogSource = fs.readFileSync(
  path.join(__dirname, '..', 'src', 'js', 'app', 'dataset_catalog.js'),
  'utf8'
);
const source = fs.readFileSync(
  path.join(__dirname, '..', 'src', 'js', 'app', 'database_contract.js'),
  'utf8'
);

const context = { globalThis: {} };
vm.createContext(context);
vm.runInContext(catalogSource, context);
vm.runInContext(source, context);

const catalog = context.globalThis.ReclassifierDatasetCatalog;
const contract = context.globalThis.ReclassifierDatabaseContract;
if (!catalog) throw new Error('Dataset Catalog is not exported.');
if (!contract) throw new Error('Database contract is not exported.');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

assert(contract.applicationId === 0x52434c46, 'Unexpected SQLite application_id.');
assert(contract.databaseType === 'reclassifier-sqlite', 'Unexpected database type.');
assert(contract.currentSchemaVersion === 5, 'Current SQLite schema must be version 5.');
assert(contract.minSupportedSchemaVersion === 1, 'Initial minimum supported schema must be 1.');

for (const table of [
  'app_metadata',
  'dataset_registry',
  'dataset_records',
  'dataset_state',
  'import_history',
  'schema_migrations'
]) {
  assert(contract.systemTablesV1.includes(table), 'Missing Schema 1 system table: ' + table);
  assert(contract.schemaV1Sql.includes('CREATE TABLE IF NOT EXISTS ' + table), 'Schema 1 DDL missing table: ' + table);
}
assert(contract.systemTables.includes('dataset_full_records'),
  'Schema 2 must include dataset_full_records.');
assert(contract.schemaV2Sql.includes('CREATE TABLE IF NOT EXISTS dataset_full_records'),
  'Schema 2 DDL missing dataset_full_records.');
assert(contract.migration1To2Sql.includes('PRAGMA user_version = 2'),
  'Schema 1 to 2 migration must update user_version.');
assert(contract.schemaV3Sql.includes('PRAGMA user_version = 3'),
  'Schema 3 DDL must update user_version.');
assert(contract.schemaV4Sql.includes('PRAGMA user_version = 4'), 'Schema 4 DDL must update user_version.');
assert(contract.migration3To4Sql.includes('PRAGMA user_version = 4'), 'Schema 3 to 4 migration must update user_version.');
assert(contract.schemaV5Sql.includes('CREATE TABLE IF NOT EXISTS kpi_snapshots'),
  'Schema 5 must include isolated Report Snapshot cache.');
assert(contract.schemaV5Sql.includes('PRAGMA user_version = 5'),
  'Schema 5 must set user_version=5.');
assert(contract.migration4To5Sql.includes('PRAGMA user_version = 5'),
  'Schema 4 to 5 migration must update user_version.');
assert(contract.systemTablesV4.includes('dataset_full_records') &&
  !contract.systemTablesV4.includes('kpi_snapshots'), 'Schema V4 table set drift.');
assert(contract.systemTables.includes('kpi_snapshots'),
  'Schema V5 must declare KPI snapshot table.');
for (const method of ['getKpiSnapshot','putKpiSnapshot','getKpiSnapshotStats']) {
  assert(contract.repositoryApi.includes(method), 'Missing cache Repository API: ' + method);
}
assert(contract.migration2To3Sql.includes('PRAGMA user_version = 3'),
  'Schema 2 to 3 migration must update user_version.');


for (const definition of catalog.list()) {
  const stored = contract.datasets[definition.id];
  assert(stored, 'Database Contract missing catalog Dataset: ' + definition.id);
  for (const field of ['kind', 'schemaVersion', 'strategy', 'persisted', 'allowEmpty', 'keyField', 'partitionField']) {
    assert(stored[field] === definition[field], field + ' drift for ' + definition.id);
  }
}

const itsm = contract.datasets.itsm_data;
assert(itsm.strategy === 'UPSERT', 'ITSM must use UPSERT.');
assert(itsm.keyField === 'number', 'ITSM UPSERT key must be number.');
assert(itsm.schemaVersion === '1.2.0', 'ITSM Dataset schema version drift.');

const kpi = contract.datasets.kpi_source;
assert(kpi.strategy === 'REPLACE', 'KPI Source must use REPLACE.');
assert(kpi.persisted === true, 'KPI Source must be persisted.');
assert(kpi.schemaVersion === '1.0.0', 'KPI Source schema version drift.');

const mb = contract.datasets.mobile_brigade_data;
assert(mb.strategy === 'UPSERT', 'Mobile Brigade must use UPSERT.');
assert(mb.keyField === 'recordKey', 'Mobile Brigade UPSERT key must be recordKey.');
assert(mb.schemaVersion === '1.5.0', 'Mobile Brigade Dataset schema version drift.');

for (const [id, definition] of Object.entries(contract.datasets)) {
  if (definition.strategy === 'UPSERT') {
    assert(definition.keyField, 'UPSERT Dataset requires keyField: ' + id);
  }
  if (definition.strategy === 'DERIVED') {
    assert(definition.persisted === false, 'Derived Dataset must not be persisted: ' + id);
  }
}

assert(contract.repositoryApi.includes('previewDatasetChange'), 'Repository contract must expose diff preview.');
assert(contract.repositoryApi.includes('bootstrapDatasets'), 'Repository contract must expose embedded bootstrap.');
assert(contract.repositoryApi.includes('runHealthCheck'), 'Repository contract must expose portability health check.');
assert(contract.repositoryApi.includes('getImportOverview'), 'Repository contract must expose import audit overview.');
assert(contract.repositoryApi.includes('getOperationState'), 'Repository contract must expose operation mutex state.');
assert(contract.repositoryApi.includes('getDatasetRegistry'), 'Repository contract must expose cheap registry lookup.');
assert(contract.repositoryApi.includes('getMobileBrigadeRowsForRequests'), 'Repository contract must expose selective MB reads.');
assert(contract.repositoryApi.includes('replaceDataset'), 'Repository contract must expose REPLACE.');
assert(contract.repositoryApi.includes('replaceDatasetBatch'), 'Repository contract must expose atomic REPLACE batch.');
assert(contract.repositoryApi.includes('upsertDataset'), 'Repository contract must expose UPSERT.');

assert(contract.datasets.combined.strategy === 'DERIVED', 'Equipment_Combined must remain derived.');
assert(contract.datasets.combined.persisted === false, 'Equipment_Combined must not be a persisted source of truth.');
assert(JSON.stringify(contract.datasets.combined.dependencies) === JSON.stringify([
  'mounted', 'stationary', 'transport', 'transport_start_points', 'zabbix'
]), 'Equipment_Combined dependency graph drift.');
assert(contract.datasets.stationary.partitionField === 'unit',
  'Stationary REPLACE must be partitioned by unit/mine.');

for (const id of [
  'reclassification', 'drivers', 'customers', 'type_request', 'initiators',
  'exceptions', 'problem_grade', 'mounted', 'stationary', 'transport',
  'transport_start_points', 'zabbix', 'failure_classifier'
]) {
  assert(contract.datasets[id].strategy === 'REPLACE', id + ' must use REPLACE.');
}

assert(contract.compatibility(1).status === 'migration-required', 'Schema 1 must require migration.');
assert(contract.compatibility(2).status === 'migration-required', 'Schema 2 must require KPI Source migration.');
assert(contract.compatibility(3).status === 'migration-required', 'Legacy schema 3 must migrate.');
assert(contract.compatibility(4).status === 'migration-required', 'Schema 4 must require migration.');
assert(contract.compatibility(5).status === 'current', 'Schema 5 compatibility failed.');
assert(contract.compatibility(6).status === 'newer-than-app', 'Newer DB must be blocked.');
assert(contract.compatibility(-1).status === 'invalid', 'Invalid DB schema must be rejected.');

console.log('SQLite architecture contract: OK');
