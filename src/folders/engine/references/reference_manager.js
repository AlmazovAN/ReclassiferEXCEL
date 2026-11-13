// FILE CONTRACT: Reference-specific Dataset adapter.
// Purpose: normalize, validate and describe Reference datasets while delegating generic lifecycle
//          state transitions to DatasetLifecycleManager.
// Owns: Reference-specific normalization/application semantics and consumer metadata.
// Reads: reference_config, reference_normalizers, Dataset Store and DatasetLifecycleManager.
// Writes: Reference Dataset instances only through DatasetLifecycleManager.
// Public API: globalThis.ReclassifierReferenceManager.
// Must not: render Reference screens or duplicate workbook normalization rules.
// Related tests: test_reference_architecture.py, test_reference_baseline_contract.py,
//                test_dataset_adapters.js, test_architecture_guardrails.py.

  const referenceDatasetLifecycle = globalThis.ReclassifierDatasetLifecycleManager;
  if (!referenceDatasetLifecycle) {
    throw new Error('Reference Manager требует Dataset Lifecycle Manager.');
  }

// ============================================================================
// REFERENCE STATUS / CONSUMER METADATA
// ============================================================================
  function getReferenceConsumers(referenceId) {
    return Object.entries(moduleConfig)
      .filter(([, module]) => module.references.includes(referenceId))
      .map(([id, module]) => ({ id, title: module.title, index: module.index }));
  }

  function referenceStatusClass(instance) {
    const status = instance?.validation?.status;
    if (status === 'valid') return 'loaded';
    return status || '';
  }

  function referenceStatusText(instance) {
    const status = instance?.validation?.status;
    if (status === 'invalid') return 'Требует внимания';
    if (!status) return 'Не загружен';
    if (status === 'warning') return 'Готов с предупреждениями';
    return 'Готов';
  }

  function referenceFreshnessLabel(referenceId, instance) {
    const policy = referenceConfig[referenceId]?.freshnessPolicy || 'unknown';
    if (policy === 'none') return 'не применяется';
    if (policy === 'max_date') return instance?.meta?.latestRequestDate || instance?.meta?.latestSourceDate || (instance ? 'не определена' : '—');
    if (policy === 'source_filename') return instance?.meta?.latestSourceDate || (instance ? 'не определена' : '—');
    return instance ? 'не определена' : '—';
  }

