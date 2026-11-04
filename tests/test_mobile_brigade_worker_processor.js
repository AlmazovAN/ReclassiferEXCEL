const assert = require('assert');

const vendor = require('../vendor/xlsx.full.min.js');
if (vendor?.utils) globalThis.XLSX = vendor;
if (!globalThis.XLSX?.utils) throw new Error('SheetJS vendor did not expose XLSX in Node.');

require('../src/js/app/dataset_catalog.js');
require('../src/js/app/field_registry.js');
require('../src/js/modules/itsm/dataset_schema.js');
require('../src/js/modules/mobile_brigade/rules.js');
require('../src/js/workers/mobile_brigade_processor.js');

// Check that the production processor parses both XLSX source files in
// SheetJS dense mode. This is particularly important for Opera with 70k rows.
const originalRead = XLSX.read;
const observedReads = [];
XLSX.read = function (...args) {
  observedReads.push(args[1] || {});
  return originalRead.apply(this, args);
};

function workbookBuffer(headers, rows, sheetName) {
  const sheet = XLSX.utils.aoa_to_sheet([headers, ...rows]);
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, sheetName);
  const written = XLSX.write(book, { bookType: 'xlsx', type: 'array' });
  return written instanceof ArrayBuffer
    ? written
    : written.buffer.slice(written.byteOffset, written.byteOffset + written.byteLength);
}

const commonHeaders = [
  'Участок', 'Подразделение', 'Заявка', 'Номер задачи', 'Тип задачи', 'Описание', 'Комментарий',
  'Тип оборудования', 'Навесное / Стационарное', 'Единица оборудования', 'Фактическая дата',
  'Фактические трудозатраты', 'Количество человек в бригаде',
  'Комментарий по закрытой задаче', 'Ссылка на заявку', 'Транспорт',
  'Оборудование', 'Элемент', 'Неисправность', 'Причина инцидента'
];
const northHeaders = [
  'Участок', 'Заявка', 'Номер задачи', 'Тип задачи', 'Описание', 'Комментарий',
  'Тип оборудования', 'Навесное / Стационарное', 'Единица оборудования', 'Фактическая дата',
  'Фактические трудозатраты', 'Количество человек в бригаде',
  'Комментарий по закрытой задаче'
];

const first = workbookBuffer(commonHeaders, [[
  'Рудник 1', 'ПСПА', 'REQ-1', 'TASK-1', 'ЗНО', 'Поврежден кабель, восстановить связь', 'Диагностика выполнена',
  'Камера', 'Навесное', 'CAM-1', new Date(2026, 8, 4), '1ч. 30мин.', 2,
  'Кабель заменен, связь восстановлена', 'https://mb.example/REQ-1', 'LHD-01',
  'Камера видеонаблюдения', 'Разъём', 'Нет изображения', 'Повреждение кабеля'
]], 'ПСПА ЗФ');

const second = workbookBuffer(northHeaders, [[
  'Северный', 'REQ-2', 'TASK-2', 'Прочее', 'Доставка оборудования на склад', 'Проверка выполнена',
  'Коммутатор', 'Стационарное', 'SW-1', new Date(2026, 8, 25), '45мин.', 0,
  'Сидоров С.С. (25.09.2026 14:40): Проверка выполнена'
]], 'ПСПА КФ');

