// FILE CONTRACT: pure labor KPI formulas over Mobile Brigade labor components.

(() => {
  'use strict';

  const common = globalThis.ReclassifierKpiCalculatorCommon;
  const definitions = globalThis.ReclassifierKpiDefinitions;
  if (!common?.result || !definitions?.total_labor) {
    throw new Error('KPI Calculator Common/Definitions are required for labor.');
  }

  const FILTERS = Object.freeze({
    mine: 'site',
    equipmentClass: 'equipmentClass',
    equipmentType: 'equipmentType',
    equipmentName: 'equipmentName'
  });

  function baseSelection(families, query) {
    return common.selectRows(families.labor, query, FILTERS);
  }

  function typeHours(rows, acceptedTypes, audit = null) {
    const accepted = new Set(acceptedTypes.map(common.key));
    let matchedRows = 0;
    const total = Array.from(rows || []).reduce((sum, row) => {
      if (!accepted.has(common.key(row?.finalTaskType))) return sum;
      matchedRows += 1;
      return sum + (Number.isFinite(row?.laborHours) ? row.laborHours : 0);
    }, 0);
    audit?.subset?.({
      tableId:'mobile_brigade_labor',field:'finalTaskType',
      acceptedTypes:acceptedTypes.slice(),inputRows:rows.length,
      outputRows:matchedRows,excludedRows:rows.length-matchedRows,
      sumField:'laborHours',sumValue:total
    });
    return total;
  }

  function laborDiagnostics(table, selection) {
    return {
      selectedRows: selection.rows.length,
      source: table?.meta || {}
    };
  }

  function absolute(definition, families, query, acceptedTypes = null) {
    const table = families.labor;
    const selection = baseSelection(families, query);
    if (selection.error) {
      return common.unavailable(definition, query, selection.error, {
        diagnostics: { unsupportedFilters: selection.unsupportedFilters }
      });
    }
    const laborHours = acceptedTypes
      ? typeHours(selection.rows, acceptedTypes, query.audit)
      : common.sum(selection.rows, 'laborHours');
    const usableLaborTaskCount = common.sum(selection.rows, 'usableLaborTaskCount');
    const unusableLaborTaskCount = common.sum(selection.rows, 'unusableLaborTaskCount');
    const taskCount = common.sum(selection.rows, 'taskCount');

    if (taskCount === 0) {
      return common.unavailable(definition, query, 'no-labor-rows', {
        dataState: 'no-data',
        components: { laborHours, taskCount, usableLaborTaskCount, unusableLaborTaskCount },
        diagnostics: laborDiagnostics(table, selection)
      });
    }
    if (usableLaborTaskCount === 0) {
      return common.unavailable(definition, query, 'no-usable-labor', {
        dataState: 'no-data',
        components: { laborHours, taskCount, usableLaborTaskCount, unusableLaborTaskCount },
        diagnostics: laborDiagnostics(table, selection)
      });
    }

    return common.result(definition, {
      value: laborHours,
      query: selection.query,
      components: { laborHours, taskCount, usableLaborTaskCount, unusableLaborTaskCount },
      diagnostics: laborDiagnostics(table, selection)
    });
  }

  function calculateTotal(families = {}, query = {}) {
    return absolute(definitions.total_labor, families, query);
  }

  function calculateAvr(families = {}, query = {}) {
    return absolute(definitions.avr_labor, families, query, ['АВР']);
  }

  function calculateMaintenance(families = {}, query = {}) {
    return absolute(definitions.maintenance_labor, families, query, ['ТО по графику', 'ТО вне графика']);
  }

  function calculateCorrective(families = {}, query = {}) {
    return absolute(definitions.corrective_labor, families, query, ['Корректирующее воздействие']);
  }

  function calculateAvrShare(families = {}, query = {}) {
    const table = families.labor;
    const selection = baseSelection(families, query);
    if (selection.error) {
      return common.unavailable(definitions.avr_share, query, selection.error, {
        diagnostics: { unsupportedFilters: selection.unsupportedFilters }
      });
    }
    const totalLaborHours = common.sum(selection.rows, 'laborHours');
    const avrLaborHours = typeHours(selection.rows, ['АВР'], query.audit);
    const ratio = common.percent(avrLaborHours, totalLaborHours);
    if (ratio.state !== 'available') {
      return common.unavailable(definitions.avr_share, query, 'labor-denominator-zero', {
        dataState: 'no-data',
        components: { avrLaborHours, totalLaborHours },
        diagnostics: laborDiagnostics(table, selection)
      });
    }
    return common.result(definitions.avr_share, {
      value: ratio.value,
      query: selection.query,
      components: { avrLaborHours, totalLaborHours },
      diagnostics: laborDiagnostics(table, selection)
    });
  }

  function calculateReactiveShare(families = {}, query = {}) {
    const table = families.labor;
    const selection = baseSelection(families, query);
    if (selection.error) {
      return common.unavailable(definitions.reactive_share, query, selection.error, {
        diagnostics: { unsupportedFilters: selection.unsupportedFilters }
      });
    }
    const totalLaborHours = common.sum(selection.rows, 'laborHours');
    const avrLaborHours = typeHours(selection.rows, ['АВР'], query.audit);
    const correctiveLaborHours = typeHours(selection.rows, ['Корректирующее воздействие'], query.audit);
    const reactiveLaborHours = avrLaborHours + correctiveLaborHours;
    const ratio = common.percent(reactiveLaborHours, totalLaborHours);
    if (ratio.state !== 'available') {
      return common.unavailable(definitions.reactive_share, query, 'labor-denominator-zero', {
        dataState: 'no-data',
        components: { avrLaborHours, correctiveLaborHours, reactiveLaborHours, totalLaborHours },
        diagnostics: laborDiagnostics(table, selection)
      });
    }
    return common.result(definitions.reactive_share, {
      value: ratio.value,
      query: selection.query,
      components: { avrLaborHours, correctiveLaborHours, reactiveLaborHours, totalLaborHours },
      diagnostics: laborDiagnostics(table, selection)
    });
  }

  const api = Object.freeze({
    calculateTotal,
    calculateAvr,
    calculateAvrShare,
    calculateMaintenance,
    calculateCorrective,
    calculateReactiveShare
  });
  globalThis.ReclassifierKpiCalculateLabor = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
