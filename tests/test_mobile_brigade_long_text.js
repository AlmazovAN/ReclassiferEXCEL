const assert = require('node:assert/strict');
const XLSX = require('../vendor/xlsx.full.min.js');
globalThis.XLSX = XLSX;
require('../src/js/modules/mobile_brigade/rules.js');
require('../src/js/workers/mobile_brigade_processor.js');

(async () => {
  const longText = 'Т'.repeat(34000);
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([
    ['Участок','Номер задачи','Тип задачи','Фактическая дата','Фактические трудозатраты','Описание'],
    ['Рудник 1','TASK-1','АВР',null,null,'short placeholder']
  ]), 'Tasks');
  const bytes = XLSX.write(book, {bookType:'xlsx',type:'array'});
  const source = bytes instanceof ArrayBuffer ? bytes :
    bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength);
  // A real XLSX writer cannot create an invalid 34000-character input cell.
  // Simulate a parsed source workbook containing the overlong field instead.
  const originalRead = XLSX.read;
  XLSX.read = function (...args) {
    const parsed = originalRead.apply(this, args);
    const sheet = parsed.Sheets.Tasks;
    const address = 'F2';
    assert(sheet[address], 'Missing source description cell');
    sheet[address].v = longText;
    return parsed;
  };
  let result;
  try {
    result = await globalThis.ReclassifierMobileBrigadeWorkerProcessor.process({
      files:[{fileName:'tasks_2026-01-01_2026-10-20.xlsx',bytes:source}],itsmData:[]
    });
  } finally {
    XLSX.read = originalRead;
  }
  assert.equal(result.stats.truncatedExcelCells,1);
  assert(result.stats.warnings.some(s => s.includes('32767')));
  assert.equal(result.mobileBrigadeData.records[0].description.length,34000);
  const description = result.outputColumns.indexOf('Описание');
  assert.equal(result.mobileBrigadeFullDataset.rows[0][description].length,34000);
  const exported = XLSX.read(new Uint8Array(result.bytes),{type:'array'});
  const rows = XLSX.utils.sheet_to_json(exported.Sheets[exported.SheetNames[0]],{header:1});
  assert.equal(rows[1][description].length,32767);
  console.log('Mobile Brigade long text XLSX export truncated only; Dataset preserved OK');
})().catch(e=>{console.error(e);process.exitCode=1});
