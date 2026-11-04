// Optional synthetic MB load test: node --max-old-space-size=4096 this-file 50000|120000|250000
// Not comparable with Opera browser-process memory; records timing and Node heap/RSS.
'use strict';
const assert=require('node:assert/strict');
const XLSX=require('../vendor/xlsx.full.min.js');
globalThis.XLSX=XLSX;
require('../src/js/modules/mobile_brigade/rules.js');
require('../src/js/workers/mobile_brigade_processor.js');
const count=Number(process.argv[2]||50000);
if(!Number.isInteger(count)||count<10000||count>250000){
  throw new Error('Row count must be between 10000 and 250000.');
}
const headers=['Участок','Заявка','Номер задачи','Тип задачи',
  'Фактическая дата','Фактические трудозатраты','Описание'];
const sheet=XLSX.utils.aoa_to_sheet([headers]);
const chunk=1500;
const start=Date.now();
for(let offset=0;offset<count;offset+=chunk){
  const rows=Array.from({length:Math.min(chunk,count-offset)},(_,j)=>{
    const i=offset+j+1;
    return ['Северный','INC-'+i,'TASK-'+i,'Прочее',
      '2026-09-25','30мин.','Проверка кабельного соединения / '+i];
  });
  XLSX.utils.sheet_add_aoa(sheet,rows,{origin:{r:offset+1,c:0}});
}
const wb=XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb,sheet,'МБ');
const xlsx=XLSX.write(wb,{type:'array',bookType:'xlsx',compression:true});
const bytes=xlsx instanceof ArrayBuffer?xlsx:
  xlsx.buffer.slice(xlsx.byteOffset,xlsx.byteOffset+xlsx.byteLength);
let processed=0,batches=0,peakHeap=0,peakRss=0;
const observe=()=>{
  const m=process.memoryUsage();
  peakHeap=Math.max(peakHeap,m.heapUsed);
  peakRss=Math.max(peakRss,m.rss);
};
(async()=>{
  const result=await globalThis.ReclassifierMobileBrigadeWorkerProcessor.process(
    {files:[{fileName:'MB_2026-09-25.xlsx',bytes}],itsmData:[],
      deferExport:true,streamToSqlite:true,batchSize:5000},
    ()=>observe(),
    async(rows,sequence)=>{
      observe();
      assert.equal(sequence,++batches,'Missing or repeated batch');
      assert(rows.length>0&&rows.length<=5000,'Unexpected SQLite batch size');
      for(const item of rows){
        assert.equal(item.row.length,38);
        assert(item.record?.recordKey,'Lost MB recordKey');
      }
      processed+=rows.length;
      await new Promise(resolve=>setImmediate(resolve));
    }
  );
  assert.equal(result.stageOnly,true);
  assert.equal(result.stats.rows,count);
  assert.equal(processed,count);
  assert.equal(result.bytes,null);
  assert.equal(result.mobileBrigadeData.records,null);
  assert.equal(result.mobileBrigadeFullDataset.rows,null);
  observe();
  console.log(JSON.stringify({
    status:'PASS',rows:count,batches,inputBytes:bytes.byteLength,
    elapsedSeconds:Number(((Date.now()-start)/1000).toFixed(1)),
    nodePeakHeapMiB:Math.round(peakHeap/1048576),
    nodePeakRssMiB:Math.round(peakRss/1048576)
  }));
})().catch(error=>{console.error(error);process.exitCode=1;});
