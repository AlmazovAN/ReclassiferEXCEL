const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const catalog = fs.readFileSync(path.join(root, 'src/js/app/dataset_catalog.js'), 'utf8');
const config = fs.readFileSync(path.join(root, 'src/js/modules/failure_classifier/config.js'), 'utf8');
const normalizer = fs.readFileSync(path.join(root, 'src/js/modules/failure_classifier/normalizer.js'), 'utf8');

const context = { console, __assert: assert };
context.datasetPipeline = { register: () => {} };
context.window = context;
context.globalThis = context;
context.XLSX = {
  utils: { sheet_to_json: sheet => sheet.__rows },
  SSF: { parse_date_code: () => null }
};

const testCode = catalog + '\n' + config + '\n' + normalizer + `
  const assert = globalThis.__assert;

  const workingHeaders = [
    'Услуга',
    'Наименование оборудования',
    'Наименование оборудования.Id',
    'Элемент',
    'Элемент.Id',
    'Неисправность',
    'Неисправность.Id',
    'Причина',
    'Причина.Id',
    'Деактивирована',
    'Неисправность.Элемент.Наименование оборудования.Услуга "САДУ"',
    'Дата изменения'
  ];

  const workingWorkbook = {
    SheetNames: ['Полные данные'],
    Sheets: {
      'Полные данные': { __rows: [
        workingHeaders,
        [null, 'WiFi-роутер', 'eq-1', 'Антенна', 'el-1', 'Повреждение', 'f-1',
         'Механическое воздействие', 'cause-1', 'Нет', 'Нет', '2026-09-17'],
        ['  Техническое обслуживание и ремонт автоматизированной системы управления открытыми горными работами  ',
         'Коммутатор', 'eq-2', 'Внутреннее ПО', 'el-2', 'Некорректная работа', 'f-2',
         ' Неактуальная версия ', 'cause-2', 'Нет', 'Нет', '26.09.2026'],
        ['ЕДН-Поддержка телекоммуникационного оборудования (Комплексное обслуживание ИТ-инфраструктуры)',
         'Чужое оборудование', 'eq-3', 'Узел', 'el-3', 'Отказ', 'f-3', 'Причина', 'cause-3',
         'Нет', 'Нет', '2026-09-18'],
        [null, 'Деактивированное', 'eq-4', 'Узел', 'el-4', 'Отказ', 'f-4', 'Причина', 'cause-4',
         'Да', 'Нет', '2026-09-19'],
        [null, 'САДУ оборудование', 'eq-5', 'Узел', 'el-5', 'Отказ', 'f-5', 'Причина', 'cause-5',
         'Нет', 'Да', '2026-09-20'],
        [null, 'Неизвестный статус', 'eq-6', 'Узел', 'el-6', 'Отказ', 'f-6', 'Причина', 'cause-6',
         'Не определено', 'Нет', '2026-09-21']
      ] }
    }
  };

  const working = normalizeFailureClassifierWorkbook(workingWorkbook);
  assert.strictEqual(working.meta.format, 'working');
  assert.strictEqual(working.meta.normalizedRows, 2);
  assert.strictEqual(working.meta.candidateRows, 6);
  assert.strictEqual(working.meta.filteredRows, 4);
  assert.strictEqual(working.meta.filteredServiceRows, 1);
  assert.strictEqual(working.meta.filteredDeactivatedRows, 1);
  assert.strictEqual(working.meta.filteredSaduRows, 1);
  assert.strictEqual(working.meta.filteredUnknownDeactivatedRows, 1);
  assert.strictEqual(working.meta.filteredUnknownSaduRows, 0);
  assert.strictEqual(working.meta.serviceCount, 2);
  assert.strictEqual(working.meta.latestChangedAt, '2026-09-26');
  assert.strictEqual(working.validation.status, 'warning');

  assert.strictEqual(
    Object.keys(working.records[0]).join(','),
    'service,equipment,element,failure,cause'
  );
  assert.strictEqual(working.records[0].service, null);
  assert.strictEqual(working.records[0].equipment, 'WiFi-роутер');
  assert.strictEqual(working.records[1].service, FAILURE_CLASSIFIER_OGR_SERVICE);
  assert.strictEqual(working.records[1].cause, 'Неактуальная версия');
  assert.strictEqual(working.records[0].causeId, undefined);
  assert.strictEqual(working.records[0].equipmentId, undefined);
  assert.strictEqual(working.records[0].disabled, undefined);
  assert.strictEqual(working.records[0].sadu, undefined);

  const systemHeaders = [
    'Id',
    'Неисправность.Элемент.Наименование оборудования.Услуга',
    'Неисправность.Элемент.Наименование оборудования',
    'Неисправность.Элемент.Наименование оборудования.Id',
    'Неисправность.Элемент',
    'Неисправность.Элемент.Id',
    'Неисправность',
    'Неисправность.Id',
    'Название',
    'Деактивирована',
    'Неисправность.Элемент.Наименование оборудования.Услуга "САДУ"',
    'Дата изменения'
  ];

  const systemWorkbook = {
    SheetNames: ['Причина инцидента'],
    Sheets: {
      'Причина инцидента': { __rows: [
        systemHeaders,
        ['cause-10', null, 'Станция связи', 'eq-10', 'Антенна', 'el-10',
         'Повреждение', 'f-10', 'Механическое воздействие', 'Нет', 'Нет', '2026-09-25'],
        ['cause-11', 'ЕДН-Поддержка беспроводных сетей (Комплексное обслуживание ИТ-инфраструктуры)',
         'WiFi', 'eq-11', 'Радиомодуль', 'el-11', 'Отказ', 'f-11',
         'Внешнее воздействие', 'Нет', 'Нет', '2026-09-25']
      ] }
    }
  };

  const system = normalizeFailureClassifierWorkbook(systemWorkbook);
  assert.strictEqual(system.meta.format, 'system');
  assert.strictEqual(system.meta.normalizedRows, 1);
  assert.strictEqual(system.meta.filteredServiceRows, 1);
  assert.strictEqual(Object.keys(system.records[0]).join(','), 'service,equipment,element,failure,cause');
  assert.strictEqual(system.records[0].service, null);
  assert.strictEqual(system.records[0].equipment, 'Станция связи');
  assert.strictEqual(system.records[0].element, 'Антенна');
  assert.strictEqual(system.records[0].failure, 'Повреждение');
  assert.strictEqual(system.records[0].cause, 'Механическое воздействие');

  const noIdWorkingHeaders = [
    'Услуга', 'Наименование оборудования', 'Элемент', 'Неисправность', 'Причина',
    'Деактивирована', 'Неисправность.Элемент.Наименование оборудования.Услуга "САДУ"'
  ];
  const noIdWorkbook = {
    SheetNames: ['Полные данные'],
    Sheets: {
      'Полные данные': { __rows: [
        noIdWorkingHeaders,
        [null, 'Оборудование', 'Элемент', 'Неисправность', 'Причина', 'Нет', 'Нет']
      ] }
    }
  };
  const noId = normalizeFailureClassifierWorkbook(noIdWorkbook);
  assert.strictEqual(noId.meta.normalizedRows, 1);
  assert.strictEqual(noId.records[0].equipment, 'Оборудование');

  // Two different source IDs for the same five visible fields collapse to one
  // record. A distinct service or cause must remain a separate record.
  workingWorkbook.Sheets['Полные данные'].__rows.push(
    [null, ' WiFi-роутер ', 'another-equipment-id', 'Антенна', 'another-element-id',
      'Повреждение', 'another-failure-id', 'Механическое воздействие',
      'another-cause-id', 'Нет', 'Нет', '2026-09-26'],
    [null, 'wifi-роутер', 'third-equipment-id', 'АНТЕННА', 'third-element-id',
      'ПОВРЕЖДЕНИЕ', 'third-failure-id', 'Механическое   воздействие',
      'third-cause-id', 'Нет', 'Нет', '2026-09-26'],
    [FAILURE_CLASSIFIER_OGR_SERVICE, 'WiFi-роутер', 'new-id', 'Антенна', 'new-id',
      'Повреждение', 'new-id', 'Механическое воздействие', 'new-id',
      'Нет', 'Нет', '2026-09-26']
  );
  const workingDedup = normalizeFailureClassifierWorkbook(workingWorkbook);
  assert.strictEqual(workingDedup.meta.candidateRows, 9);
  assert.strictEqual(workingDedup.meta.filteredRows, 4);
  assert.strictEqual(workingDedup.meta.afterFiltersRows, 5);
  assert.strictEqual(workingDedup.meta.duplicatesRemoved, 2);
  assert.strictEqual(workingDedup.meta.duplicateTextRows, 0);
  assert.strictEqual(workingDedup.records.length, 3);
  assert.strictEqual(workingDedup.records[0].equipment, 'WiFi-роутер');
  assert.strictEqual(workingDedup.validation.warnings.length, 1); // unknown flag only
  assert.strictEqual(workingDedup.validation.warnings.some(x => /дубл|повторн/i.test(x)), false);

  systemWorkbook.Sheets['Причина инцидента'].__rows.push(
    ['different-cause-id', null, ' СТАНЦИЯ  связи ', 'different-eq-id',
      'Антенна', 'different-element-id', 'Повреждение', 'different-failure-id',
      'Механическое воздействие', 'Нет', 'Нет', '2026-09-26'],
    ['third-cause-id', null, 'Станция связи', 'another-eq-id',
      'Антенна', 'another-el-id', 'Повреждение', 'another-f-id',
      'Другая причина', 'Нет', 'Нет', '2026-09-26'],
    ['disabled-id', null, 'Станция связи', 'id', 'Антенна', 'id',
      'Повреждение', 'id', 'Механическое воздействие', 'Да', 'Нет', '2026-09-26'],
    ['sadu-id', null, 'Станция связи', 'id', 'Антенна', 'id',
      'Повреждение', 'id', 'Механическое воздействие', 'Нет', 'Да', '2026-09-26']
  );
  const systemDedup = normalizeFailureClassifierWorkbook(systemWorkbook);
  assert.strictEqual(systemDedup.meta.candidateRows, 6);
  assert.strictEqual(systemDedup.meta.filteredRows, 3);
  assert.strictEqual(systemDedup.meta.afterFiltersRows, 3);
  assert.strictEqual(systemDedup.meta.duplicatesRemoved, 1);
  assert.strictEqual(systemDedup.records.length, 2);
  assert.strictEqual(systemDedup.validation.status, 'valid');
  assert.strictEqual(systemDedup.validation.warnings.length, 0);
  assert.strictEqual(systemDedup.records[0].equipment, 'Станция связи');
  assert.strictEqual(Object.keys(systemDedup.records[0]).join(','),
    'service,equipment,element,failure,cause');

  assert.throws(
    () => normalizeFailureClassifierWorkbook({
      SheetNames: ['Лист1'],
      Sheets: { 'Лист1': { __rows: [['A', 'B'], [1, 2]] } }
    }),
    /Формат классификатора не распознан/
  );

  console.log('Failure classifier filtered text contract regression: OK');
`;

vm.runInNewContext(testCode, context, { filename: 'failure_classifier_normalizer_test.js' });
