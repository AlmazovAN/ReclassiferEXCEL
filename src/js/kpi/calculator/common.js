// FILE CONTRACT: pure helpers for KPI formulas and KPI Result construction.
// Purpose: select prepared component rows, validate filters/periods and build immutable KPI Results.
// Reads: prepared component tables supplied by callers only.
// Writes: nothing.
// Must not: access source Datasets, UI, SQLite, XLSX or current time.

(() => {
  'use strict';

  const VERSION = '1.0.0';

  function text(value) {
    return String(value ?? '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
  }

  function key(value) {
    return text(value).toLocaleLowerCase('ru-RU');
  }

  function monthId(value) {
    const normalized = text(value);
    if (!normalized) return null;
    let match = normalized.match(/^(\d{4})-(\d{2})(?:-(\d{2}))?/);
    if (match) {
      const month = Number(match[2]);
      return month >= 1 && month <= 12 ? match[1] + '-' + match[2] : null;
    }
    match = normalized.match(/^(\d{1,2})[.\/-](\d{1,2})[.\/-](\d{4}|\d{2})/);
    if (match) {
      const year = match[3].length === 2 ? '20' + match[3] : match[3];
      const month = Number(match[2]);
      return month >= 1 && month <= 12 ? year + '-' + String(month).padStart(2, '0') : null;
    }
    const parsed = new Date(normalized);
    if (Number.isNaN(parsed.getTime())) return null;
    return parsed.getFullYear() + '-' + String(parsed.getMonth() + 1).padStart(2, '0');
  }

  function nextMonth(id) {
    const match = String(id || '').match(/^(\d{4})-(\d{2})$/);
    if (!match) return null;
    let year = Number(match[1]);
    let month = Number(match[2]) + 1;
    if (month === 13) {
      year += 1;
      month = 1;
    }
    return String(year) + '-' + String(month).padStart(2, '0');
  }

  function normalizePeriod(period) {
    if (period === null || period === undefined || period === '') {
      return Object.freeze({ kind: 'all', months: Object.freeze([]), start: null, end: null });
    }

    if (typeof period === 'string' || period instanceof Date) {
      const month = monthId(period);
      if (!month) return Object.freeze({ kind: 'invalid', months: Object.freeze([]), start: null, end: null });
      return Object.freeze({ kind: 'single-month', months: Object.freeze([month]), start: month, end: month });
    }

    if (typeof period === 'object') {
      const start = monthId(period.start ?? period.from ?? period.period);
      const end = monthId(period.end ?? period.to ?? period.period);
      if (!start || !end || start > end) {
        return Object.freeze({ kind: 'invalid', months: Object.freeze([]), start, end });
      }
      const months = [];
      let current = start;
      let guard = 0;
      while (current && current <= end && guard < 1200) {
        months.push(current);
        current = nextMonth(current);
        guard += 1;
      }
      return Object.freeze({
        kind: months.length === 1 ? 'single-month' : 'range',
        months: Object.freeze(months),
        start,
        end
      });
    }

    return Object.freeze({ kind: 'invalid', months: Object.freeze([]), start: null, end: null });
  }

  function normalizedQuery(query = {}) {
    return Object.freeze({
      period: normalizePeriod(query.period),
      filters: Object.freeze({ ...(query.filters || {}) })
    });
  }

  function activeFilterEntries(filters = {}) {
    return Object.entries(filters).filter(([, value]) => {
      if (value === null || value === undefined || value === '') return false;
      if (Array.isArray(value)) return value.length > 0;
      return key(value) !== 'all';
    });
  }

  function valueMatches(actual, expected) {
    const actualKey = key(actual);
    if (Array.isArray(expected)) return expected.some(item => key(item) === actualKey);
    return key(expected) === actualKey;
  }

  // Prepared component tables have frozen rows; index them lazily by identity.
  // WeakMap keeps the indexes out of the public calculation contract and
  // releases them when a Dataset revision replaces the prepared tables.
  // Mutable caller-supplied test/legacy tables are deliberately not indexed.
  const tableIndexes = new WeakMap();

  function tableIndex(table) {
    if (!table || !Object.isFrozen(table) || !Array.isArray(table.rows) ||
        !Object.isFrozen(table.rows)) return null;
    let index = tableIndexes.get(table);
    if (index) return index;
    const months = new Map();
    let latestMonth = null;
    for (const row of table.rows) {
      const month = monthId(row?.period);
      if (!month) continue;
      let bucket = months.get(month);
      if (!bucket) {
        bucket = [];
        months.set(month, bucket);
      }
      bucket.push(row);
      if (!latestMonth || month > latestMonth) latestMonth = month;
    }
    index = { months, latestMonth, fields: new Map(), monthFields: new Map() };
    tableIndexes.set(table, index);
    return index;
  }

  function latestMonth(table) {
    const index = tableIndex(table);
    if (index) return index.latestMonth;
    let latest = null;
    for (const row of table?.rows || []) {
      const month = monthId(row?.period);
      if (month && (!latest || month > latest)) latest = month;
    }
    return latest;
  }

  function indexedDimension(table, field, expected) {
    const index = tableIndex(table);
    if (!index || Array.isArray(expected)) return null;
    let map = index.fields.get(field);
    if (!map) {
      map = new Map();
      for (const row of table.rows) {
        const value = key(row?.[field]);
        let bucket = map.get(value);
        if (!bucket) {
          bucket = [];
          map.set(value, bucket);
        }
        bucket.push(row);
      }
      index.fields.set(field, map);
    }
    return map.get(key(expected)) || [];
  }

  // Repeated monthly slices typically combine one period with one mine or
  // equipment class. Materialize the intersection once from the original
  // ordered month bucket, without changing the rows or aggregating percentages.
  function indexedMonthDimension(table, month, field, expected) {
    if (Array.isArray(expected)) return null;
    const index = tableIndex(table);
    const bucket = index?.months.get(month);
    if (!bucket) return null;
    // Bounded LRU: each entry contains only references to existing prepared
    // rows. Do not retain every month × dimension combination in memory.
    const cacheKey = JSON.stringify([month,field]);
    let fields = index.monthFields.get(cacheKey);
    if (!fields) {
      fields = new Map();
      for (const row of bucket) {
        const value = key(row?.[field]);
        if (!fields.has(value)) fields.set(value,[]);
        fields.get(value).push(row);
      }
      index.monthFields.set(cacheKey,fields);
      if (index.monthFields.size > 16) {
        index.monthFields.delete(index.monthFields.keys().next().value);
      }
    } else {
      index.monthFields.delete(cacheKey);
      index.monthFields.set(cacheKey,fields);
    }
    return fields.get(key(expected)) || [];
  }

  function selectRows(table, query = {}, filterMap = {}) {
    const normalized = normalizedQuery(query);
    const audit = query?.audit && typeof query.audit.selection === 'function' ? query.audit : null;
    const index = tableIndex(table);
    const input = index ? table.rows : Array.from(table?.rows || []);
    const stages = [];
    function record(rows,error=null,unsupportedFilters=[]) {
      if (audit) audit.selection({
        tableId: table?.id || 'unnamed-prepared-table',
        inputRows: input.length,
        outputRows: rows.length,
        period: normalized.period,
        stages,
        error,
        unsupportedFilters
      });
      return Object.freeze({
        rows: Object.freeze(rows),
        query: normalized,
        unsupportedFilters: Object.freeze(unsupportedFilters),
        error
      });
    }

    if (normalized.period.kind === 'invalid') {
      return record([], 'invalid-period');
    }

    const active = activeFilterEntries(normalized.filters);
    const unsupportedFilters = active.map(([name]) => name)
      .filter(name => !Object.prototype.hasOwnProperty.call(filterMap, name));

    if (unsupportedFilters.length) return record([], 'unsupported-filter', unsupportedFilters);

    // Audit is collected in exactly the same selection loop as the real Calculator.
    // Each stage has a real input and output count, never a value inferred from a KPI formula.
    let rows = input;
    if (normalized.period.kind !== 'all') {
      const months = new Set(normalized.period.months);
      const before = rows.length;
      if (index && months.size === 1) {
        rows = index.months.get(normalized.period.months[0]) || [];
      } else {
        // Range selections preserve the original component-table row order.
        // Only single-month selections use the O(1) period bucket directly.
        rows = rows.filter(row => {
          const month = monthId(row?.period);
          return Boolean(month && months.has(month));
        });
      }
      stages.push({
        stage:'period',field:'period',operator:'month-in',
        expected:normalized.period.months.slice(),inputRows:before,
        outputRows:rows.length,excludedRows:before-rows.length
      });
    }

    for (const [name,expected] of active) {
      const candidates = Array.isArray(filterMap[name]) ? filterMap[name] : [filterMap[name]];
      const before=rows.length;
      if (candidates.length === 1 && index &&
          normalized.period.kind === 'single-month' &&
          rows === index.months.get(normalized.period.months[0])) {
        const fast = indexedMonthDimension(
          table, normalized.period.months[0], candidates[0], expected);
        rows = fast === null
          ? rows.filter(row => valueMatches(row?.[candidates[0]], expected))
          : fast;
      } else if (rows === input && candidates.length === 1) {
        const fast = indexedDimension(table, candidates[0], expected);
        rows = fast === null ? rows.filter(row=>valueMatches(row?.[candidates[0]],expected)) : fast;
      } else {
        rows=rows.filter(row=>candidates.some(field=>valueMatches(row?.[field],expected)));
      }
      stages.push({
        stage:'dimension',filter:name,fields:candidates.slice(),
        operator:Array.isArray(expected)?'in':'eq',
        expected:Array.isArray(expected)?expected.slice():expected,
        inputRows:before,outputRows:rows.length,excludedRows:before-rows.length
      });
    }

    return record(rows);
  }

  function sum(rows, field) {
    return Array.from(rows || []).reduce((total, row) => {
      const value = row?.[field];
      return typeof value === 'number' && Number.isFinite(value) ? total + value : total;
    }, 0);
  }

  function percent(numerator, denominator) {
    if (!Number.isFinite(numerator) || !Number.isFinite(denominator)) {
      return Object.freeze({ value: null, state: 'invalid-components' });
    }
    if (denominator === 0) return Object.freeze({ value: null, state: 'zero-denominator' });
    return Object.freeze({ value: (numerator / denominator) * 100, state: 'available' });
  }

  function result(definition, options = {}) {
    return Object.freeze({
      id: definition.id,
      title: definition.title,
      unit: definition.unit,
      value: Number.isFinite(options.value) ? options.value : null,
      dataState: options.dataState || (Number.isFinite(options.value) ? 'available' : 'unavailable'),
      reason: options.reason || null,
      formula: definition.formula,
      formulaVersion: definition.formulaVersion,
      methodologyStatus: definition.methodologyStatus,
      components: Object.freeze({ ...(options.components || {}) }),
      query: options.query || normalizedQuery({}),
      sourceComponents: Object.freeze(Array.from(definition.sourceComponents || [])),
      diagnostics: Object.freeze({ ...(options.diagnostics || {}) })
    });
  }

  function unavailable(definition, query, reason, options = {}) {
    return result(definition, {
      value: null,
      dataState: options.dataState || 'unavailable',
      reason,
      components: options.components,
      query: normalizedQuery(query),
      diagnostics: options.diagnostics
    });
  }

  const api = Object.freeze({
    version: VERSION,
    text,
    key,
    monthId,
    latestMonth,
    normalizePeriod,
    normalizedQuery,
    activeFilterEntries,
    valueMatches,
    selectRows,
    sum,
    percent,
    result,
    unavailable
  });

  globalThis.ReclassifierKpiCalculatorCommon = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
