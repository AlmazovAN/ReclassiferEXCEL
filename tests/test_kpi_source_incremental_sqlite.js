const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const sourceFacts = fs.readFileSync('src/js/kpi/source_facts.js', 'utf8');
const kpiSource = fs.readFileSync('src/js/modules/itsm/kpi_source.js', 'utf8');
const integration = fs.readFileSync('src/js/app/database_integration.js', 'utf8');

const fields = [
  'number', 'createdAt', 'completedAt', 'closedAt', 'territory', 'sourceEquipment',
  'reclassifiedEquipment', 'openedBy', 'classificationQuality',
  'typeAfterReclassification', 'sputnikVbrDecision', 'sdgrService',
  'division', 'slaHours', 'preBacklogHours', 'driversByMine'
];

const oldRecord = [
  'INC-OLD', '2026-10-01', '2026-10-02', '2026-10-03', 'Северный', 'БКМ',
  'БКМ', 'Пользователь', 'INC без изм', 'INC', 'Считать отказом',
  'Навесное оборудование', 'КФ', 1, 2, 10
];
const newRecord = [
  'INC-NEW', '2026-11-01', '2026-11-02', '2026-11-03', 'Северный', 'БКМ',
  'БКМ', 'Пользователь', 'INC без изм', 'INC', 'Считать отказом',
  'Навесное оборудование', 'КФ', 1, 3, 10
];

const dependencyIds = [
  'reclassification', 'drivers', 'customers', 'type_request',
  'initiators', 'exceptions', 'problem_grade', 'mobile_brigade_data'
];

const registries = new Map([
  ['itsm_data', {
    dataset_id: 'itsm_data', active_revision: 1, record_count: 1,
    freshness_from: '2026-10-01', freshness_to: '2026-10-03',
    updated_at: '2026-10-03T12:00:00.000Z'
  }],
  ['kpi_source', {
    dataset_id: 'kpi_source', active_revision: 1, record_count: 1,
    freshness_from: '2026-10-01', freshness_to: '2026-10-01',
    updated_at: '2026-10-03T12:00:00.000Z'
  }],
  ...dependencyIds.map(id => [id, {
    dataset_id: id, active_revision: 1, record_count: 0,
    freshness_from: null, freshness_to: null,
    updated_at: '2026-10-03T12:00:00.000Z'
  }])
]);

const oldFullDataset = {
  schemaVersion: '1.0.0',
  package: 'itsm-full-dataset',
  aggregation: 'per-source-row',
  fieldCount: 2,
  columns: ['Номер', 'Просрочен по разрешению'],
  rows: [['INC-OLD', 'Нет']],
  recordKeys: ['inc-old'],
  coverage: 'complete'
};

const repository = {
  getDatabaseInfo() {
    return { valid: true, readOnly: false, databaseUuid: 'db-audit', fileName: 'Reclassifier.db' };
  },
  getDatasetRegistry(id) {
    return registries.get(id) || {
      dataset_id: id, active_revision: 1, record_count: 0,
      freshness_from: null, freshness_to: null, updated_at: '2026-10-03T12:00:00.000Z'
    };
  },
  getDataset(id) {
    if (id === 'itsm_data') {
      return {
        id,
        records: [oldRecord],
        state: { fields },
        fullDataset: oldFullDataset,
        registry: registries.get(id)
      };
    }
    return { id, records: [], state: {}, registry: this.getDatasetRegistry(id) };
  },
  getMobileBrigadeRowsForRequests() { return []; },
  previewDatasetChange(id, records) {
    return {
      datasetId: id,
      strategy: id === 'kpi_source' ? 'REPLACE' : 'UPSERT',
      rowsBefore: Number(this.getDatasetRegistry(id).record_count || 0),
      rowsIncoming: records.length,
      rowsInserted: records.length,
      rowsUpdated: 0,
      rowsUnchanged: 0,
      rowsDeleted: id === 'kpi_source' ? Number(this.getDatasetRegistry(id).record_count || 0) : 0,
      rowsAfter: id === 'kpi_source'
        ? records.length
        : Number(this.getDatasetRegistry(id).record_count || 0) + records.length
    };
  }
};

