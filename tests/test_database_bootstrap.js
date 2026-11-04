const fs = require('fs');
const vm = require('vm');

const catalogSource = fs.readFileSync('src/js/app/dataset_catalog.js', 'utf8');
const contractSource = fs.readFileSync('src/js/app/database_contract.js', 'utf8');
const bootstrapSource = fs.readFileSync('src/js/app/database_bootstrap.js', 'utf8');

const context = {
  console,
  globalThis: null,
  Map,
  Date,
  JSON,
  Array,
  Object,
  String
};
context.globalThis = context;

vm.createContext(context);
vm.runInContext(catalogSource, context, { filename: 'dataset_catalog.js' });
vm.runInContext(contractSource, context, { filename: 'database_contract.js' });

const contract = context.ReclassifierDatabaseContract;
const instances = new Map();
for (const [id, definition] of Object.entries(contract.datasets)) {
  if (definition.persisted === false) continue;
  let records = [{ value: id }];
  let meta = {
    sourceType: 'embedded',
    sourceKind: 'tracked-baseline',
    fileName: id + '.xlsx',
    schemaVersion: definition.schemaVersion,
    dataFingerprint: id + '-hash',
    sourceRows: 1,
    normalizedRows: 1,
    latestSourceDate: '2026-09-25',
    earliestSourceDate: '2026-09-04'
  };
  if (id === 'itsm_data') {
    records = [['INC-1', '2026-09-25']];
    meta = { ...meta, fields: ['number', 'date'], columns: ['Номер', 'Дата'],
      lastImportedRulesVersion: 'test-itsm-rules' };
  }
  if (id === 'mobile_brigade_data') {
    records = [{ recordKey: 'north:1', request: 'INC-1' }];
    meta = { ...meta, lastImportedRulesVersion: 'test-mb-rules',
      itsmLinkContractVersion: '1.0.0' };
  }
  if (id === 'transport_start_points' || id === 'exceptions') records = [];
  const instance = { id, records, meta };
  if (id === 'itsm_data') {
    instance.fullDataset = {
      schemaVersion: '1.0.0',
      package: 'itsm-full-dataset',
      aggregation: 'per-source-row',
      fieldCount: 3,
      columns: ['Номер', 'Дата', 'TEST_UNKNOWN_COLUMN'],
      rows: [['INC-1', '2026-09-25', 'preserved']]
    };
  }
  if (id === 'mobile_brigade_data') {
    instance.fullDataset = {
      schemaVersion: '1.0.0',
      package: 'mobile-brigade-full-dataset',
      aggregation: 'per-task-row',
      fieldCount: 2,
      columns: ['Номер задачи', 'TEST_UNKNOWN_COLUMN'],
      rows: [['INC-1', 'preserved']]
    };
  }
  if (id === 'transport_start_points') {
    instance.joinIndex = new Map([['unit|camera', { transportId: 'TR-1' }]]);
  }
  instances.set(id, instance);
}

context.ReclassifierLegacyDatasetStore = {
  get: id => instances.get(id) || null
};
context.ReclassifierItsmDatasetSchema = {
  fields: ['number', 'date'],
  labels: ['Номер', 'Дата']
};
vm.runInContext(bootstrapSource, context, { filename: 'database_bootstrap.js' });

const bootstrap = context.ReclassifierDatabaseBootstrap;
if (!bootstrap?.collectSeeds) throw new Error('Bootstrap adapter is not exported.');
const seeds = bootstrap.collectSeeds();
const expected = Object.values(contract.datasets).filter(value => value.persisted !== false).length;
if (seeds.length !== expected) throw new Error('Not all persisted Dataset were collected.');
if (seeds.some(seed => seed.id === 'combined')) {
  throw new Error('Derived Equipment_Combined must not be copied into SQLite.');
}

