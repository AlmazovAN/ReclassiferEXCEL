// FILE CONTRACT: ITSM module adapter and presentation layer.
// Purpose: connect ITSM UI actions to Worker processing and Dataset lifecycle operations.
// Owns: ITSM file-operation guards, module markup and ITSM Dataset candidate lifecycle.
// Reads: ITSM Rules/Schema, Runtime Repository, references and Worker API.
// Writes: UI plus approved DatasetLifecycleManager operations; XLSX generation stays in Worker.
// Public API: renderItsmModule registered through registerModule('itsm', ...).
// Must not: parse/write workbooks directly or duplicate classification rules.
// Related tests: test_itsm_architecture.py, test_itsm_worker_processor.js,
//                test_itsm_golden.js, test_architecture_guardrails.py.

  const itsmRules = globalThis.ReclassifierItsmRules;
  if (!itsmRules) throw new Error('ITSM rules module is not loaded.');

  const ITSM_RULES_VERSION = itsmRules.version;
  const kpiSourceSchema = globalThis.ReclassifierKpiSource;
  if (!kpiSourceSchema) throw new Error('ITSM требует KPI Source core.');
  const itsmDatasetLifecycle = globalThis.ReclassifierDatasetLifecycleManager;
  if (!itsmDatasetLifecycle) throw new Error('ITSM требует Dataset Lifecycle Manager.');
  const itsmFullDatasetContract = globalThis.ReclassifierFullDatasetContract;
  if (!itsmFullDatasetContract) throw new Error('ITSM требует Full Dataset Contract.');
  const itsmFieldRegistry = globalThis.ReclassifierFieldRegistry;
  if (!itsmFieldRegistry) throw new Error('ITSM требует Field Registry.');
  const itsmAnalytics = itsmFieldRegistry.createAccessor(itsmDatasetSchema.id, itsmDatasetSchema.fields);

