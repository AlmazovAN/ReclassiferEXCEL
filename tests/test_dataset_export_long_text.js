'use strict';
const assert=require('node:assert/strict');
const XLSX=require('../vendor/xlsx.full.min.js');
globalThis.XLSX=XLSX;
require('../src/js/workers/dataset_export_processor.js');
const processor=globalThis.ReclassifierDatasetExportWorkerProcessor;
assert.equal(typeof processor?.process,'function');

function reconstruction(book,originalRow,originalCol){
  const sheet=XLSX.utils.sheet_to_json(book.Sheets['Мобильные бригады'],{header:1,raw:true});
  const first=sheet[originalRow-1][originalCol-1];
  const extra=book.Sheets['Продолжения текстов'];
  if(!extra)return first;
  const chunks=XLSX.utils.sheet_to_json(extra,{header:1,raw:true}).slice(1)
    .filter(row=>Number(row[0])===originalRow && Number(row[1])===originalCol)
    .sort((a,b)=>Number(a[3])-Number(b[3]))
    .map(row=>row[4]);
  return first+chunks.join('');
}

const emojiBoundary='x'.repeat(32766)+'😀'+'Ж'.repeat(33000);
const huge='Комментарий'.repeat(9000);
const exact='z'.repeat(32767);

const small=processor.process({
  sheetName:'Мобильные бригады',
  columns:['Номер задачи','Комментарий','Описание'],
  rows:[['A-01',emojiBoundary,huge],['A-02',exact,'короткий']]
});
assert.equal(small.rows,2);
assert.equal(small.columns,3);
assert.equal(small.longTextCells,2);
assert(small.overflowParts>=3);
const book=XLSX.read(new Uint8Array(small.bytes),{type:'array',dense:true});
assert.deepEqual(book.SheetNames,['Мобильные бригады','Продолжения текстов']);
assert.equal(reconstruction(book,2,2),emojiBoundary,
  'Continuation sheet must restore Unicode text exactly');
assert.equal(reconstruction(book,2,3),huge,
  'Continuation sheet must contain EVERY character');
assert.equal(reconstruction(book,3,2),exact);
const longRows=XLSX.utils.sheet_to_json(book.Sheets['Продолжения текстов'],{header:1});
for(const row of longRows.slice(1)) {
  assert(String(row[4]||'').length<=32767,'Continuation exceeded Excel cell limit');
}
const normal=processor.process({
  sheetName:'Мобильные бригады',
  columns:['Задача','Описание'],
  rows:[['B-01','Короткий комментарий']]
});
assert.equal(normal.longTextCells,0);
const normalBook=XLSX.read(new Uint8Array(normal.bytes),{type:'array'});
assert.equal(normalBook.SheetNames.length,1,
  'No extra sheet for ordinary exports');

const manyRows=Array.from({length:2001},(_,index)=>
  ['MB-'+index,index===2000?emojiBoundary:'краткий']);
const big=processor.process({
  sheetName:'Мобильные бригады',
  columns:['Задача','Описание'],
  rows:manyRows
});
assert.equal(big.rows,2001);
assert.equal(big.longTextCells,1);
const bigBook=XLSX.read(new Uint8Array(big.bytes),{type:'array',dense:true});
assert.equal(reconstruction(bigBook,2002,2),emojiBoundary,
  'Chunked exporter must preserve large text at absolute Excel row number');
console.log('XLSX 32767-char limit: complete source text preserved on companion sheet: OK');
