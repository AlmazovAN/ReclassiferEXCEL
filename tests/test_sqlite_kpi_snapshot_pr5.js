// PR5: real SQLite/WASM cache, migration, portability and corruption fallback.
'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.resolve(__dirname,'..');
const version=process.env.RECLASSIFIER_VERSION ||
  fs.readFileSync(path.join(root,'VERSION'),'utf8').trim();
const html=fs.readFileSync(path.join(root,'dist',
  'Reclassifier_v'+version+'_CORE.html'),'utf8');
const vendor=html.match(/<script id="sqliteVendorSource">([\s\S]*?)<\/script>/);
const wasm=html.match(/"sqliteWasmBase64": "([A-Za-z0-9+/=]+)"/);
assert(vendor&&wasm,'CORE must contain SQLite JS/WASM');
vm.runInThisContext(vendor[1],{filename:'sqlite-vendor.js'});
const initialize=globalThis.sqlite3InitModule;
let sqliteRuntime=null;
globalThis.sqlite3InitModule=async opts=>{
  sqliteRuntime=await initialize(opts);
  return sqliteRuntime;
};
for(const filename of ['src/js/app/dataset_catalog.js','src/js/app/database_contract.js']){
  vm.runInThisContext(fs.readFileSync(path.join(root,filename),'utf8'),
    {filename});
}
new Function('assets','build','log',
  fs.readFileSync(path.join(root,'src/js/app/database_core.js'),'utf8')
)({sqliteWasmBase64:wasm[1]},{version,sqliteVersion:'3.53.4'},()=>{});
const db=globalThis.ReclassifierDatabaseRepository;
function snapshot(signature,month='latest') {
  return {
    schemaVersion:'1.0.0',type:'reliability-report',status:'ready',
    calculatedAt:'2026-10-16T00:00:00.000Z',
    sources:[], query:{period:{id:month}}, filters:{},results:{vbr:{value:89}},
    kpiView:{cards:{vbr:{current:{value:89}}}},
    diagnostics:{stage:'full',sourceSignature:signature}
  };
}
function identity(key='all',signature='rev-1',method='method-v1'){
  return {cacheKey:JSON.stringify([db.getDatabaseInfo().databaseUuid,key]),
    sourceSignature:signature,methodologyVersion:method,snapshotSchemaVersion:'1.0.0'};
}
function tamper(bytes,statements) {
  const filename='/kpi-cache-candidate-'+(++tamper.counter)+'.db';
  sqliteRuntime.capi.sqlite3_js_posix_create_file(filename,bytes);
  const raw=new sqliteRuntime.oo1.DB(filename,'w');
  try {
    for(const sql of statements)raw.exec(sql);
  }finally{raw.close();}
  const opened=new sqliteRuntime.oo1.DB(filename,'r');
  try {return Uint8Array.from(sqliteRuntime.capi.sqlite3_js_db_export(opened));}
  finally {
    opened.close();
    try{sqliteRuntime.capi.sqlite3_wasmfs_unlink?.(filename);}catch(_){}
  }
}
tamper.counter=0;
(async()=>{
  await db.createDatabase({fileName:'kpi-cache-v5.db'});
  assert.equal(db.getDatabaseInfo().schemaVersion,5);
  assert.equal(db.runHealthCheck().ok,true);
  assert.equal(db.getKpiSnapshotStats().count,0);
  db.upsertDataset('mobile_brigade_data',[
    {recordKey:'M1',request:'INC-A',factDate:'2026-10-10',laborHours:3}
  ],{state:{schemaVersion:'1.5.0'}});
  const sourceBefore=db.getDatasetRegistry('mobile_brigade_data');
  const input=identity();
  assert.equal(db.getKpiSnapshot(input),null);
  const before=db.getDatabaseInfo().storage.workingRevision;
  const written=db.putKpiSnapshot(input,snapshot(input.sourceSignature));
  assert.equal(written.stored,true);
  assert.equal(db.getDatabaseInfo().storage.workingRevision,before+1,
    'cache COMMIT is a real unsaved SQLite revision');
  assert.equal(db.getDatabaseInfo().dirty,true);
  assert.equal(db.getDatabaseInfo().storage.diskCurrent,false);
  assert.deepEqual(db.getDatasetRegistry('mobile_brigade_data'),sourceBefore,
    'KPI cache must not touch data source revisions');
  const restored=db.getKpiSnapshot(input);
  assert.deepEqual(restored.results.vbr.value,89);
  assert.equal(db.putKpiSnapshot(input,snapshot(input.sourceSignature)).reason,
    'unchanged','duplicate cache writes should be no-op');
  assert.equal(db.getDatabaseInfo().storage.workingRevision,before+1);
  assert.equal(db.getKpiSnapshot({...input,methodologyVersion:'method-v2'}),null,
    'method change invalidates cache');
  assert.equal(db.getKpiSnapshot({...input,sourceSignature:'rev-2'}),null,
    'source signature change invalidates cache');
  assert.equal(db.getKpiSnapshot({...input,snapshotSchemaVersion:'2.0.0'}),null,
    'snapshot schema mismatch invalidates cache');

  const bytes=db.exportDatabase();
  db.closeDatabase();
  await db.openDatabase(bytes,{fileName:'kpi-cache-reopened.db'});
  assert.equal(db.getDatabaseInfo().dirty,false);
  assert.equal(db.getKpiSnapshot(input).results.vbr.value,89,
    'full Snapshot must survive portable file reopen');
  assert.equal(db.runHealthCheck().ok,true);
  db.upsertDataset('mobile_brigade_data',[
    {recordKey:'M2',request:'INC-B',factDate:'2026-10-11',laborHours:4}
  ],{state:{schemaVersion:'1.5.0'}});
  assert.equal(db.getKpiSnapshot(input),null,
    'stored registry revisions must be checked against current SQLite facts');

  const clean=db.exportDatabase();
  // Explicit v4 migration fixture: the cache table did not exist in v4.
  const old= tamper(clean,[
    'DROP TABLE kpi_snapshots',
    'PRAGMA user_version=4',
    'UPDATE app_metadata SET schema_version=4'
  ]);
  const rowCount=db.getDataset('mobile_brigade_data').records.length;
  const oldUuid=db.getDatabaseInfo().databaseUuid;
  await db.openDatabase(old,{fileName:'legacy-v4.db'});
  assert.equal(db.getDatabaseInfo().schemaVersion,5);
  assert.equal(db.getDatabaseInfo().databaseUuid,oldUuid);
  assert.equal(db.getDatabaseInfo().dirty,true,
    'schema migration must mark the in-browser SQLite changed');
  assert.equal(db.getDataset('mobile_brigade_data').records.length,rowCount);
  assert.equal(db.getKpiSnapshotStats().count,0);
  assert.equal(db.runHealthCheck().ok,true);

  // Bounded cache across revision/period variations; only derived rows evicted.
  for(let i=0;i<17;i++){
    const entry=identity('mine-'+i);
    db.putKpiSnapshot(entry,snapshot(entry.sourceSignature,'2026-'+String(i+1).padStart(2,'0')));
  }
  assert.equal(db.getKpiSnapshotStats().count,12,
    'persistent cache must remain bounded across filter selections');
  assert.equal(db.getDataset('mobile_brigade_data').records.length,rowCount);
  const validInput=identity('last');
  db.putKpiSnapshot(validInput,snapshot(validInput.sourceSignature));
  const corrupted=tamper(db.exportDatabase(),[
    'UPDATE kpi_snapshots SET payload_checksum = \'corrupted\' WHERE cache_key = ' +
      "'"+validInput.cacheKey.replace(/'/g,"''")+"'"
  ]);
  await db.openDatabase(corrupted,{fileName:'corrupted-cache.db'});
  assert.equal(db.getKpiSnapshot(validInput),null,
    'tampered optional cache entry must be ignored rather than loaded');
  assert.equal(db.runHealthCheck().ok,true,
    'cache corruption must not prevent reading authoritative source records');
  assert.equal(db.getDataset('mobile_brigade_data').records.length,rowCount);
  db.closeDatabase();
  console.log('PR5 SQLite v5: persistence, schema migration, stale revisions, bounds and corruption fallback OK');
})().catch(err=>{console.error(err);process.exitCode=1;});
