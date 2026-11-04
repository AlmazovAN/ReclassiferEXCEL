// Real SQLite regression for schema-agnostic Full Dataset persistence.
// Verifies UPSERT, schema evolution, export/reopen, runtime restore and DB Schema 1 -> 2 -> 3 -> 4 migration.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const dist = path.resolve(process.env.RECLASSIFIER_HTML_DIR || path.join(root, 'dist'));
const outputs = fs.readdirSync(dist)
  .filter(name => /^Reclassifier_v.*_CORE\.html$/.test(name))
  .map(name => path.join(dist, name));
assert.strictEqual(outputs.length, 1, 'Expected one CORE HTML artifact.');

const html = fs.readFileSync(outputs[0], 'utf8');
const vendor = html.match(/<script id="sqliteVendorSource">([\s\S]*?)<\/script>/);
const wasm = html.match(/"sqliteWasmBase64": "([A-Za-z0-9+/=]+)"/);
assert(vendor && wasm, 'CORE HTML does not embed SQLite JS/WASM.');

vm.runInThisContext(vendor[1], { filename: 'sqlite-vendor.js' });
const originalInit = globalThis.sqlite3InitModule;
let sqliteRuntime = null;
globalThis.sqlite3InitModule = async options => {
  sqliteRuntime = await originalInit(options);
  return sqliteRuntime;
};

vm.runInThisContext(
  fs.readFileSync(path.join(root, 'src/js/app/dataset_catalog.js'), 'utf8'),
  { filename: 'dataset-catalog.js' }
);
for (const fragment of [
  'src/js/app/field_registry.js',
  'src/js/modules/itsm/dataset_schema.js',
  'src/js/modules/equipment/equipment_history.js',
  'src/js/app/recalculation_materializer.js'
]) {
  vm.runInThisContext(fs.readFileSync(path.join(root, fragment), 'utf8'),
    { filename: fragment });
}
vm.runInThisContext(
  fs.readFileSync(path.join(root, 'src/js/app/database_contract.js'), 'utf8'),
  { filename: 'database-contract.js' }
);
new Function(
  'assets', 'build', 'log',
  fs.readFileSync(path.join(root, 'src/js/app/database_core.js'), 'utf8')
)(
  { sqliteWasmBase64: wasm[1] },
  { version: 'full-dataset-test', sqliteVersion: '3.53.4' },
  () => {}
);

function fullPayload(columns, rows) {
  return {
    schemaVersion: '1.0.0',
    package: 'mobile-brigade-full-dataset',
    aggregation: 'per-task-row',
    fieldCount: columns.length,
    columns,
    rows,
    sourceRows: rows.length,
    earliestSourceDate: '2026-01-01',
    latestSourceDate: '2026-10-01'
  };
}

function insertRegistryBaseline(raw, timestamp) {
  for (const [id, definition] of Object.entries(globalThis.ReclassifierDatabaseContract.datasets)) {
    // Genuine Schema 1 predates KPI Source. Do not backport a current
    // Dataset Registry row into the legacy migration fixture.
    if (definition.persisted === false || id === 'kpi_source') continue;
    raw.exec({
      sql: 'INSERT INTO dataset_registry (' +
        'dataset_id, title, kind, dataset_schema_version, integration_strategy, key_field, ' +
        'allow_empty, persisted, active_revision, record_count, updated_at' +
        ') VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?)',
      bind: [
        id,
        definition.title,
        definition.kind,
        id === 'itsm_data' ? '1.1.0' : definition.schemaVersion,
        definition.strategy,
        definition.keyField,
        definition.allowEmpty ? 1 : 0,
        definition.persisted === false ? 0 : 1,
        timestamp
      ]
    });
  }
}

