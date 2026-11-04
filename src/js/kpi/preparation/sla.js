// FILE CONTRACT: pure SLA numerator/denominator preparation from ITSM semantic facts.
// Period semantics: closedAt month. Unknown SLA state is excluded from denominator and reported diagnostically.

(() => {
  'use strict';

  const common = globalThis.ReclassifierKpiPreparationCommon;
  if (!common?.componentTable) throw new Error('KPI Preparation Common is required for SLA.');

  const GRAIN = ['period', 'branch', 'mine', 'equipmentClass', 'equipmentType', 'equipmentName'];

  function prepare(itsmFacts = []) {
    const rows = new Map();
    let unknownSlaRows = 0;
    let knownSlaRowsWithoutCloseDate = 0;

    for (const fact of Array.isArray(itsmFacts) ? itsmFacts : []) {
      if (fact?.slaState === 'unknown') {
        unknownSlaRows += 1;
        continue;
      }
      const periodInfo = common.monthPeriod(fact?.closedAt);
      if (!periodInfo) {
        knownSlaRowsWithoutCloseDate += 1;
        continue;
      }
      const base = {
        year: periodInfo.year,
        month: periodInfo.month,
        period: periodInfo.period,
        branch: fact.branch || null,
        mine: fact.mine || null,
        equipmentClass: fact.equipmentClass || null,
        equipmentType: fact.equipmentType || null,
        equipmentName: fact.equipmentName || null
      };
      const id = common.groupKey(GRAIN.map(field => base[field]));
      if (!rows.has(id)) {
        rows.set(id, {
          ...base,
          slaSuccessCount: 0,
          slaOverdueCount: 0,
          slaTotalCount: 0
        });
      }
      const row = rows.get(id);
      row.slaTotalCount += 1;
      if (fact.slaState === 'success') row.slaSuccessCount += 1;
      else if (fact.slaState === 'overdue') row.slaOverdueCount += 1;
    }

    return common.componentTable(
      'sla',
      GRAIN,
      Array.from(rows.values()),
      {
        periodBasis: 'closedAt',
        unknownSlaRows,
        knownSlaRowsWithoutCloseDate
      }
    );
  }

  const api = Object.freeze({ prepare });
  globalThis.ReclassifierKpiPrepareSla = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
