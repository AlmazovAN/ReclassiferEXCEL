'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const scripts = {
  app: fs.readFileSync('src/js/app/dataset_excel_export.js', 'utf8'),
  writer: fs.readFileSync('src/js/workers/dataset_export_processor.js', 'utf8'),
  router: fs.readFileSync('src/js/worker.js', 'utf8')
};
let active, calls = [], downloads = [], progress = [], alerts = [];
const controls = new Map();
const root = {
  state: { route: 'itsm', processingModuleId: null },
  datasetStore: { get: () => active },
  ReclassifierRuntimeDataRepository: { mode: () => 'sqlite' },
  ReclassifierModuleSourceStatus: {
    formatDate: value => value ? value.slice(8, 10) + '.' + value.slice(5, 7) + '.' + value.slice(0, 4) : '—'
  },
  escapeHtml: value => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;'),
  Blob, Date, ArrayBuffer,
  document: {
    createElement: () => ({ style: {}, click() { downloads.push(this.download); }, remove() {} }),
    body: { appendChild() {} },
    getElementById: id => controls.get(id)
  },
  URL: { createObjectURL: () => 'blob:dataset-export-test', revokeObjectURL() {} },
  setTimeout: fn => fn(),
  alert: message => alerts.push(message),
  log() {},
  workerRequest: async (type, payload, transfer, onProgress) => {
    calls.push({ type, payload });
    onProgress?.({ percent: 55, label: 'Запись Excel' });
    return { bytes: new ArrayBuffer(16) };
  },
  globalThis: null
};
root.globalThis = root;
const app = vm.createContext(root);
vm.runInContext(scripts.app, app, { filename: 'dataset_excel_export.js' });
const excel = root.ReclassifierDatasetExcelExport;
assert.ok(excel);
assert.equal(excel.dateKey('2026-10-13T23:59:00'), '2026-10-13');
assert.equal(excel.dateKey('13.10.2026 12:00'), '2026-10-13');
assert.equal(excel.dateKey('2026-02-30'), null);
assert.equal(excel.dateKey('2026-10-00'), null);
assert.equal(excel.dateKey('13/10/2026'), '2026-10-13');
assert.equal(excel.dateKey('2026-10-13Z'), null);

const fields = ['Дата создания Вызова', 'Номер', 'Исходный', 'Расчётный'];
const itsmRecords = [
  ['2025-01-01T00:00:00', 'INC001'],
  ['2025-08-12T11:00:00', 'INC002'],
  ['2026-10-13T23:59:00', 'INC003'],
  [null, 'INC004']
];
const itsmFullRows = [
  ['2025-01-01', 'INC001', 'alpha', 2],
  ['2025-08-12', 'INC002', 'beta', 5],
  ['2026-10-13', 'INC003', 'gamma', 8],
  ['', 'INC004', 'delta', 1]
];
const itsm = {
  records: itsmRecords, fullDataset: { columns: fields, rows: itsmFullRows, coverage: 'complete' },
  meta: { fullDatasetScope: 'complete' }
};
active = itsm;
assert.deepEqual(JSON.parse(JSON.stringify(excel.period('itsm_data', itsm))),
  { from: '2025-01-01', to: '2026-10-13', dated: 3, undated: 1 });
assert.match(excel.markup('itsm_data', itsm), /Экспорт по/);
assert.match(excel.markup('itsm_data', itsm), /Дата создания Вызова/);
assert.match(excel.markup('itsm_data', itsm), /4 колонок/);
assert.match(excel.markup('itsm_data', itsm), /01\.01\.2025/);
assert.match(excel.markup('itsm_data', itsm), /13\.10\.2026/);
assert.match(excel.markup('itsm_data', itsm), /type="date"/);
assert.match(excel.markup('itsm_data', itsm), /Скачать обработанный файл/);

const boundary = excel.selectRows('itsm_data', itsm, '2026-10-13', '2026-10-13');
assert.equal(boundary.rows.length, 1);
assert.strictEqual(boundary.rows[0], itsmFullRows[2]);
assert.deepEqual(Array.from(boundary.columns), fields);
assert.throws(() => excel.selectRows('itsm_data', itsm, '2026-10-14', '2026-10-14'), /за границы/);
assert.throws(() => excel.selectRows('itsm_data', itsm, '2026-01-01', '2025-01-01'), /позднее/);
assert.throws(() => excel.selectRows('itsm_data', itsm, '2025-05-01', '2025-05-02'), /отсутствуют записи/);

const legacyWithoutCoverage = {
  ...itsm, fullDataset: { columns: fields, rows: itsmFullRows }
};
assert.equal(excel.fullDatasetReady(legacyWithoutCoverage), true);
const partial = {
  records: itsmRecords, fullDataset: { columns: fields, rows: itsmFullRows.slice(0, 2), coverage: 'partial' }
};
assert.equal(excel.fullDatasetReady(partial), false);
assert.match(excel.markup('itsm_data', partial), /аналитические поля Active Runtime/);
assert.equal(excel.fullDatasetReady(partial), false);
// An incomplete Full Dataset must never be silently exported as if complete.
// Fall back to the existing analytics records, clearly labeled.
assert.equal(excel.selectRows('itsm_data', partial, '2025-01-01', '2026-10-13').mode, 'analytical');
assert.equal(excel.selectRows('itsm_data', partial, '2025-01-01', '2026-10-13').rows.length, 3);