// ============================================================================
// RUNTIME DEPENDENCY PAYLOAD
// ============================================================================
  function itsmReferencePayload() {
    const required = moduleConfig.itsm.references;
    const missing = required.filter(id => !datasetStore.get(id));
    const invalid = required.filter(id => datasetStore.get(id)?.validation?.status === 'invalid');

    if (missing.length) {
      throw new Error('Не загружены справочники: ' + missing.map(id => referenceConfig[id]?.title || id).join(', ') + '.');
    }
    if (invalid.length) {
      throw new Error('Есть справочники с ошибкой валидации: ' + invalid.map(id => referenceConfig[id]?.title || id).join(', ') + '.');
    }

    const mobileBrigade = datasetStore.get('mobile_brigade_data');
    return {
      reclassification: datasetStore.records('reclassification'),
      drivers: datasetStore.records('drivers'),
      customers: datasetStore.records('customers'),
      type_request: datasetStore.records('type_request'),
      initiators: datasetStore.records('initiators'),
      exceptions: datasetStore.records('exceptions'),
      problem_grade: datasetStore.records('problem_grade'),
      mobile_brigade_data: mobileBrigade
        ? datasetStore.records('mobile_brigade_data')
        : null,
      mobile_brigade_meta: mobileBrigade
        ? { latestSourceDate: mobileBrigade.meta?.latestSourceDate || null }
        : null
    };
  }

  function itsmPrerequisiteBlockReason() {
    const required = moduleConfig.itsm.references;
    const missing = required.filter(id => !datasetStore.get(id));
    const invalid = required.filter(id => datasetStore.get(id)?.validation?.status === 'invalid');
    const messages = [];
    if (missing.length) {
      messages.push('Не загружены: ' + missing.map(id => referenceConfig[id]?.title || id).join(', '));
    }
    if (invalid.length) {
      messages.push('Ошибки проверки: ' + invalid.map(id => referenceConfig[id]?.title || id).join(', '));
    }
    return messages.length
      ? messages.join('. ') + '. Откройте «Справочники», исправьте наборы и вернитесь к обработке.'
      : '';
  }

  function downloadItsmResult(bytes, outputName) {
    const blob = new Blob([bytes], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = outputName;
    anchor.style.display = 'none';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

// ============================================================================
// EMBEDDED / ACTIVE ITSM DATASET LIFECYCLE
// ============================================================================
  function itsmDatasetMatchesSchema(source) {
    const labelsMatch = Array.isArray(source?.columns) &&
      source.columns.length === itsmDatasetSchema.labels.length &&
      (
        source.columns.every((label, index) => label === itsmDatasetSchema.labels[index]) ||
        source.columns.every((label, index) => label === itsmDatasetSchema.sourceLabels[index])
      );
    if (!source || source.schemaVersion !== itsmDatasetSchema.version ||
        !Array.isArray(source.fields) || !Array.isArray(source.columns) ||
        source.fields.length !== itsmDatasetSchema.fields.length ||
        source.fields.some((field, index) => field !== itsmDatasetSchema.fields[index]) ||
        !labelsMatch ||
        !Array.isArray(source.rows || source.records)) {
      return false;
    }
    const rows = source.rows || source.records;
    return rows.every(row => Array.isArray(row) && row.length === itsmDatasetSchema.fields.length);
  }

  function createItsmDatasetInstance(source, meta = {}) {
    if (!itsmDatasetMatchesSchema(source)) {
      throw new Error('ITSM Dataset не соответствует схеме ' + itsmDatasetSchema.version + '.');
    }
    const records = source.rows || source.records;
    if (!itsmDatasetSchema.allowEmpty && !records.length) {
      throw new Error('ITSM Dataset не содержит строк.');
    }
    return {
      id: itsmDatasetSchema.id,
      file: null,
      records,
      validation: { status: 'valid', errors: [], warnings: [] },
      meta: Object.assign({
        loadedAt: new Date().toISOString(),
        fileName: source.sourceFileName || 'ITSM Dataset',
        fileSize: source.compressedBytes || null,
        schemaVersion: itsmDatasetSchema.version,
        dataVersion: source.dataVersion || null,
        dataFingerprint: source.dataFingerprint || null,
        sourceFileSha256: source.sourceFileSha256 || null,
        fields: Array.from(itsmDatasetSchema.fields),
        columns: Array.from(itsmDatasetSchema.labels),
        fieldCount: itsmDatasetSchema.fields.length,
        normalizedRows: records.length,
        sourceRows: source.sourceRows ?? records.length,
        earliestSourceDate: source.earliestSourceDate || null,
        latestSourceDate: source.latestSourceDate || null,
        sourceType: 'generated'
      }, meta)
    };
  }

  function createKpiSourceDatasetInstance(source, meta = {}) {
    const fieldsMatch = Array.isArray(source?.fields) &&
      source.fields.length === kpiSourceSchema.fields.length &&
      source.fields.every((field, index) => field === kpiSourceSchema.fields[index]);
    const columnsMatch = Array.isArray(source?.columns) &&
      source.columns.length === kpiSourceSchema.labels.length &&
      source.columns.every((label, index) => label === kpiSourceSchema.labels[index]);
    if (!source || source.schemaVersion !== kpiSourceSchema.schemaVersion ||
        !fieldsMatch || !columnsMatch || !Array.isArray(source.records) ||
        source.records.some(row => !Array.isArray(row) || row.length !== kpiSourceSchema.fields.length)) {
      throw new Error('KPI Source не соответствует схеме ' + kpiSourceSchema.schemaVersion + '.');
    }
    return {
      id: kpiSourceSchema.id,
      file: null,
      records: source.records,
      validation: { status: 'valid', errors: [], warnings: [] },
      meta: Object.assign({
        loadedAt: new Date().toISOString(),
        fileName: 'KPI Source' + (source.latestPeriod ? ' ' + source.latestPeriod.slice(0, 7) : ''),
        schemaVersion: kpiSourceSchema.schemaVersion,
        fields: Array.from(kpiSourceSchema.fields),
        columns: Array.from(kpiSourceSchema.labels),
        fieldCount: kpiSourceSchema.fields.length,
        normalizedRows: source.records.length,
        sourceRows: source.sourceRows ?? null,
        earliestSourceDate: source.earliestPeriod || null,
        latestSourceDate: source.latestPeriod || null,
        sourceType: 'generated',
        dataVersion: (source.latestPeriod || 'undated') + '-' + source.records.length
      }, meta)
    };
  }

  function itsmRequestKey(value) {
    return String(value ?? '')
      .replace(/\u00a0/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .toLocaleLowerCase('ru-RU');
  }

  function prepareItsmDatasetUpsert(incomingInstance) {
    const current = datasetStore.get(itsmDatasetSchema.id);
    if (!current) return incomingInstance;

    const numberIndex = itsmDatasetSchema.fields.indexOf('number');
    if (numberIndex < 0) throw new Error('ITSM Dataset schema does not contain «Номер».');

    const currentByKey = new Map();
    let currentRowsWithoutNumber = 0;
    let currentDuplicateNumbers = 0;
    current.records.forEach((row, index) => {
      const keyValue = itsmRequestKey(row?.[numberIndex]);
      if (!keyValue) {
        currentRowsWithoutNumber += 1;
        return;
      }
      if (currentByKey.has(keyValue)) currentDuplicateNumbers += 1;
      else currentByKey.set(keyValue, index);
    });
    if (currentRowsWithoutNumber || currentDuplicateNumbers) {
      throw new Error(
        'Нельзя выполнить накопительный UPSERT ITSM Sirius Data: текущий Dataset содержит ' +
        currentRowsWithoutNumber + ' строк без «Номер» и ' + currentDuplicateNumbers +
        ' повторов номера. Требуется корректный baseline.'
      );
    }

    const incomingByKey = new Map();
    let incomingRowsWithoutNumber = 0;
    let incomingDuplicateNumbers = 0;
    for (const row of incomingInstance.records) {
      const keyValue = itsmRequestKey(row?.[numberIndex]);
      if (!keyValue) {
        incomingRowsWithoutNumber += 1;
        continue;
      }
      if (incomingByKey.has(keyValue)) incomingDuplicateNumbers += 1;
      incomingByKey.set(keyValue, Array.from(row));
    }
    if (incomingRowsWithoutNumber) {
      throw new Error(
        'Нельзя выполнить накопительный UPSERT ITSM Sirius Data: во входной выгрузке строк без «Номер»: ' +
        incomingRowsWithoutNumber + '.'
      );
    }

    const merged = current.records.map(row => Array.from(row));
    let matchedNumbers = 0;
    let addedNumbers = 0;
    for (const [keyValue, row] of incomingByKey.entries()) {
      const currentIndex = currentByKey.get(keyValue);
      if (currentIndex === undefined) {
        merged.push(row);
        addedNumbers += 1;
      } else {
        merged[currentIndex] = row;
        matchedNumbers += 1;
      }
    }

    const warnings = [];
    if (incomingDuplicateNumbers) {
      warnings.push(
        'Во входной ITSM-выгрузке повторов номера: ' + incomingDuplicateNumbers +
        '. Для каждого номера сохранена последняя строка входной партии.'
      );
    }

    const currentEarliest = current.meta?.earliestSourceDate || null;
    const incomingEarliest = incomingInstance.meta?.earliestSourceDate || null;
    const currentLatest = current.meta?.latestSourceDate || null;
    const incomingLatest = incomingInstance.meta?.latestSourceDate || null;
    const earliestSourceDate = [currentEarliest, incomingEarliest].filter(Boolean).sort().at(0) || null;
    const latestSourceDate = [currentLatest, incomingLatest].filter(Boolean).sort().at(-1) || null;

    incomingInstance.records = merged;
    incomingInstance.validation = {
      status: warnings.length ? 'warning' : 'valid',
      errors: [],
      warnings
    };
    incomingInstance.meta = Object.assign({}, incomingInstance.meta, {
      normalizedRows: merged.length,
      sourceRows: merged.length,
      earliestSourceDate,
      latestSourceDate,
      updateMode: 'upsert_by_number',
      upsertPlan: {
        currentRows: current.records.length,
        incomingRows: incomingInstance.meta?.incomingRows ?? incomingByKey.size,
        incomingUniqueNumbers: incomingByKey.size,
        incomingDuplicateNumbers,
        matchedNumbers,
        addedNumbers,
        untouchedCurrentRows: current.records.length - matchedNumbers,
        finalRows: merged.length
      }
    });
    return incomingInstance;
  }

  function kpiSourceFromItsmInstance(instance, meta = {}) {
    const aggregate = kpiSourceSchema.aggregateItsmDataset(
      instance?.meta?.fields || itsmDatasetSchema.fields,
      instance?.records || [],
      instance?.fullDataset || null
    );
    const payload = kpiSourceSchema.datasetPayload(
      aggregate,
      instance?.records?.length || 0
    );
    return createKpiSourceDatasetInstance(payload, Object.assign({
      sourceFileName: instance?.meta?.sourceFileName || instance?.meta?.fileName || 'ITSM Dataset',
      sourceKind: 'derived-from-itsm-dataset'
    }, meta));
  }

// ============================================================================
// USER-INITIATED PROCESSING AND CONCURRENCY GUARDS
// ============================================================================
  function assertItsmOperationCurrent(sourceFile, operationId) {
    if (operationId && state.processingOperationId !== operationId) {
      throw new Error('Операция ITSM уже неактуальна. Результат не применён.');
    }
    if (state.sourceFile !== sourceFile) {
      throw new Error('Исходный ITSM-файл изменён во время обработки. Результат не применён.');
    }
  }

  async function processItsmFile(operation = {}) {
    const sourceFile = operation.sourceFile || state.sourceFile;
    const operationId = operation.operationId || null;
    if (!state.baselineReady) throw new Error('Дождитесь завершения загрузки стартовых данных.');
    if (!sourceFile) return;
    const candidate = await itsmDatasetLifecycle.prepare(itsmDatasetSchema.id, [sourceFile], async ([file]) => {
      const references = itsmReferencePayload();
      const inputBuffer = await file.arrayBuffer();
      const asOfDate = new Date();
      asOfDate.setHours(0, 0, 0, 0);

      const result = await workerRequest('PROCESS_ITSM', {
        fileName: file.name,
        bytes: inputBuffer,
        references,
        asOfDate: asOfDate.toISOString()
      }, [inputBuffer], operation.onProgress);

      assertItsmOperationCurrent(sourceFile, operationId);

      if (!(result?.bytes instanceof ArrayBuffer)) {
        throw new Error('ITSM Worker не вернул готовый XLSX.');
      }
      if (!result.itsmData || !Array.isArray(result.itsmData.records)) {
        throw new Error('ITSM Worker не вернул внутренний ITSM Dataset.');
      }
      if (!result.kpiSource || !Array.isArray(result.kpiSource.records)) {
        throw new Error('ITSM Worker не вернул KPI Source.');
      }
      const fullDataset = itsmFullDatasetContract.validate(result.itsmFullDataset, {
        packageId: 'itsm-full-dataset',
        aggregation: 'per-source-row'
      });
      if (fullDataset.rows.length !== result.itsmData.records.length) {
        throw new Error('ITSM Full Dataset не совпадает по числу строк с аналитическим Dataset.');
      }

      // Validate the Worker KPI package for the downloadable XLSX, but the
      // persisted runtime KPI Source must be rebuilt after the cumulative ITSM UPSERT.
      createKpiSourceDatasetInstance(result.kpiSource, {
        sourceFileName: file.name
      });

      const instance = createItsmDatasetInstance(result.itsmData, {
        loadedAt: new Date().toISOString(),
        fileName: 'ITSM Sirius Data' + (result.itsmData.latestSourceDate ? ' ' + result.itsmData.latestSourceDate : ''),
        sourceFileName: file.name,
        sourceType: 'generated',
        incomingRows: result.itsmData.records.length,
        lastImportedRulesVersion: result.rulesVersion || null,
        dataVersion: (result.itsmData.latestSourceDate || 'undated') + '-' + result.itsmData.records.length
      });

      const current = datasetStore.get(itsmDatasetSchema.id);
      const numberIndex = itsmDatasetSchema.fields.indexOf('number');
      if (numberIndex < 0) throw new Error('ITSM Dataset schema does not contain «Номер».');
      const currentFull = current?.fullDataset || null;
      const currentFullKeys = Array.isArray(currentFull?.recordKeys)
        ? currentFull.recordKeys
        : (currentFull?.rows?.length === current?.records?.length
          ? current.records.map(row => itsmRequestKey(row?.[numberIndex]))
          : null);
      const currentFullAvailable = Boolean(
        currentFull && currentFullKeys &&
        currentFullKeys.length === currentFull.rows?.length &&
        current.meta?.fullDatasetScope !== 'incoming-batch'
      );
      const incomingFullKeys = instance.records.map(row =>
        itsmRequestKey(row?.[numberIndex]));
      // The analytical UPSERT determines the authoritative total row count.
      // Preserve incoming-only source rows until that cumulative count is known.
      prepareItsmDatasetUpsert(instance);
      const mergedFullDataset = itsmFullDatasetContract.mergeAligned(
        currentFullAvailable ? currentFull : null,
        currentFullAvailable ? currentFullKeys : [],
        fullDataset,
        incomingFullKeys,
        {
          packageId: 'itsm-full-dataset',
          aggregation: 'per-source-row',
          normalizeKey: itsmRequestKey,
          currentRecordCount: current?.records?.length || 0,
          expectedRecordCount: instance.records.length,
          finalRecordKeys: instance.records.map(row => itsmRequestKey(row?.[numberIndex]))
        }
      );

      instance.fullDataset = mergedFullDataset;
      instance.meta.fullDatasetFieldCount = mergedFullDataset.columns.length;
      instance.meta.fullDatasetRows = mergedFullDataset.rows.length;
      instance.meta.fullDatasetScope = mergedFullDataset.coverage || 'complete';
      if (instance.meta.fullDatasetScope === 'complete' &&
          mergedFullDataset.rows.length !== instance.records.length) {
        throw new Error('ITSM Full Dataset после UPSERT не совпадает с накопительным Dataset.');
      }
      const kpiSourceInstance = kpiSourceFromItsmInstance(instance, {
        loadedAt: new Date().toISOString(),
        sourceFileName: file.name,
        sourceType: 'generated',
        sourceKind: 'post-upsert-itsm'
      });
      instance.output = { bytes: result.bytes, outputName: result.outputName, stats: result.stats };
      instance.kpiSourceInstance = kpiSourceInstance;
      return instance;
    });

    if (candidate.validation?.status === 'invalid') {
      throw new Error(candidate.validation.errors?.[0] || 'Ошибка формирования ITSM Dataset.');
    }
    if (itsmDatasetLifecycle.candidate(itsmDatasetSchema.id) !== candidate) {
      throw new Error('Исходный ITSM-файл изменён во время обработки. Обработайте его ещё раз.');
    }
    assertItsmOperationCurrent(sourceFile, operationId);

    downloadItsmResult(candidate.output.bytes, candidate.output.outputName);

    const stats = candidate.output.stats || {};
    log(
      'ITSM обработан в WebWorker: ' + (stats.rows || 0) + ' строк; реклассифицировано ' + (stats.reclassified || 0) +
      '; без Drivers ' + (stats.missingDrivers || 0) + '; без Initiators ' + (stats.missingInitiators || 0) +
      '; без Customers ' + (stats.missingCustomers || 0) + '; без TypeRequest ' + (stats.missingTypeRequests || 0) +
      '; связано с PRB ' + (stats.problemLinks || 0) +
      '; кандидат ITSM Dataset ' + candidate.records.length + ' строк. Файл: ' + candidate.output.outputName
    , 'INFO', 'import_export');

    renderItsmModule();
    return { ...candidate.output, candidate };
  }

  function applyItsmDatasetCandidate() {
    const candidate = itsmDatasetLifecycle.candidate(itsmDatasetSchema.id);
    if (!candidate?.kpiSourceInstance) {
      throw new Error('Кандидат ITSM не содержит согласованный KPI Source.');
    }
    const kpiSourceInstance = candidate.kpiSourceInstance;
    // ITSM and its derived KPI Source are ONE logical update.
    // Validate both and publish them atomically; a failure on the second
    // Dataset must leave both previous active revisions unchanged.
    const [instance] = itsmDatasetLifecycle.activateBatch([
      candidate,kpiSourceInstance
    ]);
    delete instance.output;
    delete instance.kpiSourceInstance;
    log('ITSM Sirius Data применён: ' + instance.records.length + ' строк; свежесть ' +
      (instance.meta.latestSourceDate || 'не определена') + '. KPI Source: ' +
      kpiSourceInstance.records.length + ' агрегированных строк.', 'INFO', 'import_export');
    return instance;
  }

// ============================================================================
// ITSM DATASET / ALGORITHM PRESENTATION
// ============================================================================
  function itsmDatasetPreview(instance) {
    const fields = [
      'createdAt',
      'number',
      'territory',
      'reclassifiedEquipment',
      'reclassifiedFault',
      'problemLink',
      'workType',
      'mb_labor_total_hh'
    ];
    const labels = fields.map(name => itsmAnalytics.label(name));
    const rows = instance.records.slice(0, 5);
    return '<div class="table-wrap"><table><thead><tr>' +
      labels.map(label => '<th>' + escapeHtml(label) + '</th>').join('') +
      '</tr></thead><tbody>' + rows.map(row => '<tr>' +
        fields.map(name => '<td>' + escapeHtml(itsmAnalytics.value(row, name) ?? '—') + '</td>').join('') +
      '</tr>').join('') + '</tbody></table></div>';
  }

  function itsmDatasetValidation(instance) {
    const validation = instance.validation || {};
    return '<div class="small">Схема ' + escapeHtml(instance.meta?.schemaVersion || itsmDatasetSchema.version) +
      ' · ' + escapeHtml(instance.meta?.fieldCount || itsmDatasetSchema.fields.length) + ' полей' +
      (validation.warnings?.length ? ' · предупреждений ' + escapeHtml(validation.warnings.length) : '') + '</div>';
  }

  function itsmDatasetMarkup() {
    return globalThis.ReclassifierModuleSourceStatus.datasetSummary(
      itsmDatasetSchema.id, datasetStore.get(itsmDatasetSchema.id)
    );
  }

  function itsmAlgorithmMarkup() {
    const sqliteMode = globalThis.ReclassifierRuntimeDataRepository?.mode?.() === 'sqlite';
    return '<details class="module-algorithm">' +
      '<summary>Описание алгоритма обработки</summary>' +
      '<div class="module-algorithm-body">' +
      '<h3>Как это работает</h3>' +
      '<p class="small"><strong>Версия правил:</strong> ITSM Rules ' + escapeHtml(ITSM_RULES_VERSION) +
      ' · Обработка выполняется локально в фоновом потоке браузера.</p>' +
      '<p>Приложение обработает ITSM-выгрузку, рассчитает дополнительные поля и скачает Excel. Одновременно будет подготовлено обновление ITSM Dataset.</p>' +
      '<p>Этот модуль готовит накопительный ITSM Dataset для аналитики. Для диагностики классификации и подготовки обновления ReClass используйте отдельный модуль «Реклассификация».</p>' +
      '<p class="small">Данные Мобильных бригад дополняют результат. Без них обработка продолжится, поля обогащения останутся пустыми, а наличие заявки будет отмечено «Нет данных МБ».</p>' +
      '<p><strong>Важно:</strong> обработка Excel не изменяет рабочий Dataset до отдельного нажатия «Применить данные». ' +
      (sqliteMode
        ? 'При подключённой SQLite сохранение выполняется в разделе «Работа с базой данных».'
        : 'В HTML-режиме применённые данные можно сохранить в переносимый HTML.') +
      '</p>' +
      '<ol style="margin:10px 0 0 20px; padding:0">' +
      '<li>Определить тип записи: INC по номеру с префиксом INC, иначе RITM; отменённые пользователем заявки обрабатываются как исключение.</li>' +
      '<li>По номеру заявки найти все строки Mobile Brigade Data: для навесного оборудования взять «Транспорт», для стационарного — «Единица оборудования»; разные идентификаторы объединить без дублей, а «ФактТрудочас, чел-час» суммировать. Если заявка не найдена, сравнить «Дата создания Вызова» со свежестью МБ: покрытая датой заявка получает «нет в МБ», более новая или без сопоставимой даты — «нет данных МБ»; расчётное поле «рез6» (трудозатраты МБ) в обоих случаях равно 0.</li>' +
      '<li>По номеру заявки применить Reclassification: при наличии записи заменить оборудование, элемент, неисправность и причину на итоговую классификацию.</li>' +
      '<li>По итоговому оборудованию получить Drivers: количество по всем рудникам, количество по территории заявки, сервис и систему.</li>' +
      '<li>Подтянуть группу инициатора, внутреннего заказчика и вид работ из Initiators, Customers и TypeRequest.</li>' +
      '<li>Оценить качество классификации: без изменений / исправление / не классифицирован / RITM вместо INC и определить тип после реклассификации.</li>' +
      '<li>По точной цепочке оборудование → элемент → неисправность → причина найти ProblemGrade, связь с PRB и решение о нормализации.</li>' +
      '<li>Рассчитать исключения: отменённые и итоговые RITM исключаются; для Северного применяется отдельный набор правил причин; для остальных территорий — общий Exceptions.</li>' +
      '<li>Рассчитать SLA, предбэклог, уровень backlog, календарные признаки открытия/закрытия и признак выполнения за последние 14 дней.</li>' +
      '<li>Проверить, что диапазон AB:BI свободен либо уже содержит штатные 34 расчётных поля; при конфликте остановить обработку без перезаписи исходных данных.</li>' +
      '<li>Записать 34 расчётных поля в диапазон AB:BI, сформировать новый XLSX и подготовить ITSM Dataset.</li>' +
      '</ol>' +
      '<p class="small">Обработка выполняется в WebWorker, правила контролируются регрессионными тестами.</p>' +
      '</div></details>';
  }

// ============================================================================
// MODULE ROUTE COMPOSITION
// ============================================================================
  function renderItsmModule() {
    const moduleStatus = globalThis.ReclassifierModuleSourceStatus;
    const active = datasetStore.get(itsmDatasetSchema.id);
    renderModuleWorkspace('itsm', {
      sidePanelHtml: ({ refRows }) =>
        (globalThis.ReclassifierDatasetExcelExport?.markup?.(
          itsmDatasetSchema.id, active, !state.baselineReady || Boolean(state.processingModuleId)
        ) || '') +
        '<article class="card flat module-references-card"><h3>Используемые справочники</h3>' +
        '<div class="info-list">' + (refRows || '<div class="small">Справочники не требуются.</div>') +
        '</div><h3 style="margin-top:16px">Дополнительный источник</h3><div class="info-list">' +
        (moduleStatus?.referenceRows(['mobile_brigade_data']) || '') +
        '</div><div class="action-row"><button class="button" id="openReferencesButton">' +
        'Открыть справочники</button></div></article>',
      noticeHtml: () => itsmAlgorithmMarkup() +
        renderDatasetCandidate(itsmDatasetSchema.id, itsmDatasetValidation, itsmDatasetPreview) +
        itsmDatasetMarkup(),
      processBlockReason: itsmPrerequisiteBlockReason,
      rulesLabel: () => 'ITSM ' + ITSM_RULES_VERSION,
      runtimeLabel: 'SheetJS / WebWorker'
    });
    bindDatasetCandidate(itsmDatasetSchema.id, applyItsmDatasetCandidate, renderItsmModule);
    globalThis.ReclassifierDatasetExcelExport?.bind?.(itsmDatasetSchema.id, renderItsmModule);
  }

  window.ReclassifierItsmDataset = Object.freeze({
    schemaVersion: itsmDatasetSchema.version,
    fields: () => Array.from(itsmDatasetSchema.fields),
    labels: () => Array.from(itsmDatasetSchema.labels),
    field: name => itsmAnalytics.field(name),
    index: name => itsmAnalytics.index(name),
    value: (row, name) => itsmAnalytics.value(row, name),
    column: name => itsmAnalytics.column(datasetStore.records(itsmDatasetSchema.id), name),
    get: () => datasetStore.get(itsmDatasetSchema.id),
    records: () => datasetStore.records(itsmDatasetSchema.id)
  });

  registerModule('itsm', itsmModuleConfig, renderItsmModule, processItsmFile);
