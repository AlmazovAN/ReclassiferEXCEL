// Worker staging transport contract; no corporate files and no active SQLite needed.
'use strict';
const assert = require('node:assert/strict');
const XLSX = require('../vendor/xlsx.full.min.js');
globalThis.XLSX=XLSX;
require('../src/js/modules/mobile_brigade/rules.js');
require('../src/js/workers/mobile_brigade_processor.js');
const cols=['Участок','Заявка','Номер задачи','Тип задачи','Фактическая дата',
  'Фактические трудозатраты','Описание'];
const input=Array.from({length:12103},(_,i)=>[
  'Северный','INC-'+i,'TASK-'+i,'Прочее',new Date(2026,8,25),'30мин.','Проверка '+i
]);
const book=XLSX.utils.book_new();
XLSX.utils.book_append_sheet(book,XLSX.utils.aoa_to_sheet([cols,...input]),'MB');
const binary=XLSX.write(book,{bookType:'xlsx',type:'array'});
const bytes=binary instanceof ArrayBuffer ? binary :
  binary.buffer.slice(binary.byteOffset,binary.byteOffset+binary.byteLength);
const batches=[];
const staged=[];
(async()=>{
  const result=await globalThis.ReclassifierMobileBrigadeWorkerProcessor.process(
    {files:[{fileName:'MB_2026-09-25.xlsx',bytes}],itsmData:[],
      deferExport:true,streamToSqlite:true,batchSize:5000},
    ()=>{},
    async(rows,sequence)=>{
      assert.equal(sequence,batches.length+1);
      assert(rows.length<=5000,'Exceeded batch limit');
      batches.push(rows.length);
      staged.push(...rows);
      await new Promise(resolve=>setImmediate(resolve));
    }
  );
  assert.equal(result.stageOnly,true);
  assert.equal(result.stats.rows,12103);
  assert.equal(batches.length,3);
  assert.deepEqual(batches,[5000,5000,2103]);
  assert.equal(result.bytes,null);
  assert.equal(result.mobileBrigadeFullDataset.rows,null);
  assert.equal(result.mobileBrigadeData.records,null);
  // A staged stream must be equal to the standard in-memory Dataset before
  // SQLite performs its separate global duplicate-key resolution.
  const ordinary=await globalThis.ReclassifierMobileBrigadeWorkerProcessor.process(
    {files:[{fileName:'MB_2026-09-25.xlsx',bytes}],itsmData:[],deferExport:true}
  );
  assert.equal(staged.length,ordinary.stats.rows);
  for(let i=0;i<staged.length;i++){
    assert.deepEqual(staged[i].record,ordinary.mobileBrigadeData.records[i],
      'Staged analytical record changed at position '+i);
    assert.deepEqual(staged[i].row,ordinary.mobileBrigadeFullDataset.rows[i],
      'Staged 38-column row changed at position '+i);
  }
  console.log('MB streaming with acknowledged bounded batches: OK');
})().catch(error=>{console.error(error);process.exitCode=1;});
