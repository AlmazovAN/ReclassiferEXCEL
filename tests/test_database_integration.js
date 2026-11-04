const fs = require('fs');
const vm = require('vm');

const source = fs.readFileSync('src/js/app/database_integration.js', 'utf8');

let currentUuid = 'db-1';
let revision = 0;
let replaceCalls = 0;
let upsertCalls = 0;
let previewCalls = 0;
let batchCalls = 0;
let combinedBuildCalls = 0;
let storedRecords = [];

const equipmentStore = {
  mounted: {
    records: [{ id: 'M-1', unit: 'Mine-A', name: 'Mounted-1' }],
    state: { joinIndex: [] },
    revision: 1,
    updatedAt: '2026-10-01T10:00:00.000Z'
  },
  stationary: {
    records: [
      { id: 'S-A-OLD', unit: 'Mine-A', name: 'Stationary A old' },
      { id: 'S-B-OLD', unit: 'Mine-B', name: 'Stationary B old' },
      { id: 'S-C', unit: 'Mine-C', name: 'Stationary C' }
    ],
    state: { joinIndex: [] },
    revision: 1,
    updatedAt: '2026-10-01T10:00:00.000Z'
  },
  transport: {
    records: [{ transport__id: 'T-1' }],
    state: { joinIndex: [] },
    revision: 1,
    updatedAt: '2026-10-01T10:00:00.000Z'
  },
  transport_start_points: {
    records: [],
    state: { joinIndex: [['mine-a|truck', { point: 1 }]] },
    revision: 1,
    updatedAt: '2026-10-01T10:00:00.000Z'
  },
  zabbix: {
    records: [{ zabbix__id: 'Z-1' }],
    state: { joinIndex: [] },
    revision: 1,
    updatedAt: '2026-10-01T10:00:00.000Z'
  }
};

const repository = {
  getDatabaseInfo() {
    return {
      valid: true,
      readOnly: false,
      databaseUuid: currentUuid,
      fileName: 'Reclassifier.db'
    };
  },
  getDataset(id) {
    const equipment = equipmentStore[id];
    if (equipment) {
      return {
        id,
        records: JSON.parse(JSON.stringify(equipment.records)),
        state: JSON.parse(JSON.stringify(equipment.state)),
        registry: {
          dataset_id: id,
          active_revision: equipment.revision,
          record_count: equipment.records.length,
          freshness_from: null,
          freshness_to: '2026-10-01',
          source_file_name: id + '.xlsx',
          dataset_schema_version: '1.0.0',
          updated_at: equipment.updatedAt
        }
      };
    }
    return {
      id,
      records: storedRecords,
      state: {},
      registry: {
        dataset_id: id,
        active_revision: revision,
        record_count: storedRecords.length,
        freshness_from: null,
        freshness_to: null,
        updated_at: revision ? '2026-09-29T20:00:00.000Z' : null
      }
    };
  },
  getDatasetRegistry(id) {
    return this.getDataset(id).registry;
  },
  getDatasetState(id) {
    return this.getDataset(id).state;
  },
  getMobileBrigadeRowsForRequests(requestKeys) {
    const wanted = new Set(requestKeys.map(value => String(value).trim().toLowerCase()));
    return storedRecords.filter(row => wanted.has(String(row.request || '').trim().toLowerCase()));
  },
  previewDatasetChange(id, records) {
    previewCalls += 1;
    const strategy = (id === 'drivers' || id === 'failure_classifier') ? 'REPLACE' : 'UPSERT';
    return {
      datasetId: id,
      strategy,
      rowsBefore: storedRecords.length,
      rowsIncoming: records.length,
      rowsInserted: records.length,
      rowsUpdated: 0,
      rowsUnchanged: 0,
      rowsDeleted: strategy === 'REPLACE' ? storedRecords.length : 0,
      rowsAfter: strategy === 'REPLACE' ? records.length : storedRecords.length + records.length
    };
  },
  replaceDataset(id, records) {
    replaceCalls += 1;
    storedRecords = JSON.parse(JSON.stringify(records));
    revision += 1;
    return {
      strategy: 'REPLACE',
      rowsBefore: 0,
      rowsIncoming: records.length,
      rowsInserted: records.length,
      rowsUpdated: 0,
      rowsUnchanged: 0,
      rowsDeleted: 0,
      rowsAfter: records.length
    };
  },
  replaceDatasetBatch(changes) {
    batchCalls += 1;
    const results = [];
    for (const change of changes) {
      const target = equipmentStore[change.id];
      if (!target) throw new Error('Unexpected batch Dataset ' + change.id);
      const before = target.records.length;
      let next;
      let deleted;
      if (change.options?.fullPreparedScope) {
        deleted = before;
        next = JSON.parse(JSON.stringify(change.records));
      } else if (change.id === 'stationary') {
        const keys = new Set(change.records.map(record => String(record.unit).trim().toLowerCase()));
        const preserved = target.records.filter(record =>
          !keys.has(String(record.unit).trim().toLowerCase())
        );
        deleted = before - preserved.length;
        next = preserved.concat(JSON.parse(JSON.stringify(change.records)));
      } else {
        deleted = before;
        next = JSON.parse(JSON.stringify(change.records));
      }
      target.records = next;
      target.state = JSON.parse(JSON.stringify(change.options?.state || {}));
      target.revision += 1;
      target.updatedAt = '2026-10-01T10:00:0' + target.revision + '.000Z';
      results.push({
        datasetId: change.id,
        strategy: 'REPLACE',
        rowsBefore: before,
        rowsIncoming: change.records.length,
        rowsInserted: change.records.length,
        rowsUpdated: 0,
        rowsUnchanged: 0,
        rowsDeleted: deleted,
        rowsAfter: next.length
      });
    }
    return {
      batchId: 'batch-test-1',
      results,
      changedDatasetIds: Array.from(new Set(changes.map(change => change.id)))
    };
  },
  async upsertDatasetAsync(id, records, options, onProgress, isCancelled) {
    if (isCancelled()) throw new Error('Test cancelled');
    onProgress({ processedRows: records.length, totalRows: records.length });
    return this.upsertDataset(id, records, options);
  },
  upsertDataset(id, records) {
    upsertCalls += 1;
    storedRecords.push(...JSON.parse(JSON.stringify(records)));
    revision += 1;
    return {
      strategy: 'UPSERT',
      rowsBefore: storedRecords.length - records.length,
      rowsIncoming: records.length,
      rowsInserted: records.length,
      rowsUpdated: 0,
      rowsUnchanged: 0,
      rowsDeleted: 0,
      rowsAfter: storedRecords.length
    };
  }
};

