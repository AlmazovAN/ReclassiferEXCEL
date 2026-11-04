'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const p = require('../src/js/app/performance_profiler.js');

p.setEnabled(true);
p.reset();
p.record('snapshot.cold', 50);
p.record('snapshot.cold', 10);
p.count('calculator.batch');
p.count('calculator.batch', 2);
p.record('private/filter/value', 70); // invalid label must not be recorded
p.record('bad.nan', NaN);
p.record('bad.negative', -3);
assert.equal(p.measure('snapshot.warm', () => 42), 42);
assert.equal(awaitable(), true);
const v = p.snapshot();
const cold = v.timings.find(item => item.name === 'snapshot.cold');
assert.equal(cold.count, 2);
assert.equal(cold.totalMs, 60);
assert.equal(cold.minMs, 10);
assert.equal(cold.maxMs, 50);
assert.equal(cold.recentP95Ms, 50);
assert.equal(v.counters['calculator.batch'], 3);
assert(!v.timings.some(item => item.name.includes('private/')));
assert.equal(v.usedJsHeapBytes == null || v.usedJsHeapBytes >= 0, true);
assert.equal(typeof v.longTaskSupport, 'boolean');

function awaitable() { return typeof p.measureAsync === 'function'; }

const root = path.resolve(__dirname, '..');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');
assert(read('build/build.py').includes('"app/performance_profiler.js"'));
for (const [file, marker] of [
  ['src/js/app/reliability_report_service.js', "report.snapshot.total"],
  ['src/js/app/reliability_dashboard.js', "dashboard.render.total"],
  ['src/js/app/reliability_kpi_chart.js', "chart.ui.fetch"],
  ['src/js/app/kpi_passports.js', "passport.snapshot.fill"],
  ['src/js/app/reliability_pdf.js', "pdf.render.total"],
  ['src/js/app/runtime.js', "startup.hydrate.total"]
]) assert(read(file).includes(marker), 'Missing performance checkpoint: ' + file);

p.reset();
assert.equal(p.snapshot().timings.length, 0);
assert.equal(Object.keys(p.snapshot().counters).length, 0);
for (let i = 0; i < 500; i++) p.record('bounded.events', 1);
assert.equal(p.snapshot().retainedEventCount, 250);
p.setEnabled(false);
p.record('disabled', 10);
assert(!p.snapshot().timings.some(item => item.name === 'disabled'));
p.setEnabled(true);
console.log('PR1 performance profiler: bounded metrics, counters, privacy and integration markers OK');