const mb = {
  records: [
    { factDate: '2026-08-31T20:00:00Z', recordKey: '1' },
    { factDate: '2026-09-01T00:00:00Z', recordKey: '2' },
    { factDate: '2026-10-13T08:00:00Z', recordKey: '3' },
    { factDate: null, recordKey: '4' }
  ],
  fullDataset: {
    columns: ['Фактическая дата', 'Номер задачи', 'Расчётная колонка'],
    rows: [
      ['2026-08-31', 'TASK1', 1],
      ['2026-09-01', 'TASK2', 2],
      ['2026-10-13', 'TASK3', 3],
      ['', 'TASK4', 4]
    ],
    coverage: 'complete'
  }
};
assert.equal(excel.period('mobile_brigade_data', mb).from, '2026-08-31');
assert.equal(excel.period('mobile_brigade_data', mb).undated, 1);
assert.equal(excel.selectRows('mobile_brigade_data', mb, '2026-09-01', '2026-10-13').rows.length, 2);
assert.match(excel.markup('mobile_brigade_data', mb), /Скачать обработанный файл/);
assert.match(excel.markup('mobile_brigade_data', mb), /Фактическая дата/);
const mbAnalytical = { records: mb.records, meta: { sourceType: 'sqlite' } };
const simplified = excel.selectRows('mobile_brigade_data', mbAnalytical, '2026-09-01', '2026-10-13');
assert.equal(simplified.mode, 'analytical');
assert.equal(simplified.rows.length, 2);
assert.deepEqual(Array.from(simplified.columns), ['Фактическая дата', 'Ключ записи']);
assert.equal(simplified.rows[0][1], '2');
assert.match(excel.markup('mobile_brigade_data', mbAnalytical), /аналитические поля Active Runtime/);
const itsmAnalytics = {
  records: itsmRecords,
  meta: { sourceType: 'embedded', columns: ['Дата создания Вызова', 'Номер'] }
};
const itRows = excel.selectRows('itsm_data', itsmAnalytics, '2026-10-13', '2026-10-13');
assert.equal(itRows.mode, 'analytical');
assert.equal(itRows.rows[0][1], 'INC003');
assert.deepEqual(Array.from(itRows.columns), ['Дата создания Вызова', 'Номер']);


(async () => {
  active = itsm;
  let completed = await excel.exportPeriod('itsm_data', itsm, '2025-01-01', '2026-10-13',
    p => progress.push(p));
  assert.equal(completed.rows, 3);
  assert.equal(completed.outputName, 'ITSM_2025-01-01_2026-10-13.xlsx');
  assert.equal(calls[0].type, 'EXPORT_DATASET_XLSX');
  assert.equal(calls[0].payload.rows.length, 3);
  assert.equal(calls[0].payload.columns.length, 4);
  assert.equal(root.state.processingModuleId, null);
  assert.equal(downloads.at(-1), completed.outputName);
  assert.equal(itsm.records.length, 4, 'Read-only export must not alter analytics records.');
  assert.equal(itsm.fullDataset.rows.length, 4, 'Read-only export must not alter Full Dataset.');

  active = mb;
  completed = await excel.exportPeriod('mobile_brigade_data', mb, '2026-09-01', '2026-10-13');
  assert.equal(completed.outputName, 'Mobile_Brigade_2026-09-01_2026-10-13.xlsx');
  assert.equal(calls[1].payload.rows.length, 2);
  assert.equal(calls[1].payload.columns.length, 3);

  // Isolated writer: it must preserve the selected header order and cells.
  let captured;
  const sheetJS = {
    utils: {
      aoa_to_sheet: (data, options) => {
        captured = { data, options };
        return {};
      },
      encode_cell: ({ r, c }) => 'C' + (r + 1),
      book_new: () => ({}),
      book_append_sheet: (workbook, sheet, title) => { workbook.sheet = sheet; workbook.title = title; }
    },
    write: () => new Uint8Array([80, 75, 3, 4])
  };
  const workerContext = vm.createContext({ globalThis: null, XLSX: sheetJS });
  workerContext.globalThis = workerContext;
  vm.runInContext(scripts.writer, workerContext);
  const worker = workerContext.ReclassifierDatasetExportWorkerProcessor;
  const buffer = worker.process({
    sheetName: 'ITSM', columns: fields, rows: boundary.rows
  }, p => progress.push(p));
  assert.equal(buffer.rows, 1);
  assert.equal(buffer.columns, 4);
  assert.equal(buffer.bytes.byteLength, 4);
  assert.deepEqual(Array.from(captured.data[0]), fields);
  assert.equal(Object.prototype.toString.call(captured.data[1][0]), '[object Date]');
  assert.deepEqual(Array.from(captured.data[1]).slice(1), itsmFullRows[2].slice(1));
  assert.throws(() => worker.process({
    sheetName: 'ITSM', columns: fields, rows: [['wrong']]
  }), /некорректную строку/);

  for (const path of [
    'src/js/modules/itsm/ui.js',
    'src/js/modules/mobile_brigade/ui.js'
  ]) {
    const source = fs.readFileSync(path, 'utf8');
    assert.match(source, /ReclassifierDatasetExcelExport/);
    assert.match(source, /render(\\.|\w)*Module/);
  }
  const router = scripts.router;
  assert.match(router, /EXPORT_DATASET_XLSX/);
  assert.match(router, /DATASET_XLSX_RESULT/);
  const build = fs.readFileSync('build/build.py', 'utf8');
  assert.match(build, /app\/dataset_excel_export\.js/);
  assert.match(build, /workers.*dataset_export_processor\.js/);
  console.log('Dataset period export PR2: dates, boundaries, Full Dataset, worker, read-only: OK');
})().catch(error => { console.error(error); process.exitCode = 1; });
