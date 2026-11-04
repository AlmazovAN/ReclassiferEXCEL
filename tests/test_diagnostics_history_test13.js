'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');

// No IndexedDB: localStorage WAL must preserve all events, even when the
// 320-entry in-memory UI ring has rolled over. No synthetic disk guarantees.
const memory=new Map();
const localStorage={
  get length(){return memory.size;},
  key:n=>Array.from(memory.keys())[n]||null,
  getItem:k=>memory.get(k)||null,
  setItem:(k,v)=>memory.set(k,String(v)),
  removeItem:k=>memory.delete(k)
};
const downloads=[];
function openTab(){
  const doc={getElementById:()=>null,body:{appendChild(){}},
    createElement:()=>({style:{},click(){downloads.push(this.download)},remove(){},select(){}}),
    execCommand:()=>true};
  const ctx={
    localStorage,document:doc,performance:{memory:{usedJSHeapSize:128*1048576}},
    navigator:{userAgent:'Test browser',deviceMemory:8,
      clipboard:{writeText:async()=>{}}},
    location:{protocol:'file:'},Blob,URL:{createObjectURL:()=> 'blob:test13',
      revokeObjectURL(){}},
    RECLASSIFIER_BUILD:{testLabel:'TEST_13_PR322'},
    globalThis:null,
    Date,Math,JSON,Number,String,Boolean,Object,Array,Map,Set,
    setTimeout:(f)=>{f();return 1;},console
  };
  ctx.globalThis=ctx;
  vm.createContext(ctx);
  for(const p of ['src/js/app/diagnostic_history.js',
    'src/js/app/xlsx_export_diagnostics.js','src/js/app/database_ui_state.js']){
    vm.runInContext(fs.readFileSync(p,'utf8'),ctx,{filename:p});
  }
  return ctx;
}
(async()=>{
  let tab=openTab(),x=tab.ReclassifierXlsxExportDiagnostics;
  assert.equal(x.enabled(),true);
  assert.equal(x.begin({from:'2025-01-01',to:'2025-02-01',
    columns:38,mode:'full'}),true);
  for(let i=0;i<500;i++)x.mark('xlsx-worker-append','progress',{totalRows:i});
  assert.equal(x.snapshot().events.length,320);
  assert.equal(x.snapshot().eventCount,501);
  const first=await tab.ReclassifierDiagnosticHistory.collect('xlsx',x.snapshot());
  assert.equal(first.sessions.length,1);
  assert.equal(first.sessions[0].archivedEventCount,501);
  assert.equal(first.storage.eventsRecovered,501);
  assert.equal(first.storage.completenessKnown,false,
    'No IndexedDB means a browser eviction can still lose history');

  // Simulated tab hard-close / restart, preserving same file origin storage.
  tab=openTab();x=tab.ReclassifierXlsxExportDiagnostics;
  assert.equal(x.snapshot().status,'running');
  assert.equal(x.snapshot().eventCount,501);
  const restored=await tab.ReclassifierDiagnosticHistory.collect('xlsx',x.snapshot());
  assert.equal(restored.sessions[0].events.length,501);
  x.finish('failed',{totalRows:500});
  assert.equal(x.begin({from:'2025-03-01',to:'2025-03-31',
    mode:'full',columns:38}),true);
  x.mark('xlsx-worker-serialize','start',{totalCells:120000});
  const all=await tab.ReclassifierDiagnosticHistory.collect('xlsx',x.snapshot());
  assert.equal(all.sessions.length,2,'Starting new export must not clear old session');
  assert.equal(all.sessions[0].events.length,502);
  assert.equal(all.sessions[1].events.length,2);
  assert.equal(await x.downloadReport(),true);
  assert(downloads.some(name=>name.includes('TEST_13_PR322')));

  const runtime=tab.ReclassifierDatabaseMemoryDiagnostics;
  assert.equal(runtime.isEnabled(),true);
  runtime.mark('runtime-list','start',{recordCount:17});
  runtime.mark('runtime-list','end',{recordCount:17});
  const saved=await tab.ReclassifierDiagnosticHistory.collect('runtime',runtime.snapshot());
  assert(saved.sessions.some(s=>s.events.some(e=>e.phase==='runtime-list')));
  const noSensitive=JSON.stringify(all)+JSON.stringify(saved);
  assert(!noSensitive.includes('CONFIDENTIAL_EXCEL_CELL'));
  console.log('PASS TEST_13 journal: all 501 events, reload recovery, two sessions, fallback warnings');
})().catch(e=>{console.error(e);process.exitCode=1});
