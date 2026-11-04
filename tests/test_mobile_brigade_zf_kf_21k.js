'use strict';
const assert = require('node:assert/strict');
const XLSX = require('../vendor/xlsx.full.min.js');
globalThis.XLSX = XLSX;
require('../src/js/modules/mobile_brigade/rules.js');
require('../src/js/workers/mobile_brigade_processor.js');

const ZF_COUNT = 19436;
const KF_COUNT = 1667;
const EXPECTED = ZF_COUNT + KF_COUNT;

function bytesOf(workbook) {
  const bytes = XLSX.write(workbook, { bookType: 'xlsx', type: 'array', compression: true });
  return bytes instanceof ArrayBuffer
    ? bytes : bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}
function buildBook(reverse = false) {
  const zfHeaders = ['Участок', 'Номер задачи', 'Тип задачи', 'Фактическая дата',
    'Фактические трудозатраты', 'Описание', 'Дополнительное поле ЗФ'];
  const kfHeaders = ['Описание', 'Фактические трудозатраты', 'Тип задачи',
    'Участок', 'Фактическая дата', 'Номер задачи', 'Дополнительное поле КФ'];
  while (zfHeaders.length < 63) zfHeaders.push('Доп. ЗФ ' + zfHeaders.length);
  while (kfHeaders.length < 52) kfHeaders.push('Доп. КФ ' + kfHeaders.length);
  assert.equal(zfHeaders.length, 63);
  assert.equal(kfHeaders.length, 52);
  const zf = [zfHeaders];
  const kf = [kfHeaders];
  for (let i = 0; i < ZF_COUNT; i++) {
    zf.push(['ЗФ', 'ZF-' + (i + 1), 'АВР', '2026-10-19', '1ч. 0мин.',
      'Тестовая задача ЗФ ' + (i + 1), '']);
  }
  for (let i = 0; i < KF_COUNT; i++) {
    kf.push(['Тестовая задача КФ ' + (i + 1), '2ч. 0мин.', 'АВР',
      'КФ', '', 'KF-' + (i + 1), '']);
  }
  const book = XLSX.utils.book_new();
  const list = [['ПСПА ЗФ', zf], ['ПСПА КФ', kf]];
  if (reverse) list.reverse();
  for (const [name, rows] of list) {
    XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(rows), name);
  }
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([
    ['Информация о выгрузке'], ['Служебный лист: не импортировать']
  ]), 'Справка');
  return bytesOf(book);
}
async function verify(reverse) {
  const input = buildBook(reverse);
  const result = await globalThis.ReclassifierMobileBrigadeWorkerProcessor.process({
    files: [{ fileName: 'tasks_2026-09-01_2026-10-20.xlsx', bytes: input }],
    itsmData: []
  });
  assert.equal(result.stats.files, 1);
  assert.equal(result.stats.sheets, 2);
  assert.equal(result.stats.rows, EXPECTED);
  assert.equal(result.mobileBrigadeData.records.length, EXPECTED);
  assert.equal(result.mobileBrigadeFullDataset.rows.length, EXPECTED);
  const bySheet = new Map(result.stats.sheetDetails.map(x => [x.sheetName, x]));
  assert.equal(bySheet.size, 2);
  for (const [name, count] of [['ПСПА ЗФ', ZF_COUNT], ['ПСПА КФ', KF_COUNT]]) {
    const item = bySheet.get(name);
    assert(item, 'Sheet missing: ' + name);
    assert.equal(item.inputRows, count);
    assert.equal(item.acceptedRows, count);
    assert.equal(item.skippedRows, 0);
  }
  assert(result.stats.warnings.some(w => w.includes('Справка') && w.includes('пропущен')));
  const records = result.mobileBrigadeData.records;
  assert.equal(records.filter(x => x.site === 'ЗФ').length, ZF_COUNT);
  assert.equal(records.filter(x => x.site === 'КФ').length, KF_COUNT);
  assert.equal(new Set(records.map(x => x.recordKey)).size, EXPECTED);
  assert(records.some(x => x.site === 'КФ' && x.taskNumber === 'KF-1667' && x.factDate === null));
  assert(records.some(x => x.site === 'ЗФ' && x.taskNumber === 'ZF-19436'));
  const output = XLSX.read(new Uint8Array(result.bytes), { type: 'array' });
  const exported = XLSX.utils.sheet_to_json(output.Sheets['Мобильные бригады'], { header: 1 });
  assert.equal(exported.length - 1, EXPECTED);
  console.log('PASS: order=' + (reverse ? 'KF/ZF' : 'ZF/KF') + ', sheets=2, rows=' + EXPECTED);
}
(async () => {
  await verify(false);
  await verify(true);
  console.log('PASS: multifile-like two-sheet regression, counts, mapping, dataset and export');
})().catch(e => { console.error(e); process.exitCode = 1; });
