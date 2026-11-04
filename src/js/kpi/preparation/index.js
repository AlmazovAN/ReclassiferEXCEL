// FILE CONTRACT: orchestrator for subject-specific KPI calculation components.
// Purpose: compose independent preparation families without creating a shared mega-table.
// Output: immutable component bundle. No final KPI formulas and no presentation model.

(() => {
  'use strict';

  const sourceFacts = globalThis.ReclassifierKpiSourceFacts;
  const common = globalThis.ReclassifierKpiPreparationCommon;
  const failures = globalThis.ReclassifierKpiPrepareFailures;
  const equipment = globalThis.ReclassifierKpiPrepareEquipment;
  const labor = globalThis.ReclassifierKpiPrepareLabor;
  const sla = globalThis.ReclassifierKpiPrepareSla;
  const classification = globalThis.ReclassifierKpiPrepareClassification;
  const prb = globalThis.ReclassifierKpiPreparePrb;
  const ktg = globalThis.ReclassifierKpiPrepareKtg;

  if (!sourceFacts?.itsmDatasetFacts || !common?.version ||
      !failures?.prepare || !equipment?.prepare || !labor?.prepare ||
      !sla?.prepare || !classification?.prepare || !classification?.prepareCgps ||
      !classification?.prepareDiagnostics || !prb?.prepare || !ktg?.prepare) {
    throw new Error('KPI Preparation modules are incomplete.');
  }

  function prepare(input = {}) {
    const itsm = input.itsm || {};
    const mobile = input.mobileBrigade || {};
    const driversSource = input.drivers || {};
    const equipmentSource = input.equipment || {};

    const itsmFacts = Array.isArray(input.itsmFacts)
      ? Object.freeze(input.itsmFacts.slice())
      : sourceFacts.itsmDatasetFacts(
          itsm.fields || [],
          itsm.records || [],
          itsm.fullDataset || null
        );
    const mobileRecords = Array.isArray(mobile.records) ? mobile.records : [];

    const equipmentTable = equipment.prepare(driversSource);
    const bundle = {
      version: common.version,
      architecture: 'subject-component-tables',
      itsmFactCount: itsmFacts.length,
      mobileBrigadeRowCount: mobileRecords.length,
      families: Object.freeze({
        failures: failures.prepare(itsmFacts),
        equipment: equipmentTable,
        labor: labor.prepare(mobileRecords),
        sla: sla.prepare(itsmFacts),
        classification: classification.prepare(itsmFacts),
        classificationDiagnostics: classification.prepareDiagnostics(itsmFacts, {
          records: mobileRecords, meta: mobile.meta || {},
          available: mobile.available !== false
        }, itsm.meta || {}),
        classificationCgps: classification.prepareCgps(itsmFacts, {
          records: mobileRecords,
          meta: mobile.meta || {},
          available: mobile.available !== false
        }),
        prb: prb.prepare(mobileRecords, itsmFacts),
        ktg: ktg.prepare(itsmFacts, equipmentTable)
      })
    };

    return Object.freeze(bundle);
  }

  const api = Object.freeze({
    version: common.version,
    prepare
  });

  globalThis.ReclassifierKpiPreparation = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
