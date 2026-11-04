// FILE CONTRACT: fixed Drivers reference population for VBR.
// Drivers counts (шт) are grouped by physical mine, service and ITSM equipment name.
// No request/event rows are used as a denominator and no historical population is claimed.

(() => {
  'use strict';

  const common = globalThis.ReclassifierKpiPreparationCommon;
  const sourceFacts = globalThis.ReclassifierKpiSourceFacts;
  if (!common?.componentTable || !sourceFacts?.driverPopulationSnapshot) {
    throw new Error('KPI Preparation Common and Driver population facts are required.');
  }

  const GRAIN = [
    'organizationalUnit',
    'equipmentClass',
    'equipmentType',
    'equipmentName',
    'sourceCatalog'
  ];

  function prepare(driversInstance = {}) {
    const population = sourceFacts.driverPopulationSnapshot(driversInstance);
    const rows = population.records.map(record => ({
      organizationalUnit: record.organizationalUnit,
      equipmentClass: record.equipmentClass,
      equipmentType: record.equipmentType,
      equipmentName: record.equipmentName,
      sourceCatalog: record.sourceCatalog,
      equipmentCount: record.equipmentCount,
      sourceRowCount: record.sourceRowCount
    }));

    return common.componentTable('equipment_population', GRAIN, rows, {
      sourceDataset: 'drivers',
      snapshotKind: 'fixed-reference',
      referenceFreshness: population.referenceFreshness,
      supportsHistoricalPeriods: false,
      usableRows: population.usableRows,
      summaryRowsSkipped: population.summaryRowsSkipped,
      unusableQuantityRows: population.unusableQuantityRows,
      unidentifiedRows: population.unidentifiedRows,
      equipmentCount: rows.reduce((sum, row) => sum + row.equipmentCount, 0)
    });
  }

  const api = Object.freeze({ prepare });
  globalThis.ReclassifierKpiPrepareEquipment = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
