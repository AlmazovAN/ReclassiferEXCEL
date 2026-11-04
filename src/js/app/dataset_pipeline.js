  // Low-level Dataset state machine. Application code mutates it through DatasetLifecycleManager.
  // A rejected candidate never changes the active instance.
  function createDatasetPipeline() {
    const entries = new Map();
    const registry = new Map();

    function register(id, config) {
      if (!id || !config?.kind || !config?.schemaVersion) throw new Error('Неполное описание Dataset.');
      if (registry.has(id)) throw new Error('Dataset уже зарегистрирован: ' + id);
      registry.set(id, Object.freeze({ id, kind: config.kind, schemaVersion: config.schemaVersion,
        allowEmpty: config.allowEmpty === true }));
    }

    function requireRegistered(id) {
      if (!registry.has(id)) throw new Error('Dataset не зарегистрирован: ' + id);
      return registry.get(id);
    }

    function entry(id) {
      requireRegistered(id);
      if (!entries.has(id)) entries.set(id, { active: null, candidate: null, revision: 0 });
      return entries.get(id);
    }

    function get(id) {
      const current = entry(id);
      return { active: current.active, candidate: current.candidate };
    }

    function validateActiveInstance(id, instance) {
      const config = requireRegistered(id);
      if (!instance || instance.id !== id || !['valid', 'warning'].includes(instance.validation?.status) ||
          instance.validation?.errors?.length || !Array.isArray(instance.records) ||
          (instance.meta?.schemaVersion && instance.meta.schemaVersion !== config.schemaVersion) ||
          (!config.allowEmpty && !instance.records.length)) {
        throw new Error('Нельзя применить некорректный набор данных.');
      }
      return config;
    }

    function notifyKpiSourceChange(ids) {
      globalThis.ReclassifierKpiAutoRefresh?.request?.('legacy-dataset-committed',ids);
    }

    function setActive(id, instance) {
      validateActiveInstance(id, instance);
      globalThis.ReclassifierRuntimeDataRepository?.assertLegacyWriteAllowed?.();
      const current = entry(id);
      current.revision += 1;
      current.active = instance;
      current.candidate = null;
      notifyKpiSourceChange([id]);
      return instance;
    }

    // Validate the complete batch before publishing any instance. The mutation
    // phase is synchronous and rollback-protected so snapshot restore is all-or-nothing.
    function setActiveBatch(instances) {
      if (!Array.isArray(instances)) throw new Error('Пакет Dataset должен быть массивом.');
      const seen = new Set();
      const prepared = instances.map(instance => {
        const id = instance?.id;
        if (!id || seen.has(id)) throw new Error('Повторный или некорректный Dataset в пакете: ' + (id || '—'));
        seen.add(id);
        validateActiveInstance(id, instance);
        return { id, instance };
      });

      globalThis.ReclassifierRuntimeDataRepository?.assertLegacyWriteAllowed?.();

      // Resolve mutable entries only after the complete batch passed validation.
      for (const item of prepared) item.current = entry(item.id);
      const previous = prepared.map(item => ({
        current: item.current,
        active: item.current.active,
        candidate: item.current.candidate,
        revision: item.current.revision
      }));
      try {
        for (const item of prepared) {
          item.current.revision += 1;
          item.current.active = item.instance;
          item.current.candidate = null;
        }
      } catch (error) {
        for (const snapshot of previous) {
          snapshot.current.active = snapshot.active;
          snapshot.current.candidate = snapshot.candidate;
          snapshot.current.revision = snapshot.revision;
        }
        throw error;
      }
      notifyKpiSourceChange(prepared.map(item => item.id));
      return prepared.map(item => item.instance);
    }

    async function prepare(id, files, processor) {
      const current = entry(id);
      const revision = ++current.revision;
      current.candidate = null;
      if (!Array.isArray(files) || !files.length) throw new Error('Выберите исходный файл.');
      if (typeof processor !== 'function') throw new Error('Обработчик набора данных не задан.');
      let candidate;
      try {
        candidate = await processor(files);
        if (!candidate || candidate.id !== id || !candidate.validation || !Array.isArray(candidate.records)) {
          throw new Error('Обработчик вернул некорректный набор данных.');
        }
        if (!requireRegistered(id).allowEmpty && !candidate.records.length) {
          candidate.validation = { ...candidate.validation, status: 'invalid',
            errors: [...(candidate.validation.errors || []), 'Для этого набора требуется хотя бы одна запись.'] };
        }
      } catch (error) {
        candidate = {
          id, file: files[0], records: [],
          validation: { status: 'invalid', errors: [error?.message || String(error)], warnings: [] },
          meta: { loadedAt: new Date().toISOString(), fileName: files[0]?.name || '—', sourceType: 'user' }
        };
      }
      // A slower previous operation must not overwrite a newer selection.
      if (revision === current.revision) current.candidate = candidate;
      return candidate;
    }

    function commit(id) {
      const current = entry(id);
      const candidate = current.candidate;
      const config = requireRegistered(id);
      if (!candidate || !['valid', 'warning'].includes(candidate.validation.status) ||
          candidate.validation.errors?.length || (!config.allowEmpty && !candidate.records.length)) {
        throw new Error('Нет проверенного кандидата для применения.');
      }
      return setActive(id, candidate);
    }

    function discard(id) {
      const current = entry(id);
      current.revision += 1;
      current.candidate = null;
    }

    // SQLite remains authoritative: this is only the dormant HTML store copy.
    // Missing SQLite datasets clear stale prior HTML rows as part of the same batch.
    function replaceSqliteMirror(instances) {
      if (!globalThis.ReclassifierRuntimeDataRepository?.isSqliteAuthoritative?.()) {
        throw new Error('Зеркало HTML доступно только при подключённой SQLite.');
      }
      if (!Array.isArray(instances)) throw new Error('Зеркало HTML: некорректный пакет.');
      const byId = new Map();
      for (const instance of instances) {
        if (byId.has(instance.id)) throw new Error('Зеркало HTML: повторный Dataset.');
        validateActiveInstance(instance.id, instance);
        byId.set(instance.id, instance);
      }
      const previous = Array.from(registry.keys(), id => {
        const current = entry(id);
        return {current, active:current.active, candidate:current.candidate, revision:current.revision, id};
      });
      try {
        for (const old of previous) {
          old.current.active = byId.get(old.id) || null;
          old.current.candidate = null;
          old.current.revision += 1;
        }
      } catch (error) {
        for (const old of previous) {
          old.current.active = old.active;
          old.current.candidate = old.candidate;
          old.current.revision = old.revision;
        }
        throw error;
      }
      return instances.length;
    }

    function active(id) { return registry.has(id) ? entry(id).active : null; }
    function list() {
      return Array.from(registry.values(), config => ({ ...config, active: active(config.id) }));
    }

    return Object.freeze({ register, get, active, list, setActive, setActiveBatch, replaceSqliteMirror, prepare, commit, discard });
  }

  function validateFullDatasetPayload(source, options = {}) {
    if (!source || typeof source !== 'object') {
      throw new Error('Full Dataset payload отсутствует.');
    }
    if (options.packageId && source.package !== options.packageId) {
      throw new Error(
        'Full Dataset package не соответствует ожидаемому типу: ' +
        String(source.package || 'не указан') + '.'
      );
    }
    if (options.aggregation && source.aggregation !== options.aggregation) {
      throw new Error(
        'Full Dataset aggregation не соответствует ожидаемому типу: ' +
        String(source.aggregation || 'не указана') + '.'
      );
    }

    const columns = Array.isArray(source.columns) ? source.columns : null;
    const rows = Array.isArray(source.rows) ? source.rows : null;
    if (!columns || !rows) {
      throw new Error('Full Dataset должен содержать columns и rows.');
    }
    if (Number(source.fieldCount ?? columns.length) !== columns.length) {
      throw new Error('Full Dataset fieldCount не совпадает с количеством колонок.');
    }
    for (let index = 0; index < rows.length; index += 1) {
      if (!Array.isArray(rows[index]) || rows[index].length !== columns.length) {
        throw new Error('Некорректная ширина строки Full Dataset: ' + (index + 1) + '.');
      }
    }
    return source;
  }

  function fullDatasetColumnKeys(columns) {
    const counts = new Map();
    return columns.map(value => {
      const label = String(value ?? '');
      const occurrence = (counts.get(label) || 0) + 1;
      counts.set(label, occurrence);
      return label + '\u0000' + occurrence;
    });
  }

  function fullDatasetUnionColumns(currentColumns, incomingColumns) {
    const incoming = Array.from(incomingColumns || []);
    const current = Array.from(currentColumns || []);
    if (!current.length) return incoming;

    const merged = incoming.slice();
    const incomingKeys = new Set(fullDatasetColumnKeys(incoming));
    const currentKeys = fullDatasetColumnKeys(current);
    current.forEach((column, index) => {
      if (!incomingKeys.has(currentKeys[index])) merged.push(column);
    });
    return merged;
  }

  function fullDatasetRemapRow(row, sourceColumns, targetColumns) {
    const sourceKeys = fullDatasetColumnKeys(sourceColumns);
    const targetKeys = fullDatasetColumnKeys(targetColumns);
    const sourceIndex = new Map(sourceKeys.map((key, index) => [key, index]));
    return targetKeys.map(key => {
      const index = sourceIndex.get(key);
      return index === undefined ? null : (row[index] === undefined ? null : row[index]);
    });
  }

  function fullDatasetMergeAligned(currentSource, currentKeys, incomingSource, incomingKeys, options = {}) {
    const incoming = validateFullDatasetPayload(incomingSource, options);
    if (!Array.isArray(incomingKeys) || incomingKeys.length !== incoming.rows.length) {
      throw new Error('Full Dataset: число incomingKeys не совпадает с количеством строк.');
    }

    const normalizeKey = typeof options.normalizeKey === 'function'
      ? options.normalizeKey
      : value => String(value ?? '').trim();
    const normalizedIncoming = incomingKeys.map(normalizeKey);
    if (normalizedIncoming.some(key => !key)) {
      throw new Error('Full Dataset: входная партия содержит пустой ключ.');
    }

    let current = null;
    const canUseCurrent = currentSource && Array.isArray(currentKeys);
    if (canUseCurrent) {
      current = validateFullDatasetPayload(currentSource, options);
      if (currentKeys.length !== current.rows.length) {
        throw new Error(
          'Full Dataset: ключи ранее сохранённых полных строк не совпадают с их количеством.'
        );
      }
      if (current.coverage === 'partial' &&
          (!Array.isArray(current.recordKeys) ||
           current.recordKeys.length !== current.rows.length)) {
        throw new Error(
          'Full Dataset: частичный набор требует recordKeys для сохранения прежних строк.'
        );
      }
    }

    // A pre-Full-Dataset analytic baseline may contain records whose raw
    // columns cannot be recovered. Keep only verified source rows and their
    // stable keys, rather than inventing null-filled raw rows. A future UPSERT
    // must retain these known rows even while overall coverage is partial.
    const expectedRecordCount = Number.isInteger(options.expectedRecordCount)
      ? options.expectedRecordCount
      : null;

    function orderedResult(rows, keys) {
      if (!Array.isArray(options.finalRecordKeys)) return { rows, keys };
      if (expectedRecordCount !== null &&
          options.finalRecordKeys.length !== expectedRecordCount) {
        throw new Error('Full Dataset: число итоговых ключей не совпадает с аналитическими строками.');
      }
      const finalKeys = options.finalRecordKeys.map(normalizeKey);
      if (finalKeys.some(key => !key) || new Set(finalKeys).size !== finalKeys.length) {
        throw new Error('Full Dataset: итоговые аналитические ключи неуникальны.');
      }
      const positions = new Map(finalKeys.map((key, index) => [key, index]));
      if (keys.some(key => !positions.has(key))) {
        throw new Error('Full Dataset: обнаружены исходные строки, отсутствующие в аналитике.');
      }
      const byKey = new Map(keys.map((key, index) => [key, rows[index]]));
      return {
        keys: finalKeys.filter(key => byKey.has(key)),
        rows: finalKeys.filter(key => byKey.has(key)).map(key => byKey.get(key))
      };
    }

    const columns = fullDatasetUnionColumns(current?.columns || [], incoming.columns);
    const targetColumnKeys = fullDatasetColumnKeys(columns);
    const incomingColumnKeys = fullDatasetColumnKeys(incoming.columns);
    const incomingSameSchema = incomingColumnKeys.length === targetColumnKeys.length &&
      incomingColumnKeys.every((key, index) => key === targetColumnKeys[index]);
    const incomingRows = incomingSameSchema
      ? incoming.rows
      : incoming.rows.map(row => fullDatasetRemapRow(row, incoming.columns, columns));
    const incomingByKey = new Map();
    normalizedIncoming.forEach((key, index) => incomingByKey.set(key, incomingRows[index]));

    if (!current) {
      const keys = [];
      const rows = [];
      for (const [key, row] of incomingByKey.entries()) {
        keys.push(key);
        rows.push(row);
      }
      const ordered = orderedResult(rows, keys);
      return Object.assign({}, incoming, {
        fieldCount: columns.length,
        columns,
        rows: ordered.rows,
        recordKeys: ordered.keys,
        sourceRows: ordered.rows.length,
        datasetRowCount: expectedRecordCount ?? (options.currentRecordCount
          ? options.currentRecordCount + keys.length : keys.length),
        coverage: keys.length === (expectedRecordCount ?? (options.currentRecordCount
          ? options.currentRecordCount + keys.length : keys.length))
          ? 'complete' : 'partial'
      });
    }

    if (current.coverage === 'complete' && options.currentRecordCount &&
        current.rows.length !== options.currentRecordCount) {
      throw new Error('Full Dataset: полный набор содержит не все действующие записи.');
    }
    const normalizedCurrent = currentKeys.map(normalizeKey);
    if (normalizedCurrent.some(key => !key) || new Set(normalizedCurrent).size !== normalizedCurrent.length) {
      throw new Error('Full Dataset: текущий набор содержит пустые или повторяющиеся ключи.');
    }

    const currentColumnKeys = fullDatasetColumnKeys(current.columns);
    const currentSameSchema = currentColumnKeys.length === targetColumnKeys.length &&
      currentColumnKeys.every((key, index) => key === targetColumnKeys[index]);
    // Preserve immutability without duplicating every cell when the schema is unchanged:
    // the outer array is copied, untouched row arrays are safely shared and only
    // updated/appended rows are replaced.
    const rows = currentSameSchema
      ? current.rows.slice()
      : current.rows.map(row => fullDatasetRemapRow(row, current.columns, columns));
    const positions = new Map(normalizedCurrent.map((key, index) => [key, index]));
    const keys = normalizedCurrent.slice();

    for (const [key, row] of incomingByKey.entries()) {
      const index = positions.get(key);
      if (index === undefined) {
        positions.set(key, rows.length);
        keys.push(key);
        rows.push(row);
      } else {
        rows[index] = row;
      }
    }

    const ordered = orderedResult(rows, keys);
    return Object.assign({}, current, incoming, {
      fieldCount: columns.length,
      columns,
      rows: ordered.rows,
      recordKeys: ordered.keys,
      sourceRows: ordered.rows.length,
      earliestSourceDate: [current.earliestSourceDate, incoming.earliestSourceDate]
        .filter(Boolean).sort().at(0) || null,
      latestSourceDate: [current.latestSourceDate, incoming.latestSourceDate]
        .filter(Boolean).sort().at(-1) || null,
      datasetRowCount: expectedRecordCount ?? Math.max(
        rows.length, Number(options.currentRecordCount || 0)
      ),
      coverage: rows.length === (expectedRecordCount ?? Math.max(
        rows.length, Number(options.currentRecordCount || 0)
      )) ? 'complete' : 'partial'
    });
  }

  async function decodeEmbeddedFullDatasetPayload(source, options = {}) {
    if (!source?.base64) return validateFullDatasetPayload(source, options);
    if (source.compression !== 'gzip') {
      throw new Error(
        'Неподдерживаемое сжатие Full Dataset: ' +
        String(source.compression || 'не указано') + '.'
      );
    }
    if (typeof globalThis.DecompressionStream !== 'function') {
      throw new Error('Браузер не поддерживает DecompressionStream для Full Dataset.');
    }

    const binary = atob(source.base64);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
    const json = await new Response(stream).text();
    const payload = JSON.parse(json);
    const hydrated = Object.assign({}, payload, {
      builtAt: source.builtAt || payload.builtAt || null,
      sourceKind: source.sourceKind || payload.sourceKind || 'embedded-full-dataset',
      dataVersion: source.dataVersion || payload.dataVersion || null,
      dataFingerprint: source.dataFingerprint || payload.dataFingerprint || null,
      compressedBytes: source.compressedBytes || bytes.byteLength
    });
    return validateFullDatasetPayload(hydrated, options);
  }

  globalThis.ReclassifierFullDatasetContract = Object.freeze({
    validate: validateFullDatasetPayload,
    decodeEmbedded: decodeEmbeddedFullDatasetPayload,
    mergeAligned: fullDatasetMergeAligned
  });

  const datasetPipeline = createDatasetPipeline();
  const runtimeDatasetCatalog = globalThis.ReclassifierDatasetCatalog;
  if (!runtimeDatasetCatalog?.list) {
    throw new Error('Dataset Catalog не загружен до Dataset Pipeline.');
  }
  for (const definition of runtimeDatasetCatalog.list()) {
    datasetPipeline.register(definition.id, {
      kind: definition.kind,
      schemaVersion: definition.schemaVersion,
      allowEmpty: definition.allowEmpty
    });
  }

  const legacyDatasetStore = Object.freeze({
    get: id => datasetPipeline.active(id),
    records: id => datasetPipeline.active(id)?.records || [],
    list: () => datasetPipeline.list()
  });

  function currentDatasetStore() {
    return globalThis.ReclassifierRuntimeDataRepository || legacyDatasetStore;
  }

  const datasetStore = Object.freeze({
    get: id => currentDatasetStore().get(id),
    records: id => currentDatasetStore().records(id),
    list: () => currentDatasetStore().list()
  });

  // Compatibility views read from the active runtime repository.
  function datasetView(ids, selector = instance => instance) {
    return Object.fromEntries(ids.map(id => [id, datasetStore.get(id)])
      .filter(([, instance]) => instance)
      .map(([id, instance]) => [id, selector(instance)]));
  }
  Object.defineProperties(state, {
    references: { configurable: true, get: () => datasetView(Object.keys(referenceConfig)) },
    referenceMeta: { configurable: true, get: () => datasetView(Object.keys(referenceConfig), instance => instance.meta) },
    failureClassifier: { configurable: true, get: () => datasetStore.get('failure_classifier') },
    equipmentCatalogs: { configurable: true, get: () => datasetView(Object.keys(equipmentConfig)) },
    equipmentCombined: { configurable: true, get: () => datasetStore.get('combined') }
  });
  window.ReclassifierLegacyDatasetStore = legacyDatasetStore;
  window.ReclassifierDatasetStore = datasetStore;

  function renderDatasetCandidate(id, renderValidation, renderPreview) {
    const candidate = datasetPipeline.get(id).candidate;
    if (!candidate) return '';
    const validation = candidate.validation;
    const config = datasetPipeline.list().find(item => item.id === id);
    const sqliteAuthoritative = Boolean(
      globalThis.ReclassifierRuntimeDataRepository?.isSqliteAuthoritative?.()
    );
    const canApply = !sqliteAuthoritative &&
      ['valid', 'warning'].includes(validation.status) &&
      !validation.errors?.length && (config?.allowEmpty || candidate.records.length > 0);
    return '<div class="card flat" style="margin-top:14px"><h3>Кандидат: ' +
      escapeHtml(candidate.meta?.fileName || '—') + '</h3><p>' +
      escapeHtml(candidate.records.length) + ' записей · ' +
      escapeHtml(validation.errors?.length || 0) + ' ошибок · ' +
      escapeHtml(validation.warnings?.length || 0) + ' предупреждений</p>' +
      renderValidation(candidate) +
      (candidate.records.length ? '<details><summary>Просмотр данных</summary>' + renderPreview(candidate) + '</details>' : '') +
      (sqliteAuthoritative
        ? '<div class="notice" style="margin-top:12px">Подключена Reclassifier.db. Применение в legacy Dataset Store отключено; интегрируйте Excel через раздел «Работа с базой данных».</div>'
        : '') +
      (canApply ? '<button class="button" id="applyDatasetCandidateButton">Применить данные</button> ' : '') +
      '<button class="button ghost" id="discardDatasetCandidateButton">Отклонить</button></div>';
  }

  function bindDatasetCandidate(id, onApply, renderDetail) {
    document.getElementById('applyDatasetCandidateButton')?.addEventListener('click', () => {
      onApply();
      renderDetail();
    });
    document.getElementById('discardDatasetCandidateButton')?.addEventListener('click', () => {
      datasetPipeline.discard(id);
      renderDetail();
    });
  }

  // Button selection and drops share one validation and error boundary.
  async function acceptExcelFiles(fileList, processFile, renderDetail = () => {}, multiple = false) {
    const files = Array.from(fileList || []);
    if (!files.length) return; // Cancel keeps the current selection and candidate.
    try {
      if (!multiple && files.length !== 1) throw new Error('Выберите один Excel-файл.');
      if (files.some(file => !/\.(xlsx|xlsm|xls)$/i.test(file.name))) {
        throw new Error('Поддерживаются только Excel-файлы .xlsx, .xlsm и .xls.');
      }
      await processFile(multiple ? files : files[0]);
      renderDetail();
    } catch (error) {
      const message = error?.message || String(error);
      log('Выбор файла: ' + message, 'ERROR');
      alert(message);
    }
  }

  function selectExcelFiles(processFile, renderDetail = () => {}, multiple = false) {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.xlsx,.xlsm,.xls';
    input.multiple = multiple;
    input.hidden = true;
    document.body.appendChild(input);
    input.addEventListener('cancel', () => input.remove(), { once: true });
    input.addEventListener('change', () => {
      const files = Array.from(input.files || []);
      input.value = '';
      input.remove();
      void acceptExcelFiles(files, processFile, renderDetail, multiple);
    }, { once: true });
    input.click();
  }

  function bindDatasetDropzone(dropzoneId, buttonId, processFile, renderDetail = () => {}, multiple = false) {
    const dropzone = document.getElementById(dropzoneId);
    const button = document.getElementById(buttonId);
    if (!dropzone || !button) return;
    button.addEventListener('click', () => selectExcelFiles(processFile, renderDetail, multiple));
    ['dragenter', 'dragover'].forEach(type => dropzone.addEventListener(type, event => {
      event.preventDefault();
      dropzone.classList.add('dragover');
    }));
    ['dragleave', 'drop'].forEach(type => dropzone.addEventListener(type, event => {
      event.preventDefault();
      dropzone.classList.remove('dragover');
    }));
    dropzone.addEventListener('drop', event => {
      void acceptExcelFiles(event.dataTransfer?.files, processFile, renderDetail, multiple);
    });
  }
