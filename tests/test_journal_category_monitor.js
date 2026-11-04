const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../src/js/app/diagnostic_journal.js'), 'utf8');
const listeners = {};
const intervals = new Map();
let nextTimer = 0;
const profilerSettings = [];
const context = {
  navigator: {deviceMemory: 8},
  performance: {memory: {usedJSHeapSize: 104857600, totalJSHeapSize: 209715200, jsHeapSizeLimit: 524288000}},
  document: {
    visibilityState: 'visible',
    hasFocus: () => true,
    addEventListener: (name, fn) => {listeners[name] = fn;}
  },
  addEventListener: (name, fn) => {listeners[name] = fn;},
  setInterval: (fn, delay) => {
    assert.equal(delay, 30000);
    const handle = ++nextTimer;
    intervals.set(handle, fn);
    return handle;
  },
  clearInterval: handle => intervals.delete(handle),
  ReclassifierPerformanceProfiler: {setEnabled(value) {profilerSettings.push(value);},
    snapshot() {return {enabled: profilerSettings.at(-1) ?? true, timings: [{name:'mock',count:3}], counters:{mock:4}};}}
};
context.globalThis = context;
vm.runInNewContext(source, vm.createContext(context));
const journal = context.ReclassifierDiagnosticJournal;

const capture = (message, category='general', level='INFO') => journal.capture(message, level, category);
assert.deepEqual(Object.keys(journal.settings()).sort(),
  ['general', 'import_export', 'runtime', 'diagnostics', 'performance'].sort());
assert.deepEqual({...journal.settings()}, {
  general: false, import_export: false, runtime: false, diagnostics: false, performance: false
});
for (const category of Object.keys(journal.settings()))
  assert.equal(capture('disabled by default', category), null, category);
assert.equal(journal.diagnosticsReport().sampleCount, 0);
assert.equal(intervals.size, 0);

for (const category of ['general','import_export','runtime','performance']) {
  journal.clear();
  journal.setEnabled(category, true);
  assert.ok(capture('before-off', category));
  assert.equal(journal.setEnabled(category, false), true);
  const count = journal.entries().length;
  assert.equal(capture('should not be recorded', category), null, category);
  assert.equal(journal.entries().length, count, 'unchecking immediately stops '+category);
  assert.equal(journal.exportCategorySnapshot(category, '0.37.0').retainedEventCount, 1);
  assert.equal(journal.exportCategorySnapshot(category).captureEnabled, false);
  assert.equal(journal.setEnabled(category, true), true);
  assert.ok(capture('after-on', category));
  assert.equal(journal.exportCategorySnapshot(category).retainedEventCount, 2);
}
assert.deepEqual(profilerSettings, [false, true, false, true]);

// The General category also records safe UI action identifiers without field values.
journal.clear();
listeners.click({target:{closest: () => ({id:'processMobileBrigadeButton'})}});
assert.match(journal.entries()[0].message, /processMobileBrigadeButton/);
journal.setEnabled('general', false);
listeners.click({target:{closest: () => ({id:'secret-user-typed-text'})}});
assert.equal(journal.entries().length, 1);
journal.setEnabled('general', true);
listeners.click({target:{closest: () => ({id:'unexpected/secret?text'})}});
assert.match(journal.entries().at(-1).message, /unnamed-control/);
assert.doesNotMatch(journal.entries().at(-1).message, /secret/);

journal.clear();
assert.equal(journal.setEnabled('diagnostics', true), true);
assert.equal(intervals.size, 1);
assert.equal(journal.diagnosticsReport().sampleCount, 1);
assert.equal(journal.diagnosticsReport().memory.firstUsedJsHeapBytes, 104857600);
assert.equal(journal.diagnosticsReport().memory.source, 'performance.memory (non-standard estimate)');
context.performance.memory.usedJSHeapSize = 125829120;
for (const sample of intervals.values()) sample();
const diag = journal.diagnosticsReport();
assert.equal(diag.sampleCount, 2);
assert.equal(diag.memory.lastUsedJsHeapBytes, 125829120);
assert.equal(diag.memory.deltaUsedJsHeapBytes, 20971520);
assert.equal(diag.memory.peakUsedJsHeapBytes, 125829120);
assert.equal(diag.tab.visibility, 'visible');
assert.equal(diag.memory.deviceMemoryGB, 8);

context.document.visibilityState = 'hidden';
listeners.visibilitychange();
assert.equal(journal.diagnosticsReport().tab.visibilityChanges, 1);
assert.equal(journal.diagnosticsReport().samples.at(-1).reason, 'visibilitychange');
listeners.blur();
assert.equal(journal.diagnosticsReport().tab.focusChanges, 1);
assert.equal(journal.diagnosticsReport().sampleCount, 4);
assert.equal(journal.setEnabled('diagnostics', false), true);
assert.equal(intervals.size, 0);
const countAfter = journal.entries().length;
const samplesAfter = journal.diagnosticsReport().sampleCount;
listeners.focus();
listeners.visibilitychange();
assert.equal(journal.sampleDiagnostics('manual'), null);
assert.equal(journal.entries().length, countAfter);
assert.equal(journal.diagnosticsReport().sampleCount, samplesAfter);
assert.equal(journal.diagnosticsReport().captureEnabled, false);
assert.equal(journal.exportCategorySnapshot('diagnostics', '0.37.0').diagnostics.sampleCount, 4);
assert.ok(journal.exportCategorySnapshot('diagnostics').events.every(e => e.category === 'diagnostics'));
assert.equal(journal.exportCategorySnapshot('performance').performance.timings[0].name, 'mock');
assert.equal(journal.exportCategorySnapshot('import_export').operationSummary.totalOperations, 0);

// When memory data is not available, never invent a number.
journal.clear();
delete context.performance.memory;
journal.setEnabled('diagnostics', true);
const unavailable = journal.diagnosticsReport();
assert.equal(unavailable.supportedMemorySamples, 0);
assert.equal(unavailable.memory.firstUsedJsHeapBytes, null);
assert.equal(unavailable.memory.source, 'unavailable');
assert.equal(unavailable.memory.deltaUsedJsHeapBytes, null);
assert.equal(unavailable.tab.visibility, 'hidden');
journal.setEnabled('diagnostics', false);
journal.clear();
assert.equal(journal.diagnosticsReport().sampleCount, 0);
console.log('PR-09 category toggles, JSON subsets, JS heap, tab events and immediate stop: OK');
