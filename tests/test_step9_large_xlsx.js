// Step 9: large XLSX is recognized, normalized and returned as Dataset
// without generating an unnecessary output workbook during SQLite import.
const assert = require('assert');
const XLSX = require('../vendor/xlsx.full.min.js');
globalThis.XLSX = XLSX;
require('../src/js/app/dataset_catalog.js');
require('../src/js/app/field_registry.js');
require('../src/js/modules/itsm/mb_presence.js');
require('../src/js/modules/itsm/dataset_schema.js');
require('../src/js/kpi/source_facts.js');
require('../src/js/modules/itsm/kpi_source.js');
require('../src/js/modules/itsm/rules.js');
require('../src/js/workers/itsm_processor.js');

const headers = [
  'Дата создания Вызова', 'Дата выполнения обращения', 'Дата закрытия',
  'Номер', 'Территории MES', 'Наименование оборудования', 'Элемент',
  'Неисправность', 'Причина инцидента',
  'Категорированная информация обращения.Краткое описание',
  'Категорированная информация обращения.Описание',
  'Примечания к разрешению', 'Открыл',
  'Измерение цели обслуживания.Прошло (рабочее время)', 'Код закрытия'
];
const total = process.argv.includes('--stress') ? 50000 : 10000;
const data = [headers];
for (let n = 0; n < total; n++) {
  data.push([
    '2026-09-20', '2026-09-21', '2026-09-21',
    'INC-' + (n + 1), 'Северный', 'БКМ', 'АКБ', 'Разряд', 'Износ',
    'Техническое обслуживание', 'Испытательная заявка ' + n,
    'Выполнено', 'Тестовый инженер', 7200, 'Выполнено полностью'
  ]);
}
const book = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(data), 'Обращение');
const input = XLSX.write(book, { bookType: 'xlsx', type: 'array', compression: true });
const bytes = input instanceof ArrayBuffer
  ? input : input.buffer.slice(input.byteOffset, input.byteOffset + input.byteLength);
const originalWrite = XLSX.write;
let unexpectedWrites = 0;
XLSX.write = (...args) => { unexpectedWrites++; return originalWrite(...args); };
const started = Date.now();
globalThis.ReclassifierItsmWorkerProcessor.process({
  bytes, fileName: 'step9_large_input.xlsx', datasetOnly: true,
  asOfDate: '2026-09-30T00:00:00',
  references: {
    reclassification: [], drivers: [], initiators: [], customers: [],
    type_request: [], exceptions: [], problem_grade: [],
    mobile_brigade_data: [], mobile_brigade_meta: { latestSourceDate: '2026-09-30' }
  }
}).then(result => {
  XLSX.write = originalWrite;
  assert.strictEqual(result.bytes, null);
  assert.strictEqual(result.stats.rows, total);
  assert.strictEqual(result.itsmData.records.length, total);
  assert.strictEqual(result.itsmData.records[0].length, 52);
  assert.strictEqual(result.itsmData.records[total - 1][3], 'INC-' + total);
  assert.strictEqual(unexpectedWrites, 0, 'Dataset-only mode generated an unnecessary XLSX file');
  assert(result.itsmData.records.every(row => row.length === 52));
  assert(result.kpiSource, 'Large ITSM pass did not return KPI Source.');
  assert.strictEqual(result.kpiSource.sourceRows, total);
  assert.strictEqual(result.kpiSource.records.length, 1,
    'Equal month/dimensions must collapse into one KPI Source row.');
  const kpiIndex = Object.fromEntries(
    result.kpiSource.fields.map((field, index) => [field, index])
  );
  assert.strictEqual(result.kpiSource.records[0][kpiIndex.failureCount], total);
  assert.strictEqual(result.kpiSource.records[0][kpiIndex.incCount], total);
  const duration = Date.now() - started;
  console.log('Step9 XLSX: ' + total + ' rows / 52 fields + KPI aggregation; dataset-only output; ' +
    duration + ' ms; RSS ' + Math.round(process.memoryUsage().rss / 1048576) + ' MiB.');
}).catch(error => { console.error(error); process.exitCode = 1; });
