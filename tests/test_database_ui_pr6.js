// PR-6: user-facing SQLite status must always show one truthful next action.
// Full route wiring remains covered by smoke_app_runtime and browser CORE CI.
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('src/js/app/database_ui_state.js', 'utf8');
const begin = source.indexOf('function databaseStorageGuidance(');
const end = source.indexOf('function databaseWorkingStorageText(', begin);
assert(begin >= 0 && end > begin, 'PR-6 guidance function exists');
const context = {};
vm.createContext(context);
vm.runInContext(source.slice(begin, end) +
  '\nthis.guidance = databaseStorageGuidance;', context);
const guide = context.guidance;
const connected = { databaseUuid: 'db-one' };

function check(description, actual, expectedAction, expectedText) {
  assert.equal(actual.action, expectedAction, description + ': action');
  assert.match(actual.title + ' ' + actual.description, expectedText,
    description + ': explanation');
  assert(Object.isFrozen(actual), description + ': immutable status');
}

check('not open', guide(null, null), 'open', /не открыта/i);
check('invalid SQLite', guide({ valid: false, dirty: true, databaseUuid: 'db-one' },
  connected), 'check', /проверка|проблему/i);
const dirty = { valid: true, dirty: true, databaseUuid: 'db-one',
  storage: { workingRevision: 3, confirmedFileRevision: 2, diskCurrent: false } };
check('dirty with write access', guide(dirty, connected), 'save',
  /не сохранённые|Сохраните в подключённую/);
check('autosave is pending, not completed', guide(dirty, connected, true),
  'save', /запись на диск пока не подтверждена/);
check('dirty without OS write access', guide(dirty, null), 'download',
  /скачайте отдельную/);
check('wrong file handle UUID', guide(dirty, { databaseUuid: 'other' }),
  'download', /Прямая запись.*недоступна/);
check('verified OS-file save', guide({ ...dirty, dirty: false,
  storage: { ...dirty.storage, confirmedFileRevision: 3, diskCurrent: true } },
connected), 'none', /побайтовой проверкой/);
check('freshly opened database not falsely verified', guide({ ...dirty, dirty: false,
  storage: { workingRevision: 0, confirmedFileRevision: null, diskCurrent: false } },
connected), 'none', /не менялась после открытия/);

const ui = fs.readFileSync('src/js/app/database_ui.js', 'utf8');
assert(ui.includes('databaseStorageGuidance('));
assert(ui.includes('database-top-grid'));
assert(ui.includes('<h2>База данных</h2>'));
assert(ui.includes('Синхронизировать подключённую БД'));
assert(!ui.includes('database-storage-guidance'));
assert(ui.includes('role="status" aria-live="polite"'));
for (const action of ['open', 'save', 'download', 'check']) {
  assert(ui.includes("storageGuidance.action === '" + action + "'"),
    'missing primary button action: ' + action);
}
const ids = [
  'openDatabaseButton', 'saveConnectedDatabaseButton', 'exportDatabaseButton',
  'checkDatabaseButton', 'downloadApplicationHtmlButton',
  'databaseAutoSaveToggle', 'databaseCreateRecovery', 'databaseRestoreRecovery',
  'databaseInspectRecovery', 'databaseDeleteRecovery'
];
for (const id of ids) {
  assert.equal(ui.split('id="' + id + '"').length - 1, 1,
    'one existing DOM control for: ' + id);
}
assert(ui.includes('!info.dirty || !hasDirectConnection || busy'),
  'disable unnecessary direct-save action until a dirty file is writable');
const detail = ui.indexOf('Техническая информация: хранение и ревизии');
const technical = ui.indexOf('Рабочая SQLite (COMMIT)');
assert(detail >= 0 && technical > detail,
  'session revisions belong behind details, not the main status');
assert(ui.indexOf('Дополнительные действия и проверка целостности') <
       ui.indexOf('databaseHealthMarkup(info)'),
       'technical integrity checks remain available in collapsed details');
assert(ui.includes('Создать новую БД из стартовых данных HTML (дополнительно)'));
assert(!ui.includes('Порядок работы: откройте SQLite'));
assert(ui.indexOf('database-state-panel') < ui.indexOf('Дополнительные действия и проверка целостности'));
assert(ui.indexOf('database-state-panel') < ui.indexOf('Автосохранение и восстановление'));
assert(ui.indexOf('database-state-panel') < ui.indexOf('Создать новую БД из стартовых'));
assert(!ui.includes('Закрытие вкладки приведёт к потере этих изменений.'),
  'do not overstate recoverability after an unverified downloaded copy');
console.log('PASS PR6 SQLite storage guidance, priority actions and technical-detail separation');