// ============================================================================
// FILE CANDIDATE PROCESSING
// ============================================================================
// Reference-specific workbook routing and normalization.
// ============================================================================
  async function processReferenceFile(referenceId, file, sourceFingerprint, hashBytes) {
    const config = referenceConfig[referenceId];
    const startedAt = performance.now();
    if (!config) return null;

    log('Проверка справочника ' + config.title + ': ' + file.name, 'INFO', 'import_export');

    try {
      if (!['drivers', 'customers', 'type_request', 'reclassification', 'initiators', 'exceptions', 'problem_grade', 'it_problem_registry'].includes(referenceId)) {
        const instance = {
          id: referenceId,
          file,
          records: [],
          validation: {
            status: 'invalid',
            errors: ['Для этого справочника схема обработки пока не реализована.'],
            warnings: []
          },
          meta: {
            loadedAt: new Date().toISOString(),
            fileName: file.name,
            fileSize: file.size,
            schemaVersion: config.schemaVersion || '0.0.0',
            latestRequestDate: null,
            sourceType: 'user'
          }
        };
        return instance;
      }

      if (!window.XLSX) throw new Error('Excel parser XLSX не включён в сборку.');
      const bytes = await file.arrayBuffer();
      if (sourceFingerprint && await hashBytes(bytes) !== sourceFingerprint) {
        throw new Error('Справочник изменился во время чтения. Импортируйте файлы и обновите справочники заново.');
      }
      const workbook = window.XLSX.read(bytes, { type: 'array', cellDates: referenceId !== 'it_problem_registry' });
      if (referenceId === 'it_problem_registry') {
        const result = normalizeItProblemRegistry(workbook);
        return {...result, id: referenceId, file, meta: {...result.meta, fileName: file.name,
          sourceHash: sourceFingerprint ?? await hashBytes(bytes), loadedAt: new Date().toISOString(),
          schemaVersion: config.schemaVersion}};
      }
      const normalized = referenceId === 'drivers'
        ? normalizeDriversWorkbook(workbook)
        : referenceId === 'customers'
          ? normalizeCustomersWorkbook(workbook)
          : referenceId === 'type_request'
            ? normalizeTypeRequestWorkbook(workbook)
            : referenceId === 'reclassification'
              ? normalizeReclassificationWorkbook(workbook)
              : referenceId === 'initiators'
                ? normalizeInitiatorsWorkbook(workbook)
                : referenceId === 'exceptions'
                  ? normalizeExceptionsWorkbook(workbook)
                  : normalizeProblemGradeWorkbook(workbook);
      const schemaVersion = referenceId === 'drivers'
        ? DRIVERS_SCHEMA.version
        : referenceId === 'customers'
          ? CUSTOMERS_SCHEMA.version
          : referenceId === 'type_request'
            ? TYPE_REQUEST_SCHEMA.version
            : referenceId === 'reclassification'
              ? RECLASSIFICATION_SCHEMA.version
              : referenceId === 'initiators'
                ? INITIATORS_SCHEMA.version
                : referenceId === 'exceptions'
                  ? EXCEPTIONS_SCHEMA.version
                  : PROBLEM_GRADE_SCHEMA.version;
      const fingerprint = sourceFingerprint ?? await referenceDatasetLifecycle.fingerprintFile(file);

      const instance = {
        id: referenceId,
        file,
        records: normalized.records,
        validation: normalized.validation,
        meta: Object.assign({}, normalized.meta, {
          loadedAt: new Date().toISOString(),
          fileName: file.name,
          fileSize: file.size,
          // File.lastModified is a file-system timestamp, not a claimed export date.
          sourceFileModifiedAt: Number.isFinite(file.lastModified) && file.lastModified > 0
            ? new Date(file.lastModified).toISOString() : null,
          schemaVersion,
          dataVersion: fingerprint ? fingerprint.slice(0, 12) : null,
          dataFingerprint: fingerprint,
          processingMs: Math.round(performance.now() - startedAt),
          sourceType: 'user'
        })
      };

      if (referenceId === 'drivers') {
        log(
          'Drivers: ' + referenceStatusText(instance) +
          '; исходных строк ' + (instance.meta.sourceRows ?? 0) +
          '; рудников/шахт ' + (instance.meta.mineCount ?? 0) +
          '; вертикальных записей ' + (instance.meta.normalizedRows ?? 0)
        , 'INFO', 'import_export');
      } else if (referenceId === 'customers') {
        log(
          'Customers: ' + referenceStatusText(instance) +
          '; исходных строк ' + (instance.meta.sourceRows ?? 0) +
          '; рудников/шахт ' + (instance.meta.mineCount ?? 0) +
          '; заказчиков ' + (instance.meta.customerCount ?? 0)
        , 'INFO', 'import_export');
      } else if (referenceId === 'type_request') {
        log(
          'TypeRequest: ' + referenceStatusText(instance) +
          '; исходных строк ' + (instance.meta.sourceRows ?? 0) +
          '; шаблонов ' + (instance.meta.patternCount ?? 0) +
          '; видов работ ' + (instance.meta.workTypeCount ?? 0)
        , 'INFO', 'import_export');
      } else if (referenceId === 'reclassification') {
        log(
          'Reclassification: ' + referenceStatusText(instance) +
          '; строк ' + (instance.meta.normalizedRows ?? 0) +
          '; свежесть ' + (instance.meta.latestRequestDate || 'не определена')
        , 'INFO', 'import_export');
      } else if (referenceId === 'initiators') {
        log(
          'Initiators: ' + referenceStatusText(instance) +
          '; исходных строк ' + (instance.meta.sourceRows ?? 0) +
          '; нормализованных инициаторов ' + (instance.meta.normalizedRows ?? 0) +
          '; объединено дублей ' + (instance.meta.mergedDuplicateRows ?? 0)
        , 'INFO', 'import_export');
      } else if (referenceId === 'exceptions') {
        log(
          'Exceptions: ' + referenceStatusText(instance) +
          '; исходных строк ' + (instance.meta.sourceRows ?? 0) +
          '; правил ' + (instance.meta.normalizedRows ?? 0) +
          '; объединено дублей ' + (instance.meta.mergedDuplicateRows ?? 0)
        , 'INFO', 'import_export');
      } else {
        log(
          'ProblemGrade: ' + referenceStatusText(instance) +
          '; исходных строк ' + (instance.meta.sourceRows ?? 0) +
          '; нормализованных привязок ' + (instance.meta.normalizedRows ?? 0) +
          '; цепочек классификатора ' + (instance.meta.classifierKeyCount ?? 0)
        , 'INFO', 'import_export');
      }
      return instance;
    } catch (error) {
      const instance = {
        id: referenceId,
        file,
        records: [],
        validation: { status: 'invalid', errors: [error.message || String(error)], warnings: [] },
        meta: {
          loadedAt: new Date().toISOString(),
          fileName: file.name,
          fileSize: file.size,
          schemaVersion: config.schemaVersion || '0.0.0',
          latestRequestDate: null,
          processingMs: Math.round(performance.now() - startedAt),
          sourceType: 'user'
        }
      };
      log('Ошибка справочника ' + config.title + ': ' + instance.validation.errors[0], 'ERROR', 'import_export');
      return instance;
    }
  }

  async function loadReferenceFile(referenceId, file) {
    return referenceDatasetLifecycle.prepare(
      referenceId,
      [file],
      ([source]) => processReferenceFile(referenceId, source)
    );
  }

  function applyReferenceCandidate(referenceId) {
    const instance = referenceDatasetLifecycle.commit(referenceId, { recordHistory: true });
    log('Применён справочник ' + referenceConfig[referenceId].title + ': ' + instance.records.length + ' записей.', 'INFO', 'import_export');
    return instance;
  }



