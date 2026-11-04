const assert = require('node:assert/strict');
const vendor = require('../vendor/xlsx.full.min.js');
if (vendor?.utils) globalThis.XLSX = vendor;
require('../src/js/modules/mobile_brigade/rules.js');
require('../src/js/workers/mobile_brigade_processor.js');

function workbook(sheets) {
  const book = XLSX.utils.book_new();
  for (const [name, headers, rows] of sheets) {
    XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([headers, ...rows]), name);
  }
  const bytes = XLSX.write(book, { bookType: 'xlsx', type: 'array' });
  return bytes instanceof ArrayBuffer ? bytes :
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

(async () => {
  const base = ['Участок', 'Номер задачи', 'Тип задачи', 'Фактическая дата', 'Фактические трудозатраты', 'Описание'];
  const shuffled = ['Описание', 'Фактические трудозатраты', 'Номер задачи', 'Новая колонка', 'Участок', 'Фактическая дата', 'Тип задачи'];
  const bytes = workbook([
    ['Любое название 1', base, [['Рудник 1', 'TASK-A', 'АВР', '', '', 'Не работает камера']]],
    ['Другое название 2', shuffled, [['Не работает коммутатор', '2ч. 0мин.', 'TASK-B', 'new-value', 'Рудник 2', '2026-10-19', 'АВР']]],
    ['Служебный лист', ['Произвольная информация'], [['не задача']]]
  ]);
  const result = await globalThis.ReclassifierMobileBrigadeWorkerProcessor.process({
    files: [{fileName:'tasks_2026-09-01_2026-10-20.xlsx', bytes}],
    itsmData:[]
  });
  const deferred = await globalThis.ReclassifierMobileBrigadeWorkerProcessor.process({
    files: [{fileName:'tasks_2026-09-01_2026-10-20.xlsx', bytes}],
    itsmData: [], deferExport: true
  });
  assert.equal(deferred.bytes, null, 'Deferred mode must not generate an XLSX');
  assert.equal(deferred.stats.rows, result.stats.rows);
  assert.deepEqual(deferred.mobileBrigadeFullDataset.rows, result.mobileBrigadeFullDataset.rows);
  assert.deepEqual(deferred.mobileBrigadeData.records, result.mobileBrigadeData.records);
  assert.equal(deferred.stats.diagnostics.phases.at(-1).excelGenerated, false);
  assert(!deferred.stats.diagnostics.phases.some(x => x.stage === 'xlsx-write'));
  assert.equal(result.stats.files, 1);
  assert.equal(result.stats.sheets, 2);
  assert.equal(result.stats.rows, 2);
  assert.deepEqual(result.stats.sheetDetails.map(item => [item.sheetName, item.inputRows, item.acceptedRows, item.skippedRows]), [
    ['Любое название 1', 1, 1, 0], ['Другое название 2', 1, 1, 0]
  ]);
  assert(result.stats.warnings.some(x => x.includes('Служебный лист') && x.includes('пропущен')));
  assert.equal(result.mobileBrigadeData.records[0].factDate, null);
  assert.equal(result.mobileBrigadeData.records[1].taskNumber, 'TASK-B');
  assert.equal(result.mobileBrigadeData.records[1].laborHours, 2);
  assert(result.stats.warnings.some(x => x.includes('Новая колонка')));
  assert.equal(result.mobileBrigadeFullDataset.rows.length, 2);
  console.log('Multi-sheet header mapping, unknown columns and unfinished tasks OK');
})().catch(error => {console.error(error); process.exitCode = 1;});
