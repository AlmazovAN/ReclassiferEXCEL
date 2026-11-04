// FILE CONTRACT: route-neutral orchestration of PR3–PR6 recalculation.
// Purpose: prepare one staged MB -> ITSM preview and explicitly commit that
// exact plan. No file import or silent write; UI owns user confirmation.
// Reads: Active Runtime, ITSM/MB subject adapters and Recalculation Core.
// Writes: only through ReclassifierRecalculationCommit after confirmation.
(() => {
  'use strict';

  const IDS = Object.freeze(['mobile_brigade_data', 'itsm_data']);
  const RULES = Object.freeze({
    mobile_brigade_data: '1.5.0',
    itsm_data: '1.2.1'
  });

  function create(options = {}) {
    const runtime = options.runtime || globalThis.ReclassifierRuntimeDataRepository;
    const coreApi = options.core || globalThis.ReclassifierRecalculationCore;
    const itsmApi = options.itsm || globalThis.ReclassifierItsmRecalculation;
    const mbApi = options.mb || globalThis.ReclassifierMobileBrigadeRecalculation;
    const commitApi = options.commit || globalThis.ReclassifierRecalculationCommit;
    if (!runtime?.get || !runtime?.mode || !coreApi?.create ||
        !itsmApi?.create || !mbApi?.create || !commitApi?.create) {
      throw new Error('Recalculation: необходимые модули перерасчёта недоступны.');
    }
    const engine = coreApi.create({runtime});
    const commit = commitApi.create({runtime});
    const tickets = itsmApi.create({runtime});
    const brigades = mbApi.create({runtime});
    const prepared = new WeakMap();
    const applied = new WeakSet();

    async function prepare(ids, config = {}) {
      if (!Array.isArray(ids) || !ids.length ||
          ids.some(id => !IDS.includes(id)) ||
          new Set(ids).size !== ids.length) {
        throw new Error('Recalculation: выберите ITSM и/или Мобильные бригады.');
      }
      const steps = [];
      // Domain staging order is required: itsmCreatedAt from ITSM is refreshed
      // first, then ITSM derived calculations read the staged MB task rows.
      if (ids.includes('mobile_brigade_data')) steps.push(brigades.createStep());
      if (ids.includes('itsm_data')) steps.push(tickets.createStep());
      const plan = await engine.preview({
        steps,
        sampleLimit: config.sampleLimit === undefined ? 10 : config.sampleLimit,
        asOfDate: config.asOfDate,
        signal: config.signal,
        onProgress: config.onProgress
      });
      prepared.set(plan, true);
      return plan;
    }

    // A full supported recalculation must never silently skip a missing
    // persisted target. Other catalogues are read-only inputs, not targets:
    // they have no supported retrospective recomputation adapter.
    function describeAll() {
      const missing = IDS.filter(id => {
        const instance = runtime.get(id);
        return !instance || !Array.isArray(instance.records) ||
          instance.records.length === 0 ||
          instance.validation?.status === 'invalid';
      });
      return Object.freeze({
        supported: IDS,
        available: Object.freeze(IDS.filter(id => !missing.includes(id))),
        missing: Object.freeze(missing),
        ready: missing.length === 0,
        includesKpiSource: true
      });
    }

    async function prepareAll(config = {}) {
      const coverage = describeAll();
      if (!coverage.ready) {
        throw new Error('Recalculation: полный пересчёт невозможен — ' +
          'отсутствуют или пусты обязательные Dataset: ' +
          coverage.missing.join(', ') + '. Данные не изменены.');
      }
      // The same guarded plan/commit pipeline is used for partial and full
      // runs: MB -> ITSM; KPI Source is rebuilt if ITSM actually changes.
      return prepare(IDS, config);
    }

    function assertCurrent(plan) {
      if (!prepared.has(plan) || applied.has(plan)) {
        throw new Error('Recalculation: предпросмотр уже применён или не принадлежит текущей операции.');
      }
      return engine.assertCurrent(plan);
    }

    function apply(plan, config = {}) {
      if (config.confirmed !== true) {
        throw new Error('Recalculation: требуется подтверждение применения изменений.');
      }
      assertCurrent(plan);
      const result = commit.apply(plan, {
        confirmed: true,
        assertCurrent,
        rulesVersions: RULES
      });
      applied.add(plan);
      return result;
    }

    return Object.freeze({ prepare, prepareAll, describeAll, apply, assertCurrent });
  }

  globalThis.ReclassifierRecalculationWorkspace = Object.freeze({
    version: '1.0.0',
    supported: IDS,
    create
  });
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = globalThis.ReclassifierRecalculationWorkspace;
  }
})();
