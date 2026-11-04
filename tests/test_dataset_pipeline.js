const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const source = ['dataset_catalog.js', 'dataset_pipeline.js'].map(name =>
  fs.readFileSync(path.join(__dirname, '../src/js/app', name), 'utf8')
).join('\n');
const context = vm.createContext({ Date, Map, Error, state: {}, window: {}, referenceConfig: {}, equipmentConfig: {} });
vm.runInContext(source, context);
const pipeline = vm.runInContext('datasetPipeline', context);
context.referenceConfig.customers = {};

function instance(id, value, status = 'valid') {
  return { id, records: [value], validation: { status, errors: status === 'invalid' ? ['bad'] : [], warnings: [] } };
}

(async () => {
  const fullDatasetContract = context.ReclassifierFullDatasetContract;
  const fullPayload = {
    schemaVersion: '1.0.0',
    package: 'test-full-dataset',
    aggregation: 'per-source-row',
    fieldCount: 3,
    columns: ['A', 'TEST_UNKNOWN_COLUMN', 'C'],
    rows: [[1, 'preserved', 3]]
  };
  assert.strictEqual(
    fullDatasetContract.validate(fullPayload, {
      packageId: 'test-full-dataset',
      aggregation: 'per-source-row'
    }),
    fullPayload
  );
  assert.throws(
    () => fullDatasetContract.validate({ ...fullPayload, fieldCount: 2 }),
    /fieldCount/
  );
  assert.throws(
    () => fullDatasetContract.validate({ ...fullPayload, rows: [[1, 2]] }),
    /ширина строки/
  );

  const mergedFull = fullDatasetContract.mergeAligned(
    {
      schemaVersion: '1.0.0',
      package: 'test-full-dataset',
      aggregation: 'per-source-row',
      fieldCount: 2,
      columns: ['A', 'TEST_UNKNOWN_COLUMN'],
      rows: [
        [1, 'old-a'],
        [2, 'keep']
      ],
      earliestSourceDate: '2026-01-01',
      latestSourceDate: '2026-02-01'
    },
    ['k1', 'k2'],
    {
      schemaVersion: '1.0.0',
      package: 'test-full-dataset',
      aggregation: 'per-source-row',
      fieldCount: 3,
      columns: ['A', 'NEW_FUTURE_COLUMN', 'TEST_UNKNOWN_COLUMN'],
      rows: [
        [1, 'future-1', 'new-a'],
        [3, 'future-3', 'new-3']
      ],
      earliestSourceDate: '2026-03-01',
      latestSourceDate: '2026-04-01'
    },
    ['K1', 'K3'],
    {
      packageId: 'test-full-dataset',
      aggregation: 'per-source-row',
      normalizeKey: value => String(value || '').trim().toLowerCase(),
      currentRecordCount: 2
    }
  );
  assert.deepEqual(
    Array.from(mergedFull.columns),
    ['A', 'NEW_FUTURE_COLUMN', 'TEST_UNKNOWN_COLUMN']
  );
  assert.deepEqual(
    Array.from(mergedFull.rows, row => Array.from(row)),
    [
      [1, 'future-1', 'new-a'],
      [2, null, 'keep'],
      [3, 'future-3', 'new-3']
    ]
  );
  assert.deepEqual(Array.from(mergedFull.recordKeys), ['k1', 'k2', 'k3']);
  assert.equal(mergedFull.coverage, 'complete');
  assert.equal(mergedFull.earliestSourceDate, '2026-01-01');
  assert.equal(mergedFull.latestSourceDate, '2026-04-01');

  const partialFull = fullDatasetContract.mergeAligned(
    null,
    [],
    {
      schemaVersion: '1.0.0',
      package: 'test-full-dataset',
      aggregation: 'per-source-row',
      fieldCount: 2,
      columns: ['A', 'TEST_UNKNOWN_COLUMN'],
      rows: [[1, 'first'], [1, 'last']]
    },
    ['dup', 'DUP'],
    {
      packageId: 'test-full-dataset',
      aggregation: 'per-source-row',
      normalizeKey: value => String(value || '').trim().toLowerCase(),
      currentRecordCount: 5
    }
  );
  assert.equal(partialFull.coverage, 'partial');
  assert.deepEqual(Array.from(partialFull.recordKeys), ['dup']);
  assert.deepEqual(Array.from(partialFull.rows[0]), [1, 'last']);

  // PR1: a legacy analytic baseline can be incrementally reconstructed from
  // source files spanning several years, even with intervening HTML snapshots.
  const source = (columns, rows) => ({
    schemaVersion: '1.0.0', package: 'test-full-dataset',
    aggregation: 'per-source-row', fieldCount: columns.length,
    columns, rows
  });
  const normalize = value => String(value).toLowerCase();
  const firstKnown = fullDatasetContract.mergeAligned(
    null, [],
    source(['Номер','Unknown Raw'], [['INC-2026','original-2026']]),
    ['INC-2026'],
    { packageId:'test-full-dataset', aggregation:'per-source-row',
      normalizeKey:normalize, currentRecordCount:2, expectedRecordCount:3,
      finalRecordKeys:['INC-2024','INC-2025','INC-2026'] }
  );
  assert.equal(firstKnown.coverage,'partial');
  assert.equal(firstKnown.rows.length,1);
  assert.deepEqual(Array.from(firstKnown.recordKeys),['inc-2026']);

  const afterSecond = fullDatasetContract.mergeAligned(
    firstKnown, firstKnown.recordKeys,
    source(['Номер','Unknown Raw','Added Field'],[['INC-2025','original-2025','added']]),
    ['INC-2025'],
    { packageId:'test-full-dataset',aggregation:'per-source-row',
      normalizeKey:normalize,currentRecordCount:3,expectedRecordCount:3,
      finalRecordKeys:['INC-2024','INC-2025','INC-2026'] }
  );
  assert.equal(afterSecond.coverage,'partial');
  assert.deepEqual(Array.from(afterSecond.recordKeys),['inc-2025','inc-2026']);
  assert.deepEqual(Array.from(afterSecond.rows[1]),['INC-2026','original-2026',null]);

  const completed = fullDatasetContract.mergeAligned(
    afterSecond, afterSecond.recordKeys,
    source(['Номер','Unknown Raw'],[['INC-2024','original-2024']]),
    ['INC-2024'],
    { packageId:'test-full-dataset',aggregation:'per-source-row',
      normalizeKey:normalize,currentRecordCount:3,expectedRecordCount:3,
      finalRecordKeys:['INC-2024','INC-2025','INC-2026'] }
  );
  assert.equal(completed.coverage,'complete');
  assert.deepEqual(Array.from(completed.recordKeys),['inc-2024','inc-2025','inc-2026']);
  assert.deepEqual(Array.from(completed.rows,row=>Array.from(row)),[
    ['INC-2024','original-2024',null],
    ['INC-2025','original-2025','added'],
    ['INC-2026','original-2026',null]
  ]);
  const updated = fullDatasetContract.mergeAligned(
    completed,completed.recordKeys,
    source(['Номер','Unknown Raw'],[['INC-2025','changed-2025']]),
    ['INC-2025'],
    {packageId:'test-full-dataset',aggregation:'per-source-row',
      normalizeKey:normalize,currentRecordCount:3,expectedRecordCount:3,
      finalRecordKeys:['INC-2024','INC-2025','INC-2026']}
  );
  assert.equal(updated.coverage,'complete');
  assert.equal(updated.rows[1][1],'changed-2025');
  assert.equal(updated.rows[0][1],'original-2024');
  assert.equal(completed.rows[1][1],'original-2025',
    'UPSERT must not mutate a previous Full Dataset revision.');
  assert.throws(() => fullDatasetContract.mergeAligned(
    firstKnown, ['wrong-key'],
    source(['Номер','Unknown Raw'],[['INC-2025','x']]),
    ['INC-2025'],
    {packageId:'test-full-dataset',aggregation:'per-source-row',
      currentRecordCount:3,expectedRecordCount:3,
      finalRecordKeys:['INC-2024','INC-2025','INC-2026']}
  ),/отсутствующие в аналитике/);


    const baseline = instance('customers', 'original');
  pipeline.setActive('customers', baseline);
  await pipeline.prepare('customers', [{ name: 'bad.xlsx' }], async () => instance('customers', 'bad', 'invalid'));
  assert.strictEqual(pipeline.get('customers').active, baseline);
  assert.strictEqual(context.window.ReclassifierDatasetStore.get('customers'), baseline);
  assert.strictEqual(context.state.references.customers, baseline);
  assert.throws(() => pipeline.commit('customers'));

  await pipeline.prepare('customers', [{ name: 'empty.xlsx' }], async () => ({
    id: 'customers', records: [], validation: { status: 'warning', errors: [], warnings: ['empty'] }
  }));
  assert.throws(() => pipeline.commit('customers'));
  assert.strictEqual(pipeline.get('customers').active, baseline);

  await pipeline.prepare('customers', [{ name: 'broken.xlsx' }], async () => { throw Error('parse failed'); });
  assert.equal(pipeline.get('customers').candidate.validation.status, 'invalid');
  assert.strictEqual(pipeline.get('customers').active, baseline);

  const replacement = instance('customers', 'replacement', 'warning');
  await pipeline.prepare('customers', [{ name: 'good.xlsx' }], async () => replacement);
  assert.strictEqual(pipeline.get('customers').active, baseline);
  assert.strictEqual(pipeline.commit('customers'), replacement);
  assert.equal(pipeline.get('customers').candidate, null);

  let resolveOld;
  const old = pipeline.prepare('customers', [{ name: 'old.xlsx' }], () => new Promise(resolve => { resolveOld = resolve; }));
  const latest = instance('customers', 'latest');
  await pipeline.prepare('customers', [{ name: 'latest.xlsx' }], async () => latest);
  resolveOld(instance('customers', 'stale'));
  await old;
  assert.strictEqual(pipeline.get('customers').candidate, latest);
  pipeline.discard('customers');
  assert.strictEqual(pipeline.get('customers').active, replacement);
  assert.strictEqual(context.state.referenceMeta.customers, replacement.meta);
  assert.throws(() => vm.runInContext("'use strict'; state.references = {}", context), /only a getter/);
  await pipeline.prepare('exceptions', [{ name: 'empty.xlsx' }], async () => ({
    id: 'exceptions', records: [], validation: { status: 'valid', errors: [], warnings: [] }
  }));
  assert.equal(pipeline.commit('exceptions').records.length, 0);

  const batchCustomersBaseline = pipeline.active('customers');
  const batchItsmBaseline = instance('itsm_data', 'itsm-original');
  pipeline.setActive('itsm_data', batchItsmBaseline);

  const batchCustomersNext = instance('customers', 'batch-customers');
  const batchItsmInvalid = instance('itsm_data', 'batch-invalid', 'invalid');
  assert.throws(
    () => pipeline.setActiveBatch([batchCustomersNext, batchItsmInvalid]),
    /Нельзя применить некорректный набор данных/
  );
  assert.strictEqual(pipeline.active('customers'), batchCustomersBaseline,
    'Invalid batch partially replaced Customers.');
  assert.strictEqual(pipeline.active('itsm_data'), batchItsmBaseline,
    'Invalid batch partially replaced ITSM.');

  assert.throws(
    () => pipeline.setActiveBatch([batchCustomersNext, batchCustomersNext]),
    /Повторный/
  );
  assert.strictEqual(pipeline.active('customers'), batchCustomersBaseline);

  const batchItsmNext = instance('itsm_data', 'batch-itsm');
  const committedBatch = pipeline.setActiveBatch([batchCustomersNext, batchItsmNext]);
  assert.equal(committedBatch.length, 2);
  assert.strictEqual(pipeline.active('customers'), batchCustomersNext);
  assert.strictEqual(pipeline.active('itsm_data'), batchItsmNext);

  context.ReclassifierRuntimeDataRepository = {
    get: id => context.window.ReclassifierLegacyDatasetStore.get(id),
    records: id => context.window.ReclassifierLegacyDatasetStore.records(id),
    list: () => context.window.ReclassifierLegacyDatasetStore.list(),
    assertLegacyWriteAllowed() { throw Error('SQLite authoritative'); }
  };
  assert.throws(
    () => pipeline.setActive('customers', instance('customers', 'blocked')),
    /SQLite authoritative/
  );
  delete context.ReclassifierRuntimeDataRepository;

  console.log('dataset pipeline: OK');
})().catch(error => { console.error(error); process.exitCode = 1; });
