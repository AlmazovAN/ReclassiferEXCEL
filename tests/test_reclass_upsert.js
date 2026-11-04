const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '../src/js/references/reference_manager.js'), 'utf8');

let active = {
  id: 'reclassification',
  records: [
    { number: 'INC1', equipment: 'A' },
    { number: 'INC2', equipment: 'B' },
    { number: 'INC3', equipment: 'C' }
  ],
  validation: { status: 'valid', errors: [], warnings: [] },
  meta: { schemaVersion: '1.2.0', sourceType: 'embedded' }
};

const context = vm.createContext({
  Object, Array, Map, Set, Date, Error, String, Math, JSON, performance,
  moduleConfig: {},
  state: { references: { reclassification: active } },
  referenceConfig: {
    reclassification: {
      title: 'Reclassification / ReClass',
      schemaVersion: '1.2.0',
      generatedOnly: false,
      freshnessPolicy: 'max_date'
    }
  },
  RECLASSIFICATION_SCHEMA: {
    version: '1.2.0',
    columns: [
      ['dateRegistered', 'Дата регистрации'],
      ['dateCompleted', 'Дата выполнения обращения'],
      ['territory', 'Территории MES'],
      ['number', 'Номер'],
      ['equipment', 'Наименование оборудования'],
      ['element', 'Элемент'],
      ['fault', 'Неисправность'],
      ['incidentReason', 'Причина инцидента'],
      ['description', 'Описание'],
      ['closureNote', 'Примечание к закрытию']
    ]
  },
  datasetStore: {
    get: id => id === 'reclassification' ? active : null,
    records: id => id === 'reclassification' ? active.records : []
  },
  ReclassifierDatasetLifecycleManager: {
    activate: (id, instance) => {
      if (id !== 'reclassification') throw Error('unexpected id');
      active = instance;
      context.state.references.reclassification = instance;
      return instance;
    },
    prepare() { throw Error('not used'); },
    commit() { throw Error('not used'); },
    fingerprintFile() { throw Error('not used'); }
  },
  log() {},
  build: {},
  window: {},
  atob() {},
  TextDecoder,
  Blob,
  DecompressionStream,
  Uint8Array,
  normalizeDriversWorkbook() {},
  normalizeCustomersWorkbook() {},
  normalizeTypeRequestWorkbook() {},
  normalizeReclassificationWorkbook() {},
  normalizeInitiatorsWorkbook() {},
  normalizeExceptionsWorkbook() {},
  normalizeProblemGradeWorkbook() {},
  DRIVERS_SCHEMA: { version: '1.0.0' },
  CUSTOMERS_SCHEMA: { version: '1.1.0' },
  TYPE_REQUEST_SCHEMA: { version: '1.0.0' },
  INITIATORS_SCHEMA: { version: '1.0.0' },
  EXCEPTIONS_SCHEMA: { version: '1.0.0' },
  PROBLEM_GRADE_SCHEMA: { version: '1.0.0' },
  MOBILE_BRIGADE_DATA_SCHEMA: { version: '1.3.0' }
});

vm.runInContext(source, context);
const manager = context.window.ReclassifierReferenceManager;

const prepared = manager.prepareReclassificationUpsert([
  { number: 'INC2', equipment: 'B2' },
  { number: 'INC3', equipment: 'C2' },
  { number: 'INC4', equipment: 'D' }
], { fileName: 'result.xlsx' });

assert.deepStrictEqual(
  JSON.parse(JSON.stringify(prepared.plan)),
  {
    currentRows: 3,
    currentUniqueNumbers: 3,
    currentDuplicateNumbers: 0,
    currentRowsWithoutNumber: 0,
    incomingRows: 3,
    incomingUniqueNumbers: 3,
    incomingDuplicateNumbers: 0,
    matchedNumbers: 2,
    addedNumbers: 1,
    unchangedCurrentRows: 1,
    finalRows: 4
  }
);

assert.strictEqual(prepared.instance.records.length, 4);
assert.strictEqual(prepared.instance.records.find(row => row.number === 'INC1').equipment, 'A');
assert.strictEqual(prepared.instance.records.find(row => row.number === 'INC2').equipment, 'B2');
assert.strictEqual(prepared.instance.records.find(row => row.number === 'INC3').equipment, 'C2');
assert.strictEqual(prepared.instance.records.find(row => row.number === 'INC4').equipment, 'D');

manager.applyReplacement(prepared.instance);
assert.strictEqual(active.records.length, 4);
assert.strictEqual(active.meta.updateMode, 'upsert_by_number');
assert.strictEqual(active.meta.upsertPlan.matchedNumbers, 2);

const duplicateIncoming = manager.prepareReclassificationUpsert([
  { number: 'INC2', equipment: 'first' },
  { number: 'INC2', equipment: 'last' }
]);
assert.strictEqual(duplicateIncoming.plan.incomingDuplicateNumbers, 1);
assert.strictEqual(duplicateIncoming.instance.records.find(row => row.number === 'INC2').equipment, 'last');

assert.throws(() => manager.prepareReclassificationUpsert([
  { number: null, equipment: 'no-key' }
]), /без «Номер»/);

console.log('RE-CLASS UPSERT preview and merge by Номер: OK');
