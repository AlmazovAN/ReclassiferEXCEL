const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const context = vm.createContext({
  state: {},
  window: {},
  referenceConfig: {},
  equipmentConfig: {},
  Date, Map, Set, Error, Uint8Array, Object, Array,
  ReclassifierDatasetCatalog: {
    list: () => [
      { id: 'alpha', kind: 'reference', schemaVersion: '1.0.0', allowEmpty: false },
      { id: 'beta', kind: 'events', schemaVersion: '2.0.0', allowEmpty: true }
    ]
  }
});

vm.runInContext(read('src/js/app/dataset_pipeline.js'), context);
vm.runInContext(read('src/js/app/dataset_lifecycle.js'), context);

const lifecycle = context.ReclassifierDatasetLifecycleManager;
const pipeline = vm.runInContext('datasetPipeline', context);

function instance(id, value, schemaVersion, status = 'valid') {
  return {
    id,
    file: null,
    records: value === null ? [] : [{ value }],
    validation: {
      status,
      errors: status === 'invalid' ? ['invalid'] : [],
      warnings: status === 'warning' ? ['warning'] : []
    },
    meta: {
      schemaVersion,
      fileName: id + '.xlsx',
      fileSize: 123,
      loadedAt: '2026-10-01T00:00:00.000Z',
      sourceType: 'user'
    }
  };
}

(async () => {
  assert(lifecycle);
  assert.equal(lifecycle.active('alpha'), null);
  assert.equal(lifecycle.candidate('alpha'), null);

  const baseline = instance('alpha', 'baseline', '1.0.0');
  assert.strictEqual(
    lifecycle.initialize('alpha', baseline, { recordHistory: true }),
    baseline
  );
  assert.strictEqual(lifecycle.active('alpha'), baseline);
  assert.equal(lifecycle.history('alpha').length, 1);
  assert.equal(lifecycle.history('alpha')[0].action, 'loaded');
  assert.throws(
    () => lifecycle.initialize('alpha', instance('alpha', 'second', '1.0.0')),
    /уже инициализирован/
  );

  const replacement = instance('alpha', 'replacement', '1.0.0', 'warning');
  await lifecycle.prepare('alpha', [{ name: 'replacement.xlsx' }], async () => replacement);
  assert.strictEqual(lifecycle.candidate('alpha'), replacement);
  assert.strictEqual(lifecycle.active('alpha'), baseline);
  assert.strictEqual(
    lifecycle.commit('alpha', { recordHistory: true }),
    replacement
  );
  assert.strictEqual(lifecycle.active('alpha'), replacement);
  assert.equal(lifecycle.history('alpha').length, 2);
  assert.equal(lifecycle.history('alpha')[0].action, 'updated');
  assert.equal(lifecycle.history('alpha')[0].validationStatus, 'warning');

  const invalid = instance('alpha', 'bad', '1.0.0', 'invalid');
  await lifecycle.prepare('alpha', [{ name: 'bad.xlsx' }], async () => invalid);
  assert.throws(() => lifecycle.commit('alpha'), /Нет проверенного кандидата/);
  assert.strictEqual(lifecycle.active('alpha'), replacement);
  lifecycle.discard('alpha');
  assert.equal(lifecycle.candidate('alpha'), null);

  const emptyBeta = instance('beta', null, '2.0.0');
  lifecycle.activate('beta', emptyBeta);
  assert.strictEqual(lifecycle.assertApplied(emptyBeta), emptyBeta);
  assert.throws(
    () => lifecycle.assertApplied(instance('beta', null, '2.0.0')),
    /не является активным/
  );

  const nextAlpha = instance('alpha', 'batch', '1.0.0');
  const nextBeta = instance('beta', null, '2.0.0');
  const batch = lifecycle.activateBatch([nextAlpha, nextBeta]);
  assert.equal(batch.length, 2);
  assert.strictEqual(lifecycle.active('alpha'), nextAlpha);
  assert.strictEqual(lifecycle.active('beta'), nextBeta);

  // Failed batch validation must preserve both active instances.
  assert.throws(
    () => lifecycle.activateBatch([
      instance('alpha', 'would-change', '1.0.0'),
      instance('beta', null, '9.9.9')
    ]),
    /некорректный набор данных/
  );
  assert.strictEqual(lifecycle.active('alpha'), nextAlpha);
  assert.strictEqual(lifecycle.active('beta'), nextBeta);

  // Fingerprints are lifecycle provenance, not Reference-specific behavior.
  const file = {
    arrayBuffer: async () => Uint8Array.from([1, 2, 3, 4]).buffer
  };
  const first = await lifecycle.fingerprintFile(file);
  const second = await lifecycle.fingerprintFile(file);
  assert.equal(first, second);
  assert(first.length >= 16);

  // Manager is a facade: low-level pipeline state still matches it exactly.
  assert.strictEqual(pipeline.active('alpha'), lifecycle.active('alpha'));

  console.log('Dataset Lifecycle Manager: neutral lifecycle, history and batch activation: OK');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
