// FILE CONTRACT: pure Problem Management coverage components on Mobile Brigade task grain.
// Period semantics: MB factDate month. Each MB row contributes once; ITSM PRB linkage is enrichment only.

(() => {
  'use strict';

  const common = globalThis.ReclassifierKpiPreparationCommon;
  const sourceFacts = globalThis.ReclassifierKpiSourceFacts;
  if (!common?.componentTable || !sourceFacts?.linkMobileBrigadeToProblems) {
    throw new Error('KPI Preparation Common and Source Facts are required for PRB.');
  }

  const GRAIN = [
    'period',
    'branch',
    'mine',
    'equipmentClass',
    'finalTaskType',
    'problemLinkState',
    'problemId'
  ];

  function prepare(mobileRecords = [], itsmFacts = []) {
    const linked = sourceFacts.linkMobileBrigadeToProblems(mobileRecords, itsmFacts);
    const rows = new Map();
    let rowsWithoutFactDate = 0;

    for (const fact of linked.records) {
      const periodInfo = common.monthPeriod(fact.factDate);
      if (!periodInfo) {
        rowsWithoutFactDate += 1;
        continue;
      }
      const base = {
        year: periodInfo.year,
        month: periodInfo.month,
        period: periodInfo.period,
        branch: fact.branch || null,
        mine: fact.mine || fact.site || null,
        equipmentClass: fact.equipmentClass || null,
        finalTaskType: fact.finalTaskType || null,
        problemLinkState: fact.problemLinkState,
        problemId: fact.problemId || null
      };
      const id = common.groupKey(GRAIN.map(field => base[field]));
      if (!rows.has(id)) {
        rows.set(id, {
          ...base,
          taskCount: 0,
          usableLaborTaskCount: 0,
          unusableLaborTaskCount: 0,
          laborHours: 0,
          linkedTaskCount: 0,
          linkedLaborHours: 0
        });
      }
      const row = rows.get(id);
      row.taskCount += 1;
      if (fact.problemLinked) row.linkedTaskCount += 1;

      if (fact.laborUsable) {
        row.usableLaborTaskCount += 1;
        row.laborHours += fact.laborHours;
        if (fact.problemLinked) row.linkedLaborHours += fact.laborHours;
      } else {
        row.unusableLaborTaskCount += 1;
      }
    }

    return common.componentTable(
      'problem_management',
      GRAIN,
      Array.from(rows.values()),
      {
        periodBasis: 'mobileBrigade.factDate',
        rowsWithoutFactDate,
        linkage: linked.stats
      }
    );
  }

  const api = Object.freeze({ prepare });
  globalThis.ReclassifierKpiPreparePrb = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