async function main() {
  const db = globalThis.ReclassifierDatabaseRepository;
  const contract = globalThis.ReclassifierDatabaseContract;

  await db.createDatabase({ fileName: 'full-dataset.db', appVersion: 'full-dataset-test' });
  assert.strictEqual(db.getDatabaseInfo().schemaVersion, 5);

  const records = [
    { recordKey: 'north|task-1', request: 'INC-1', laborHours: 1, factDate: '2026-08-31' },
    { recordKey: 'north|task-2', request: 'INC-2', laborHours: 2, factDate: '2026-10-13' }
  ];
  const firstFull = fullPayload(
    ['Номер задачи', 'TEST_UNKNOWN_COLUMN'],
    [
      ['TASK-1', 'alpha'],
      ['TASK-2', 'beta']
    ]
  );
  const first = db.upsertDataset('mobile_brigade_data', records, {
    state: { schemaVersion: '1.4.0' },
    fullDataset: firstFull
  });
  assert.strictEqual(first.rowsAfter, 2);

  let stored = db.getDataset('mobile_brigade_data');
  assert(stored.fullDataset, 'Full Dataset was not returned from SQLite.');
  assert.deepStrictEqual(stored.fullDataset.columns, firstFull.columns);
  assert.deepStrictEqual(stored.fullDataset.rows, firstFull.rows);
  assert.strictEqual(stored.fullDataset.coverage, 'complete');
  assert.strictEqual(stored.fullDataset.rowCount, 2);

  // Add a future column while updating only one logical record.
  // Existing rows must be remapped to the union schema without data loss.
  const evolvedFull = fullPayload(
    ['Номер задачи', 'TEST_UNKNOWN_COLUMN', 'NEW_FUTURE_COLUMN'],
    [['TASK-2', 'beta-v2', 'future']]
  );
  const evolved = db.upsertDataset(
    'mobile_brigade_data',
    [records[1]],
    {
      state: { schemaVersion: '1.4.0' },
      fullDataset: evolvedFull
    }
  );
  assert.strictEqual(evolved.rowsInserted, 0);
  assert.strictEqual(evolved.rowsUpdated, 0);
  assert.strictEqual(evolved.rowsUnchanged, 1,
    'Analytical row should remain unchanged while Full Dataset is updated.');

  stored = db.getDataset('mobile_brigade_data');
  assert.deepStrictEqual(
    stored.fullDataset.columns,
    ['Номер задачи', 'TEST_UNKNOWN_COLUMN', 'NEW_FUTURE_COLUMN']
  );
  assert.deepStrictEqual(stored.fullDataset.rows[0], ['TASK-1', 'alpha', null],
    'Existing Full Dataset row was not expanded for the new column.');
  assert.deepStrictEqual(stored.fullDataset.rows[1], ['TASK-2', 'beta-v2', 'future'],
    'Incoming Full Dataset row was not updated.');
  assert.strictEqual(stored.fullDataset.coverage, 'complete');

  const health = db.runHealthCheck();
  assert.strictEqual(health.ok, true, health.errors.join('; '));
  const storage = health.datasetStorage.find(row => row.dataset_id === 'mobile_brigade_data');
  assert.strictEqual(Number(storage.full_rows), 2);
  assert(Number(storage.full_json_bytes) > 0);

  const exported = db.exportDatabase();
  db.closeDatabase();
  await db.openDatabase(exported, { fileName: 'full-dataset-reopened.db' });
  stored = db.getDataset('mobile_brigade_data');
  assert.deepStrictEqual(stored.fullDataset.rows[1], ['TASK-2', 'beta-v2', 'future'],
    'Full Dataset did not survive DB export/reopen.');

  globalThis.ReclassifierLegacyDatasetStore = {
    get: () => null,
    records: () => [],
    list: () => []
  };
  new Function(
    fs.readFileSync(path.join(root, 'src/js/app/data_repository.js'), 'utf8')
  )();
  const runtimeInstance = globalThis.ReclassifierRuntimeDataRepository.get('mobile_brigade_data');
  assert(runtimeInstance?.fullDataset, 'Runtime repository did not expose SQLite Full Dataset.');
  assert.strictEqual(runtimeInstance.meta.fullDatasetFieldCount, 3);
  assert.strictEqual(runtimeInstance.meta.fullDatasetRows, 2);
  assert.strictEqual(runtimeInstance.meta.fullDatasetScope, 'complete');

  // PR3 acceptance: the active runtime Dataset after closing and reopening
  // the SAME exported SQLite file can drive a complete date-filtered XLSX.
  vm.runInThisContext(
    fs.readFileSync(path.join(root, 'src/js/app/dataset_excel_export.js'), 'utf8'),
    { filename: 'dataset_excel_export.js' }
  );
  const periodExport = globalThis.ReclassifierDatasetExcelExport;
  const range = periodExport.period('mobile_brigade_data', runtimeInstance);
  assert.deepStrictEqual([range.from, range.to], ['2026-08-31', '2026-10-13']);
  const chosen = periodExport.selectRows(
    'mobile_brigade_data', runtimeInstance, '2026-10-13', '2026-10-13'
  );
  assert.deepStrictEqual(chosen.columns, stored.fullDataset.columns);
  assert.deepStrictEqual(chosen.rows, [['TASK-2', 'beta-v2', 'future']]);
  const xlsx = require(path.join(root, 'vendor/xlsx.full.min.js'));
  globalThis.XLSX = xlsx;
  require(path.join(root, 'src/js/workers/dataset_export_processor.js'));
  const xlsxOutput = globalThis.ReclassifierDatasetExportWorkerProcessor.process({
    sheetName: 'Мобильные бригады', columns: chosen.columns, rows: chosen.rows
  });
  const reopenedWorkbook = xlsx.read(xlsxOutput.bytes, { type: 'array' });
  const actualSheet = xlsx.utils.sheet_to_json(
    reopenedWorkbook.Sheets['Мобильные бригады'], { header: 1, defval: null }
  );
  assert.deepStrictEqual(actualSheet[0], chosen.columns);
  assert.deepStrictEqual(actualSheet[1], chosen.rows[0]);
  assert.strictEqual(db.getDatasetRegistry('mobile_brigade_data').active_revision, 2,
    'Downloading XLSX must not revise the SQLite database.');
  assert.strictEqual(db.runHealthCheck().ok, true);
  console.log('PR3 SQLite export: reopened DB, date filter, real XLSX and unchanged revision OK');

  db.closeDatabase();

  // PR6: real multi-Dataset SQL transaction updates ONLY approved derived
  // values; KPI Source is replaced in the same transaction.
  await db.createDatabase({fileName:'recalculation-commit.db',appVersion:'pr6'});
  const itsmSchema=globalThis.ReclassifierItsmDatasetSchema;
  const keys=itsmSchema.fields;
  const analytic=Array(keys.length).fill(null);
  const itsmNumber=keys.indexOf('number');
  const laborPosition=keys.indexOf('result6LaborHours');
  const mbPresencePosition=keys.indexOf('mbPresence');
  analytic[itsmNumber]='INC-77';
  analytic[keys.indexOf('createdAt')]='2026-01-01T00:00:00';
  analytic[laborPosition]=1;
  analytic[mbPresencePosition]='Нет в МБ';
  const fullColumns=Array(62).fill('');
  fullColumns[0]='Номер';
  fullColumns[12]='ORIGINAL_EXTRA_SOURCE';
  fullColumns[27+laborPosition-17]=itsmSchema.labels[laborPosition];
  fullColumns[61]=itsmSchema.labels[mbPresencePosition];
  const fullRow=Array(62).fill(null);
  fullRow[0]='INC-77';
  fullRow[12]='DO NOT CHANGE';
  fullRow[27+laborPosition-17]=1;
  db.upsertDataset('itsm_data',[analytic],{
    state:{fields:Array.from(keys),schemaVersion:'1.2.0'},
    fullDataset:{
      schemaVersion:'1.0.0',package:'itsm-full-dataset',aggregation:'per-source-row',
      columns:fullColumns,rows:[fullRow],sourceRows:1
    }
  });
  db.upsertDataset('mobile_brigade_data',[
    {recordKey:'SITE|TASK-77',request:'INC-77',itsmCreatedAt:null,laborHours:5,
      description:'KEEP ORIGINAL SOURCE'}
  ],{
    state:{schemaVersion:'1.5.0'},
    fullDataset:{
      schemaVersion:'1.0.0',package:'mobile-brigade-full-dataset',
      aggregation:'per-task-row',
      columns:['Номер задачи','Дата создания вызова ITSM','ORIGINAL_SOURCE'],
      rows:[['TASK-77','', 'MB SOURCE UNTOUCHED']],sourceRows:1
    }
  });
  const originalItsmRegistry=db.getDatasetRegistry('itsm_data');
  const originalMbRegistry=db.getDatasetRegistry('mobile_brigade_data');
  const makeDelta=(before,after)=>({before,after});
  const commitPayload=[
    {id:'mobile_brigade_data',expectedRevision:originalMbRegistry.active_revision,
      rulesVersion:'1.5.0',
      changes:[{key:'site|task-77',rowIndex:0,fields:{
        itsmCreatedAt:makeDelta(null,'2026-01-01T00:00:00')
      }}]},
    {id:'itsm_data',expectedRevision:originalItsmRegistry.active_revision,
      rulesVersion:'1.2.1',
      changes:[{key:'inc-77',rowIndex:0,fields:{
        result6LaborHours:makeDelta(1,5),
        mbPresence:makeDelta('Нет в МБ','Есть в МБ')
      }}]}
  ];
  const sqlResult=db.applyRecalculationBatch(commitPayload,{
    id:'kpi_source',
    records:[['2026-01-01',5]],
    state:{schemaVersion:'1.0.0',fields:['period','value'],columns:['Period','Value']},
    freshnessFrom:'2026-01-01',freshnessTo:'2026-01-01'
  },{asOfDate:'2026-10-14T00:00:00.000Z'});
  assert.deepStrictEqual(sqlResult.changedDatasetIds,
    ['mobile_brigade_data','itsm_data','kpi_source']);
  const committedMb=db.getDataset('mobile_brigade_data');
  const committedItsm=db.getDataset('itsm_data');
  assert.strictEqual(committedMb.records[0].description,'KEEP ORIGINAL SOURCE');
  assert.strictEqual(committedMb.records[0].itsmCreatedAt,'2026-01-01T00:00:00');
  assert.strictEqual(committedMb.fullDataset.rows[0][2],'MB SOURCE UNTOUCHED');
  assert.strictEqual(committedMb.fullDataset.rows[0][1],'2026-01-01T00:00:00');
  assert.strictEqual(committedItsm.records[0][laborPosition],5);
  assert.strictEqual(committedItsm.fullDataset.rows[0][12],'DO NOT CHANGE');
  assert.strictEqual(committedItsm.fullDataset.rows[0][27+laborPosition-17],5);
  assert.strictEqual(committedItsm.fullDataset.rows[0][61],'Есть в МБ');
  assert.strictEqual(db.getDatasetRegistry('itsm_data').active_revision,
    originalItsmRegistry.active_revision+1);
  assert.strictEqual(db.getDatasetRegistry('mobile_brigade_data').active_revision,
    originalMbRegistry.active_revision+1);
  assert.strictEqual(db.getDatasetState('itsm_data').dependencyRevisions.mobile_brigade_data,
    originalMbRegistry.active_revision+1);
  assert.strictEqual(db.getDatasetState('kpi_source').dependencyRevisions.itsm_data,
    originalItsmRegistry.active_revision+1);
  assert.strictEqual(db.getDataset('kpi_source').records[0][1],5);
  assert.strictEqual(db.getDatasetState('itsm_data').lastRecalculationBatchId,
    sqlResult.batchId);

  const mbStateBefore=JSON.stringify(db.getDataset('mobile_brigade_data'));
  const itStateBefore=JSON.stringify(db.getDataset('itsm_data'));
  const kpiStateBefore=JSON.stringify(db.getDataset('kpi_source'));
  const currentMbRev=db.getDatasetRegistry('mobile_brigade_data').active_revision;
  const currentItsmRev=db.getDatasetRegistry('itsm_data').active_revision;
  assert.throws(()=>db.applyRecalculationBatch([
    {id:'mobile_brigade_data',expectedRevision:currentMbRev,
      changes:[{key:'site|task-77',rowIndex:0,fields:{
        itsmCreatedAt:makeDelta('2026-01-01T00:00:00','2026-02-01T00:00:00')
      }}]},
    {id:'itsm_data',expectedRevision:currentItsmRev,
      changes:[{key:'inc-77',rowIndex:0,fields:{
        result6LaborHours:makeDelta(999,6)
      }}]}
  ],{id:'kpi_source',records:[['2026-01-01',6]]}),
    /изменилась после предпросмотра/);
  assert.strictEqual(JSON.stringify(db.getDataset('mobile_brigade_data')),mbStateBefore);
  assert.strictEqual(JSON.stringify(db.getDataset('itsm_data')),itStateBefore);
  assert.strictEqual(JSON.stringify(db.getDataset('kpi_source')),kpiStateBefore);
  assert.throws(()=>db.applyRecalculationBatch([
    {id:'mobile_brigade_data',expectedRevision:currentMbRev,
      changes:[{key:'site|task-77',rowIndex:0,fields:{
        description:makeDelta('KEEP ORIGINAL SOURCE','ILLEGAL')
      }}]}
  ]),/запрещено/);
  assert.strictEqual(JSON.stringify(db.getDataset('mobile_brigade_data')),mbStateBefore);
  assert.strictEqual(db.runHealthCheck().ok,true);
  const recalcBytes=db.exportDatabase();
  db.closeDatabase();
  await db.openDatabase(recalcBytes,{fileName:'recalculation-reopened.db'});
  assert.strictEqual(db.getDataset('itsm_data').records[0][laborPosition],5);
  assert.strictEqual(db.getDataset('mobile_brigade_data').fullDataset.rows[0][2],
    'MB SOURCE UNTOUCHED');
  assert.strictEqual(db.getDataset('kpi_source').records[0][1],5);
  db.closeDatabase();
  console.log('PR6 SQL: atomic MB+ITSM+KPI, source Full Dataset, revisions, rollback and reopen OK');

  // PR8: a real SQLite atomic full-source reconstruction preserves the
  // untouched mine and persists StartPoints/Zabbix join-index migrations.
  await db.createDatabase({fileName:'equipment-scoped-pr8.db',appVersion:'pr8'});
  db.replaceDataset('mounted',[
    {id:'M-A',unit:'Mine-A',name:'Mounted-A'},
    {id:'M-B',unit:'Mine-B',name:'Mounted-B'}
  ],{state:{schemaVersion:'1.0.0'}});
  db.replaceDataset('stationary',[
    {id:'S-A',unit:'Mine-A',name:'Stationary-A'},
    {id:'S-B',unit:'Mine-B',name:'Stationary-B'}
  ],{state:{schemaVersion:'1.0.0'}});
  db.replaceDataset('transport',[
    {transport__id:'T-A',unit:'Mine-A',name:'Truck-A'},
    {transport__id:'T-B',unit:'Mine-B',name:'Truck-B'}
  ],{state:{joinIndex:[
    ['mine-a\\u001ftruck-a',{transport__id:'T-A'}],
    ['mine-b\\u001ftruck-b',{transport__id:'T-B'}]
  ]}});
  db.replaceDataset('transport_start_points',[
    {unit:'Mine-A',name:'Truck-A'},
    {unit:'Mine-B',name:'Truck-B'}
  ],{state:{joinIndex:[
    ['mine-a\\u001ftruck-a',true],['mine-b\\u001ftruck-b',true]
  ]}});
  db.replaceDataset('zabbix',[
    {zabbix__id:'Z-A',equipment:'M-A',__partition_unit:'Mine-A'},
    {zabbix__id:'Z-B',equipment:'M-B',__partition_unit:'Mine-B'}
  ],{state:{joinIndex:[
    ['M-A',[{zabbix__id:'Z-A'}]],['M-B',[{zabbix__id:'Z-B'}]]
  ]}});
  const versionBefore=db.getDatasetRegistry('zabbix').active_revision;
  const newPoints=[
    {unit:'Mine-B',name:'Truck-B'},
    {unit:'Mine-A',name:'Truck-A2'}
  ];
  const newZabbix=[
    {zabbix__id:'Z-B',equipment:'M-B',__partition_unit:'Mine-B'},
    {zabbix__id:'Z-A2',equipment:'M-A',__partition_unit:'Mine-A'}
  ];
  const batches=[
    {id:'transport_start_points',records:newPoints,options:{
      fullPreparedScope:true,partitionScopeConfirmed:true,
      state:{lastReplacedPartitions:['Mine-A'],joinIndex:[
        ['mine-b\\u001ftruck-b',true],['mine-a\\u001ftruck-a2',true]
      ]}
    }},
    {id:'zabbix',records:newZabbix,options:{
      fullPreparedScope:true,partitionScopeConfirmed:true,
      state:{lastReplacedPartitions:['Mine-A'],joinIndex:[
        ['M-B',[{zabbix__id:'Z-B'}]],['M-A',[{zabbix__id:'Z-A2'}]]
      ]}
    }}
  ];
  assert.throws(()=>db.replaceDatasetBatch([
    {...batches[0],options:{...batches[0].options,partitionScopeConfirmed:false}}
  ]),/подтвержд/);
  assert.strictEqual(db.getDataset('transport_start_points').records[0].name,'Truck-A');
  const scopedCommit=db.replaceDatasetBatch(batches);
  assert.strictEqual(scopedCommit.results.length,2);
  assert.strictEqual(db.getDataset('transport_start_points').records.length,2);
  assert.strictEqual(db.getDataset('transport_start_points').records[0].name,'Truck-B');
  assert.strictEqual(db.getDataset('transport_start_points').records[1].name,'Truck-A2');
  assert.strictEqual(db.getDataset('zabbix').records[0].zabbix__id,'Z-B');
  assert.strictEqual(db.getDataset('zabbix').records[1].zabbix__id,'Z-A2');
  assert.strictEqual(db.getDataset('zabbix').state.joinIndex[1][1][0].zabbix__id,'Z-A2');
  assert.strictEqual(db.getDatasetRegistry('zabbix').active_revision,versionBefore+1);
  assert.strictEqual(db.getDataset('mounted').records[1].id,'M-B');
  // PR9 journals are in the same SQLite transaction as the source REPLACE.
  const originalSourceHistory=db.getDatasetState('zabbix').equipmentHistory;
  assert.strictEqual(originalSourceHistory.schemaVersion,1);
  assert.strictEqual(originalSourceHistory.snapshots.length,2);
  assert.strictEqual(originalSourceHistory.snapshots[1].rows[0].id,'Z-A2');
  assert.strictEqual(originalSourceHistory.lastKnown['Z-B'].snapshot.unit,'Mine-B');
  assert.strictEqual(originalSourceHistory.snapshots[0].sourceDate,null,
    'Undated baseline must not be retroactively dated.');

  // Confirmed not_working_since is an event date, independent of the date
  // of the source Excel observation. Missing dates cannot be inferred.
  const baseMounted=db.getDataset('mounted').records;
  const retiredMount=baseMounted.map(row => row.id==='M-A'
    ? {...row,not_working_since:'2026-10-09'} : row);
  const scopedMountedOptions={
    fullPreparedScope:true,partitionScopeConfirmed:true,
    freshnessTo:'2026-10-11',
    sourceFileName:'CatalogMountedEquipment-2026-10-11.xlsx',
    state:{lastReplacedPartitions:['Mine-A']}
  };
  db.replaceDatasetBatch([{id:'mounted',records:retiredMount,
    options:scopedMountedOptions}]);
  const retiredHistory=db.getDatasetState('mounted').equipmentHistory;
  const finalEvent=retiredHistory.events.at(-1);
  assert.strictEqual(finalEvent.type,'decommissioned');
  assert.strictEqual(finalEvent.eventDate,'2026-10-09');
  assert.strictEqual(finalEvent.sourceDate,'2026-10-11');
  assert.strictEqual(db.getDataset('mounted').records[1].id,'M-B');
  const stateBeforeInvalid=JSON.stringify(db.getDataset('mounted'));
  assert.throws(()=>db.replaceDatasetBatch([{
    id:'mounted',records:baseMounted,
    options:scopedMountedOptions
  }]),/окончательное выбытие/);
  assert.strictEqual(JSON.stringify(db.getDataset('mounted')),stateBeforeInvalid,
    'A rejected decommission reversal must roll back ALL SQLite writes.');

  assert.strictEqual(db.runHealthCheck().ok,true);
  const equipmentBytes=db.exportDatabase();
  db.closeDatabase();
  await db.openDatabase(equipmentBytes,{fileName:'equipment-pr8-reopened.db'});
  assert.strictEqual(db.getDataset('transport_start_points').state.joinIndex.length,2);
  assert.strictEqual(db.getDataset('zabbix').records[0].zabbix__id,'Z-B');
  assert.strictEqual(db.getDatasetState('mounted').equipmentHistory.events.at(-1).eventDate,
    '2026-10-09');
  assert.strictEqual(db.getDatasetState('zabbix').equipmentHistory.lastKnown['Z-B'].snapshot.unit,
    'Mine-B');
  db.closeDatabase();
  console.log('PR8 SQLite: atomic multi-source scope, preserved other mine, join indexes and reopen OK');

  // PR1: HTML can contain three analytical rows but only one verified raw row.
  // Deploying SQLite must not discard that raw row or invent missing source data.
  await db.createDatabase({ fileName: 'sparse-bootstrap.db', appVersion: 'full-dataset-test' });
  const sparseRecords = [
    { recordKey: 'north|old', request: 'INC-OLD', factDate: '2025-01-01' },
    { recordKey: 'north|known', request: 'INC-KNOWN', factDate: '2026-01-01' },
    { recordKey: 'north|third', request: 'INC-THIRD', factDate: '2026-02-01' }
  ];
  const sparsePayload = {
    ...fullPayload(['Номер задачи', 'Нестандартная исходная колонка'],[
      ['TASK-KNOWN','private-raw-value']
    ]),
    coverage: 'partial',
    recordKeys: ['north|known']
  };
  await db.bootstrapDatasets([{
    id: 'mobile_brigade_data',
    records: sparseRecords,
    options: {
      state: { schemaVersion: '1.5.0' },
      fullDataset: sparsePayload,
      allowSparseFullDataset: true,
      sourceFileName: 'HTML full-source subset'
    }
  }]);
  let sparseStored = db.getDataset('mobile_brigade_data');
  assert.strictEqual(sparseStored.records.length, 3);
  assert.strictEqual(sparseStored.fullDataset.coverage, 'partial');
  assert.strictEqual(sparseStored.fullDataset.rowCount, 1);
  assert.deepStrictEqual(sparseStored.fullDataset.recordKeys,['north|known']);
  assert.deepStrictEqual(sparseStored.fullDataset.rows,[['TASK-KNOWN','private-raw-value']]);
  assert(db.runHealthCheck().partialFullDatasets.includes('mobile_brigade_data'));

  // A subsequent UPSERT must add its own full record without touching the
  // existing raw row, even if the earlier analytic-only row has no raw data.
  db.upsertDataset('mobile_brigade_data',[sparseRecords[2]],{
    state:{schemaVersion:'1.5.0'},
    fullDataset:fullPayload(
      ['Номер задачи','Нестандартная исходная колонка','Новое поле'],
      [['TASK-THIRD','future-private','new-raw']]
    )
  });
  sparseStored = db.getDataset('mobile_brigade_data');
  assert.strictEqual(sparseStored.fullDataset.coverage,'partial');
  assert.deepStrictEqual(sparseStored.fullDataset.recordKeys,['north|known','north|third']);
  assert.deepStrictEqual(sparseStored.fullDataset.rows[0],
    ['TASK-KNOWN','private-raw-value',null]);
  assert.deepStrictEqual(sparseStored.fullDataset.rows[1],
    ['TASK-THIRD','future-private','new-raw']);
  // Backfilling the old source record eventually certifies full coverage.
  db.upsertDataset('mobile_brigade_data',[sparseRecords[0]],{
    state:{schemaVersion:'1.5.0'},
    fullDataset:fullPayload(
      ['Номер задачи','Нестандартная исходная колонка'],
      [['TASK-OLD','backfilled-original']]
    )
  });
  sparseStored = db.getDataset('mobile_brigade_data');
  assert.strictEqual(sparseStored.fullDataset.coverage,'complete');
  assert.strictEqual(sparseStored.fullDataset.rowCount,3);

  // If a writer supplies only analytics next time, do not misreport complete.
  db.upsertDataset('mobile_brigade_data',[
    {recordKey:'north|analytic-only',request:'INC-NEW',factDate:'2026-03-01'}
  ],{state:{schemaVersion:'1.5.0'}});
  sparseStored = db.getDataset('mobile_brigade_data');
  assert.strictEqual(sparseStored.fullDataset.coverage,'partial');
  assert.strictEqual(sparseStored.fullDataset.rowCount,3);
  assert.strictEqual(sparseStored.records.length,4);

  const sparseBytes = db.exportDatabase();
  db.closeDatabase();
  await db.openDatabase(sparseBytes,{fileName:'sparse-reopened.db'});
  sparseStored = db.getDataset('mobile_brigade_data');
  assert.strictEqual(sparseStored.fullDataset.rowCount,3);
  assert.strictEqual(sparseStored.fullDataset.coverage,'partial');
  assert.strictEqual(db.runHealthCheck().ok,true);
  db.closeDatabase();
  console.log('PR1: sparse Full Dataset survives HTML bootstrap, UPSERT and SQLite roundtrip.');

  // Build a genuine Schema 1 database, then open it through the current repository.
  // Migration must preserve analytical rows and add the Full Dataset storage table.
  assert(sqliteRuntime?.oo1?.DB, 'SQLite runtime was not captured.');
  const legacyName = '/full-dataset-schema-v1.db';
  const raw = new sqliteRuntime.oo1.DB(legacyName, 'c');
  const timestamp = '2026-10-01T00:00:00.000Z';
  try {
    raw.exec('PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON;');
    raw.exec(contract.schemaV1Sql);
    raw.exec({
      sql: 'INSERT INTO app_metadata (' +
        'singleton, database_uuid, database_type, schema_version, created_at, updated_at, ' +
        'created_by_app_version, last_written_by_app_version' +
        ') VALUES (1, ?, ?, 1, ?, ?, ?, ?)',
      bind: [
        'legacy-schema-v1',
        contract.databaseType,
        timestamp,
        timestamp,
        'legacy-test',
        'legacy-test'
      ]
    });
    insertRegistryBaseline(raw, timestamp);
    raw.exec({
      sql: 'UPDATE dataset_registry SET active_revision = 1, record_count = 1, ' +
        'source_file_name = ?, updated_at = ? WHERE dataset_id = ?',
      bind: ['legacy-mb.xlsx', timestamp, 'mobile_brigade_data']
    });
    raw.exec({
      sql: 'INSERT INTO dataset_records(dataset_id, record_key, ordinal, record_json) ' +
        'VALUES (?, ?, 0, ?)',
      bind: [
        'mobile_brigade_data',
        'north|legacy',
        JSON.stringify({ recordKey: 'north|legacy', request: 'INC-LEGACY' })
      ]
    });
    raw.exec({
      sql: 'INSERT INTO dataset_state(dataset_id, state_json, updated_at) VALUES (?, ?, ?)',
      bind: ['mobile_brigade_data', '{"schemaVersion":"1.4.0"}', timestamp]
    });
  } finally {
    raw.close();
  }

  const legacyRead = new sqliteRuntime.oo1.DB(legacyName, 'r');
  let legacyBytes;
  try {
    legacyBytes = Uint8Array.from(sqliteRuntime.capi.sqlite3_js_db_export(legacyRead));
  } finally {
    legacyRead.close();
    try { sqliteRuntime.capi.sqlite3_wasmfs_unlink?.(legacyName); } catch (_) {}
  }

  await db.openDatabase(legacyBytes, { fileName: 'legacy-schema-v1.db' });
  const migratedInfo = db.getDatabaseInfo();
  assert.strictEqual(migratedInfo.schemaVersion, 5, 'Schema 1 DB was not migrated to current Schema 5.');
  assert.strictEqual(migratedInfo.dirty, true,
    'Auto-migrated DB must be marked dirty so the user can save the upgraded file.');
  assert.strictEqual(db.getDataset('mobile_brigade_data').records[0].request, 'INC-LEGACY',
    'Schema migration lost an analytical record.');
  assert.strictEqual(db.runHealthCheck().ok, true);

  db.upsertDataset(
    'mobile_brigade_data',
    [{ recordKey: 'north|legacy', request: 'INC-LEGACY' }],
    {
      state: { schemaVersion: '1.4.0' },
      fullDataset: fullPayload(
        ['Номер задачи', 'TEST_UNKNOWN_COLUMN'],
        [['INC-LEGACY', 'migrated-and-preserved']]
      )
    }
  );
  const migrated = db.getDataset('mobile_brigade_data');
  assert.strictEqual(migrated.fullDataset.coverage, 'complete');
  assert.strictEqual(migrated.fullDataset.rows[0][1], 'migrated-and-preserved');
  assert.strictEqual(db.runHealthCheck().ok, true);

  console.log('SQLite Full Dataset: schema-agnostic roundtrip + schema evolution + v1 migration OK');
  db.closeDatabase();
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