function requestKey(value) {
  return String(value ?? '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
}

const fullDatasetContract = {
  validate(source) { return source; },
  mergeAligned(current, currentKeys, incoming, incomingKeys, options = {}) {
    const columns = Array.from(incoming.columns);
    const rows = current ? current.rows.map(row => Array.from(row)) : [];
    const keys = current ? currentKeys.map(options.normalizeKey || requestKey) : [];
    const positions = new Map(keys.map((key, index) => [key, index]));
    incomingKeys.map(options.normalizeKey || requestKey).forEach((key, index) => {
      const position = positions.get(key);
      if (position === undefined) {
        positions.set(key, rows.length);
        keys.push(key);
        rows.push(Array.from(incoming.rows[index]));
      } else {
        rows[position] = Array.from(incoming.rows[index]);
      }
    });
    return {
      ...incoming,
      columns,
      fieldCount: columns.length,
      rows,
      recordKeys: keys,
      sourceRows: rows.length,
      coverage: 'complete'
    };
  }
};

const datasets = Object.fromEntries([
  ['itsm_data', {
    title: 'ITSM Sirius Data', kind: 'events', schemaVersion: '1.1.0',
    strategy: 'UPSERT', persisted: true, keyField: 'number'
  }],
  ['kpi_source', {
    title: 'KPI Source', kind: 'analytics', schemaVersion: '1.0.0',
    strategy: 'REPLACE', persisted: true, allowEmpty: true
  }],
  ...dependencyIds.map(id => [id, {
    title: id, kind: 'reference', schemaVersion: '1.0.0',
    strategy: id === 'mobile_brigade_data' ? 'UPSERT' : 'REPLACE',
    persisted: true
  }])
]);

const context = vm.createContext({
  console, Date, Math, JSON, Map, Set, Object, String, Number, Error, Promise,
  Array, ArrayBuffer, Uint8Array,
  globalThis: null,
  window: null,
  crypto: {},
  itsmModuleConfig: { references: dependencyIds },
  ReclassifierDatabaseRepository: repository,
  ReclassifierDatabaseContract: {
    strategy: { UPSERT: 'UPSERT', REPLACE: 'REPLACE', DERIVED: 'DERIVED' },
    datasets
  },
  ReclassifierItsmDatasetSchema: { version: '1.1.0', fields },
  ReclassifierFullDatasetContract: fullDatasetContract,
  ReclassifierDatasetRecognizer: {
    async inspectFile() {
      return {
        ready: true,
        datasetId: 'itsm_data',
        confidence: 100,
        sheetName: 'Обращение',
        headerRow: 1,
        freshness: { from: '2026-11-01', to: '2026-11-03' },
        details: { requestKeys: ['INC-NEW'] },
        validation: { status: 'valid', errors: [], warnings: [] }
      };
    }
  },
  workerRequest: async () => ({
    itsmData: {
      schemaVersion: '1.1.0',
      fields,
      columns: fields,
      records: [newRecord],
      sourceRows: 1,
      earliestSourceDate: '2026-11-01',
      latestSourceDate: '2026-11-03'
    },
    itsmFullDataset: {
      schemaVersion: '1.0.0',
      package: 'itsm-full-dataset',
      aggregation: 'per-source-row',
      fieldCount: 2,
      columns: ['Номер', 'Просрочен по разрешению'],
      rows: [['INC-NEW', 'Да']],
      sourceRows: 1,
      earliestSourceDate: '2026-11-01',
      latestSourceDate: '2026-11-03'
    },
    kpiSource: {
      schemaVersion: '1.0.0',
      records: [['incoming-only']],
      fields: ['placeholder'],
      columns: ['Placeholder']
    },
    rulesVersion: 'audit',
    stats: { rows: 1 }
  })
});
context.globalThis = context;
context.window = context;

vm.runInContext(sourceFacts, context, { filename: 'source_facts.js' });
vm.runInContext(kpiSource, context, { filename: 'kpi_source.js' });
vm.runInContext(integration, context, { filename: 'database_integration.js' });

const file = {
  name: 'incremental_itsm.xlsx',
  size: 3,
  async arrayBuffer() { return Uint8Array.from([1, 2, 3]).buffer; }
};

(async () => {
  const plan = await context.ReclassifierDatabaseIntegration.prepare({
    file,
    inspection: { datasetId: 'itsm_data', ready: true }
  });

  assert.equal(plan.atomicReplacements.length, 1);
  const kpi = plan.atomicReplacements[0];
  assert.equal(kpi.id, 'kpi_source');
  assert.equal(kpi.options.state.sourceRows, 2,
    'KPI Source must describe the post-UPSERT ITSM row count.');

  const fieldIndex = new Map(kpi.options.state.fields.map((field, index) => [field, index]));
  const periodIndex = fieldIndex.get('period');
  const slaTotalIndex = fieldIndex.get('slaTotalCount');
  const slaSuccessIndex = fieldIndex.get('slaSuccessCount');

  const october = kpi.records.find(row => row[periodIndex] === '2026-10-01');
  const november = kpi.records.find(row => row[periodIndex] === '2026-11-01');
  assert.ok(october, 'Historic October KPI row was lost by incremental ITSM integration.');
  assert.ok(november, 'Incoming November KPI row is missing.');

  assert.equal(october[slaTotalIndex], 1);
  assert.equal(october[slaSuccessIndex], 1,
    'Historic SLA must survive via stored ITSM Full Dataset.');
  assert.equal(november[slaTotalIndex], 1);
  assert.equal(november[slaSuccessIndex], 0);

  console.log('SQLite incremental ITSM preparation: cumulative KPI Source OK');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
