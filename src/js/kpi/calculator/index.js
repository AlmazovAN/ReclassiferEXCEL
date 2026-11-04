// FILE CONTRACT: registry/orchestrator for pure KPI formulas.
// Input: prepared subject component bundle + query.
// Output: independent immutable KPI Results. This is not a Report Snapshot.

(() => {
  'use strict';

  const common = globalThis.ReclassifierKpiCalculatorCommon;
  const profiler=globalThis.ReclassifierPerformanceProfiler;
  const vbr = globalThis.ReclassifierKpiCalculateVbr;
  const ktg = globalThis.ReclassifierKpiCalculateKtg;
  const sla = globalThis.ReclassifierKpiCalculateSla;
  const classification = globalThis.ReclassifierKpiCalculateClassificationQuality;
  const classificationCgps = globalThis.ReclassifierKpiCalculateClassificationQualityCgps;
  const labor = globalThis.ReclassifierKpiCalculateLabor;
  const problemManagement = globalThis.ReclassifierKpiCalculateProblemManagement;

  if (!common?.version || !vbr?.calculate || !ktg?.calculate || !sla?.calculate ||
      !classification?.calculate || !classificationCgps?.calculate || !labor?.calculateTotal ||
      !problemManagement?.calculateAbsolute) {
    throw new Error('KPI Calculator modules are incomplete.');
  }

  const declarative=globalThis.ReclassifierKpiDeclarative;
  const calculators = Object.freeze({
    vbr: (families, query) => vbr.calculate(families, query),
    ktg: (families, query) => ktg.calculate(families, query),
    sla: (families, query) => sla.calculate(families, query),
    classification_quality: (families, query) => classification.calculate(families, query),
    classification_quality_cgps: (families, query) => classificationCgps.calculate(families, query),
    total_labor: (families, query) => labor.calculateTotal(families, query),
    avr_labor: (families, query) => labor.calculateAvr(families, query),
    avr_share: (families, query) => labor.calculateAvrShare(families, query),
    maintenance_labor: (families, query) => labor.calculateMaintenance(families, query),
    corrective_labor: (families, query) => labor.calculateCorrective(families, query),
    reactive_share: (families, query) => labor.calculateReactiveShare(families, query),
    problem_linked_tasks: (families, query) => problemManagement.calculateLinkedTasks(families, query),
    problem_task_coverage: (families, query) => problemManagement.calculateTaskCoverage(families, query),
    problem_active_count: (families, query) => problemManagement.calculateActiveProblemCount(families, query),
    problem_coverage_absolute: (families, query) => problemManagement.calculateAbsolute(families, query),
    problem_coverage_relative: (families, query) => problemManagement.calculateRelative(families, query),
    ...Object.fromEntries((declarative?.definitions||[]).map(d=>
      [d.id,(families,query)=>declarative.calculate(d.id,families,query)]))
  });

  function calculateOne(kpiId, preparedBundle = {}, query = {}) {
    const calculator = calculators[kpiId];
    if (!calculator) throw new Error('Unknown KPI calculator: ' + String(kpiId));
    return calculator(preparedBundle.families || preparedBundle, query);
  }

  function calculate(preparedBundle = {}, request = {}) {
    const ids = Array.isArray(request.kpis) && request.kpis.length
      ? request.kpis
      : Object.keys(calculators);
    const query = {
      period: request.period,
      filters: request.filters || {}
    };
    const results = {};
    for (const id of ids) {
      const audit = request.trace?.forKpi?.(id) || null;
      const call = () => calculateOne(id, preparedBundle, audit ? { ...query, audit } : query);
      results[id] = profiler ? profiler.measure('calculator.kpi', call) : call();
      profiler?.count('calculator.kpi.calls');
    }

    return Object.freeze({
      version: common.version,
      architecture: 'pure-kpi-results',
      preparationVersion: preparedBundle.version || null,
      query: common.normalizedQuery(query),
      results: Object.freeze(results)
    });
  }

  const api = Object.freeze({
    version: common.version,
    ids: Object.freeze(Object.keys(calculators)),
    calculateOne,
    calculate
  });

  globalThis.ReclassifierKpiCalculator = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
