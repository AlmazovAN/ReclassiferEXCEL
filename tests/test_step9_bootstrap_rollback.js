// Step 9: prove atomic embedded deployment and recovery on real SQLite WASM.
// No partially written Dataset, registry revision or bootstrap audit may survive.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const root = path.join(__dirname, '..');
const fullDir = path.resolve(process.env.RECLASSIFIER_HTML_DIR || path.join(root, 'dist'));
const builds = fs.readdirSync(fullDir).filter(n => /^Reclassifier_v.*_CORE\.html$/.test(n));
assert.strictEqual(builds.length, 1);
const html = fs.readFileSync(path.join(fullDir, builds[0]), 'utf8');
const vendor = html.match(/<script id="sqliteVendorSource">([\s\S]*?)<\/script>/);
const wasm = html.match(/"sqliteWasmBase64": "([A-Za-z0-9+/=]+)"/);
assert(vendor && wasm);
vm.runInThisContext(vendor[1]);
vm.runInThisContext(fs.readFileSync(path.join(root, 'src/js/app/dataset_catalog.js'), 'utf8'));
vm.runInThisContext(fs.readFileSync(path.join(root, 'src/js/app/database_contract.js'), 'utf8'));
new Function('assets', 'build', 'log',
  fs.readFileSync(path.join(root, 'src/js/app/database_core.js'), 'utf8')
)({ sqliteWasmBase64: wasm[1] }, { version: 'step9' }, () => {});

const driverSeed = {
  id: 'drivers', records: [{ mine: 'Северный', name: 'БКМ' }],
  options: { state: { schemaVersion: '1.0.0' } }
};
const itsmSeed = {
  id: 'itsm_data',
  records: Array.from({ length: 1200 }, (_, n) => ['INC-' + n, n]),
  options: { state: { fields: ['number', 'count'], schemaVersion: '1.1.0' } }
};
const mbSeed = {
  id: 'mobile_brigade_data',
  records: Array.from({ length: 1200 }, (_, n) => ({
    recordKey: 'Северный|' + n, request: 'INC-' + n
  })),
  options: { state: { schemaVersion: '1.4.0' } }
};