const itsm = seeds.find(seed => seed.id === 'itsm_data');
if (itsm?.options?.state?.fields?.[0] !== 'number' ||
    itsm.records[0][0] !== 'INC-1') {
  throw new Error('ITSM fields and source rows were lost.');
}
if (itsm.options.state.lastImportedRulesVersion !== 'test-itsm-rules') {
  throw new Error('SQLite bootstrap lost ITSM source rule provenance.');
}
if (itsm.options.sourceFileName !== 'itsm_data.xlsx' ||
    itsm.options.contentHash !== 'itsm_data-hash' ||
    itsm.options.freshnessFrom !== '2026-09-04' ||
    itsm.options.freshnessTo !== '2026-09-25') {
  throw new Error('Bootstrap must preserve source metadata and freshness.');
}
if (itsm.options.fullDataset?.columns?.[2] !== 'TEST_UNKNOWN_COLUMN' ||
    itsm.options.fullDataset?.rows?.[0]?.[2] !== 'preserved') {
  throw new Error('Bootstrap lost ITSM Full Dataset.');
}
const mbSeed = seeds.find(seed => seed.id === 'mobile_brigade_data');
if (mbSeed.options.state.lastImportedRulesVersion !== 'test-mb-rules' ||
    mbSeed.options.state.itsmLinkContractVersion !== '1.0.0') {
  throw new Error('SQLite bootstrap lost MB processing / ITSM link provenance.');
}
if (mbSeed.options.fullDataset?.columns?.[1] !== 'TEST_UNKNOWN_COLUMN' ||
    mbSeed.options.fullDataset?.rows?.[0]?.[1] !== 'preserved') {
  throw new Error('Bootstrap lost Mobile Brigade Full Dataset.');
}

// A previously analytic-only row must not erase later complete raw source rows
// when a user deploys a new SQLite database from an HTML snapshot.
const mb = instances.get('mobile_brigade_data');
mb.records.push({ recordKey: 'north:2', request: 'INC-2' });
mb.fullDataset.coverage = 'partial';
mb.fullDataset.recordKeys = ['north:1'];
mb.meta.fullDatasetScope = 'partial';
const partialSeeds = bootstrap.collectSeeds();
const partialMb = partialSeeds.find(seed => seed.id === 'mobile_brigade_data');
if (!partialMb.options.allowSparseFullDataset ||
    partialMb.options.fullDataset.rows.length !== 1 ||
    partialMb.options.fullDataset.recordKeys[0] !== 'north:1' ||
    partialMb.options.details.fullDatasetScope !== 'partial') {
  throw new Error('Keyed partial Full Dataset must survive HTML -> SQLite bootstrap.');
}
delete mb.fullDataset.recordKeys;
assertPartialRejected();
function assertPartialRejected() {
  let rejected = false;
  try { bootstrap.collectSeeds(); } catch (error) {
    rejected = /recordKeys/.test(error.message);
  }
  if (!rejected) throw new Error('Unkeyed partial Full Dataset must fail before database writes.');
}
mb.records.pop();
mb.fullDataset.coverage = 'complete';
mb.meta.fullDatasetScope = 'complete';

const startPoints = seeds.find(seed => seed.id === 'transport_start_points');
if (startPoints.records.length !== 0 ||
    startPoints.options.state.joinIndex?.[0]?.[1]?.transportId !== 'TR-1') {
  throw new Error('Equipment service joinIndex / allow-empty state was lost.');
}
if (!seeds.find(seed => seed.id === 'mobile_brigade_data')?.records?.[0]?.recordKey) {
  throw new Error('Mobile Brigade stable key was lost.');
}

instances.delete('drivers');
let missingRejected = false;
try {
  bootstrap.collectSeeds();
} catch (error) {
  missingRejected = /Drivers/.test(error.message);
}
if (!missingRejected) {
  throw new Error('Incomplete HTML baseline must block full bootstrap.');
}

console.log('SQLite embedded Dataset bootstrap adapter: OK');
