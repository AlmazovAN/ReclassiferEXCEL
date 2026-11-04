// FILE CONTRACT: explicit, confirmed commit of read-only PR3–PR5 previews.
// Owns: materialization, KPI Source rebuild and persistence orchestration.
// Reads: validated preview + its per-service assertCurrent(), Active Runtime.
// Writes: one atomic legacy Dataset Pipeline batch OR one SQLite transaction.
// No UI, no silent synchronization of legacy Dataset Store while SQLite is open.
(() => {
  'use strict';

  function create(options = {}) {
    const runtime = options.runtime || globalThis.ReclassifierRuntimeDataRepository;
    const schema = options.schema || globalThis.ReclassifierItsmDatasetSchema;
    const kpi = options.kpi || globalThis.ReclassifierKpiSource;
    const materializer = options.materializer || globalThis.ReclassifierRecalculationMaterializer;
    const repository = options.repository || globalThis.ReclassifierDatabaseRepository;
    const lifecycle = options.lifecycle || globalThis.ReclassifierDatasetLifecycleManager;
    const catalog = options.catalog || globalThis.ReclassifierDatasetCatalog;
    if (!runtime?.mode || !runtime?.get || !schema?.fields ||
        !kpi?.aggregateItsmDataset || !kpi?.datasetPayload ||
        !materializer?.materialize || !catalog?.get) {
      throw new Error('Recalculation COMMIT: необходимые контракты недоступны.');
    }

    function makeKpi(itsm) {
      const fields = itsm.meta?.fields || schema.fields;
      const aggregate = kpi.aggregateItsmDataset(fields, itsm.records, itsm.fullDataset);
      const payload = kpi.datasetPayload(aggregate, itsm.records.length);
      const instance = runtime.get('kpi_source');
      return {
        id: 'kpi_source',
        records: payload.records,
        state: {
          schemaVersion: kpi.schemaVersion,
          fields: Array.from(payload.fields),
          columns: Array.from(payload.columns),
          sourceRows: itsm.records.length,
          aggregateRows: payload.records.length,
          earliestSourceDate: payload.earliestPeriod || null,
          latestSourceDate: payload.latestPeriod || null,
          sourceKind: 'recalculated-from-itsm'
        },
        freshnessFrom: payload.earliestPeriod || null,
        freshnessTo: payload.latestPeriod || null,
        instance: {
          id: 'kpi_source',
          file: null,
          records: payload.records,
          validation: { status: 'valid', errors: [], warnings: [] },
          meta: Object.assign({}, instance?.meta || {}, {
            schemaVersion: kpi.schemaVersion,
            fields: Array.from(payload.fields),
            columns: Array.from(payload.columns),
            fieldCount: payload.fields.length,
            normalizedRows: payload.records.length,
            sourceRows: itsm.records.length,
            earliestSourceDate: payload.earliestPeriod || null,
            latestSourceDate: payload.latestPeriod || null,
            sourceType: 'recalculation'
          })
        }
      };
    }

    function previewChangeGroups(plan) {
      if (!plan || plan.kind !== 'recalculation-preview' ||
          plan.canCommit !== false || !Array.isArray(plan.datasets) ||
          plan.datasets.some(item => !item || !['itsm_data','mobile_brigade_data'].includes(item.datasetId) ||
            !Array.isArray(item.changes) || item.changed !== item.changes.length)) {
        throw new Error('Recalculation COMMIT: неверный план предпросмотра.');
      }
      const ids = new Set();
      return plan.datasets.filter(item => {
        if (ids.has(item.datasetId)) throw new Error('Recalculation COMMIT: повторный Dataset.');
        ids.add(item.datasetId);
        return item.changes.length > 0;
      });
    }

    function legacyCommit(prepared, companion, plan, completedAt) {
      if (!lifecycle?.activateBatch || !lifecycle?.state) {
        throw new Error('Recalculation COMMIT: HTML Dataset Lifecycle недоступен.');
      }
      runtime.assertLegacyWriteAllowed?.();
      const expectedRevision = id => {
        const state = lifecycle.state(id);
        if (!state || !state.active) return 0;
        // Active metadata is portable across HTML snapshots; it is not a
        // SQLite registry revision. Store its own monotonic legacy counter.
        return Number(state.active.meta?.activeRevision || 0) +
          (prepared.some(item => item.id === id) ||
            (companion && id === 'kpi_source') ? 1 : 0);
      };
      const changes = prepared.map(item => {
        const original = item.current;
        const def = catalog.get(item.id);
        const deps = {};
        for (const dependency of def.dependencies || []) deps[dependency] = expectedRevision(dependency);
        return {
          id: item.id,
          file: null,
          records: item.draft.records,
          fullDataset: item.draft.fullDataset,
          validation: Object.assign({}, original.validation),
          meta: Object.assign({}, original.meta, {
            loadedAt: completedAt,
            activeRevision: expectedRevision(item.id),
            lastRecalculatedAt: completedAt,
            lastRecalculationAsOfDate: plan.asOfDate,
            recalculationRulesVersion: item.rulesVersion,
            dependencyRevisions: deps,
            sourceType: 'recalculation',
            recalculationHistory: [
              ...(original.meta?.recalculationHistory || []),
              { at: completedAt, asOfDate: plan.asOfDate, changed: item.changes.length }
            ].slice(-20)
          })
        };
      });
      if (companion) {
        companion.instance.meta.loadedAt = completedAt;
        companion.instance.meta.activeRevision = expectedRevision('kpi_source');
        companion.instance.meta.dependencyRevisions = {
          itsm_data: expectedRevision('itsm_data')
        };
        companion.instance.meta.recalculationHistory = [
          ...(companion.instance.meta.recalculationHistory || []),
          { at: completedAt, asOfDate: plan.asOfDate,
            derivedFrom: 'itsm_data', changed: companion.records.length }
        ].slice(-20);
        companion.instance.meta.lastRecalculatedAt = completedAt;
        companion.instance.meta.lastRecalculationAsOfDate = plan.asOfDate;
        changes.push(companion.instance);
      }
      lifecycle.activateBatch(changes);
      runtime.invalidate?.(changes.map(item => item.id));
      return Object.freeze({
        mode: 'legacy',
        changedDatasetIds: Object.freeze(changes.map(item => item.id)),
        results: Object.freeze(changes.map(item => Object.freeze({
          datasetId: item.id,
          rowsAfter: item.records.length,
          rowsUpdated: prepared.find(x => x.id === item.id)?.changes.length ??
            item.records.length
        })))
      });
    }

    function sqliteCommit(prepared, companion, plan) {
      if (!repository?.applyRecalculationBatch || !repository?.getDatasetRegistry) {
        throw new Error('Recalculation COMMIT: SQLite не поддерживает атомарный перерасчёт.');
      }
      const changes = prepared.map(item => {
        const reg = repository.getDatasetRegistry(item.id);
        return {
          id: item.id,
          changes: item.changes,
          rulesVersion: item.rulesVersion,
          expectedRevision: Number(reg?.active_revision || 0)
        };
      });
      return repository.applyRecalculationBatch(
        changes,
        companion ? {
          id: 'kpi_source',
          records: companion.records,
          state: companion.state,
          freshnessFrom: companion.freshnessFrom,
          freshnessTo: companion.freshnessTo
        } : null,
        { asOfDate: plan.asOfDate }
      );
    }

    function apply(plan, config = {}) {
      if (config.confirmed !== true) {
        throw new Error('Recalculation COMMIT: требуется явное подтверждение пользователя.');
      }
      if (typeof config.assertCurrent !== 'function') {
        throw new Error('Recalculation COMMIT: проверка актуальности предпросмотра обязательна.');
      }
      const groups = previewChangeGroups(plan);
      config.assertCurrent(plan);
      if (runtime.mode() !== plan.mode) {
        throw new Error('Recalculation COMMIT: источник Runtime изменился.');
      }
      if (!groups.length) return Object.freeze({
        mode: plan.mode, noOp: true, changedDatasetIds: Object.freeze([]),
        results: Object.freeze([])
      });

      // Validate all source rows and build KPI before the first persistent
      // write. An invalid patch must leave BOTH stores unchanged.
      const prepared = groups.map(group => {
        const current = runtime.get(group.datasetId);
        if (!current) throw new Error('Recalculation COMMIT: Dataset отсутствует.');
        const draft = materializer.materialize(group.datasetId,
          current, group.changes, schema);
        return {
          id: group.datasetId,
          current,
          changes: group.changes,
          draft,
          rulesVersion: config.rulesVersions?.[group.datasetId] || null
        };
      });
      const itsm = prepared.find(item => item.id === 'itsm_data');
      const companion = itsm ? makeKpi({
        records: itsm.draft.records,
        fullDataset: itsm.draft.fullDataset,
        meta: itsm.current.meta
      }) : null;
      config.assertCurrent(plan);
      const completedAt = new Date().toISOString();
      return plan.mode === 'sqlite'
        ? sqliteCommit(prepared, companion, plan)
        : legacyCommit(prepared, companion, plan, completedAt);
    }
    return Object.freeze({ apply });
  }

  globalThis.ReclassifierRecalculationCommit = Object.freeze({
    version: '1.0.0',
    create
  });
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = globalThis.ReclassifierRecalculationCommit;
  }
})();
