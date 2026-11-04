const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const stateModelSource = fs.readFileSync('src/js/app/dataset_db_state_model.js', 'utf8');
const runtimeSource = fs.readFileSync('src/js/app/data_repository.js', 'utf8');

let driverRevision = 4;
const registryRows = () => [
  {
    dataset_id: 'drivers', dataset_schema_version: '1.0.0', active_revision: driverRevision,
    record_count: 1, updated_at: '2026-10-01T10:00:00Z'
  },
  {
    dataset_id: 'itsm_data', dataset_schema_version: '1.1.0', active_revision: 7,
    record_count: 1, updated_at: '2026-10-01T11:00:00Z'
  },
  {
    dataset_id: 'kpi_source', dataset_schema_version: '1.0.0', active_revision: 5,
    record_count: 1, updated_at: '2026-10-01T11:00:00Z'
  }
];

const states = {
  drivers: {},
  itsm_data: { fields: ['number'], dependencyRevisions: { drivers: 4 } },
  kpi_source: { fields: ['period'], dependencyRevisions: { itsm_data: 7 } }
};

const catalogItems = [
  {
    id: 'drivers', databaseTitle: 'Drivers', kind: 'reference', schemaVersion: '1.0.0',
    persisted: true, strategy: 'REPLACE', dependencies: []
  },
  {
    id: 'itsm_data', databaseTitle: 'ITSM Sirius Data', kind: 'events', schemaVersion: '1.1.0',
    persisted: true, strategy: 'UPSERT', keyField: 'number', dependencies: ['drivers']
  },
  {
    id: 'kpi_source', databaseTitle: 'KPI Source', kind: 'analytics', schemaVersion: '1.0.0',
    persisted: true, strategy: 'REPLACE', dependencies: ['itsm_data']
  }
];
const catalog = {
  datasets: Object.fromEntries(catalogItems.map(item => [item.id, item])),
  list() { return catalogItems; }
};

const repository = {
  hasOpenDatabase() { return true; },
  getDatabaseInfo() {
    return { valid: true, databaseUuid: 'db-1', fileName: 'Reclassifier.db', schemaVersion: 3, dirty: false };
  },
  listDatasets() { return registryRows().map(row => ({ ...row })); },
  getDatasetRegistry(id) { return registryRows().find(row => row.dataset_id === id); },
  getDatasetState(id) { return JSON.parse(JSON.stringify(states[id] || {})); },
  getImportOverview() { return { latestAttemptByDataset: [] }; },
  getDataset(id) {
    const row = this.getDatasetRegistry(id);
    return {
      id,
      records: id === 'drivers' ? [{ name: 'БКМ' }] : [[id === 'itsm_data' ? 'INC-1' : '2026-10-01']],
      state: this.getDatasetState(id),
      registry: row
    };
  }
};

const modelContext = vm.createContext({
  console, Map, Set, Object, String, Number, Array, Error,
  globalThis: null, window: null,
  ReclassifierDatasetCatalog: catalog,
  ReclassifierDatabaseRepository: repository,
  ReclassifierRuntimeDataRepository: {
    embeddedList() { return []; },
    source(id) { return repository.getDatasetRegistry(id)?.active_revision > 0 ? 'sqlite' : 'missing'; }
  }
});
modelContext.globalThis = modelContext;
modelContext.window = modelContext;
vm.runInContext(stateModelSource, modelContext, { filename: 'dataset_db_state_model.js' });

let snapshot = modelContext.ReclassifierDatasetDbStateModel.snapshot([]);
let itsm = snapshot.datasets.find(item => item.id === 'itsm_data');
let kpi = snapshot.datasets.find(item => item.id === 'kpi_source');
assert.equal(itsm.dependency.status, 'current');
assert.equal(kpi.dependency.status, 'current');

driverRevision = 5;
snapshot = modelContext.ReclassifierDatasetDbStateModel.snapshot([]);
itsm = snapshot.datasets.find(item => item.id === 'itsm_data');
kpi = snapshot.datasets.find(item => item.id === 'kpi_source');
assert.equal(itsm.dependency.status, 'stale');
assert.deepEqual(Array.from(itsm.dependency.mismatches), ['drivers']);
assert.equal(kpi.dependency.status, 'stale',
  'KPI Source must become stale transitively when its ITSM dependency is stale.');
assert.deepEqual(Array.from(kpi.dependency.mismatches), ['itsm_data']);

const runtimeContext = vm.createContext({
  console, JSON, Map, Set, Object, String, Number, Error, Array,
  globalThis: null,
  ReclassifierLegacyDatasetStore: {
    get() { return null; }, records() { return []; }, list() { return []; }
  },
  ReclassifierDatabaseRepository: repository,
  ReclassifierDatabaseContract: {
    datasets: Object.fromEntries(catalogItems.map(item => [item.id, {
      title: item.databaseTitle, kind: item.kind, schemaVersion: item.schemaVersion,
      persisted: item.persisted, dependencies: item.dependencies
    }]))
  }
});
runtimeContext.globalThis = runtimeContext;
vm.runInContext(runtimeSource, runtimeContext, { filename: 'data_repository.js' });

const runtimeItsm = runtimeContext.ReclassifierRuntimeDataRepository.get('itsm_data');
assert.equal(runtimeItsm.meta.dependencyStatus, 'stale');
assert.equal(runtimeItsm.meta.dependenciesCurrent, false);
assert.deepEqual(Array.from(runtimeItsm.meta.dependencyMismatches), ['drivers']);
assert.equal(runtimeItsm.validation.status, 'warning');
assert.match(runtimeItsm.validation.warnings[0], /Требуется пересчёт/);

const runtimeKpi = runtimeContext.ReclassifierRuntimeDataRepository.get('kpi_source');
assert.equal(runtimeKpi.meta.dependencyStatus, 'stale');
assert.deepEqual(Array.from(runtimeKpi.meta.dependencyMismatches), ['itsm_data']);
assert.equal(runtimeKpi.validation.status, 'warning');

states.itsm_data.dependencyRevisions = null;
runtimeContext.ReclassifierRuntimeDataRepository.invalidate();
const untrackedItsm = runtimeContext.ReclassifierRuntimeDataRepository.get('itsm_data');
assert.equal(untrackedItsm.meta.dependencyStatus, 'untracked');
assert.equal(untrackedItsm.validation.status, 'warning');

console.log('Persisted Dataset dependency freshness: current -> stale -> untracked OK');
