  const failureClassifierDatasetLifecycle = globalThis.ReclassifierDatasetLifecycleManager;
  if (!failureClassifierDatasetLifecycle) {
    throw new Error('Failure Classifier требует Dataset Lifecycle Manager.');
  }

  function failureClassifierStatusText(instance = state.failureClassifier) {
    const status = instance?.validation?.status;
    if (!instance) return 'не загружен';
    if (status === 'invalid') return 'ошибка';
    if (status === 'warning') {
      if (instance?.meta?.sourceType === 'sqlite') return 'из SQLite с предупреждениями';
      return instance?.meta?.sourceType === 'embedded'
        ? 'интегрирован с предупреждениями'
        : 'загружен с предупреждениями';
    }
    if (instance?.meta?.sourceType === 'sqlite') return 'Из SQLite';
    return instance?.meta?.sourceType === 'embedded' ? 'Интегрирован' : 'загружен';
  }

  function failureClassifierStatusClass(instance = state.failureClassifier) {
    const status = instance?.validation?.status;
    if (status === 'valid') return 'loaded';
    return status || '';
  }

  function failureClassifierFreshness(instance = state.failureClassifier) {
    if (!instance) return '—';
    return instance.meta?.latestChangedAt || 'не определена';
  }

  function addFailureClassifierHistory(instance, action) {
    const entry = {
      at: instance?.meta?.loadedAt || new Date().toISOString(),
      fileName: instance?.meta?.fileName || instance?.file?.name || '—',
      fileSize: instance?.meta?.fileSize ?? instance?.file?.size ?? null,
      action,
      validationStatus: instance?.validation?.status || 'unknown',
      formatLabel: instance?.meta?.formatLabel || '—',
      rows: instance?.meta?.normalizedRows ?? 0
    };
    state.failureClassifierHistory.unshift(entry);
    if (state.failureClassifierHistory.length > 20) state.failureClassifierHistory.length = 20;
  }

  async function processFailureClassifierFile(file) {
    const startedAt = performance.now();
    const action = state.failureClassifier ? 'updated' : 'loaded';
    log('Проверка классификатора отказов: ' + file.name);

    try {
      if (!window.XLSX) throw new Error('Excel parser XLSX не включён в сборку.');

      const workbook = window.XLSX.read(await file.arrayBuffer(), {
        type: 'array',
        cellDates: true
      });
      const normalized = normalizeFailureClassifierWorkbook(workbook);
      const fingerprint = await fileFingerprint(file);

      const instance = {
        id: FAILURE_CLASSIFIER_ID,
        file,
        records: normalized.records,
        validation: normalized.validation,
        meta: Object.assign({}, normalized.meta, {
          loadedAt: new Date().toISOString(),
          fileName: file.name,
          fileSize: file.size,
          schemaVersion: FAILURE_CLASSIFIER_SCHEMA_VERSION,
          dataVersion: fingerprint ? fingerprint.slice(0, 12) : null,
          dataFingerprint: fingerprint,
          processingMs: Math.round(performance.now() - startedAt),
          sourceType: 'user'
        })
      };

      log(
        'Классификатор отказов: ' + failureClassifierStatusText(instance) +
        '; формат ' + (instance.meta.formatLabel || 'не определён') +
        '; рабочих записей ' + (instance.meta.normalizedRows ?? 0) +
        '; исключено ' + (instance.meta.filteredRows ?? 0) +
        '; причин ' + (instance.meta.causeCount ?? 0) +
        '; свежесть ' + failureClassifierFreshness(instance) + '.'
      );
      return instance;
    } catch (error) {
      const instance = {
        id: FAILURE_CLASSIFIER_ID,
        file,
        records: [],
        validation: {
          status: 'invalid',
          errors: [error.message || String(error)],
          warnings: []
        },
        meta: {
          loadedAt: new Date().toISOString(),
          fileName: file.name,
          fileSize: file.size,
          schemaVersion: FAILURE_CLASSIFIER_SCHEMA_VERSION,
          format: null,
          formatLabel: 'Не распознан',
          latestChangedAt: null,
          normalizedRows: 0,
          processingMs: Math.round(performance.now() - startedAt),
          sourceType: 'user'
        }
      };

      log('Ошибка классификатора отказов: ' + instance.validation.errors[0], 'ERROR');
      return instance;
    }
  }

  async function loadFailureClassifierFile(file) {
    return failureClassifierDatasetLifecycle.prepare(FAILURE_CLASSIFIER_ID, [file], ([source]) => processFailureClassifierFile(source));
  }

  function applyFailureClassifierCandidate() {
    const action = state.failureClassifier ? 'updated' : 'loaded';
    const instance = failureClassifierDatasetLifecycle.commit(FAILURE_CLASSIFIER_ID);
    addFailureClassifierHistory(instance, action);
    log('Применён классификатор отказов: ' + instance.records.length + ' записей.');
    return instance;
  }

  window.ReclassifierFailureClassifier = Object.freeze({
    get: () => datasetStore.get(FAILURE_CLASSIFIER_ID),
    records: () => datasetStore.records(FAILURE_CLASSIFIER_ID),
    schemaVersion: FAILURE_CLASSIFIER_SCHEMA_VERSION
  });
