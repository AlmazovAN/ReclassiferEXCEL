const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../src/js/app/performance_profiler.js'), 'utf8');
const state = {
  reads: 0,
  memoryValue: 200,
  now: 100
};
const perf = {now: () => ++state.now};
Object.defineProperty(perf, 'memory', {
  get() {
    state.reads += 1;
    return {usedJSHeapSize: state.memoryValue};
  }
});
const globals = {performance: perf, PerformanceObserver: undefined};
globals.globalThis = globals;
vm.runInNewContext(source, vm.createContext(globals));
const profiler = globals.ReclassifierPerformanceProfiler;
profiler.record('sqlite.commit', 10);
profiler.count('sqlite.commit');
assert.equal(profiler.snapshot().usedJsHeapBytes, 200);
assert.equal(state.reads, 1);
assert.equal(profiler.snapshot().timings[0].count, 1);
profiler.setEnabled(false);
state.memoryValue = 900;
profiler.record('sqlite.commit', 40);
profiler.count('sqlite.commit');
const before = state.reads;
const paused = profiler.snapshot();
assert.equal(state.reads, before, 'paused snapshot must not read live memory');
assert.equal(paused.usedJsHeapBytes, 200);
assert.equal(paused.enabled, false);
assert.equal(paused.timings[0].count, 1);
assert.equal(paused.counters['sqlite.commit'], 1);
profiler.setEnabled(true);
assert.equal(profiler.snapshot().usedJsHeapBytes, 900);
assert.equal(state.reads, before + 1);
profiler.record('sqlite.commit', 20);
assert.equal(profiler.snapshot().timings[0].count, 2);
console.log('PR-09 profiler metrics and JS heap freeze immediately on disable: OK');
