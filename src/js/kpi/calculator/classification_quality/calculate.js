// FILE CONTRACT: pure classification-quality formula over prepared components.

(() => {
  'use strict';

  const common = globalThis.ReclassifierKpiCalculatorCommon;
  const definitions = globalThis.ReclassifierKpiDefinitions;
  if (!common?.percent || !definitions?.classification_quality) {
    throw new Error('KPI Calculator Common/Definitions are required for classification quality.');
  }

  const FILTERS = Object.freeze({
    branch: 'branch',
    mine: 'mine',
    equipmentClass: 'equipmentClass',
    equipmentType: 'equipmentType',
    equipmentName: 'equipmentName'
  });

  const DIAGNOSTIC_FIELDS=Object.freeze([
    'classifiedItsmCount','bothSameMonthCount','bothOtherMonthCount',
    'bothUndatedMbCount','itsmNotInLoadedMbCount','itsmUnknownMbCoverageCount',
    'itsmConfirmedMbAbsenceCount','missingItsmRequestCount',
    'mbOnlyLoadedCount','mbUnknownItsmCoverageCount','mbNoRequestTaskCount'
  ]);
  function coverageDiagnostics(table,query){
    if(!table)return null;
    const selected=common.selectRows(table,query,FILTERS);
    if(selected.error)return null;
    const counts={};
    for(const field of DIAGNOSTIC_FIELDS)counts[field]=common.sum(selected.rows,field);
    const groups=new Map();
    for(const row of selected.rows){
      for(const group of row.initiatorGroups||[]){
        const id=String(group.label||'').toLocaleLowerCase('ru-RU');
        if(!groups.has(id)){
          groups.set(id,{label:group.label,count:0,categoryA:0,
            categoryB:0,categoryC:0,categoryD:0,
            bothSameMonthCount:0,bothOtherMonthCount:0,
            itsmNotInLoadedMbCount:0,itsmUnknownMbCoverageCount:0});
        }
        const out=groups.get(id);
        for(const field of Object.keys(out)){
          if(field==='label')continue;
          const value=Object.prototype.hasOwnProperty.call(group,field)
            ?group[field]:group.linkage?.[field];
          if(Number.isFinite(value))out[field]+=value;
        }
      }
    }
    const byInitiator=Object.freeze(Array.from(groups.values(),g=>
      Object.freeze(g)).sort((a,b)=>a.label.localeCompare(b.label,'ru')));
    return Object.freeze({
      version:'1.0.0',...counts,byInitiator,
      mbPresent:table.meta?.mbPresent===true,
      itsmCoverageStatus:table.meta?.itsmCoverageStatus||'unknown',
      mbCoverageStatus:table.meta?.mbCoverageStatus||'unknown',
      scope:'loaded-datasets-only',
      periodRule:'ITSM completedAt/closedAt versus MB factDate'
    });
  }

  function calculate(families = {}, query = {}) {
    const definition = definitions.classification_quality;
    const table = families.classification;
    const selection = common.selectRows(table, query, FILTERS);
    if (selection.error) {
      return common.unavailable(definition, query, selection.error, {
        diagnostics: { unsupportedFilters: selection.unsupportedFilters }
      });
    }

    const classificationSuccessCount = common.sum(selection.rows, 'classificationSuccessCount');
    const classificationFailureCount = common.sum(selection.rows, 'classificationFailureCount');
    const classificationTotalCount = common.sum(selection.rows, 'classificationTotalCount');
    const classificationIncUnchangedCount = common.sum(selection.rows, 'classificationIncUnchangedCount');
    const classificationIncCorrectedCount = common.sum(selection.rows, 'classificationIncCorrectedCount');
    const classificationIncUnclassifiedCount = common.sum(selection.rows, 'classificationIncUnclassifiedCount');
    const classificationRitmInsteadOfIncCount = common.sum(selection.rows, 'classificationRitmInsteadOfIncCount');
    const components = {
      classificationSuccessCount,
      classificationFailureCount,
      classificationTotalCount,
      classificationIncUnchangedCount,
      classificationIncCorrectedCount,
      classificationIncUnclassifiedCount,
      classificationRitmInsteadOfIncCount
    };
    const coverage=coverageDiagnostics(families.classificationDiagnostics,query);
    const ratio = common.percent(classificationSuccessCount, classificationTotalCount);

    if (ratio.state !== 'available') {
      return common.unavailable(definition, query, 'classification-denominator-zero', {
        dataState: 'no-data',
        components,
        diagnostics: { source: table?.meta || {}, classificationCoverage:coverage }
      });
    }

    return common.result(definition, {
      value: ratio.value,
      query: selection.query,
      components,
      diagnostics: { source: table?.meta || {}, classificationCoverage:coverage }
    });
  }

  const api = Object.freeze({ calculate });
  globalThis.ReclassifierKpiCalculateClassificationQuality = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
