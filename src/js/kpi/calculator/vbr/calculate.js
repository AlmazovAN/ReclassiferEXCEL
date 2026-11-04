// FILE CONTRACT: pure VBR using post-reclassification ITSM failures and Drivers reference stock.
// Drivers is a fixed reference without historical snapshots; for a multi-month range its
// equipment quantity is counted once for each selected month (equipment-month exposure).

(() => {
  'use strict';

  const common = globalThis.ReclassifierKpiCalculatorCommon;
  const definitions = globalThis.ReclassifierKpiDefinitions;
  if (!common?.result || !definitions?.vbr) throw new Error('KPI Calculator Common/Definitions are required for VBR.');

  const FILTERS_FAILURES = Object.freeze({
    mine: 'mine',
    equipmentClass: 'equipmentClass',
    equipmentType: 'equipmentType',
    equipmentName: 'equipmentName'
  });
  const FILTERS_EQUIPMENT = Object.freeze({
    mine: 'organizationalUnit',
    equipmentClass: 'equipmentClass',
    equipmentType: 'equipmentType',
    equipmentName: 'equipmentName'
  });

  function calculate(families = {}, query = {}) {
    const definition = definitions.vbr;
    const period = common.normalizePeriod(query.period);
    const equipmentTable = families.equipment;
    const failureTable = families.failures?.events;

    const activeFilters = common.activeFilterEntries(query.filters || {});
    const unsupported = activeFilters.map(([name]) => name)
      .filter(name => !Object.prototype.hasOwnProperty.call(FILTERS_FAILURES, name));
    if (unsupported.length) {
      return common.unavailable(definition, query, 'unsupported-filter', {
        diagnostics: { unsupportedFilters: unsupported }
      });
    }
    if (period.kind === 'invalid') {
      return common.unavailable(definition, query, 'invalid-period');
    }

    // When no month was requested use the latest month present among the
    // prepared ITSM failure events, rather than silently spanning all history.
    const latestMonth = period.kind === 'all' ? common.latestMonth(failureTable) : null;
    const months = period.kind === 'all'
      ? (latestMonth ? [latestMonth] : [])
      : Array.from(period.months);
    if (!months.length) {
      return common.unavailable(definition, query, 'failure-period-missing', {
        dataState: 'no-data'
      });
    }

    const selectionPeriod = months.length === 1
      ? months[0] + '-01'
      : { start: months[0] + '-01', end: months[months.length - 1] + '-01' };
    const failureSelection = common.selectRows(
      failureTable,
      { period: selectionPeriod, filters: query.filters || {}, audit: query.audit },
      FILTERS_FAILURES
    );
    // Drivers has no reporting period, so never filter its stock against the
    // request date; restrict it only by mine/service/equipment.
    const equipmentSelection = common.selectRows(
      equipmentTable,
      { filters: query.filters || {}, audit: query.audit },
      FILTERS_EQUIPMENT
    );
    const failureCount = common.sum(failureSelection.rows, 'failureCount');
    // Monthly grid may come from MB/PRB even where no ITSM observations exist.
    // Without any dated ITSM INC/RITM for a calendar month a derived VBR=100%
    // would indicate absent evidence, not a verified zero-failure month.
    // Keep this independent of mine/class: no incident on a particular mine
    // is possible when the reporting month is otherwise observed by ITSM.
    const perMonth = new Map();
    for (const row of failureTable?.rows||[]) {
      const month=common.monthId(row.period);
      if(!month)continue;
      if(!perMonth.has(month))perMonth.set(month,{inc:0,ritm:0,failures:0,unclassified:0});
      const group=perMonth.get(month);
      group.inc+=row.incCount||0;
      group.ritm+=row.ritmCount||0;
      group.failures+=row.failureCount||0;
      if(!row.equipmentClass)group.unclassified+=row.failureCount||0;
    }
    const missingItsmMonths=months.filter(m=>{
      const global=perMonth.get(m);
      return !global||(global.inc+global.ritm+global.failures===0);
    });
    const reportingMonths=months.filter(m=>!missingItsmMonths.includes(m));
    const selectedIncCount=common.sum(failureSelection.rows,'incCount');
    const selectedRitmCount=common.sum(failureSelection.rows,'ritmCount');
    const globalIncCount=months.reduce((sum,m)=>sum+(perMonth.get(m)?.inc||0),0);
    const globalFailureCount=months.reduce((sum,m)=>sum+(perMonth.get(m)?.failures||0),0);
    const unclassifiedGlobalFailures=months.reduce((sum,m)=>
      sum+(perMonth.get(m)?.unclassified||0),0);
    const baselineEquipmentCount = common.sum(equipmentSelection.rows, 'equipmentCount');
    const equipmentCount = baselineEquipmentCount * reportingMonths.length;

    const diagnostics = {
      months: months.slice(),
      observedMonths:reportingMonths,
      requestedMonths:months.slice(),
      requestedMonthCount:months.length,
      reportingMonths: reportingMonths.length,
      partialCoverage:missingItsmMonths.length>0&&reportingMonths.length>0,
      baselineEquipmentCount,
      driverReferenceFreshness: equipmentTable?.meta?.referenceFreshness || null,
      populationBasis: 'fixed-drivers-reference',
      historicalPopulationAvailable: false,
      staticDriversQuantityRepeatedPerMonth: reportingMonths.length > 1,
      selectedIncCount,selectedRitmCount,
      globalIncCount,globalFailureCount,unclassifiedGlobalFailures,
      selectedFailureComponentGroups:failureSelection.rows.length,
      sourceEventMonths:Array.from(perMonth.keys()).sort(),
      missingItsmMonths
    };

    if (baselineEquipmentCount === 0) {
      return common.unavailable(definition, query, 'equipment-count-zero-or-missing', {
        dataState: 'no-data',
        components: { failureCount, equipmentCount },
        diagnostics
      });
    }
    // Mixed windows are composed from source-observed months only. Unknown
    // months have no evidence of a zero failure count and must not inflate
    // the denominator or suppress otherwise valid observed months.
    if (!reportingMonths.length) {
      return common.unavailable(definition,query,'itsm-period-without-observations',{
        dataState:'no-data',components:{failureCount,equipmentCount:0},diagnostics
      });
    }
    const value = (1 - failureCount / equipmentCount) * 100;
    return common.result(definition, {
      value,
      dataState: 'available',
      reason:diagnostics.partialCoverage?'partial-coverage':null,
      query: common.normalizedQuery({ period: selectionPeriod, filters: query.filters || {} }),
      components: { failureCount, equipmentCount },
      diagnostics: {
        ...diagnostics,
        failureCountExceedsEquipmentCount: failureCount > equipmentCount
      }
    });
  }

  const api = Object.freeze({ calculate });
  globalThis.ReclassifierKpiCalculateVbr = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
