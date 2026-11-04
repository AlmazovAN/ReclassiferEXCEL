// FILE CONTRACT: pure SLA formula over prepared SLA components.

(() => {
  'use strict';

  const common = globalThis.ReclassifierKpiCalculatorCommon;
  const definitions = globalThis.ReclassifierKpiDefinitions;
  if (!common?.percent || !definitions?.sla) throw new Error('KPI Calculator Common/Definitions are required for SLA.');

  const FILTERS = Object.freeze({
    branch: 'branch',
    mine: 'mine',
    equipmentClass: 'equipmentClass',
    equipmentType: 'equipmentType',
    equipmentName: 'equipmentName'
  });

  function calculate(families = {}, query = {}) {
    const definition = definitions.sla;
    const table = families.sla;
    const selection = common.selectRows(table, query, FILTERS);
    if (selection.error) {
      return common.unavailable(definition, query, selection.error, {
        diagnostics: { unsupportedFilters: selection.unsupportedFilters }
      });
    }

    const slaSuccessCount = common.sum(selection.rows, 'slaSuccessCount');
    const slaOverdueCount = common.sum(selection.rows, 'slaOverdueCount');
    const slaTotalCount = common.sum(selection.rows, 'slaTotalCount');
    const ratio = common.percent(slaSuccessCount, slaTotalCount);

    if (ratio.state !== 'available') {
      return common.unavailable(definition, query, 'sla-denominator-zero', {
        dataState: 'no-data',
        components: { slaSuccessCount, slaOverdueCount, slaTotalCount },
        diagnostics: { source: table?.meta || {} }
      });
    }

    return common.result(definition, {
      value: ratio.value,
      query: selection.query,
      components: { slaSuccessCount, slaOverdueCount, slaTotalCount },
      diagnostics: { source: table?.meta || {} }
    });
  }

  const api = Object.freeze({ calculate });
  globalThis.ReclassifierKpiCalculateSla = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
