const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('src/js/app/dataset_classifier.js', 'utf8');

const context = {
  console,
  Map,
  Set,
  Object,
  String,
  Number,
  Error,
  Math,
  globalThis: null,
  XLSX: {
    utils: {
      sheet_to_json(sheet) {
        return sheet.rows;
      }
    }
  },
  RECLASSIFICATION_SCHEMA: {
    anchorHeaders: ['Дата регистрации', 'Дата выполнения обращения', 'Номер']
  },
  PROBLEM_GRADE_SCHEMA: {
    anchorHeaders: ['Основание № IT-проблемы', 'Наименование оборудования', 'Элемент', 'Неисправность', 'Причина']
  },
  INITIATORS_SCHEMA: {
    requiredHeaders: ['Инициатор (открыл)', 'Группа инициаторов', 'Группа инициаторов с коментами', 'комменты']
  },
  equipmentConfig: {
    stationary: {
      requiredHeaders: ['id', 'unit', 'unit_department', 'name', 'equipment_type', 'location', 'address', 'horizon',
        'transport', 'not_working_since', 'customer', 'parent', 'commissioning_date']
    }
  },
  classifierDetectWorkbook(workbook) {
    if (workbook.SheetNames?.includes('FailureClassifier')) {
      return {
        sheetName: 'FailureClassifier',
        headerRowIndex: 2,
        formatLabel: 'Системная выгрузка'
      };
    }
    return null;
  }
};
context.globalThis = context;

vm.createContext(context);
vm.runInContext(source, context, { filename: 'dataset_classifier.js' });

const classifier = context.ReclassifierDatasetClassifier;
assert.ok(classifier?.classifyWorkbook, 'Shared Dataset classifier API was not exported.');

function workbook(sheetName, headers) {
  return {
    SheetNames: [sheetName],
    Sheets: {
      [sheetName]: {
        rows: [
          ['служебная строка'],
          headers
        ]
      }
    }
  };
}

let result = classifier.classifyWorkbook(workbook('ITSM', [
  'Номер', 'Код закрытия', 'Наименование оборудования', 'Причина инцидента'
]));
assert.equal(result.id, 'itsm');
assert.equal(result.headerRow, 2);

result = classifier.classifyWorkbook(workbook('MB', [
  'Участок', 'Тип задачи', 'Фактическая дата', 'Фактические трудозатраты'
]));
assert.equal(result.id, 'mobile_brigade');

result = classifier.classifyWorkbook(workbook('Equipment', [
  'id', 'unit', 'unit_department', 'name', 'equipment_type', 'location', 'address', 'horizon',
  'transport', 'not_working_since', 'customer', 'parent', 'commissioning_date'
]));
assert.equal(result.id, 'equipment:stationary');

result = classifier.classifyWorkbook(workbook('ReClass', [
  'Дата регистрации', 'Дата выполнения обращения', 'Номер'
]));
assert.equal(result.id, 'reclassification');

result = classifier.classifyWorkbook(workbook('Drivers', [
  'Наименование типа узла/объекта/оборудования', 'Сервис', 'Система'
]));
assert.equal(result.id, 'drivers');

result = classifier.classifyWorkbook(workbook('Customers', [
  'Рудник', 'Заказчик', 'Заказчик кратко', 'Заказчик полностью'
]));
assert.equal(result.id, 'customers');

result = classifier.classifyWorkbook({
  SheetNames: ['FailureClassifier'],
  Sheets: { FailureClassifier: { rows: [['A']] } }
});
assert.equal(result.id, 'failure_classifier');
assert.equal(result.headerRow, 3);
assert.equal(result.reason, 'Системная выгрузка');

result = classifier.classifyWorkbook(workbook('Unknown', ['A', 'B', 'C']));
assert.equal(result.id, 'unknown');
assert.equal(result.reason, 'не найдена известная структура заголовков');

assert.equal(classifier.normalizeHeader('  Наименование\u00a0 оборудования  '), 'наименование оборудования');

// A real SheetJS worksheet advertises !ref. The classifier must never
// materialize an entire 70k+ row XLSX just to examine 25 header candidates.
// Blank physical rows do not count toward the first 25 nonblank logical rows.
const originalSheetToJson = context.XLSX.utils.sheet_to_json;
const inspectedRanges = [];
context.XLSX.utils.decode_range = () => ({
  s:{r:0,c:0},e:{r:9999,c:6}
});
context.XLSX.utils.sheet_to_json = (sheet,options={}) => {
  assert(options.range,'Real worksheet must be read in bounded ranges');
  const {s,e} = options.range;
  const count = e.r - s.r + 1;
  assert(count <= 128,'Classifier requested more than 128 physical rows');
  inspectedRanges.push([s.r,e.r]);
  return sheet.rows.slice(s.r,e.r+1).filter(row =>
    Array.isArray(row) && row.some(value => value !== '' && value != null)
  );
};
const many = Array.from({length:10000}, () => []);
many[0] = ['служебная строка'];
many[160] = ['Участок','Тип задачи','Фактическая дата','Фактические трудозатраты'];
for(let i=161;i<many.length;i++) many[i]=['x'];
const largeWorkbook={
  SheetNames:['MB'], Sheets:{MB:{'!ref':'A1:G10000',rows:many}}
};
result=classifier.classifyWorkbook(largeWorkbook);
assert.equal(result.id,'mobile_brigade');
assert.equal(result.headerRow,2,'Header index must ignore blank physical rows');
assert(inspectedRanges.length <= 2,'Header search should stop in the first 256 physical rows');
assert(!inspectedRanges.some(([,end])=>end>255),
  'Scanning must stop once the second logical nonblank row is found');
context.XLSX.utils.sheet_to_json=originalSheetToJson;
delete context.XLSX.utils.decode_range;

console.log('Shared Dataset classifier: OK (bounded ranges and blank-row parity)');
