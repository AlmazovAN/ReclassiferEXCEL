const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const journalSource = fs.readFileSync(path.join(root, 'src/js/app/diagnostic_journal.js'), 'utf8');
const systemSource = fs.readFileSync(path.join(root, 'src/js/app/system.js'), 'utf8');

const nodes = new Map();
const created = [];
const appended = [];
let copied = null;
let lastBlob = null;
let lastUrlRevoked = false;
let title = null;

function node(id) {
  if (!nodes.has(id)) nodes.set(id, {
    id,
    dataset: { journalToggle: id.replace(/^journalToggle_/, '') },
    listeners: {},
    style: {},
    addEventListener(type, handler) { this.listeners[type] = handler; },
    click() { this.clicked = true; },
    select() { this.selected = true; },
    remove() { this.removed = true; }
  });
  return nodes.get(id);
}

const pageContent = {
  innerHTML: '',
  querySelectorAll(selector) {
    if (selector !== '[data-journal-toggle]') return [];
    return ['import_export', 'runtime', 'diagnostics', 'performance']
      .map(id => node('journalToggle_' + id));
  }
};

const environment = {
  build: { version: 'test-PR04' },
  state: { log: [], route: 'log' },
  el: { pageContent },
  escapeHtml: value => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;'),
  formatBytes: value => String(value),
  setHeader: (_group, value) => { title = value; },
  document: {
    getElementById: node,
    createElement(tag) {
      const element = node('created-' + created.length);
      element.tagName = tag;
      created.push(element);
      return element;
    },
    execCommand: command => command === 'copy',
    body: { appendChild(element) { appended.push(element); } }
  },
  navigator: { clipboard: { writeText: async text => { copied = text; } } },
  Blob: class {
    constructor(parts, options) { this.parts = parts; this.type = options.type; lastBlob = this; }
  },
  URL: {
    createObjectURL: () => 'blob:journal-test',
    revokeObjectURL: () => { lastUrlRevoked = true; }
  },
  setTimeout: callback => callback(),
  ReclassifierPerformanceProfiler: {
    snapshot: () => ({ enabled: true, timings: [], counters: {} }),
    setEnabled() {},
    reset() {}
  }
};
environment.globalThis = environment;

const run = new Function(...Object.keys(environment),
  journalSource + '\n' + systemSource +
  '\nreturn {renderLog, copyDiagnosticJournal, downloadDiagnosticJournalJson};');
const ui = run(...Object.values(environment));
const journal = environment.ReclassifierDiagnosticJournal;
journal.setEnabled('import_export', true);

(async () => {
  journal.capture('Local import failed', 'ERROR', 'import_export');
  ui.renderLog();
  assert.equal(title, 'Журнал');
  assert.match(pageContent.innerHTML, /id="copyLogButton"/);
  assert.match(pageContent.innerHTML, /id="downloadLogJsonButton"/);
  assert.equal(typeof node('copyLogButton').listeners.click, 'function');
  assert.equal(typeof node('downloadLogJsonButton').listeners.click, 'function');

  assert.equal(await ui.copyDiagnosticJournal(), true);
  assert.match(copied, /Local import failed/);
  assert.match(node('journalActionStatus').textContent, /скопирован/);

  assert.equal(ui.downloadDiagnosticJournalJson(), true);
  assert.equal(lastBlob.type, 'application/json;charset=utf-8');
  const data = JSON.parse(lastBlob.parts[0]);
  assert.equal(data.applicationVersion, 'test-PR04');
  assert.equal(data.schemaVersion, 1);
  assert.equal(data.events.length, 1);
  assert.equal(data.events[0].category, 'import_export');
  assert.equal(data.events[0].level, 'ERROR');
  assert.equal(data.events[0].message, 'Local import failed');
  assert.ok(appended.some(link => link.download === 'Reclassifier_Journal.json'));
  assert.equal(lastUrlRevoked, true);

  // Async Clipboard may be unavailable in local file:// browser contexts.
  environment.navigator.clipboard = null;
  assert.equal(await ui.copyDiagnosticJournal(), true);
  assert.ok(created.some(item => item.tagName === 'textarea' && item.selected && item.removed));

  environment.navigator.clipboard = { writeText: async () => { throw Error('permission denied'); } };
  assert.equal(await ui.copyDiagnosticJournal(), false);
  assert.match(node('journalActionStatus').textContent, /permission denied/);

  journal.clear();
  ui.renderLog();
  assert.equal(await ui.copyDiagnosticJournal(), false);
  assert.match(node('journalActionStatus').textContent, /пуст/);

  journal.capture('Temporary event');
  ui.renderLog();
  node('clearLogButton').listeners.click();
  assert.deepEqual(journal.entries(), []);
  assert.match(pageContent.innerHTML, /Журнал пока пуст/);

  console.log('PR-04 journal copy, JSON export, fallback, errors and clear: OK');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
