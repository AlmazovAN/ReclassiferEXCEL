'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const scopeSource=fs.readFileSync('src/js/app/diagnostic_scope_v18.js','utf8');
const historySource=fs.readFileSync('src/js/app/diagnostic_history.js','utf8');

const tables=new Map();
function requestWith(value){
  const req={result:undefined,onsuccess:null,onerror:null};
  queueMicrotask(()=>{req.result=value;req.onsuccess?.()});
  return req;
}
function openStore(name){
  const map=tables.get(name);
  return {
    put(value){map.set(value.id,value)},
    delete(key){map.delete(key)},
    getAll(){return requestWith([...map.values()])},
    openCursor(){
      const keys=[...map.keys()],req={result:null,onsuccess:null};
      let index=0;
      const emit=()=>{
        const key=keys[index];
        req.result=key===undefined?null:{
          value:map.get(key),
          delete(){map.delete(key)},
          continue(){index++;queueMicrotask(emit)}
        };
        req.onsuccess?.();
      };
      queueMicrotask(emit);
      return req;
    }
  };
}
const db={
  objectStoreNames:{contains:name=>tables.has(name)},
  createObjectStore(name){tables.set(name,new Map())},
  transaction(names){
    const tx={objectStore:openStore,oncomplete:null,onerror:null,onabort:null};
    setTimeout(()=>tx.oncomplete?.(),10);
    return tx;
  }
};
const indexedDB={
  open(){
    const req={result:null,onupgradeneeded:null,onsuccess:null,onerror:null};
    setTimeout(()=>{
      req.result=db;
      req.onupgradeneeded?.();
      req.onsuccess?.();
    },0);
    return req;
  }
};
const storage=new Map();
const localStorage={
  get length(){return storage.size},
  key:i=>[...storage.keys()][i]||null,
  getItem:k=>storage.get(k)||null,
  setItem:(k,v)=>storage.set(k,String(v)),
  removeItem:k=>storage.delete(k)
};
const ctx={RECLASSIFIER_BUILD:{testLabel:'TEST_18_PR335'},
  location:{pathname:'/data/Reclassifer_TEST_18_PR335.html'},
  indexedDB,localStorage,console,Date,Math,Map,Set,Array,Number,String,
  Object,JSON,Promise,setTimeout,clearTimeout,queueMicrotask};
ctx.globalThis=ctx;
vm.createContext(ctx);
for(const code of [scopeSource,historySource])vm.runInContext(code,ctx);
const history=ctx.ReclassifierDiagnosticHistory;
(async()=>{
  await history.bootstrap();
  const sid='test18_large';
  for(let seq=0;seq<500;seq++)
    history.append('runtime',sid,seq,
      {phase:'test-case',event:'progress',at:new Date().toISOString()},
      {eventCount:seq+1,startedAt:'2026-10-29T20:00:00.000Z',testLabel:'TEST_18_PR335'});
  await history.drain();
  assert.equal(tables.get('events').size,384,
    'Oldest event must be deleted in the same IndexedDB transaction as latest');
  let report=await history.collect('runtime');
  assert.equal(report.sessions.length,1);
  assert.equal(report.sessions[0].events.length,384);
  assert.equal(report.storage.missingSequences,0,
    'Intentional retention must not be misreported as unrecovered data');
  assert.equal(report.storage.completenessKnown,true);
  for(let i=0;i<6;i++){
    const session='other'+String(i);
    history.append('runtime',session,0,
      {phase:'checkpoint',event:'start',at:new Date().toISOString()},
      {eventCount:1,startedAt:'2026-10-29T20:'+
        String(10+i).padStart(2,'0')+':00.000Z',testLabel:'TEST_18_PR335'});
    await history.drain();
  }
  report=await history.collect('runtime');
  assert.equal(report.sessions.length,4,'Only last 4 Runtime sessions should remain');
  assert(!report.sessions.some(s=>s.sessionId===sid));
  assert(report.sessions.some(s=>s.sessionId==='other5'));
  assert.equal(tables.get('sessions').size,4);
  assert.equal(tables.get('events').size,4);
  assert.equal(history.status().walPending,0);
  console.log('PASS TEST_18 IndexedDB: 384-event sliding window, 4 newest sessions, no false missing sequences, WAL drained');
})().catch(error=>{console.error(error);process.exitCode=1});