const context = {
  console,
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
  Uint8Array,
  ArrayBuffer,
  globalThis: null,
  window: null,
  crypto: {},
  ReclassifierDatabaseRepository: repository,
  ReclassifierDatabaseContract: {
    strategy: { UPSERT: 'UPSERT', REPLACE: 'REPLACE', DERIVED: 'DERIVED' },
    datasets: {
      drivers: {
        title: 'Drivers',
        kind: 'reference',
        schemaVersion: '1.0.0',
        strategy: 'REPLACE',
        persisted: true,
        allowEmpty: false
      },
      failure_classifier: {
        title: 'Классификатор отказов',
        kind: 'classifier',
        schemaVersion: '2.0.0',
        strategy: 'REPLACE',
        persisted: true,
        allowEmpty: false
      },
      mobile_brigade_data: {
        title: 'Mobile Brigade Data',
        kind: 'events',
        schemaVersion: '1.4.0',
        strategy: 'UPSERT',
        persisted: true,
        allowEmpty: false,
        keyField: 'recordKey'
      },
      mounted: {
        title: 'CatalogMountedEquipment', kind: 'equipment',
        schemaVersion: '1.0.0', strategy: 'REPLACE', persisted: true
      },
      stationary: {
        title: 'CatalogStationaryEquipment', kind: 'equipment',
        schemaVersion: '1.0.0', strategy: 'REPLACE', persisted: true,
        partitionField: 'unit'
      },
      transport: {
        title: 'CatalogTransport', kind: 'equipment',
        schemaVersion: '1.0.0', strategy: 'REPLACE', persisted: true
      },
      transport_start_points: {
        title: 'CatalogTransport StartPoints', kind: 'equipment',
        schemaVersion: '1.0.0', strategy: 'REPLACE', persisted: true
      },
      zabbix: {
        title: 'CatalogZabbixEquipmentTree', kind: 'equipment',
        schemaVersion: '1.0.0', strategy: 'REPLACE', persisted: true
      },
      combined: {
        title: 'Equipment_Combined', kind: 'equipment',
        schemaVersion: '1.1.0', strategy: 'DERIVED', persisted: false
      }
    }
  },
  ReclassifierDatasetRecognizer: {
    async inspectFile() {
      return {
        ready: true,
        datasetId: 'drivers',
        datasetTitle: 'Drivers',
        datasetSchemaVersion: '1.0.0',
        strategy: 'REPLACE',
        confidence: 100,
        sheetName: 'Drivers',
        headerRow: 1,
        freshness: { from: null, to: null, source: 'not-applicable', field: null },
        validation: { status: 'valid', errors: [], warnings: [] },
        classification: {
          id: 'drivers',
          label: 'Drivers',
          group: 'Справочник',
          reason: 'структура Drivers'
        }
      };
    }
  },
  XLSX: {
    read() {
      return { SheetNames: ['Drivers'], Sheets: { Drivers: {} } };
    }
  },
  EQUIPMENT_SOURCE_IDS: ['mounted', 'stationary', 'transport', 'transport_start_points', 'zabbix'],
  ReclassifierEquipmentPartitions: require('../src/js/modules/equipment/equipment_partitions.js'),
  buildEquipmentCombinedFromCatalogs(catalogs) {
    combinedBuildCalls += 1;
    const records = [
      ...(catalogs.stationary?.records || []),
      ...(catalogs.mounted?.records || [])
    ].map(record => ({ ...record }));
    return {
      id: 'combined',
      records,
      joinIndex: new Map(),
      validation: { status: 'valid', errors: [], warnings: [] },
      meta: { sourceType: 'staged', normalizedRows: records.length }
    };
  },
  normalizeDriversWorkbook() {
    return {
      records: [
        { mine: 'Северный', name: 'БКМ', service: 'СДГР', system: 'СПРИТ', value: 1, unit: 'шт' },
        { mine: 'Таймырский', name: 'БКМ', service: 'СДГР', system: 'СПРИТ', value: 2, unit: 'шт' }
      ],
      validation: { status: 'valid', errors: [], warnings: [] },
      meta: { sourceSheet: 'Drivers', sourceRows: 2, normalizedRows: 2 }
    };
  }
};
context.globalThis = context;
context.window = context;