// ============================================================================
// RECLASSIFICATION UPSERT / REFERENCE REPLACEMENT PLANS
// ============================================================================
  function reclassRequestKey(value) {
    return String(value ?? '')
      .replace(/\u00a0/g, ' ')
      .replace(/\s+/g, '')
      .trim()
      .toLocaleLowerCase('ru-RU');
  }

  function prepareReclassificationUpsert(records, meta = {}) {
    if (!Array.isArray(records)) {
      throw new Error('Reclassification UPSERT должен содержать массив записей.');
    }

    const current = datasetStore.records('reclassification');
    const currentByKey = new Map();
    const currentDuplicateKeys = new Set();
    const currentWithoutNumber = [];

    current.forEach((record, index) => {
      const key = reclassRequestKey(record?.number);
      if (!key) {
        currentWithoutNumber.push(index);
        return;
      }
      if (!currentByKey.has(key)) currentByKey.set(key, []);
      currentByKey.get(key).push(index);
      if (currentByKey.get(key).length > 1) currentDuplicateKeys.add(key);
    });

    const incomingByKey = new Map();
    const incomingDuplicateKeys = new Set();
    let incomingWithoutNumber = 0;

    for (const record of records) {
      const key = reclassRequestKey(record?.number);
      if (!key) {
        incomingWithoutNumber += 1;
        continue;
      }
      if (incomingByKey.has(key)) incomingDuplicateKeys.add(key);
      incomingByKey.set(key, Object.assign({}, record));
    }

    if (incomingWithoutNumber) {
      throw new Error(
        'Нельзя выполнить UPSERT RE-CLASS: во входных данных строк без «Номер»: ' +
        incomingWithoutNumber + '.'
      );
    }

    const merged = current.map(record => Object.assign({}, record));
    const matchedKeys = [];
    const addedKeys = [];

    for (const [key, record] of incomingByKey.entries()) {
      const indices = currentByKey.get(key) || [];
      if (indices.length) {
        matchedKeys.push(key);
        for (const index of indices) merged[index] = Object.assign({}, record);
      } else {
        addedKeys.push(key);
        merged.push(Object.assign({}, record));
      }
    }

    const unchangedCurrentRows = current.reduce((count, record) => {
      const key = reclassRequestKey(record?.number);
      return count + (!key || !incomingByKey.has(key) ? 1 : 0);
    }, 0);

    const plan = {
      currentRows: current.length,
      currentUniqueNumbers: currentByKey.size,
      currentDuplicateNumbers: currentDuplicateKeys.size,
      currentRowsWithoutNumber: currentWithoutNumber.length,
      incomingRows: records.length,
      incomingUniqueNumbers: incomingByKey.size,
      incomingDuplicateNumbers: incomingDuplicateKeys.size,
      matchedNumbers: matchedKeys.length,
      addedNumbers: addedKeys.length,
      unchangedCurrentRows,
      finalRows: merged.length
    };

    const instance = prepareReferenceReplacement(
      'reclassification',
      merged,
      Object.assign({}, meta, {
        sourceType: meta.sourceType || 'generated',
        updateMode: 'upsert_by_number',
        upsertPlan: plan
      })
    );

    return { instance, plan };
  }

  function prepareReferenceReplacement(referenceId, records, meta = {}) {
    const config = referenceConfig[referenceId];
    if (!config || config.generatedOnly) {
      throw new Error('Reference «' + referenceId + '» нельзя заменить подготовленным набором записей.');
    }
    if (!Array.isArray(records)) {
      throw new Error('Подготовленный Reference должен содержать массив записей.');
    }

    const normalizedRecords = records.map((record, index) => {
      if (!record || typeof record !== 'object' || Array.isArray(record)) {
        throw new Error('Некорректная запись Reference в строке ' + (index + 1) + '.');
      }
      return Object.assign({}, record);
    });

    const warnings = [];
    let latestRequestDate = null;
    if (referenceId === 'reclassification') {
      const fields = RECLASSIFICATION_SCHEMA.columns.map(([id]) => id);
      for (let index = 0; index < normalizedRecords.length; index += 1) {
        const record = normalizedRecords[index];
        const unknown = Object.keys(record).filter(key => !fields.includes(key));
        if (unknown.length) {
          for (const key of unknown) delete record[key];
        }
        for (const field of fields) {
          if (!(field in record)) record[field] = null;
        }
        if (!record.number) {
          warnings.push('Строка ' + (index + 1) + ' без значения «Номер».');
        }
        if (record.dateCompleted && (!latestRequestDate || record.dateCompleted > latestRequestDate)) {
          latestRequestDate = record.dateCompleted;
        }
      }
    }

    return {
      id: referenceId,
      file: null,
      records: normalizedRecords,
      validation: {
        status: warnings.length ? 'warning' : 'valid',
        errors: [],
        warnings
      },
      meta: Object.assign({}, meta, {
        loadedAt: meta.loadedAt || new Date().toISOString(),
        fileName: meta.fileName || 'Сформировано модулем Reclassification',
        fileSize: meta.fileSize ?? null,
        schemaVersion: config.schemaVersion || '0.0.0',
        normalizedRows: normalizedRecords.length,
        latestRequestDate: meta.latestRequestDate || latestRequestDate,
        sourceType: meta.sourceType || 'generated'
      })
    };
  }

  function applyReferenceReplacement(instance) {
    const referenceId = instance?.id;
    const config = referenceConfig[referenceId];
    if (!config || config.generatedOnly || !['valid', 'warning'].includes(instance?.validation?.status)) {
      throw new Error('Нельзя применить неподготовленный Reference.');
    }
    referenceDatasetLifecycle.activate(referenceId, instance, { recordHistory: true });
    log(
      'Обновлён справочник ' + config.title +
      ': ' + instance.records.length + ' записей' +
      (instance.meta?.latestRequestDate ? '; свежесть ' + instance.meta.latestRequestDate : '') + '.'
    );
    return instance;
  }

// ============================================================================
// PUBLIC MANAGER API
// ============================================================================
  window.ReclassifierReferenceManager = Object.freeze({
    list: () => Object.keys(referenceConfig).map(id => ({
      id,
      title: referenceConfig[id].title,
      schemaVersion: referenceConfig[id].schemaVersion || '0.0.0',
      status: referenceStatusText(datasetStore.get(id)),
      consumers: getReferenceConsumers(id)
    })),
    get: id => {
      const instance = datasetStore.get(id);
      return instance?.validation?.status === 'invalid' ? null : (instance || null);
    },
    records: id => {
      const instance = datasetStore.get(id);
      return instance && instance.validation?.status !== 'invalid' ? instance.records : [];
    },
    consumers: id => getReferenceConsumers(id),
    prepareReclassificationUpsert: (records, meta) => prepareReclassificationUpsert(records, meta),
    prepareReplacement: (id, records, meta) => prepareReferenceReplacement(id, records, meta),
    applyReplacement: instance => applyReferenceReplacement(instance)
  });
