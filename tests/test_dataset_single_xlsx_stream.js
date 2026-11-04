'use strict';
// Exercises a single XLSX built from multiple database batches, not multiple
// downloaded files. Uses the bundled real SheetJS writer and reader.
const assert=require('node:assert/strict');
const XLSX=require('../vendor/xlsx.full.min.js');
globalThis.XLSX=XLSX;
require('../src/js/workers/dataset_export_processor.js');
const writerFactory=globalThis.ReclassifierDatasetExportWorkerProcessor.createStream;
assert.equal(typeof writerFactory,'function');

const columns=['Номер задачи','Фактическая дата','Объединённый комментарий'];
const long='Повреждение линии связи. '.repeat(2500)+'конец';
const writer=writerFactory({sheetName:'Мобильные бригады',columns});
const first=Array.from({length:10000},(_,i)=>[
 'MB-'+String(i).padStart(5,'0'),'2025-02-01',i===6999?long:'OK'
]);
const second=Array.from({length:2001},(_,i)=>[
 'MB-'+String(i+10000).padStart(5,'0'),'2025-03-01','OK'
]);
assert.equal(writer.append(first),10000);
assert.equal(writer.append(second),12001);
const result=writer.finish();
assert.equal(result.rows,12001);
assert.equal(result.columns,3);
assert.equal(result.longTextCells,1);
assert(result.overflowParts>0);
const workbook=XLSX.read(new Uint8Array(result.bytes),{type:'array',dense:true});
assert.deepEqual(workbook.SheetNames,['Мобильные бригады','Продолжения текстов']);
const rows=XLSX.utils.sheet_to_json(workbook.Sheets['Мобильные бригады'],
  {header:1,raw:true});
assert.equal(rows.length,12002);
assert.deepEqual(rows[0],columns);
assert.equal(rows[1][0],'MB-00000');
assert.equal(rows[10001][0],'MB-10000');
assert.equal(rows[12001][0],'MB-12000');
const extra=XLSX.utils.sheet_to_json(workbook.Sheets['Продолжения текстов'],
  {header:1,raw:true}).slice(1)
  .filter(row=>row[0]===7001&&row[1]===3)
  .sort((a,b)=>a[3]-b[3]);
assert.equal(rows[7000][2]+extra.map(row=>row[4]).join(''),long);
assert.throws(()=>writer.append([['NEW','2025-03-01','OK']]),/завершён/);
console.log('Single XLSX from 12,001 rows in two SQLite batches: PASS');
