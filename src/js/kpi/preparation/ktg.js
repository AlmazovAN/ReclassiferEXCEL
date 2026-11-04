// FILE CONTRACT: KTG from ITSM incident/work durations and the validated Drivers stock.
// Hours are the ITSM pre-backlog duration, NOT MB labor/astronomical hours.
// The current Drivers quantities form a fixed historical stock assumption.
// Plan TO is temporarily equated with factual scheduled TO until a distinct source exists.
(() => {
  'use strict';
  const common = globalThis.ReclassifierKpiPreparationCommon;
  const facts = globalThis.ReclassifierKpiSourceFacts;
  if (!common?.componentTable || !facts?.finiteNumber)
    throw new Error('KPI KTG preparation requires common helpers and source facts.');

  const FLEET_GRAIN = ['mine','equipmentClass','equipmentType','equipmentName'];
  const WORK_GRAIN = ['period','mine','equipmentClass','equipmentType','equipmentName'];
  const norm = value => facts.key(value);
  const indexedName = (mine,name) => JSON.stringify([norm(mine),norm(name)]);
  const signature = row => JSON.stringify(WORK_GRAIN.map(k => norm(row[k])));

  // Incident classification always wins, even if the independent work-type
  // column contains a conflicting maintenance, installation or unknown value.
  function kindFor(fact) {
    if (norm(fact.requestType) === 'inc') return 'incidentHours';
    const value = norm(fact.workType);
    if (/вне\s*план|вне\s*графика/.test(value) && /то|обслуживан/.test(value))
      return 'unplannedMaintenanceHours';
    if (/планов|по\s*графику/.test(value) && /то|обслуживан/.test(value))
      return 'plannedMaintenanceHours';
    if (value === 'прочее' || value === '' ||
        /^(?:#?н\/?д|#?н\/а|#?n\/?d|#?n\/?a|#?nd|нет\s*данных|не\s*определено|нет\s*в\s*мб|нет\s*данных\s*мб)$/.test(value))
      return 'otherHours';
    if (/монтаж|демонтаж|по\s*\/?\s*доступ|консультац/.test(value)) return null;
    return null;
  }

  function prepare(itsmFacts = [], equipmentTable = {}) {
    const fleetRows = Array.from(equipmentTable?.rows || []).map(row => ({
      mine: row.organizationalUnit,
      equipmentClass: row.equipmentClass,
      equipmentType: row.equipmentType,
      equipmentName: row.equipmentName,
      equipmentCount: row.equipmentCount
    }));
    const driversByName = new Map();
    for (const row of fleetRows) {
      const k = indexedName(row.mine,row.equipmentName);
      if (!driversByName.has(k)) driversByName.set(k,[]);
      driversByName.get(k).push(row);
    }
    const rows = new Map(), observedMonths = new Set();
    const stats = {
      sourceRows: 0, eligibleRows: 0, matchedRows: 0, ignoredWorkRows: 0,
      unknownWorkTypeRows: 0, missingPeriodRows: 0, missingDimensionsRows: 0,
      unmatchedDriverRows: 0, ambiguousDriverRows: 0, invalidDurationRows: 0,
      unfinishedRows: 0, duplicateRequestRows: 0,
      durationSource: 'itsm_data.preBacklogHours',
      periodBasis: 'createdAt',
      plannedMaintenanceAssumption: 'fact-scheduled-to',
      unmatchedExamples: [], observedMonths: []
    };
    const seen = new Set();
    for (const fact of Array.isArray(itsmFacts) ? itsmFacts : []) {
      stats.sourceRows++;
      const period = common.monthPeriod(fact.createdAt);
      if (period) observedMonths.add(period.period.slice(0,7));
      const kind = kindFor(fact);
      if (!kind) {
        stats.ignoredWorkRows++;
        if (norm(fact.requestType) !== 'inc' &&
            !/монтаж|демонтаж|по\s*\/?\s*доступ|консультац/.test(norm(fact.workType)))
          stats.unknownWorkTypeRows++;
        continue;
      }
      stats.eligibleRows++;
      const requestId = norm(fact.requestNumber);
      if (requestId) {
        if (seen.has(requestId)) { stats.duplicateRequestRows++;continue; }
        seen.add(requestId);
      }
      if (!period) { stats.missingPeriodRows++;continue; }
      if (!fact.mine || !fact.reclassifiedEquipmentName) {
        stats.missingDimensionsRows++;
        continue;
      }
      const candidates = driversByName.get(indexedName(fact.mine,fact.reclassifiedEquipmentName)) || [];
      // Prefer the ITSM service-class association when present; otherwise only
      // a single Drivers class/type match can be allocated without ambiguity.
      const narrowed = fact.equipmentClass
        ? candidates.filter(c=>c.equipmentClass === fact.equipmentClass)
        : candidates;
      const typed = fact.equipmentType
        ? narrowed.filter(c=>norm(c.equipmentType)===norm(fact.equipmentType))
        : narrowed;
      const eligible = typed.length ? typed : narrowed;
      const unique = new Map(eligible.map(row => [
        JSON.stringify([norm(row.mine),norm(row.equipmentClass),norm(row.equipmentType),
          norm(row.equipmentName)]),row
      ]));
      if (!unique.size || (fact.equipmentClass && !narrowed.length)) {
        stats.unmatchedDriverRows++;
        if (stats.unmatchedExamples.length < 10)
          stats.unmatchedExamples.push({mine:fact.mine,equipmentName:fact.reclassifiedEquipmentName});
        continue;
      }
      if (unique.size !== 1) { stats.ambiguousDriverRows++;continue; }
      const targetFleet = unique.values().next().value;
      const base = {
        period: period.period,
        mine: targetFleet.mine,
        equipmentClass: targetFleet.equipmentClass,
        equipmentType: targetFleet.equipmentType,
        equipmentName: targetFleet.equipmentName
      };
      const id = signature(base);
      if (!rows.has(id)) rows.set(id, {
        ...base, incidentHours:0,plannedMaintenanceHours:0,
        unplannedMaintenanceHours:0,otherHours:0,
        usableTaskCount:0,unknownDurationRows:0,unfinishedRows:0
      });
      const target = rows.get(id);
      // ITSM Rules computes an open ticket's backlog up to processing 'today'.
      // That moving value cannot certify historical downtime; do not count it.
      if (!fact.completedAt && !fact.closedAt) {
        target.unfinishedRows++;stats.unfinishedRows++;continue;
      }
      const hours = facts.finiteNumber(fact.requestDurationHours);
      if (hours === null || hours < 0) {
        target.unknownDurationRows++;stats.invalidDurationRows++;continue;
      }
      target[kind] += hours;
      target.usableTaskCount++;
      stats.matchedRows++;
    }
    stats.observedMonths = Array.from(observedMonths).sort();
    return Object.freeze({
      fleet: common.componentTable('ktg_fleet',FLEET_GRAIN,fleetRows,{
        sourceDataset:'drivers', populationBasis:'fixed-drivers-reference',
        referenceFreshness:equipmentTable?.meta?.referenceFreshness||null,
        supportsHistoricalPeriods:false,equipmentUnits:fleetRows.reduce((s,r)=>s+r.equipmentCount,0)
      }),
      work: common.componentTable('ktg_work',WORK_GRAIN,Array.from(rows.values()),{
        sourceDataset:'itsm_data', ...stats
      })
    });
  }
  const api = Object.freeze({prepare,kindFor});
  globalThis.ReclassifierKpiPrepareKtg = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
