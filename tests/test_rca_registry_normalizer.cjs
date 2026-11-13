const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const {officialPrb, problemGrade} = require('./fixtures/rca-pr13.cjs');

const html = fs.readFileSync(path.join(__dirname, '../dist/ReclassifierEXCEL.html'), 'utf8');
const worker = JSON.parse(html.match(/id="folders-worker">([\s\S]*?)<\/script>/)[1]);
const context = vm.createContext({Blob, ArrayBuffer, Uint8Array, Date, Map, Set, TextEncoder, TextDecoder,
  crypto, performance, setTimeout, navigator: {locks: {request: (_, run) => run()}}});
context.self = context;
vm.runInContext(worker, context);

function workbook(headers, rows, offset = 0) {
  const xlsx = context.XLSX;
  const book = xlsx.utils.book_new();
  const sheet = xlsx.utils.aoa_to_sheet([]);
  xlsx.utils.sheet_add_aoa(sheet, [headers, ...rows], {origin: {r: offset, c: 0}});
  xlsx.utils.book_append_sheet(book, sheet, 'Sheet1');
  return book;
}

test('official registry is optional and the worker normalizes actual XLSX headers and conflicts', async () => {
  const headers = Object.keys(officialPrb[0]).reverse();
  const rows = [...officialPrb, {...officialPrb[0]}, {...officialPrb[1], 'Статус': 'Конфликт'},
    {...officialPrb[1], 'Номер': 'INC100'}, {...officialPrb[1], 'Номер': 'PRB00003', 'Статус': ''}];
  const book = workbook(headers, rows.map(row => headers.map(key => row[key])), 3);
  const file = Object.assign(new Blob([context.XLSX.write(book, {type: 'array', bookType: 'xlsx'})]),
    {name: 'Реестр ИТ-проблем.xlsx'});
  const engine = context.ReclassifierDirectoryEngine;
  assert.ok(!engine.manifest().requiredIds.includes('it_problem_registry'));
  const scan = await engine.scan([{file, path: 'Catalogs/' + file.name, folder: 'catalogs'}], () => {}, {exportOnly: true});
  const registry = scan.officialRegistry;
  assert.ok(registry, JSON.stringify({statuses:[...scan.statuses], errors:scan.errors}));
  assert.equal(registry.records.length, 1);
  assert.equal(registry.records[0].prbNumber, 'PRB00001');
  assert.equal(registry.records[0].itsmStatus, officialPrb[0]['Статус']);
  assert.equal(registry.records[0].createdAt, '2025-12-09');
  assert.equal(registry.records[0].closedAt, null);
  assert.match(registry.sourceHash, /^[a-f0-9]{64}$/);
  assert.match(registry.warnings.join(' '), /совпадающий дубль.*конфликт строк/);
  assert.equal((await engine.scan([], () => {}, {exportOnly: true})).officialRegistry, null);
});

test('ProblemGrade ignores old official fields and preserves unambiguous and ambiguous links', () => {
  const headers = ['Основание № IT-проблемы', 'Наименование оборудования', 'Элемент',
    'Неисправность', 'Причина', 'Статус PRB', 'Имя ИТ-проблемы'];
  const rows = problemGrade.map(row => [row.problemId, row.equipment, row.element, row.fault,
    row.reason, 'Старый статус', 'Старое имя']);
  const records = context.normalizeProblemGradeWorkbook(workbook(headers, rows)).records;
  assert.equal(records.length, 2);
  assert.ok(records.every(row => !Object.hasOwn(row, 'problemName') && !Object.hasOwn(row, 'problemStatus')));
  const rules = context.ReclassifierItsmRules;
  const key = records[0].classifierKey;
  const unique = rules.buildLookups({problem_grade: records.slice(0,1)});
  assert.equal(unique.problems.get(key)[0].problemId, problemGrade[0].problemId);
  assert.equal(unique.problemConflicts.size, 0);
  assert.equal(rules.buildLookups({problem_grade: records}).problemConflicts.get(key).length, 2);
});
