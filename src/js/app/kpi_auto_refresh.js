// FILE CONTRACT: background KPI refresh coordinator (PR4).
// Purpose: debounce relevant source changes, compute the default full Report
// Snapshot in the existing priority Worker, publish only current results.
// Owns: transient timers/cancellation and global KPI status; never writes SQLite.
// Must not: copy Dataset on startup, mutate datasets, calculate KPI formulas,
//         or replace high-priority interactive report/passport requests.
(() => {
  'use strict';
  const INPUTS = Object.freeze(new Set([
    'itsm_data', 'mobile_brigade_data', 'drivers', 'combined',
    // Equipment partitions can cause the derived "combined" to change.
    'equipment_mounted', 'equipment_stationary', 'equipment_transport'
  ]));
  const DEFAULT_FILTERS = Object.freeze({ period: 'latest', mine: 'all', equipmentClass: 'all' });

  function createKpiAutoRefresh(options = {}) {
    const report = options.report;
    const header = options.header;
    const hasInputs = options.hasInputs || (() => true);
    const isReady = options.isReady || (() => true);
    const isBusy = options.isBusy || (() => false);
    const hasWorker = options.hasWorker || (() => true);
    const userOnKpiRoute = options.userOnKpiRoute || (() => false);
    const later = options.setTimeout || setTimeout;
    const stopTimer = options.clearTimeout || clearTimeout;
    const delayMs = Number.isFinite(options.delayMs) ? options.delayMs : 900;
    if (!report?.buildSnapshotAsync || !report?.getCachedSnapshot || !header?.setKpi) {
      throw new TypeError('KPI auto-refresh requires Report Service and status indicator.');
    }
    let sequence = 0;
    let timer = null;
    let active = null;
    let disposed = false;
    let lastError = null;
    let completed = 0;
    let attempts = 0;
    let pending = false;
    let suspended = false;

    function progress(phase, percent = null) {
      // The interactive page owns the same header while the user is viewing it.
      if (!userOnKpiRoute()) header.setKpi(phase,percent);
    }
    function cancelActive() {
      if (active) {
        active.abort();
        active = null;
      }
    }
    function defer(token, delay) {
      if (timer !== null) stopTimer(timer);
      timer = later(() => {
        timer = null;
        void calculate(token);
      },delay);
    }
    async function calculate(token) {
      if (disposed || suspended || token !== sequence || !pending) return;
      if (!isReady()) return; // bootstrap completion explicitly requests a refresh
      if (isBusy()) { defer(token, 1200); return; }
      if (!hasWorker()) { progress('stale'); return; }
      try {
        if (!hasInputs()) { pending = false; progress('idle'); return; }
        const cached = report.getCachedSnapshot(DEFAULT_FILTERS);
        if (cached?.diagnostics?.stage === 'full' && cached.status !== 'empty') {
          pending = false;
          lastError = null;
          progress(cached.status === 'ready' ? 'ready' : 'partial');
          return;
        }
      } catch (error) {
        // Do not treat a busy/transitioning SQLite as permanently missing data.
        if (isBusy()) { defer(token,1200); return; }
        lastError = error?.message || String(error);
        pending = false;
        progress('error');
        return;
      }
      const controller = new AbortController();
      active = controller;
      attempts += 1;
      globalThis.ReclassifierDatabaseMemoryDiagnostics?.mark?.('kpi-auto-calculate','start');
      progress('calculating',0);
      try {
        const snapshot = await report.buildSnapshotAsync(DEFAULT_FILTERS,{
          stage:'full', priority:5, signal:controller.signal,
          onProgress:update=>{
            if (token !== sequence || controller.signal.aborted || disposed) return;
            if (Number.isFinite(update?.percent)) progress('calculating',update.percent);
          }
        });
        if (token !== sequence || controller.signal.aborted || disposed) return;
        if (!snapshot || snapshot.diagnostics?.stage !== 'full' ||
            snapshot.status === 'empty') {
          throw new Error('Полный расчёт KPI не подтверждён.');
        }
        // buildSnapshotAsync already verified input source signature and stored
        // this complete Snapshot in the main-thread in-memory cache.
        pending = false;
        completed += 1;
        globalThis.ReclassifierDatabaseMemoryDiagnostics?.mark?.('kpi-auto-calculate','end');
        lastError = null;
        progress(snapshot.status === 'ready' ? 'ready' : 'partial');
      } catch (error) {
        if (token !== sequence || controller.signal.aborted || disposed) return;
        globalThis.ReclassifierDatabaseMemoryDiagnostics?.mark?.('kpi-auto-calculate','error');
        lastError = error?.message || String(error);
        pending = false;
        progress(error?.code === 'RECLASSIFIER_KPI_STALE_TASK' ? 'stale' : 'error');
      } finally {
        if (active === controller) active = null;
      }
    }
    function request(reason = 'dataset-updated', changedIds = null) {
      if (disposed) return false;
      if (Array.isArray(changedIds) && changedIds.length &&
          !changedIds.some(id => INPUTS.has(id) || String(id).startsWith('equipment_'))) {
        return false;
      }
      sequence += 1;
      pending = true;
      cancelActive();
      if (timer !== null) { stopTimer(timer); timer = null; }
      if (isReady()) {
        report.invalidate?.();
        progress('stale');
        if (!suspended) defer(sequence, delayMs);
      }
      return true;
    }
    // TEST_15: active background calculation is invalidated before the
    // dedicated Worker is actually terminated by BackgroundJobs.preemptAuto.
    // Resume the pending request only once import/export has released its gate.
    function pause() {
      if (disposed || suspended) return false;
      suspended=true;
      pending=pending||Boolean(active);
      sequence += 1;
      cancelActive();
      if (timer !== null) stopTimer(timer);
      timer=null;
      if(pending) progress('stale');
      return true;
    }
    function resume() {
      if (disposed || !suspended) return false;
      suspended=false;
      if(pending && isReady()) defer(sequence,delayMs);
      return true;
    }
    function status() {
      return Object.freeze({
        pending, running: Boolean(active), suspended, generation: sequence,
        attempts, completed, lastError
      });
    }
    function dispose() {
      if (disposed) return;
      disposed = true;
      sequence += 1;
      cancelActive();
      if (timer !== null) stopTimer(timer);
      timer = null;
    }
    return Object.freeze({request, pause, resume, status, dispose});
  }

  globalThis.ReclassifierKpiAutoRefreshFactory = Object.freeze({
    version:'1.0.0', create:createKpiAutoRefresh
  });
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = globalThis.ReclassifierKpiAutoRefreshFactory;
  }
})();
