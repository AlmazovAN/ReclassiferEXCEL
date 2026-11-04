'use strict';
const assert = require('node:assert/strict');
const XLSX = require('../vendor/xlsx.full.min.js');
globalThis.XLSX = XLSX;
require('../src/js/modules/mobile_brigade/rules.js');
require('../src/js/workers/mobile_brigade_processor.js');

const rowsZF = 5102;
const rowsKF = 6001;
const total = rowsZF + rowsKF;
const wb = XLSX.utils.book_new();
const zfHeaders = ['Участок','Номер задачи','Тип задачи','Фактическая дата',
  'Фактические трудозатраты','Заявка','Описание'];
const kfHeaders = ['Описание','Заявка','Фактические трудозатраты',
  'Тип задачи','Участок','Фактическая дата','Номер задачи'];
const zf = [zfHeaders];
const kf = [kfHeaders];
for (let i=0;i<rowsZF;i++) zf.push(['Северный','Z-'+i,'АВР','2026-10-19','30мин.','INC-Z-'+i,'ЗФ '+i]);
for (let i=0;i<rowsKF;i++) kf.push(['КФ '+i,'INC-K-'+i,'1ч. 0мин.','АВР','Северный',
  '2026-10-19',i===0?'Z-99':'K-'+i]);
XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet(zf),'ПСПА ЗФ');
XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet(kf),'ПСПА КФ');
const binary=XLSX.write(wb,{bookType:'xlsx',type:'array'});
const bytes=binary instanceof ArrayBuffer ? binary :
  binary.buffer.slice(binary.byteOffset,binary.byteOffset+binary.byteLength);

(async()=>{
  const sizes=[];
  const staged=[];
  const result=await globalThis.ReclassifierMobileBrigadeWorkerProcessor.process({
    files:[{fileName:'tasks_2026-09-01_2026-10-20.xlsx',bytes}],
    itsmData:[],deferExport:true,streamToSqlite:true,batchSize:5000
  },()=>{},async(batch,sequence)=>{
    assert.equal(sequence,sizes.length+1);
    assert(batch.length<=5000);
    sizes.push(batch.length);
    staged.push(...batch);
    await new Promise(resolve=>setImmediate(resolve));
  });
  assert.deepEqual(sizes,[5000,5000,1103]);
  assert.equal(result.stageOnly,true);
  assert.equal(result.stats.batchSize,5000);
  assert.equal(result.stats.batches,3);
  assert.equal(result.stats.rows,total);
  assert.equal(result.stats.sheets,2);
  assert.deepEqual(result.stats.sheetDetails.map(x=>[x.sheetName,x.acceptedRows]),
    [['ПСПА ЗФ',rowsZF],['ПСПА КФ',rowsKF]]);
  assert.equal(result.mobileBrigadeData.records,null);
  assert.equal(result.mobileBrigadeFullDataset.rows,null);
  assert.equal(result.bytes,null);
  assert.equal(result.stats.diagnostics.phases.at(-1).excelGenerated,false);
  assert.equal(staged.length,total);
  assert(staged.every(x=>x.row.length===38),'Missing 38-column Full Dataset row');
  const keys=staged.map(x=>x.record.recordKey);
  assert.equal(new Set(keys).size,total-1,'One cross-sheet duplicate must reach SQLite stage');
  assert(staged.some(x=>x.record.taskNumber==='K-6000'));
  console.log('PASS: 5000-row batches, ZF/KF sheets, ACK cadence, no XLSX, cross-sheet duplicates');
})().catch(e=>{console.error(e);process.exitCode=1;});
