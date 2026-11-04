// PR-4 real SQLite WASM staging regression. Requires a built CORE or FULL artifact.
// Tests TEMP isolation, deterministic duplicate suffixes, atomic commit and rollback.
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const dist = path.resolve(process.env.RECLASSIFIER_HTML_DIR || path.join(__dirname,'..','dist'));
const matches = fs.readdirSync(dist)
  .filter(name => /^Reclassifier_v.*_CORE\.html$/.test(name))
  .sort();
assert(matches.length, 'Build a CORE HTML before running this test; avoid private FULL artifacts.');
const html = fs.readFileSync(path.join(dist,matches.at(-1)),'utf8');
const vendor = html.match(/<script id="sqliteVendorSource">([\s\S]*?)<\/script>/);
const wasm = html.match(/"sqliteWasmBase64": "([A-Za-z0-9+/=]+)"/);
assert(vendor && wasm,'SQLite WASM assets are missing from built HTML.');
vm.runInThisContext(vendor[1],{filename:'sqlite-vendor.js'});
const load = file => vm.runInThisContext(
  fs.readFileSync(path.join(__dirname,'..','src/js',file),'utf8'),{filename:file});
load('app/dataset_catalog.js');
load('app/database_contract.js');
load('modules/mobile_brigade/rules.js');
new Function('assets','build','log',
  fs.readFileSync(path.join(__dirname,'..','src/js/app/database_core.js'),'utf8')
)({sqliteWasmBase64:wasm[1]}, {version:'pr4-test',sqliteVersion:'3.53.4'},()=>{});
const rules=globalThis.ReclassifierMobileBrigadeRules;
const db=globalThis.ReclassifierDatabaseRepository;
const columns=Array.from(rules.outputColumns);
const taskCol=columns.indexOf('Номер задачи');
function pair(task, key, request='INC-1') {
  const record={site:'Северный',taskNumber:task,recordKey:key,request,
    laborHours:1,finalTaskType:'Прочее'};
  const row=columns.map(col => col === 'Участок'?'Северный':
    col === 'Номер задачи'?task:col === 'Заявка'?request:'');
  return {record,row};
}
function summary(count) {
  return {stats:{rows:count},rulesVersion:'test',freshnessMin:'2026-09-01',
    freshnessMax:'2026-09-30',freshnessByScope:{Северный:'2026-09-30'},
    sourceFreshness:[{fileName:'test.xlsx',freshness:'2026-09-30'}]};
}
async function main() {
  await db.createDatabase({appVersion:'pr4-test'});
  db.upsertDataset('mobile_brigade_data',[pair('TASK-OLD','северный|task-old').record],
    {state:{},fullDataset:{columns,rows:[pair('TASK-OLD','северный|task-old').row]}});
  const before=db.getDatasetRegistry('mobile_brigade_data');
  const stage=db.beginMobileBrigadeStage(5000);
  assert.equal(stage.batchSize,5000);
  const initial=[
    pair('TASK-2','северный|task-2'),
    pair('TASK-2','северный|task-2'),
    pair('TASK-2-D1','северный|task-2-d1')
  ];
  assert.equal(db.appendMobileBrigadeStage(stage.id,1,initial).rows,3);
  assert.throws(()=>db.appendMobileBrigadeStage(stage.id,1,initial),/последовательность/);
  assert.equal(Number(db.getDatasetRegistry('mobile_brigade_data').record_count),1,
    'TEMP stage must never publish event rows.');
  const preview=db.finalizeMobileBrigadeStage(stage.id,summary(3));
  assert.equal(preview.duplicateRecordKeys,1);
  assert.equal(preview.rowsInserted,3);
  const staged=db.getMobileBrigadeStageRows(stage.id);
  assert.equal(staged.rows[1][taskCol],'TASK-2-D2',
    'Synthetic suffix must never collide with a real incoming TASK-2-D1.');
  assert.equal(staged.rows.length,3);
  const committed=await db.commitMobileBrigadeStage(stage.id);
  assert.equal(committed.rowsInserted,3);
  assert.equal(committed.rowsAfter,4);
  const data=db.getDataset('mobile_brigade_data');
  assert.equal(data.records.length,4);
  assert(data.records.some(item=>item.recordKey==='северный|task-2-d2'));
  assert.equal(data.fullDataset.rows.length,4);
  assert.equal(data.fullDataset.coverage,'complete');
  assert.equal(Number(db.getDatasetRegistry('mobile_brigade_data').record_count),4);

  const rollbackStage=db.beginMobileBrigadeStage(5000);
  const many=Array.from({length:5000},(_,i)=>
    pair('NEXT-'+i,'северный|next-'+i));
  assert.throws(()=>db.appendMobileBrigadeStage(rollbackStage.id,1,
    [...many,pair('TOO-MANY','северный|too-many')]),/размер пакета/);
  db.appendMobileBrigadeStage(rollbackStage.id,1,many);
  db.appendMobileBrigadeStage(rollbackStage.id,2,[pair('NEXT-5000','северный|next-5000')]);
  db.finalizeMobileBrigadeStage(rollbackStage.id,summary(5001));
  await assert.rejects(
    ()=>db.commitMobileBrigadeStage(rollbackStage.id, progress=>{
      if(progress.processedRows>=1000) throw new Error('synthetic cancellation');
    }),
    /synthetic cancellation/
  );
  assert.equal(Number(db.getDatasetRegistry('mobile_brigade_data').record_count),4,
    'Rollback must protect the entire active Dataset.');
  assert.equal(db.getMobileBrigadeStageRows(rollbackStage.id).rows.length,5001,
    'Failed commit should leave the TEMP stage available for inspection.');
  db.discardMobileBrigadeStage(rollbackStage.id);
  assert(db.runHealthCheck().ok,'SQLite integrity check must pass after rollback.');
  db.closeDatabase();
  console.log('PR-4 MB staged SQLite: TEMP isolation, dedup, atomicity, rollback OK');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
