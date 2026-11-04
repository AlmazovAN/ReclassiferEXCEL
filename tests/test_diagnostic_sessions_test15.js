'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const store=new Map();
const localStorage={
  get length(){return store.size;},
  key:i=>Array.from(store.keys())[i]??null,
  getItem:k=>store.get(k)??null,
  setItem:(k,v)=>store.set(k,String(v)),
  removeItem:k=>store.delete(k)
};
function load(){
  const ctx={console,Map,Set,Math,Date,JSON,Array,Object,Number,String,
    RECLASSIFIER_BUILD:{testLabel:'TEST_15_PR324'},localStorage,
    document:{getElementById:()=>null},
    navigator:{userAgent:'Test15'},
    performance:{memory:{usedJSHeapSize:32*1048576}},
    ReclassifierKpiAutoRefresh:{pause:()=>true,resume:()=>true},
    ReclassifierKpiBackgroundJobs:{status:()=>({state:'idle',queued:0,active:null})},
    ReclassifierDatabaseRepository:{getDiagnosticMemorySnapshot:()=>({
      databaseInputMiB:860.26,sqliteWasmCapacityMiB:861.06
    })}
  };
  ctx.globalThis=ctx;vm.createContext(ctx);
  for(const file of ['diagnostic_history.js','heavy_operation_gate.js','database_ui_state.js'])
    vm.runInContext(fs.readFileSync('src/js/app/'+file,'utf8'),ctx);
  return ctx;
}
(async()=>{
  const first=load();
  const logger=first.ReclassifierDatabaseMemoryDiagnostics;
  assert.equal(logger.snapshot().status,'observing','Startup must not pretend an import started');
  const initial=logger.snapshot().sessionId;
  logger.begin(1);
  const importId=logger.snapshot().sessionId;
  assert.notEqual(importId,initial);
  assert.equal(first.ReclassifierHeavyJobGate.busy(),true);
  logger.mark('candidate-records','start');
  logger.mark('candidate-records','end',{rows:54753});
  logger.finish('prepared');
  assert.equal(first.ReclassifierHeavyJobGate.busy(),false);
  const active=logger.snapshot();
  assert.equal(active.status,'observing','Heavy job release creates post-import session');
  assert.equal(active.finishedAt,undefined,'Observing session must not masquerade as finished');
  const afterId=active.sessionId;
  assert.notEqual(afterId,importId);
  logger.mark('kpi-cache-light','end',{cacheHits:1});
  const archive=await first.ReclassifierDiagnosticHistory.collect('runtime',active);
  const imported=archive.sessions.find(s=>s.sessionId===importId);
  const after=archive.sessions.find(s=>s.sessionId===afterId);
  assert(imported&&after,'Both sessions must survive in append-only archive');
  assert.equal(imported.status,'prepared');
  assert(imported.finishedAt,'Import finish timestamp must be preserved');
  assert(after.events.some(e=>e.phase==='kpi-cache-light'));
  assert.equal(after.status,'observing');
  const reopened=load();
  assert.notEqual(reopened.ReclassifierDatabaseMemoryDiagnostics.snapshot().sessionId,afterId,
    'New HTML tab must start a fresh observation session');
  const recovered=await reopened.ReclassifierDiagnosticHistory.collect('runtime',
    reopened.ReclassifierDatabaseMemoryDiagnostics.snapshot());
  assert(recovered.sessions.some(s=>s.sessionId===importId));
  assert(recovered.sessions.some(s=>s.sessionId===afterId));
  assert.equal(recovered.storage.walPending>0,true,
    'When IndexedDB is unavailable, unsynced WAL must not be silently discarded');
  console.log('PASS TEST_15 journal: import completed, follow-up KPI and reopen are separate durable sessions');
})().catch(error=>{console.error(error);process.exitCode=1;});
