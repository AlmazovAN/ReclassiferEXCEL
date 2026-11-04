// FILE CONTRACT: KPI Computation Service — synchronous calculation boundary (PR 3).
// Receives prepared source instances from the Report adapter; never reads storage or UI.
// Owns component preparation, source revision/identity cache and Calculator invocation.
// Does not implement formulas, Report Snapshots, graph series or data persistence.
// PR 4 may schedule this boundary in a Worker without changing its calculation contract.
(() => {
  'use strict';

  const preparation = globalThis.ReclassifierKpiPreparation;
  const calculator = globalThis.ReclassifierKpiCalculator;
  const calculatorCommon = globalThis.ReclassifierKpiCalculatorCommon;
  const definitions = globalThis.ReclassifierKpiDefinitions;
  const catalog = globalThis.ReclassifierKpiCatalog;
  const itsmSchema = globalThis.ReclassifierItsmDatasetSchema;
  const profiler = globalThis.ReclassifierPerformanceProfiler;
  if (!preparation?.prepare || !calculator?.calculate || !calculatorCommon?.unavailable ||
      !definitions || !catalog?.getCalculation || !catalog?.list || !itsmSchema?.fields) {
    throw new Error('KPI Computation Service dependencies are incomplete.');
  }

  const SOURCE_IDS = Object.freeze(['itsm_data', 'mobile_brigade_data', 'drivers', 'combined']);
  const IMPLEMENTED_KPIS = Object.freeze(catalog.list({ calculationState: 'implemented' })
    .map(entry => entry.id));
  let preparedCache = null;
  let generation = 0;

  // Materialized KPI results: store the real Calculator's immutable output,
  // never average percentages or rebuild numerator/denominator independently.
  // 2048 is a strict in-memory LRU bound (no SQLite persistence or raw rows).
  const MAX_KPI_RESULTS = 2048;
  const resultCache = new Map();
  const resultStats = { hits: 0, misses: 0, evictions: 0 };
  let resultCalculatorVersion = null;

  function clearResults() {
    resultCache.clear();
    resultCalculatorVersion = null;
  }

  // Only cache stable request shapes. Exotic caller input goes through the
  // original Calculator without caching, preserving validation semantics.
  function queryKey(query, sources) {
    if (!query || !Array.isArray(sources) ||
        !(query.period == null || typeof query.period === 'string' ||
          (query.period && typeof query.period === 'object' &&
           !Array.isArray(query.period) &&
           ['start','end','from','to','period'].some(k => Object.hasOwn(query.period,k))))) return null;
    const filters = query.filters || {};
    if (!filters || typeof filters !== 'object' || Array.isArray(filters)) return null;
    const parts = [];
    for (const name of Object.keys(filters).sort()) {
      const value = filters[name];
      if (!(typeof value === 'string' || typeof value === 'number' ||
            typeof value === 'boolean' || value == null ||
            (Array.isArray(value) && value.every(v =>
              typeof v === 'string' || typeof v === 'number')))) return null;
      parts.push([name,value]);
    }
    // Guards depend on source availability, not on Source row content.
    // Source revision and exact object identity are already checked by prepare().
    return JSON.stringify([
      query.period ?? null, parts,
      sources.map(source => [source?.id, Boolean(source?.available)])
        .sort((a,b) => String(a[0]).localeCompare(String(b[0])))
    ]);
  }

  function rememberResult(key, result) {
    if (resultCache.has(key)) resultCache.delete(key);
    resultCache.set(key, result);
    if (resultCache.size > MAX_KPI_RESULTS) {
      resultCache.delete(resultCache.keys().next().value);
      resultStats.evictions += 1;
      profiler?.count('calculator.results.cache.eviction');
    }
  }

  function getResult(key) {
    const value = resultCache.get(key);
    if (value !== undefined) {
      resultCache.delete(key);
      resultCache.set(key, value);
      resultStats.hits += 1;
      profiler?.count('calculator.results.cache.hit');
    } else {
      resultStats.misses += 1;
      profiler?.count('calculator.results.cache.miss');
    }
    return value;
  }

  function sourceInstances(pack) {
    if (!pack?.instances || !Array.isArray(pack.sources)) {
      throw new TypeError('KPI computation requires a source pack with instances and descriptors.');
    }
    return SOURCE_IDS.map(id => pack.instances[id] || null);
  }

  function sameInstances(left, right) {
    return left.length === right.length &&
      left.every((instance, index) => instance === right[index]);
  }

  function invalidate() {
    preparedCache = null;
    clearResults();
    generation += 1;
  }

  // The caller derives a revision signature from the authoritative Runtime
  // descriptors. Object identity additionally detects unversioned legacy swaps.
  function prepareInner(pack, signature) {
    if (typeof signature !== 'string' || !signature.length) {
      throw new TypeError('KPI computation requires a nonempty source revision signature.');
    }
    const instances = sourceInstances(pack);
    if (preparedCache?.signature === signature &&
        sameInstances(preparedCache.instances, instances)) {
      profiler?.count('report.prepare.cache.hit');
      return preparedCache.prepared;
    }
    profiler?.count('report.prepare.cache.miss');

    const itsm = pack.instances.itsm_data;
    const mobile = pack.instances.mobile_brigade_data;
    const drivers = pack.instances.drivers;
    const equipment = pack.instances.combined;

    // Exact input projection formerly owned by Reliability Report Service.
    // Do not change calculation fields or Full Dataset coverage semantics.
    const prepared = preparation.prepare({
      itsm: {
        meta: itsm?.meta || {},
        fields: Array.from(itsm?.meta?.fields || itsmSchema.fields),
        records: Array.isArray(itsm?.records) ? itsm.records : [],
        fullDataset: itsm?.fullDataset || null
      },
      mobileBrigade: {
        records: Array.isArray(mobile?.records) ? mobile.records : [],
        fullDataset: mobile?.fullDataset || null,
        meta: mobile?.meta || {},
        available: Boolean(mobile && mobile.meta?.sourceType !== 'error')
      },
      drivers: drivers && drivers.meta?.sourceType !== 'error'
        ? drivers : { records: [], meta: {} },
      equipment: equipment && equipment.meta?.sourceType !== 'error'
        ? equipment : { records: [], meta: {} }
    });
    // Publish only after successful preparation. A failed attempt is not cached.
    // Different component bundles can never share result values.
    clearResults();
    preparedCache = Object.freeze({
      signature, instances: Object.freeze(instances), prepared
    });
    generation += 1;
    return prepared;
  }

  function prepare(pack, signature) {
    const run = () => prepareInner(pack, signature);
    return profiler ? profiler.measure('report.prepare', run) : run();
  }

  function sourceAvailable(sources, id) {
    return Boolean(sources.find(source => source.id === id)?.available);
  }

  function guardResult(id, result, sources, query) {
    const contract = catalog.getCalculation(id);
    const missing = Array.from(new Set((contract?.sources || []).map(source => source.datasetId)))
      .filter(sourceId => !sourceAvailable(sources, sourceId));
    if (!missing.length) return result;
    return calculatorCommon.unavailable(definitions[id], query, 'source-missing', {
      dataState: 'no-data',
      diagnostics: { missingSources: missing }
    });
  }

  function calculateInner(request) {
    const { prepared, sources, query, kpis = IMPLEMENTED_KPIS, trace = null } = request || {};
    if (!preparedCache || preparedCache.prepared !== prepared) {
      const error = new Error('KPI prepared components are no longer current.');
      error.code = 'RECLASSIFIER_KPI_STALE_PREPARED';
      throw error;
    }
    if (!Array.isArray(sources) || !query || !Array.isArray(kpis)) {
      throw new TypeError('Invalid KPI computation request.');
    }
    const scope = queryKey(query, sources);
    const canReuse = !trace && scope !== null;
    const known = {};
    const missing = [];
    for (const id of kpis) {
      const cached = canReuse ? getResult(JSON.stringify([scope,id])) : undefined;
      if (cached === undefined) missing.push(id);
      else known[id] = cached;
    }
    // Trace-bearing requests always run the real Calculator for every KPI,
    // preserving observed selections, true counts and execution evidence.
    let version = resultCalculatorVersion;
    let computed = null;
    if (missing.length || !canReuse || resultCalculatorVersion === null) {
      profiler?.count('calculator.batch.calls');
      profiler?.count('calculator.results.actualKpis', kpis.length === missing.length || !canReuse
        ? kpis.length : missing.length);
      computed = calculator.calculate(prepared, {
        period: query.period,
        filters: query.filters,
        kpis: canReuse ? missing : kpis,
        trace
      });
      version = computed.version;
      if (resultCalculatorVersion && version !== resultCalculatorVersion) {
        // Runtime formula implementation changed: do not mix old/new results.
        clearResults();
      }
      resultCalculatorVersion = version;
    }
    const results = {};
    for (const id of kpis) {
      const result = Object.hasOwn(known,id)
        ? known[id] : guardResult(id, computed.results[id], sources, query);
      results[id] = result;
      // Trace results are cacheable for *future untraced* requests, but
      // must never be replayed in place of a later trace-bearing calculation.
      if (scope !== null && computed && !Object.hasOwn(known,id)) {
        rememberResult(JSON.stringify([scope,id]),result);
      }
    }
    return Object.freeze({ version, results: Object.freeze(results) });
  }

  function calculate(request) {
    const run = () => calculateInner(request);
    return profiler ? profiler.measure('calculator.batch', run) : run();
  }

  function status() {
    return Object.freeze({
      state: preparedCache ? 'ready' : 'idle',
      generation,
      prepared: Boolean(preparedCache),
      preparationVersion: preparedCache?.prepared?.version || null,
      materializedResults: Object.freeze({
        size: resultCache.size, capacity: MAX_KPI_RESULTS,
        hits: resultStats.hits, misses: resultStats.misses,
        evictions: resultStats.evictions
      })
    });
  }

  const api = Object.freeze({
    version: '1.0.0',
    implementedKpis: IMPLEMENTED_KPIS,
    prepare,
    calculate,
    invalidate,
    status
  });
  globalThis.ReclassifierKpiComputationService = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
