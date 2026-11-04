// FILE CONTRACT: independent quality KPI for work registered in Mobile Brigades.
// Business scope: all A/B/C INC with confirmed MB request; D=RITM instead of INC
// only when the calculated ITSM initiator group is ЦГПС. Never use equipmentName.
(() => {
  'use strict';
  const common = globalThis.ReclassifierKpiCalculatorCommon;
  const definitions = globalThis.ReclassifierKpiDefinitions;
  if (!common?.percent || !definitions?.classification_quality_cgps) {
    throw new Error('Calculator Common and CGPS definition are required.');
  }
  const FILTERS = Object.freeze({
    branch: 'branch', mine: 'mine', equipmentClass: 'equipmentClass',
    equipmentType: 'equipmentType', equipmentName: 'equipmentName'
  });

  function calculate(families = {}, query = {}) {
    const definition = definitions.classification_quality_cgps;
    const table = families.classificationCgps;
    const selection = common.selectRows(table, query, FILTERS);
    if (selection.error) return common.unavailable(definition, query, selection.error, {
      diagnostics: { unsupportedFilters: selection.unsupportedFilters }
    });

    const keys = [
      'classificationSuccessCount',
      'classificationFailureCount',
      'classificationTotalCount',
      'classificationIncUnchangedCount',
      'classificationIncCorrectedCount',
      'classificationIncUnclassifiedCount',
      'classificationRitmInsteadOfIncCount',
      'excludedNoMbCount',
      'unknownMbCoverageCount',
      'excludedOtherInitiatorRitmCount',
      'excludedUnknownInitiatorRitmCount',
      'excludedMissingRequestCount'
    ];
    const components = Object.fromEntries(keys.map(key => [key, common.sum(selection.rows, key)]));
    const diagnostics = {
      source: table?.meta || {},
      selectedExcludedNoMb: components.excludedNoMbCount,
      selectedUnknownMbCoverage: components.unknownMbCoverageCount,
      selectedExcludedOtherInitiatorRitm: components.excludedOtherInitiatorRitmCount,
      selectedExcludedUnknownInitiatorRitm: components.excludedUnknownInitiatorRitmCount,
      selectedExcludedMissingRequest: components.excludedMissingRequestCount
    };

    // "Нет данных МБ" now means the MB Dataset is unavailable, never
    // merely that an ITSM request is outside a date range. No definitive
    // percentage can be published when an eligible request cannot be checked.
    if (components.unknownMbCoverageCount > 0) {
      return common.unavailable(definition, query, 'mb-coverage-unknown', {
        dataState: 'no-data', components, diagnostics
      });
    }
    const ratio = common.percent(components.classificationSuccessCount,
      components.classificationTotalCount);
    if (ratio.state !== 'available') {
      return common.unavailable(definition, query, 'classification-denominator-zero', {
        dataState: 'no-data', components, diagnostics
      });
    }
    return common.result(definition, {
      value: ratio.value, query: selection.query, components, diagnostics
    });
  }

  const api = Object.freeze({ calculate });
  globalThis.ReclassifierKpiCalculateClassificationQualityCgps = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
