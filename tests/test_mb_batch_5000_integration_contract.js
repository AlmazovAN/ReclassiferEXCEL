'use strict';
// Static integration contract for the current 0.37.0 branch, not a substitute for browser tests.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.join(__dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
const worker=read('src/js/workers/mobile_brigade_processor.js');
const client=read('src/js/app/worker_client.js');
const transport=read('src/js/worker.js');
const runtime=read('src/js/app/runtime.js');
const db=read('src/js/app/database_core.js');
const ui=read('src/js/modules/mobile_brigade/ui.js');
const build=read('build/build.py');
const facade=read('src/js/app/mobile_brigade_staging.js');
for(const [name,source] of [
  ['Worker',worker],['Worker transport',transport],['Worker client',client],
  ['SQLite repository',db],['Mobile Brigade UI',ui],['SQLite facade',facade]]) {
  assert.doesNotThrow(()=>new Function(source),name+' has invalid JavaScript');
}
assert(worker.includes('payload?.batchSize ?? 5000'),'5000 default missing in worker');
assert(worker.includes('stageRows.length >= batchSize'),'Worker must flush at selected limit');
assert(worker.includes('await reportBatch(rows, ++stageSequence)'),'Worker must await every batch ACK');
assert(worker.includes('stageOnly: streamToSqlite'),'Worker must not return all rows in staged mode');
assert(worker.includes('sheetDetails'),'Loss of 0.37 multi-sheet accounting');
assert(db.includes('beginMobileBrigadeStage(batchSize = 5000)'),'SQLite default 5000 missing');
assert(db.includes('batch.length > mobileStage.batchSize'),'SQLite batch cap must match stage limit');
assert(db.includes('BEGIN IMMEDIATE'),'Atomic commit missing');
assert(db.includes('ROLLBACK'),'Atomic rollback missing');
assert(client.includes('WORKER_STAGE_ACK'),'Worker client ACK contract missing');
assert(transport.includes('WORKER_STAGE_BATCH'),'Worker transport batch contract missing');
assert(runtime.includes('onProgress = null, onBatch = null'),'Runtime must forward batch handler');
assert(ui.includes('repository.begin(mobileBatchSize)'),'UI must configure SQLite stage size');
assert(ui.includes('streamToSqlite:true,batchSize:mobileBatchSize'),'UI must configure Worker size');
assert(ui.includes('mobileBatchSize = 5000'),'UI default must be 5000');
assert(ui.includes('mobileBrigadeBatchSize'),'UI batch selector missing');
assert(build.includes('app/mobile_brigade_staging.js'),'SQLite facade missing from HTML build');
assert(facade.includes('beginMobileBrigadeStage(batchSize)'),'Facade must pass configured size');
console.log('PASS: SQLite 5000-row runtime/build/Worker/ACK/UI integration contract');
