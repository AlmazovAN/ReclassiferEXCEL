const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const context = vm.createContext({
  window: { XLSX: { read: buffer => buffer }, confirm: () => true },
  state: {
    references: {}, referenceMeta: {}, referenceHistory: {},
    equipmentCatalogs: {}, equipmentHistory: {}, equipmentStaging: { files: [], catalogs: {}, combined: null, messages: [] }
  },
  referenceConfig: { mobile_brigade_data: { generatedOnly: true, title: 'МБ', schemaVersion: '1.5.0' } },
  MOBILE_BRIGADE_DATA_SCHEMA: {
    version: '1.5.0',
    output: [
      ['site'], ['taskNumber'], ['taskForShiftId'], ['recordKey'], ['request'],
      ['requestUrl'], ['factDate'], ['laborHours'], ['astroHours'],
      ['equipmentPlacement'], ['equipmentUnit'], ['equipmentType'], ['transport'],
      ['equipment'], ['element'], ['fault'], ['incidentReason'], ['description'], ['combinedComment'],
      ['itsmCreatedAt'], ['preBacklogAge'], ['finalTaskType'], ['laborState']
    ]
  },
  equipmentConfig: {
    a: { title: 'A', schemaVersion: '1', partitionField: 'unit', approvedColumns: [] },
    b: { title: 'B', schemaVersion: '1', partitionField: 'unit', approvedColumns: [] }
  },
  // Synthetic a/b catalogs exercise lifecycle wiring, not real Equipment
  // source semantics. Actual five-source partition migration has PR8 tests.
  // Generic adapter fixture uses synthetic 'a'/'b'; real Equipment History
  // semantics are independently covered by the PR9 domain tests.
  ReclassifierEquipmentHistory: {observe:()=>({
    schemaVersion:1,snapshots:[],events:[],lastKnown:{}
  })},
  ReclassifierEquipmentPartitions: {
    key: value => String(value||'').toLowerCase(),
    UNKNOWN: '__unresolved__',
    ownership: () => new Map(),
    merge: (id,current,rows) => ({
      records:rows,joinIndex:new Map(),partitionField:'unit',
      replacedPartitions:['Mine-A'],removedRows:current?.records?.length||0,
      preservedRows:0,incomingRows:rows.length
    })
  },
  EQUIPMENT_SOURCE_IDS: ['a', 'b'], EQUIPMENT_COMBINED_COLUMNS: ['value'], EQUIPMENT_RULES_VERSION: 'test',
  identifyEquipmentCatalog: name => ({ id: name.split('.')[0], freshness: null }),
  isEquipmentCombinedControlFile: () => false,
  normalizeEquipmentWorkbook: (id, workbook, meta) => ({
    id, records: [{ value: workbook.value, unit: 'Mine-A' }], validation: { status: 'valid', errors: [], warnings: [] },
    meta: { ...meta, normalizedRows: 1 }
  }),
  buildEquipmentCombinedFromCatalogs: catalogs => ({
    id: 'combined', records: [{ value: catalogs.a.records[0].value + catalogs.b.records[0].value }],
    validation: { status: 'valid', errors: [], warnings: [] }, meta: {}
  }),
  log: () => {}, build: {}, performance: { now: () => 0 },
  ReclassifierDatasetCatalog: {
    list: () => [{ id: 'mobile_brigade_data', kind: 'events', schemaVersion: '1.5.0', allowEmpty: false }],
    get: id => id === 'mobile_brigade_data'
      ? { id, kind: 'events', schemaVersion: '1.5.0', allowEmpty: false, keyField: 'recordKey' }
      : null
  },
  Date, Map, Set, Error, Uint8Array, Object, Array
});
vm.runInContext(read('src/js/app/dataset_pipeline.js'), context);
vm.runInContext(read('src/js/app/dataset_lifecycle.js'), context);
const pipeline = vm.runInContext('datasetPipeline', context);
const lifecycle = context.ReclassifierDatasetLifecycleManager;
pipeline.register('a', { kind: 'equipment', schemaVersion: '1' });
pipeline.register('b', { kind: 'equipment', schemaVersion: '1' });
pipeline.register('combined', { kind: 'equipment', schemaVersion: 'test' });
vm.runInContext(read('src/js/references/reference_manager.js'), context);
vm.runInContext(read('src/js/modules/mobile_brigade/rules.js'), context);
vm.runInContext(read('src/js/modules/mobile_brigade/dataset.js'), context);
vm.runInContext(read('src/js/modules/equipment/equipment_manager.js'), context);

const evaluate = expression => vm.runInContext(expression, context);
const { state, window } = context;
const file = (name, value) => ({ name, size: 4, arrayBuffer: async () => ({ value }) });

