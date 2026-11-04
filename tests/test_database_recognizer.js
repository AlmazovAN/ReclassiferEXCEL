const fs = require('fs');
const vm = require('vm');

const source = fs.readFileSync('src/js/app/database_recognizer.js', 'utf8');

const context = {
  console,
  Date,
  Math,
  JSON,
  Map,
  Set,
  Object,
  String,
  Number,
  Error,
  Promise,
  globalThis: null,
  window: null,
  ReclassifierDatasetClassifier: { classifyWorkbook: null }
};
context.globalThis = context;
context.window = context;

context.XLSX = {
  utils: {
    sheet_to_json(sheet) {
      return sheet.rows;
    }
  },
  SSF: {}
};

context.ReclassifierDatabaseContract = {
  strategy: { UPSERT: 'UPSERT', REPLACE: 'REPLACE', DERIVED: 'DERIVED' },
  datasets: {
    itsm_data: {
      title: 'ITSM Sirius Data',
      schemaVersion: '1.1.0',
      strategy: 'UPSERT',
      persisted: true,
      allowEmpty: false
    },
    mobile_brigade_data: {
      title: 'Mobile Brigade Data',
      schemaVersion: '1.4.0',
      strategy: 'UPSERT',
      persisted: true,
      allowEmpty: false
    }
  }
};

context.ReclassifierMobileBrigadeRules = {
  mobileBrigadeRecordKey(record) {
    const site = String(record?.site || '').trim().toLowerCase();
    const task = String(record?.taskNumber || '').trim().toLowerCase();
    if (site && task) return site + '|' + task;
    return '';
  }
};

vm.createContext(context);
vm.runInContext(source, context, { filename: 'database_recognizer.js' });

if (!context.ReclassifierDatasetRecognizer) {
  throw new Error('Dataset Recognizer API was not exported.');
}

const itsmHeaders = [
  'Дата создания Вызова',
  'Дата выполнения обращения',
  'Дата закрытия',
  'Номер',
  'Территории MES',
  'Наименование оборудования',
  'Элемент',
  'Неисправность',
  'Причина инцидента',
  'Категорированная информация обращения.Краткое описание',
  'Категорированная информация обращения.Описание',
  'Примечание к закрытию',
  'Открыл',
  'Измерение цели обслуживания SLA Прошло (рабочее время)',
  'Код закрытия'
];

context.ReclassifierDatasetClassifier.classifyWorkbook = () => ({
  id: 'itsm',
  group: 'Данные',
  label: 'ITSM',
  sheetName: 'Обращение',
  headerRow: 1,
  reason: 'структура ITSM-выгрузки'
});

let workbook = {
  SheetNames: ['Обращение'],
  Sheets: {
    'Обращение': {
      rows: [
        itsmHeaders,
        ['2026-09-01', '2026-09-02', '2026-09-03', 'INC-1', 'Северный', 'БКМ', 'АКБ', 'Разряд', 'Питание', 'Тест', 'Описание', 'Закрыто', 'Иванов', 1, 'Решено'],
        ['2026-09-29', '2026-09-29', '2026-09-29', 'INC-2', 'Северный', 'БКМ', 'АКБ', 'Разряд', 'Питание', 'Тест', 'Описание', 'Закрыто', 'Иванов', 1, 'Решено']
      ]
    }
  }
};

let result = context.ReclassifierDatasetRecognizer.inspectWorkbook(workbook, { fileName: 'ITSM.xlsx' });
if (!result.ready) throw new Error('Valid ITSM file was not marked ready.');
if (result.confidence !== 100) throw new Error('ITSM confidence must be 100 for the complete contract.');
if (result.freshness.from !== '2026-09-01' || result.freshness.to !== '2026-09-29') {
  throw new Error('ITSM content freshness was calculated incorrectly.');
}
if (result.sourceRows !== 2 || result.datasetId !== 'itsm_data') {
  throw new Error('ITSM Dataset metadata is incorrect.');
}

workbook.Sheets['Обращение'].rows.push(
  ['2026-09-29', '2026-09-29', '2026-09-29', 'INC-2', 'Северный', 'БКМ', 'АКБ', 'Разряд', 'Питание', 'Тест', 'Описание', 'Закрыто', 'Иванов', 1, 'Решено']
);
result = context.ReclassifierDatasetRecognizer.inspectWorkbook(workbook, { fileName: 'ITSM.xlsx' });
if (result.ready || result.validation.status !== 'invalid') {
  throw new Error('Duplicate ITSM UPSERT keys must block readiness.');
}
if (!result.validation.errors.some(item => item.includes('Повторяющихся значений ключа'))) {
  throw new Error('Duplicate ITSM key error is missing.');
}

