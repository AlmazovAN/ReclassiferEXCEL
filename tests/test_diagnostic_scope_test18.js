'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const scopeSource=fs.readFileSync('src/js/app/diagnostic_scope_v18.js','utf8');
const v2Source=fs.readFileSync('src/js/app/diagnostic_v2.js','utf8');
const archiveSource=fs.readFileSync('src/js/app/diagnostic_history.js','utf8');
const uiSource=fs.readFileSync('src/js/app/database_ui_state.js','utf8');
const beginAt=uiSource.indexOf('const databaseMemoryDiagnostics = (() => {');
const from=uiSource.lastIndexOf('\n',beginAt)+1;
const through=uiSource.indexOf(
  'globalThis.ReclassifierDatabaseMemoryDiagnostics = databaseMemoryDiagnostics;',from);
assert(from>0&&through>from);
const uiFragment=uiSource.slice(from,through)+
  '\n  globalThis.ReclassifierDatabaseMemoryDiagnostics = databaseMemoryDiagnostics;';
const storage=new Map();
const localStorage={
  get length(){return storage.size},
  key:i=>Array.from(storage.keys())[i]||null,
  getItem:k=>storage.get(k)||null,
  setItem(k,v){storage.set(k,String(v))},
  removeItem:k=>storage.delete(k)
};
function create(pathname){
  const ctx={RECLASSIFIER_BUILD:{testLabel:'TEST_18_PR335'},
    location:{pathname},localStorage,indexedDB:undefined,console,Date,Math,
    Number,String,Map,Set,Array,JSON,Object,Promise,setTimeout,clearTimeout};
  ctx.globalThis=ctx;
  vm.createContext(ctx);
  for(const src of [scopeSource,v2Source,archiveSource,uiFragment])
    vm.runInContext(src,ctx);
  return ctx;
}
(async()=>{
  const a=create('/mnt/data/Reclassifier_v37.0_TEST_18_PR335.html');
  assert(a.ReclassifierDiagnosticScope.filename.includes('v37.0'));
  assert(a.ReclassifierDiagnosticV2.enabled());
  assert.equal(a.ReclassifierDatabaseMemoryDiagnostics.snapshot().eventCount,0);
  for(let i=0;i<55000;i++)
    a.ReclassifierDatabaseMemoryDiagnostics.mark('runtime-cache','progress',{
      datasetId:'itsm_data',reason:'get',cacheHits:1,fromCache:1,cachedRows:54753});
  const snap=a.ReclassifierDatabaseMemoryDiagnostics.snapshot();
  assert.equal(snap.aggregated.cacheHits,55000);
  assert.equal(snap.eventCount,0,'Cache hits must not create IDB/WAL events');
  assert.equal(a.ReclassifierDiagnosticV2.status().globalSeq,0);
  const scope=a.ReclassifierDiagnosticScope;
  assert([...storage.keys()].every(k=>!k.startsWith('reclassifier.diagnostic-wal.v13.')));
  const copyKey=scope.runtimeKey;
  const raw=storage.get(copyKey);
  assert(raw && raw.length<16000,'Ring snapshot must stay bounded on 55k hits');
  a.ReclassifierDatabaseMemoryDiagnostics.mark('runtime-sqlite-materialize','start',{
    datasetId:'mobile_brigade_data'});
  a.ReclassifierDatabaseMemoryDiagnostics.mark('runtime-sqlite-materialize','end',{
    datasetId:'mobile_brigade_data',rows:286472,fullDatasetRows:0,
    fullDatasetColumns:0});
  const current=a.ReclassifierDatabaseMemoryDiagnostics.snapshot();
  assert.equal(current.eventCount,2);
  assert.equal(current.aggregated.cacheHits,55000);
  assert.equal(a.ReclassifierDiagnosticV2.status().globalSeq,2);
  const report=await a.ReclassifierDiagnosticHistory.collect('runtime',current);
  assert.equal(report.htmlFile,scope.filename);
  assert.equal(report.archiveScope,scope.fingerprint);
  assert.equal(report.archivePolicy.maxEventsPerSession,384);
  assert.equal(report.sessions.length,1);
  assert.equal(report.storage.eventsRecovered,2);
  const b=create('/mnt/data/Reclassifier_v37.1_TEST_18_PR335.html');
  assert.notEqual(scope.databaseName,b.ReclassifierDiagnosticScope.databaseName);
  assert.notEqual(scope.walPrefix,b.ReclassifierDiagnosticScope.walPrefix);
  assert.equal(b.ReclassifierDiagnosticV2.status().globalSeq,0);
  assert.equal(b.ReclassifierDatabaseMemoryDiagnostics.snapshot().eventCount,0);
  const a2=create('/mnt/data/Reclassifier_v37.0_TEST_18_PR335.html');
  assert.equal(a2.ReclassifierDiagnosticV2.status().globalSeq,2);
  assert.equal(a2.ReclassifierDiagnosticScope.runtimeKey,copyKey);
  assert(a2.ReclassifierDiagnosticV2.statusText({eventCount:1})
    .includes('HTML: Reclassifier_v37.0'));
  console.log('PASS TEST_18: 55k cache hits aggregated with zero WAL writes, bounded ring, scoped HTML versions, durable reload');
})().catch(error=>{console.error(error);process.exitCode=1});
