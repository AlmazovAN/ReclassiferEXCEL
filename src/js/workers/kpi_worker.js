// FILE CONTRACT: dedicated offline KPI WebWorker protocol.
// Receives one explicit source pack per revision; keeps prepared components in
// worker memory. No access to SQLite, DOM, XLSX processing or network.
// Requests are serialized by the main-thread priority scheduler.
(() => {
  'use strict';
  const service = globalThis.ReclassifierKpiComputationService;
  const traceApi = globalThis.ReclassifierKpiExecutionTrace;
  if (!service?.prepare || !service?.calculate) throw new Error('KPI worker computation engine unavailable.');
  let current = null;
  let session = 0;
  function respond(type, requestId, payload) {
    self.postMessage({ type, requestId, payload });
  }
  self.onmessage = event => {
    const request = event.data || {};
    const id = request.requestId || null;
    try {
      if (request.type === 'PING') {
        respond('KPI_READY', id, { version: '1.0.0', ready: true });
        return;
      }
      if (request.type === 'KPI_INIT') {
        const { sourcePack, signature, mode } = request.payload || {};
        if (!sourcePack || typeof signature !== 'string' || !signature) {
          throw new Error('KPI worker requires a source pack and source revision.');
        }
        respond('WORKER_PROGRESS', id, { percent: 10, label: 'Подготовка KPI' });
        // Replace the active worker bundle atomically. The main thread does not
        // send the same large source pack again for each chart or month query.
        // Report Service prepares the same components on first Snapshot
        // request. Avoid an unnecessary double preparation at KPI_INIT.
        const prepared = mode === 'report' ? null : service.prepare(sourcePack, signature);
        current = Object.freeze({ prepared, sourcePack, sources: sourcePack.sources, signature });
        // Main thread only transfers the source pack once for this revision.
        // Report Service's in-memory adapter reads this exact Worker-local pack.
        globalThis.__kpiWorkerSourcePack = sourcePack;
        session += 1;
        respond('WORKER_PROGRESS', id, { percent: 100, label: 'Компоненты KPI готовы' });
        respond('KPI_INITIALIZED', id, { session, preparationVersion: prepared?.version || null });
        return;
      }
      if (request.type === 'KPI_REPORT') {
        const payload = request.payload || {};
        if (!current || payload.session !== session) {
          throw new Error('KPI report Worker session is stale.');
        }
        const service = globalThis.ReclassifierReliabilityReportService;
        if (!service?.buildSnapshot) throw new Error('Worker Report Service недоступен.');
        const stage = payload.stage === 'primary' ? 'primary' : 'full';
        respond('WORKER_PROGRESS', id, { percent: 0,
          label: stage === 'primary' ? 'Основные KPI' : 'Месячная история' });
        const snapshot = service.buildSnapshot(payload.state || {}, {
          stage,
          forceRecalculate:payload.forceRecalculate === true,
          onProgress: update => {
            const percent = Number(update?.percent);
            if (Number.isFinite(percent)) {
              respond('WORKER_PROGRESS', id, {
                percent: Math.max(0, Math.min(100, percent)),
                label: String(update?.label || 'Расчёт KPI').slice(0,80)
              });
            }
          }
        });
        respond('KPI_REPORT_RESULT', id, {
          session, signature: current.signature, stage, snapshot,
          // Only aggregate cache counters cross the Worker boundary.
          // Never send filter keys, Dataset rows or cached result payloads.
          cacheStats: globalThis.ReclassifierKpiComputationService.status().materializedResults
        });
        return;
      }
      if (request.type === 'KPI_CALCULATE') {
        const payload = request.payload || {};
        if (!current || payload.session !== session) {
          throw new Error('KPI worker session is stale or not initialized.');
        }
        const trace = payload.trace === true ? traceApi?.createCollector({
          prepared: service.prepare(current.sourcePack, current.signature),
          sources: current.sources, query: payload.query
        }) : null;
        respond('WORKER_PROGRESS', id, { percent: 0, label: 'Расчёт KPI' });
        // Report Service may have invalidated the preceding prepared bundle.
        // Revalidation is cheap for an unchanged source revision.
        const prepared = service.prepare(current.sourcePack, current.signature);
        const calculated = service.calculate({
          prepared,
          sources: current.sources,
          query: payload.query,
          kpis: payload.kpis,
          trace
        });
        respond('WORKER_PROGRESS', id, { percent: 100, label: 'Расчёт KPI завершён' });
        respond('KPI_RESULT', id, {
          session, signature: current.signature,
          calculated,
          executionTrace: trace ? trace.finalize(calculated.results) : null,
          cacheStats: globalThis.ReclassifierKpiComputationService.status().materializedResults
        });
        return;
      }
      throw new Error('Unsupported KPI worker message type.');
    } catch (error) {
      respond('WORKER_ERROR', id, { message: error?.message || String(error) });
    }
  };
})();
