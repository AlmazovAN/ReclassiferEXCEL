// FILE CONTRACT: pure Mobile Brigade labor component preparation.
// Period semantics: factDate month. Invalid/missing labor is counted diagnostically and never coerced to zero.

(() => {
  'use strict';

  const common = globalThis.ReclassifierKpiPreparationCommon;
  const sourceFacts = globalThis.ReclassifierKpiSourceFacts;
  if (!common?.componentTable || !sourceFacts?.mobileLaborFact) {
    throw new Error('KPI Preparation Common and Source Facts are required for labor.');
  }

  const GRAIN = [
    'period',
    'site',
    'finalTaskType',
    'equipmentPlacement',
    'equipmentClass',
    'equipmentType',
    'equipmentName'
  ];

  function prepare(mobileRecords = []) {
    const rows = new Map();
    const laborStateCounts = {};
    let rowsWithoutFactDate = 0;
    let rowsWithoutFinalTaskType = 0;

    for (const source of Array.isArray(mobileRecords) ? mobileRecords : []) {
      const fact = sourceFacts.mobileLaborFact(source);
      laborStateCounts[fact.laborState] = (laborStateCounts[fact.laborState] || 0) + 1;
      if (!fact.finalTaskType) rowsWithoutFinalTaskType += 1;

      const periodInfo = common.monthPeriod(fact.factDate);
      if (!periodInfo) {
        rowsWithoutFactDate += 1;
        continue;
      }

      const base = {
        year: periodInfo.year,
        month: periodInfo.month,
        period: periodInfo.period,
        site: fact.site,
        finalTaskType: fact.finalTaskType,
        equipmentPlacement: fact.equipmentPlacement,
        equipmentClass: fact.equipmentClass,
        equipmentType: fact.equipmentType,
        equipmentName: fact.equipmentName
      };
      const id = common.groupKey(GRAIN.map(field => base[field]));
      if (!rows.has(id)) {
        rows.set(id, {
          ...base,
          taskCount: 0,
          usableLaborTaskCount: 0,
          unusableLaborTaskCount: 0,
          zeroLaborTaskCount: 0,
          laborHours: 0
        });
      }

      const row = rows.get(id);
      row.taskCount += 1;
      if (fact.laborUsable) {
        row.usableLaborTaskCount += 1;
        if (fact.zeroLabor) row.zeroLaborTaskCount += 1;
        row.laborHours += fact.laborHours;
      } else {
        row.unusableLaborTaskCount += 1;
      }
    }

    return common.componentTable(
      'mobile_brigade_labor',
      GRAIN,
      Array.from(rows.values()),
      {
        periodBasis: 'factDate',
        rowsWithoutFactDate,
        rowsWithoutFinalTaskType,
        laborStateCounts: Object.freeze({ ...laborStateCounts })
      }
    );
  }

  const api = Object.freeze({ prepare });
  globalThis.ReclassifierKpiPrepareLabor = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
