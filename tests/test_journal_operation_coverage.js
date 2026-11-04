const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const journal = require('../src/js/app/diagnostic_journal.js');
const captured = [];
const log = (message, level = 'INFO', category = 'general') => {
  captured.push({message: String(message), level, category});
  journal.capture(message, level, category);
};

function functionSource(file, name) {
  const source = read(file).replace(/\r\n/g, '\n');
  const start = source.indexOf('  function ' + name + '(');
  assert.notEqual(start, -1, name + ' is missing');
  const end = source.indexOf('\n  }\n', start);
  assert.ok(end > start, name + ' closing brace is missing');
  return source.slice(start, end + '\n  }'.length);
}

function invoke(file, name, stubs, expression) {
  const source = functionSource(file, name) + '\n' + expression;
  vm.runInNewContext(source, {log, ...stubs}, {filename: file});
}

journal.clear();
journal.setEnabled('import_export', true);
journal.setEnabled('runtime', true);

// Invoke the real Database export UI handler with a harmless Repository stub.
const pathDb = 'src/js/app/database_connection_ui.js';
const setup = {
  databaseWorkspaceState: {busy: false},
  databaseCurrentInfo: () => ({fileName: 'Sample.db'}),
  databaseRunHealthCheck: () => ({ok: true}),
  formatBytes: value => value + ' B',
  renderDatabaseWorkspace() {},
  alert() {}
};
invoke(pathDb, 'databaseExportCurrent', {
  ...setup,
  getDatabaseRepository: () => ({downloadDatabase: () => 4096})
}, 'databaseExportCurrent();');
assert.ok(captured.some(item => item.level === 'INFO' &&
  item.category === 'import_export' &&
  item.message.includes('Запрошено скачивание отдельной копии SQLite')));

invoke(pathDb, 'databaseExportCurrent', {
  ...setup,
  getDatabaseRepository: () => ({downloadDatabase: () => {throw Error('Disk problem');}})
}, 'databaseExportCurrent();');
assert.ok(captured.some(item => item.level === 'ERROR' &&
  item.category === 'import_export' && item.message.includes('Ошибка выгрузки БД')));

// Invoke real Dataset apply handlers with isolated lifecycle stubs.
invoke('src/js/references/reference_manager.js', 'applyReferenceCandidate', {
  referenceDatasetLifecycle: {commit: () => ({records: [{}, {}]})},
  referenceConfig: {drivers: {title: 'Drivers'}}
}, "applyReferenceCandidate('drivers');");
assert.ok(captured.some(item => item.level === 'INFO' &&
  item.category === 'import_export' &&
  item.message.includes('Применён справочник Drivers')));

invoke('src/js/modules/mobile_brigade/ui.js', 'applyMobileBrigadeCandidate', {
  state: {processingModuleId: null},
  mobileBrigadeDatasetLifecycle: {commit: () =>
    ({records: [{}, {}], meta: {latestSourceDate: '2026-10-28'}})}
}, 'applyMobileBrigadeCandidate();');
assert.ok(captured.some(item => item.level === 'INFO' &&
  item.category === 'import_export' &&
  item.message.includes('Mobile Brigade Data применён')));

assert.deepEqual(captured.map(item => item.level), ['INFO', 'ERROR', 'INFO', 'INFO']);
assert.equal(journal.entries().length, 4);
assert.equal(journal.select({category: 'import_export'}).length, 4);
assert.equal(journal.select({category: 'import_export', level: 'ERROR'}).length, 1);
assert.equal(journal.exportSnapshot('PR06').events.length, 4);

// Contract for additional production operation paths, including source errors.
const expected = [
  ['src/js/app/database_ui.js', 'Ошибка синхронизации HTML:', 'import_export', 'ERROR'],
  ['src/js/app/database_ui.js', 'Подготовлен к скачиванию HTML', 'import_export', 'INFO'],
  ['src/js/app/database_recovery_ui.js', 'Ошибка восстановления SQLite:', 'import_export', 'ERROR'],
  ['src/js/modules/mobile_brigade/ui.js', 'ПРЕДУПРЕЖДЕНИЕ:', 'import_export', 'WARN'],
  ['src/js/app/database_integration_ui.js', 'Кандидат подготовлен в фоне', 'import_export', 'INFO'],
  ['src/js/app/database_integration_ui.js', 'SQLite интеграция:', 'import_export', 'INFO'],
  ['src/js/app/database_integration_ui.js', 'Ошибка интеграции «', 'import_export', 'ERROR'],
  ['src/js/app/database_recalculation_ui.js', 'Перерасчёт применён:', 'import_export', 'INFO'],
  ['src/js/modules/itsm/ui.js', 'ITSM обработан в WebWorker:', 'import_export', 'INFO'],
  ['src/js/modules/itsm/ui.js', 'ITSM Sirius Data применён:', 'import_export', 'INFO'],
  ['src/js/modules/mobile_brigade/ui.js', 'Мобильные бригады обработаны: файлов', 'import_export', 'INFO'],
  ['src/js/modules/reclassification/ui.js', 'Каскад реклассификации завершён', 'import_export', 'INFO'],
  ['src/js/modules/equipment/equipment_manager.js', 'Equipment: ', 'import_export', 'INFO'],
  ['src/js/references/reference_manager.js', 'Проверка справочника', 'import_export', 'INFO'],
  ['src/js/modules/mobile_brigade/ui.js', 'Лист «', 'diagnostics', 'INFO'],
  ['src/js/app/runtime.js', 'Ошибка WebWorker.', 'runtime', 'ERROR']
];
for (const [file, label, category, level] of expected) {
  const source = read(file);
  const hit = source.lastIndexOf(label);
  assert.ok(hit !== -1, 'Missing ' + label);
  const start = source.lastIndexOf('log(', hit);
  const end = source.indexOf(');', hit);
  assert.ok(start >= 0 && end > start && end - start < 1800, label + ' log call');
  const call = source.slice(start, end + 2);
  assert.ok(call.includes("'" + category + "'"), label + ' category');
  assert.ok(call.includes("'" + level + "'"), label + ' severity');
}
console.log('PR-06 real Database export, Dataset apply and categorized operation events: OK');
