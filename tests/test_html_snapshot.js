const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const source = ['dataset_catalog.js', 'dataset_pipeline.js', 'dataset_lifecycle.js', 'html_snapshot.js'].map(name =>
  fs.readFileSync(path.join(__dirname, '../src/js/app', name), 'utf8')
).join('\n');

function application() {
  const logs = [];
  const script = { textContent: '' };
  let downloaded;
  const context = vm.createContext({
    state: { baselineReady: true }, build: { version: 'test' },
    referenceConfig: { customers: {}, mobile_brigade_data: {} }, equipmentConfig: {},
    window: {}, TextEncoder, TextDecoder, Blob, Response, CompressionStream, DecompressionStream,
    fetch: () => { throw Error('Network access is blocked'); },
    Uint8Array, Date, Map, Error, btoa, atob,
    document: {
      getElementById: () => script,
      documentElement: { cloneNode: () => {
        const cloneScript = { textContent: script.textContent };
        const page = { textContent: 'uncommitted private preview' };
        const title = { textContent: 'Dynamic report heading' };
        const header = { textContent: 'Dynamic report description' };
        return {
          querySelector: selector => ({
            '#pageContent':page, '#reclassifierDataPack':cloneScript,
            '#pageTitle':title, '#pageDescription':header
          })[selector] || null,
          querySelectorAll: () => [],
          get outerHTML() { return '<html><body><section id="pageContent">' + page.textContent +
            '</section><h1 id="pageTitle">' + title.textContent + '</h1>' +
            '<p id="pageDescription">' + header.textContent + '</p>' +
            '<script type="application/json" id="reclassifierDataPack">' +
            cloneScript.textContent + '</script></body></html>'; }
        };
      } },
      createElement: () => ({ style: {}, click() {}, remove() {} }),
      body: { appendChild() {} }
    },
    URL: { createObjectURL: blob => { downloaded = blob; return 'blob:test'; }, revokeObjectURL() {} },
    setTimeout: () => 0, formatBytes: size => String(size), log: message => logs.push(message)
  });
  vm.runInContext(source, context);
  const pipeline = vm.runInContext('datasetPipeline', context);
  return { context, pipeline, script, logs, download: () => downloaded,
    run: expression => vm.runInContext(expression, context) };
}

const instance = (id, text, sourceType, schemaVersion) => ({
  id, records: [{ value: text }], validation: { status: 'valid', errors: [], warnings: [] },
  meta: { sourceType, schemaVersion, dataVersion: 'version-' + text }
});

