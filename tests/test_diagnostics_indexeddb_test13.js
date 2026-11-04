'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const archive={events:new Map(),sessions:new Map()};
const memory=new Map();
const localStorage={
  get length(){return memory.size},
  key(i){return Array.from(memory.keys())[i]||null},
  getItem(k){return memory.get(k)||null},
  setItem(k,v){memory.set(k,String(v))},
  removeItem(k){memory.delete(k)}
};
const objectStoreNames={contains:k=>k in archive};
function store(name,tx){
  return {
    put(o){archive[name].set(o.id,structuredClone(o));},
    getAll(){
      const req={result:null,onsuccess:null,onerror:null};
      setImmediate(()=>{req.result=Array.from(archive[name].values());
        req.onsuccess?.({target:req});});
      return req;
    }
  };
}
const db={
  objectStoreNames,
  createObjectStore(name){archive[name]=new Map();},
  transaction(names,mode){
    const tx={oncomplete:null,onerror:null,onabort:null,
      objectStore:name=>store(name,tx)};
    if(mode==='readwrite')setImmediate(()=>tx.oncomplete?.());
    return tx;
  },
  close(){}
};
const indexedDB={
  open(){
    const request={result:db,onupgradeneeded:null,onsuccess:null,onerror:null};
    setImmediate(()=>{request.onupgradeneeded?.();request.onsuccess?.();});
    return request;
  }
};
function tab(){
  const ctx={globalThis:null,console,indexedDB,localStorage,Date,Math,
    Number,String,Object,Array,Map,Set,JSON,
    RECLASSIFIER_BUILD:{testLabel:'TEST_13_PR322'},
    navigator:{userAgent:'Test Opera',deviceMemory:8},location:{protocol:'file:'},
    performance:{memory:{usedJSHeapSize:256*1048576}},
    Blob,URL:{createObjectURL:()=> 'blob:archive',revokeObjectURL(){}},
    setTimeout,document:{getElementById:()=>null,body:{appendChild(){}},
      createElement:()=>({style:{},click(){},remove(){},select(){}})}
  };
  ctx.globalThis=ctx;vm.createContext(ctx);
  for(const path of ['src/js/app/diagnostic_history.js',
    'src/js/app/xlsx_export_diagnostics.js']){
    vm.runInContext(fs.readFileSync(path,'utf8'),ctx,{filename:path});
  }
  return ctx;
}
(async()=>{
  let a=tab();
  await a.ReclassifierDiagnosticHistory.bootstrap();
  assert.equal(a.ReclassifierDiagnosticHistory.status().indexedDB,'available');
  const diag=a.ReclassifierXlsxExportDiagnostics;
  diag.begin({mode:'full',from:'2025-01-01',to:'2025-01-31',columns:38});
  for(let n=0;n<500;n++)diag.mark('xlsx-worker-append','progress',{totalRows:n});
  const first=await a.ReclassifierDiagnosticHistory.collect('xlsx',diag.snapshot());
  assert.equal(first.sessions[0].events.length,501);
  assert.equal(first.storage.walPending,0,'Committed WAL must be removed');
  assert.equal(first.storage.completenessKnown,true);

  // Restore after browser renderer reload with same IndexedDB and localStorage.
  a=tab();
  await a.ReclassifierDiagnosticHistory.bootstrap();
  const previous=await a.ReclassifierDiagnosticHistory.collect('xlsx',
    a.ReclassifierXlsxExportDiagnostics.snapshot());
  assert.equal(previous.sessions[0].events.length,501);
  assert.equal(previous.storage.completenessKnown,true);

  a.ReclassifierXlsxExportDiagnostics.finish('completed',{totalRows:500});
  a.ReclassifierXlsxExportDiagnostics.begin({
    mode:'full',from:'2025-02-01',to:'2025-02-28',columns:38});
  a.ReclassifierXlsxExportDiagnostics.mark('xlsx-sqlite-page','end',
    {scannedRows:271496,batchRows:10000});
  const both=await a.ReclassifierDiagnosticHistory.collect('xlsx',
    a.ReclassifierXlsxExportDiagnostics.snapshot());
  assert.equal(both.sessions.length,2);
  assert.equal(both.sessions[0].events.length,502);
  assert.equal(both.sessions[1].events.length,2);
  assert.equal(both.storage.completenessKnown,true);
  console.log('PASS TEST_13 IndexedDB: committed events, WAL deletion, reboot, sessions preserved');
})().catch(e=>{console.error(e);process.exitCode=1});
