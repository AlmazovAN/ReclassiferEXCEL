// FILE CONTRACT: ITSM subject rules adapter for the preview-only recalculation engine.
// Reads: current ITSM, ReClass, Drivers, customer/request reference Datasets and MB.
// Writes: NOTHING. COMMIT/materialization belongs to later PRs.
// Does not read Equipment Combined or derive Drivers quantities from Equipment.
(() => {
  'use strict';

  const REF_IDS = Object.freeze([
    'reclassification', 'drivers', 'customers', 'type_request',
    'initiators', 'exceptions', 'problem_grade', 'mobile_brigade_data'
  ]);
  const CLASSIFICATION_FIELDS = Object.freeze([
    'reclassifiedEquipment', 'reclassifiedElement',
    'reclassifiedFault', 'reclassifiedReason'
  ]);
  const SLA_HEADING = /измерение цели обслуживания.*прошло\s*\(рабочее время\)/i;

  function rawSla(raw) {
    if (!raw || !Array.isArray(raw.columns) || !Array.isArray(raw.values)) return { available: false };
    const position = raw.columns.findIndex(column =>
      SLA_HEADING.test(String(column || '').replace(/\s+/g, ' '))
    );
    if (position < 0) return { available: false };
    const value = raw.values[position];
    if (value == null || String(value).trim() === '') return { available: true, value: null };
    if (typeof value === 'number' && Number.isFinite(value)) {
      return { available: true, value };
    }
    const converted = Number(String(value).trim().replace(',', '.'));
    return Number.isFinite(converted)
      ? { available: true, value: converted }
      : { available: false };
  }

  function create(options = {}) {
    const runtime = options.runtime || globalThis.ReclassifierRuntimeDataRepository;
    const catalog = options.catalog || globalThis.ReclassifierDatasetCatalog;
    const schema = options.schema || globalThis.ReclassifierItsmDatasetSchema;
    const rules = options.rules || globalThis.ReclassifierItsmRules;
    const presence = options.mbPresence || globalThis.ReclassifierItsmMbPresence;
    const coreApi = options.core || globalThis.ReclassifierRecalculationCore;
    if (!runtime?.get || !catalog?.get || !schema?.fields ||
        typeof rules?.buildLookups !== 'function' ||
        typeof rules?.evaluateRow !== 'function' ||
        !presence?.STATUS || !coreApi?.create) {
      throw new Error('ITSM Recalculation: отсутствует контракт обработки ITSM.');
    }
    const fieldNames = Array.from(schema.fields);
    const outputNames = fieldNames.slice(schema.sourceFieldCount,
      schema.sourceFieldCount + schema.outputFieldCount);
    if (outputNames.length !== rules.outputColumns.length ||
        fieldNames[schema.sourceFieldCount + schema.outputFieldCount] !== 'mbPresence') {
      throw new Error('ITSM Recalculation: схема и выходные поля ITSM Rules не совпадают.');
    }
    const core = coreApi.create({ runtime, catalog, itsmSchema: schema });

    function referenceInputs() {
      const inputs = {};
      for (const id of REF_IDS) {
        const instance = runtime.get(id);
        if (!instance || !Array.isArray(instance.records) ||
            instance.validation?.status === 'invalid' ||
            (id !== 'exceptions' && instance.records.length === 0)) {
          throw new Error('ITSM Recalculation: обязательный справочник/Dataset недоступен: ' + id + '.');
        }
        inputs[id] = instance.records;
        if (id === 'mobile_brigade_data') {
          inputs.mobile_brigade_meta = {
            latestSourceDate: instance.meta?.latestSourceDate || null
          };
        }
      }
      return inputs;
    }

    function buildStep(references) {
      const lookups = rules.buildLookups(references);
      const reclass = lookups.reclassification;
      return {
        datasetId: 'itsm_data',
        dependsOn: REF_IDS,
        calculate({ record, raw, key, asOfDate, getRowsByField }) {
          const instance = runtime.get('itsm_data');
          const storedFields = instance?.meta?.fields || fieldNames;
          const fieldValue = field => {
            if (Array.isArray(record)) {
              const position = storedFields.indexOf(field);
              if (position < 0) {
                throw new Error('ITSM Recalculation: поле отсутствует в накопленной записи: ' + field);
              }
              return record[position];
            }
            return record[field];
          };
          const matched = reclass.has(key);
          const priorClass = {
            equipment: fieldValue('reclassifiedEquipment'),
            element: fieldValue('reclassifiedElement'),
            fault: fieldValue('reclassifiedFault'),
            incidentReason: fieldValue('reclassifiedReason')
          };
          // Null/undefined means that the old row was never calculated.
          // Empty strings can be legitimate classification fields.
          const hasPriorClass = Object.values(priorClass)
            .some(value => value !== null && value !== undefined);
          const sla = rawSla(raw);
          const linkedMb = getRowsByField('mobile_brigade_data', 'request', key);
          const result = rules.evaluateRow({
            created: fieldValue('createdAt'),
            completed: fieldValue('completedAt'),
            closed: fieldValue('closedAt'),
            number: fieldValue('number'),
            territory: fieldValue('territory'),
            equipment: fieldValue('sourceEquipment'),
            element: fieldValue('sourceElement'),
            fault: fieldValue('sourceFault'),
            reason: fieldValue('sourceReason'),
            shortDescription: fieldValue('shortDescription'),
            openedBy: fieldValue('openedBy'),
            slaWorking: sla.available ? sla.value : null,
            closureCode: fieldValue('closureCode')
          }, lookups, {
            asOfDate,
            fallbackClassification: matched || !hasPriorClass ? null : priorClass,
            mobileBrigadeRows: linkedMb
          });

          const patch = {};
          result.values.forEach((value, index) => {
            const field = outputNames[index];
            // Never restore source classification when an updated ReClass
            // contains no matching request ID.
            if (!matched && CLASSIFICATION_FIELDS.includes(field)) return;
            // The analytic 52-field Dataset has no raw SLA seconds. If the
            // original value is unavailable, preserve the previous result.
            if (field === 'slaHours' && !sla.available) return;
            patch[field] = value;
          });
          patch.mbPresence = !key
            ? presence.STATUS.UNKNOWN
            : linkedMb.length ? presence.STATUS.PRESENT : presence.STATUS.ABSENT;
          return patch;
        }
      };
    }

    // PR7: share the exact official ITSM step with the combined MB -> ITSM
    // preview. A single Recalculation Core owns staged lookups and one plan.
    function createStep() {
      return buildStep(referenceInputs());
    }

    async function preview(options = {}) {
      return core.preview({
        steps: [createStep()],
        asOfDate: options.asOfDate,
        sampleLimit: options.sampleLimit,
        signal: options.signal,
        onProgress: options.onProgress
      });
    }

    return Object.freeze({
      createStep,
      preview,
      assertCurrent: core.assertCurrent
    });
  }

  globalThis.ReclassifierItsmRecalculation = Object.freeze({
    version: '1.0.0',
    dependencies: REF_IDS,
    create
  });
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = globalThis.ReclassifierItsmRecalculation;
  }
})();
