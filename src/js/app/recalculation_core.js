// FILE CONTRACT: preview-only recalculation engine for accumulated event Datasets.
// Purpose: prepare deterministic field-level changes from Active Runtime, without Excel or writes.
// Reads: RuntimeDataRepository, DatasetCatalog, ITSM Dataset Schema and optional row processors.
// Writes: NOTHING. The future transactional commit layer must verify the plan is still current.
// Public API: globalThis.ReclassifierRecalculationCore.create(), .preview(), .assertCurrent().
// Must not: write to SQLite, activate HTML Dataset Store or change source fields.
(() => {
  'use strict';

  const MB_DERIVED_FIELDS = Object.freeze([
    'itsmCreatedAt', 'preBacklogAge', 'astroHours', 'finalTaskType', 'laborState'
  ]);
  const SUPPORTED = Object.freeze(['itsm_data', 'mobile_brigade_data']);

  function normalizedKey(value) {
    return String(value ?? '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ')
      .trim().toLocaleLowerCase('ru-RU');
  }

  function cloneValue(value) {
    if (value instanceof Date) return new Date(value.getTime());
    if (Array.isArray(value)) return value.map(cloneValue);
    if (value && typeof value === 'object') {
      const result = {};
      for (const [key, item] of Object.entries(value)) result[key] = cloneValue(item);
      return result;
    }
    return value;
  }

  function sameValue(a, b) {
    if (a instanceof Date || b instanceof Date) {
      return a instanceof Date && b instanceof Date && a.getTime() === b.getTime();
    }
    if (Object.is(a, b)) return true;
    if (a && b && typeof a === 'object' && typeof b === 'object') {
      return JSON.stringify(a) === JSON.stringify(b);
    }
    return false;
  }

  function fieldSchema(id, instance, itsmSchema) {
    if (id === 'mobile_brigade_data') {
      return { fields: null, mutable: new Set(MB_DERIVED_FIELDS), keyField: 'recordKey' };
    }
    const expected = Array.from(itsmSchema?.fields || []);
    const sourceCount = Number(itsmSchema?.sourceFieldCount);
    const fields = Array.from(instance?.meta?.fields || expected);
    if (!expected.length || !Number.isInteger(sourceCount) ||
        sourceCount <= 0 || sourceCount >= expected.length ||
        new Set(fields).size !== fields.length ||
        !expected.every(field => fields.includes(field))) {
      throw new Error('Recalculation: несовместимая схема ITSM.');
    }
    const mutable = new Set(expected.slice(sourceCount));
    return { fields, mutable, keyField: 'number' };
  }

  function recordField(record, name, schema) {
    return Array.isArray(record)
      ? record[schema.fields.indexOf(name)]
      : record?.[name];
  }

  function create(options = {}) {
    const runtime = options.runtime || globalThis.ReclassifierRuntimeDataRepository;
    const catalog = options.catalog || globalThis.ReclassifierDatasetCatalog;
    const itsmSchema = options.itsmSchema || globalThis.ReclassifierItsmDatasetSchema;
    if (!runtime?.get || !runtime?.mode || !catalog?.get || !itsmSchema?.fields) {
      throw new Error('Recalculation: Active Runtime и контракты данных недоступны.');
    }

    // These references are retained privately for an optimistic concurrency
    // check; no persistent handle or write capability is exposed.
    const preparedPlans = new WeakMap();

    function assertCurrent(plan) {
      const token = preparedPlans.get(plan);
      if (!token) throw new Error('Recalculation: неизвестный или устаревший план.');
      if (runtime.mode() !== token.mode) {
        throw new Error('Recalculation: источник Runtime изменился после предпросмотра.');
      }
      for (const [id, instance] of [...token.sources, ...(token.watched || [])]) {
        if (runtime.get(id) !== instance) {
          throw new Error('Recalculation: Dataset ' + id +
            ' изменился после предпросмотра. Выполните расчёт заново.');
        }
      }
      return true;
    }

    async function preview(request = {}) {
      const steps = request.steps;
      if (!Array.isArray(steps) || !steps.length) {
        throw new Error('Recalculation: передайте шаги с обработчиками расчёта.');
      }
      const seen = new Set();
      for (const step of steps) {
        if (!step || !SUPPORTED.includes(step.datasetId) ||
            typeof step.calculate !== 'function' || seen.has(step.datasetId)) {
          throw new Error('Recalculation: некорректный или повторный Dataset.');
        }
        seen.add(step.datasetId);
      }
      const mode = runtime.mode();
      if (!['sqlite', 'legacy'].includes(mode)) {
        throw new Error('Recalculation: неподдерживаемый источник Runtime.');
      }
      const asOfDate = request.asOfDate || new Date().toISOString();
      const asOfTimestamp = new Date(asOfDate);
      if (Number.isNaN(asOfTimestamp.getTime())) {
        throw new Error('Recalculation: некорректная дата расчёта.');
      }
      const sampleLimit = request.sampleLimit === undefined ? 20 : Number(request.sampleLimit);
      if (!Number.isInteger(sampleLimit) || sampleLimit < 0 || sampleLimit > 100) {
        throw new Error('Recalculation: недопустимый лимит примеров.');
      }
      const sources = new Map();
      // External references are read-only inputs, not UPSERT target Datasets.
      // Track their identities to reject a stale preview after a reference changes.
      const watched = new Map();
      const watchIds = new Set([
        ...(Array.isArray(request.watchDatasetIds) ? request.watchDatasetIds : []),
        ...steps.flatMap(step => Array.isArray(step.dependsOn) ? step.dependsOn : [])
      ]);
      for (const id of watchIds) {
        if (typeof id !== 'string' || !catalog.get(id)) {
          throw new Error('Recalculation: некорректная внешняя зависимость.');
        }
        const reference = runtime.get(id);
        if (!reference || !Array.isArray(reference.records)) {
          throw new Error('Recalculation: обязательный Dataset отсутствует: ' + id + '.');
        }
        watched.set(id, reference);
      }
      const draftRows = new Map();
      const draftIndexes = new Map();
      const fieldIndexes = new Map();
      const sourceSchemas = new Map();
      const results = [];

      function source(id) {
        if (!SUPPORTED.includes(id)) {
          throw new Error('Recalculation: доступен только ITSM/МБ: ' + id);
        }
        if (!sources.has(id)) {
          const instance = runtime.get(id);
          if (!instance || !Array.isArray(instance.records)) {
            throw new Error('Recalculation: Dataset не загружен: ' + id + '.');
          }
          sources.set(id, instance);
        }
        return sources.get(id);
      }

      function schema(id) {
        if (!sourceSchemas.has(id)) {
          const definition = catalog.get(id);
          if (definition?.strategy !== 'UPSERT' || !definition.keyField) {
            throw new Error('Recalculation: Dataset не поддерживает накопительный расчёт: ' + id);
          }
          sourceSchemas.set(id, fieldSchema(id, source(id), itsmSchema));
        }
        return sourceSchemas.get(id);
      }

      function rows(id) {
        return draftRows.get(id) || source(id).records;
      }

      function index(id) {
        if (draftIndexes.has(id)) return draftIndexes.get(id);
        const fields = schema(id);
        const table = new Map();
        rows(id).forEach((row, position) => {
          if (!row || typeof row !== 'object' || (id === 'itsm_data' &&
              Array.isArray(row) && row.length !== fields.fields.length) ||
              (id === 'mobile_brigade_data' && Array.isArray(row))) {
            throw new Error('Recalculation: нарушена схема строки ' + id + ' #' + (position + 1) + '.');
          }
          const key = normalizedKey(recordField(row, fields.keyField, fields));
          if (!key || table.has(key)) {
            throw new Error('Recalculation: пустой/повторный ключ в ' + id + ' #' +
              (position + 1) + '.');
          }
          table.set(key, position);
        });
        draftIndexes.set(id, table);
        return table;
      }

      function rawSourceRow(id, rowIndex, key) {
        const full = source(id).fullDataset;
        if (!full || !Array.isArray(full.rows) || !Array.isArray(full.columns)) return null;
        let fullPosition = -1;
        if (Array.isArray(full.recordKeys) && full.recordKeys.length === full.rows.length) {
          // The lookup is built once per Dataset, never once per record.
          const cacheKey = id + ':full';
          if (!draftIndexes.has(cacheKey)) {
            const keyIndex = new Map();
            full.recordKeys.forEach((rawKey, position) => {
              const k = normalizedKey(rawKey);
              if (!k || keyIndex.has(k)) {
                throw new Error('Recalculation: повреждены recordKeys Full Dataset ' + id + '.');
              }
              keyIndex.set(k, position);
            });
            draftIndexes.set(cacheKey, keyIndex);
          }
          fullPosition = draftIndexes.get(cacheKey).get(key) ?? -1;
        } else if (full.rows.length === source(id).records.length &&
            full.coverage !== 'partial') {
          fullPosition = rowIndex;
        }
        const raw = full.rows[fullPosition];
        if (!Array.isArray(raw) || raw.length !== full.columns.length) return null;
        return Object.freeze({
          columns: Object.freeze(Array.from(full.columns)),
          values: Object.freeze(cloneValue(raw))
        });
      }

      // Lazy point lookup avoids materializing copies of all ITSM/MB records
      // when only a small subset participates in an enrichment join.
      const getRecord = (id, keyValue) => {
        const position = index(id).get(normalizedKey(keyValue));
        if (position === undefined) return null;
        return cloneValue(rows(id)[position]);
      };

      function getRowsByField(id, field, value) {
        const shape = schema(id);
        if (!field || (id === 'itsm_data' && !shape.fields.includes(field))) {
          throw new Error('Recalculation: неизвестное поле поиска ' + id + '.' + field + '.');
        }
        const cacheKey = id + ':' + field;
        if (!fieldIndexes.has(cacheKey)) {
          const matches = new Map();
          rows(id).forEach(record => {
            const key = normalizedKey(recordField(record, field, shape));
            if (!key) return;
            if (!matches.has(key)) matches.set(key, []);
            matches.get(key).push(record);
          });
          fieldIndexes.set(cacheKey, matches);
        }
        return Array.from(fieldIndexes.get(cacheKey).get(normalizedKey(value)) || [], cloneValue);
      }

      for (const step of steps) {
        const id = step.datasetId;
        const active = source(id);
        const shape = schema(id);
        const keyIndex = index(id);
        const current = rows(id);
        const nextRows = current.slice();
        const changes = [];
        const samples = [];
        let skippedMissingSource = 0;
        let skippedByRule = 0;
        let unchanged = 0;

        for (let rowIndex = 0; rowIndex < current.length; rowIndex++) {
          // Permit the UI to repaint and handle Cancel on large archives. Tests
          // that run the engine in a sandbox without timers stay deterministic.
          if (rowIndex > 0 && rowIndex % 500 === 0 &&
              typeof setTimeout === 'function') {
            await new Promise(resolve => setTimeout(resolve, 0));
          }
          if (request.signal?.aborted) {
            throw new Error('Recalculation: предварительный расчёт отменён.');
          }
          const original = current[rowIndex];
          const key = normalizedKey(recordField(original, shape.keyField, shape));
          if (typeof request.onProgress === 'function' && rowIndex % 1000 === 0) {
            request.onProgress(Object.freeze({
              datasetId: id, processed: rowIndex, total: current.length,
              changed: changes.length
            }));
          }
          if (keyIndex.get(key) !== rowIndex) {
            throw new Error('Recalculation: неоднозначный ключ Dataset ' + id + '.');
          }
          const raw = rawSourceRow(id, rowIndex, key);
          if (step.requireSourceRow === true && raw === null) {
            skippedMissingSource += 1;
            continue;
          }
          const proposal = await step.calculate(Object.freeze({
            record: cloneValue(original),
            raw,
            key,
            index: rowIndex,
            asOfDate: asOfTimestamp.toISOString(),
            getRecord,
            getRowsByField
          }));

          if (proposal?.skip === true && Object.keys(proposal).every(k =>
              k === 'skip' || k === 'reason')) {
            skippedByRule += 1;
            continue;
          }
          if (proposal == null) {
            skippedByRule += 1;
            continue;
          }
          if (!proposal || Array.isArray(proposal) || typeof proposal !== 'object') {
            throw new Error('Recalculation: обработчик должен вернуть объект изменений.');
          }

          const changesForRow = {};
          for (const [field, value] of Object.entries(proposal)) {
            if (!shape.mutable.has(field)) {
              throw new Error('Recalculation: запрещено изменять исходное или неизвестное поле ' +
                id + '.' + field + '.');
            }
            const before = recordField(original, field, shape);
            if (sameValue(before, value)) continue;
            changesForRow[field] = Object.freeze({
              before: cloneValue(before),
              after: cloneValue(value)
            });
          }
          if (!Object.keys(changesForRow).length) {
            unchanged += 1;
            continue;
          }

          const next = cloneValue(original);
          for (const [field, delta] of Object.entries(changesForRow)) {
            if (Array.isArray(next)) next[shape.fields.indexOf(field)] = cloneValue(delta.after);
            else next[field] = cloneValue(delta.after);
          }
          nextRows[rowIndex] = next;
          const change = Object.freeze({
            key, rowIndex,
            fields: Object.freeze(changesForRow)
          });
          changes.push(change);
          if (samples.length < sampleLimit) samples.push(change);
        }
        if (typeof request.onProgress === 'function') {
          request.onProgress(Object.freeze({
            datasetId: id, processed: current.length, total: current.length,
            changed: changes.length
          }));
        }
        draftRows.set(id, nextRows);
        draftIndexes.delete(id);
        for (const cacheKey of Array.from(fieldIndexes.keys())) {
          if (cacheKey.startsWith(id + ':')) fieldIndexes.delete(cacheKey);
        }
        // The saved Full Dataset is never modified here. Its generated columns
        // are updated by the future materialization/commit layer, not the preview.
        results.push(Object.freeze({
          datasetId: id,
          checked: current.length,
          changed: changes.length,
          unchanged,
          skippedMissingSource,
          skippedByRule,
          fullSourceRows: active.fullDataset?.rows?.length || 0,
          fullSourceCoverage: active.fullDataset?.coverage || 'missing',
          changes: Object.freeze(changes),
          samples: Object.freeze(samples)
        }));
      }

      const plan = Object.freeze({
        kind: 'recalculation-preview',
        mode,
        asOfDate: asOfTimestamp.toISOString(),
        datasets: Object.freeze(results),
        checked: results.reduce((sum, item) => sum + item.checked, 0),
        changed: results.reduce((sum, item) => sum + item.changed, 0),
        skippedMissingSource: results.reduce((sum, item) => sum + item.skippedMissingSource, 0),
        hasChanges: results.some(item => item.changed > 0),
        canCommit: false
      });

      preparedPlans.set(plan, { mode, sources, watched });
      assertCurrent(plan);
      return plan;
    }

    return Object.freeze({ preview, assertCurrent });
  }

  globalThis.ReclassifierRecalculationCore = Object.freeze({
    version: '1.0.0',
    supportedDatasets: SUPPORTED,
    create,
    normalizedKey
  });
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = globalThis.ReclassifierRecalculationCore;
  }
})();
