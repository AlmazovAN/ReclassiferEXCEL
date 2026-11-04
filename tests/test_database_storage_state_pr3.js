// PR-3: status presentation must not confuse browser COMMIT/copy with disk save.
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('src/js/app/database_ui_state.js', 'utf8');
const begin = source.indexOf('function databaseStatusBadge(info) {');
const end = source.indexOf('function databaseNextPaint()', begin);
assert(begin >= 0 && end > begin, 'storage status helpers are defined');
const sandbox = { Number, databaseFormatTimestamp: value => String(value), databaseWorkspaceState: {} };
vm.createContext(sandbox);
vm.runInContext(source.slice(begin, end) +
  '\nthis.storageHelpers = { databaseStatusBadge, databaseWorkingStorageText, ' +
  'databaseFileSaveText, databaseDownloadCopyText };', sandbox);
const h = sandbox.storageHelpers;
const link = { databaseUuid: 'db-1' };

const pristine = {
  valid: true, dirty: false, databaseUuid: 'db-1',
  storage: { workingRevision: 0, confirmedFileRevision: null,
    confirmedFileAt: null, downloadRequestedRevision: null, diskCurrent: false }
};
assert.match(h.databaseStatusBadge(pristine), /Подключена/);
assert.doesNotMatch(h.databaseStatusBadge(pristine), /Сохранено в подключённый файл/);
assert.match(h.databaseFileSaveText(pristine, link), /ещё не подтверждалась/);
assert.match(h.databaseDownloadCopyText(pristine), /не запрашивалось/);

const verified = {
  ...pristine, storage: { ...pristine.storage, workingRevision: 2,
    confirmedFileRevision: 2, confirmedFileAt: '2026-10-15T12:00:00Z', diskCurrent: true }
};
assert.match(h.databaseStatusBadge(verified), /Сохранено в подключённый файл/);
assert.match(h.databaseFileSaveText(verified, link), /ревизия 2/);

const modified = {
  ...verified, dirty: true, storage: { ...verified.storage, workingRevision: 3,
    diskCurrent: false, downloadRequestedRevision: 3,
    downloadRequestedAt: '2026-10-15T12:30:00Z' }
};
assert.match(h.databaseStatusBadge(modified), /Изменения только в браузере/);
assert.match(h.databaseWorkingStorageText(modified), /исходный файл не обновлён/);
assert.match(h.databaseFileSaveText(modified, link), /более новые изменения/);
assert.match(h.databaseDownloadCopyText(modified), /сохранение браузером на диск не проверено/);
assert.match(h.databaseFileSaveText(modified, null), /Прямая запись недоступна/);
assert(!source.includes('fileConnection?.savedAt'), 'no competing savedAt badge');

const ui = fs.readFileSync('src/js/app/database_ui.js', 'utf8');
for (const text of ['Рабочая SQLite (COMMIT)', 'Отдельная копия SQLite',
  'Сохранение в исходный файл', 'databaseWorkingStorageText(info)',
  'databaseFileSaveText(info, fileConnection)', 'databaseDownloadCopyText(info)']) {
  assert(ui.includes(text), 'missing storage status row: ' + text);
}
console.log('PASS PR-3 working/disk/copy status and honest download wording');
