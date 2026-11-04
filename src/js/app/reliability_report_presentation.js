// FILE CONTRACT: pure presentation-only reliability report projections.
// Purpose: identical coverage evidence and monthly gaps in dashboard/PDF.
// Reads: one immutable Report Snapshot. No Dataset, SQL or KPI calculations.
(() => {
  'use strict';

  function available(result) {
    return result?.dataState === 'available' && Number.isFinite(result.value);
  }

  function summary(snapshot) {
    const results = Object.values(snapshot?.results || {});
    const sources = Array.from(snapshot?.sources || []);
    const months = Array.from(snapshot?.series?.monthly || []);
    return Object.freeze({
      kpiAvailable: results.filter(available).length,
      kpiTotal: results.length,
      sourceAvailable: sources.filter(source => source?.available === true).length,
      sourceTotal: sources.length,
      monthCount: months.length,
      status: snapshot?.status || 'empty'
    });
  }

  // Retain every selected month in its original position. Missing KPI data is
  // null, not zero and not an interpolated observation.
  function monthly(snapshot, field) {
    return Object.freeze(Array.from(snapshot?.series?.monthly || [], row => Object.freeze({
      period: row?.period || null,
      label: row?.label || row?.period || '—',
      value: available(row?.[field]) ? row[field].value : null,
      reason: available(row?.[field]) ? null : row?.[field]?.reason || 'not-available'
    })));
  }

  function segments(points) {
    const runs = [];
    let current = [];
    Array.from(points || []).forEach((point, index) => {
      if (!Number.isFinite(point?.value)) {
        if (current.length) runs.push(Object.freeze(current));
        current = [];
        return;
      }
      current.push(Object.freeze({
        index,
        period: point.period || null,
        value: point.value
      }));
    });
    if (current.length) runs.push(Object.freeze(current));
    return Object.freeze(runs);
  }

  const api = Object.freeze({ version: '1.0.0', available, summary, monthly, segments });
  globalThis.ReclassifierReliabilityPresentation = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
