// FILE CONTRACT: browser bridge for the dedicated KPI Worker and priority queue.
// Lazy startup: does NOT copy SQLite/ITSM/MB records during application startup.
// A source revision/identity is sent once per worker session; subsequent tasks
// send only KPI query/filter metadata. No silent synchronous fallback.
(() => {
  'use strict';

  function createKpiBackgroundJobs(options = {}) {
    const workerCode = options.workerCode;
    const makeClient = options.createClient;
    const schedulerApi = options.scheduler || globalThis.ReclassifierKpiTaskScheduler;
    if (!schedulerApi?.create || typeof makeClient !== 'function') {
      throw new Error('KPI background jobs require a scheduler and Worker client.');
    }
    let client = null;
    let seeded = null;
    let requestSequence = 0;
    let disposed = false;
    const SOURCE_IDS = ['itsm_data', 'mobile_brigade_data', 'drivers', 'combined'];
    let lastProgress = null;
    let lastCacheStats = null;

    function makeWorker() {
      if (typeof Worker !== 'function' || !workerCode) {
        throw new Error('Отдельный KPI WebWorker недоступен в этом браузере.');
      }
      const url = URL.createObjectURL(new Blob([workerCode], { type: 'text/javascript' }));
      try { return new Worker(url); }
      finally { URL.revokeObjectURL(url); }
    }
    function ensureClient() {
      if (!client) {
        client = makeClient({
          createWorker: makeWorker,
          requestTimeoutMs: 10 * 60 * 1000,
          onFatal() { seeded = null; },
          onWorkerCreated(worker) { worker.postMessage({ type: 'PING' }); }
        });
      }
      return client;
    }
    function samePack(left, right) {
      if (!left || !right || left.signature !== right.signature) return false;
      return SOURCE_IDS.every(id => left.instances[id] === right.instances[id]);
    }
    function progress(callback) {
      return update => {
        // Progress labels are fixed worker strings, never raw Dataset data.
        const safe = Object.freeze({
          percent: Number.isFinite(update?.percent) ? Math.max(0, Math.min(100, update.percent)) : 0,
          label: String(update?.label || '').slice(0, 80)
        });
        lastProgress = safe;
        if (callback) callback(safe);
      };
    }
    async function execute(job, onProgress) {
      const activeClient = ensureClient();
      const { sourcePack, signature, query, kpis, trace, type, state, stage, forceRecalculate } = job;
      const instances = Object.fromEntries(SOURCE_IDS.map(id => [id, sourcePack.instances[id] || null]));
      const wanted = { signature, instances };
      const clientGeneration = activeClient.state().generation;
      const needsInit = !samePack(seeded, wanted) ||
        seeded.workerGeneration !== clientGeneration;
      const safeProgress = progress(onProgress);
      if (needsInit) {
        if(globalThis.RECLASSIFIER_BUILD?.testLabel==='TEST_16_PR326'){
          let rows=0,fullRows=0;
          for(const item of Object.values(instances)){
            rows+=item?.records?.length||0;
            fullRows+=item?.fullDataset?.rows?.length||0;
          }
          globalThis.ReclassifierDiagnosticV2?.checkpoint?.('kpi-worker-init',{
            rows,fullRows,workerGeneration:clientGeneration
          },'start');
        }
        globalThis.ReclassifierDatabaseMemoryDiagnostics?.mark?.('kpi-worker-init','start');
        const init = await activeClient.request('KPI_INIT',
          { sourcePack, signature, mode: type === 'report' ? 'report' : 'query' }, [],
          update => safeProgress({
            percent: Math.round((Number(update?.percent) || 0) * 0.08),
            label: update?.label
          }));
        seeded = { ...wanted, workerGeneration: activeClient.state().generation, session: init.session };
        globalThis.ReclassifierDatabaseMemoryDiagnostics?.mark?.('kpi-worker-init','end');
        globalThis.ReclassifierDiagnosticV2?.checkpoint?.('kpi-worker-init',
          {workerGeneration:activeClient.state().generation},'end');
      }
      const result = type === 'report'
        ? await activeClient.request('KPI_REPORT', {
          session: seeded.session, state, stage, forceRecalculate:forceRecalculate === true
        }, [], update => safeProgress({
          percent: Math.round(8 + (Number(update?.percent) || 0) * 0.92),
          label: update?.label
        }))
        : await activeClient.request('KPI_CALCULATE', {
          session: seeded.session, query, kpis, trace: Boolean(trace)
        }, [], update => safeProgress({
          percent: Math.round(8 + (Number(update?.percent) || 0) * 0.92),
          label: update?.label
        }));
      if (result.session !== seeded.session || result.signature !== signature) {
        const error = new Error('Worker вернул результат для другой ревизии.');
        error.code = 'RECLASSIFIER_KPI_STALE_TASK';
        throw error;
      }
      if (result.cacheStats) {
        const counters=result.cacheStats;
        lastCacheStats=Object.freeze({
          size:Number(counters.size)||0,
          capacity:Number(counters.capacity)||0,
          hits:Number(counters.hits)||0,
          misses:Number(counters.misses)||0,
          evictions:Number(counters.evictions)||0
        });
      }
      return Object.freeze(result);
    }
    const queue = schedulerApi.create({ run: execute, maxPending: 64 });

    function runQuery({ sourcePack, signature, query, kpis, trace = false,
      priority = 2, key = null, signal = null, onProgress = null } = {}) {
      if (disposed) return Promise.reject(new Error('KPI background jobs закрыты.'));
      if (!sourcePack?.instances || !Array.isArray(sourcePack.sources) ||
          !signature || !query || !Array.isArray(kpis)) {
        return Promise.reject(new TypeError('KPI Worker требует source pack, revision, query и список KPI.'));
      }
      // Caller may supply a short revision-scoped deduplication key.
      // No personal data/filter values are exposed in public queue status.
      const taskKey = key == null ? 'kpi-task-' + (++requestSequence) : String(key);
      return queue.enqueue({
        key: taskKey, priority, signal, onProgress,
        payload: { sourcePack, signature, query, kpis, trace, type: 'query' }
      });
    }
    function runReport({ sourcePack, signature, state = {}, stage = 'full',
      forceRecalculate = false, priority = 2, signal = null, onProgress = null } = {}) {
      if (disposed) return Promise.reject(new Error('KPI background jobs закрыты.'));
      if (!sourcePack?.instances || !Array.isArray(sourcePack.sources) || !signature ||
          !['primary','full'].includes(stage)) {
        return Promise.reject(new TypeError('Недопустимый фоновый запрос Report Snapshot.'));
      }
      // Do not include filters/PII in keys exposed by queue diagnostics.
      return queue.enqueue({
        key: 'report-' + (++requestSequence), priority, signal, onProgress,
        payload: { type: 'report', sourcePack, signature, state, stage,
          forceRecalculate:forceRecalculate === true }
      });
    }
    // TEST_15: a low-priority automatic KPI must not keep consuming memory
    // while a large import/export starts. Abort the physical Worker, not just
    // its result Promise. Never interrupt an interactive priority 0..4 job.
    function preemptAuto() {
      if (!['TEST_15_PR324','TEST_16_PR326','TEST_17_PR332','TEST_18_PR335'].includes(globalThis.RECLASSIFIER_BUILD?.testLabel) ||
          queue.status().active?.priority !== 5) return false;
      queue.invalidate();
      const previous=client;
      client=null;
      seeded=null;
      lastProgress=null;
      lastCacheStats=null;
      previous?.dispose('Фоновый KPI приостановлен для тяжёлой операции.');
      return true;
    }
    function invalidate() {
      queue.invalidate();
      seeded = null;
      lastProgress = null;
      lastCacheStats = null;
    }
    function status() {
      const state = queue.status();
      return Object.freeze({
        ...state,
        worker: client?.state().active ? 'ready' : 'not-started',
        sourceLoaded: Boolean(seeded),
        progress: lastProgress,
        materializedResults: lastCacheStats
      });
    }
    function dispose() {
      if (disposed) return;
      disposed = true;
      queue.dispose();
      client?.dispose();
      client = null;
      seeded = null;
    }
    return Object.freeze({ version: '1.1.0', runQuery, runReport, invalidate, preemptAuto, status,
      subscribe: queue.subscribe, dispose });
  }

  globalThis.ReclassifierKpiBackgroundJobsFactory = Object.freeze({
    create: createKpiBackgroundJobs
  });
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = globalThis.ReclassifierKpiBackgroundJobsFactory;
  }
})();
