const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const journalSource = fs.readFileSync(path.join(root, 'src/js/app/diagnostic_journal.js'), 'utf8');
const systemSource = fs.readFileSync(path.join(root, 'src/js/app/system.js'), 'utf8');
const coreSource = fs.readFileSync(path.join(root, 'src/js/app/core.js'), 'utf8');
assert.ok(coreSource.includes("if (state.route === 'log') refreshJournalVisibleRows();"));

const nodes = new Map();
let copied = null;
let lastBlob = null;
const appended = [];
function node(id) {
  if (!nodes.has(id)) nodes.set(id, {
    id, textContent: '', dataset: {journalToggle: id.replace(/^journalToggle_/, '')},
    listeners: {}, style: {},
    addEventListener(type, handler) { this.listeners[type] = handler; },
    click() { this.clicked = true; }, remove() {},
    select() {}
  });
  return nodes.get(id);
}
const pageContent = {
  innerHTML: '',
  querySelectorAll(selector) {
    if (selector === '[data-journal-toggle]') {
      return ['import_export', 'runtime', 'diagnostics', 'performance']
        .map(name => node('journalToggle_' + name));
    }
    return [];
  }
};
const environment = {
  build: {version: 'test-PR05'},
  state: {log: [], route: 'log'},
  el: {pageContent},
  formatBytes: value => String(value),
  escapeHtml: value => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;'),
  setHeader() {},
  document: {
    getElementById: node,
    createElement() { return {style:{},click(){},remove(){},select(){}}; },
    execCommand: () => true,
    body: {appendChild(element) { appended.push(element); }}
  },
  navigator: {clipboard: {writeText: async text => { copied = text; }}},
  Blob: class {constructor(parts, options){this.parts=parts;this.type=options.type;lastBlob=this;}},
  URL: {createObjectURL: () => 'blob:test', revokeObjectURL(){}},
  setTimeout: callback => callback(),
  ReclassifierPerformanceProfiler: {snapshot:()=>({timings:[],counters:{},enabled:true}),reset(){},setEnabled(){}}
};
environment.globalThis = environment;
const compile = new Function(...Object.keys(environment),
  journalSource + '\n' + systemSource +
  '\nreturn {renderLog, refreshJournalVisibleRows, copyDiagnosticJournal, downloadDiagnosticJournalJson};');
const ui = compile(...Object.values(environment));
const journal = environment.ReclassifierDiagnosticJournal;
journal.setEnabled('import_export', true);
journal.setEnabled('runtime', true);
journal.setEnabled('general', true);

(async () => {
  journal.capture('Broken Excel export', 'ERROR', 'import_export');
  journal.capture('WebWorker failed', 'ERROR', 'runtime');
  journal.capture('Background ready', 'INFO', 'general');
  ui.renderLog();

  assert.match(pageContent.innerHTML, /id="journalSearchInput"/);
  assert.match(pageContent.innerHTML, /id="journalCategoryFilter"/);
  assert.match(pageContent.innerHTML, /id="journalLevelFilter"/);
  assert.match(pageContent.innerHTML, /Показано 3 из 3/);
  assert.equal(typeof node('journalResetFiltersButton').listeners.click, 'function');

  node('journalLevelFilter').listeners.change({target:{value:'ERROR'}});
  assert.equal(node('journalVisibleCount').textContent, 'Показано 2 из 3');

  node('journalCategoryFilter').listeners.change({target:{value:'runtime'}});
  assert.equal(node('journalVisibleCount').textContent, 'Показано 1 из 3');
  assert.match(node('journalEntries').textContent, /WebWorker failed/);
  assert.doesNotMatch(node('journalEntries').textContent, /Broken Excel/);

  node('journalSearchInput').listeners.input({target:{value:'WORKER'}});
  assert.equal(node('journalVisibleCount').textContent, 'Показано 1 из 3');
  assert.match(node('journalEntries').textContent, /WebWorker failed/);

  node('journalSearchInput').listeners.input({target:{value:'nothing matched'}});
  assert.equal(node('journalVisibleCount').textContent, 'Показано 0 из 3');
  assert.equal(node('journalEntries').textContent, 'По фильтру ничего не найдено.');

  // Rendering while a filter is active keeps its state and does not delete any event.
  journal.capture('Second WebWorker failed', 'ERROR', 'runtime');
  ui.refreshJournalVisibleRows();
  assert.equal(node('journalVisibleCount').textContent, 'Показано 0 из 4');
  assert.equal(journal.entries().length, 4);

  // Copy and JSON export remain complete even when only a subset is visible.
  assert.equal(await ui.copyDiagnosticJournal(), true);
  assert.match(copied, /Broken Excel export/);
  assert.match(copied, /Second WebWorker failed/);
  assert.equal(ui.downloadDiagnosticJournalJson(), true);
  const exported = JSON.parse(lastBlob.parts[0]);
  assert.equal(exported.events.length, 4);
  assert.ok(appended.some(link => link.download === 'Reclassifier_Journal.json'));

  node('journalResetFiltersButton').listeners.click();
  assert.match(pageContent.innerHTML, /Показано 4 из 4/);
  assert.equal(journal.select().length, 4);

  journal.clear();
  ui.renderLog();
  assert.match(pageContent.innerHTML, /Журнал пока пуст/);
  assert.match(pageContent.innerHTML, /Показано 0 из 0/);

  console.log('PR-05 journal filters, live view and full export: OK');
})().catch(error => { console.error(error); process.exitCode = 1; });