(async () => {
  assert.equal(window.ReclassifierReferenceManager.prepareGenerated, undefined);
  assert.equal(window.ReclassifierReferenceManager.applyPrepared, undefined);
  const mobileDataset = context.ReclassifierMobileBrigadeDataset;

  const legacyAnalytics = mobileDataset.prepare([
    { recordKey: 'site|legacy-zero', request: 'old', laborHours: 0 },
    { recordKey: 'site|legacy-positive', request: 'old', laborHours: 2.5 }
  ]);
  assert.strictEqual(legacyAnalytics.records[0].laborState, 'legacy_unknown');
  assert.strictEqual(legacyAnalytics.records[0].finalTaskType, null);
  assert.strictEqual(legacyAnalytics.records[1].laborState, 'valid');
  assert.deepStrictEqual(
    JSON.parse(JSON.stringify(legacyAnalytics.meta.laborStateCounts)),
    { legacy_unknown: 1, valid: 1 }
  );
  assert.strictEqual(legacyAnalytics.meta.rowsWithoutFinalTaskType, 2);

  const enrichedAnalytics = mobileDataset.enrichAnalytics(
    [{ recordKey: 'site|full', request: 'old', laborHours: 0, laborState: 'legacy_unknown' }],
    {
      columns: ['Итог Новый тип задач', 'Фактические трудозатраты'],
      rows: [['АВР', '0']]
    }
  );
  assert.strictEqual(enrichedAnalytics[0].finalTaskType, 'АВР');
  assert.strictEqual(enrichedAnalytics[0].laborHours, 0);
  assert.strictEqual(enrichedAnalytics[0].laborState, 'valid_zero');

  const invalidHistoricalLabor = mobileDataset.enrichAnalytics(
    [{ recordKey: 'site|invalid', request: 'old', laborHours: 0, laborState: 'legacy_unknown' }],
    {
      columns: ['Итог Новый тип задач', 'Фактические трудозатраты'],
      rows: [['Прочее', 'нет данных']]
    }
  );
  assert.strictEqual(invalidHistoricalLabor[0].finalTaskType, 'Прочее');
  assert.strictEqual(invalidHistoricalLabor[0].laborHours, null);
  assert.strictEqual(invalidHistoricalLabor[0].laborState, 'invalid');

  const original = mobileDataset.prepare([{ recordKey: 'site|old', request: 'old' }]);
  assert.throws(() => lifecycle.assertApplied(original), /активным экземпляром/);
  await lifecycle.prepare('mobile_brigade_data', [file('old.xlsx', 1)], async () => original);
  lifecycle.commit('mobile_brigade_data', { recordHistory: true });
  assert.strictEqual(state.references.mobile_brigade_data, original);

  const prepared = mobileDataset.prepare([{ recordKey: 'site|new', request: 'new' }]);
  await lifecycle.prepare('mobile_brigade_data', [file('new.xlsx', 1)], async () => prepared);
  assert.strictEqual(window.ReclassifierReferenceManager.get('mobile_brigade_data'), original);
  const committed = lifecycle.commit('mobile_brigade_data', { recordHistory: true });
  assert.strictEqual(committed, prepared);
  assert.strictEqual(window.ReclassifierReferenceManager.get('mobile_brigade_data'), prepared);
  assert.strictEqual(state.references.mobile_brigade_data, lifecycle.active('mobile_brigade_data'));
  assert.equal(lifecycle.history('mobile_brigade_data').length, 2);

  lifecycle.activate('a', { id: 'a', records: [{ value: 1 }], validation: { status: 'valid' } });
  lifecycle.activate('b', { id: 'b', records: [{ value: 2 }], validation: { status: 'valid' } });
  lifecycle.activate('combined', { id: 'combined', records: [{ value: 3 }], validation: { status: 'valid' } });

  evaluate('setEquipmentStagingFiles([globalThis.newFile])');
  await evaluate('processEquipmentStaging()');
  assert.equal(state.equipmentCombined.records[0].value, 3);
  assert.equal(pipeline.get('combined').candidate.records[0].value, 6);
  assert.equal(evaluate('commitEquipmentStaging()'), true);
  assert.equal(state.equipmentCombined.records[0].value, 6);
  assert.equal(state.equipmentCatalogs.a.records[0].value, 4);
  assert.equal(state.equipmentCatalogs.a.meta.equipmentHistory.schemaVersion,1,
    'Equipment history must travel with the committed source in HTML Dataset Store.');
  assert.strictEqual(window.ReclassifierEquipment.get('combined'), pipeline.active('combined'));
  assert.strictEqual(window.ReclassifierEquipment.get('a'), pipeline.active('a'));

  evaluate('setEquipmentStagingFiles([globalThis.badFile])');
  await evaluate('processEquipmentStaging()');
  assert.equal(pipeline.get('combined').candidate.validation.status, 'invalid');
  assert.equal(evaluate('commitEquipmentStaging()'), false);
  assert.equal(state.equipmentCombined.records[0].value, 6);
  console.log('dataset adapters: OK');
})().catch(error => { console.error(error); process.exitCode = 1; });

context.newFile = file('a.xlsx', 4);
context.badFile = file('unknown.xlsx', 10);
