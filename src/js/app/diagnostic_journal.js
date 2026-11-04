// Local-only, bounded and categorized runtime diagnostic journal.
// Does not persist records or settings; does not access Dataset contents.
(() => {
  'use strict';
  const CAPACITY = 300;
  const labels = Object.freeze({
    general: 'Общие события',
    import_export: 'Импорт и экспорт',
    runtime: 'Отказы рантайма',
    diagnostics: 'Расширенная диагностика',
    performance: 'Производительность'
  });
  const options = { general: false, import_export: false, runtime: false, diagnostics: false, performance: false };
  const events = [];
  const lastToggleAt = {};
  let droppedEvents = 0;
  const DIAGNOSTIC_SAMPLE_INTERVAL_MS = 30000;
  const DIAGNOSTIC_MAX_SAMPLES = 60;
  const memorySamples = [];
  let diagnosticTimer = null;
  let visibilityChanges = 0;
  let focusChanges = 0;
  let lastTabEvent = null;

  function normalizedCategory(value) {
    return Object.prototype.hasOwnProperty.call(labels, value) ? value : 'general';
  }
  function settings() { return Object.freeze({ ...options }); }
  function enabled(value) {
    const id = normalizedCategory(value);
    return options[id] === true;
  }
  function setEnabled(category, value) {
    if (!Object.prototype.hasOwnProperty.call(options, category)) return false;
    const next = value === true;
    if (options[category] === next) return true;
    options[category] = next;
    lastToggleAt[category] = new Date().toISOString();
    if (category === 'diagnostics') {
      if (next) startDiagnostics();
      else stopDiagnostics();
    }
    if (category === 'performance') {
      globalThis.ReclassifierPerformanceProfiler?.setEnabled?.(options.performance);
    }
    return true;
  }
  globalThis.ReclassifierPerformanceProfiler?.setEnabled?.(options.performance);
  function capture(message, level = 'INFO', category = 'general') {
    const id = normalizedCategory(category);
    if (!enabled(id)) return null;
    const now = new Date();
    const severity = ['DEBUG', 'INFO', 'WARN', 'ERROR'].includes(level) ? level : 'INFO';
    const text = String(message ?? '').slice(0, 1200);
    const event = Object.freeze({
      timestamp: now.toISOString(),
      category: id,
      level: severity,
      message: text,
      line: '[' + now.toLocaleTimeString('ru-RU') + '] [' + severity + '] [' +
        labels[id] + '] ' + text
    });
    events.push(event);
    if (events.length > CAPACITY) {
      events.shift();
      droppedEvents += 1;
    }
    return event;
  }
  function entries() {
    return events.map(({ timestamp, level, category, message }) =>
      ({ timestamp, level, category, message }));
  }
  function lines() { return events.map(event => event.line); }
  // Read-only, case-insensitive view. Filters never remove recorded events.
  function select(criteria = {}) {
    const category = String(criteria.category || 'all');
    const level = String(criteria.level || 'all');
    const query = String(criteria.query || '').trim().slice(0, 120).toLocaleLowerCase('ru-RU');
    return events.filter(event =>
      (category === 'all' || event.category === category) &&
      (level === 'all' || event.level === level) &&
      (!query || event.message.toLocaleLowerCase('ru-RU').includes(query))
    ).map(event => event.line);
  }
  // Read-only interpretation of retained DBOP markers, not a database audit.
  // A missing START can be caused by the bounded journal or disabled capture.
  function operationSummary() {
    const byId = new Map();
    const marker = /^\[DBOP-(\d+)\] ([A-Z_]+) · Dataset ([A-Za-z0-9_.-]{1,70})$/;
    for (const [index, event] of events.entries()) {
      if (event.category !== 'import_export') continue;
      const parsed = event.message.match(marker);
      if (!parsed) continue;
      const id = 'DBOP-' + parsed[1];
      const phase = parsed[2];
      if (!byId.has(id)) byId.set(id, {
        id, dataset: parsed[3], phases: [], firstAt: event.timestamp,
        lastAt: event.timestamp, lastIndex: index, lastPhase: '',
        hasStart: false, synchronizationWarning: false
      });
      const op = byId.get(id);
      op.phases.push(phase);
      op.lastPhase = phase;
      op.lastAt = event.timestamp;
      op.lastIndex = index;
      if (phase === 'PREPARE_STARTED') op.hasStart = true;
      if (phase === 'RUNTIME_SYNC_FAILED') op.synchronizationWarning = true;
    }
    function classify(op) {
      const phases = op.phases;
      if (phases.includes('COMMIT_APPLIED') || phases.includes('BATCH_COMMIT_APPLIED')) {
        return op.synchronizationWarning ? 'applied_sync_warning' : 'applied';
      }
      if (phases.includes('COMMIT_ROLLED_BACK')) return 'rolled_back';
      if (phases.includes('COMMIT_FAILED') || phases.includes('BATCH_COMMIT_FAILED') ||
          phases.includes('PREPARE_FAILED')) return 'failed';
      if (phases.includes('PREPARE_REJECTED')) return 'rejected';
      if (phases.includes('PREPARE_SUPERSEDED')) return 'superseded';
      if (phases.includes('COMMIT_STARTED') || phases.includes('BATCH_COMMIT_STARTED')) return 'committing';
      if (phases.includes('PREPARE_READY')) return 'awaiting_confirmation';
      if (phases.includes('PREPARE_STARTED')) return 'preparing';
      return 'unknown';
    }
    const operations = [...byId.values()]
      .sort((a, b) => b.lastIndex - a.lastIndex)
      .map(op => ({
        id: op.id, dataset: op.dataset, status: classify(op),
        lastPhase: op.lastPhase, firstAt: op.firstAt, lastAt: op.lastAt,
        hasStart: op.hasStart, eventCount: op.phases.length,
        phases: [...op.phases]
      }));
    const counts = {};
    for (const op of operations) counts[op.status] = (counts[op.status] || 0) + 1;
    return {
      retainedEvents: events.length,
      droppedEvents,
      captureEnabled: enabled('import_export'),
      completeHistoryGuaranteed: false,
      totalOperations: operations.length,
      counts,
      operations
    };
  }

  // Browser reports are limited to THIS page. No other tabs, OS RAM or
  // corporate Dataset fields are inspected. Missing browser APIs remain null.
  function finiteNonnegative(value) {
    return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
  }
  function tabState() {
    const doc = typeof document !== 'undefined' ? document : null;
    let focused = null;
    try { if (typeof doc?.hasFocus === 'function') focused = Boolean(doc.hasFocus()); }
    catch (_) { /* Some sandboxed browsers refuse focus queries. */ }
    return {
      visibility: typeof doc?.visibilityState === 'string' ? doc.visibilityState : 'unavailable',
      focused, visibilityChanges, focusChanges, lastEvent: lastTabEvent
    };
  }
  function readMemory() {
    const heap = globalThis.performance?.memory;
    const used = finiteNonnegative(heap?.usedJSHeapSize);
    const total = finiteNonnegative(heap?.totalJSHeapSize);
    const limit = finiteNonnegative(heap?.jsHeapSizeLimit);
    const deviceMemoryGB = finiteNonnegative(globalThis.navigator?.deviceMemory);
    return {
      source: used !== null ? 'performance.memory (non-standard estimate)' : 'unavailable',
      usedJsHeapBytes: used,
      allocatedJsHeapBytes: total,
      jsHeapLimitBytes: limit,
      deviceMemoryGB,
      // deviceMemory is rounded hardware RAM; never present it as actual tab use.
      supported: used !== null
    };
  }
  function sampleDiagnostics(reason = 'interval') {
    if (!enabled('diagnostics')) return null;
    const item = {timestamp: new Date().toISOString(), reason,
      memory: readMemory(), tab: tabState()};
    memorySamples.push(item);
    if (memorySamples.length > DIAGNOSTIC_MAX_SAMPLES) memorySamples.shift();
    const mem = item.memory;
    const label = mem.supported
      ? 'heap JS ' + Math.round(mem.usedJsHeapBytes / 1048576) + ' MiB'
      : 'heap JS недоступен';
    capture('Монитор вкладки: ' + label + ', видимость ' + item.tab.visibility +
      ', причина ' + reason + '.', 'DEBUG', 'diagnostics');
    // Repaint only the journal list and metrics, without shifting search focus.
    try { globalThis.ReclassifierJournalMonitorRefresh?.(); } catch (_) {}
    return item;
  }
  function startDiagnostics() {
    // One immediate baseline, then low-frequency samples. No background
    // polling occurs while Extended Diagnostics is unchecked.
    sampleDiagnostics('enabled');
    if (diagnosticTimer === null && typeof globalThis.setInterval === 'function') {
      diagnosticTimer = globalThis.setInterval(() => sampleDiagnostics(), DIAGNOSTIC_SAMPLE_INTERVAL_MS);
      diagnosticTimer?.unref?.(); // Node smoke harness must not remain open.
    }
  }
  function stopDiagnostics() {
    if (diagnosticTimer !== null && typeof globalThis.clearInterval === 'function')
      globalThis.clearInterval(diagnosticTimer);
    diagnosticTimer = null;
  }
  function pageEvent(kind) {
    if (!enabled('diagnostics')) return;
    if (kind === 'visibilitychange') visibilityChanges += 1;
    if (kind === 'focus' || kind === 'blur') focusChanges += 1;
    lastTabEvent = {kind, timestamp: new Date().toISOString()};
    sampleDiagnostics(kind);
  }
  // Event delegation observes buttons and navigation only. Never log typed
  // values, form fields, page title, URLs, or arbitrary button text.
  function recordUiAction(event) {
    if (!enabled('general')) return;
    const control = event?.target?.closest?.('button,[data-route],select,input[type="checkbox"],input[type="file"]') || null;
    if (!control) return;
    const id = String(control.id || control.dataset?.route || '');
    if (id.startsWith('journalToggle_')) return; // Turning OFF must not add a last event.
    const safeId = /^[A-Za-z0-9_-]{1,65}$/.test(id) ? id : 'unnamed-control';
    capture('UI: действие ' + safeId, 'DEBUG', 'general');
  }
  try {
    if (typeof document !== 'undefined') {
      document.addEventListener?.('visibilitychange', () => pageEvent('visibilitychange'));
      document.addEventListener?.('click', recordUiAction, true);
      document.addEventListener?.('change', recordUiAction, true);
    }
    globalThis.addEventListener?.('focus', () => pageEvent('focus'));
    globalThis.addEventListener?.('blur', () => pageEvent('blur'));
  } catch (_) { /* Optional browser signals cannot prevent startup. */ }

  function diagnosticsReport() {
    const samples = memorySamples.map(item => ({
      timestamp: item.timestamp, reason: item.reason,
      memory: {...item.memory},
      tab: {...item.tab, lastEvent: item.tab.lastEvent ? {...item.tab.lastEvent} : null}
    }));
    const measured = samples.filter(item => item.memory.usedJsHeapBytes !== null);
    const first = measured[0]?.memory.usedJsHeapBytes ?? null;
    const last = measured.at(-1)?.memory.usedJsHeapBytes ?? null;
    const peak = measured.length
      ? Math.max(...measured.map(item => item.memory.usedJsHeapBytes))
      : null;
    return {
      captureEnabled: enabled('diagnostics'),
      sampleIntervalMs: DIAGNOSTIC_SAMPLE_INTERVAL_MS,
      retainedSampleLimit: DIAGNOSTIC_MAX_SAMPLES,
      sampleCount: samples.length,
      supportedMemorySamples: measured.length,
      memory: {
        source: measured.length ? 'performance.memory (non-standard estimate)' : 'unavailable',
        firstUsedJsHeapBytes: first,
        lastUsedJsHeapBytes: last,
        peakUsedJsHeapBytes: peak,
        deltaUsedJsHeapBytes: first === null || last === null ? null : last - first,
        deviceMemoryGB: samples.at(-1)?.memory.deviceMemoryGB ?? null,
        limitation: 'Heap JS — оценка браузера, не общая память вкладки или всех вкладок; рост не доказывает утечку.'
      },
      // When disabled, report only the last sampled tab state, not a live read.
      tab: enabled('diagnostics') ? tabState() : (samples.at(-1)?.tab || {
        visibility: 'unavailable', focused: null, visibilityChanges, focusChanges, lastEvent: null
      }),
      unavailable: ['Memory usage of other tabs', 'OS/process RAM per tab'],
      samples
    };
  }
  function exportCategorySnapshot(category, appVersion = 'dev') {
    if (!Object.prototype.hasOwnProperty.call(labels, category)) return null;
    const selected = events.filter(event => event.category === category)
      .map(({timestamp, level, category, message}) => ({timestamp, level, category, message}));
    const countsByLevel = {DEBUG: 0, INFO: 0, WARN: 0, ERROR: 0};
    for (const event of selected) countsByLevel[event.level] += 1;
    const snapshot = {
      schemaVersion: 1, application: 'Reclassifier',
      applicationVersion: String(appVersion || 'dev').slice(0, 80),
      exportedAt: new Date().toISOString(),
      category, categoryLabel: labels[category],
      captureEnabled: enabled(category),
      lastToggleAt: lastToggleAt[category] || null,
      capacity: CAPACITY,
      retainedEventCount: selected.length,
      droppedEventsAllCategories: droppedEvents,
      countsByLevel,
      events: selected,
      limitations: ['Events are limited to the most recent 300 messages across all categories.',
        'Logging is session-only; disabling a category stops new capture but retains previous messages.']
    };
    if (category === 'diagnostics') snapshot.diagnostics = diagnosticsReport();
    if (category === 'performance') {
      snapshot.performance = globalThis.ReclassifierPerformanceProfiler?.snapshot?.() || null;
    }
    if (category === 'import_export') snapshot.operationSummary = operationSummary();
    return snapshot;
  }

  function clear() { events.length = 0; droppedEvents = 0; memorySamples.length = 0; visibilityChanges = 0; focusChanges = 0; lastTabEvent = null; }
  function exportSnapshot(appVersion = 'dev') {
    return {
      schemaVersion: 1,
      application: 'Reclassifier',
      applicationVersion: String(appVersion || 'dev').slice(0, 80),
      exportedAt: new Date().toISOString(),
      retainedEventCount: events.length,
      capacity: CAPACITY,
      settings: settings(),
      events: entries(),
      operationSummary: operationSummary()
    };
  }
  const api = Object.freeze({
    version: '1.0.0', capacity: CAPACITY, labels,
    settings, enabled, setEnabled, capture, entries, lines, select, operationSummary,
    diagnosticsReport, sampleDiagnostics, exportCategorySnapshot, clear, exportSnapshot
  });
  globalThis.ReclassifierDiagnosticJournal = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
