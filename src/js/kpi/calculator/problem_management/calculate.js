// FILE CONTRACT: pure Problem Management coverage formulas over prepared MB->ITSM->PRB components.

(() => {
  'use strict';

  const common = globalThis.ReclassifierKpiCalculatorCommon;
  const definitions = globalThis.ReclassifierKpiDefinitions;
  if (!common?.result || !definitions?.problem_coverage_absolute) {
    throw new Error('KPI Calculator Common/Definitions are required for Problem Management.');
  }

  const FILTERS = Object.freeze({
    branch: 'branch',
    mine: 'mine',
    equipmentClass: 'equipmentClass',
    problemId: 'problemId',
    finalTaskType: 'finalTaskType'
  });

  function selection(families, query) {
    return common.selectRows(families.prb, query, FILTERS);
  }

  function components(rows, audit = null) {
    const values = {
      taskCount: common.sum(rows, 'taskCount'),
      usableLaborTaskCount: common.sum(rows, 'usableLaborTaskCount'),
      unusableLaborTaskCount: common.sum(rows, 'unusableLaborTaskCount'),
      laborHours: common.sum(rows, 'laborHours'),
      linkedTaskCount: common.sum(rows, 'linkedTaskCount'),
      linkedLaborHours: common.sum(rows, 'linkedLaborHours')
    };
    audit?.linkage?.({
      tableId:'problem_management',groupRows:rows.length,
      taskCount:values.taskCount,linkedTaskCount:values.linkedTaskCount,
      unlinkedTaskCount:values.taskCount-values.linkedTaskCount,
      laborHours:values.laborHours,linkedLaborHours:values.linkedLaborHours
    });
    return values;
  }

  function calculateAbsolute(families = {}, query = {}) {
    const table = families.prb;
    const selected = selection(families, query);
    if (selected.error) {
      return common.unavailable(definitions.problem_coverage_absolute, query, selected.error, {
        diagnostics: { unsupportedFilters: selected.unsupportedFilters }
      });
    }
    const c = components(selected.rows, query.audit);
    if (c.taskCount === 0) {
      return common.unavailable(definitions.problem_coverage_absolute, query, 'no-prb-source-rows', {
        dataState: 'no-data',
        components: c,
        diagnostics: { source: table?.meta || {} }
      });
    }
    if (c.usableLaborTaskCount === 0) {
      return common.unavailable(definitions.problem_coverage_absolute, query, 'no-usable-labor', {
        dataState: 'no-data',
        components: c,
        diagnostics: { source: table?.meta || {} }
      });
    }
    return common.result(definitions.problem_coverage_absolute, {
      value: c.linkedLaborHours,
      query: selected.query,
      components: c,
      diagnostics: { source: table?.meta || {} }
    });
  }

  function calculateRelative(families = {}, query = {}) {
    const table = families.prb;
    const selected = selection(families, query);
    if (selected.error) {
      return common.unavailable(definitions.problem_coverage_relative, query, selected.error, {
        diagnostics: { unsupportedFilters: selected.unsupportedFilters }
      });
    }
    const c = components(selected.rows, query.audit);
    const ratio = common.percent(c.linkedLaborHours, c.laborHours);
    if (ratio.state !== 'available') {
      return common.unavailable(definitions.problem_coverage_relative, query, 'problem-labor-denominator-zero', {
        dataState: 'no-data',
        components: c,
        diagnostics: { source: table?.meta || {} }
      });
    }
    return common.result(definitions.problem_coverage_relative, {
      value: ratio.value,
      query: selected.query,
      components: c,
      diagnostics: { source: table?.meta || {} }
    });
  }

  // All three metrics use the same selected prepared task rows as the two
  // existing labor-coverage KPIs. Ambiguous and unmatched ITSM joins are NEVER
  // promoted into linked tasks or unique IT-problems.
  function calculateLinkedTasks(families = {}, query = {}) {
    const table = families.prb;
    const selected = selection(families, query);
    const definition = definitions.problem_linked_tasks;
    if (selected.error) return common.unavailable(definition, query, selected.error, {
      diagnostics:{unsupportedFilters:selected.unsupportedFilters}
    });
    const c = components(selected.rows, query.audit);
    if (c.taskCount === 0) return common.unavailable(definition, query,
      'no-prb-source-rows', {dataState:'no-data',components:c,
        diagnostics:{source:table?.meta||{}}});
    return common.result(definition,{value:c.linkedTaskCount,
      query:selected.query,components:c,diagnostics:{source:table?.meta||{}}});
  }

  function calculateTaskCoverage(families = {}, query = {}) {
    const table = families.prb;
    const selected = selection(families, query);
    const definition = definitions.problem_task_coverage;
    if (selected.error) return common.unavailable(definition, query, selected.error, {
      diagnostics:{unsupportedFilters:selected.unsupportedFilters}
    });
    const c = components(selected.rows, query.audit);
    const ratio=common.percent(c.linkedTaskCount,c.taskCount);
    if (ratio.state !== 'available') return common.unavailable(definition, query,
      'problem-task-denominator-zero',{dataState:'no-data',components:c,
        diagnostics:{source:table?.meta||{}}});
    return common.result(definition,{value:ratio.value,query:selected.query,
      components:c,diagnostics:{source:table?.meta||{}}});
  }

  function calculateActiveProblemCount(families = {}, query = {}) {
    const table = families.prb;
    const selected = selection(families, query);
    const definition = definitions.problem_active_count;
    if (selected.error) return common.unavailable(definition, query, selected.error, {
      diagnostics:{unsupportedFilters:selected.unsupportedFilters}
    });
    const c = components(selected.rows, query.audit);
    if (c.taskCount === 0) return common.unavailable(definition,query,
      'no-prb-source-rows',{dataState:'no-data',components:c,
        diagnostics:{source:table?.meta||{}}});
    // DISTINCT is evaluated over *all* selected rows, including multiple
    // months, so a single PRB remains one problem across months and task types.
    const unique=new Set(selected.rows
      .filter(row=>row.problemLinkState==='linked' &&
        Number(row.linkedTaskCount||0)>0 && row.problemId)
      .map(row=>String(row.problemId).trim().toUpperCase()));
    const withDistinct={...c,uniqueProblemCount:unique.size};
    return common.result(definition,{value:unique.size,
      query:selected.query,components:withDistinct,
      diagnostics:{source:table?.meta||{}}});
  }

  const api = Object.freeze({
    calculateAbsolute, calculateRelative,
    calculateLinkedTasks, calculateTaskCoverage, calculateActiveProblemCount
  });
  globalThis.ReclassifierKpiCalculateProblemManagement = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
