// FILE CONTRACT: current-request runtime execution evidence for KPI Results.
// Captured inside the real Calculator selectRows/typeHours/PRB operations; never replay
// selections or pretend catalog declarations are observed operations.
// Recorded counts are aggregated, never individual ITSM/MB row contents.
(() => {
  'use strict';

  const catalog = globalThis.ReclassifierKpiCatalog;
  if (!catalog?.list || !catalog?.getCalculation) {
    throw new Error('KPI Execution Trace requires the real KPI Catalog.');
  }

  const VERSION = '1.0.0';
  function freeze(value) {
    if (value && typeof value === 'object' && !Object.isFrozen(value)) {
      Object.values(value).forEach(freeze);
      Object.freeze(value);
    }
    return value;
  }
  function preparedTables(bundle) {
    const f=bundle?.families || {};
    const tables=[
      f.failures?.events,f.failures?.downtime,
      f.equipment,f.labor,f.sla,f.classification,f.classificationCgps,
      f.prb,f.ktg?.fleet,f.ktg?.work
    ].filter(Boolean);
    return new Map(tables.map(table=>[table.id,table]));
  }
  function safeMeta(meta) {
    const result={};
    const allowed=['rowsWithoutCompletionDate','failureRowsWithoutCreationDate',
      'inputItsmFactRows','reclassifiedIncRows','excludedByVbrDecisionRows',
      'incRowsWithOtherVbrDecision','failureRowsUsingCompletionDate',
      'failureRowsUsingCloseDate','failureRowsWithoutEventDate','failurePeriodBasis',
      'rowsWithoutFactDate','rowsWithoutFinalTaskType',
      'unknownSlaRows','knownSlaRowsWithoutCloseDate',
      'notApplicableRows','includedRowsWithoutCloseDate',
      'includedRowsWithoutEventDate','countedUsingCompletionDate',
      'countedUsingCloseDate','mbLinkage','initiatorRule','missingMbRows',
      'unknownMbRows','excludedOtherInitiatorRitmRows','excludedUnknownInitiatorRitmRows',
      'missingRequestRows','mbRule','includedRows',
      'activeEquipmentCount','inactiveEquipmentCount','unknownStatusCount',
      'missingIdCount','duplicateIdCount',
      'supportsHistoricalPeriods','snapshotDate','periodBasis',
      'referenceFreshness','sourceDataset','snapshotKind','usableRows',
      'summaryRowsSkipped','unusableQuantityRows','unidentifiedRows','equipmentCount',
      'sourceRows','activeUnits','inactiveUnits','unknownStatusUnits','duplicateIds','missingIds',
      'unattributedActiveUnits','eligibleRows','usableAstroRows','unknownAstroRows',
      'missingPeriodRows','missingDimensionsRows','duplicateTaskRows','otherWorkRows',
      'missingFinalTaskTypeRows','fullDatasetAligned','taskTypeRecoveredRows',
      'astroRecoveredRows','astroParsedStringRows',
      'durationSource','populationBasis'];
    for(const id of allowed) if(meta?.[id]!==undefined)result[id]=meta[id];
    if(meta?.laborStateCounts)result.laborStateCounts={...meta.laborStateCounts};
    if(meta?.selectedKindCounts)result.selectedKindCounts={...meta.selectedKindCounts};
    if(meta?.selectedKindHours)result.selectedKindHours={...meta.selectedKindHours};
    if(meta?.linkage)result.linkage={...meta.linkage};
    return result;
  }

  function createCollector(input={}) {
    const prepared=input.prepared || {};
    const sources=Array.from(input.sources || []);
    const tables=preparedTables(prepared);
    const capture=new Map();
    function events(kpiId) {
      if (!capture.has(kpiId)) capture.set(kpiId,[]);
      return capture.get(kpiId);
    }
    const forKpi=kpiId=>{
      if (!catalog.getCalculation(kpiId)) return null;
      return Object.freeze({
        selection:sample=>events(kpiId).push({kind:'selection',...sample}),
        subset:sample=>events(kpiId).push({kind:'subset',...sample}),
        linkage:sample=>events(kpiId).push({kind:'linkage',...sample})
      });
    };
    function finalize(results={}) {
      const traces={};
      for(const entry of catalog.list()) {
        const id=entry.id;
        const contract=entry.calculation;
        const result=results[id] || null;
        const selectedEvents=events(id);
        const sourceIds=new Set((contract?.sources||[]).map(source=>source.datasetId));
        const sourceRows=sources.filter(source=>sourceIds.has(source.id))
          .map(source=>({
            datasetId:source.id,available:Boolean(source.available),
            sourceRows:source.rowCount ?? null,
            revision:source.activeRevision ?? null,
            hash:source.contentHash || null,
            freshness:source.freshness || null
          }));
        const preparedRows=Array.from(contract?.sourceComponents||[]).map(tableId=>{
          const table=tables.get(tableId);
          return {
            tableId,preparedRows:table?.rowCount ?? null,
            grain:table?.grain || [],
            diagnostics:safeMeta(table?.meta || {})
          };
        });
        const hasUnavailableSource=sourceRows.some(source=>!source.available);
        const selections=selectedEvents.filter(event=>event.kind==='selection');
        const available=result?.dataState==='available' && Number.isFinite(result.value);
        traces[id]={
          version:VERSION,kpiId:id,
          contractVersion:contract?.contractVersion || null,
          formulaVersion:result?.formulaVersion || contract?.formula?.formulaVersion || null,
          dataState:result?.dataState || 'not-applicable',
          reason:result?.reason || (contract?'result-not-available':'not-implemented'),
          period:input.query?.period || null,
          filters:{...(input.query?.filters||{})},
          sources:sourceRows,
          preparation:preparedRows,
          // Freeze an isolated copy; a prior finalized snapshot must not freeze
          // or mutate the still-active collector when another read is performed.
          events:selectedEvents.map(event=>({
            ...event,
            stages:Array.from(event.stages||[],stage=>({...stage}))
          })),
          components:{...(result?.components||{})},
          value:available?result.value:null,
          // An observable selection is required before claiming executable filter evidence.
          evidence:!contract?'not-implemented':
            !result?'not-calculated':
            hasUnavailableSource?'source-guarded':
            selections.length?'observed':'no-selection-executed',
          caveats:[
            'Source row counts and preparation totals cover the full Dataset, not only the selected month/mine.',
            'Prepared rows are grouped components; selection counts are grouped-row counts, not numbers of original ITSM or MB records.',
            ...(hasUnavailableSource?['An unavailable Dataset guarded the final KPI; observed selections alone do not establish a valid result.']:[]),
            ...(contract?.joins?.length?['JOIN statistics are totals from the preparation pass; per-row join decisions are not retained.']:[]),
            ...(!selections.length&&contract?['The Calculator returned without executing a standard selection (e.g. unavailable historical VBR).']:[])
          ]
        };
      }
      return freeze({version:VERSION,query:{...(input.query||{})},byKpi:traces});
    }
    return Object.freeze({forKpi,finalize});
  }

  const api=Object.freeze({version:VERSION,createCollector});
  globalThis.ReclassifierKpiExecutionTrace=api;
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
})();
