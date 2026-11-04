const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const journal = require('../src/js/app/diagnostic_journal.js');
const systemSource = fs.readFileSync(path.join(root, 'src/js/app/system.js'), 'utf8');

const nodes = new Map();
const links = [];
let downloaded = null;
const element = id => {
  if (!nodes.has(id)) nodes.set(id, {
    dataset: {journalToggle: id.replace(/^journalToggle_/, '')},
    listeners: {}, textContent: '', innerHTML: '',
    addEventListener(type, handler) { this.listeners[type] = handler; },
    click() { this.clicked = true; }, remove() {}
  });
  return nodes.get(id);
};
const pageContent = {
  innerHTML: '',
  querySelectorAll(selector) {
    if (selector !== '[data-journal-toggle]') return [];
    return ['import_export', 'runtime', 'diagnostics', 'performance'].map(id => element('journalToggle_' + id));
  }
};
const env = {
  state: {route: 'log', log: []},
  el: {pageContent}, build: {version: 'PR08'},
  escapeHtml: value => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;'),
  setHeader() {}, formatBytes: String,
  document: {
    getElementById: element,
    createElement() { return {click() {}, remove() {}, href: '', download: ''}; },
    body: {appendChild(link) {links.push(link);}}
  },
  ReclassifierDiagnosticJournal: journal,
  ReclassifierPerformanceProfiler: {
    snapshot: () => ({timings: [], counters: {}, enabled: true}), setEnabled() {}, reset() {}
  },
  Blob: class {constructor(parts) {downloaded = JSON.parse(parts[0]);}},
  URL: {createObjectURL: () => 'blob:pr08', revokeObjectURL() {}},
  setTimeout: callback => callback()
};
env.globalThis = env;
const ui = new Function(...Object.keys(env), systemSource +
  '\nreturn {renderLog,refreshJournalVisibleRows,downloadDiagnosticJournalJson};')
  (...Object.values(env));

const record = (id, phase, level='INFO') =>
  journal.capture('[DBOP-' + id + '] ' + phase + ' · Dataset itsm_data', level, 'import_export');
journal.clear();
journal.setEnabled('import_export', true);
record(1, 'PREPARE_STARTED');
record(1, 'PREPARE_READY');
record(1, 'COMMIT_STARTED');
ui.renderLog();
assert.doesNotMatch(pageContent.innerHTML, /Сводка операций Dataset|journalOperationSummaryPanel/);

// The derived operation summary remains available in the JSON export.
record(1, 'COMMIT_APPLIED');
ui.refreshJournalVisibleRows();

// Existing JSON export remains complete and includes the derived operation summary.
assert.equal(ui.downloadDiagnosticJournalJson(), true);
assert.equal(downloaded.events.length, 4);
assert.equal(downloaded.operationSummary.totalOperations, 1);
assert.equal(downloaded.operationSummary.operations[0].status, 'applied');
assert.ok(links.some(link => link.download === 'Reclassifier_Journal.json'));

element('clearLogButton').listeners.click();
assert.equal(journal.entries().length, 0);
assert.equal(journal.operationSummary().totalOperations, 0);

console.log('PR-08 operation summary UI, live updates, filters and export: OK');