(async () => {
  const db = globalThis.ReclassifierDatabaseRepository;
  await db.createDatabase({ appVersion: 'step9' });
  const duplicate = {
    ...itsmSeed,
    records: [...itsmSeed.records, [' inc-0 ', 777]]
  };
  await assert.rejects(
    () => db.bootstrapDatasets([driverSeed, duplicate]),
    /повторяется ключ/
  );
  assert.strictEqual(Number(db.getDatasetRegistry('drivers').active_revision), 0);
  assert.strictEqual(Number(db.getDatasetRegistry('itsm_data').record_count), 0);
  assert.strictEqual(db.getImportHistory(null, 10).length, 0);

  let interrupted = false;
  await assert.rejects(
    () => db.bootstrapDatasets([driverSeed, itsmSeed, mbSeed], p => {
      if (p.datasetId === 'mobile_brigade_data' &&
          p.copiedRows >= driverSeed.records.length + itsmSeed.records.length + 1000) {
        interrupted = true;
        throw new Error('Simulated interrupted bootstrap');
      }
    }),
    /Simulated interrupted bootstrap/
  );
  assert(interrupted);
  assert.strictEqual(Number(db.getDatasetRegistry('drivers').active_revision), 0);
  assert.strictEqual(Number(db.getDatasetRegistry('itsm_data').record_count), 0);
  assert.strictEqual(Number(db.getDatasetRegistry('mobile_brigade_data').record_count), 0);
  assert.strictEqual(db.getImportHistory(null, 10).length, 0);

  let lastProgress = null;
  const outcome = await db.bootstrapDatasets([driverSeed, itsmSeed, mbSeed], p => {
    lastProgress = p;
  });
  assert.strictEqual(outcome.completedDatasets, 3);
  assert.strictEqual(outcome.totalRows, 2401);
  assert.strictEqual(lastProgress.copiedRows, 2401);
  assert.strictEqual(Number(db.getDatasetRegistry('itsm_data').record_count), 1200);
  assert.strictEqual(Number(db.getDatasetRegistry('mobile_brigade_data').record_count), 1200);
  assert.strictEqual(db.getImportHistory(null, 10).length, 3);

  const kpiRows = [['ITSM', 2026, 10, '2026-10-01', 'ЗФ', 'Октябрьский']];
  const atomicItsm = await db.upsertDatasetAsync(
    'itsm_data',
    [['INC-0', 900], ['INC-NEW', 1]],
    { state: { fields: ['number', 'count'], schemaVersion: '1.1.0' } },
    () => {},
    () => false,
    [{
      id: 'kpi_source',
      records: kpiRows,
      options: {
        state: {
          fields: ['rowType', 'year', 'month', 'period', 'branch', 'mine'],
          columns: ['RowType', 'Year', 'Month', 'Period', 'Branch', 'Mine'],
          schemaVersion: '1.0.0'
        },
        sourceFileName: 'ITSM_atomic.xlsx'
      }
    }]
  );
  assert.strictEqual(atomicItsm.atomicResults.length, 1);
  assert.strictEqual(atomicItsm.atomicResults[0].datasetId, 'kpi_source');
  assert.deepStrictEqual(db.getDataset('kpi_source').records, kpiRows);
  const itsmAfterAtomic = db.getDataset('itsm_data').records;
  const inc0AfterAtomic = itsmAfterAtomic.find(row => row[0] === 'INC-0');
  assert.strictEqual(inc0AfterAtomic[1], 900);

  const brokenKpi = { rowType: 'broken' };
  brokenKpi.self = brokenKpi;
  await assert.rejects(
    () => db.upsertDatasetAsync(
      'itsm_data',
      [['INC-0', 901]],
      { state: { fields: ['number', 'count'], schemaVersion: '1.1.0' } },
      () => {},
      () => false,
      [{ id: 'kpi_source', records: [brokenKpi], options: { sourceFileName: 'broken.xlsx' } }]
    ),
    /circular|cyclic/i
  );
  assert.strictEqual(
    db.getDataset('itsm_data').records.find(row => row[0] === 'INC-0')[1],
    900,
    'Failed KPI companion must roll back the ITSM UPSERT.'
  );
  assert.deepStrictEqual(
    db.getDataset('kpi_source').records,
    kpiRows,
    'Failed KPI companion must preserve the previous KPI Source.'
  );

  const driversBeforeBatch = db.getDataset('drivers').records;
  const driversRevisionBeforeBatch = Number(db.getDatasetRegistry('drivers').active_revision);
  const customersRevisionBeforeBatch = Number(db.getDatasetRegistry('customers').active_revision);
  const circularCustomer = { name: 'broken-customer' };
  circularCustomer.self = circularCustomer;

  assert.throws(
    () => db.replaceDatasetBatch([
      {
        id: 'drivers',
        records: [{ mine: 'Таймырский', name: 'БКМ-NEW' }],
        options: { sourceFileName: 'Drivers_batch.xlsx' }
      },
      {
        id: 'customers',
        records: [circularCustomer],
        options: { sourceFileName: 'Customers_broken.xlsx' }
      }
    ]),
    /circular|cyclic/i
  );
  assert.deepStrictEqual(db.getDataset('drivers').records, driversBeforeBatch);
  assert.strictEqual(
    Number(db.getDatasetRegistry('drivers').active_revision),
    driversRevisionBeforeBatch
  );
  assert.strictEqual(
    Number(db.getDatasetRegistry('customers').active_revision),
    customersRevisionBeforeBatch
  );

  const batch = db.replaceDatasetBatch([
    {
      id: 'drivers',
      records: [{ mine: 'Таймырский', name: 'БКМ-NEW' }],
      options: { sourceFileName: 'Drivers_batch.xlsx' }
    },
    {
      id: 'customers',
      records: [{ customer: 'Новый заказчик' }],
      options: { sourceFileName: 'Customers_batch.xlsx' }
    }
  ]);
  assert.strictEqual(batch.results.length, 2);
  assert.deepStrictEqual(db.getDataset('drivers').records, [
    { mine: 'Таймырский', name: 'БКМ-NEW' }
  ]);
  assert.deepStrictEqual(db.getDataset('customers').records, [
    { customer: 'Новый заказчик' }
  ]);
  assert.strictEqual(
    Number(db.getDatasetRegistry('drivers').active_revision),
    driversRevisionBeforeBatch + 1
  );
  assert.strictEqual(
    Number(db.getDatasetRegistry('customers').active_revision),
    customersRevisionBeforeBatch + 1
  );

  assert(db.runHealthCheck().ok);
  console.log('Step9 bootstrap + atomic REPLACE batch rollback/retry: OK');
  db.closeDatabase();
})().catch(e => { console.error(e); process.exitCode = 1; });
