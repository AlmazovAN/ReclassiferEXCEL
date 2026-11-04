'use strict';
// PR3 integration: real SheetJS XLSX writes/reads from large synthetic Full Datasets.
// Never put production row contents or personal data into CI fixtures or logs.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const XLSX = require('../vendor/xlsx.full.min.js');
globalThis.XLSX = XLSX;
require('../src/js/workers/dataset_export_processor.js');
const worker = globalThis.ReclassifierDatasetExportWorkerProcessor;

const sandbox = {
  globalThis: null,
  ReclassifierModuleSourceStatus: { formatDate: value => value || '—' },
  escapeHtml: value => String(value ?? ''),
  state: { processingModuleId: null }
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync('src/js/app/dataset_excel_export.js','utf8'), sandbox);
const exporter = sandbox.ReclassifierDatasetExcelExport;
const total = process.argv.includes('--stress') ? 50000 : 10000;
const start = Date.now();

function verify(datasetId, instance, from, to, sheetName, expectedRows, expectedColumnCount) {
  const bounds = exporter.period(datasetId, instance);
  assert(bounds.from && bounds.to, 'Calendar bounds must come from actual records');
  const selection = exporter.selectRows(datasetId, instance, from, to);
  assert.equal(selection.rows.length, expectedRows);
  assert.equal(selection.columns.length, expectedColumnCount);
  const progresses = [];
  const generated = worker.process({
    columns: selection.columns,
    rows: selection.rows,
    sheetName
  }, progress => progresses.push(progress.percent));
  assert(generated.bytes instanceof ArrayBuffer);
  assert(generated.bytes.byteLength > 10000, 'Real XLSX must be more than a stub buffer');
  assert.equal(generated.rows, expectedRows);
  assert.equal(generated.columns, expectedColumnCount);
  assert(progresses.some(p => p > 5 && p < 55), 'Large export must report incremental progress');
  assert.equal(progresses.at(-1), 100);
  const book = XLSX.read(generated.bytes, { type: 'array', cellDates: true });
  assert.deepEqual(book.SheetNames, [sheetName]);
  const worksheet = book.Sheets[sheetName];
  const decoded = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: null, raw: true });
  assert.equal(decoded.length, expectedRows + 1, 'XLSX row count differs after roundtrip');
  assert.deepEqual(decoded[0], selection.columns, 'Source column order/labels changed');
  const keyIndex = 1;
  for (const index of [0, Math.floor(expectedRows / 2), expectedRows - 1]) {
    assert.equal(decoded[index + 1][keyIndex], selection.rows[index][keyIndex],
      'Record identity moved or changed in the XLSX output');
    assert.equal(decoded[index + 1][expectedColumnCount - 1],
      selection.rows[index][expectedColumnCount - 1],
      'Last calculated field did not survive XLSX roundtrip');
  }
  return generated.bytes.byteLength;
}

// Keep the 52-field ITSM layout and an extra long source text cell.
const itsmColumns = Array.from({ length: 52 }, (_, i) => (
  i === 0 ? 'Дата создания Вызова' : i === 1 ? 'Номер' : i === 51 ? 'Наличие заявки в МБ' : 'ITSM_' + i
));
const itsm = {
  records: [],
  fullDataset: { columns: itsmColumns, rows: [], coverage: 'complete' },
  meta: { fullDatasetScope: 'complete' }
};
const left = Math.floor(total / 4), middle = Math.floor(total / 4);
for (let i = 0; i < total; i++) {
  const date = i < left ? '2025-01-01' : (i < left + middle ? '2026-09-01' : '2026-10-13');
  itsm.records.push([date + 'T16:20:00', 'INC-' + String(i).padStart(7, '0')]);
  itsm.fullDataset.rows.push(itsmColumns.map((_, col) =>
    col === 0 ? date : col === 1 ? 'INC-' + String(i).padStart(7, '0') :
    col === 51 ? (i % 2 ? 'Нет' : 'Да') :
    col === 11 ? 'Синтетическое описание; строка ' + i :
    col === 24 ? i / 4 : 'VAL_' + col + '_' + (i % 100)
  ));
}
assert.equal(itsm.records.length, total);
assert.equal(exporter.period('itsm_data', itsm).from, '2025-01-01');
assert.equal(exporter.period('itsm_data', itsm).to, '2026-10-13');
const expectedItsm = total - left - middle;
const itsmBytes = verify('itsm_data', itsm, '2026-10-13', '2026-10-13',
  'ITSM', expectedItsm, 52);

// 38-column MB layout: a UTC ISO timestamp emitted by JSON.stringify(Date)
// must recover the same local calendar day used by the original Excel export.
const mbColumns = Array.from({ length: 38 }, (_, i) => (
  i === 0 ? 'Фактическая дата' : i === 1 ? 'Номер задачи' :
  i === 37 ? 'Итог Новый тип задач' : 'МБ_' + i
));
const mb = {
  records: [],
  fullDataset: { columns: mbColumns, rows: [], coverage: 'complete' },
  meta: { fullDatasetScope: 'complete' }
};
for (let i = 0; i < total; i++) {
  const september = i < Math.floor(total / 3);
  const local = september
    ? new Date(2026, 8, 1, 0, 15, 0)
    : new Date(2026, 9, 13, 0, 15, 0);
  mb.records.push({
    recordKey: 'TASK-' + String(i).padStart(7, '0'),
    factDate: i % 2 ? JSON.parse(JSON.stringify({ date: local })).date : local
  });
  const date = september ? '2026-09-01' : '2026-10-13';
  mb.fullDataset.rows.push(mbColumns.map((_, col) =>
    col === 0 ? date : col === 1 ? 'TASK-' + String(i).padStart(7, '0') :
    col === 37 ? 'АВР' : col === 30 ? (i + 1) / 10 : 'MB_' + col + '_' + (i % 100)
  ));
}
const expectedMb = total - Math.floor(total / 3);
const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
assert.equal(exporter.recordDate('mobile_brigade_data', {
  factDate: JSON.parse(JSON.stringify({ x: new Date(2026, 8, 1, 0, 15) })).x
}), '2026-09-01', 'SQLite JSON date serialization altered the local MB calendar date');
assert.equal(exporter.period('mobile_brigade_data', mb).from, '2026-09-01');
assert.equal(exporter.period('mobile_brigade_data', mb).to, '2026-10-13');
const mbBytes = verify('mobile_brigade_data', mb, '2026-10-13', '2026-10-13',
  'Мобильные бригады', expectedMb, 38);
assert.equal(itsm.records.length, total);
assert.equal(mb.records.length, total);
assert.equal(itsm.fullDataset.rows.length, total);
assert.equal(mb.fullDataset.rows.length, total);
console.log('PR3 real large XLSX: ' + total + ' synthetic rows per Dataset; ' +
  'ITSM=' + expectedItsm + ' / 52 fields, MB=' + expectedMb + ' / 38 fields; ' +
  'XLSX sizes=' + itsmBytes + '/' + mbBytes + ' bytes; timezone=' + tz +
  '; elapsed=' + (Date.now() - start) + ' ms; RSS=' +
  Math.round(process.memoryUsage().rss / 1048576) + ' MiB.');