(async () => {
  const first = application();
  first.pipeline.setActive('customers', instance('customers', 'updated', 'user', '1.1.0'));
  first.pipeline.setActive('mobile_brigade_data', instance('mobile_brigade_data', 'baseline', 'embedded', '1.5.0'));
  first.pipeline.setActive('itsm_data', instance('itsm_data', 'ITSM baseline', 'embedded', '1.2.0'));
  await first.pipeline.prepare('customers', [{ name: 'pending.xlsx' }], async () =>
    instance('customers', 'uncommitted', 'user', '1.1.0'));
  const pack = await first.run('buildDatasetPack()');
  assert.equal(pack.formatVersion, 2);
  assert.equal(pack.datasets.length, 1);
  assert.equal(pack.datasets[0].id, 'customers');
  assert.equal(pack.datasets[0].encoding, 'json/gzip+base64');
  const result = await first.run('downloadUpdatedHtml()');
  assert.equal(result.count, 1);
  const html = await first.download().text();
  assert.match(html, /^<!doctype html>/);
  assert.ok(!html.includes('uncommitted private preview'));
  const embedded = JSON.parse(html.match(/id="reclassifierDataPack">([^<]+)<\/script>/)[1]);
  assert(!html.includes('Dynamic report heading'), 'Export must reset route heading');

  // An application-only copy must not embed an existing HTML snapshot pack.
  first.script.textContent = JSON.stringify({ confidential: 'stale snapshot payload' });
  const applicationResult = first.run('downloadApplicationHtml()');
  assert.equal(applicationResult.mode, 'application');
  assert.match(applicationResult.fileName, /_Application_.*\.html$/);
  const applicationHtml = await first.download().text();
  assert(!applicationHtml.includes('stale snapshot payload'));
  assert.match(applicationHtml, /id="reclassifierDataPack"><\/script>/);
  assert(!applicationHtml.includes('uncommitted private preview'));
  assert.equal(first.script.textContent, '{"confidential":"stale snapshot payload"}',
    'Application export must never change currently loaded HTML snapshot');

  const reopened = application();
  reopened.script.textContent = JSON.stringify(embedded);
  assert.equal(await reopened.run('hydrateDatasetPack()'), 1);
  assert.equal(reopened.pipeline.active('customers').records[0].value, 'updated');
  assert.equal(reopened.pipeline.active('customers').meta.sourceType, 'snapshot');

  const damaged = application();
  damaged.pipeline.setActive('customers', instance('customers', 'baseline', 'embedded', '1.1.0'));
  damaged.script.textContent = JSON.stringify({ ...embedded,
    datasets: [{ ...embedded.datasets[0], checksum: '00000000' }] });
  assert.equal(await damaged.run('hydrateDatasetPack()'), 0);
  assert.equal(damaged.pipeline.active('customers').records[0].value, 'baseline');
  assert.ok(damaged.logs.some(message => /контрольная сумма/i.test(message)));

  const mbUpdated = instance('mobile_brigade_data', 'new MB', 'generated', '1.5.0');
  mbUpdated.records[0].factDate = '2026-09-15T12:00:00';
  mbUpdated.fullDataset = {
    schemaVersion: '1.0.0',
    package: 'mobile-brigade-full-dataset',
    aggregation: 'per-task-row',
    fieldCount: 3,
    columns: ['Номер задачи', 'TEST_UNKNOWN_COLUMN', 'Новая колонка МБ'],
    rows: [['TASK-1', 'mb-preserved', 'future-mb']],
    coverage: 'complete'
  };
  mbUpdated.meta.fullDatasetScope = 'complete';
  // Synthetic certified exports: metadata stays attached to each Dataset
  // through the HTML snapshot, rather than relying on event dates.
  mbUpdated.meta.reportingCoverage={
    confirmed:true,basis:'source-export-cutoff',
    coverageFrom:'2026-01-01',coverageThrough:'2026-09-15',
    certifiedBy:'user-explicit-dataset-attestation',
    scope:'entire-accumulated-dataset',certifiedAt:'2026-10-10T10:00:00Z'
  };
  mbUpdated.meta.fullDatasetFieldCount = 3;
  mbUpdated.meta.fullDatasetRows = 1;

  const itsmUpdated = instance('itsm_data', 'new ITSM', 'generated', '1.2.0');
  itsmUpdated.records[0].createdAt = '2026-09-16T08:00:00';
  itsmUpdated.fullDataset = {
    schemaVersion: '1.0.0',
    package: 'itsm-full-dataset',
    aggregation: 'per-source-row',
    fieldCount: 3,
    columns: ['Номер', 'TEST_UNKNOWN_COLUMN', 'Новая колонка ITSM'],
    rows: [['INC-1', 'itsm-preserved', 'future-itsm']],
    coverage: 'complete'
  };
  itsmUpdated.meta.fullDatasetScope = 'complete';
  itsmUpdated.meta.reportingCoverage={
    confirmed:true,basis:'source-export-cutoff',
    coverageFrom:'2026-01-01',coverageThrough:'2026-09-15',
    certifiedBy:'user-explicit-dataset-attestation',
    scope:'entire-accumulated-dataset',certifiedAt:'2026-10-10T10:00:00Z'
  };
  itsmUpdated.meta.fullDatasetFieldCount = 3;
  itsmUpdated.meta.fullDatasetRows = 1;

  first.pipeline.setActive('mobile_brigade_data', mbUpdated);
  first.pipeline.setActive('itsm_data', itsmUpdated);
  const mixed = await first.run('buildDatasetPack()');
  assert.equal(mixed.datasets.length, 3);
  assert.equal(
    mixed.datasets.map(item => item.id).join(','),
    'customers,mobile_brigade_data,itsm_data'
  );
  const mbEntry = mixed.datasets.find(item => item.id === 'mobile_brigade_data');
  const itsmEntry = mixed.datasets.find(item => item.id === 'itsm_data');
  assert.equal(mbEntry.fullDatasetFieldCount, 3);
  assert.equal(mbEntry.fullDatasetRowCount, 1);
  assert.equal(mbEntry.fullDatasetScope, 'complete');
  assert.equal(itsmEntry.fullDatasetFieldCount, 3);
  assert.equal(itsmEntry.fullDatasetRowCount, 1);
  assert.equal(itsmEntry.fullDatasetScope, 'complete');
  const atomic = application();
  atomic.pipeline.setActive('customers', instance('customers', 'safe customers', 'embedded', '1.1.0'));
  atomic.pipeline.setActive(
    'mobile_brigade_data',
    instance('mobile_brigade_data', 'safe MB', 'embedded', '1.5.0')
  );
  atomic.pipeline.setActive('itsm_data', instance('itsm_data', 'safe ITSM', 'embedded', '1.2.0'));

  // Corrupt the middle Dataset. The old implementation would already have
  // published Customers before discovering this failure and would continue to ITSM.
  atomic.context.testPack = { ...mixed, datasets: [
    mixed.datasets[0],
    { ...mixed.datasets[1], checksum: '00000000' },
    mixed.datasets[2]
  ] };
  await assert.rejects(
    () => atomic.run('restoreDatasetPack(globalThis.testPack)'),
    /контрольная сумма/i
  );
  assert.equal(atomic.pipeline.active('customers').records[0].value, 'safe customers');
  assert.equal(atomic.pipeline.active('mobile_brigade_data').records[0].value, 'safe MB');
  assert.equal(atomic.pipeline.active('itsm_data').records[0].value, 'safe ITSM');

  // Contract incompatibility is also detected before any Dataset is published.
  atomic.context.testPack = { ...mixed, datasets: [
    mixed.datasets[0],
    { ...mixed.datasets[1], schemaVersion: '0.0.0' },
    mixed.datasets[2]
  ] };
  await assert.rejects(
    () => atomic.run('restoreDatasetPack(globalThis.testPack)'),
    /версия схемы не соответствуют приложению/
  );
  assert.equal(atomic.pipeline.active('customers').records[0].value, 'safe customers');
  assert.equal(atomic.pipeline.active('mobile_brigade_data').records[0].value, 'safe MB');
  assert.equal(atomic.pipeline.active('itsm_data').records[0].value, 'safe ITSM');

  // A valid multi-Dataset pack is then published as one batch.
  atomic.context.testPack = mixed;
  assert.equal(await atomic.run('restoreDatasetPack(globalThis.testPack)'), 3);
  assert.equal(atomic.pipeline.active('customers').records[0].value, 'updated');
  assert.equal(atomic.pipeline.active('mobile_brigade_data').records[0].value, 'new MB');
  assert.equal(atomic.pipeline.active('itsm_data').records[0].value, 'new ITSM');
  assert.equal(atomic.pipeline.active('customers').meta.sourceType, 'snapshot');
  assert.equal(atomic.pipeline.active('mobile_brigade_data').meta.sourceType, 'snapshot');
  assert.equal(atomic.pipeline.active('itsm_data').meta.sourceType, 'snapshot');
  assert.deepEqual(
    Array.from(atomic.pipeline.active('mobile_brigade_data').fullDataset.columns),
    ['Номер задачи', 'TEST_UNKNOWN_COLUMN', 'Новая колонка МБ']
  );
  assert.equal(
    atomic.pipeline.active('mobile_brigade_data').fullDataset.rows[0][1],
    'mb-preserved'
  );
  assert.deepEqual(
    Array.from(atomic.pipeline.active('itsm_data').fullDataset.columns),
    ['Номер', 'TEST_UNKNOWN_COLUMN', 'Новая колонка ITSM']
  );
  assert.equal(
    atomic.pipeline.active('itsm_data').fullDataset.rows[0][1],
    'itsm-preserved'
  );
  assert.equal(atomic.pipeline.active('itsm_data').meta.fullDatasetScope, 'complete');
  // PR3: an HTML snapshot must restore both the analytical calendar key
  // and the original Full Dataset rows used by the actual Excel exporter.
  vm.runInContext(
    fs.readFileSync(path.join(__dirname, '../src/js/app/dataset_excel_export.js'), 'utf8'),
    atomic.context,
    { filename: 'dataset_excel_export.js' }
  );
  const periodExporter = atomic.context.ReclassifierDatasetExcelExport;
  const restoredMb = atomic.pipeline.active('mobile_brigade_data');
  const restoredItsm = atomic.pipeline.active('itsm_data');
  assert.equal(periodExporter.period('mobile_brigade_data', restoredMb).from, '2026-09-15');
  assert.equal(periodExporter.period('itsm_data', restoredItsm).from, '2026-09-16');
  const mbRows = periodExporter.selectRows(
    'mobile_brigade_data', restoredMb, '2026-09-15', '2026-09-15'
  );
  const itsmRows = periodExporter.selectRows(
    'itsm_data', restoredItsm, '2026-09-16', '2026-09-16'
  );
  assert.deepEqual(
    JSON.parse(JSON.stringify(mbRows.rows)), [['TASK-1', 'mb-preserved', 'future-mb']]
  );
  assert.deepEqual(
    JSON.parse(JSON.stringify(itsmRows.rows)), [['INC-1', 'itsm-preserved', 'future-itsm']]
  );
  assert.equal(restoredMb.meta.sourceType, 'snapshot');
  assert.equal(restoredItsm.meta.sourceType, 'snapshot');

  for(const id of ['itsm_data','mobile_brigade_data']){
    assert.deepEqual(
      JSON.parse(JSON.stringify(atomic.pipeline.active(id).meta.reportingCoverage)),
      JSON.parse(JSON.stringify(id==='itsm_data'
        ?itsmUpdated.meta.reportingCoverage:mbUpdated.meta.reportingCoverage))
    );
  }

  // PR1: partial Full Dataset must keep its real raw records and stable keys
  // through a portable HTML snapshot. The missing source row stays missing.
  const partial = application();
  const partialMb = instance('mobile_brigade_data','known','generated','1.5.0');
  partialMb.records = [
    {recordKey:'TASK-LEGACY',factDate:'2025-01-01'},
    {recordKey:'TASK-RAW',factDate:'2026-01-01'}
  ];
  partialMb.fullDataset = {
    schemaVersion:'1.0.0',package:'mobile-brigade-full-dataset',
    aggregation:'per-task-row',fieldCount:2,
    columns:['Номер задачи','Нестандартный исходный реквизит'],
    rows:[['TASK-RAW','source-value-preserved']],
    recordKeys:['TASK-RAW'],coverage:'partial'
  };
  partialMb.meta.fullDatasetScope='partial';
  partial.pipeline.setActive('mobile_brigade_data',partialMb);
  const partialPack = await partial.run('buildDatasetPack()');
  const partialEntry=partialPack.datasets.find(x=>x.id==='mobile_brigade_data');
  assert.equal(partialEntry.fullDatasetScope,'partial');
  assert.equal(partialEntry.fullDatasetRowCount,1);
  const restoredPartial=application();
  restoredPartial.context.partialPack=partialPack;
  assert.equal(await restoredPartial.run('restoreDatasetPack(globalThis.partialPack)'),1);
  const activePartial=restoredPartial.pipeline.active('mobile_brigade_data');
  assert.equal(activePartial.records.length,2);
  assert.equal(activePartial.meta.fullDatasetScope,'partial');
  assert.deepEqual(Array.from(activePartial.fullDataset.recordKeys),['TASK-RAW']);
  assert.equal(activePartial.fullDataset.rows[0][1],'source-value-preserved');
  const badPartial=JSON.parse(JSON.stringify(partialPack));
  const lastEntry=badPartial.datasets.find(x=>x.id==='mobile_brigade_data');
  // Even if a pack is otherwise signed, a forged "complete" marker cannot
  // promote one raw row into a two-row Full Dataset.
  lastEntry.fullDatasetScope='complete';
  restoredPartial.context.badPartial=badPartial;
  await assert.rejects(
    () => restoredPartial.run('restoreDatasetPack(globalThis.badPartial)'),
    /полный Full Dataset/
  );

  const hydrateAtomic = application();
  hydrateAtomic.pipeline.setActive(
    'customers', instance('customers', 'hydrate safe customers', 'embedded', '1.1.0')
  );
  hydrateAtomic.pipeline.setActive(
    'mobile_brigade_data',
    instance('mobile_brigade_data', 'hydrate safe MB', 'embedded', '1.5.0')
  );
  hydrateAtomic.pipeline.setActive(
    'itsm_data', instance('itsm_data', 'hydrate safe ITSM', 'embedded', '1.2.0')
  );
  hydrateAtomic.script.textContent = JSON.stringify({
    ...mixed,
    datasets: [
      mixed.datasets[0],
      { ...mixed.datasets[1], checksum: '00000000' },
      mixed.datasets[2]
    ]
  });
  assert.equal(await hydrateAtomic.run('hydrateDatasetPack()'), 0);
  assert.equal(hydrateAtomic.pipeline.active('customers').records[0].value, 'hydrate safe customers');
  assert.equal(hydrateAtomic.pipeline.active('mobile_brigade_data').records[0].value, 'hydrate safe MB');
  assert.equal(hydrateAtomic.pipeline.active('itsm_data').records[0].value, 'hydrate safe ITSM');
  assert.ok(hydrateAtomic.logs.some(message => message.includes('повреждён')));

  // Full Dataset metadata is validated after the payload checksum, so a
  // self-consistent Dataset entry cannot silently claim another row count.
  const invalidFullMeta = application();
  invalidFullMeta.context.testPack = {
    ...mixed,
    datasets: mixed.datasets.map(item => item.id === 'itsm_data'
      ? { ...item, fullDatasetRowCount: item.fullDatasetRowCount + 1 }
      : item)
  };
  await assert.rejects(
    () => invalidFullMeta.run('restoreDatasetPack(globalThis.testPack)'),
    /метаданные Full Dataset/
  );

  // Snapshot format 1 remains readable for pre-Full-Dataset HTML snapshots.
  const legacyFormat = application();
  legacyFormat.context.testPack = { ...pack, formatVersion: 1 };
  assert.equal(await legacyFormat.run('restoreDatasetPack(globalThis.testPack)'), 1);
  assert.equal(legacyFormat.pipeline.active('customers').records[0].value, 'updated');

  const exclusive = application();
  exclusive.pipeline.setActive(
    'customers', instance('customers', 'legacy untouched', 'user', '1.1.0')
  );
  let sqliteOpen = true;
  let revision = 1;
  const sqliteCustomer=instance('customers','sqlite latest','sqlite','1.1.0');
  sqliteCustomer.meta.equipmentHistory={schemaVersion:1,snapshots:[],events:[],lastKnown:{}};
  exclusive.context.ReclassifierDatabaseRepository = {
    hasOpenDatabase: () => sqliteOpen,
    getDatabaseInfo: () => ({databaseUuid:'DB-TEST'}),
    listDatasets: () => [{dataset_id:'customers',active_revision:revision,
      content_hash:String(revision),record_count:1,updated_at:'2026-10-15'}]
  };
  exclusive.context.ReclassifierRuntimeDataRepository = {
    isSqliteAuthoritative: () => sqliteOpen,
    get: id => sqliteOpen && id==='customers' ? sqliteCustomer :
      exclusive.pipeline.active(id),
    records: id => sqliteOpen && id==='customers' ? sqliteCustomer.records :
      exclusive.pipeline.active(id)?.records || [],
    list: () => exclusive.pipeline.list().map(item => ({
      ...item,active:sqliteOpen ? (item.id==='customers' ? sqliteCustomer : null):item.active
    }))
  };
  const sqlitePack=await exclusive.run('buildDatasetPack()');
  assert.equal(sqlitePack.source,'sqlite');
  assert.equal(sqlitePack.datasets.length,1);
  assert.equal((await exclusive.run('downloadUpdatedHtml()')).count,1);
  const synced=await exclusive.run('synchronizeSqliteToHtml()');
  assert.equal(synced.count,1);
  assert.equal(exclusive.pipeline.active('customers').records[0].value,'sqlite latest');
  assert.equal(exclusive.pipeline.active('customers').meta.equipmentHistory.schemaVersion,1);
  assert.equal(exclusive.context.ReclassifierRuntimeDataRepository.isSqliteAuthoritative(),true);
  // SQLite change is never lost behind stale mirrored HTML.
  sqliteCustomer.records[0].value='sqlite newer';
  revision++;
  const nextPack=await exclusive.run('buildDatasetPack()');
  assert.equal(nextPack.source,'sqlite');
  await exclusive.run('downloadUpdatedHtml()');
  const sqliteHtml=await exclusive.download().text();
  const packed=JSON.parse(sqliteHtml.match(/id="reclassifierDataPack">([^<]+)<\/script>/)[1]);
  const testReopen=application();
  testReopen.context.testPack=packed;
  assert.equal(await testReopen.run('restoreDatasetPack(globalThis.testPack)'),1);
  assert.equal(testReopen.pipeline.active('customers').records[0].value,'sqlite newer');
  assert.equal(exclusive.pipeline.active('customers').records[0].value,'sqlite latest',
    'Saving HTML from SQLite must not silently mirror into legacy.');
  await assert.rejects(() => exclusive.run('restoreDatasetPack(globalThis.testPack)'),
    /Восстановление HTML запрещено/);
  sqliteOpen=false;
  assert.equal(exclusive.pipeline.active('customers').records[0].value,'sqlite latest');
  assert.equal((await exclusive.run('buildDatasetPack()')).source,'html');
  const standalone=exclusive.run('downloadApplicationHtml()');
  assert.equal(standalone.mode,'application');

  const brokenManifest = application();
  brokenManifest.script.textContent = '{broken';
  assert.equal(await brokenManifest.run('hydrateDatasetPack()'), 0);
  assert.ok(brokenManifest.logs.some(message => message.includes('повреждён')));

  const volume = application();
  const large = instance('customers', 'large', 'user', '1.1.0');
  large.records = Array.from({ length: 10000 }, (_, index) => ({ mine: 'рудник ' + index, value: 'оборудование ' + index }));
  volume.pipeline.setActive('customers', large);
  const largePack = await volume.run('buildDatasetPack()');
  const fresh = application();
  fresh.context.testPack = largePack;
  const startedAt = Date.now();
  assert.equal(await fresh.run('restoreDatasetPack(globalThis.testPack)'), 1);
  const loadMs = Date.now() - startedAt;
  assert.equal(fresh.pipeline.active('customers').records.length, 10000);
  assert.ok(loadMs < 15000, '10,000 rows took too long to restore');
  console.log('HTML snapshot roundtrip, atomic restore, corrupted fallback: OK; 10,000 rows ' + loadMs + ' ms');
})().catch(error => { console.error(error); process.exitCode = 1; });