(async () => {
  const result = await globalThis.ReclassifierMobileBrigadeWorkerProcessor.process({
    files: [
      { fileName: 'tasks_2026-01-01_2026-09-04 ZF.xlsx', bytes: first },
      { fileName: 'tasks_2026-01-01_2026-09-25 СВ.xlsx', bytes: second }
    ],
    // Real ITSM stores 52 positional fields, not object records.
    // The shared contract must project them before the MB Worker sees them.
    itsmData: globalThis.ReclassifierItsmDatasetSchema.mobileBrigadeLinkRows(
      (() => {
        const schema = globalThis.ReclassifierItsmDatasetSchema;
        const row = Array(schema.fields.length).fill(null);
        const extra = Array(schema.fields.length).fill(null);
        row[schema.fields.indexOf('number')] = ' req-1 ';
        row[schema.fields.indexOf('createdAt')] = '01.09.2026 08:15:00';
        extra[schema.fields.indexOf('number')] = 'REQ-OTHER';
        extra[schema.fields.indexOf('createdAt')] = '02.09.2026 09:30:00';
        return [row, extra];
      })()
    )
  });

  assert(observedReads.length >= 2, 'Both source workbooks must be parsed');
  assert(observedReads.slice(0, 2).every(options => options.dense === true),
    'Large MB input worksheets must use dense-mode SheetJS parsing');
  assert(result.bytes instanceof ArrayBuffer);
  assert.strictEqual(result.outputName, 'Мобильные_бригады_2026-09-25.xlsx');
  assert.strictEqual(result.freshness, '2026-09-25');
  assert.strictEqual(result.freshnessMin, '2026-09-04');
  assert.strictEqual(result.freshnessMax, '2026-09-25');
  assert.strictEqual(result.stats.files, 2);
  assert.strictEqual(result.stats.rows, 2);
  assert.strictEqual(result.stats.rowsWithoutRecordKey, 0);
  assert.strictEqual(result.stats.rowsMatchedItsm, 1);
  assert.strictEqual(result.stats.rowsWithoutItsmMatch, 1);
  assert.strictEqual(result.stats.itsmIndexSize, 2);
  assert.strictEqual(result.stats.scopes, 2);
  assert.deepStrictEqual(result.mobileBrigadeData.freshnessByScope, {
    'Рудник 1': '2026-09-04',
    'Северный': '2026-09-25'
  });
  assert.deepStrictEqual(
    result.mobileBrigadeData.sourceFreshness.map(item => ({
      fileName: item.fileName,
      periodStart: item.periodStart,
      periodEnd: item.periodEnd,
      freshness: item.freshness,
      scopes: item.scopes
    })),
    [
      {
        fileName: 'tasks_2026-01-01_2026-09-04 ZF.xlsx',
        periodStart: '2026-01-01',
        periodEnd: '2026-09-04',
        freshness: '2026-09-04',
        scopes: ['Рудник 1']
      },
      {
        fileName: 'tasks_2026-01-01_2026-09-25 СВ.xlsx',
        periodStart: '2026-01-01',
        periodEnd: '2026-09-25',
        freshness: '2026-09-25',
        scopes: ['Северный']
      }
    ]
  );
  assert.strictEqual(result.outputColumns.length, 38);
  assert(result.mobileBrigadeFullDataset, 'Worker must return full Mobile Brigade Dataset payload');
  assert.strictEqual(result.mobileBrigadeFullDataset.schemaVersion, '1.0.0');
  assert.strictEqual(result.mobileBrigadeFullDataset.package, 'mobile-brigade-full-dataset');
  assert.strictEqual(result.mobileBrigadeFullDataset.aggregation, 'per-task-row');
  assert.strictEqual(result.mobileBrigadeFullDataset.fieldCount, result.outputColumns.length);
  assert.deepStrictEqual(result.mobileBrigadeFullDataset.columns, result.outputColumns);
  assert.strictEqual(result.mobileBrigadeFullDataset.rows.length, result.stats.rows);
  assert.strictEqual(result.mobileBrigadeFullDataset.rows[0].length, result.outputColumns.length);
  assert.strictEqual(
    result.mobileBrigadeFullDataset.rows[0][result.outputColumns.indexOf('Участок')],
    'Рудник 1'
  );
  assert.strictEqual(
    result.mobileBrigadeFullDataset.rows[0][result.outputColumns.indexOf('Итог Новый тип задач')],
    'Корректирующее воздействие'
  );
  assert(result.mobileBrigadeData, 'Worker must return Mobile Brigade Data payload');
  assert.strictEqual(result.mobileBrigadeData.schemaVersion, '1.5.0');
  assert.strictEqual(result.mobileBrigadeData.records.length, 2);
  assert.deepStrictEqual(Object.keys(result.mobileBrigadeData.records[0]), [
    'site', 'taskNumber', 'taskForShiftId', 'recordKey',
    'request', 'requestUrl', 'factDate', 'laborHours', 'astroHours',
    'equipmentPlacement', 'equipmentUnit', 'equipmentType', 'transport',
    'equipment', 'element', 'fault', 'incidentReason',
    'description', 'combinedComment', 'itsmCreatedAt', 'preBacklogAge',
    'finalTaskType', 'laborState'
  ]);
  assert.strictEqual(result.mobileBrigadeData.records[0].site, 'Рудник 1');
  assert.strictEqual(result.mobileBrigadeData.records[0].taskNumber, 'TASK-1');
  assert.strictEqual(result.mobileBrigadeData.records[0].taskForShiftId, '');
  assert.strictEqual(result.mobileBrigadeData.records[0].recordKey, 'рудник 1|task-1');
  assert.strictEqual(result.mobileBrigadeData.records[0].request, 'REQ-1');
  assert.strictEqual(result.mobileBrigadeData.records[0].laborHours, 1.5);
  assert.strictEqual(result.mobileBrigadeData.records[0].astroHours, 0.75);
  assert.strictEqual(result.mobileBrigadeData.records[0].requestUrl, 'https://mb.example/REQ-1');
  assert.strictEqual(result.mobileBrigadeData.records[0].equipmentPlacement, 'Навесное');
  assert.strictEqual(result.mobileBrigadeData.records[0].transport, 'LHD-01');
  assert.strictEqual(result.mobileBrigadeData.records[0].equipment, 'Камера видеонаблюдения');
  assert.strictEqual(result.mobileBrigadeData.records[0].element, 'Разъём');
  assert.strictEqual(result.mobileBrigadeData.records[0].fault, 'Нет изображения');
  assert.strictEqual(result.mobileBrigadeData.records[0].incidentReason, 'Повреждение кабеля');
  assert.strictEqual(result.mobileBrigadeData.records[0].description, 'Поврежден кабель, восстановить связь');
  assert(result.mobileBrigadeData.records[0].itsmCreatedAt instanceof Date);
  assert.strictEqual(result.mobileBrigadeData.records[0].itsmCreatedAt.getFullYear(), 2026);
  assert.strictEqual(result.mobileBrigadeData.records[0].itsmCreatedAt.getMonth(), 8);
  assert.strictEqual(result.mobileBrigadeData.records[0].itsmCreatedAt.getDate(), 1);
  assert.strictEqual(result.mobileBrigadeData.records[0].preBacklogAge, '');
  assert.strictEqual(result.mobileBrigadeData.records[0].finalTaskType, 'Корректирующее воздействие');
  assert.strictEqual(result.mobileBrigadeData.records[0].laborState, 'valid');
  assert.strictEqual(
    result.mobileBrigadeData.records[0].combinedComment,
    'Комментарий:\nДиагностика выполнена\n\nКомментарий по закрытой задаче:\nКабель заменен, связь восстановлена'
  );
  assert.strictEqual(result.mobileBrigadeData.records[1].site, 'Северный');
  assert.strictEqual(result.mobileBrigadeData.records[1].taskNumber, 'TASK-2');
  assert.strictEqual(result.mobileBrigadeData.records[1].recordKey, 'северный|task-2');
  assert.strictEqual(result.mobileBrigadeData.records[1].request, 'REQ-2');
  assert.strictEqual(result.mobileBrigadeData.records[1].equipmentPlacement, 'Стационарное');
  assert.strictEqual(result.mobileBrigadeData.records[1].astroHours, null);
  assert.strictEqual(result.mobileBrigadeData.records[1].itsmCreatedAt, null);
  assert.strictEqual(result.mobileBrigadeData.records[1].laborHours, 0.75);
  assert.strictEqual(result.mobileBrigadeData.records[1].finalTaskType, 'Прочее');
  assert.strictEqual(result.mobileBrigadeData.records[1].laborState, 'valid');
  assert.strictEqual(
    result.mobileBrigadeData.records[1].combinedComment,
    'Сидоров С.С. (25.09.2026 14:40): Проверка выполнена'
  );

  const outputBook = XLSX.read(new Uint8Array(result.bytes), { type: 'array', cellDates: true });
  const sheet = outputBook.Sheets['Мобильные бригады'];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: null });

  assert.deepStrictEqual(rows[0], result.outputColumns);
  const index = name => result.outputColumns.indexOf(name);
  assert.strictEqual(index('Комментарий'), -1);
  assert.strictEqual(index('Комментарий по закрытой задаче'), -1);
  assert.notStrictEqual(index('Объединённый комментарий'), -1);
  assert.strictEqual(
    rows[1][index('Объединённый комментарий')],
    'Комментарий:\nДиагностика выполнена\n\nКомментарий по закрытой задаче:\nКабель заменен, связь восстановлена'
  );
  assert.strictEqual(rows[1][index('ФактТрудочас, чел-час')], 1.5);
  assert.strictEqual(rows[1][index('ФактАстрочас, час')], 0.75);
  assert.strictEqual(rows[1][index('Ненулевые Труды')], 'Да');
  assert.strictEqual(rows[1][index('Итог Новый тип задач')], 'Корректирующее воздействие');
  assert.strictEqual(rows[1][index('МесСмены')], 'Сентябрь');
  assert.strictEqual(rows[1][index('ГодСмены')], 2026);
  assert.notStrictEqual(index('Дата создания вызова ITSM'), -1);
  assert.notStrictEqual(index('Возраст пред-бэклога'), -1);
  assert(rows[1][index('Дата создания вызова ITSM')] instanceof Date);
  assert.strictEqual(rows[1][index('Дата создания вызова ITSM')].getFullYear(), 2026);
  assert.strictEqual(rows[1][index('Возраст пред-бэклога')], '');

  assert.strictEqual(rows[2][index('Подразделение')], '');
  assert.strictEqual(
    rows[2][index('Объединённый комментарий')],
    'Сидоров С.С. (25.09.2026 14:40): Проверка выполнена'
  );
  assert.strictEqual(rows[2][index('ФактТрудочас, чел-час')], 0.75);
  assert.strictEqual(rows[2][index('ФактАстрочас, час')], '');
  assert.strictEqual(rows[2][index('Итог Новый тип задач')], 'Прочее');
  assert.strictEqual(rows[2][index('Дата создания вызова ITSM')], '');

  // Database Workspace must retain the exact Dataset/Full Dataset while
  // skipping XLSX construction. The standalone export path above still writes.
  const write = XLSX.write;
  let unexpectedWrites = 0;
  XLSX.write = (...args) => {
    unexpectedWrites += 1;
    return write(...args);
  };
  let deferred;
  try {
    deferred = await globalThis.ReclassifierMobileBrigadeWorkerProcessor.process({
      files: [
        { fileName: 'tasks_2026-01-01_2026-09-04 ZF.xlsx', bytes: first },
        { fileName: 'tasks_2026-01-01_2026-09-25 СВ.xlsx', bytes: second }
      ],
      itsmData: [
        { number:' req-1 ', createdAt:'01.09.2026 08:15:00' },
        { number:'REQ-OTHER', createdAt:'02.09.2026 09:30:00' }
      ],
      deferExport:true
    });
  } finally {
    XLSX.write = write;
  }
  assert.strictEqual(unexpectedWrites,0,
    'deferExport=true must not call XLSX.write()');
  assert.strictEqual(deferred.bytes,null);
  assert.deepStrictEqual(deferred.mobileBrigadeData.records,result.mobileBrigadeData.records);
  assert.deepStrictEqual(deferred.mobileBrigadeFullDataset.rows,result.mobileBrigadeFullDataset.rows);
  assert.deepStrictEqual(deferred.mobileBrigadeFullDataset.columns,result.mobileBrigadeFullDataset.columns);
  assert.strictEqual(deferred.stats.rows,result.stats.rows);
  assert.deepStrictEqual(deferred.stats.typeCounts,result.stats.typeCounts);
  console.log('Database Workspace deferExport parity: full analytics/rows retained, XLSX.write skipped');

  console.log('Mobile Brigade Worker XLSX integration: XLSX + full Dataset share the complete output-column contract OK');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
