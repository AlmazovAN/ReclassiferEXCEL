'use strict';
// TEST_11_PR322: diagnostics are opt-in by build label and contain metrics only.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('src/js/app/xlsx_export_diagnostics.js','utf8');
const cache = new Map();
const downloads = [];
const localStorage = {
  getItem: key => cache.get(key) || null,
  setItem: (key,val) => cache.set(key,val)
};
function context(testLabel, persist = localStorage) {
  const buttons = {};
  const doc = {
    getElementById(id) {
      return buttons[id] || null;
    },
    createElement(name) {
      assert(['a','textarea'].includes(name));
      return {
        style:{},click(){downloads.push({name:this.download,href:this.href});},
        remove(){},select(){}
      };
    },
    body:{appendChild(){}},
    execCommand(){return true;}
  };
  const sandbox = {
    globalThis:null,RECLASSIFIER_BUILD:{testLabel},localStorage:persist,
    document:doc, Blob,URL:{
      createObjectURL:()=> 'blob:test11',
      revokeObjectURL:()=>{}
    },navigator:{userAgent:'Test Browser',clipboard:{writeText:async()=>{}}},
    setTimeout:fn=>{fn();return 1;},
    performance:{memory:{usedJSHeapSize:268435456}},
    Date,Number,Math,Array,JSON,Set,Map,String,Object,Boolean,
    console
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(source,sandbox,{filename:'xlsx_export_diagnostics.js'});
  return sandbox.ReclassifierXlsxExportDiagnostics;
}
const production=context(null);
assert.equal(production.enabled(),false);
assert.equal(production.begin({rows:15}),false);
assert.equal(production.report(),null);

const diag=context('TEST_11_PR322');
assert.equal(diag.enabled(),true);
assert.equal(diag.begin({mode:'full',from:'2025-02-01',to:'2025-03-31',
  columns:38,fullRows:156814,sourceRows:271496}),true);
diag.mark('xlsx-sqlite-page','end',{
  batchRows:10000, scannedRows:271496, durationMs:1204,
  recordKey:'SECRET_RECORD', name:'CORPORATE_FILE.xlsx',
  data:['SECRET_CELL_CONTENT']
});
diag.mark('xlsx-worker-serialize','start',{totalCells:380000});
for (let i=0;i<370;i++) diag.mark('xlsx-worker-append','progress',{totalRows:i});
// A recent SQLite phase remains observable even after bounded journal rotation.
diag.mark('xlsx-sqlite-page','end',{scannedRows:271496,batchRows:10000});
assert.equal(diag.snapshot().events.length,320);
assert(diag.snapshot().discardedEvents>0);
assert.equal(diag.snapshot().lastStarted,'xlsx-worker-serialize');
assert.equal(diag.isPersisted(),true);
assert.equal(diag.snapshot().peakSampledMainJsHeapMiB,256);
const saved = diag.report();
assert(!saved.includes('SECRET_RECORD'));
assert(!saved.includes('CORPORATE_FILE.xlsx'));
assert(!saved.includes('SECRET_CELL_CONTENT'));
assert(saved.includes('scannedRows'));
assert(saved.includes('rendererRssMiB'));

// A simulated renderer restart retains an incomplete report.
const recovered=context('TEST_11_PR322');
assert.equal(recovered.snapshot().status,'running');
assert.equal(recovered.snapshot().lastStarted,'xlsx-worker-serialize');
assert.equal(recovered.isPersisted(),true);
assert.equal(diag.finish('completed',{totalRows:156814,outputBytes:157286400}),true);
assert.equal(JSON.parse(diag.report()).status,'completed');
assert.equal(diag.downloadReport(),true);
assert.match(downloads.at(-1).name,/Reclassifer_XLSX_Diagnostic_TEST_11_PR322_completed_/);
assert.equal(context('TEST_11_PR322').snapshot().status,'completed');

// File-origin localStorage denial must never abort the XLSX export.
const forbidden = {
  getItem(){throw new Error('SecurityError');},
  setItem(){throw new Error('SecurityError');}
};
const fallback=context('TEST_11_PR322',forbidden);
assert.equal(fallback.begin({rows:1}),true);
fallback.mark('xlsx-worker-append','end',{totalRows:1});
assert.equal(fallback.isPersisted(),false);
assert.equal(fallback.finish('failed'),true);
assert(fallback.report().includes('"storagePersisted": false'));

// Regression guardrails for the real pipeline: no change to classification.
const app=fs.readFileSync('src/js/app/dataset_excel_export.js','utf8');
const worker=fs.readFileSync('src/js/worker.js','utf8');
const processor=fs.readFileSync('src/js/workers/dataset_export_processor.js','utf8');
const database=fs.readFileSync('src/js/app/database_core.js','utf8');
const build=fs.readFileSync('build/build.py','utf8');
assert.match(app,/xlsx-sqlite-page/);
assert.match(app,/trace\.downloadReport\(\)/);
assert.match(app,/sqliteMbDiagCopy/);
assert.match(worker,/xlsx-worker-wait-batch/);
assert.match(processor,/xlsx-worker-serialize/);
assert.match(database,/scannedRows, matchedRows, jsonChars/);
assert.match(build,/app\/xlsx_export_diagnostics\.js/);
assert.match(build,/"testLabel": getattr\(args, "test_label", None\)/);
console.log('PASS TEST_11: bounded journal, privacy, crash recovery, auto-download and source wiring');
