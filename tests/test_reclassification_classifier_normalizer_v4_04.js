'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname, '..');
const context = {console, datasetPipeline: {register() {}}};
context.window = context;
context.globalThis = context;
context.XLSX = {utils: {sheet_to_json: sheet => sheet.rows}};
const read = name => fs.readFileSync(path.join(root, 'src/js', name), 'utf8');
vm.createContext(context);
vm.runInContext([
  read('app/dataset_catalog.js'), read('modules/failure_classifier/config.js'),
  read('modules/failure_classifier/normalizer.js'), read('modules/reclassification/classifier_index_v4.js')
].join('\n'), context);
const headers = ['Услуга', 'Наименование оборудования', 'Элемент', 'Неисправность', 'Причина',
  'Деактивирована', 'Неисправность.Элемент.Наименование оборудования.Услуга "САДУ"'];
const active = [null, 'СВР', 'Камера', 'Нет видео', 'Механическое воздействие', 'Нет', 'Нет'];
const rows = [headers, active, [...active],
  [null, 'Отключённое', 'Камера', 'Нет видео', 'Причина', 'Да', 'Нет'],
  [null, 'САДУ', 'Камера', 'Нет видео', 'Причина', 'Нет', 'Да'],
  [null, 'Неизвестный статус', 'Камера', 'Нет видео', 'Причина', '?', 'Нет'],
  ['Другая услуга', 'Чужое', 'Камера', 'Нет видео', 'Причина', 'Нет', 'Нет'],
  [null, 'Неполное', 'Камера', 'Нет видео', null, 'Нет', 'Нет']];
context.book = {SheetNames: ['Полные данные'], Sheets: {'Полные данные': {rows}}};
vm.runInContext('globalThis.prepared = normalizeFailureClassifierWorkbook(book);', context);
const before = JSON.stringify(context.prepared);
const index = context.ReclassifierClassifierIndexV4.buildIndex(context.prepared);
assert.equal(index.list().length, 1);
assert.equal(index.diagnostics.incompleteRows.length, 1);
assert.equal(index.diagnostics.upstreamDuplicatesRemoved, 1);
assert.equal(context.prepared.meta.filteredRows, 4);
assert.equal(context.prepared.validation.status, 'warning');
assert.deepEqual(Array.from(index.list()[0].path), active.slice(1, 5));
assert.equal(JSON.stringify(context.prepared), before);
assert.equal(index.provenance.versionIdentified, false);
assert.equal(index.lookup(['Отключённое', 'Камера', 'Нет видео', 'Причина']).status, 'NOT_FOUND');
console.log('V4-04 normalizer integration: service/deactivation/SADU/unknown flags, upstream dedup, incomplete rows OK');
