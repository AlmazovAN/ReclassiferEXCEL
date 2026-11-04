'use strict';
const assert = require('node:assert/strict');
const XLSX = require('../vendor/xlsx.full.min.js');
globalThis.XLSX = XLSX;
require('../src/js/workers/dataset_export_processor.js');
const writer = globalThis.ReclassifierDatasetExportWorkerProcessor;

const input = {
  sheetName: 'ITSM',
  columns: [
    'Дата создания Вызова','Номер','Код с ведущими нулями',
    'Трудоёмкость','Дата закрытия','Произвольный текст'
  ],
  rows: [
    ['2026-10-13T12:30:00','INC-001','000013',3.5,'2026-10-14T15:45:00','Синтетическая запись'],
    ['2026-10-14','INC-002','000014',0,'14.10.2026 16:30','Другой текст'],
    [46000,'INC-003','000015',8,46001,'Числовая дата Excel']
  ]
};
const generated = writer.process(input);
const workbook = XLSX.read(generated.bytes, { type: 'array', cellDates: true });
const sheet = workbook.Sheets.ITSM;
assert.equal(sheet.A2.t, 'd', 'Created-at must be a true Excel date cell');
assert.equal(sheet.E2.t, 'd', 'Closed-at must be a true Excel date cell');
assert.equal(sheet.D2.t, 'n', 'Numeric labor values must remain numeric');
assert.equal(sheet.D2.v, 3.5);
assert.equal(sheet.C2.t, 's', 'Identifiers with leading zeros must remain text');
assert.equal(sheet.C2.v, '000013');
assert.equal(sheet.A4.t, 'd', 'Excel numeric date serial must be typed as a date');
assert.equal(sheet.E4.t, 'd', 'Second numeric date serial must be typed as a date');
assert.equal(sheet.D4.t, 'n');
assert.equal(sheet.B3.v, 'INC-002');
assert.equal(input.rows[0][0], '2026-10-13T12:30:00', 'Writer must not mutate source rows');
assert.equal(writer.asExcelDate('2026-02-30'), '2026-02-30',
  'Invalid dates must not be converted');

const mobile = writer.process({
  sheetName:'Мобильные бригады',
  columns:['Фактическая дата','Номер задачи','Трудозатраты, ч'],
  rows:[['2026-10-13T08:00:00','TASK-01',12.25]]
});
const mobileSheet = XLSX.read(mobile.bytes,{type:'array',cellDates:true}).Sheets['Мобильные бригады'];
assert.equal(mobileSheet.A2.t, 'd');
assert.equal(mobileSheet.C2.t, 'n');
assert.equal(mobileSheet.C2.v, 12.25);

// Synthetic compression experiment. Both modes must yield valid cells.
// No size guarantees for user workbooks: the result depends on repetitions.
const columns = Array.from({ length: 30 },(_,i)=>i===0?'Номер':'Поле '+i);
const rows = [];
for (let i=0;i<1500;i++) rows.push(columns.map((_,j) =>
  j===0 ? 'INC-'+i : j%4===0 ? 'Повторяемая классификация' :
  j%5===0 ? 'Описание синтетической заявки '+i : 'Группа '+(i%15)
));
const sourceSheet = XLSX.utils.aoa_to_sheet([columns,...rows]);
const book = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(book,sourceSheet,'Сравнение');
const measure = bookSST => XLSX.write(book,{
  bookType:'xlsx',type:'array',compression:true,bookSST
}).byteLength;
const shared = measure(true), inline = measure(false);
assert(shared>1000 && inline>1000);
console.log('XLSX types: dates=d, numbers=n, IDs=s; ' +
  'synthetic 1500x30 workbook SST=true '+shared+' bytes, SST=false '+inline+
  ' bytes (ratio='+Number(inline/shared).toFixed(3)+').');
