const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('src/js/app/database_integration.js', 'utf8');
let workerPayload = null;
let inspectionCount = 0;

const fields = ['createdAt', 'number'];
const registries = new Map([
  ['itsm_data', {
    dataset_id: 'itsm_data', active_revision: 3, record_count: 2,
    freshness_from: '2026-01-01', freshness_to: '2026-10-01',
    updated_at: '2026-10-01T10:00:00Z'
  }],
  ['mobile_brigade_data', {
    dataset_id: 'mobile_brigade_data', active_revision: 2, record_count: 10,
    freshness_from: '2026-01-01', freshness_to: '2026-09-30',
    updated_at: '2026-09-30T10:00:00Z'
  }]
]);

const repository = {
  getDatabaseInfo() {
    return { valid: true, readOnly: false, databaseUuid: 'db-1', fileName: 'Reclassifier.db' };
  },
  getDatasetRegistry(id) {
    return registries.get(id) || {
      dataset_id: id, active_revision: 0, record_count: 0,
      freshness_from: null, freshness_to: null, updated_at: '2026-10-01T10:00:00Z'
    };
  },
  getDatasetState(id) {
    return id === 'mobile_brigade_data' ? { freshnessByScope: {} } : {};
  },
  getDataset(id) {
    throw new Error('DB Workspace must not materialize the complete Dataset: ' + id);
  },
  getItsmMobileBrigadeLinkRows() {
    return [
      { number: 'INC-100', createdAt: '2026-09-01T08:00:00' },
      { number: 'RITM-200', createdAt: '2026-09-02T09:30:00' }
    ];
  },
  previewDatasetChange(id, records) {
    return {
      datasetId: id, strategy: 'UPSERT',
      rowsBefore: 10, rowsIncoming: records.length,
      rowsInserted: records.length, rowsUpdated: 0, rowsUnchanged: 0,
      rowsDeleted: 0, rowsAfter: 10 + records.length
    };
  }
};

const context = vm.createContext({
  console, Date, Math, JSON, Map, Set, Object, String, Number, Error, Promise,
  Array, ArrayBuffer, Uint8Array,
  globalThis: null,
  window: null,
  crypto: {},
  ReclassifierDatabaseRepository: repository,
  ReclassifierDatabaseContract: {
    strategy: { UPSERT: 'UPSERT', REPLACE: 'REPLACE', DERIVED: 'DERIVED' },
    datasets: {
      mobile_brigade_data: {
        title: 'Mobile Brigade Data', kind: 'events', schemaVersion: '1.5.0',
        strategy: 'UPSERT', persisted: true, keyField: 'recordKey'
      }
    }
  },
  ReclassifierFullDatasetContract: {
    validate(source) { return source; }
  },
  ReclassifierDatasetRecognizer: {
    async inspectFile() {
      inspectionCount += 1;
      return {
        ready: true, datasetId: 'mobile_brigade_data', confidence: 100,
        sheetName: 'Tasks', headerRow: 1,
        freshness: { from: '2026-10-01', to: '2026-10-01' },
        validation: { status: 'valid', errors: [], warnings: [] }
      };
    }
  },
  workerRequest: async (type, payload) => {
    assert.equal(type, 'PROCESS_MOBILE_BRIGADE');
    workerPayload = payload;
    return {
      mobileBrigadeData: {
        schemaVersion: '1.5.0',
        records: [{ recordKey: 'north|1', request: 'INC-100' }],
        earliestSourceDate: '2026-10-01',
        latestSourceDate: '2026-10-01',
        freshnessByScope: {},
        sourceFreshness: []
      },
      mobileBrigadeFullDataset: {
        schemaVersion: '1.0.0',
        package: 'mobile-brigade-full-dataset',
        aggregation: 'per-task-row',
        fieldCount: 1,
        columns: ['Заявка'],
        rows: [['INC-100']]
      },
      stats: { rows: 1 },
      rulesVersion: 'audit'
    };
  }
});
context.globalThis = context;
context.window = context;

vm.runInContext(fs.readFileSync('src/js/app/dataset_catalog.js','utf8'),context);
vm.runInContext(fs.readFileSync('src/js/app/field_registry.js','utf8'),context);
vm.runInContext(fs.readFileSync('src/js/modules/itsm/dataset_schema.js','utf8'),context);
assert.equal(typeof context.ReclassifierItsmDatasetSchema.mobileBrigadeLinkRows,'function');
vm.runInContext(source, context, { filename: 'database_integration.js' });

const file = {
  name: 'MB.xlsx',
  size: 3,
  lastModified: 123,
  async arrayBuffer() { return Uint8Array.from([1, 2, 3]).buffer; }
};

(async () => {
  const plan = await context.ReclassifierDatabaseIntegration.prepare({
    file,
    inspection: { datasetId: 'mobile_brigade_data', ready: true }
  });

  assert.ok(workerPayload, 'Mobile Brigade worker was not called.');
  assert.equal(workerPayload.deferExport, true,
    'Database Workspace must not create an XLSX during automatic candidate preparation');
  assert.equal(workerPayload.streamToSqlite, undefined,
    'This PR must not silently enable a different SQLite staging protocol');
  assert.deepEqual(
    JSON.parse(JSON.stringify(workerPayload.itsmData)),
    [
      { number: 'INC-100', createdAt: '2026-09-01T08:00:00' },
      { number: 'RITM-200', createdAt: '2026-09-02T09:30:00' }
    ],
    'SQLite Mobile Brigade processing must receive current ITSM number + createdAt pairs.'
  );
  assert.equal(plan.records.length, 1);
  assert.equal(plan.options.state.lastImportedRulesVersion, 'audit');
  assert.equal(plan.options.state.itsmLinkContractVersion, '1.0.0');
  assert.equal(inspectionCount,1,'Direct prepare still validates independently');

  const storedInspection = {
    ready:true,datasetId:'mobile_brigade_data',confidence:100,
    sheetName:'Tasks',headerRow:1,sourceRows:1,
    freshness:{from:'2026-10-01',to:'2026-10-01'},
    validation:{status:'valid',errors:[],warnings:[]}
  };
  const cachedPlan = await context.ReclassifierDatabaseIntegration.prepare({
    file,inspectedFile:file,size:file.size,lastModified:file.lastModified,
    inspection:storedInspection
  });
  assert.equal(inspectionCount,1,
    'Initial intake validation for the same File must be reused by the candidate');
  assert.equal(cachedPlan.inspection,storedInspection);
  assert.deepEqual(JSON.parse(JSON.stringify(cachedPlan.records)),
    JSON.parse(JSON.stringify(plan.records)));
  assert.deepEqual(JSON.parse(JSON.stringify(cachedPlan.preview)),
    JSON.parse(JSON.stringify(plan.preview)));

  const otherFile = {
    ...file,async arrayBuffer(){return Uint8Array.from([4,5,6]).buffer;}
  };
  await context.ReclassifierDatabaseIntegration.prepare({
    file:otherFile,inspectedFile:file,size:file.size,lastModified:file.lastModified,
    inspection:storedInspection
  });
  assert.equal(inspectionCount,2,
    'Reused metadata from another File must never skip validation');
  console.log('SQLite Mobile Brigade -> ITSM enrichment context: OK');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
