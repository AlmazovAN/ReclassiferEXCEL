// FILE CONTRACT: immutable report presentation model from existing KPI Results and KPI Catalog.
// Purpose: precompute card comparisons and complete monthly series without repeating KPI formulas.
// Reads: catalog metadata, existing Calculator results, selected Report query/source descriptors.
// Writes: a pure immutable value passed through the Report Snapshot.
// Must not: read SQLite, source rows, re-run formulas, synthesize forecasts or mutate Dataset/Snapshot.
(() => {
  'use strict';

  const catalog = globalThis.ReclassifierKpiCatalog;
  if (!catalog?.list || !catalog?.get || !catalog?.version) {
    throw new Error('KPI Report View Model requires the immutable KPI Catalog.');
  }

  const VERSION = '1.0.0';
  const forecastEngine = globalThis.ReclassifierKpiForecastEngine;
  if (!forecastEngine?.strategyRegistry?.predictForKpi)
    throw new Error('Report View Model requires Forecast Strategy Registry.');

  function freeze(value) {
    if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
    Object.values(value).forEach(freeze);
    return Object.freeze(value);
  }

  function monthId(value) {
    const match = /^(\d{4})-(\d{2})$/.exec(String(value || ''));
    if (!match || Number(match[2]) < 1 || Number(match[2]) > 12) return null;
    return match[1] + '-' + match[2];
  }

  function previousMonth(value) {
    const id = monthId(value);
    if (!id) return null;
    const year = Number(id.slice(0, 4));
    const month = Number(id.slice(5, 7));
    return month === 1
      ? String(year - 1).padStart(4, '0') + '-12'
      : id.slice(0, 4) + '-' + String(month - 1).padStart(2, '0');
  }

  function nextMonth(value) {
    const id = monthId(value);
    if (!id) return null;
    const year = Number(id.slice(0, 4));
    const month = Number(id.slice(5, 7));
    return month === 12
      ? String(year + 1).padStart(4, '0') + '-01'
      : id.slice(0, 4) + '-' + String(month + 1).padStart(2, '0');
  }

  function measurement(result, period, absenceReason = 'result-not-available') {
    const value = result?.dataState === 'available' && Number.isFinite(result?.value)
      ? result.value
      : null;
    const state = value === null
      ? (result?.dataState === 'available' ? 'error' : result?.dataState || 'no-data')
      : 'available';
    return freeze({
      value,
      dataState: state,
      reason: value === null ? result?.reason || absenceReason : null,
      period: period || null
    });
  }

  function sourceRefs(entry, sources) {
    const ids = new Set((entry.calculation?.sources || []).map(source => source.datasetId));
    return freeze(Array.from(sources || [])
      .filter(source => ids.has(source.id))
      .map(source => ({
        datasetId: source.id,
        available: Boolean(source.available),
        revision: source.activeRevision ?? null,
        contentHash: source.contentHash || null,
        freshness: source.freshness || null
      })));
  }

  function gapPeriods(months) {
    const unique = Array.from(new Set(months.map(monthId).filter(Boolean))).sort();
    if (!unique.length) return freeze([]);
    // Existing Calculator normalizes at most 1200 calendar months.
    // Do not invent truncated/partial time series when an unsupported span is supplied.
    const periods = [];
    let value = unique[0];
    while (value && value <= unique[unique.length - 1] && periods.length <= 1200) {
      periods.push(value);
      value = nextMonth(value);
    }
    if (periods.length > 1200) {
      throw new Error('KPI Report View Model: calendar series exceeds supported 1200 months.');
    }
    return freeze(periods);
  }

  // The shared monthly result is enriched exactly once per source revision
  // and filter slice. Forecasts sit alongside, never inside the Calculator KPI.
  // Caller caches this decorated monthly array; changing selected report month
  // must not rerun the forecasting model or alter forecasted values.
  function withForecasts(input = {}) {
    const rows=Array.from(input.monthlyResults||[]);
    const coverage=input.reportingCoverage?.kpis||{};
    if(!rows.length)return freeze([]);
    const byMonth=new Map(rows.map(row=>[monthId(row.period),row]));
    const forecasted=new Map();
    const forecastable=catalog.list({calculationState:'implemented'})
      .map(item=>item.id)
      .filter(id=>['reporting-month-components','reporting-month-volume']
        .includes(forecastEngine.strategyRegistry.forKpi(id)?.policy));
    for(const id of forecastable){
      const provenance=coverage[id]||null;
      const target=monthId(provenance?.reportMonth);
      if(!target||!byMonth.has(target))continue;
      const entry=catalog.get(id);
      const current=byMonth.get(target)?.[id]||null;
      const history=rows.filter(row=>monthId(row.period)<target).map(row=>{
        const result=row?.[id];
        return {
          period:row.period,
          dataState:result?.dataState||'no-data',
          value:result?.dataState==='available'?result.value:null,
          components:result?.components||{},
          diagnostics:result?.diagnostics||{}
        };
      });
      const evaluated=forecastEngine.strategyRegistry.predictForKpi({
        kpiId:id,selectedMonth:target,reportingCoverage:provenance,
        current,points:history
      });
      const recorded=freeze({...evaluated,
        sourceRevisions:sourceRefs(entry,input.sources||[])});
      if(!forecasted.has(target))forecasted.set(target,{});
      forecasted.get(target)[id]=recorded;
    }
    return freeze(rows.map(row=>forecasted.has(row.period)
      ? {...row,forecasts:freeze(forecasted.get(row.period))}
      : row));
  }

  function create(input = {}) {
    const selected = monthId(input.selectedMonth);
    const filters = freeze({ ...(input.filters || {}) });
    const monthlyRows = Array.from(input.monthlyResults || []);
    const monthRows = new Map();
    for (const row of monthlyRows) {
      const period = monthId(row?.period);
      if (!period || monthRows.has(period)) {
        throw new Error('KPI Report View Model: invalid or duplicate monthly period.');
      }
      monthRows.set(period, row);
    }

    const months = gapPeriods(Array.from(monthRows.keys()));
    const previous = previousMonth(selected);
    const currentResults = input.currentResults || {};
    const previousRow = previous ? monthRows.get(previous) : null;
    const cards = {};
    const seriesById = {};

    for (const entry of catalog.list()) {
      const id = entry.id;
      const current = measurement(
        currentResults[id] || (entry.calculation ? null : {
          dataState: 'not-applicable', reason: 'not-implemented'
        }),
        selected,
        entry.calculation ? 'result-not-available' : 'not-implemented'
      );
      const previousMeasurement = measurement(
        previousRow?.[id] || (entry.calculation ? null : {
          dataState: 'not-applicable', reason: 'not-implemented'
        }),
        previous,
        previous ? 'previous-period-not-in-source-calendar' : 'previous-period-not-selected'
      );
      const canCompare = current.dataState === 'available' &&
        previousMeasurement.dataState === 'available';
      const unit = entry.definition.unit;
      const historyForForecast=months.map(period=>{
        const result=monthRows.get(period)?.[id];
        return {
          period,value:result?.dataState==='available'?result.value:null,
          dataState:result?.dataState||'no-data',
          components:result?.components||{},
          diagnostics:result?.diagnostics||{}
        };
      });
      const provenance=input.reportingCoverage?.kpis?.[id]||null;
      const monthForecast=monthRows.get(monthId(provenance?.reportMonth))?.forecasts?.[id];
      // Primary-stage snapshots deliberately have no monthly history.
      // For them, publish an unavailable forecast rather than using the clock.
      const policy=forecastEngine.strategyRegistry.forKpi(id)?.policy||null;
      const reportingNowcast=policy==='reporting-month-components'||
        policy==='reporting-month-volume';
      const forecast=reportingNowcast
        ? (monthForecast || forecastEngine.strategyRegistry.predictForKpi({
          kpiId:id,selectedMonth:provenance?.reportMonth||selected,
          reportingCoverage:provenance,
          current:null,points:[]
        }))
        : forecastEngine.strategyRegistry.predictForKpi({
          kpiId:id,selectedMonth:selected,
          points:months.map(period=>{
            const result=monthRows.get(period)?.[id];
            return {period,value:result?.dataState==='available'?result.value:null,
              dataState:result?.dataState||'no-data'};
          })
        });
      cards[id] = freeze({
        kpiId: id,
        passportRef: freeze({
          kpiId: id,
          catalogVersion: catalog.version,
          contractVersion: entry.calculation?.contractVersion || null
        }),
        current,
        previous: previousMeasurement,
        change: canCompare ? current.value - previousMeasurement.value : null,
        changeUnit: unit === '%' ? 'п.п.' : unit,
        changeReason: canCompare ? null : 'non-comparable-periods',
        forecast,
        target: entry.definition.target,
        status: 'neutral',
        sourceRevisions: sourceRefs(entry, input.sources || [])
      });

      seriesById[id] = freeze({
        kpiId: id,
        grain: 'month',
        slice: filters,
        points: months.map(period => {
          const row = monthRows.get(period);
          const result = row?.[id] || (entry.calculation ? null : {
            dataState: 'not-applicable', reason: 'not-implemented'
          });
          const point = measurement(result, period,
            row ? 'result-not-available' : 'period-not-in-source-calendar');
          return freeze({
            period,
            value: point.value,
            dataState: point.dataState,
            reason: point.reason,
            components: freeze({ ...(result?.components || {}) }),
            formulaVersion: result?.formulaVersion || null,
            forecast: row?.forecasts?.[id] || null
          });
        })
      });
    }

    return freeze({
      version: VERSION,
      catalogVersion: catalog.version,
      selectedMonth: selected,
      previousMonth: previous,
      filters,
      cards,
      seriesById
    });
  }

  const api = Object.freeze({ version: VERSION, monthId, previousMonth, withForecasts, create });
  globalThis.ReclassifierKpiReportViewModel = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
