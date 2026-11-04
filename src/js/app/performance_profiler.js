// FILE CONTRACT: bounded, local-only performance measurements for PR 1.
// No Dataset records, filter values, file names or source content are captured.
(() => {
  'use strict';

  const MAX_EVENTS = 250;
  const MAX_METRICS = 100;
  const MAX_COUNTERS = 100;
  const events = [];
  const counters = new Map();
  const metrics = new Map();
  let enabled = false;
  let lastUsedJsHeapBytes = null;

  function clock() {
    return typeof performance !== 'undefined' && typeof performance.now === 'function'
      ? performance.now() : Date.now();
  }
  function safeName(value) {
    const name = String(value || '');
    return /^[a-zA-Z0-9_.-]{1,80}$/.test(name) ? name : null;
  }
  function start(name) {
    return enabled && safeName(name) ? clock() : null;
  }
  function record(name, durationMs) {
    const id = safeName(name);
    const ms = Number(durationMs);
    if (!enabled || !id || !Number.isFinite(ms) || ms < 0) return;
    if (!metrics.has(id) && metrics.size >= MAX_METRICS) return;
    const row = metrics.get(id) || { count: 0, totalMs: 0, minMs: Infinity, maxMs: 0 };
    row.count += 1;
    row.totalMs += ms;
    row.minMs = Math.min(row.minMs, ms);
    row.maxMs = Math.max(row.maxMs, ms);
    metrics.set(id, row);
    events.push({ name: id, durationMs: ms });
    if (events.length > MAX_EVENTS) events.shift();
  }
  function end(name, startedAt) {
    if (startedAt == null) return;
    record(name, Math.max(0, clock() - startedAt));
  }
  function measure(name, fn) {
    const startedAt = start(name);
    try { return fn(); }
    finally { end(name, startedAt); }
  }
  async function measureAsync(name, fn) {
    const startedAt = start(name);
    try { return await fn(); }
    finally { end(name, startedAt); }
  }
  function count(name, amount = 1) {
    const id = safeName(name);
    if (!enabled || !id || !Number.isFinite(amount) || amount <= 0) return;
    if (!counters.has(id) && counters.size >= MAX_COUNTERS) return;
    counters.set(id, (counters.get(id) || 0) + amount);
  }
  function snapshot() {
    const grouped = new Map();
    for (const entry of events) {
      if (!grouped.has(entry.name)) grouped.set(entry.name, []);
      grouped.get(entry.name).push(entry.durationMs);
    }
    const timings = Array.from(metrics.entries()).map(([name, row]) => {
      const samples = (grouped.get(name) || []).slice().sort((a, b) => a - b);
      return Object.freeze({
        name, count: row.count, totalMs: row.totalMs,
        avgMs: row.totalMs / row.count, minMs: row.minMs, maxMs: row.maxMs,
        recentP95Ms: samples.length ? samples[Math.ceil(samples.length * .95) - 1] : null
      });
    }).sort((a, b) => b.totalMs - a.totalMs);
    const perfMemory = enabled && typeof performance !== 'undefined' ? performance.memory : null;
    // A disabled profiler returns the last observed heap value, rather than
    // silently taking a fresh measurement after logging was stopped.
    if (enabled) {
      lastUsedJsHeapBytes = Number.isFinite(perfMemory?.usedJSHeapSize)
        ? perfMemory.usedJSHeapSize : null;
    }
    const usedJsHeapBytes = lastUsedJsHeapBytes;
    return Object.freeze({
      schemaVersion: 1, enabled, retainedEventCount: events.length,
      longTaskSupport: typeof PerformanceObserver !== 'undefined' &&
        Array.isArray(PerformanceObserver.supportedEntryTypes) &&
        PerformanceObserver.supportedEntryTypes.includes('longtask'),
      usedJsHeapBytes,
      timings: Object.freeze(timings),
      counters: Object.freeze(Object.fromEntries(counters))
    });
  }
  function reset() {
    events.length = 0;
    metrics.clear();
    counters.clear();
  }
  function setEnabled(value) { enabled = Boolean(value); }

  // Long Tasks include all main-thread activity, not just this application's code.
  try {
    if (typeof PerformanceObserver !== 'undefined' &&
        Array.isArray(PerformanceObserver.supportedEntryTypes) &&
        PerformanceObserver.supportedEntryTypes.includes('longtask')) {
      const observer = new PerformanceObserver(list => {
        for (const entry of list.getEntries()) record('main.longtask', entry.duration);
      });
      observer.observe({ type: 'longtask', buffered: true });
    }
  } catch (_) { /* Unsupported browsers continue without Long Task metrics. */ }

  const api = Object.freeze({
    version: '1.0.0', start, end, measure, measureAsync,
    record, count, snapshot, reset, setEnabled
  });
  globalThis.ReclassifierPerformanceProfiler = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
