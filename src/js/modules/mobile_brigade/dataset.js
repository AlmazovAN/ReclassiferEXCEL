// FILE CONTRACT: Mobile Brigade Dataset adapter.
// Purpose: build and hydrate the mobile_brigade_data Dataset using Mobile Brigade-specific
//          record semantics while delegating lifecycle mutation to DatasetLifecycleManager.
// Owns: Mobile Brigade Dataset validation/meta.
// Reads: Mobile Brigade schema, Dataset Catalog, Dataset Store and Lifecycle Manager.
// Writes: active mobile_brigade_data only through DatasetLifecycleManager.
// Public API: globalThis.ReclassifierMobileBrigadeDataset.
// Must not: own generic Dataset prepare/commit/discard semantics or Reference lifecycle.
// Related tests: test_dataset_adapters.js, test_mobile_brigade_upsert.js,
//                test_reference_architecture.py, test_architecture_guardrails.py.

  const mobileBrigadeDataLifecycle = globalThis.ReclassifierDatasetLifecycleManager;
  const mobileBrigadeDatasetCatalog = globalThis.ReclassifierDatasetCatalog;
  const mobileBrigadeDatasetDefinition = mobileBrigadeDatasetCatalog?.get?.('mobile_brigade_data');
  const mobileBrigadeFullDatasetContract = globalThis.ReclassifierFullDatasetContract;
  const mobileBrigadeDatasetRules = globalThis.ReclassifierMobileBrigadeRules;

  if (!mobileBrigadeDataLifecycle || !mobileBrigadeDatasetDefinition ||
      !mobileBrigadeFullDatasetContract || !mobileBrigadeDatasetRules?.parseLaborHours) {
    throw new Error('Mobile Brigade Dataset требует Dataset Lifecycle Manager, Dataset Catalog и Mobile Brigade Rules.');
  }

  function mobileBrigadeGeneratedVersion(records, latestSourceDate) {
    let hash = 0x811c9dc5;
    const source = JSON.stringify([latestSourceDate || '', records || []]);
    for (let index = 0; index < source.length; index += 1) {
      hash ^= source.charCodeAt(index);
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    return hash.toString(16).padStart(8, '0');
  }

  const MOBILE_BRIGADE_LABOR_STATES = new Set([
    'valid',
    'valid_zero',
    'missing',
    'invalid',
    'legacy_unknown'
  ]);

  function fallbackLaborState(value) {
    const raw = mobileBrigadeDatasetRules.text(value);
    if (!raw) return 'missing';
    const numeric = Number(raw.replace(',', '.'));
    if (!Number.isFinite(numeric) || numeric < 0) return 'invalid';
    if (numeric === 0) return 'legacy_unknown';
    return 'valid';
  }

  function normalizeMobileBrigadeAnalyticsRecord(record) {
    if (!record || typeof record !== 'object' || Array.isArray(record)) {
      throw new Error('Mobile Brigade Data содержит некорректную запись.');
    }
    const normalized = Object.assign({}, record);
    const finalTaskType = mobileBrigadeDatasetRules.text(normalized.finalTaskType);
    normalized.finalTaskType = finalTaskType || null;

    const state = mobileBrigadeDatasetRules.text(normalized.laborState);
    normalized.laborState = MOBILE_BRIGADE_LABOR_STATES.has(state)
      ? state
      : fallbackLaborState(normalized.laborHours);

    if (normalized.laborState === 'missing' || normalized.laborState === 'invalid') {
      if (!Number.isFinite(normalized.laborHours)) normalized.laborHours = null;
    }
    return normalized;
  }

  function enrichMobileBrigadeAnalytics(records, fullDataset) {
    const normalized = records.map(normalizeMobileBrigadeAnalyticsRecord);
    if (!fullDataset || !Array.isArray(fullDataset.columns) || !Array.isArray(fullDataset.rows)) {
      return normalized;
    }

    const finalTypeIndex = fullDataset.columns.indexOf('Итоговый тип задачи')>=0
      ? fullDataset.columns.indexOf('Итоговый тип задачи')
      : fullDataset.columns.indexOf('Итог Новый тип задач');
    const laborRawIndex = fullDataset.columns.indexOf('Фактические трудозатраты');
    if (finalTypeIndex < 0 && laborRawIndex < 0) return normalized;

    return normalized.map((record, rowIndex) => {
      const fullRow = fullDataset.rows[rowIndex];
      if (!Array.isArray(fullRow)) return record;
      const enriched = Object.assign({}, record);

      if (!enriched.finalTaskType && finalTypeIndex >= 0) {
        enriched.finalTaskType = mobileBrigadeDatasetRules.text(fullRow[finalTypeIndex]) || null;
      }

      if (laborRawIndex >= 0 &&
          ['legacy_unknown', 'missing', 'invalid'].includes(enriched.laborState)) {
        const labor = mobileBrigadeDatasetRules.parseLaborHours(fullRow[laborRawIndex]);
        enriched.laborHours = labor.hours;
        enriched.laborState = labor.state;
      }

      return enriched;
    });
  }

  function prepareMobileBrigadeDataset(records, meta = {}) {
    if (!Array.isArray(records)) {
      throw new Error('Mobile Brigade Data должен содержать массив записей.');
    }

    const normalizedRecords = records.map(normalizeMobileBrigadeAnalyticsRecord);
    const requestKeys = new Set();
    const recordKeys = new Set();
    const laborStateCounts = {};
    let rowsWithoutRequest = 0;
    let rowsWithoutRecordKey = 0;
    let duplicateRecordKeys = 0;
    let rowsWithoutFinalTaskType = 0;

    for (const record of normalizedRecords) {
      if (!record || typeof record !== 'object' || Array.isArray(record)) {
        throw new Error('Mobile Brigade Data содержит некорректную запись.');
      }

      const request = String(record.request ?? '').trim();
      if (request) requestKeys.add(request.toLocaleLowerCase('ru-RU'));
      else rowsWithoutRequest += 1;

      const laborState = String(record.laborState || 'missing');
      laborStateCounts[laborState] = (laborStateCounts[laborState] || 0) + 1;
      if (!record.finalTaskType) rowsWithoutFinalTaskType += 1;

      const recordKey = String(record.recordKey ?? '').trim().toLocaleLowerCase('ru-RU');
      if (!recordKey) {
        rowsWithoutRecordKey += 1;
      } else if (recordKeys.has(recordKey)) {
        duplicateRecordKeys += 1;
      } else {
        recordKeys.add(recordKey);
      }
    }

    const errors = [];
    if (rowsWithoutRecordKey) {
      errors.push('Строк без устойчивого recordKey: ' + rowsWithoutRecordKey + '.');
    }
    if (duplicateRecordKeys) {
      errors.push('Дублирующихся recordKey: ' + duplicateRecordKeys + '.');
    }

    const warnings = rowsWithoutRequest
      ? ['Строк без значения «Заявка»: ' + rowsWithoutRequest +
        '. Они сохранены, но не смогут связаться с ITSM по ключу заявки.']
      : [];

    return {
      id: 'mobile_brigade_data',
      file: null,
      records: normalizedRecords,
      validation: {
        status: errors.length ? 'invalid' : (warnings.length ? 'warning' : 'valid'),
        errors,
        warnings
      },
      meta: Object.assign({}, meta, {
        loadedAt: meta.loadedAt || new Date().toISOString(),
        fileName: meta.fileName || 'Сформировано модулем «Мобильные бригады»',
        fileSize: meta.fileSize ?? null,
        schemaVersion: mobileBrigadeDatasetDefinition.schemaVersion,
        dataVersion: meta.dataVersion ||
          mobileBrigadeGeneratedVersion(normalizedRecords, meta.latestSourceDate),
        dataFingerprint: meta.dataFingerprint || null,
        normalizedRows: normalizedRecords.length,
        requestKeyCount: requestKeys.size,
        recordKeyCount: recordKeys.size,
        rowsWithoutRequest,
        rowsWithoutRecordKey,
        duplicateRecordKeys,
        laborStateCounts,
        rowsWithoutFinalTaskType,
        sourceType: meta.sourceType || 'generated'
      })
    };
  }

  globalThis.ReclassifierMobileBrigadeDataset = Object.freeze({
    id: 'mobile_brigade_data',
    schemaVersion: mobileBrigadeDatasetDefinition.schemaVersion,
    prepare: prepareMobileBrigadeDataset,
    normalizeAnalyticsRecord: normalizeMobileBrigadeAnalyticsRecord,
    enrichAnalytics: enrichMobileBrigadeAnalytics,
    get: () => datasetStore.get('mobile_brigade_data'),
    records: () => datasetStore.records('mobile_brigade_data')
  });