context.ReclassifierDatasetClassifier.classifyWorkbook = () => ({
  id: 'mobile_brigade',
  group: 'Данные',
  label: 'Мобильные бригады',
  sheetName: 'Tasks',
  headerRow: 1,
  reason: 'структура выгрузки задач МБ'
});

workbook = {
  SheetNames: ['Tasks'],
  Sheets: {
    Tasks: {
      rows: [
        ['Участок', 'Номер задачи', 'Заявка', 'Тип задачи', 'Фактическая дата', 'Фактические трудозатраты', 'Ссылка на заявку'],
        ['Северный', 'TASK-1', 'INC-1', 'АВР', '2026-09-20', 2, 'https://example.invalid/1'],
        ['Северный', 'TASK-2', 'INC-2', 'ТО', '2026-09-29', 3, 'https://example.invalid/2']
      ]
    }
  }
};

result = context.ReclassifierDatasetRecognizer.inspectWorkbook(workbook, {
  fileName: 'MobileBrigade_2026-09-01_2026-09-29.xlsx'
});
if (!result.ready) throw new Error('Valid Mobile Brigade file was not marked ready.');
if (result.confidence !== 100) throw new Error('Mobile Brigade confidence must be 100.');
if (result.freshness.from !== '2026-09-20' || result.freshness.to !== '2026-09-29') {
  throw new Error('Mobile Brigade freshness must come from content.');
}
if (result.validation.warnings.some(item => item.includes('не совпадает'))) {
  throw new Error('Matching file/content freshness must not warn.');
}

// Repeated Mobile Brigade keys are processed downstream using -D suffixes,
// so intake must warn rather than disabling the Apply button.
workbook.Sheets.Tasks.rows.push(
  ['Северный', 'TASK-2', 'INC-2', 'ТО', null, null, 'https://example.invalid/2']
);
result = context.ReclassifierDatasetRecognizer.inspectWorkbook(workbook, {
  fileName: 'MobileBrigade_2026-09-01_2026-09-29.xlsx'
});
if (!result.ready || result.validation.status === 'invalid') {
  throw new Error('Duplicate Mobile Brigade keys must not block intake readiness.');
}
if (!result.validation.warnings.some(item => item.includes('Повторяющихся recordKey внутри файла: 1'))) {
  throw new Error('Missing Mobile Brigade duplicate-key warning.');
}
workbook.Sheets.Tasks.rows.pop();

context.ReclassifierDatabaseContract.datasets.failure_classifier = {
  title: 'Классификатор отказов', kind: 'classifier', schemaVersion: '2.0.0',
  strategy: 'REPLACE', persisted: true, allowEmpty: false
};
context.normalizeFailureClassifierWorkbook = () => ({
  records: [
    { service: null, equipment: 'БКМ', element: 'АКБ', failure: 'Отказ', cause: 'Питание' }
  ],
  validation: { status: 'valid', errors: [], warnings: [] },
  meta: {
    formatLabel: 'Системная выгрузка',
    sourceSheet: 'Причина инцидента', headerRow: 1,
    sourceRows: 3, candidateRows: 3, normalizedRows: 1,
    filteredRows: 1, afterFiltersRows: 2, duplicatesRemoved: 1,
    latestChangedAt: '2026-09-26'
  }
});
context.ReclassifierDatasetClassifier.classifyWorkbook = () => ({
  id: 'failure_classifier', group: 'Классификаторы', label: 'Классификатор отказов',
  sheetName: 'Причина инцидента', headerRow: 1
});
result = context.ReclassifierDatasetRecognizer.inspectWorkbook(
  { SheetNames: ['Причина инцидента'], Sheets: { 'Причина инцидента': { rows: [] } } },
  { fileName: 'classifier.xlsx' }
);
if (!result.ready || result.validation.status !== 'valid' ||
    result.normalizedRows !== 1 || result.details.duplicatesRemoved !== 1 ||
    result.details.afterFiltersRows !== 2) {
  throw new Error('Failure classifier deduplication metadata did not reach Dataset Recognizer.');
}

context.ReclassifierDatasetClassifier.classifyWorkbook = () => ({
  id: 'unknown',
  group: 'Не распознано',
  label: 'Не распознано',
  reason: 'не найдена известная структура заголовков'
});
result = context.ReclassifierDatasetRecognizer.inspectWorkbook(
  { SheetNames: ['Sheet1'], Sheets: { Sheet1: { rows: [['A'], ['B']] } } },
  { fileName: 'unknown.xlsx' }
);
if (result.ready || result.confidence !== 0 || result.validation.status !== 'invalid') {
  throw new Error('Unknown workbook must not be ready.');
}

console.log('Dataset Recognizer contract: OK');
