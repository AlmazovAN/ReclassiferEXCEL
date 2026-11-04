'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const store=new Map(),downloads=[];
function runtime(label='TEST_12_PR322',deny=false){
  const doc={
    getElementById:()=>null,
    body:{appendChild(){}},
    createElement:()=>({style:{},click(){downloads.push(this.download);},remove(){},select(){}}),
    execCommand:()=>true
  };
  const storage=deny?{
    getItem(){throw Error('SecurityError');},setItem(){throw Error('SecurityError');}
  }:{
    getItem:k=>store.get(k)||null,
    setItem:(k,v)=>store.set(k,v)
  };
  const sandbox={
    globalThis:null, RECLASSIFIER_BUILD:{testLabel:label},
    localStorage:storage, document:doc, navigator:{userAgent:'SyntheticTest',deviceMemory:8,
      clipboard:{writeText:async()=>{}}},
    performance:{memory:{usedJSHeapSize:256*1048576,totalJSHeapSize:300*1048576,
      jsHeapSizeLimit:1024*1048576}},
    ReclassifierDatabaseRepository:{getDiagnosticMemorySnapshot:()=>({
      databaseInputMiB:826.74,sqliteWasmCapacityMiB:832
    })},
    Blob, URL:{createObjectURL:()=> 'blob:dummy',revokeObjectURL(){}},
    location:{protocol:'file:'},setTimeout:fn=>{fn();return 1;},
    Date,Math,JSON,Number,Boolean,String,Array,Object,Map,Set,console
  };
  sandbox.globalThis=sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync('src/js/app/database_ui_state.js','utf8'),sandbox);
  vm.runInContext(fs.readFileSync('src/js/app/xlsx_export_diagnostics.js','utf8'),sandbox);
  return sandbox;
}
const x=runtime(),old=x.ReclassifierDatabaseMemoryDiagnostics,
  exp=x.ReclassifierXlsxExportDiagnostics;
assert.equal(old.isEnabled(),true,'TEST_12 must auto-enable Runtime logging');
assert.equal(old.snapshot().testLabel,'TEST_12_PR322');
assert.equal(exp.enabled(),true,'TEST_12 must auto-enable XLSX logging');
old.mark('runtime-sqlite-materialize','start',{datasetId:'mobile_brigade_data'});
old.mark('runtime-sqlite-materialize','end',{datasetId:'mobile_brigade_data',
  rows:271496,fullDatasetRows:156814,recordKey:'CONFIDENTIAL'});
old.mark('runtime-cache','progress',{datasetId:'itsm_data',cacheMisses:1});
old.mark('runtime-cache','progress',{datasetId:'itsm_data',cacheHits:1});
const olds=old.snapshot();
assert.equal(olds.aggregated.materializations,1);
assert.equal(olds.aggregated.materializedRecords,271496);
assert.equal(olds.aggregated.materializedFullRows,156814);
assert.equal(olds.aggregated.byDataset.mobile_brigade_data.calls,1);
assert.equal(olds.aggregated.cacheMisses,1);
assert.equal(olds.aggregated.cacheHits,1);
assert.equal(olds.aggregated.distinctHeapSamples,1);
assert.equal(olds.aggregated.peakSqliteWasmCapacityMiB,832);
assert(!old.report().includes('CONFIDENTIAL'));

assert.equal(exp.begin({from:'2026-08-01',to:'2026-09-30',mode:'full',
  sourceRows:271496,fullRows:156814,missingFullRows:114682,columns:38}),true);
exp.setCoverage([
  {month:'2026-08',dated:6000,fullRows:4500,analyticalRows:6000},
  {month:'2026-09',dated:8000,fullRows:7100,analyticalRows:8000},
  {month:'BAD',dated:99,fullRows:20,analyticalRows:99}
]);
exp.captureDatabase({databaseInputMiB:826.74,sqliteWasmCapacityMiB:832});
exp.mark('xlsx-sqlite-page','end',{batchRows:10000,scannedRows:271496,
  matchedRows:10001,durationMs:7500,jsonChars:987000,hasMore:1,
  fileName:'secret.xlsx'});
exp.mark('xlsx-sqlite-page','end',{batchRows:1600,scannedRows:271496,
  matchedRows:11600,durationMs:8000,jsonChars:155000,hasMore:0});
exp.mark('xlsx-worker-append','end',{batchRows:1600,totalCells:440800,
  totalRows:11600,durationMs:1350});
exp.mark('xlsx-worker-serialize','end',{durationMs:9300,outputBytes:30000000});
assert.equal(exp.snapshot().aggregated.pages,2);
assert.equal(exp.snapshot().aggregated.scannedRows,542992);
assert.equal(exp.snapshot().aggregated.selectedRows,11600);
assert.equal(exp.snapshot().aggregated.returnedRows,11600);
assert.equal(exp.snapshot().aggregated.workerWriteElapsedMs,9300);
assert.equal(exp.snapshot().monthlyCoverage.length,2);
assert.equal(exp.snapshot().databaseEnvironment.sqliteWasmCapacityMiB,832);
assert(!exp.report().includes('secret.xlsx'));
assert.equal(exp.snapshot().aggregated.heapDistinctSamples,1);
const recovered=runtime();
assert.equal(recovered.ReclassifierXlsxExportDiagnostics.snapshot().status,'running');
assert.equal(recovered.ReclassifierDatabaseMemoryDiagnostics.snapshot().aggregated.materializations,1);
assert.equal(exp.finish('completed',{totalRows:11600}),true);
assert.equal(exp.downloadReport(),true);
assert.equal(old.downloadReport(),true);
assert(downloads.some(x=>x.includes('XLSX_Diagnostic_TEST_12_PR322')));
assert(downloads.some(x=>x.includes('Runtime_Diagnostic_TEST_12_PR322')));

// Security-denied file:// profile must remain operable without persistence.
const denied=runtime('TEST_12_PR322',true);
assert.equal(denied.ReclassifierDatabaseMemoryDiagnostics.isPersisted(),false);
assert.equal(denied.ReclassifierXlsxExportDiagnostics.begin({mode:'full'}),true);
assert.equal(denied.ReclassifierXlsxExportDiagnostics.isPersisted(),false);

// Regression against uninstrumented production labels.
const normal=runtime('RELEASE',true);
assert.equal(normal.ReclassifierDatabaseMemoryDiagnostics.isEnabled(),false);
assert.equal(normal.ReclassifierXlsxExportDiagnostics.enabled(),false);

const codeFiles={
  app:fs.readFileSync('src/js/app/dataset_excel_export.js','utf8'),
  core:fs.readFileSync('src/js/app/database_core.js','utf8'),
  repo:fs.readFileSync('src/js/app/data_repository.js','utf8'),
  runtime:fs.readFileSync('src/js/app/runtime.js','utf8'),
  ui:fs.readFileSync('src/js/app/database_ui.js','utf8')
};
assert.match(codeFiles.core,/monthlyCoverage/);
assert.match(codeFiles.core,/getDiagnosticMemorySnapshot/);
assert.match(codeFiles.repo,/runtime-cache/);
assert.match(codeFiles.repo,/fullDatasetRows/);
assert.match(codeFiles.runtime,/kpi-input-check/);
assert.match(codeFiles.app,/trace\.setCoverage/);
assert.match(codeFiles.app,/oldTrace\?\.downloadReport/);
assert.match(codeFiles.ui,/downloadDatabaseMemoryDiagButton/);
console.log('PASS TEST_12: two journals, detailed scopes, coverage, limited aggregation, no PII, recovery');
