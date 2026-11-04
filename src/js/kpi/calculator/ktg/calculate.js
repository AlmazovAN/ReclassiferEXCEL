// FILE CONTRACT: KTG from Drivers calendar equipment-hours and ITSM pre-backlog.
// КТГ = (КФРВ - (T_INC + T_TO_fact + T_TO_unscheduled + T_other))
//       / (КФРВ - T_TO_plan) * 100.
// Temporarily T_TO_plan = T_TO_fact (scheduled maintenance only).
(() => {
  'use strict';
  const common=globalThis.ReclassifierKpiCalculatorCommon;
  const definitions=globalThis.ReclassifierKpiDefinitions;
  if(!common?.result||!definitions?.ktg)
    throw new Error('KPI Calculator Common/Definitions required for KTG');
  const FILTERS=Object.freeze({mine:'mine',equipmentClass:'equipmentClass',
    equipmentType:'equipmentType',equipmentName:'equipmentName'});
  const norm=value=>common.key(value);
  function monthDays(month){
    const match=/^(\d{4})-(\d{2})$/.exec(month);
    return match?new Date(Date.UTC(Number(match[1]),Number(match[2]),0)).getUTCDate():0;
  }
  function calculate(families={},query={}){
    const definition=definitions.ktg;
    const period=common.normalizePeriod(query.period);
    const unsupported=common.activeFilterEntries(query.filters||{})
      .map(([name])=>name).filter(name=>!Object.hasOwn(FILTERS,name));
    if(unsupported.length)return common.unavailable(definition,query,'unsupported-filter',{
      diagnostics:{unsupportedFilters:unsupported}
    });
    if(period.kind==='invalid')return common.unavailable(definition,query,'invalid-period');
    const workTable=families.ktg?.work,fleetTable=families.ktg?.fleet;
    const latest=period.kind==='all'?common.latestMonth(workTable):null;
    const months=period.kind==='all'?(latest?[latest]:[]):Array.from(period.months);
    if(!months.length)return common.unavailable(definition,query,'report-period-missing',{dataState:'no-data'});
    const observed=new Set(workTable?.meta?.observedMonths||[]);
    const missingItsmMonths=months.filter(m=>!observed.has(m));
    // Coverage is defined from the ITSM source, not from MB's report calendar.
    // A month outside the observed source never creates a fictional zero-downtime
    // contribution to KFRV. For mixed intervals, calculate only the observable
    // months and explicitly disclose that the result covers fewer months.
    const reportingMonths=months.filter(m=>observed.has(m));
    const selectedPeriod=months.length===1?months[0]+'-01':{
      start:months[0]+'-01',end:months.at(-1)+'-01'
    };
    const selectedFleet=common.selectRows(fleetTable,
      {filters:query.filters||{},audit:query.audit},FILTERS);
    const selectedWork=common.selectRows(workTable,
      {period:selectedPeriod,filters:query.filters||{},audit:query.audit},FILTERS);
    const equipmentUnits=common.sum(selectedFleet.rows,'equipmentCount');
    const calendarDays=reportingMonths.reduce((s,month)=>s+monthDays(month),0);
    const calendarHours=equipmentUnits*24*calendarDays;
    const diagnostics={
      sourceDataset:'itsm_data',populationDataset:'drivers',
      equipmentUnits,calendarDays,reportMonths:reportingMonths,
      requestedMonths:months,reportingMonths:reportingMonths.length,
      requestedMonthCount:months.length,
      populationBasis:'fixed-drivers-reference',
      historicalPopulationAvailable:false,
      periodBasis:'createdAt',durationSource:'preBacklogHours',
      plannedMaintenanceAssumption:'fact-scheduled-to',
      selectedWorkGroups:selectedWork.rows.length,
      selectedUsableTaskRows:common.sum(selectedWork.rows,'usableTaskCount'),
      unmatchedDriverRows:workTable?.meta?.unmatchedDriverRows||0,
      unmatchedDriverExamples:workTable?.meta?.unmatchedExamples||[],
      ignoredWorkRows:workTable?.meta?.ignoredWorkRows||0,
      missingDimensionsRows:workTable?.meta?.missingDimensionsRows||0,
      ambiguousDriverRows:workTable?.meta?.ambiguousDriverRows||0,
      selectedUnknownDurationRows:common.sum(selectedWork.rows,'unknownDurationRows'),
      selectedUnfinishedRows:common.sum(selectedWork.rows,'unfinishedRows'),
      missingItsmMonths,
      driverReferenceFreshness:fleetTable?.meta?.referenceFreshness||null
    };
    if(!equipmentUnits)return common.unavailable(definition,query,'equipment-count-zero-or-missing',{
      dataState:'no-data',components:{calendarHours:0},diagnostics
    });
    if(!reportingMonths.length)return common.unavailable(definition,query,
      'itsm-period-without-observations',{
        dataState:'no-data',components:{calendarHours:0},diagnostics
      });
    const invalidRows=diagnostics.selectedUnknownDurationRows+
      diagnostics.selectedUnfinishedRows;
    if(invalidRows>0 && diagnostics.selectedUsableTaskRows===0) {
      return common.unavailable(definition,query,
        diagnostics.selectedUnfinishedRows?'unfinished-itsm-requests':'request-duration-incomplete',{
          dataState:'insufficient',components:{calendarHours},diagnostics
        });
    }
    // One unfinished or malformed request must not erase a month containing
    // valid completed work. Such results remain explicitly preliminary: the
    // unverified durations are excluded, not silently treated as zero.
    const partialReasons=[];
    if(missingItsmMonths.length)partialReasons.push('unobserved-calendar-months');
    if(diagnostics.selectedUnfinishedRows)partialReasons.push('unfinished-itsm-requests');
    if(diagnostics.selectedUnknownDurationRows)partialReasons.push('request-duration-incomplete');
    diagnostics.partialCoverage=partialReasons.length>0;
    diagnostics.partialReasons=partialReasons;
    diagnostics.excludedUnverifiedRequestRows=invalidRows;
    const incidentHours=common.sum(selectedWork.rows,'incidentHours');
    const avrHours=incidentHours; // backward-compatible named component for chart consumers
    const plannedMaintenanceHours=common.sum(selectedWork.rows,'plannedMaintenanceHours');
    const unplannedMaintenanceHours=common.sum(selectedWork.rows,'unplannedMaintenanceHours');
    const otherHours=common.sum(selectedWork.rows,'otherHours');
    const actualMaintenanceHours=plannedMaintenanceHours; // scheduled TO factual duration
    const actualDowntimeHours=incidentHours+actualMaintenanceHours+unplannedMaintenanceHours+otherHours;
    const availableHours=calendarHours-plannedMaintenanceHours;
    const productiveHours=calendarHours-actualDowntimeHours;
    const components={calendarHours,incidentHours,avrHours,actualMaintenanceHours,
      plannedMaintenanceHours,unplannedMaintenanceHours,otherHours,
      actualDowntimeHours,availableHours,productiveHours,equipmentUnits};
    if(availableHours<=0)return common.unavailable(definition,query,
      'available-fund-zero-or-negative',{dataState:'unavailable',components,diagnostics});
    return common.result(definition,{
      value:productiveHours/availableHours*100,dataState:'available',
      reason:diagnostics.partialCoverage?'partial-coverage':null,
      query:common.normalizedQuery({period:selectedPeriod,filters:query.filters||{}}),
      components,diagnostics:{...diagnostics,negativeProductiveHours:productiveHours<0}
    });
  }
  const api=Object.freeze({calculate});
  globalThis.ReclassifierKpiCalculateKtg=api;
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
})();
