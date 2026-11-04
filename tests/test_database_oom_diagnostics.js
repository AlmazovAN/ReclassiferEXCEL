'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const store = new Map();
const storage = {
  getItem: key => store.get(key) || null,
  setItem: (key, value) => store.set(key, value)
};
const documents = {
  getElementById: () => null
};
const source = fs.readFileSync('src/js/app/database_ui_state.js','utf8');
function createRuntime() {
  const sandbox = {
    globalThis:null, localStorage:storage, document:documents,
    Date, Number, String, Boolean, Math, JSON, Map, Set, Array, Object,
    console
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(source,sandbox,{filename:'database_ui_state.js'});
  return sandbox.ReclassifierDatabaseMemoryDiagnostics;
}

const diag = createRuntime();
assert.equal(diag.isEnabled(),false,'Recording must be opt-in');
diag.begin(2);
assert.equal(diag.report(),null,'Disabled mode must not create a report');

diag.setEnabled(true);
diag.begin(2);
diag.mark('recognizer-xlsx','start',{
  inputBytes:102400,fileName:'CONFIDENTIAL.xlsx',
  recordKey:'INC-SECRET',rowsContent:['RESTRICTED'],rows:100
});
diag.mark('recognizer-xlsx','end',{rows:100});
diag.mark('mb-worker-xlsx-read','start',{inputBytes:102400});
diag.mark('mb-worker-batch-ack','end',{confirmedBatches:1});
diag.finish('prepared');
const report=diag.report();
assert(!report.includes('CONFIDENTIAL'));
assert(!report.includes('INC-SECRET'));
assert(!report.includes('RESTRICTED'));
const decoded=JSON.parse(report);
assert.equal(decoded.status,'prepared');
assert.equal(decoded.lastStarted,'mb-worker-xlsx-read');
assert.equal(decoded.lastCompleted,'mb-worker-batch-ack');
assert.equal(decoded.confirmedBatches,1);
assert.equal(decoded.fileCount,2);
assert.equal(diag.isPersisted(),true);

const reopened = createRuntime();
assert.equal(reopened.isEnabled(),false,'Opt-in cannot be silently retained after crash');
assert.equal(reopened.snapshot().events.length,decoded.events.length,
  'Last synchronous checkpoint must be retrievable on reopening');

reopened.setEnabled(true);
for(let i=0;i<150;i++)reopened.mark('long-phase','progress',{processedRows:i});
assert.equal(reopened.snapshot().events.length,80,'Journal must be bounded');
reopened.finish('failed');
assert.equal(createRuntime().snapshot().status,'failed');

// With file:// localStorage disabled, fail gracefully and report no persistence.
const unavailable = vm.createContext({
  globalThis:null,
  localStorage:{
    getItem(){ throw new Error('SecurityError'); },
    setItem(){ throw new Error('SecurityError'); }
  },
  document:documents,
  Date,Number,String,Boolean,Math,JSON,Map,Set,Array,Object,console
});
unavailable.globalThis=unavailable;
vm.runInContext(source,unavailable,{filename:'database_ui_state.js'});
unavailable.ReclassifierDatabaseMemoryDiagnostics.setEnabled(true);
unavailable.ReclassifierDatabaseMemoryDiagnostics.begin(1);
assert.equal(unavailable.ReclassifierDatabaseMemoryDiagnostics.isPersisted(),false);

// Regression contract: the real Database queue, not Mobile Brigade page,
// owns the start and completion; the integration engine supplies Worker phases.
const intake=fs.readFileSync('src/js/app/database_intake_ui.js','utf8');
const queue=fs.readFileSync('src/js/app/database_integration_ui.js','utf8');
const integration=fs.readFileSync('src/js/app/database_integration.js','utf8');
const recognizer=fs.readFileSync('src/js/app/database_recognizer.js','utf8');
const app=fs.readFileSync('src/js/app/database_ui.js','utf8');
assert.match(intake,/databaseMemoryDiagnostics\.begin\(selected\.length\)/);
assert.match(queue,/databaseMemoryDiagnostics\.mark\('candidate-prepare','start'/);
assert.match(queue,/databaseMemoryDiagnostics\.finish\('prepared'\)/);
assert.match(integration,/memoryDiagnostics:trace\?\.isEnabled\?\.\(\)===true/);
assert.match(integration,/candidate-sqlite-preview/);
assert.match(recognizer,/recognizer-xlsx','start'/);
assert.doesNotMatch(app,/Диагностика Runtime \/ импорта \/ KPI|databaseMemoryDiagEnabled|copyDatabaseMemoryDiagButton|downloadDatabaseMemoryDiagButton/);
assert.doesNotMatch(app,/id="copyDatabaseMemoryDiagButton"|id="downloadDatabaseMemoryDiagButton"/);
console.log('PASS: database queue OOM phase trace, privacy, crash restore, storage denial and route wiring');
