// FILE CONTRACT: immutable Report Snapshot.
// Purpose: freeze one coherent report calculation for WEB/PDF consumers.
// Owns: selected query, KPI Results, chart/detail breakdowns, source provenance and calculation timestamp.
// Reads: already calculated values supplied by the report service.
// Writes: nothing.
// Must not: read Dataset storage, calculate KPI formulas, render UI or mutate inputs.

(() => {
  'use strict';

  const SCHEMA_VERSION = '1.0.0';

  function deepFreeze(value) {
    if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
    Object.values(value).forEach(deepFreeze);
    return Object.freeze(value);
  }

  function create(input = {}) {
    const calculatedAt = String(input.calculatedAt || '').trim();
    if (!calculatedAt) throw new Error('Report Snapshot requires calculatedAt.');

    const snapshot = {
      schemaVersion: SCHEMA_VERSION,
      type: 'reliability-report',
      status: input.status || 'partial',
      calculatedAt,
      preparationVersion: input.preparationVersion || null,
      calculatorVersion: input.calculatorVersion || null,
      query: input.query || {},
      filters: input.filters || {},
      results: input.results || {},
      // Optional Step 8 runtime evidence; older WEB/PDF callers may omit it.
      executionTrace: input.executionTrace || null,
      // Certified reporting-period coverage, separate from calculatedAt and KPI facts.
      reportingCoverage: input.reportingCoverage || null,
      // Additive Step 3 extension; older Snapshot consumers remain supported.
      kpiView: input.kpiView || null,
      series: input.series || {},
      breakdowns: input.breakdowns || {},
      sources: Array.isArray(input.sources) ? input.sources : [],
      diagnostics: input.diagnostics || {}
    };

    return deepFreeze(snapshot);
  }

  const api = Object.freeze({
    schemaVersion: SCHEMA_VERSION,
    deepFreeze,
    create
  });

  globalThis.ReclassifierReportSnapshot = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
