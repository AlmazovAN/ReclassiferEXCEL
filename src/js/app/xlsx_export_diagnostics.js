// TEST_11_PR322: bounded read-only diagnostic journal for SQLite XLSX export.
// Contains only approved counters/timings; never original rows, filenames or record keys.
// On successful/failed completion, requests an automatic JSON download. For a renderer
// crash, the last synchronous localStorage checkpoint may remain on the same file:// origin.
(() => {
  'use strict';
  const STORAGE_KEY = 'reclassifier.xlsx.export-diagnostics.v1';
  const MAX_EVENTS = 320;
  const allowed = new Set([
    'sourceRows','fullRows','missingFullRows','undated','columns','rows',
    'batchNumber','batchRows','offset','scannedRows','matchedRows',
    'totalRows','totalCells','durationMs','waitMs','outputBytes',
    'longTextCells','overflowParts','inputBytes','mainJsHeapMiB',
    'workerJsHeapMiB','revision','jsonChars',
    'mainJsHeapCapacityMiB','mainJsHeapLimitMiB','hasMore',
    'databaseInputMiB','sqliteWasmCapacityMiB','rowCount',
    'cacheHits','cacheMisses','workerGeneration','pendingRequests',
    'selectedRows','fullDatasetRows','fullDatasetColumns','dateMatchedRows',
    'countedRows','queueItems','snapshotRows','activeJobs','validRows'
  ]);
  const buildLabel = () => globalThis.RECLASSIFIER_BUILD?.testLabel;
  const isTestBuild = () => ['TEST_11_PR322','TEST_12_PR322','TEST_13_PR322','TEST_14_PR322','TEST_15_PR324','TEST_16_PR326','TEST_17_PR332','TEST_18_PR335'].includes(buildLabel());
  const history = globalThis.ReclassifierDiagnosticHistory;
  const historyEnabled = () => ['TEST_13_PR322','TEST_14_PR322','TEST_15_PR324','TEST_16_PR326','TEST_17_PR332','TEST_18_PR335'].includes(buildLabel()) && !!history;
  const nowMs = () => Date.now();
  let retained = null;
  let persisted = false;
  let activeThisTab = false;
  function read() {
    try {
      if (typeof localStorage === 'undefined') return null;
      const value = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
      return value?.schemaVersion === 1 && value?.kind === 'xlsx-export' &&
        Array.isArray(value.events) ? value : null;
    } catch (_) { return null; }
  }
  retained = read();
  persisted = retained !== null;
  if(historyEnabled() && retained && !retained.sessionId) {
    retained.sessionId=history.newSessionId();
    const offset=retained.discardedEvents||0;
    (retained.events||[]).forEach((entry,i)=>
      history.append('xlsx',retained.sessionId,offset+i,entry,retained));
    retained.eventCount=offset+(retained.events?.length||0);
  }
  function persist() {
    try {
      if (typeof localStorage === 'undefined') throw new Error('No localStorage');
      localStorage.setItem(STORAGE_KEY, JSON.stringify(retained));
      persisted = true;
    } catch (_) { persisted = false; }
    updateStatus();
  }
  function updateStatus() {
    if (typeof document === 'undefined') return;
    const node = document.getElementById('sqliteMbDiagStatus');
    if (!node) return;
    const last = retained?.events?.[retained.events.length - 1];
    node.textContent = !retained
      ? 'Отчёта пока нет. TEST_11 автоматически запишет экспорт.'
      : 'Отчёт: ' + retained.status + ', событий в недавнем окне: ' + retained.events.length +
        (historyEnabled()?', архив: '+history.status().indexedDB:'') +
        ', последний этап: ' + (last ? last.phase + '/' + last.event : '—') +
        (persisted ? ', контрольные точки сохранены' :
          ', localStorage недоступен: после аварии журнал может пропасть');
    for (const id of ['sqliteMbDiagCopy','sqliteMbDiagDownload']) {
      const button = document.getElementById(id);
      if (button) button.disabled = !retained;
    }
  }
  function begin(info = {}) {
    if (!isTestBuild()) return false;
    activeThisTab = true;
    const start = nowMs();
    retained = {
      schemaVersion: 1, kind: 'xlsx-export', testLabel: buildLabel(),
      ...(historyEnabled() ? {sessionId:history.newSessionId(),eventCount:0} : {}),
      status: 'running', startedAt: new Date(start).toISOString(),
      startedEpochMs: start, lastStarted: null, lastCompleted: null,
      period: {
        from: /^\d{4}-\d{2}-\d{2}$/.test(info.from || '') ? info.from : null,
        to: /^\d{4}-\d{2}-\d{2}$/.test(info.to || '') ? info.to : null
      },
      mode: info.mode === 'analytical' ? 'analytical' : 'full',
      memoryScope: {
        mainJsHeapMiB: 'sampled performance.memory when provided; not process RSS',
        workerJsHeapMiB: 'sampled worker performance.memory when provided; not total worker RAM',
        sqliteWasmMiB: 'unavailable',
        rendererRssMiB: 'unavailable'
      },
      peakSampledMainJsHeapMiB: null, peakSampledWorkerJsHeapMiB: null,
      browserCapabilities: {
        fileProtocol: typeof location !== 'undefined' ? location.protocol === 'file:' : null,
        savePicker: typeof globalThis.showSaveFilePicker === 'function',
        crossOriginIsolated: globalThis.crossOriginIsolated === true,
        deviceMemoryGiB: Number.isFinite(navigator?.deviceMemory) ? navigator.deviceMemory : null
      },
      aggregated: {pages:0, scannedRows:0, returnedRows:0,
        selectedRows:0, jsonChars:0, sqliteElapsedMs:0,
        workerAppendElapsedMs:0, workerWriteElapsedMs:0, maxCells:0,
        heapDistinctSamples:0, workerHeapDistinctSamples:0},
      monthlyCoverage: [], events: []
    };
    persist();
    mark('xlsx-export', 'start', info);
    return true;
  }
  function setCoverage(monthly) {
    if (!isTestBuild() || !retained || retained.status !== 'running') return;
    if (!Array.isArray(monthly)) return;
    retained.monthlyCoverage = monthly.slice(0, 180).filter(row =>
      /^\d{4}-\d{2}$/.test(row?.month) &&
      ['dated','fullRows','analyticalRows'].every(k =>
        Number.isSafeInteger(row[k]) && row[k]>=0)
    ).map(row => ({
      month:row.month, dated:row.dated,
      fullRows:row.fullRows, analyticalRows:row.analyticalRows
    }));
    persist();
  }
  function captureDatabase(source = {}) {
    if (!isTestBuild() || !retained || retained.status !== 'running') return;
    const entry = {};
    for (const key of ['databaseInputMiB','sqliteWasmCapacityMiB','sourceRows',
      'fullRows','missingFullRows','undated','revision']) {
      if (Number.isFinite(source?.[key]) && source[key] >= 0) entry[key]=source[key];
    }
    retained.databaseEnvironment = entry;
    persist();
  }
  function mark(phase, event, data = {}) {
    if (!retained || retained.status !== 'running' || !isTestBuild()) return;
    const safe = value => String(value || '').toLowerCase()
      .replace(/[^a-z0-9_-]/g, '').slice(0, 56);
    if (!['start','end','progress','error'].includes(event)) return;
    const name = safe(phase);
    if (!name) return;
    const entry = {
      phase: name, event,
      at: new Date().toISOString(),
      elapsedMs: Math.max(0, nowMs() - retained.startedEpochMs)
    };
    for (const [key, value] of Object.entries(data || {})) {
      if (allowed.has(key) && Number.isFinite(value) &&
          value >= 0 && value <= 1e12) {
        entry[key] = Math.round(value * 100) / 100;
      }
    }
    // Absence of the API is explicitly unknown, not zero memory consumption.
    const heap = typeof performance !== 'undefined' ?
      performance.memory?.usedJSHeapSize : undefined;
    if (Number.isFinite(heap) && heap >= 0) {
      entry.mainJsHeapMiB = Math.round(heap / 1048576 * 100) / 100;
    }
    const cap = typeof performance !== 'undefined'
      ? performance.memory?.totalJSHeapSize : undefined;
    const limit = typeof performance !== 'undefined'
      ? performance.memory?.jsHeapSizeLimit : undefined;
    if (Number.isFinite(cap) && cap > 0) {
      entry.mainJsHeapCapacityMiB = Math.round(cap / 1048576 * 100) / 100;
    }
    if (Number.isFinite(limit) && limit > 0) {
      entry.mainJsHeapLimitMiB = Math.round(limit / 1048576 * 100) / 100;
    }
    if (Number.isFinite(entry.mainJsHeapMiB)) {
      retained.peakSampledMainJsHeapMiB = Math.max(
        retained.peakSampledMainJsHeapMiB || 0, entry.mainJsHeapMiB
      );
    }
    if (Number.isFinite(entry.workerJsHeapMiB)) {
      retained.peakSampledWorkerJsHeapMiB = Math.max(
        retained.peakSampledWorkerJsHeapMiB || 0, entry.workerJsHeapMiB
      );
    }
    const ag=retained.aggregated;
    if (ag) {
      if (name==='xlsx-sqlite-page' && event==='end') {
        ag.pages++;
        ag.scannedRows += entry.scannedRows || 0;
        ag.returnedRows += entry.batchRows || 0;
        ag.jsonChars += entry.jsonChars || 0;
        ag.sqliteElapsedMs += entry.durationMs || 0;
        if (entry.hasMore === 0 && Number.isFinite(entry.matchedRows)) {
          ag.selectedRows=entry.matchedRows;
        }
      }
      if (name==='xlsx-worker-append' && event==='end') {
        ag.workerAppendElapsedMs += entry.durationMs || 0;
        ag.maxCells = Math.max(ag.maxCells, entry.totalCells || 0);
      }
      if (name==='xlsx-worker-serialize' && event==='end') {
        ag.workerWriteElapsedMs += entry.durationMs || 0;
      }
      if (Number.isFinite(entry.mainJsHeapMiB)) {
        const last=retained.__lastMainHeapSample;
        if (entry.mainJsHeapMiB!==last) ag.heapDistinctSamples++;
        retained.__lastMainHeapSample=entry.mainJsHeapMiB;
      }
      if (Number.isFinite(entry.workerJsHeapMiB)) {
        const last=retained.__lastWorkerHeapSample;
        if (entry.workerJsHeapMiB!==last) ag.workerHeapDistinctSamples++;
        retained.__lastWorkerHeapSample=entry.workerJsHeapMiB;
      }
    }
    retained.events.push(entry);
    if (retained.events.length > MAX_EVENTS) {
      retained.events.splice(0, retained.events.length - MAX_EVENTS);
      retained.discardedEvents = (retained.discardedEvents || 0) + 1;
    }
    if (event === 'start') retained.lastStarted = name;
    if (event === 'end') retained.lastCompleted = name;
    if(historyEnabled()) {
      const seq=retained.eventCount++;
      history.append('xlsx',retained.sessionId,seq,entry,retained);
    }
    persist();
  }
  function finish(status, data = {}) {
    if (!retained || retained.status !== 'running' || !isTestBuild()) return false;
    const finalStatus = status === 'completed' ? 'completed' : 'failed';
    mark('xlsx-export', finalStatus === 'completed' ? 'end' : 'error', data);
    retained.status = finalStatus;
    activeThisTab = false;
    retained.finishedAt = new Date().toISOString();
    retained.totalElapsedMs = nowMs() - retained.startedEpochMs;
    delete retained.startedEpochMs;
    delete retained.__lastMainHeapSample;
    delete retained.__lastWorkerHeapSample;
    persist();
    if(historyEnabled() && retained.eventCount) {
      history.append('xlsx',retained.sessionId,retained.eventCount-1,
        retained.events[retained.events.length-1],retained);
    }
    return true;
  }
  function report() {
    if (!retained) return null;
    const {__lastMainHeapSample, __lastWorkerHeapSample, ...safeReport} = retained;
    return JSON.stringify({
      ...safeReport, storagePersisted: persisted,
      browser: typeof navigator !== 'undefined' ? navigator.userAgent : 'unavailable',
      note: 'Browser initiated the XLSX download; disk persistence is not verified.'
    }, null, 2);
  }
  function downloadReport() {
    if(historyEnabled() && retained?.sessionId) {
      return history.download('xlsx',retained,
        'Reclassifer_XLSX_Diagnostic_' + buildLabel() + '_' +
        retained.status+'_'+retained.startedAt.replace(/[:.]/g,'-')+'.json');
    }
    const content = report();
    if (!content || typeof document === 'undefined' ||
        typeof Blob === 'undefined' || typeof URL === 'undefined') return false;
    let url;
    try {
      const blob = new Blob([content], {type:'application/json;charset=utf-8'});
      url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'Reclassifer_XLSX_Diagnostic_' + (retained.testLabel || 'TEST_11_PR322') + '_' +
        retained.status + '_' +
        retained.startedAt.replace(/[:.]/g,'-') + '.json';
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();
      a.remove();
      return true; // Download requested, not proof that the OS saved the file.
    } catch (_) {
      return false;
    } finally {
      if (url) setTimeout(() => URL.revokeObjectURL(url), 10000);
    }
  }
  async function copy() {
    const value=historyEnabled()&&retained?.sessionId
      ? JSON.stringify(await history.collect('xlsx',retained),null,2)
      : report();
    if (!value) return false;
    try {
      if (globalThis.navigator?.clipboard?.writeText) {
        await globalThis.navigator.clipboard.writeText(value);
        return true;
      }
    } catch (_) {}
    if (typeof document === 'undefined') return false;
    const field = document.createElement('textarea');
    field.value = value;
    field.style.position = 'fixed';
    field.style.left = '-9999px';
    document.body.appendChild(field);
    field.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch (_) {}
    field.remove();
    return ok;
  }
  globalThis.ReclassifierXlsxExportDiagnostics = Object.freeze({
    enabled: isTestBuild, begin, mark, finish, setCoverage, captureDatabase, report, downloadReport,
    copy, status: updateStatus,
    snapshot: () => retained,
    isRunning: () => activeThisTab && retained?.status === 'running',
    isPersisted: () => persisted
  });
})();
