// FILE CONTRACT: pure classification-quality numerator/denominator preparation.
// Period: valid completedAt first, otherwise valid closedAt. Other categories are excluded.

(() => {
  'use strict';

  const common = globalThis.ReclassifierKpiPreparationCommon;
  if (!common?.componentTable) {
    throw new Error('KPI Preparation Common is required for classification.');
  }

  const GRAIN = ['period', 'branch', 'mine', 'equipmentClass', 'equipmentType', 'equipmentName'];

  function prepare(itsmFacts = []) {
    const rows = new Map();
    let notApplicableRows = 0;
    let includedRowsWithoutEventDate = 0;
    let countedUsingCompletionDate = 0;
    let countedUsingCloseDate = 0;
    const CATEGORY_FIELD = Object.freeze({
      A: 'classificationIncUnchangedCount',
      B: 'classificationIncCorrectedCount',
      C: 'classificationIncUnclassifiedCount',
      D: 'classificationRitmInsteadOfIncCount'
    });

    for (const fact of Array.isArray(itsmFacts) ? itsmFacts : []) {
      if (!fact?.classificationIncluded) {
        notApplicableRows += 1;
        continue;
      }
      const completionPeriod = common.monthPeriod(fact.completedAt);
      const periodInfo = completionPeriod || common.monthPeriod(fact.closedAt);
      if (!periodInfo) {
        includedRowsWithoutEventDate += 1;
        continue;
      }
      if (completionPeriod) countedUsingCompletionDate += 1;
      else countedUsingCloseDate += 1;

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
          classificationSuccessCount: 0,
          classificationFailureCount: 0,
          classificationTotalCount: 0,
          classificationIncUnchangedCount: 0,
          classificationIncCorrectedCount: 0,
          classificationIncUnclassifiedCount: 0,
          classificationRitmInsteadOfIncCount: 0
        });
      }
      const row = rows.get(id);
      const categoryField = CATEGORY_FIELD[fact.classificationCode] ||
        (fact.classificationSuccess ? CATEGORY_FIELD.A : null);
      if (categoryField) row[categoryField] += 1;
      row.classificationTotalCount += 1;
      if (fact.classificationSuccess) row.classificationSuccessCount += 1;
      else row.classificationFailureCount += 1;
    }

    return common.componentTable(
      'classification_quality',
      GRAIN,
      Array.from(rows.values()),
      {
        periodBasis: 'completedAt-or-closedAt',
        notApplicableRows,
        includedRowsWithoutEventDate,
        countedUsingCompletionDate,
        countedUsingCloseDate
      }
    );
  }

  // Distinct CGPS calculation: keep all INC categories represented by work in MB;
  // only CGPS-initiated RITM instead of INC is attributable for wrong request type.
  // Stored ITSM mbPresence is not used: MB records and coverage come from the
  // current Dataset revision, and one request may have many MB tasks.
  function prepareCgps(itsmFacts = [], mobile = {}) {
    const presence = globalThis.ReclassifierItsmMbPresence;
    if (!presence?.buildIndex || !presence?.evaluate) {
      throw new Error('MB presence module is required for CGPS classification.');
    }
    const index = presence.buildIndex(mobile.records);
    // MB temporal metadata is deliberately not used to decide whether the
    // current dataset contains the exact ITSM request number.
    const available = mobile.available !== false && Array.isArray(mobile.records);
    const rows = new Map();
    let notApplicableRows = 0;
    let includedRowsWithoutEventDate = 0;
    let countedUsingCompletionDate = 0;
    let countedUsingCloseDate = 0;
    let missingMbRows = 0;
    let unknownMbRows = 0;
    let excludedOtherInitiatorRitmRows = 0;
    let excludedUnknownInitiatorRitmRows = 0;
    let missingRequestRows = 0;
    let includedRows = 0;
    const CATEGORY_FIELD = Object.freeze({
      A: 'classificationIncUnchangedCount',
      B: 'classificationIncCorrectedCount',
      C: 'classificationIncUnclassifiedCount',
      D: 'classificationRitmInsteadOfIncCount'
    });

    for (const fact of Array.isArray(itsmFacts) ? itsmFacts : []) {
      if (!fact?.classificationIncluded) {
        notApplicableRows += 1;
        continue;
      }
      const completed = common.monthPeriod(fact.completedAt);
      const period = completed || common.monthPeriod(fact.closedAt);
      if (!period) {
        includedRowsWithoutEventDate += 1;
        continue;
      }
      if (completed) countedUsingCompletionDate += 1;
      else countedUsingCloseDate += 1;

      const base = {
        year: period.year,
        month: period.month,
        period: period.period,
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
          classificationSuccessCount: 0,
          classificationFailureCount: 0,
          classificationTotalCount: 0,
          classificationIncUnchangedCount: 0,
          classificationIncCorrectedCount: 0,
          classificationIncUnclassifiedCount: 0,
          classificationRitmInsteadOfIncCount: 0,
          excludedNoMbCount: 0,
          unknownMbCoverageCount: 0,
          excludedOtherInitiatorRitmCount: 0,
          excludedUnknownInitiatorRitmCount: 0,
          excludedMissingRequestCount: 0
        });
      }
      const row = rows.get(id);
      // INC A/B/C accepts every initiator. For D only a confirmed ЦГПС
      // group qualifies. An empty/unmapped initiator has its own diagnostic
      // counter and never becomes a CGPS RITM by default.
      if (fact.classificationCode === 'D') {
        const group = String(fact.initiatorGroup || '').trim().toLocaleLowerCase('ru-RU');
        if (group !== 'цгпс') {
          if (!group) {
            row.excludedUnknownInitiatorRitmCount += 1;
            excludedUnknownInitiatorRitmRows += 1;
          } else {
            row.excludedOtherInitiatorRitmCount += 1;
            excludedOtherInitiatorRitmRows += 1;
          }
          continue;
        }
      }
      // An unusable ITSM number is excluded and counted separately; it is
      // not proof that the request is absent from Mobile Brigades.
      if (!presence.requestKey(fact.requestNumber)) {
        row.excludedMissingRequestCount += 1;
        missingRequestRows += 1;
        continue;
      }
      const state = presence.evaluate(index, fact.requestNumber, null, null, available);
      if (state === presence.STATUS.UNKNOWN) {
        row.unknownMbCoverageCount += 1;
        unknownMbRows += 1;
        continue;
      }
      if (state === presence.STATUS.ABSENT) {
        row.excludedNoMbCount += 1;
        missingMbRows += 1;
        continue;
      }
      row.classificationTotalCount += 1;
      includedRows += 1;
      const categoryField = CATEGORY_FIELD[fact.classificationCode];
      if (categoryField) row[categoryField] += 1;
      if (fact.classificationCode === 'A') row.classificationSuccessCount += 1;
      else row.classificationFailureCount += 1;
    }

    return common.componentTable('classification_quality_cgps', GRAIN, Array.from(rows.values()), {
      periodBasis: 'completedAt-or-closedAt',
      mbLinkage: 'current-mobile-brigade-request',
      initiatorRule: 'RITM instead of INC: confirmed CGPS only',
      mbRule: 'exact-current-request-id-no-date-coverage',
      notApplicableRows,
      includedRowsWithoutEventDate,
      countedUsingCompletionDate,
      countedUsingCloseDate,
      missingMbRows,
      unknownMbRows,
      excludedOtherInitiatorRitmRows,
      excludedUnknownInitiatorRitmRows,
      missingRequestRows,
      includedRows
    });
  }


  // Cross-source evidence for GENERAL classification only. The indicator
  // itself still counts all A/B/C/D from ITSM regardless of MB or initiator.
  // Dates are compared by reporting month: ITSM completedAt else closedAt,
  // MB factDate. An absent request in LOADED data is not proof of absence
  // in the corporate source. No cartesian multiplication by MB task rows.
  const DIAGNOSTIC_FIELDS=Object.freeze([
    'classifiedItsmCount','bothSameMonthCount','bothOtherMonthCount',
    'bothUndatedMbCount','itsmNotInLoadedMbCount','itsmUnknownMbCoverageCount',
    'itsmConfirmedMbAbsenceCount','missingItsmRequestCount',
    'mbOnlyLoadedCount','mbUnknownItsmCoverageCount','mbNoRequestTaskCount'
  ]);
  function prepareDiagnostics(itsmFacts=[],mobile={},itsmMetadata={}) {
    const sourceFacts=globalThis.ReclassifierKpiSourceFacts;
    const presence=globalThis.ReclassifierItsmMbPresence;
    if(!sourceFacts?.mobileLaborFact||!sourceFacts?.sourceReportingCoverage||
       !presence?.requestKey) {
      throw new Error('Classification diagnostics requires Source Facts and MB presence.');
    }
    const facts=Array.isArray(itsmFacts)?itsmFacts:[];
    const mbRows=Array.isArray(mobile.records)?mobile.records:[];
    const mbAvailable=mobile.available!==false && Array.isArray(mobile.records);
    const itsmCoverage=sourceFacts.sourceReportingCoverage('itsm_data',{
      meta:itsmMetadata||{}
    });
    const mbCoverage=sourceFacts.sourceReportingCoverage('mobile_brigade_data',
      mbAvailable?{meta:mobile.meta||{}}:null);
    const key=presence.requestKey;
    const allItsm=new Set();
    for(const fact of facts){
      const id=key(fact?.requestNumber);
      if(id)allItsm.add(id);
    }
    const mbIndex=new Map();
    const distinctOrphans=new Set();
    const rows=new Map();
    const categoryFields=Object.freeze({
      A:'categoryA',B:'categoryB',C:'categoryC',D:'categoryD'
    });
    function dimensions(periodInfo,source,isMb=false){
      return {
        year:periodInfo.year,month:periodInfo.month,period:periodInfo.period,
        branch:isMb?null:source.branch||null,
        mine:isMb?source.site||null:source.mine||null,
        equipmentClass:source.equipmentClass||null,
        equipmentType:source.equipmentType||null,
        equipmentName:source.equipmentName||null
      };
    }
    function bucket(base){
      const id=common.groupKey(GRAIN.map(field=>base[field]));
      if(!rows.has(id)){
        const row={...base,initiatorGroups:new Map()};
        for(const field of DIAGNOSTIC_FIELDS)row[field]=0;
        rows.set(id,row);
      }
      return rows.get(id);
    }
    // MB index: one request can occur in several tasks and months.
    // Store month set rather than count of tasks for each request ID.
    for(const record of mbRows){
      const fact=sourceFacts.mobileLaborFact(record);
      const id=key(fact.request);
      const period=common.monthPeriod(fact.factDate);
      if(!id){
        if(period)bucket(dimensions(period,fact,true)).mbNoRequestTaskCount++;
        continue;
      }
      if(!mbIndex.has(id))mbIndex.set(id,{months:new Set(),undated:false});
      const item=mbIndex.get(id);
      if(period)item.months.add(period.period.slice(0,7));
      else item.undated=true;
      if(allItsm.has(id)||!period)continue;
      // MB-only: distinct request per reporting month and dimensional slice,
      // not one count per MB task; an unknown ITSM export is not definitive.
      const base=dimensions(period,fact,true);
      const distinct=common.groupKey([id,...GRAIN.map(field=>base[field])]);
      if(distinctOrphans.has(distinct))continue;
      distinctOrphans.add(distinct);
      const out=bucket(base);
      out.mbOnlyLoadedCount++;
      if(sourceFacts.reportingMonthStatus(period.period.slice(0,7),
        itsmCoverage).status!=='complete')out.mbUnknownItsmCoverageCount++;
    }
    const includedCounters=Object.freeze([
      'bothSameMonthCount','bothOtherMonthCount','bothUndatedMbCount',
      'itsmNotInLoadedMbCount','itsmUnknownMbCoverageCount',
      'itsmConfirmedMbAbsenceCount','missingItsmRequestCount'
    ]);
    for(const fact of facts){
      if(!fact?.classificationIncluded)continue;
      const period=common.monthPeriod(fact.completedAt)||
        common.monthPeriod(fact.closedAt);
      if(!period)continue;
      const base=dimensions(period,fact);
      const out=bucket(base);
      out.classifiedItsmCount++;
      const group=String(fact.initiatorGroup||'').trim()||'Группа не определена';
      const normalized=group.toLocaleLowerCase('ru-RU');
      if(!out.initiatorGroups.has(normalized)){
        out.initiatorGroups.set(normalized,{
          label:group,count:0,categoryA:0,categoryB:0,categoryC:0,
          categoryD:0,linkage:Object.fromEntries(
            includedCounters.map(field=>[field,0]))
        });
      }
      const subject=out.initiatorGroups.get(normalized);
      subject.count++;
      if(categoryFields[fact.classificationCode])
        subject[categoryFields[fact.classificationCode]]++;
      const id=key(fact.requestNumber);
      const month=period.period.slice(0,7);
      let flag;
      if(!id)flag='missingItsmRequestCount';
      else if(!mbAvailable)
        flag='itsmUnknownMbCoverageCount';
      else if(mbIndex.has(id)){
        const item=mbIndex.get(id);
        flag=item.months.has(month)?'bothSameMonthCount':
          item.months.size?'bothOtherMonthCount':'bothUndatedMbCount';
      }else{
        out.itsmNotInLoadedMbCount++;
        subject.linkage.itsmNotInLoadedMbCount++;
        flag=sourceFacts.reportingMonthStatus(month,mbCoverage).status==='complete'
          ?'itsmConfirmedMbAbsenceCount':'itsmUnknownMbCoverageCount';
      }
      out[flag]++;
      subject.linkage[flag]++;
    }
    const completed=Array.from(rows.values(),row=>{
      const initiatorGroups=Object.freeze(
        Array.from(row.initiatorGroups.values(),group=>Object.freeze({
          ...group,linkage:Object.freeze(group.linkage)
        })).sort((a,b)=>a.label.localeCompare(b.label,'ru'))
      );
      return {...row,initiatorGroups};
    });
    return common.componentTable('classification_quality_diagnostics',
      GRAIN,completed,{
        periodBasis:'itsm-completedAt-or-closedAt/mb-factDate',
        mbPresent:mbAvailable,
        itsmCoverageStatus:itsmCoverage.status,
        mbCoverageStatus:mbCoverage.status,
        scope:'loaded-datasets-only-no-negative-corporate-claim',
        distinctMbOnly:'request-per-report-month-and-dimensions'
      });
  }

  const api = Object.freeze({ prepare, prepareCgps, prepareDiagnostics, DIAGNOSTIC_FIELDS });
  globalThis.ReclassifierKpiPrepareClassification = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
