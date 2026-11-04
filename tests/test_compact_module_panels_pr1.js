const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const escaped = value => String(value ?? '')
  .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
const page = { innerHTML: '' };
const context = vm.createContext({
  escapeHtml: escaped,
  state: {
    baselineReady: true, processingModuleId: null, sourceFile: null, references: {}
  },
  moduleConfig: {
    itsm: { title: 'ITSM', description: 'Source data', references: [] }
  },
  referenceConfig: {},
  referenceStatusClass: () => 'valid',
  referenceStatusText: () => 'Готов',
  el: { pageContent: page },
  setHeader() {},
  bindDatasetDropzone() {},
  runModuleProbe() {},
  navigate() {},
  moduleRenderers: {},
  log() {},
  formatBytes: () => '1 МБ',
  document: {
    getElementById: () => ({ addEventListener() {} })
  },
  build: { version: '0.32.93' }
});
vm.runInContext(read('src/js/app/module_workspace.js'), context);
const status = context.ReclassifierModuleSourceStatus;
assert.ok(status);

// The end date in tasks_YYYY-MM-DD_YYYY-MM-DD (1) is the source freshness.
assert.equal(
  status.newestDateInFileName('tasks_2026-09-01_2026-10-13 (1).xlsx'),
  '2026-10-13'
);
assert.equal(status.formatDate('2026-10-13'), '13.10.2026');
assert.equal(status.newestDateInFileName('tasks_2026-02-30.xlsx'), null);
assert.equal(status.newestDateInFileName('export_without_dates.xlsx'), null);

assert.equal(status.latestSourceNameDate([
  { name: 'tasks_2026-09-01_2026-10-13 (1).xlsx' },
  { name: 'tasks_2026-08-01_2026-10-11.xlsx' }
]), '2026-10-13');
assert.equal(status.latestSourceNameDate([], {
  sourceFreshness: [{ fileName: 'tasks_2026-09-01_2026-10-13.xlsx' }]
}), '2026-10-13');
assert.equal(status.latestSourceNameDate([], {
  fileName: 'tasks_2026-09-01_2026-10-13.xlsx',
  sourceType: 'sqlite'
}), '2026-10-13');

// A date measured from records must not be misrepresented as filename freshness.
assert.equal(status.latestSourceNameDate([], {
  latestSourceDate: '2026-10-13',
  fileName: 'ITSM Sirius Data 2026-10-13'
}), null);
assert.equal(status.formatDate(null), '—');
assert.equal(status.formatRows(123456).replace(/[^0-9]/g, ''), '123456');
const html = status.compactCard('Контроль входных данных', [
  ['Свежесть исходников', '13.10.2026'],
  ['Строк в базе', status.formatRows(123456)],
  ['Попытка HTML', '<script>alert(1)</script>']
]);
assert.match(html, /module-compact-lines/);
assert.doesNotMatch(html, /<table|<script>/);
assert.match(html, /&lt;script&gt;/);

// Custom panels must not change the default panel of other modules.
context.renderModuleWorkspace('itsm', {
  sidePanelHtml: () => status.compactCard('Версия', [
    ['Обработчик', 'ITSM'],
    ['Версия обработчика', '1.2.0']
  ])
});
assert.match(page.innerHTML, /Версия обработчика/);
assert.doesNotMatch(page.innerHTML, /SheetJS \/ WebWorker|Приложение/);
context.renderModuleWorkspace('itsm');
assert.match(page.innerHTML, /Используемые справочники/);
assert.match(page.innerHTML, /0\.32\.93/);

// Both modules must consume the shared presenter and show their own processor version.
for (const file of [
  'src/js/modules/itsm/ui.js',
  'src/js/modules/mobile_brigade/ui.js'
]) {
  const source = read(file);
  assert.match(source, /ReclassifierModuleSourceStatus/);
  assert.doesNotMatch(source, /compactCard\('Контроль входных данных'/);
  assert.match(source, /datasetSummary\(/);
  assert.match(source, /Используемые справочники/);
  assert.match(source, /Описание алгоритма обработки/);
  assert.match(source, /Версия правил/);
  assert.doesNotMatch(source, /Версия обработчика/);
}
console.log('Compact ITSM / Mobile Brigade module panels: OK');
