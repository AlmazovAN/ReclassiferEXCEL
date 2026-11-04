// FILE CONTRACT: Mobile Brigade ITSM-link recalculation adapter.
// Purpose: preview updates of ITSM creation dates for accumulated MB tasks.
// Reads: active ITSM + MB Datasets and the canonical ITSM field/date contracts.
// Writes: NOTHING; source MB fields, Full Dataset and Runtime stay unchanged.
// Public API: globalThis.ReclassifierMobileBrigadeRecalculation.create().
// Must not: calculate preBacklogAge (not implemented in the current Worker),
//           rewrite MB-only labor/classification fields or publish revisions.
(() => {
  'use strict';

  function create(options = {}) {
    const runtime = options.runtime || globalThis.ReclassifierRuntimeDataRepository;
    const catalog = options.catalog || globalThis.ReclassifierDatasetCatalog;
    const itsmSchema = options.itsmSchema || globalThis.ReclassifierItsmDatasetSchema;
    const rules = options.rules || globalThis.ReclassifierMobileBrigadeRules;
    const coreApi = options.core || globalThis.ReclassifierRecalculationCore;

    if (!runtime?.get || !catalog?.get || !itsmSchema?.mobileBrigadeLinkRows ||
        !rules?.parseItsmCreatedAt || !coreApi?.create) {
      throw new Error('МБ Recalculation: отсутствуют контракты ITSM и МБ.');
    }

    const core = coreApi.create({ runtime, catalog, itsmSchema });

    function createStep() {
      const itsm = runtime.get('itsm_data');
      if (!itsm || !Array.isArray(itsm.records) || !itsm.records.length) {
        throw new Error('МБ Recalculation: ITSM не загружен — обогащение невозможно.');
      }
      const storedFields = itsm.meta?.fields || itsm.state?.fields || null;
      // Validate the schema before entering the task loop. The authoritative
      // lookup itself is maintained by Recalculation Core by stable ticket key.
      itsmSchema.mobileBrigadeLinkRows(itsm.records.slice(0, 1), storedFields);

      return Object.freeze({
        datasetId: 'mobile_brigade_data',
        dependsOn: ['itsm_data'],
        calculate({ record, getRecord }) {
          const requestKey = rules.key(record?.request);
          if (!requestKey) {
            return { skip: true, reason: 'no-request-number' };
          }
          const ticket = getRecord('itsm_data', requestKey);
          if (!ticket) {
            // A historical MB task can predate the available ITSM export.
            // Do not erase an older successful link because the current
            // authoritative ITSM data has no matching request.
            return { skip: true, reason: 'itsm-request-not-found' };
          }

          const linked = itsmSchema.mobileBrigadeLinkRows([ticket], storedFields)[0];
          const nextDate = rules.parseItsmCreatedAt(linked?.createdAt);
          if (!nextDate) {
            // Invalid/missing current ITSM date is not evidence that the
            // previously imported date should be cleared.
            return { skip: true, reason: 'itsm-date-missing' };
          }

          const previousDate = rules.parseItsmCreatedAt(record.itsmCreatedAt);
          if (previousDate?.getTime() === nextDate.getTime()) {
            // Databases may serialize Date objects as UTC ISO strings; do not
            // issue a false change simply because JS value types differ.
            return {};
          }
          return { itsmCreatedAt: nextDate };
        }
      });
    }

    async function preview(request = {}) {
      return core.preview({
        steps: [createStep()],
        asOfDate: request.asOfDate,
        sampleLimit: request.sampleLimit,
        signal: request.signal,
        onProgress: request.onProgress
      });
    }

    return Object.freeze({
      createStep,
      preview,
      assertCurrent: core.assertCurrent
    });
  }

  globalThis.ReclassifierMobileBrigadeRecalculation = Object.freeze({
    version: '1.0.0',
    dependencies: Object.freeze(['itsm_data']),
    calculatedFields: Object.freeze(['itsmCreatedAt']),
    create
  });
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = globalThis.ReclassifierMobileBrigadeRecalculation;
  }
})();
