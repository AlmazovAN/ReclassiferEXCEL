// FILE CONTRACT: pure helpers for KPI calculation-component preparation.
// Purpose: provide deterministic period/group/table primitives shared by subject preparers.
// Owns: component-table shape, month routing, stable grouping and sorting helpers.
// Reads: in-memory semantic facts only.
// Writes: nothing.
// Must not: access UI, SQLite, XLSX or calculate final KPI values.

(() => {
  'use strict';

  const VERSION = '1.0.0';
  const sourceFacts = globalThis.ReclassifierKpiSourceFacts;
  if (!sourceFacts?.text) {
    throw new Error('KPI Source Facts must be loaded before KPI Preparation Common.');
  }

  function monthPeriod(value) {
    if (value instanceof Date && !Number.isNaN(value.getTime())) {
      return Object.freeze({
        year: value.getFullYear(),
        month: value.getMonth() + 1,
        period: String(value.getFullYear()) + '-' +
          String(value.getMonth() + 1).padStart(2, '0') + '-01'
      });
    }

    const normalized = sourceFacts.text(value);
    if (!normalized) return null;

    let match = normalized.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (match) {
      const year = Number(match[1]);
      const month = Number(match[2]);
      if (month >= 1 && month <= 12) {
        return Object.freeze({
          year,
          month,
          period: String(year) + '-' + String(month).padStart(2, '0') + '-01'
        });
      }
      return null;
    }

    match = normalized.match(/^(\d{1,2})[.\/-](\d{1,2})[.\/-](\d{4}|\d{2})/);
    if (match) {
      const year = match[3].length === 2 ? Number('20' + match[3]) : Number(match[3]);
      const month = Number(match[2]);
      if (month >= 1 && month <= 12) {
        return Object.freeze({
          year,
          month,
          period: String(year) + '-' + String(month).padStart(2, '0') + '-01'
        });
      }
    }

    const parsed = new Date(normalized);
    if (Number.isNaN(parsed.getTime())) return null;
    return Object.freeze({
      year: parsed.getFullYear(),
      month: parsed.getMonth() + 1,
      period: String(parsed.getFullYear()) + '-' +
        String(parsed.getMonth() + 1).padStart(2, '0') + '-01'
    });
  }

  function groupKey(values) {
    return JSON.stringify(Array.from(values || [], value =>
      value === null || value === undefined ? null : String(value)
    ));
  }

  function compareBy(fields) {
    return (left, right) => {
      for (const field of fields) {
        const a = left?.[field];
        const b = right?.[field];
        if (a === b) continue;
        if (typeof a === 'number' && typeof b === 'number') return a - b;
        const result = String(a ?? '').localeCompare(String(b ?? ''), 'ru');
        if (result !== 0) return result;
      }
      return 0;
    };
  }

  function componentTable(id, grain, rows, meta = {}) {
    const grainFields = Object.freeze(Array.from(grain || []));
    const frozenRows = Object.freeze(
      Array.from(rows || [], row => Object.freeze({ ...row }))
        .sort(compareBy(grainFields))
    );
    return Object.freeze({
      id,
      version: VERSION,
      grain: grainFields,
      rows: frozenRows,
      rowCount: frozenRows.length,
      meta: Object.freeze({ ...meta })
    });
  }

  function addNumber(row, field, value) {
    if (typeof value === 'number' && Number.isFinite(value)) {
      row[field] = (row[field] || 0) + value;
      return true;
    }
    return false;
  }

  const api = Object.freeze({
    version: VERSION,
    monthPeriod,
    groupKey,
    compareBy,
    componentTable,
    addNumber
  });

  globalThis.ReclassifierKpiPreparationCommon = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
