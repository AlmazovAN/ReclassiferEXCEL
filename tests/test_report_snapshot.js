const assert = require('node:assert/strict');

require('../src/js/kpi/report_snapshot.js');

const api = globalThis.ReclassifierReportSnapshot;
assert.ok(api);
assert.equal(api.schemaVersion, '1.0.0');

const source = {
  status: 'ready',
  calculatedAt: '2026-10-08T06:00:00.000Z',
  preparationVersion: '1.0.0',
  calculatorVersion: '1.0.0',
  query: { period: { id: '2026-10', label: 'Окт 2026' } },
  filters: { periods: [{ id: '2026-10', label: 'Окт 2026' }] },
  results: {
    vbr: { id: 'vbr', value: 95, unit: '%', dataState: 'available' }
  },
  series: { monthly: [] },
  breakdowns: { labor: [] },
  sources: [{
    id: 'itsm_data',
    available: true,
    activeRevision: 7,
    contentHash: 'abc'
  }],
  diagnostics: { marker: 'test' }
};

const snapshot = api.create(source);
assert.equal(snapshot.type, 'reliability-report');
assert.equal(snapshot.status, 'ready');
assert.equal(snapshot.calculatedAt, '2026-10-08T06:00:00.000Z');
assert.equal(snapshot.results.vbr.value, 95);
assert.equal(snapshot.sources[0].activeRevision, 7);
assert.equal(snapshot.diagnostics.marker, 'test');
assert.equal(snapshot.kpiView, null, 'Legacy Snapshot callers must stay compatible without view model.');

assert(Object.isFrozen(snapshot));
assert(Object.isFrozen(snapshot.query));
assert(Object.isFrozen(snapshot.results));
assert(Object.isFrozen(snapshot.results.vbr));
assert(Object.isFrozen(snapshot.sources));
assert(Object.isFrozen(snapshot.sources[0]));

assert.throws(() => api.create({}), /requires calculatedAt/);

console.log('Report Snapshot immutable contract: OK');
