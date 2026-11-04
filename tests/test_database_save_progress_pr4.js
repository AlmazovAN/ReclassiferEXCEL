// PR-4: progress must reflect OS write and readback, not imply early success.
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('src/js/app/database_connection_ui.js', 'utf8');
const start = source.indexOf('  function databaseSaveProgressText(progress) {');
const end = source.indexOf('  async function databaseSaveConnected(', start);
assert(start >= 0 && end > start, 'progress functions must be present');
const field = { textContent: '' };
const workspace = { saveProgress: null };
const ctx = {
  Number, Math,
  formatBytes: n => n + ' B',
  databaseWorkspaceState: workspace,
  document: { getElementById: () => field }
};
vm.createContext(ctx);
vm.runInContext(source.slice(start, end) +
  '\nthis.status = databaseSaveProgressText; this.update = databaseUpdateSaveProgress;', ctx);
assert.match(ctx.status({phase:'permission'}), /разрешения/);
assert.match(ctx.status({phase:'exporting'}), /Подготовка SQLite/);
assert.match(ctx.status({phase:'writing',completedBytes:50,totalBytes:100}), /50%/);
assert.match(ctx.status({phase:'verifying',completedBytes:100,totalBytes:100}), /Побайтовая проверка/);
ctx.update({phase:'verifying',completedBytes:4,totalBytes:8});
assert.match(field.textContent, /50%/);
assert.equal(workspace.saveProgress.phase, 'verifying');
assert.match(ctx.status({phase:'complete'}), /завершены/);
const ui = fs.readFileSync('src/js/app/database_ui.js', 'utf8');
assert(ui.includes('id="databaseSaveProgress"'));
assert(ui.includes('databaseSaveProgressText(databaseWorkspaceState.saveProgress)'));
assert(source.includes('onProgress: databaseUpdateSaveProgress'));
assert(!source.slice(start,end).includes('getDatabaseRepository()'),
  'progress callbacks must not read repository while mutex is held');
console.log('PASS PR4 save progress display and repository isolation');
