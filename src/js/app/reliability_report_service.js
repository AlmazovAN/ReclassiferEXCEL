// FILE CONTRACT: runtime adapter that builds Reliability Report Snapshots.
// Purpose: read current runtime Dataset instances, request KPI Results from the Computation Service and freeze one snapshot.
// Owns: source collection, source-version cache key, filter catalog and report breakdown composition.
// Reads: Runtime Data Repository and shared KPI Computation Service.
// Writes: no Dataset state; only bounded in-memory Report/Chart caches.
// Must not: render UI, duplicate KPI formulas, mutate source Datasets or persist report values.

(() => {
  'use strict';

  const repository = globalThis.ReclassifierRuntimeDataRepository;
  const computation = globalThis.ReclassifierKpiComputationService;
  const calculatorCommon = globalThis.ReclassifierKpiCalculatorCommon;
  const kpiCatalog = globalThis.ReclassifierKpiCatalog;
  const viewModel = globalThis.ReclassifierKpiReportViewModel;
  const executionTrace = globalThis.ReclassifierKpiExecutionTrace;
  const snapshotApi = globalThis.ReclassifierReportSnapshot;
  const sourceFacts = globalThis.ReclassifierKpiSourceFacts;
  const operational = globalThis.ReclassifierKpiOperationalSeries;
  const forecastEngine = globalThis.ReclassifierKpiForecastEngine;
  const profiler = globalThis.ReclassifierPerformanceProfiler;

  if (!repository?.get || !computation?.prepare || !computation?.calculate ||
      !calculatorCommon?.selectRows || !kpiCatalog?.list || !viewModel?.create ||
      !viewModel?.withForecasts || !forecastEngine?.predictReportingMonth ||
      !executionTrace?.createCollector || !snapshotApi?.create ||
      !sourceFacts?.sourceReportingCoverage || !sourceFacts?.reportingMonthStatus) {
    throw new Error('Reliability Report Service dependencies are incomplete.');
  }

  // The Catalog owns the implemented KPI identity and direct Dataset dependencies.
  // Do not maintain a competing hard-coded source/identity list here.
  const IMPLEMENTED_KPIS = Object.freeze(kpiCatalog.list({ calculationState: 'implemented' })
    .map(item => item.id));

  // Report filter choices depend exclusively on the immutable prepared bundle.
  // Cache once per bundle identity; a new Dataset revision yields a new bundle.
  const filterCatalogCache = new WeakMap();
  // Small, bounded in-memory caches. Calculated KPI Results and traces are immutable.
  // Do not persist derived numbers: every new Dataset revision must invalidate them.
  const MAX_SNAPSHOTS = 8;
  const MAX_MONTHLY_SERIES = 8;
  const snapshotCache = new Map();
  const monthlyCache = new Map();
  // Each distinct KPI/mine/class/month is calculated at most once per
  // unchanged source revision, regardless of which viewport requests it.
  // Eviction keeps large histories from becoming an unbounded memory cache.
  const MAX_CHART_POINTS = 4096;
  const chartPointCache = new Map();
  let lastSourceSignature = null;
  let lastSourceInstances = null;
  let verifiedSqliteStamp = null;
  // Fast path is valid only after a full source-signature check in this
  // renderer. The SQLite Registry + Runtime epoch protect against stale data.
  function sqliteSnapshotStamp() {
    if (!['TEST_14_PR322','TEST_15_PR324','TEST_16_PR326','TEST_17_PR332','TEST_18_PR335'].includes(globalThis.RECLASSIFIER_BUILD?.testLabel) ||
        typeof repository?.cacheSnapshotStamp !== 'function') return null;
    try {
      return repository.cacheSnapshotStamp();
    } catch (_) {
      // A failed source validation must never allow a stale KPI cache hit.
      return null;
    }
  }
  function resetCalculationCaches() {
    globalThis.ReclassifierHeaderIndicators?.invalidateKpi?.();
    computation.invalidate();
    operational?.invalidate();
    globalThis.ReclassifierKpiBackgroundJobs?.invalidate();
    snapshotCache.clear();
    monthlyCache.clear();
    chartPointCache.clear();
    lastSourceSignature = null;
    lastSourceInstances = null;
    verifiedSqliteStamp = null;
  }
  function remember(cache, id, value, limit) {
    if (cache.has(id)) cache.delete(id);
    cache.set(id, value);
    if (cache.size > limit) cache.delete(cache.keys().next().value);
    return value;
  }
  function stateCacheKey(state = {}) {
    return JSON.stringify([
      state.period ?? 'latest', state.mine ?? 'all',
      state.equipmentClass ?? 'all'
    ]);
  }
  function filtersCacheKey(filters = {}) {
    return JSON.stringify(Object.keys(filters).sort()
      .map(name => [name, filters[name]]));
  }
  function ensureCurrentSources(sourcePack) {
    const signature = sourceSignature(sourcePack.sources);
    const inputs = ['itsm_data','mobile_brigade_data','drivers','combined']
      .map(id => sourcePack.instances[id] || null);
    const unchanged = signature === lastSourceSignature &&
      lastSourceInstances?.every((source, index) => source === inputs[index]);
    if (!unchanged) {
      // Signature tracks revision/hash/freshness; object identity also detects
      // replacement of legacy datasets without version metadata.
      resetCalculationCaches();
      lastSourceSignature = signature;
      lastSourceInstances = inputs;
    }
    return signature;
  }

  function text(value) {
    return String(value ?? '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
  }

  function key(value) {
    return text(value).toLocaleLowerCase('ru-RU');
  }

  function safeGet(id) {
    try {
      // TEST_17: KPI requires Mobile Brigade analytics but not its Full Dataset;
      // ITSM needs only the SLA overdue column. Keep regular Runtime reads intact.
      const source=['TEST_17_PR332','TEST_18_PR335'].includes(globalThis.RECLASSIFIER_BUILD?.testLabel) &&
        typeof repository.getForKpi==='function'
        ? repository.getForKpi(id) : repository.get(id);
      return source || null;
    } catch (error) {
      return Object.freeze({
        id,
        records: [],
        validation: { status: 'invalid', errors: [error?.message || String(error)], warnings: [] },
        meta: { sourceType: 'error', runtimeError: error?.message || String(error) }
      });
    }
  }

  function sourceDescriptor(id, instance) {
    if (!instance || instance.meta?.sourceType === 'error') {
      return {
        id,
        available: false,
        sourceType: instance?.meta?.sourceType || 'missing',
        schemaVersion: instance?.meta?.schemaVersion || null,
        activeRevision: instance?.meta?.activeRevision ?? null,
        contentHash: instance?.meta?.contentHash || null,
        freshness: instance?.meta?.freshness || instance?.meta?.latestSourceDate || null,
        loadedAt: instance?.meta?.loadedAt || null,
        reportingCoverage: sourceFacts.sourceReportingCoverage(id, instance),
        rowCount: Array.isArray(instance?.records) ? instance.records.length : 0,
        validationStatus: instance?.validation?.status || 'missing',
        dependencyStatus: instance?.meta?.dependencyStatus || null,
        error: instance?.meta?.runtimeError || null
      };
    }

    return {
      id,
      available: true,
      sourceType: instance.meta?.sourceType || 'runtime',
      schemaVersion: instance.meta?.schemaVersion || null,
      activeRevision: instance.meta?.activeRevision ?? null,
      contentHash: instance.meta?.contentHash || null,
      freshness: instance.meta?.freshness || instance.meta?.latestSourceDate || null,
      loadedAt: instance.meta?.loadedAt || null,
      reportingCoverage: sourceFacts.sourceReportingCoverage(id, instance),
      rowCount: Array.isArray(instance.records) ? instance.records.length : 0,
      validationStatus: instance.validation?.status || 'valid',
      dependencyStatus: instance.meta?.dependencyStatus || null,
      sourceCatalogs: Array.isArray(instance.meta?.sourceCatalogs) ? instance.meta.sourceCatalogs : null,
      error: null
    };
  }

  function collectSources() {
    const instances = Object.freeze({
      itsm_data: safeGet('itsm_data'),
      mobile_brigade_data: safeGet('mobile_brigade_data'),
      drivers: safeGet('drivers'),
      combined: safeGet('combined')
    });
    const sources = Object.freeze(
      Object.entries(instances).map(([id, instance]) => Object.freeze(sourceDescriptor(id, instance)))
    );
    return Object.freeze({ instances, sources });
  }

  function sourceSignature(sources) {
    return sources.map(source => [
      source.id,
      source.available ? '1' : '0',
      source.activeRevision ?? '',
      source.contentHash || '',
      source.freshness || '',
      source.loadedAt || '',
      source.reportingCoverage?.status || '',
      source.reportingCoverage?.coverageFrom || '',
      source.reportingCoverage?.coverageThrough || '',
      source.rowCount,
      source.validationStatus || '',
      source.dependencyStatus || ''
    ].join(':')).join('|');
  }

  function buildPrepared(sourcePack) {
    // Source revision and object identity are checked by the shared computation
    // boundary; Report Service still owns filter and Snapshot cache invalidation.
    ensureCurrentSources(sourcePack);
    return computation.prepare(sourcePack, sourceSignature(sourcePack.sources));
  }

  function optionSort(left, right) {
    return String(left.label || left.id).localeCompare(String(right.label || right.id), 'ru');
  }

  function uniqueRowsValues(tables, fields) {
    const values = new Map();
    for (const table of tables) {
      for (const row of Array.from(table?.rows || [])) {
        for (const field of fields) {
          const value = text(row?.[field]);
          if (!value) continue;
          const normalized = key(value);
          if (!values.has(normalized)) values.set(normalized, value);
        }
      }
    }
    return Array.from(values.values()).sort((a, b) => a.localeCompare(b, 'ru'));
  }

  function monthLabel(id) {
    const match = String(id || '').match(/^(\d{4})-(\d{2})$/);
    if (!match) return String(id || '—');
    const months = ['Янв', 'Фев', 'Мар', 'Апр', 'Май', 'Июн', 'Июл', 'Авг', 'Сен', 'Окт', 'Ноя', 'Дек'];
    return months[Number(match[2]) - 1] + ' ' + match[1];
  }

  function periodIds(prepared) {
    const families = prepared.families || {};
    const ids = new Set();
    const tables = [
      families.failures?.events,
      families.failures?.downtime,
      families.labor,
      families.sla,
      families.classification,
      families.classificationCgps,
      families.prb
    ];
    for (const table of tables) {
      for (const row of Array.from(table?.rows || [])) {
        const month = calculatorCommon.monthId(row?.period);
        if (month) ids.add(month);
      }
    }
    // Drivers stock has no event month; never insert its loading date as a report period.
    return Array.from(ids).sort();
  }


  // Pure report-period provenance. Only explicitly certified source cut-offs
  // can establish complete/incomplete months; event maxima are observations.
  // Computed from prepared component-table keys (not raw Dataset rescans).
  function buildReportingCoverage(prepared, sourcePack, selectedMonth) {
    const families = prepared.families || {};
    const tableByKpi = {
      vbr: families.failures?.events,
      ktg: families.ktg?.work,
      sla: families.sla,
      classification_quality: families.classification,
      classification_quality_cgps: families.classificationCgps,
      total_labor: families.labor,
      avr_labor: families.labor,
      avr_share: families.labor,
      maintenance_labor: families.labor,
      corrective_labor: families.labor,
      reactive_share: families.labor,
      problem_coverage_absolute: families.prb,
      problem_coverage_relative: families.prb
    };
    const sources = Object.freeze(Object.fromEntries(
      sourcePack.sources.filter(source =>
        source.id === 'itsm_data' || source.id === 'mobile_brigade_data'
      ).map(source => {
        const strict=source.reportingCoverage;
        if(strict?.status==='confirmed'||!source.available)return [source.id,strict];
        const metric=source.id==='itsm_data'?'inc':'labor';
        const observed=operational?.observedRange?.(sourcePack.instances,metric);
        const metadataDate=sourceFacts.reportingDay(source.freshness);
        // A last EVENT can mark the end of observed activity, not the end
        // of a complete corporate export. Never call this certified.
        const through=[observed?.through,metadataDate].filter(Boolean).sort().at(-1);
        const from=observed?.from?.slice(0,7)||through?.slice(0,7);
        return [source.id,through&&from?Object.freeze({
          sourceId:source.id,status:'observed-only',
          basis:'observed-event-horizon',coverageFrom:from+'-01',
          coverageThrough:through,observedLatestDate:through,
          reason:'provisional-observation-horizon'
        }):strict];
      })
    ));
    const observedCache = new Map();
    function observedMonth(table) {
      if (!table) return null;
      if (observedCache.has(table)) return observedCache.get(table);
      let last = null;
      for (const row of table.rows || []) {
        const month = calculatorCommon.monthId(row.period);
        if (month && (!last || month > last)) last = month;
      }
      observedCache.set(table, last);
      return last;
    }
    const kpis = {};
    for (const id of IMPLEMENTED_KPIS) {
      const contract = kpiCatalog.get(id)?.calculation;
      const sourceIds = Array.from(new Set(
        (contract?.sources || []).map(source => source.datasetId)
      ));
      // ITSM is the reporting calendar for mixed ITSM/MB classification;
      // MB is the reporting calendar for task/labor/PRB indicators.
      const sourceId = sourceIds.find(value => value === 'itsm_data') ||
        sourceIds.find(value => value === 'mobile_brigade_data') || null;
      const source = sources[sourceId] || null;
      const observed = observedMonth(tableByKpi[id]);
      const isObserved=source?.status==='observed-only';
      const month = (source?.status === 'confirmed'||isObserved)
        ? source.coverageThrough.slice(0, 7)
        : observed;
      const inconsistent = source?.status === 'confirmed' && observed && observed > month;
      const provisionalMonthState=period=>{
        if(!period||period!==month)return Object.freeze({
          status:'unknown',reason:'provisional-other-period'
        });
        const day=Number(source.coverageThrough.slice(8,10));
        const lastDay=new Date(Date.UTC(+month.slice(0,4),
          +month.slice(5,7),0)).getUTCDate();
        return Object.freeze(day>=lastDay
          ? {status:'complete',reason:'observed-last-calendar-day'}
          : {status:'incomplete',reason:'provisional-observation-horizon'});
      };
      const monthState = inconsistent
        ? Object.freeze({status:'unknown',reason:'observations-after-certified-cutoff'})
        : isObserved?provisionalMonthState(month)
        : sourceFacts.reportingMonthStatus(month, source);
      const selectedState = inconsistent
        ? Object.freeze({status:'unknown',reason:'observations-after-certified-cutoff'})
        : isObserved?provisionalMonthState(selectedMonth)
        : sourceFacts.reportingMonthStatus(selectedMonth, source);
      kpis[id] = Object.freeze({
        kpiId: id,
        periodBasis: contract?.temporal?.basis?.field || null,
        sourceId,
        requiredSources: Object.freeze(sourceIds),
        latestObservedMonth: observed,
        reportMonth: month,
        reportMonthStatus: monthState.status,
        reportMonthReason: monthState.reason,
        selectedMonth: selectedMonth || null,
        selectedMonthStatus: selectedState.status,
        selectedMonthReason: selectedState.reason,
        coverageFrom: source?.coverageFrom || null,
        coverageThrough: source?.coverageThrough || null,
        coverageBasis: source?.basis || null
      });
    }
    return Object.freeze({
      version: '1.0.0',
      selectedMonth: selectedMonth || null,
      sources,
      kpis: Object.freeze(kpis)
    });
  }

  function filterCatalog(prepared) {
    const cached = filterCatalogCache.get(prepared);
    if (cached) return cached;
    const families = prepared.families || {};
    const months = periodIds(prepared);
    const latest = months.length ? months[months.length - 1] : null;
    const tables = [
      families.failures?.events,
      families.equipment,
      families.labor,
      families.sla,
      families.classification,
      families.prb
    ];

    const mines = uniqueRowsValues(tables, ['mine', 'site', 'organizationalUnit']);
    const classes = uniqueRowsValues(tables, ['equipmentClass'])
      .filter(value => value === 'mounted' || value === 'stationary');

    const periods = [
      {
        id: 'latest',
        label: latest ? 'Последний доступный · ' + monthLabel(latest) : 'Нет доступного периода',
        month: latest
      },
      ...months.slice().reverse().map(month => ({ id: month, label: monthLabel(month), month }))
    ];

    const catalog = Object.freeze({
      periods: Object.freeze(periods.map(Object.freeze)),
      mines: Object.freeze([
        Object.freeze({ id: 'all', label: 'Все рудники', value: null }),
        ...mines.map(value => Object.freeze({ id: value, label: value, value }))
      ]),
      equipmentClasses: Object.freeze([
        Object.freeze({ id: 'all', label: 'Всё оборудование', value: null }),
        ...(classes.includes('mounted') ? [Object.freeze({ id: 'mounted', label: 'Навесное', value: 'mounted' })] : []),
        ...(classes.includes('stationary') ? [Object.freeze({ id: 'stationary', label: 'Стационарное', value: 'stationary' })] : [])
      ])
    });
    filterCatalogCache.set(prepared, catalog);
    return catalog;
  }

  function findOption(options, id, fallbackId) {
    return options.find(option => option.id === id) ||
      options.find(option => option.id === fallbackId) ||
      options[0] || null;
  }

  function resolveQuery(catalog, state = {}) {
    const period = findOption(catalog.periods, state.period, 'latest');
    const mine = findOption(catalog.mines, state.mine, 'all');
    const equipmentClass = findOption(catalog.equipmentClasses, state.equipmentClass, 'all');

    const filters = {};
    if (mine?.value) filters.mine = mine.value;
    if (equipmentClass?.value) filters.equipmentClass = equipmentClass.value;

    return Object.freeze({
      periodOption: period,
      mineOption: mine,
      equipmentClassOption: equipmentClass,
      calculatorQuery: Object.freeze({
        period: period?.month ? period.month + '-01' : null,
        filters: Object.freeze(filters)
      })
    });
  }

  function calculateResults(prepared, sourcePack, query, ids = IMPLEMENTED_KPIS, traceCollector = null) {
    // A single calculation entrypoint for dashboard, passport and chart queries.
    // Formula results, source guards and audit traces belong to Computation Service.
    return computation.calculate({
      prepared,
      sources: sourcePack.sources,
      query,
      kpis: ids,
      trace: traceCollector
    });
  }

  function monthlySeriesInner(prepared, sourcePack, catalog, filters, onProgress = null) {
    const cacheKey = filtersCacheKey(filters);
    if (monthlyCache.has(cacheKey)) {
      profiler?.count('report.monthly.cache.hit');
      onProgress?.(90, 'Месячная история из кэша');
      return monthlyCache.get(cacheKey);
    }
    profiler?.count('report.monthly.cache.miss');
    const rows = [];
    const realMonths = catalog.periods.filter(option => option.id !== 'latest' && option.month);
    const orderedMonths = realMonths.slice().reverse();
    for (let index = 0; index < orderedMonths.length; index += 1) {
      const option = orderedMonths[index];
      const query = { period: option.month + '-01', filters };
      const calculated = calculateResults(
        prepared,
        sourcePack,
        query,
        IMPLEMENTED_KPIS
      );
      rows.push(Object.freeze({
        period: option.month,
        label: monthLabel(option.month),
        // Keep the legacy SLA/quality/VBR fields while making all real KPIs
        // available to the new generic report view without a second calculation pass.
        ...calculated.results
      }));
      // Percentage is based on completed, not scheduled, month calculations.
      onProgress?.(35 + Math.round((index + 1) / orderedMonths.length * 55),
        'Месячная история ' + (index + 1) + '/' + orderedMonths.length);
    }
    if (!orderedMonths.length) onProgress?.(90, 'Месячная история отсутствует');
    // Shared month-indexed facts and forecast provenance for all consumers.
    // Cached independently of selected report month and chart viewport.
    const enriched=viewModel.withForecasts({
      monthlyResults:rows,
      reportingCoverage:buildReportingCoverage(prepared,sourcePack,null),
      sources:sourcePack.sources
    });
    return remember(monthlyCache,cacheKey,enriched,MAX_MONTHLY_SERIES);
  }

  function monthlySeries(prepared,sourcePack,catalog,filters,onProgress=null) {
    const run = () => monthlySeriesInner(prepared,sourcePack,catalog,filters,onProgress);
    return profiler ? profiler.measure('report.monthly.series', run) : run();
  }

  function laborBreakdown(prepared, results, query) {
    const selected = calculatorCommon.selectRows(
      prepared.families?.labor,
      query,
      { mine: 'site', equipmentClass: 'equipmentClass' }
    );
    const byType = new Map();
    for (const row of selected.rows) {
      const title = text(row.finalTaskType) || 'Без типа';
      byType.set(title, (byType.get(title) || 0) + (Number.isFinite(row.laborHours) ? row.laborHours : 0));
    }
    const total = results.total_labor?.dataState === 'available'
      ? results.total_labor.value
      : 0;
    return Object.freeze(
      Array.from(byType.entries())
        .map(([title, hours]) => Object.freeze({
          id: key(title).replace(/\s+/g, '-'),
          title,
          hours,
          share: total > 0 ? (hours / total) * 100 : 0
        }))
        .sort((a, b) => b.hours - a.hours)
    );
  }

  function prbBreakdown(prepared, query) {
    const selected = calculatorCommon.selectRows(
      prepared.families?.prb,
      query,
      { mine: 'mine', equipmentClass: 'equipmentClass' }
    );
    const titles = {
      linked: 'Связано с PRB',
      'not-linked': 'Без PRB',
      'request-not-found': 'Заявка ITSM не найдена',
      ambiguous: 'Неоднозначная связь'
    };
    const grouped = new Map();
    for (const row of selected.rows) {
      const state = row.problemLinkState || 'unknown';
      if (!grouped.has(state)) grouped.set(state, { taskCount: 0, laborHours: 0 });
      const target = grouped.get(state);
      target.taskCount += Number(row.taskCount || 0);
      target.laborHours += Number(row.laborHours || 0);
    }
    return Object.freeze(
      Array.from(grouped.entries()).map(([state, values]) => Object.freeze({
        id: state,
        title: titles[state] || state,
        count: values.taskCount,
        laborHours: values.laborHours
      }))
    );
  }

  function reportStatus(sourcePack) {
    const available = sourcePack.sources.filter(source => source.available).length;
    if (available === 0) return 'empty';
    const warnings = sourcePack.sources.some(source =>
      source.validationStatus === 'warning' ||
      (source.dependencyStatus && !['current', 'not-applicable'].includes(source.dependencyStatus))
    );
    return available === sourcePack.sources.length && !warnings ? 'ready' : 'partial';
  }

  // Cache identity is tied to source revisions, filters and a separately
  // versioned methodology. Never use build timestamp/import time as a substitute
  // for source revision validation. Changing KPI semantics requires bumping this.
  const KPI_SNAPSHOT_METHOD_REVISION = 'report-method-2026-10-pr7';
  function snapshotMethodVersion() {
    return [
      KPI_SNAPSHOT_METHOD_REVISION,
      'catalog:' + String(kpiCatalog.version || ''),
      'calculator:' + String(computation.version || ''),
      'view:' + String(viewModel.version || ''),
      'snapshot:' + String(snapshotApi.schemaVersion || ''),
      'forecast:' + String(forecastEngine.version || ''),
      'sources:' + String(sourceFacts.version || '')
    ].join('|');
  }
  function snapshotCacheStore() {
    const store = globalThis.ReclassifierKpiSnapshotStore;
    return store?.identity && store?.read && store?.write ? store : null;
  }
  function snapshotCacheInput(store, state, signature) {
    const databaseUuid = store.identity();
    if (!databaseUuid) return null;
    return Object.freeze({
      // Cache identity is delegated to the storage adapter, not SQL internals.
      cacheKey: JSON.stringify([
        databaseUuid, state.period ?? 'latest', state.mine ?? 'all',
        state.equipmentClass ?? 'all'
      ]),
      sourceSignature: signature,
      methodologyVersion: snapshotMethodVersion(),
      snapshotSchemaVersion: snapshotApi.schemaVersion
    });
  }
  function restorePersistedSnapshot(state, pack) {
    try {
      const store = snapshotCacheStore();
      if (!store) return null;
      const input = snapshotCacheInput(store,state,sourceSignature(pack.sources));
      if (!input) return null;
      const value = store.read(input);
      if (!value || value.status === 'empty') return null;
      // Optional derived data must never break source loading or browser startup.
      return snapshotApi.deepFreeze(value);
    } catch (_) {
      return null;
    }
  }
  function persistVerifiedSnapshot(state,snapshot) {
    if (!snapshot || snapshot.diagnostics?.stage !== 'full' ||
        snapshot.status === 'empty') return;
    try {
      const store = snapshotCacheStore();
      if (!store) return;
      const pack = collectSources();
      // Revalidate *after* the expensive Worker calculation has completed.
      // An old full Snapshot may not be persisted under a new source revision.
      const signature = sourceSignature(pack.sources);
      if (snapshot.diagnostics.sourceSignature !== signature) return;
      const input = snapshotCacheInput(store,state,signature);
      if (input) store.write(input,snapshot);
    } catch (_) {
      // SQLite cache is best-effort. Worker computation remains authoritative.
    }
  }

  function getCachedSnapshot(state = {}) {
    const key = stateCacheKey(state);
    const stamp = sqliteSnapshotStamp();
    const hot = snapshotCache.get(key);
    if (stamp && stamp===verifiedSqliteStamp &&
        hot?.diagnostics?.stage === 'full') {
      globalThis.ReclassifierDatabaseMemoryDiagnostics?.mark?.(
        'kpi-cache-light','end',{cacheHits:1});
      profiler?.count('report.snapshot.cache.hit');
      return hot;
    }
    const sourcePack = collectSources();
    ensureCurrentSources(sourcePack);
    const memory = snapshotCache.get(key);
    if (memory?.diagnostics?.stage === 'full') {
      if(stamp) verifiedSqliteStamp=stamp;
      profiler?.count('report.snapshot.cache.hit');
      return memory;
    }
    const persisted = restorePersistedSnapshot(state,sourcePack);
    if (persisted) {
      if(stamp) verifiedSqliteStamp=stamp;
      profiler?.count('report.snapshot.cache.hit');
      profiler?.count('report.snapshot.sqlite.hit');
      return remember(snapshotCache,key,persisted,MAX_SNAPSHOTS);
    }
    return null;
  }

  function buildSnapshotInner(state = {}, options = {}) {
    const reportProgress = (percent,label) => options.onProgress?.({percent,label});
    reportProgress(0,'Подготовка исходных данных');
    const sourcePack = collectSources();
    ensureCurrentSources(sourcePack);
    const cacheKey = stateCacheKey(state);
    // A caller-provided timestamp is a request for a new, independently
    // timestamped snapshot (tests and reproducible exports use this path).
    if (options.stage !== 'primary' && !options.now && !options.forceRecalculate && snapshotCache.has(cacheKey)) {
      profiler?.count('report.snapshot.cache.hit');
      reportProgress(100,'Готовый снимок KPI');
      return snapshotCache.get(cacheKey);
    }
    profiler?.count('report.snapshot.cache.miss');
    const prepared = buildPrepared(sourcePack);
    reportProgress(15,'Компоненты KPI подготовлены');
    const catalog = filterCatalog(prepared);
    reportProgress(20,'Фильтры KPI подготовлены');
    const resolved = resolveQuery(catalog, state);
    const reportingCoverage = buildReportingCoverage(
      prepared, sourcePack, resolved.periodOption?.month || null
    );
    // Trace is collected DURING this actual Calculator pass, not reconstructed
    // from an independent second filter run or from declarative Catalog steps.
    const traceCollector = executionTrace.createCollector({
      prepared,sources:sourcePack.sources,query:resolved.calculatorQuery
    });
    const calculated = calculateResults(
      prepared,
      sourcePack,
      resolved.calculatorQuery,
      IMPLEMENTED_KPIS,
      traceCollector
    );
    const execution = traceCollector.finalize(calculated.results);
    reportProgress(35,'Основные показатели рассчитаны');
    // PR5: first paint uses the same Calculator but skips the full monthly
    // history. Never cache this partial stage as a complete Report Snapshot.
    const initialStage = options.stage === 'primary';
    const series = initialStage ? Object.freeze([]) : monthlySeries(
      prepared,
      sourcePack,
      catalog,
      resolved.calculatorQuery.filters,
      (percent,label) => reportProgress(percent,label)
    );
    if (initialStage) reportProgress(90,'Основные показатели готовы');

    const calculatedAt = options.now || new Date().toISOString();
    const kpiView = viewModel.create({
      calculatedAt,
      selectedMonth: resolved.periodOption?.month || null,
      filters: resolved.calculatorQuery.filters,
      currentResults: calculated.results,
      monthlyResults: series,
      sources: sourcePack.sources,
      reportingCoverage
    });

    const snapshot = snapshotApi.create({
      status: reportStatus(sourcePack),
      calculatedAt,
      preparationVersion: prepared.version,
      calculatorVersion: calculated.version,
      query: {
        period: resolved.periodOption,
        mine: resolved.mineOption,
        equipmentClass: resolved.equipmentClassOption,
        calculator: resolved.calculatorQuery
      },
      filters: catalog,
      results: calculated.results,
      executionTrace: execution,
      reportingCoverage,
      kpiView,
      series: { monthly: series },
      breakdowns: {
        labor: laborBreakdown(prepared, calculated.results, resolved.calculatorQuery),
        problemManagement: prbBreakdown(prepared, resolved.calculatorQuery),
        problemCharts: (() => {
          const analytics=globalThis.ReclassifierProblemManagementAnalytics;
          if (!analytics?.create) return [];
          const chosen=calculatorCommon.selectRows(prepared.families?.prb,
            resolved.calculatorQuery,{mine:'mine',equipmentClass:'equipmentClass'});
          return chosen.error?[]:analytics.create(chosen.rows,series,sourcePack.sources);
        })()
      },
      sources: sourcePack.sources,
      diagnostics: {
        sourceSignature: sourceSignature(sourcePack.sources),
        stage: initialStage ? 'primary' : 'full',
        implementedKpis: IMPLEMENTED_KPIS.slice(),
        catalogVersion: kpiCatalog.version,
        kpiViewVersion: viewModel.version,
        reportingCoverageVersion: reportingCoverage.version
      }
    });
    reportProgress(100, 'Расчёт KPI завершён');
    const result=(options.now || initialStage) ? snapshot :
      remember(snapshotCache, cacheKey, snapshot, MAX_SNAPSHOTS);
    if(!options.now && !initialStage) verifiedSqliteStamp=sqliteSnapshotStamp();
    return result;
  }


  // Calculate one KPI's chart and mine comparison from the existing prepared components.
  function buildSnapshot(state={},options={}) {
    const run = () => {
      if (!options.now && options.stage !== 'primary' && !options.forceRecalculate) {
        const cached = getCachedSnapshot(state);
        if (cached) return cached;
      }
      const snapshot = buildSnapshotInner(state,options);
      if (!options.now && options.stage !== 'primary') {
        persistVerifiedSnapshot(state,snapshot);
      }
      return snapshot;
    };
    return profiler ? profiler.measure('report.snapshot.total', run) : run();
  }

  function buildKpiChartData(kpiId, state = {}, mineId = null) {
    const entry = kpiCatalog.get(kpiId);
    if (!entry) throw new Error('Unknown KPI: ' + kpiId);
    const pack = collectSources();
    const prepared = buildPrepared(pack);
    const filters = filterCatalog(prepared);
    const resolved = resolveQuery(filters, state);
    const selectedMineId = mineId === null ? resolved.mineOption.id : String(mineId);
    const mineOption = filters.mines.find(option => option.id === selectedMineId);
    if (!mineOption) throw new Error('Unknown mine: ' + selectedMineId);
    const base = { ...resolved.calculatorQuery.filters };
    delete base.mine;
    const mineFilters = { ...base };
    if (mineOption.value) mineFilters.mine = mineOption.value;
    const month = resolved.periodOption?.month || null;
    const months = filters.periods.filter(option => option.id !== 'latest' && option.month &&
      (!month || option.month <= month)).map(option => option.month).reverse();
    const rows = months.map(period => {
      const result = entry.calculation ? calculateResults(prepared,pack,{
        period:period + '-01',filters:mineFilters
      },[kpiId]).results[kpiId] : null;
      return Object.freeze({period,[kpiId]:result});
    });
    const reportingCoverage=buildReportingCoverage(prepared,pack,month);
    const forecastRows=viewModel.withForecasts({
      monthlyResults:rows,reportingCoverage,sources:pack.sources
    });
    const projected = viewModel.create({
      selectedMonth:month,filters:mineFilters,
      currentResults:rows.length ? rows[rows.length-1] : {},
      monthlyResults:forecastRows,sources:pack.sources,reportingCoverage
    });
    const comparison = filters.mines.filter(option=>option.id!=='all').map(option=>{
      const result = entry.calculation && month ? calculateResults(prepared,pack,{
        period:month + '-01',filters:{...base,mine:option.value}
      },[kpiId]).results[kpiId] : null;
      const available = result?.dataState==='available' && Number.isFinite(result.value);
      return Object.freeze({mineId:option.id,label:option.label,
        value:available?result.value:null,
        dataState:available?'available':(result?.dataState || 'not-applicable'),
        reason:available?null:(result?.reason || (entry.calculation?'period-not-selected':'not-implemented'))});
    });
    return Object.freeze({
      kpiId,catalogVersion:kpiCatalog.version,mineOptions:filters.mines,
      selectedMine:selectedMineId,selectedMonth:month,
      equipmentClass:resolved.equipmentClassOption,
      series:projected.seriesById[kpiId],comparison:Object.freeze(comparison),
      sources:pack.sources,status:reportStatus(pack)
    });
  }

  // Explicit mine selection for comparative charts. "ЗФ" includes the mines
  // named by the user, while "Все" includes the entire source-filter catalog.
  // Never compute branch totals by adding rounded KPI percentages.
  const CHART_MINE_NAMES=Object.freeze([
    ['Октябрьский','р. Октябрьский'],['Таймырский','р. Таймырский'],
    ['Комсомольский','р. Комсомольский'],['Скалистый','р. Скалистый'],
    ['Заполярный','р. Заполярный'],['Маяк','р. Маяк'],
    ['Ангидрит','ш. Ангидрит'],['Известняков','ш. Известняков'],
    ['Северный','р. Северный']
  ]);
  // All chart categories use the same source-fact mine normalizer used by
  // ITSM, Drivers, Equipment and MB. Aliases are presentation groups, not
  // duplicate stock or duplicate work-event records.
  const normalizedChartMine=value=>key(sourceFacts.mineName(value));
  function chartMineOptions(available) {
    const physical=Array.from(available||[]).filter(o=>o.value&&o.id!=='all');
    const groups=new Map();
    for(const option of physical){
      const normalized=normalizedChartMine(option.value);
      if(!normalized)continue;
      if(!groups.has(normalized))groups.set(normalized,[]);
      const values=groups.get(normalized);
      if(!values.some(value=>key(value)===key(option.value)))values.push(option.value);
    }
    const known=CHART_MINE_NAMES.map(([id,label])=>{
      const values=groups.get(normalizedChartMine(id))||[];
      return Object.freeze({id,label,value:values[0]||id,
        values:Object.freeze(values.slice()),available:Boolean(values.length)});
    });
    const knownKeys=new Set(CHART_MINE_NAMES.map(([id])=>normalizedChartMine(id)));
    const additional=Array.from(groups.entries())
      .filter(([normalized])=>!knownKeys.has(normalized))
      .map(([normalized,values])=>Object.freeze({
        id:values[0],label:values[0],value:values[0],
        values:Object.freeze(values.slice()),available:true
      }));
    return Object.freeze([...known,...additional,
      Object.freeze({id:'zf',label:'ЗФ',value:null,values:Object.freeze([]),available:true}),
      Object.freeze({id:'all',label:'Все',value:null,values:Object.freeze([]),available:true})]);
  }
  const chartMineValues=option=>Array.from(option?.values||[option?.value]).filter(Boolean);
  // Empty selections must remain restrictive: [] is treated by the Calculator
  // as an inactive filter and would incorrectly include all physical mines.
  const restrictMineValues=values=>values.length?values:['__unmatched_chart_mine__'];
  function chartEquipmentNames(prepared,classes,kpiId=null) {
    const selected=new Set(classes);
    const families=prepared.families||{};
    // For reliability metrics names come from Drivers. Classification
    // metrics use precisely their own analytical equipment-name field,
    // NOT the ITSM "НаименованиеТехники" enrichment or MB transport name.
    const qualityTable=kpiId==='classification_quality'
      ? families.classification : kpiId==='classification_quality_cgps'
      ? families.classificationCgps : null;
    const rows=Array.from((qualityTable || families.equipment)?.rows||[]);
    const names=new Map();
    for(const row of rows){
      if(!selected.has(row.equipmentClass))continue;
      const value=String(row.equipmentName||'').trim();
      if(value&&!names.has(key(value)))names.set(key(value),value);
    }
    return Object.freeze(Array.from(names.values()).sort((a,b)=>a.localeCompare(b,'ru'))
      .map(value=>Object.freeze({id:value,label:value})));
  }
  function selectedEquipmentNames(values,available) {
    if(values===undefined||values===null)return null;
    if(!Array.isArray(values))throw new Error('Invalid equipment name selection');
    const unique=Array.from(new Set(values.map(value=>key(value))));
    if(unique.some(value=>!available.some(option=>key(option.id)===value)))
      throw new Error('Unknown equipment name');
    return unique.length?available.filter(option=>unique.includes(key(option.id)))
      .map(option=>option.id):null;
  }
  const CHART_VISIBLE_MONTHS=Object.freeze({'1m':2,'3m':4,'1y':13,all:null,custom:null});
  function chartPreviousMonth(period, offset) {
    const month = String(period||'');
    if (!/^\d{4}-\d{2}$/.test(month)) return null;
    const date = new Date(Date.UTC(Number(month.slice(0,4)),
      Number(month.slice(5,7))-1-offset, 1));
    return date.toISOString().slice(0,7);
  }
  function chartMonths(start,end) {
    if (!start || !end || start>end) return [];
    const values = [];
    let current=start;
    while(current<=end && values.length<=1200) {
      values.push(current);
      current=chartPreviousMonth(current,-1);
    }
    if(values.length>1200)throw new Error('KPI chart history exceeds 1200 months');
    return values;
  }
  function chartResultPoint(kpiId, period, filters, prepared, sourcePack, realMonth) {
    if(!realMonth) return Object.freeze({
      period,value:null,dataState:'no-data',reason:'period-not-in-source-calendar',
      components:Object.freeze({}),formulaVersion:null
    });
    // Keep the existing not-implemented state for the six placeholder KPIs;
    // they do not have a Calculator and cannot be submitted to calculateResults.
    if (!kpiCatalog.get(kpiId)?.calculation) return Object.freeze({
      period,value:null,dataState:'not-applicable',reason:'not-implemented',
      components:Object.freeze({}),formulaVersion:null
    });
    const id=JSON.stringify([kpiId,period,filtersCacheKey(filters)]);
    const cached=chartPointCache.get(id);
    if(cached) {
      profiler?.count('report.chart.point.hit');
      remember(chartPointCache,id,cached,MAX_CHART_POINTS);
      return cached;
    }
    profiler?.count('report.chart.point.miss');
    const result=calculateResults(prepared,sourcePack,
      {period:period+'-01',filters},[kpiId]).results[kpiId];
    const value=result?.dataState==='available'&&Number.isFinite(result.value)
      ? result.value:null;
    const point=Object.freeze({
      period,value,dataState:value===null
        ? (result?.dataState==='available'?'error':result?.dataState||'no-data')
        : 'available',
      reason:value===null ? result?.reason||'result-not-available':null,
      components:Object.freeze({...(result?.components||{})}),
      partialCoverage:Boolean(result?.diagnostics?.partialCoverage),
      excludedUnverifiedRequestRows:result?.diagnostics?.excludedUnverifiedRequestRows||0,
      classificationCoverage:result?.diagnostics?.classificationCoverage||null,
      formulaVersion:result?.formulaVersion||null
    });
    return remember(chartPointCache,id,point,MAX_CHART_POINTS);
  }
  function buildKpiChartMultiDataInner(kpiId,state={},mineIds=['all'],
      equipmentClasses=['stationary','mounted'],options={}) {
    const entry=kpiCatalog.get(kpiId);
    if(!entry)throw new Error('Unknown KPI: '+kpiId);
    const range=options?.range||'all',window=options?.window??1;
    if(!Object.prototype.hasOwnProperty.call(CHART_VISIBLE_MONTHS,range))
      throw new Error('Unknown KPI chart viewport');
    if(!Number.isInteger(window)||window<1||window>12)
      throw new Error('KPI chart moving trend must be 1–12 months');
    const pack=collectSources();
    const prepared=buildPrepared(pack);
    const filterOptions=filterCatalog(prepared);
    const resolved=resolveQuery(filterOptions,state);
    const mineOptions=chartMineOptions(filterOptions.mines);
    const chosenMines=Array.from(new Set(mineIds||[]));
    const chosenClasses=Array.from(new Set(equipmentClasses||[]));
    if(chosenMines.length>3)throw new Error('Select no more than three mines or aggregates');
    if(chosenClasses.some(v=>!['mounted','stationary'].includes(v)))throw new Error('Unknown equipment class');
    if(chosenMines.some(v=>!mineOptions.some(option=>option.id===v)))throw new Error('Unknown comparison mine');
    const equipmentNameOptions=chartEquipmentNames(prepared,chosenClasses,kpiId);
    const equipmentNames=selectedEquipmentNames(options.equipmentNames,equipmentNameOptions);
    const base={...resolved.calculatorQuery.filters};
    delete base.mine;
    delete base.equipmentClass;
    delete base.equipmentName;
    if(equipmentNames)base.equipmentName=equipmentNames;
    const selectedMonth=resolved.periodOption?.month||null;
    const realMonths=filterOptions.periods.filter(o=>o.id!=='latest'&&o.month &&
      (!selectedMonth||o.month<=selectedMonth)).map(o=>o.month);
    const realSet=new Set(realMonths);
    const firstAvailable=realMonths.length?realMonths[realMonths.length-1]:null;
    const reportLast=selectedMonth||realMonths[0]||null;
    const last=range==='custom' ? options.toMonth : reportLast;
    if(range==='custom' && (!/^\d{4}-\d{2}$/.test(String(last||'')) ||
      !/^\d{4}-\d{2}$/.test(String(options.fromMonth||'')) ||
      options.fromMonth>last || last>reportLast || options.fromMonth<firstAvailable))
      throw new Error('Invalid selected month interval');
    const count=CHART_VISIBLE_MONTHS[range];
    const padding=window>1?window-1:0;
    const cutoff=range==='custom'
      ? chartPreviousMonth(options.fromMonth,-padding)
      : count===null?firstAvailable:chartPreviousMonth(last,count+padding-1);
    const first=cutoff && firstAvailable && cutoff>firstAvailable?cutoff:firstAvailable;
    // Limit the selected history BEFORE invoking Calculator.
    // Extra lookback covers every rolling point in the visible viewport.
    const months=chartMonths(first,last);
    const zfIds=new Set(CHART_MINE_NAMES.slice(0,8).map(([id])=>key(id)));
    const groups=chosenMines.map(id=>{
      const option=mineOptions.find(o=>o.id===id);
      if(id==='all')return {id,label:'Все',mineValues:null};
      if(id==='zf')return {id,label:'ЗФ',mineValues:restrictMineValues(mineOptions
        .filter(o=>zfIds.has(key(o.id))).flatMap(chartMineValues))};
      return {id,label:option.label,mineValues:restrictMineValues(chartMineValues(option))};
    });
    // Forecasts are calculated for each *exact* displayed mine/class/name
    // filter, not copied from a dashboard-wide KPI or averaged percentages.
    // The independent 8-month prediction suffix NEVER changes displayed points.
    const reportingCoverage=buildReportingCoverage(prepared,pack,last).kpis[kpiId]||null;
    const lastIsReportMonth=last===reportingCoverage?.reportMonth;
    const strategy=forecastEngine.strategyRegistry.forKpi(kpiId);
    const percentNowcast=strategy?.policy==='reporting-month-components';
    const volumeNowcast=strategy?.policy==='reporting-month-volume';
    const forecastSupported=percentNowcast||volumeNowcast;
    const requestedMethod=options.forecastMethodId||
      (reportingCoverage?.coverageBasis==='observed-event-horizon'
        ?'observed-run-rate':forecastEngine.REPORTING_STRATEGY.defaultMethodId);
    // The method determines historical requirements; a run-rate nowcast
    // needs no extra months. Never re-run the visible history unnecessarily.
    const methodMonths=forecastEngine.REPORTING_METHODS?.[requestedMethod]?.historyMonths;
    const historyCount=forecastSupported&&lastIsReportMonth&&
      reportingCoverage?.reportMonthStatus==='incomplete'&&
      Number.isInteger(methodMonths)?methodMonths:0;
    const historyMonths=historyCount
      ?chartMonths(chartPreviousMonth(last,historyCount),chartPreviousMonth(last,1))
      : [];
    const series=[];
    for(const group of groups)for(const cls of chosenClasses){
      const scopedFilters={...base,equipmentClass:cls};
      if(group.mineValues)scopedFilters.mine=group.mineValues;
      const points=months.map(period=>chartResultPoint(
        kpiId,period,scopedFilters,prepared,pack,realSet.has(period)));
      const history=historyMonths.map(period=>chartResultPoint(
        kpiId,period,scopedFilters,prepared,pack,realSet.has(period)));
      const forecast=!forecastSupported?null:!lastIsReportMonth
        ? Object.freeze({
            forecastType:percentNowcast?'reporting-month-nowcast':
              'reporting-month-volume-nowcast',
            kpiId,metricId:volumeNowcast?kpiId:null,value:null,
            dataState:'insufficient',
            reason:reportingCoverage?.reportMonth
              ?'selected-report-month-mismatch':'report-month-missing',
            horizon:reportingCoverage?.reportMonth||null,
            observedValue:points.at(-1)?.value??null,
            coverageThrough:reportingCoverage?.coverageThrough||null
          })
        : forecastEngine.strategyRegistry.predictForKpi({
            kpiId,selectedMonth:last,reportingCoverage,
            current:points.at(-1),methodId:requestedMethod,
            points:percentNowcast?history.map(point=>({
              ...point,diagnostics:{partialCoverage:point.partialCoverage}
            })):history
          });
      series.push(Object.freeze({
        id:group.id+':'+cls,mineId:group.id,mineLabel:group.label,
        equipmentClass:cls,equipmentLabel:cls==='mounted'?'Навесное':'Стационарное',
        kpiId,points:Object.freeze(points),forecast
      }));
    }
    return Object.freeze({
      kpiId,selectedMonth:last,availableFrom:firstAvailable,availableTo:reportLast,
      computedFrom:first,range,window,
      mineOptions,equipmentNameOptions,selectedEquipmentNames:Object.freeze(equipmentNames||[]),
      selectedMines:Object.freeze(chosenMines),
      selectedClasses:Object.freeze(chosenClasses),series:Object.freeze(series),
      reportingCoverage,
      sources:pack.sources,status:reportStatus(pack)
    });
  }

  function buildKpiChartMultiData(kpiId,state={},mineIds=['all'],equipmentClasses=['stationary','mounted'],options={}) {
    const run = () => buildKpiChartMultiDataInner(kpiId,state,mineIds,equipmentClasses,options);
    return profiler ? profiler.measure('report.chart.multi', run) : run();
  }

  // A selected set of mines/equipment classes is a UNION, not the sum of
  // independent chart percentages or overlapping group totals.
  // PR7: an operational volume overlay with its own date grain. Do not feed
  // day/week totals to the KPI Calculator or use them as VBR/KTG denominators.
  function buildOperationalChartData(metric, scale, state={}, mineIds=['all'],
    equipmentClasses=['stationary','mounted'], options={}) {
    if (!operational?.series) throw new Error('Детализация Д / Н / М недоступна.');
    const entry = operational.METRICS[metric];
    if (!entry) throw new Error('Неизвестная операционная метрика.');
    const pack=collectSources();
    ensureCurrentSources(pack);
    const prepared=buildPrepared(pack);
    const filterOptions=filterCatalog(prepared);
    const resolved=resolveQuery(filterOptions,state);
    const mineOptions=chartMineOptions(filterOptions.mines);
    const chosenMines=Array.from(new Set(mineIds||[]));
    const chosenClasses=Array.from(new Set(equipmentClasses||[]));
    if(chosenMines.length>3 || chosenMines.some(v=>!mineOptions.some(x=>x.id===v)) ||
      chosenClasses.some(v=>!['stationary','mounted'].includes(v))) {
      throw new Error('Неизвестный рудник или класс оборудования.');
    }
    const zfIds=new Set(CHART_MINE_NAMES.slice(0,8).map(([id])=>key(id)));
    const groups=chosenMines.map(id=>{
      const option=mineOptions.find(o=>o.id===id);
      if(id==='all')return {id,label:'Все',mineValues:null};
      if(id==='zf')return {id,label:'ЗФ',mineValues:restrictMineValues(mineOptions
        .filter(o=>zfIds.has(key(o.id))).flatMap(chartMineValues))};
      return {id,label:option.label,mineValues:restrictMineValues(chartMineValues(option))};
    });
    const packSeries=operational.series({
      instances:pack.instances,metric,scale,groups,classes:chosenClasses,
      range:options.range||'1y',endMonth:resolved.periodOption?.month||null,
      window:options.window||1
    });
    const available=Boolean(pack.sources.find(s=>s.id===entry.source)?.available);
    if(scale!=='month')return Object.freeze({...packSeries,sourceAvailable:available});
    // A forecast must use a *separate full monthly history*, not the
    // visible 1M/3M/1Y projection nor day/week rolling trends.
    const coverage=buildReportingCoverage(prepared,pack,null)
      .kpis[metric==='inc'?'vbr':'total_labor']||null;
    const reportingMonth=coverage?.reportMonth||null;
    const visibleMonth=packSeries.end||null;
    const isReportingMonth=Boolean(reportingMonth&&visibleMonth===reportingMonth);
    // Always attach a forecast status in monthly mode: silently omitting the
    // object made unconfirmed datasets look like a broken SVG renderer.
    // Only certified/incomplete months need a complete historical projection.
    const needsHistory=coverage?.coverageBasis==='source-export-cutoff'||
      ['last-value','linear-trend'].includes(options.forecastMethodId);
    const completeHistory=isReportingMonth &&
      coverage?.reportMonthStatus==='incomplete'&&needsHistory
      ? operational.series({
          instances:pack.instances,metric,scale:'month',groups,
          classes:chosenClasses,range:'all',endMonth:reportingMonth,window:1
        })
      : null;
    const source=pack.sources.find(s=>s.id===entry.source);
    const revisions=Object.freeze([Object.freeze({
      datasetId:entry.source,revision:source?.activeRevision??null,
      contentHash:source?.contentHash||null
    })]);
    const fullById=new Map((completeHistory?.series||[]).map(row=>[row.id,row]));
    const series=packSeries.series.map(row=>{
      const target=row.points.at(-1);
      const full=fullById.get(row.id);
      const result=isReportingMonth && target?.period===reportingMonth
        ? forecastEngine.strategyRegistry.predictForMetric({
            metricId:metric,selectedMonth:reportingMonth,
            reportingCoverage:coverage,
            current:target&&{value:target.value,dataState:target.dataState},
            points:(full?.points||[]).filter(p=>p.period<reportingMonth),
            methodId:options.forecastMethodId
          })
        : Object.freeze({
            forecastType:'reporting-month-volume-nowcast',
            metricId:metric,value:null,dataState:'insufficient',
            reason:reportingMonth?'selected-report-month-mismatch':'report-month-missing',
            horizon:reportingMonth,observedValue:target?.value??null
          });
      return Object.freeze({...row,forecast:Object.freeze({
        ...result,sourceRevisions:revisions
      })});
    });
    return Object.freeze({...packSeries,series:Object.freeze(series),
      reportingCoverage:coverage,sourceAvailable:available});
  }

  function buildKpiSelectionSummaryInner(kpiId,state={},mineIds=['all'],
      equipmentClasses=['stationary','mounted'],interval={}) {
    if(!['vbr','ktg'].includes(kpiId))
      throw new Error('Range composition is not defined for this KPI');
    const pack=collectSources(),prepared=buildPrepared(pack);
    const options=filterCatalog(prepared),resolved=resolveQuery(options,state);
    const mineOptions=chartMineOptions(options.mines);
    const selected=Array.from(new Set(mineIds||[]));
    const classes=Array.from(new Set(equipmentClasses||[]));
    if(!selected.length||selected.length>3||
      selected.some(id=>!mineOptions.some(option=>option.id===id))||
      !classes.length||classes.some(v=>!['mounted','stationary'].includes(v)))
      throw new Error('Invalid mine or equipment selection');
    const equipmentNameOptions=chartEquipmentNames(prepared,classes);
    const equipmentNames=selectedEquipmentNames(interval.equipmentNames,equipmentNameOptions);
    const reportLast=resolved.periodOption?.month||null;
    const available=options.periods.filter(p=>p.id!=='latest'&&p.month&&
      (!reportLast||p.month<=reportLast)).map(p=>p.month);
    const firstAvailable=available.at(-1);
    const from=interval.fromMonth,to=interval.toMonth;
    if(!/^\d{4}-\d{2}$/.test(String(from||''))||
      !/^\d{4}-\d{2}$/.test(String(to||''))||from>to||
      from<firstAvailable||to>reportLast)
      throw new Error('Invalid summary interval');
    const scope={...resolved.calculatorQuery.filters};
    delete scope.mine;delete scope.equipmentClass;delete scope.equipmentName;
    if(equipmentNames)scope.equipmentName=equipmentNames;
    // 'Все' absorbs all other mine buttons. 'ЗФ' is expanded to physical
    // Zapolyarny mines; Set prevents overlap with individual selections.
    if(!selected.includes('all')) {
      const zfIds=new Set(CHART_MINE_NAMES.slice(0,8).map(([id])=>key(id)));
      const merged=new Set();
      for(const id of selected) {
        if(id==='zf') {
          for(const option of mineOptions)if(zfIds.has(key(option.id)))
            for(const value of chartMineValues(option))merged.add(value);
        }else for(const value of chartMineValues(mineOptions.find(option=>option.id===id)))
          merged.add(value);
      }
      scope.mine=restrictMineValues(Array.from(merged));
    }
    scope.equipmentClass=classes.length===1?classes[0]:classes;
    const result=calculateResults(prepared,pack,{
      period:{start:from+'-01',end:to+'-01'},filters:scope
    },[kpiId]).results[kpiId];
    return Object.freeze({kpiId,fromMonth:from,toMonth:to,
      mineIds:Object.freeze(selected),equipmentClasses:Object.freeze(classes),
      result,filters:Object.freeze(scope)});
  }

  function buildKpiSelectionSummary(kpiId,state={},mineIds=['all'],equipmentClasses=['stationary','mounted'],interval={}) {
    const run = () => buildKpiSelectionSummaryInner(kpiId,state,mineIds,equipmentClasses,interval);
    return profiler ? profiler.measure('report.chart.summary', run) : run();
  }

  function invalidate() {
    resetCalculationCaches();
  }

  function rejectDuringHeavyJob() {
    if(['TEST_15_PR324','TEST_16_PR326','TEST_17_PR332','TEST_18_PR335'].includes(globalThis.RECLASSIFIER_BUILD?.testLabel) &&
        globalThis.ReclassifierHeavyJobGate?.busy?.()) {
      const error=new Error('Завершите импорт или экспорт XLSX перед расчётом KPI.');
      error.code='RECLASSIFIER_KPI_HEAVY_JOB_ACTIVE';
      throw error;
    }
  }
  // PR5: async Report Snapshot is produced by the same Report Service in the
  // dedicated Worker, without introducing any independent KPI calculations.
  async function buildSnapshotAsync(state = {}, options = {}) {
    rejectDuringHeavyJob();
    if (options.stage !== 'primary' && !options.forceRecalculate) {
      const cached = getCachedSnapshot(state);
      if (cached) {
        options.onProgress?.({percent:100,label:'Снимок KPI восстановлен из кэша'});
        return cached;
      }
    }
    const background = globalThis.ReclassifierKpiBackgroundJobs;
    if (!background?.runReport) throw new Error('Фоновый Report Service недоступен.');
    const pack = collectSources();
    const signature = ensureCurrentSources(pack);
    const sourceIds = ['itsm_data','mobile_brigade_data','drivers','combined'];
    const tracked = sourceIds.map(id => pack.instances[id] || null);
    const result = await background.runReport({
      sourcePack: pack, signature,
      state, stage: options.stage === 'primary' ? 'primary' : 'full',
      forceRecalculate:options.forceRecalculate === true,
      priority: options.priority ?? 2, signal: options.signal || null,
      onProgress: options.onProgress || null
    });
    const current = collectSources();
    if (sourceSignature(current.sources) !== signature ||
        !tracked.every((source,index) => source === (current.instances[sourceIds[index]] || null))) {
      const error = new Error('Исходные Dataset обновлены во время расчёта отчёта.');
      error.code = 'RECLASSIFIER_KPI_STALE_TASK';
      throw error;
    }
    const snapshot = result.snapshot;
    if (snapshot?.diagnostics?.sourceSignature !== signature ||
        snapshot?.diagnostics?.stage !== (options.stage === 'primary' ? 'primary' : 'full')) {
      throw new Error('Несогласованный ответ фонового Report Service.');
    }
    // Async Worker results are already fully calculated; reuse the same
    // verified Snapshot on subsequent dashboard/passport visits in this session.
    // PR5 adds durable persistence with a separate SQLite revision contract.
    if (options.stage !== 'primary') {
      remember(snapshotCache,stateCacheKey(state),snapshot,MAX_SNAPSHOTS);
      verifiedSqliteStamp=sqliteSnapshotStamp();
      persistVerifiedSnapshot(state,snapshot);
    }
    return snapshot;
  }

  // PR4: opt-in asynchronous computation for standalone KPI queries.
  // PR5 will adopt this path with staged UI and a policy for large source packs.
  async function calculateKpiAsync(query, options = {}) {
    rejectDuringHeavyJob();
    if (!query || !Array.isArray(options.kpis) && options.kpis != null) {
      throw new TypeError('Некорректный запрос фонового расчёта KPI.');
    }
    const background = globalThis.ReclassifierKpiBackgroundJobs;
    if (!background?.runQuery) throw new Error('Фоновый вычислительный сервис KPI недоступен.');
    const pack = collectSources();
    const signature = ensureCurrentSources(pack);
    const tracked = ['itsm_data','mobile_brigade_data','drivers','combined']
      .map(id => pack.instances[id] || null);
    const result = await background.runQuery({
      sourcePack: pack, signature, query,
      kpis: options.kpis || IMPLEMENTED_KPIS,
      priority: options.priority ?? 2,
      key: options.key ?? null,
      signal: options.signal || null,
      trace: Boolean(options.trace),
      onProgress: options.onProgress || null
    });
    const current = collectSources();
    const currentInputs = ['itsm_data','mobile_brigade_data','drivers','combined']
      .map(id => current.instances[id] || null);
    if (sourceSignature(current.sources) !== signature ||
        !tracked.every((item, i) => item === currentInputs[i])) {
      const error = new Error('Исходные Dataset изменились во время фонового расчёта KPI.');
      error.code = 'RECLASSIFIER_KPI_STALE_TASK';
      throw error;
    }
    return result;
  }

  function setReportingCoverage(id,declaration=null,confirmed=false) {
    const manager=globalThis.ReclassifierReportingCoverageManager;
    if(!manager?.set)throw new Error('Менеджер покрытия источника недоступен.');
    const result=manager.set(id,declaration,confirmed);
    invalidate();
    return result;
  }

  const api = Object.freeze({
    implementedKpis: IMPLEMENTED_KPIS,
    buildSnapshot,
    buildSnapshotAsync,
    getCachedSnapshot,
    buildKpiChartData,
    buildKpiChartMultiData,
    buildOperationalChartData,
    setReportingCoverage,
    buildKpiSelectionSummary,
    calculateKpiAsync,
    invalidate
  });

  globalThis.ReclassifierReliabilityReportService = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
