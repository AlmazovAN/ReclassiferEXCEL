const assert = require('node:assert/strict');
const XLSX = require('../vendor/xlsx.full.min.js');
globalThis.XLSX = XLSX;
require('../src/js/modules/mobile_brigade/rules.js');
require('../src/js/workers/mobile_brigade_processor.js');
const upsert = require('../src/js/modules/mobile_brigade/upsert.js');

function makeBuffer(rows) {
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([
    ['Участок','Номер задачи','Тип задачи','Фактическая дата','Фактические трудозатраты','Описание'],
    ...rows
  ]), 'Любой лист');
  const written = XLSX.write(book, { bookType:'xlsx', type:'array' });
  return written instanceof ArrayBuffer ? written :
    written.buffer.slice(written.byteOffset, written.byteOffset + written.byteLength);
}

(async () => {
  const rows = [
    ['Рудник 1', '123', 'АВР', null, null, 'первое'],
    ['Рудник 1', '123', 'АВР', null, null, 'второе'],
    ['Рудник 1', '123-D1', 'АВР', null, null, 'реальная задача с суффиксом'],
    ['Рудник 1', '123', 'АВР', null, null, 'третье'],
    ['Рудник 2', '123', 'АВР', null, null, 'другой участок']
  ];
  const file = {fileName:'tasks_2025-01-01_2026-01-01.xlsx', bytes:makeBuffer(rows)};
  const process = globalThis.ReclassifierMobileBrigadeWorkerProcessor.process;
  const first = await process({ files:[file], itsmData:[] });
  const data = first.mobileBrigadeData.records;
  assert.equal(first.stats.duplicateRecordKeys, 2);
  assert.equal(first.stats.rows, 5);
  assert.deepEqual(data.map(x => x.taskNumber), ['123','123-D2','123-D1','123-D3','123']);
  assert.equal(new Set(data.map(x => x.recordKey)).size, 5);
  assert(first.stats.warnings.some(w => w.includes('повторяющихся recordKey: 2')));
  assert.deepEqual(first.mobileBrigadeFullDataset.rows.map(x =>
    x[first.outputColumns.indexOf('Номер задачи')]), data.map(x => x.taskNumber));
  assert.equal(data[0].factDate, null);
  const merge1 = upsert.prepare([], data);
  const second = await process({ files:[file], itsmData:[] });
  const merge2 = upsert.prepare(merge1.records, second.mobileBrigadeData.records);
  assert.equal(merge2.plan.finalRows, 5);
  assert.equal(merge2.plan.addedKeys, 0);
  assert.equal(merge2.plan.unchangedKeys, 5);
  console.log('Mobile Brigade duplicate recordKey: preserve first, suffix repeats, collision safety, UPSERT OK');
})().catch(error => { console.error(error); process.exitCode=1; });