vm.createContext(context);
vm.runInContext(source, context, { filename: 'database_integration.js' });

const engine = context.ReclassifierDatabaseIntegration;
if (!engine?.prepare || !engine?.commit || !engine?.commitBatch) {
  throw new Error('Database Integration Engine API is missing.');
}

const file = {
  name: 'Drivers.xlsx',
  size: 3,
  lastModified: 1,
  async arrayBuffer() {
    return Uint8Array.from([1, 2, 3]).buffer;
  }
};

(async () => {
  const plan = await engine.prepare({
    file,
    inspection: { datasetId: 'drivers', ready: true }
  });

  if (replaceCalls !== 0 || upsertCalls !== 0) {
    throw new Error('prepare() mutated the database before confirmation.');
  }
  if (previewCalls !== 1 || plan.preview.strategy !== 'REPLACE' || plan.preview.rowsIncoming !== 2) {
    throw new Error('REPLACE diff preview is incorrect.');
  }
  if (!String(plan.options.sourceFingerprint).startsWith('fnv1a-')) {
    throw new Error('Source fingerprint was not calculated.');
  }

  const committed = await engine.commit(plan);
  if (replaceCalls !== 1 || upsertCalls !== 0) {
    throw new Error('REPLACE commit did not use the correct repository method.');
  }
  if (committed.rowsAfter !== 2 || committed.revision !== 1) {
    throw new Error('REPLACE commit result is incorrect.');
  }

  const stalePlan = await engine.prepare({
    file,
    inspection: { datasetId: 'drivers', ready: true }
  });
  currentUuid = 'db-2';
  let staleBlocked = false;
  try {
    await engine.commit(stalePlan);
  } catch (error) {
    staleBlocked = /БД изменилась/.test(error.message);
  }
  if (!staleBlocked || replaceCalls !== 1) {
    throw new Error('A plan prepared for another DB UUID was not blocked.');
  }

  currentUuid = 'db-1';
  const revisionPlan = await engine.prepare({
    file,
    inspection: { datasetId: 'drivers', ready: true }
  });
  revision += 1;
  let revisionBlocked = false;
  try { await engine.commit(revisionPlan); } catch (error) {
    revisionBlocked = /Содержимое БД изменилось/.test(error.message);
  }
  if (!revisionBlocked) throw new Error('Stale Dataset revision was not blocked.');

  currentUuid = 'db-1';
  storedRecords = [];
  revision = 0;
  const upsertPlan = {
    databaseUuid: 'db-1',
    databaseFileName: 'Reclassifier.db',
    file: { name: 'MB.xlsx' },
    inspection: { datasetId: 'mobile_brigade_data' },
    definition: {
      title: 'Mobile Brigade Data',
      strategy: 'UPSERT'
    },
    records: [{ recordKey: 'north|1', request: 'INC-1' }],
    options: {},
    preview: {
      datasetId: 'mobile_brigade_data',
      strategy: 'UPSERT',
      rowsBefore: 0,
      rowsIncoming: 1,
      rowsInserted: 1,
      rowsUpdated: 0,
      rowsUnchanged: 0,
      rowsDeleted: 0,
      rowsAfter: 1
    }
  };
  const upsertResult = await engine.commit(upsertPlan);
  if (upsertCalls !== 1 || upsertResult.strategy !== 'UPSERT') {
    throw new Error('UPSERT commit did not use the correct repository method.');
  }

  // Classifier uses the same domain normalizer as the individual upload.
  // Its informational deduplication count is separate from SQLite REPLACE.
  context.ReclassifierDatasetRecognizer.inspectFile = async () => ({
    datasetId: 'failure_classifier', ready: true,
    confidence: 100, sheetName: 'Причина инцидента', headerRow: 1,
    freshness: { from: null, to: '2026-09-26' },
    validation: { status: 'valid', errors: [], warnings: [] }
  });
  context.normalizeFailureClassifierWorkbook = () => ({
    records: [
      { service: null, equipment: 'БКМ', element: 'АКБ', failure: 'Отказ', cause: 'Питание' }
    ],
    validation: { status: 'valid', errors: [], warnings: [] },
    meta: {
      format: 'system', formatLabel: 'Системная выгрузка',
      sourceSheet: 'Причина инцидента', latestChangedAt: '2026-09-26',
      candidateRows: 3, filteredRows: 1, afterFiltersRows: 2,
      duplicatesRemoved: 1, normalizedRows: 1
    }
  });
  const classifierPlan = await engine.prepare({
    file: { ...file, name: 'classifier.xlsx' },
    inspection: { datasetId: 'failure_classifier', ready: true }
  });
  if (classifierPlan.preview.rowsIncoming !== 1 ||
      classifierPlan.preview.processing.duplicatesRemoved !== 1 ||
      classifierPlan.options.details.duplicatesRemoved !== 1) {
    throw new Error('Classifier deduplication did not reach SQLite preview and import history.');
  }
  const classifierResult = await engine.commit(classifierPlan);
  if (classifierResult.rowsAfter !== 1 ||
      classifierResult.processing.duplicatesRemoved !== 1) {
    throw new Error('Classifier unique records were not persisted by SQLite REPLACE.');
  }

  const equipmentPlan = (unit, id, fileName) => ({
    databaseUuid: 'db-1',
    databaseFileName: 'Reclassifier.db',
    expectedRevision: equipmentStore.stationary.revision,
    expectedUpdatedAt: equipmentStore.stationary.updatedAt,
    file: { name: fileName },
    inspection: {
      datasetId: 'stationary',
      validation: { status: 'valid', errors: [], warnings: [] }
    },
    definition: context.ReclassifierDatabaseContract.datasets.stationary,
    records: [{ id, unit, name: id }],
    options: {
      freshnessTo: '2026-10-01',
      sourceFileName: fileName,
      partitionScopeConfirmed: true,
      state: { schemaVersion: '1.0.0', joinIndex: [] }
    },
    preview: {
      datasetId: 'stationary',
      strategy: 'REPLACE',
      partitions: [unit]
    }
  });

  const mineAPlan = equipmentPlan('Mine-A', 'S-A-NEW', 'Stationary_A.xlsx');
  const mineBPlan = equipmentPlan('Mine-B', 'S-B-NEW', 'Stationary_B.xlsx');
  const equipmentBatch = await engine.commitBatch([mineAPlan, mineBPlan]);

  if (batchCalls !== 1 || combinedBuildCalls !== 1) {
    throw new Error('Equipment batch must use one repository batch and one Combined build.');
  }
  const stationaryIds = equipmentStore.stationary.records.map(record => record.id).sort();
  if (JSON.stringify(stationaryIds) !== JSON.stringify(['S-A-NEW', 'S-B-NEW', 'S-C'])) {
    throw new Error('Stationary batch did not replace only the two requested mine sections.');
  }
  const combinedIds = equipmentBatch.derivedCandidates.combined.records
    .map(record => record.id)
    .filter(Boolean)
    .sort();
  if (!combinedIds.includes('S-A-NEW') ||
      !combinedIds.includes('S-B-NEW') ||
      !combinedIds.includes('S-C') ||
      combinedIds.includes('S-A-OLD') ||
      combinedIds.includes('S-B-OLD')) {
    throw new Error('Equipment_Combined candidate was not built from the full post-batch state.');
  }

  const overlapA = equipmentPlan('Mine-C', 'S-C-1', 'Stationary_C1.xlsx');
  const overlapB = equipmentPlan('Mine-C', 'S-C-2', 'Stationary_C2.xlsx');
  let overlapBlocked = false;
  try {
    await engine.commitBatch([overlapA, overlapB]);
  } catch (error) {
    overlapBlocked = /секц|нескольких файлах/i.test(error.message);
  }
  if (!overlapBlocked || batchCalls !== 1) {
    throw new Error('Overlapping Stationary mine sections must be blocked before SQLite batch write.');
  }

  console.log('SQLite Dataset Integration Engine: OK');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
