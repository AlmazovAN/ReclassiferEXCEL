// FILE CONTRACT: Dataset preparation and transactional integration coordinator.
// Purpose: turn recognised Excel input into repository-ready Dataset candidates and commit them.
// Owns: integration preparation rules, dependency checks, source fingerprints and commit orchestration.
// Reads: Dataset Recognizer results, normalizers/workers, DatabaseContract and current SQLite state.
// Writes: only through ReclassifierDatabaseRepository transactional APIs.
// Public API: globalThis.ReclassifierDatabaseIntegration.
// Must not: render Database Workspace UI or bypass repository transactions.
// Related tests: test_database_integration.js, test_sqlite_wasm_large_upsert.js,
//                test_architecture_guardrails.py.

// ============================================================================
// REPOSITORY / CONTRACT ACCESS
// ============================================================================
  function integrationRepository() {
    const repository = globalThis.ReclassifierDatabaseRepository;
    if (!repository) throw new Error('SQLite Database Core недоступен.');
    return repository;
  }

  function integrationContract() {
    const contract = globalThis.ReclassifierDatabaseContract;
    if (!contract) throw new Error('SQLite Database Contract недоступен.');
    return contract;
  }

// ============================================================================
// GENERIC PREPARATION HELPERS
// ============================================================================
  function integrationClone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function integrationFullDataset(source, packageId, aggregation, rowCount) {
    const contract = globalThis.ReclassifierFullDatasetContract;
    if (!contract?.validate) {
      throw new Error('Full Dataset Contract недоступен.');
    }
    const fullDataset = contract.validate(source, { packageId, aggregation });
    if (fullDataset.rows.length !== rowCount) {
      throw new Error(
        'Full Dataset не совпадает по числу строк с аналитическим Dataset.'
      );
    }
    return fullDataset;
  }

  function integrationMinDate(...values) {
    const items = values.filter(Boolean).sort();
    return items.at(0) || null;
  }

  function integrationMaxDate(...values) {
    const items = values.filter(Boolean).sort();
    return items.at(-1) || null;
  }

  async function integrationFingerprint(file) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (globalThis.crypto?.subtle?.digest) {
      const digest = new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', bytes));
      return Array.from(digest).map(value => value.toString(16).padStart(2, '0')).join('');
    }

    let hash = 0x811c9dc5;
    for (const value of bytes) {
      hash ^= value;
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    return 'fnv1a-' + hash.toString(16).padStart(8, '0');
  }

  function integrationWorkbook(file) {
    return file.arrayBuffer().then(buffer => {
      if (!window.XLSX) throw new Error('Excel parser XLSX не включён в сборку.');
      return window.XLSX.read(buffer, {
        type: 'array',
        cellDates: true,
        cellFormula: true
      });
    });
  }

  function integrationReferenceNormalizer(datasetId) {
    const normalizers = {
      reclassification: typeof normalizeReclassificationWorkbook === 'function' ? normalizeReclassificationWorkbook : null,
      drivers: typeof normalizeDriversWorkbook === 'function' ? normalizeDriversWorkbook : null,
      customers: typeof normalizeCustomersWorkbook === 'function' ? normalizeCustomersWorkbook : null,
      type_request: typeof normalizeTypeRequestWorkbook === 'function' ? normalizeTypeRequestWorkbook : null,
      initiators: typeof normalizeInitiatorsWorkbook === 'function' ? normalizeInitiatorsWorkbook : null,
      exceptions: typeof normalizeExceptionsWorkbook === 'function' ? normalizeExceptionsWorkbook : null,
      problem_grade: typeof normalizeProblemGradeWorkbook === 'function' ? normalizeProblemGradeWorkbook : null
    };
    return normalizers[datasetId] || null;
  }

  function integrationSerializedJoinIndex(joinIndex) {
    if (!(joinIndex instanceof Map)) return [];
    return Array.from(joinIndex.entries()).map(([key, value]) => [key, integrationClone(value)]);
  }


  function integrationAccumulatedFreshness(datasetId, incomingFreshness) {
    // Freshness needs only the Registry row, not the full event Dataset.
    const registry = integrationRepository().getDatasetRegistry(datasetId);
    return {
      from: integrationMinDate(registry.freshness_from, incomingFreshness?.from),
      to: integrationMaxDate(registry.freshness_to, incomingFreshness?.to)
    };
  }

  function integrationItsmCreatedAtRows() {
    const repository = integrationRepository();
    const registry = repository.getDatasetRegistry('itsm_data');
    if (!registry || Number(registry.active_revision || 0) <= 0) return [];

    if (typeof repository.getItsmMobileBrigadeLinkRows !== 'function') {
      throw new Error('SQLite МБ: выборка полей ITSM number/createdAt недоступна.');
    }
    globalThis.ReclassifierDatabaseMemoryDiagnostics?.mark?.('mb-itsm-projection','start');
    // No full ITSM Dataset/Full Dataset is loaded into the JS heap.
    const projected = repository.getItsmMobileBrigadeLinkRows();
    globalThis.ReclassifierDatabaseMemoryDiagnostics?.mark?.('mb-itsm-projection','end',
      {rows:projected.length});
    return projected;
  }


  function integrationItsmRequestKey(value) {
    return String(value ?? '')
      .replace(/\u00a0/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .toLocaleLowerCase('ru-RU');
  }

  function integrationPostUpsertItsm(generated, incomingFullDataset) {
    const schema = globalThis.ReclassifierItsmDatasetSchema;
    const fullContract = globalThis.ReclassifierFullDatasetContract;
    if (!schema?.fields || !fullContract?.mergeAligned) {
      throw new Error('ITSM Dataset/Full Dataset contract недоступен.');
    }

    const fields = Array.from(generated.fields || schema.fields);
    const numberIndex = fields.indexOf('number');
    if (numberIndex < 0) throw new Error('ITSM Dataset schema не содержит поле number.');

    const repository = integrationRepository();
    const registry = repository.getDatasetRegistry('itsm_data');
    const hasCurrent = Number(registry?.active_revision || 0) > 0;
    const current = hasCurrent ? repository.getDataset('itsm_data') : null;
    const currentRecords = Array.from(current?.records || []);
    const incomingRecords = Array.from(generated.records || []);

    const currentFields = Array.from(current?.state?.fields || fields);
    if (currentRecords.length &&
        (currentFields.length !== fields.length ||
         currentFields.some((field, index) => field !== fields[index]))) {
      throw new Error('Текущий ITSM Dataset имеет несовместимую схему полей.');
    }

    const mergedRecords = currentRecords.slice();
    const currentPositions = new Map();
    const currentKeys = [];
    currentRecords.forEach((row, index) => {
      const requestKey = integrationItsmRequestKey(row?.[numberIndex]);
      if (!requestKey || currentPositions.has(requestKey)) {
        throw new Error(
          'Текущий ITSM Dataset содержит пустой или повторный номер заявки.'
        );
      }
      currentPositions.set(requestKey, index);
      currentKeys.push(requestKey);
    });

    const incomingKeys = [];
    const incomingSeen = new Set();
    incomingRecords.forEach((row, index) => {
      const requestKey = integrationItsmRequestKey(row?.[numberIndex]);
      if (!requestKey || incomingSeen.has(requestKey)) {
        throw new Error(
          'Входной ITSM Dataset содержит пустой или повторный номер заявки в строке ' +
          (index + 1) + '.'
        );
      }
      incomingSeen.add(requestKey);
      incomingKeys.push(requestKey);
      const currentIndex = currentPositions.get(requestKey);
      if (currentIndex === undefined) {
        currentPositions.set(requestKey, mergedRecords.length);
        mergedRecords.push(row);
      } else {
        mergedRecords[currentIndex] = row;
      }
    });

    const currentFull = current?.fullDataset || null;
    const currentFullKeys = Array.isArray(currentFull?.recordKeys)
      ? currentFull.recordKeys
      : (currentFull?.rows?.length === currentRecords.length
        ? currentKeys : null);
    if (currentFull && !currentFullKeys) {
      throw new Error('ITSM Full Dataset: невозможно сопоставить исторические полные строки с заявками.');
    }
    const mergedFullDataset = fullContract.mergeAligned(
      currentFull,
      currentFullKeys || [],
      incomingFullDataset,
      incomingKeys,
      {
        packageId: 'itsm-full-dataset',
        aggregation: 'per-source-row',
        normalizeKey: integrationItsmRequestKey,
        currentRecordCount: currentRecords.length,
        expectedRecordCount: mergedRecords.length,
        finalRecordKeys: mergedRecords.map(row =>
          integrationItsmRequestKey(row?.[numberIndex]))
      }
    );

    return {
      fields,
      records: mergedRecords,
      fullDataset: mergedFullDataset
    };
  }

// ============================================================================
// DATABASE-LOCAL DEPENDENCY ENFORCEMENT
// ============================================================================
  function integrationRequireDbDependencies(datasetIds, requestKeys = []) {
    const repository = integrationRepository();
    const missing = [];
    const result = {};

    for (const id of datasetIds) {
      const registry = repository.getDatasetRegistry(id);
      if (!registry || Number(registry.active_revision || 0) <= 0) {
        missing.push(id);
        continue;
      }
      // Enrich only tickets from this ITSM file; scan Mobile Brigade rows in SQLite
      // instead of cloning the full Dataset into the JS heap/Worker.
      const records = id === 'mobile_brigade_data'
        ? repository.getMobileBrigadeRowsForRequests(requestKeys)
        : repository.getDataset(id).records;
      result[id] = { registry, records };
    }
    if (missing.length) {
      const contract = integrationContract();
      throw new Error(
        'Для подготовки ITSM сначала интегрируйте в эту БД: ' +
        missing.map(id => contract.datasets?.[id]?.title || id).join(', ') + '.'
      );
    }
    return result;
  }

// ============================================================================
// DATASET-SPECIFIC PREPARATION ADAPTERS
// ============================================================================
// ============================================================================
// PUBLIC PREVIEW / PREPARE ENTRY POINT
// ============================================================================
  async function integrationPrepareItsm(file, inspection) {
    if (typeof workerRequest !== 'function') {
      throw new Error('WebWorker ITSM недоступен в этой сборке.');
    }

    const configuredReferences = typeof itsmModuleConfig !== 'undefined'
      ? itsmModuleConfig.references
      : null;
    const dependencyIds = Array.from(configuredReferences || [
      'reclassification',
      'drivers',
      'customers',
      'type_request',
      'initiators',
      'exceptions',
      'problem_grade',
      'mobile_brigade_data'
    ]);
    const dependencies = integrationRequireDbDependencies(
      dependencyIds, inspection.details?.requestKeys || []
    );
    const references = {
      reclassification: dependencies.reclassification.records,
      drivers: dependencies.drivers.records,
      customers: dependencies.customers.records,
      type_request: dependencies.type_request.records,
      initiators: dependencies.initiators.records,
      exceptions: dependencies.exceptions.records,
      problem_grade: dependencies.problem_grade.records,
      mobile_brigade_data: dependencies.mobile_brigade_data.records,
      mobile_brigade_meta: {
        latestSourceDate: dependencies.mobile_brigade_data.registry?.freshness_to || null
      }
    };
    const dependencyRevisions = Object.fromEntries(
      dependencyIds.map(id => [id, Number(dependencies[id]?.registry?.active_revision || 0)])
    );
    const nextItsmRevision = Number(
      integrationRepository().getDatasetRegistry('itsm_data')?.active_revision || 0
    ) + 1;

    const inputBuffer = await file.arrayBuffer();
    const asOfDate = new Date();
    asOfDate.setHours(0, 0, 0, 0);
    const result = await workerRequest('PROCESS_ITSM', {
      fileName: file.name,
      bytes: inputBuffer,
      references,
      datasetOnly: true,
      asOfDate: asOfDate.toISOString()
    }, [inputBuffer]);

    const generated = result?.itsmData;
    if (!generated || !Array.isArray(generated.records)) {
      throw new Error('ITSM Worker не вернул внутренний ITSM Dataset.');
    }
    if (generated.schemaVersion !== globalThis.ReclassifierItsmDatasetSchema?.version) {
      throw new Error(
        'ITSM Worker вернул Dataset Schema ' + (generated.schemaVersion || '—') +
        ', ожидается ' + (globalThis.ReclassifierItsmDatasetSchema?.version || '—') + '.'
      );
    }
    const fullDataset = integrationFullDataset(
      result?.itsmFullDataset,
      'itsm-full-dataset',
      'per-source-row',
      generated.records.length
    );

    const workerKpi = result?.kpiSource;
    const kpiDefinition = integrationContract().datasets.kpi_source;
    const kpiApi = globalThis.ReclassifierKpiSource;
    if (!kpiDefinition || kpiDefinition.persisted === false ||
        !workerKpi || !Array.isArray(workerKpi.records) ||
        workerKpi.schemaVersion !== kpiDefinition.schemaVersion ||
        !kpiApi?.aggregateItsmDataset || !kpiApi?.datasetPayload) {
      throw new Error('ITSM Worker не вернул совместимый persisted KPI Source.');
    }

    // KPI Source is a REPLACE companion of cumulative ITSM. Therefore build it
    // from the post-UPSERT view, not from the incoming Excel batch alone.
    const postUpsert = integrationPostUpsertItsm(generated, fullDataset);
    const kpiAggregate = kpiApi.aggregateItsmDataset(
      postUpsert.fields,
      postUpsert.records,
      postUpsert.fullDataset
    );
    const kpiGenerated = kpiApi.datasetPayload(
      kpiAggregate,
      postUpsert.records.length
    );

    const accumulated = integrationAccumulatedFreshness('itsm_data', {
      from: generated.earliestSourceDate || inspection.freshness?.from || null,
      to: generated.latestSourceDate || inspection.freshness?.to || null
    });

    return {
      records: generated.records,
      fullDataset,
      freshness: accumulated,
      state: {
        fields: Array.from(generated.fields || globalThis.ReclassifierItsmDatasetSchema?.fields || []),
        columns: Array.from(generated.columns || globalThis.ReclassifierItsmDatasetSchema?.labels || []),
        schemaVersion: generated.schemaVersion,
        lastImportedRulesVersion: result.rulesVersion || null,
        sourceRows: generated.sourceRows ?? generated.records.length,
        dependencyRevisions
      },
      details: {
        processor: 'PROCESS_ITSM',
        processingAsOfDate: asOfDate.toISOString(),
        rulesVersion: result?.rulesVersion || null,
        stats: integrationClone(result?.stats || {}),
        fullDatasetFieldCount: fullDataset.columns.length,
        fullDatasetRows: fullDataset.rows.length,
        dependencies: dependencyIds
      },
      companions: [{
        id: 'kpi_source',
        records: kpiGenerated.records,
        freshness: {
          from: kpiGenerated.earliestPeriod || null,
          to: kpiGenerated.latestPeriod || null
        },
        state: {
          fields: Array.from(kpiGenerated.fields || []),
          columns: Array.from(kpiGenerated.columns || []),
          schemaVersion: kpiGenerated.schemaVersion,
          sourceRows: kpiGenerated.sourceRows ?? generated.records.length,
          aggregation: kpiGenerated.aggregation || 'monthly-dimensions',
          dependencyRevisions: { itsm_data: nextItsmRevision }
        },
        details: {
          processor: 'PROCESS_ITSM',
          companionOf: 'itsm_data',
          aggregation: kpiGenerated.aggregation || 'monthly-dimensions',
          aggregateRows: kpiGenerated.aggregateRows ?? kpiGenerated.records.length
        }
      }]
    };
  }

  async function integrationPrepareMobileBrigade(file, inspection) {
    if (typeof workerRequest !== 'function') {
      throw new Error('WebWorker Мобильных бригад недоступен в этой сборке.');
    }

    const trace = globalThis.ReclassifierDatabaseMemoryDiagnostics;
    trace?.mark?.('mb-file-read','start',{inputBytes:file.size});
    const bytes = await file.arrayBuffer();
    trace?.mark?.('mb-file-read','end',{inputBytes:bytes.byteLength});
    trace?.mark?.('mb-itsm-links','start');
    const itsmData = integrationItsmCreatedAtRows();
    trace?.mark?.('mb-itsm-links','end',{rows:itsmData.length});
    trace?.mark?.('mb-worker','start',{inputBytes:bytes.byteLength});
    const result = await workerRequest(
      'PROCESS_MOBILE_BRIGADE',
      { files: [{ fileName: file.name, bytes }], itsmData,
        deferExport: true,
        memoryDiagnostics:trace?.isEnabled?.()===true },
      [bytes],
      progress => {
        if (progress?.mbMemoryDiag) {
          trace?.mark?.('mb-worker-'+progress.mbMemoryDiag.stage,
            progress.mbMemoryDiag.event,progress.mbMemoryDiag);
        }
      }
    );
    trace?.mark?.('mb-worker','end',{rows:result?.stats?.rows||0});
    const generated = result?.mobileBrigadeData;
    if (!generated || !Array.isArray(generated.records)) {
      throw new Error('Worker Мобильных бригад не вернул Mobile Brigade Data.');
    }
    trace?.mark?.('mb-full-validation','start',{rows:generated.records.length});
    const fullDataset = integrationFullDataset(
      result?.mobileBrigadeFullDataset,
      'mobile-brigade-full-dataset',
      'per-task-row',
      generated.records.length
    );
    trace?.mark?.('mb-full-validation','end',{rows:fullDataset.rows.length});

    const previousState = integrationRepository().getDatasetState('mobile_brigade_data');
    const incomingScopes = generated.freshnessByScope || {};
    const freshnessByScope = Object.assign({}, previousState.freshnessByScope || {});
    for (const [scope, date] of Object.entries(incomingScopes)) {
      freshnessByScope[scope] = integrationMaxDate(freshnessByScope[scope], date);
    }

    const accumulated = integrationAccumulatedFreshness('mobile_brigade_data', {
      from: generated.earliestSourceDate || inspection.freshness?.from || null,
      to: generated.latestSourceDate || inspection.freshness?.to || null
    });

    return {
      // postMessage already performs structured cloning; do not create another
      // large copy of generated Mobile Brigade records on the main thread.
      records: generated.records,
      fullDataset,
      freshness: accumulated,
      state: Object.assign({}, previousState, {
        schemaVersion: generated.schemaVersion || '1.4.0',
        lastImportedRulesVersion: result.rulesVersion || null,
        itsmLinkContractVersion: globalThis.ReclassifierItsmDatasetSchema?.mobileBrigadeLinkVersion || null,
        freshnessByScope,
        lastSourceFreshness: integrationClone(generated.sourceFreshness || [])
      }),
      details: {
        processor: 'PROCESS_MOBILE_BRIGADE',
        rulesVersion: result?.rulesVersion || null,
        stats: integrationClone(result?.stats || {}),
        fullDatasetFieldCount: fullDataset.columns.length,
        fullDatasetRows: fullDataset.rows.length
      }
    };
  }

  async function integrationPrepareReference(file, inspection) {
    const normalizer = integrationReferenceNormalizer(inspection.datasetId);
    if (!normalizer) throw new Error('Не найден нормализатор Dataset ' + inspection.datasetId + '.');
    const workbook = await integrationWorkbook(file);
    const instance = normalizer(workbook);

    if (instance?.validation?.status === 'invalid') {
      throw new Error((instance.validation.errors || []).join(' ') || 'Reference не прошёл валидацию.');
    }

    return {
      records: integrationClone(instance?.records || []),
      freshness: {
        from: inspection.freshness?.from || null,
        to: inspection.freshness?.to || instance?.meta?.latestRequestDate || null
      },
      state: {
        schemaVersion: integrationContract().datasets[inspection.datasetId]?.schemaVersion || null,
        sourceSheet: instance?.meta?.sourceSheet || inspection.sheetName || null,
        // Preserve provenance, but do not confuse file mtime with export date.
        sourceFileModifiedAt: Number.isFinite(file.lastModified) && file.lastModified > 0
          ? new Date(file.lastModified).toISOString() : null
      },
      details: {
        normalizer: inspection.datasetId,
        warnings: integrationClone(instance?.validation?.warnings || []),
        sourceRows: instance?.meta?.sourceRows ?? null,
        normalizedRows: instance?.meta?.normalizedRows ?? instance?.records?.length ?? 0
      }
    };
  }

  async function integrationPrepareEquipment(file, inspection) {
    if (typeof normalizeEquipmentWorkbook !== 'function') {
      throw new Error('Equipment normalizer недоступен.');
    }
    const workbook = await integrationWorkbook(file);
    const instance = normalizeEquipmentWorkbook(inspection.datasetId, workbook, {
      loadedAt: new Date().toISOString(),
      fileName: file.name,
      fileSize: file.size,
      freshness: inspection.freshness?.to || null,
      schemaVersion: integrationContract().datasets[inspection.datasetId]?.schemaVersion || null,
      processingMs: null,
      sourceType: 'sqlite-integration'
    });

    if (instance?.validation?.status === 'invalid') {
      throw new Error((instance.validation.errors || []).join(' ') || 'Equipment Dataset не прошёл валидацию.');
    }

    return {
      records: integrationClone(instance?.records || []),
      freshness: {
        from: inspection.freshness?.from || null,
        to: inspection.freshness?.to || null
      },
      state: {
        schemaVersion: integrationContract().datasets[inspection.datasetId]?.schemaVersion || null,
        sourceSheet: instance?.meta?.sourceSheet || inspection.sheetName || null,
        joinIndex: integrationSerializedJoinIndex(instance?.joinIndex)
      },
      details: {
        normalizer: 'equipment',
        warnings: integrationClone(instance?.validation?.warnings || []),
        sourceRows: instance?.meta?.sourceRows ?? null,
        normalizedRows: instance?.meta?.normalizedRows ?? instance?.records?.length ?? 0,
        joinIndexEntries: instance?.joinIndex instanceof Map ? instance.joinIndex.size : 0
      }
    };
  }

  async function integrationPrepareFailureClassifier(file, inspection) {
    if (typeof normalizeFailureClassifierWorkbook !== 'function') {
      throw new Error('Валидатор классификатора отказов недоступен.');
    }
    const workbook = await integrationWorkbook(file);
    const instance = normalizeFailureClassifierWorkbook(workbook);
    if (instance?.validation?.status === 'invalid') {
      throw new Error((instance.validation.errors || []).join(' ') || 'Классификатор отказов не прошёл валидацию.');
    }

    return {
      records: integrationClone(instance?.records || []),
      freshness: {
        from: inspection.freshness?.from || null,
        to: instance?.meta?.latestChangedAt || inspection.freshness?.to || null
      },
      state: {
        schemaVersion: integrationContract().datasets.failure_classifier?.schemaVersion || null,
        format: instance?.meta?.format || null,
        sourceSheet: instance?.meta?.sourceSheet || inspection.sheetName || null
      },
      details: {
        normalizer: 'failure_classifier',
        format: instance?.meta?.formatLabel || null,
        warnings: integrationClone(instance?.validation?.warnings || []),
        candidateRows: instance?.meta?.candidateRows || 0,
        filteredRows: instance?.meta?.filteredRows || 0,
        afterFiltersRows: instance?.meta?.afterFiltersRows ?? instance?.records?.length ?? 0,
        duplicatesRemoved: instance?.meta?.duplicatesRemoved || 0,
        normalizedRows: instance?.meta?.normalizedRows ?? instance?.records?.length ?? 0
      }
    };
  }

// ============================================================================
// COMMON PREPARE PIPELINE
// ============================================================================
  async function integrationPrepareRecords(file, inspection) {
    if (inspection.datasetId === 'itsm_data') {
      return integrationPrepareItsm(file, inspection);
    }
    if (inspection.datasetId === 'mobile_brigade_data') {
      return integrationPrepareMobileBrigade(file, inspection);
    }
    if (inspection.datasetId === 'failure_classifier') {
      return integrationPrepareFailureClassifier(file, inspection);
    }

    const definition = integrationContract().datasets[inspection.datasetId];
    if (definition?.kind === 'equipment') {
      return integrationPrepareEquipment(file, inspection);
    }
    return integrationPrepareReference(file, inspection);
  }

  async function integrationPrepare(item) {
    const file = item?.file;
    if (!file) throw new Error('Исходный Excel-файл недоступен.');

    const repository = integrationRepository();
    const databaseInfo = repository.getDatabaseInfo();
    if (!databaseInfo?.valid || databaseInfo.readOnly) {
      throw new Error('Подключённая БД недоступна для записи.');
    }

    // Initial intake has already validated this immutable File. Re-parsing the
    // same 70k+ rows in the main thread doubles peak memory while the previous
    // candidate and runtime caches are still live. Never trust an inspection
    // from a different File object: direct callers retain the full validation.
    const reuseInspection = item.inspectedFile === file &&
      item.inspection?.ready === true &&
      item.inspection?.datasetId &&
      Number(item.size) === Number(file.size) &&
      Number(item.lastModified) === Number(file.lastModified);
    const trace = globalThis.ReclassifierDatabaseMemoryDiagnostics;
    let inspection;
    if (reuseInspection) {
      trace?.mark?.('candidate-inspection-reuse','start',{inputBytes:file.size});
      inspection = item.inspection;
      trace?.mark?.('candidate-inspection-reuse','end',
        {rows:inspection.sourceRows||0,ready:1});
    } else {
      trace?.mark?.('candidate-reinspect','start',{inputBytes:file.size});
      inspection = await globalThis.ReclassifierDatasetRecognizer.inspectFile(file);
      trace?.mark?.('candidate-reinspect','end',
        {rows:inspection.sourceRows||0,ready:inspection.ready?1:0});
    }
    if (!inspection.ready) {
      throw new Error(
        'Dataset не готов к интеграции: ' +
        (inspection.validation?.errors || []).join(' ')
      );
    }
    if (item?.inspection?.datasetId && item.inspection.datasetId !== inspection.datasetId) {
      throw new Error('Повторная проверка Excel дала другой Dataset. Загрузите файл заново.');
    }

    const definition = integrationContract().datasets[inspection.datasetId];
    if (!definition || definition.persisted === false) {
      throw new Error('Dataset нельзя сохранять в SQLite: ' + inspection.datasetId + '.');
    }

    // Avoid concurrent XLSX/worker processing and an extra large file buffer.
    globalThis.ReclassifierDatabaseMemoryDiagnostics?.mark?.('candidate-fingerprint','start',
      {inputBytes:file.size});
    const fingerprint = await integrationFingerprint(file);
    globalThis.ReclassifierDatabaseMemoryDiagnostics?.mark?.('candidate-fingerprint','end');
    globalThis.ReclassifierDiagnosticV2?.checkpoint?.('candidate-records',{
      inputBufferBytes:Number(file.size)||0,rows:Number(inspection?.sourceRows)||0
    },'start');
    globalThis.ReclassifierDatabaseMemoryDiagnostics?.mark?.('candidate-records','start');
    const prepared = await integrationPrepareRecords(file, inspection);
    globalThis.ReclassifierDatabaseMemoryDiagnostics?.mark?.('candidate-records','end',
      {rows:prepared.records?.length||0});
    globalThis.ReclassifierDiagnosticV2?.checkpoint?.('candidate-records',{
      rows:prepared.records?.length||0,fullRows:prepared.fullDataset?.rows?.length||0
    },'end');

    const records = prepared.records || [];
    const options = {
      freshnessFrom: prepared.freshness?.from || null,
      freshnessTo: prepared.freshness?.to || null,
      sourceFileName: file.name,
      sourceFingerprint: fingerprint,
      contentHash: fingerprint,
      state: prepared.state || {},
      fullDataset: prepared.fullDataset || null,
      message: 'Интеграция Excel через Dataset Integration Engine',
      details: Object.assign({}, prepared.details || {}, {
        confidence: inspection.confidence,
        sheetName: inspection.sheetName,
        headerRow: inspection.headerRow,
        validationStatus: inspection.validation?.status || null,
        validationWarnings: integrationClone(inspection.validation?.warnings || [])
      })
    };
    const atomicReplacements = Array.from(prepared.companions || []).map(companion => {
      const companionDefinition = integrationContract().datasets[companion.id];
      if (!companionDefinition || companionDefinition.persisted === false ||
          companionDefinition.strategy !== integrationContract().strategy.REPLACE) {
        throw new Error('Некорректный persisted companion Dataset: ' + companion.id + '.');
      }
      const companionOptions = {
        freshnessFrom: companion.freshness?.from || null,
        freshnessTo: companion.freshness?.to || null,
        sourceFileName: file.name,
        sourceFingerprint: fingerprint,
        contentHash: fingerprint,
        state: companion.state || {},
        message: 'Автоматический KPI Source из той же загрузки ITSM',
        details: Object.assign({}, companion.details || {}, {
          sourceDatasetId: inspection.datasetId
        })
      };
      const registry = repository.getDatasetRegistry(companion.id);
      return {
        id: companion.id,
        definition: companionDefinition,
        records: companion.records || [],
        options: companionOptions,
        expectedRevision: registry.active_revision,
        expectedUpdatedAt: registry.updated_at,
        preview: repository.previewDatasetChange(
          companion.id, companion.records || [], companionOptions
        )
      };
    });

    const registryBeforePreview = repository.getDatasetRegistry(inspection.datasetId);
    globalThis.ReclassifierDatabaseMemoryDiagnostics?.mark?.('candidate-sqlite-preview','start',
      {rows:records.length});
    const repositoryPreview = repository.previewDatasetChange(inspection.datasetId, records, options);
    globalThis.ReclassifierDatabaseMemoryDiagnostics?.mark?.('candidate-sqlite-preview','end',
      {rows:records.length});
    const preview = inspection.datasetId === 'failure_classifier'
      ? Object.assign({}, repositoryPreview, {
          processing: {
            candidateRows: prepared.details?.candidateRows ?? inspection.sourceRows ?? records.length,
            filteredRows: prepared.details?.filteredRows ?? inspection.details?.filteredRows ?? 0,
            afterFiltersRows: prepared.details?.afterFiltersRows ?? inspection.details?.afterFiltersRows ?? records.length,
            duplicatesRemoved: prepared.details?.duplicatesRemoved ?? inspection.details?.duplicatesRemoved ?? 0
          }
        })
      : repositoryPreview;

    return {
      databaseUuid: databaseInfo.databaseUuid,
      databaseFileName: databaseInfo.fileName,
      expectedRevision: registryBeforePreview.active_revision,
      expectedUpdatedAt: registryBeforePreview.updated_at,
      file,
      inspection,
      definition,
      records,
      options,
      preview,
      atomicReplacements
    };
  }

// ============================================================================
// EQUIPMENT ATOMIC BATCH CANDIDATE
// ============================================================================
  function integrationEquipmentJoinIndex(state = {}) {
    if (!Array.isArray(state.joinIndex)) return new Map();
    return new Map(state.joinIndex.map(entry => [
      entry?.[0],
      integrationClone(entry?.[1])
    ]));
  }

  function integrationEquipmentStoredInstance(id, payload) {
    const state = payload?.state || {};
    const registry = payload?.registry || {};
    return {
      id,
      records: integrationClone(payload?.records || []),
      joinIndex: integrationEquipmentJoinIndex(state),
      validation: { status: 'valid', errors: [], warnings: [] },
      meta: {
        fileName: registry.source_file_name || id,
        freshness: registry.freshness_to || state.freshness || null,
        schemaVersion: registry.dataset_schema_version ||
          integrationContract().datasets[id]?.schemaVersion || null,
        sourceType: 'sqlite',
        normalizedRows: Number(registry.record_count ?? payload?.records?.length ?? 0)
      }
    };
  }

  function integrationEquipmentPlanInstance(plan, records) {
    return {
      id: plan.inspection.datasetId,
      records: integrationClone(records),
      joinIndex: integrationEquipmentJoinIndex(plan.options?.state || {}),
      validation: {
        status: plan.inspection.validation?.status === 'warning' ? 'warning' : 'valid',
        errors: [],
        warnings: integrationClone(plan.inspection.validation?.warnings || [])
      },
      meta: {
        fileName: plan.file?.name || plan.options?.sourceFileName || plan.inspection.datasetId,
        freshness: plan.options?.freshnessTo || null,
        schemaVersion: plan.definition.schemaVersion,
        sourceType: 'sqlite-batch-candidate',
        normalizedRows: records.length
      }
    };
  }

  function integrationEquipmentPartitionKey(value) {
    return String(value ?? '')
      .replace(/\u00a0/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .toLocaleLowerCase('ru-RU');
  }

  function integrationBuildEquipmentBatchCandidate(plans) {
    if (typeof buildEquipmentCombinedFromCatalogs !== 'function' ||
        typeof EQUIPMENT_SOURCE_IDS === 'undefined') {
      throw new Error('Equipment Combined processor недоступен.');
    }

    const repository = integrationRepository();
    const catalogs = {};
    for (const id of EQUIPMENT_SOURCE_IDS) {
      const registry = repository.getDatasetRegistry(id);
      if (!registry || Number(registry.active_revision || 0) <= 0) continue;
      catalogs[id] = integrationEquipmentStoredInstance(id, repository.getDataset(id));
    }

    const partitionApi = globalThis.ReclassifierEquipmentPartitions;
    if (!partitionApi?.merge) {
      throw new Error('Сервис секционной замены Equipment недоступен.');
    }
    const groups = new Map();
    for (const plan of plans) {
      const id = plan.inspection.datasetId;
      if (plan.definition.kind !== 'equipment' ||
          plan.definition.strategy !== integrationContract().strategy.REPLACE ||
          !plan.definition.partitionField) {
        throw new Error('Equipment-пакет принимает только секционные Equipment REPLACE Dataset.');
      }
      if (!groups.has(id)) groups.set(id, []);
      groups.get(id).push(plan);
    }
    const stats = {};
    // Mounted / Stationary are resolved before dependent Zabbix.
    for (const id of EQUIPMENT_SOURCE_IDS) {
      const incomingPlans = groups.get(id);
      if (!incomingPlans?.length) continue;
      const seenSections = new Set();
      for (const plan of incomingPlans) {
        const labels = new Set(plan.records.map(row =>
          partitionApi.key(row?.[plan.definition.partitionField])));
        if (labels.has('') || labels.has(partitionApi.key(partitionApi.UNKNOWN))) {
          throw new Error('Equipment '+id+': секция не определена, удаление запрещено.');
        }
        for (const label of labels) {
          if (seenSections.has(label)) throw new Error(
            'Секция '+label+' Dataset '+id+' присутствует в нескольких файлах.'
          );
          seenSections.add(label);
        }
      }
      const owners = partitionApi.ownership(catalogs);
      const merged = partitionApi.merge(id, catalogs[id],
        incomingPlans.flatMap(plan => plan.records), owners);
      const last = incomingPlans.at(-1);
      catalogs[id] = integrationEquipmentPlanInstance(last, merged.records);
      catalogs[id].joinIndex = merged.joinIndex;
      stats[id] = merged;
    }

    const missing = EQUIPMENT_SOURCE_IDS.filter(id => !catalogs[id]);
    if (missing.length) {
      throw new Error(
        'Нельзя подготовить Equipment_Combined: отсутствуют источники ' +
        missing.map(id => integrationContract().datasets[id]?.title || id).join(', ') + '.'
      );
    }

    const combined = buildEquipmentCombinedFromCatalogs(catalogs, 'staged');
    if (!combined || combined.validation?.status === 'invalid') {
      throw new Error('Equipment_Combined не сформирован из пакетного кандидата.');
    }
    return { catalogs, combined, stats };
  }

// ============================================================================
// PUBLIC COMMIT ORCHESTRATION
// ============================================================================
  async function integrationCommit(plan, callbacks = {}) {
    if (!plan?.inspection?.datasetId || !Array.isArray(plan.records)) {
      throw new Error('План интеграции не подготовлен.');
    }

    const repository = integrationRepository();
    const currentInfo = repository.getDatabaseInfo();
    if (currentInfo.databaseUuid !== plan.databaseUuid) {
      throw new Error('Подключённая БД изменилась после подготовки плана. Повторите интеграцию.');
    }

    // Compare an immutable registry revision rather than repeating a massive
    // preview and reconstructing the current Dataset for every confirmation.
    const current = repository.getDatasetRegistry(plan.inspection.datasetId);
    if (plan.expectedRevision !== undefined &&
        (Number(current.active_revision) !== Number(plan.expectedRevision) ||
         current.updated_at !== plan.expectedUpdatedAt)) {
      throw new Error('Содержимое БД изменилось после расчёта diff. Повторите интеграцию.');
    }

    const atomicReplacements = Array.from(plan.atomicReplacements || []);
    for (const companion of atomicReplacements) {
      const storedCompanion = repository.getDatasetRegistry(companion.id);
      if (Number(storedCompanion.active_revision) !== Number(companion.expectedRevision) ||
          storedCompanion.updated_at !== companion.expectedUpdatedAt) {
        throw new Error(
          'Dataset «' + companion.id +
          '» изменился после подготовки связанного ITSM-пакета. Повторите интеграцию.'
        );
      }
    }

    const strategy = plan.definition.strategy;
    const result = strategy === integrationContract().strategy.UPSERT
      ? (typeof repository.upsertDatasetAsync === 'function'
          ? await repository.upsertDatasetAsync(
              plan.inspection.datasetId, plan.records, plan.options,
              callbacks.onProgress || (() => {}), callbacks.isCancelled || (() => false),
              atomicReplacements
            )
          : (atomicReplacements.length
              ? (() => { throw new Error('Repository не поддерживает атомарный ITSM + KPI Source COMMIT.'); })()
              : repository.upsertDataset(plan.inspection.datasetId, plan.records, plan.options)))
      : repository.replaceDataset(plan.inspection.datasetId, plan.records, plan.options);

    const stored = repository.getDatasetRegistry(plan.inspection.datasetId);
    if (Number(stored.record_count || 0) !== Number(result.rowsAfter)) {
      throw new Error('Контроль после COMMIT не пройден: record_count не совпадает с расчётом.');
    }
    const companionResults = Array.from(result.atomicResults || []);
    for (const companionResult of companionResults) {
      const companionStored = repository.getDatasetRegistry(companionResult.datasetId);
      if (Number(companionStored.record_count || 0) !== Number(companionResult.rowsAfter)) {
        throw new Error(
          'Контроль связанного COMMIT не пройден для Dataset «' +
          companionResult.datasetId + '».'
        );
      }
    }
    return Object.assign({}, result, {
      datasetId: plan.inspection.datasetId,
      title: plan.definition.title,
      sourceFileName: plan.file.name,
      committedAt: stored.updated_at || null,
      revision: stored.active_revision || null,
      processing: plan.preview.processing || null,
      companions: companionResults
    });
  }

  async function integrationCommitBatch(plans) {
    if (!Array.isArray(plans) || plans.length === 0) {
      throw new Error('Equipment-пакет не подготовлен.');
    }

    const repository = integrationRepository();
    const currentInfo = repository.getDatabaseInfo();
    const seenExpected = new Map();

    for (const plan of plans) {
      if (!plan?.inspection?.datasetId || !Array.isArray(plan.records)) {
        throw new Error('В Equipment-пакете есть неподготовленный план.');
      }
      if (currentInfo.databaseUuid !== plan.databaseUuid) {
        throw new Error('Подключённая БД изменилась после подготовки Equipment-пакета.');
      }
      if (plan.definition?.kind !== 'equipment' ||
          plan.definition?.strategy !== integrationContract().strategy.REPLACE) {
        throw new Error('Пакетный COMMIT разрешён только для Equipment REPLACE Dataset.');
      }

      const id = plan.inspection.datasetId;
      const current = repository.getDatasetRegistry(id);
      const signature = Number(current.active_revision) + '|' + current.updated_at;
      const expected = Number(plan.expectedRevision) + '|' + plan.expectedUpdatedAt;
      if (plan.expectedRevision !== undefined && signature !== expected) {
        throw new Error(
          'Dataset «' + id + '» изменился после подготовки пакетного diff. Повторите обработку.'
        );
      }
      const previousExpected = seenExpected.get(id);
      if (previousExpected && previousExpected !== expected) {
        throw new Error('Файлы одного Dataset подготовлены относительно разных ревизий БД.');
      }
      seenExpected.set(id, expected);
    }

    // Processor runs against the complete candidate state BEFORE any SQLite write.
    // If this throws, active Dataset state remains untouched.
    if (plans.some(plan => plan.options?.partitionScopeConfirmed !== true)) {
      throw new Error('Подтверждение полноты всех заменяемых секций Equipment обязательно.');
    }
    const candidate = integrationBuildEquipmentBatchCandidate(plans);
    const changedIds = Array.from(new Set(plans.map(plan => plan.inspection.datasetId)));
    // Save the fully reconstructed final source state in a single transaction.
    // SQLite's older partition REPLACE cannot infer unit/name of legacy
    // StartPoints/Transport, so deleting partial raw records directly would
    // leave stale join indices. We instead migrate in memory and persist the
    // complete validated result atomically for each changed Dataset.
    const committed = repository.replaceDatasetBatch(
      changedIds.map(id => {
        const plansForId = plans.filter(plan => plan.inspection.datasetId === id);
        const last = plansForId.at(-1);
        const finalSource = candidate.catalogs[id];
        return {
          id,
          records: finalSource.records,
          options: Object.assign({}, last.options, {
            fullPreparedScope: true,
            partitionScopeConfirmed: true,
            state: Object.assign({}, last.options.state, {
              joinIndex: integrationSerializedJoinIndex(finalSource.joinIndex),
              lastReplacedPartitions: candidate.stats[id].replacedPartitions
            }),
            details: Object.assign({}, last.options.details, {
              partitionReplace: {
                field: candidate.stats[id].partitionField,
                values: candidate.stats[id].replacedPartitions,
                deleted: candidate.stats[id].removedRows,
                preserved: candidate.stats[id].preservedRows,
                inserted: candidate.stats[id].incomingRows
              }
            })
          })
        };
      })
    );

    const results = plans.map(plan => {
      const id = plan.inspection.datasetId;
      const result = committed.results[changedIds.indexOf(id)];
      return Object.assign({}, result, {
        datasetId: id,
        title: plan.definition.title,
        sourceFileName: plan.file.name,
        processing: plan.preview.processing || null,
        replacedPartitions: candidate.stats[id].replacedPartitions
      });
    });

    const lastResultByDataset = new Map();
    results.forEach(result => lastResultByDataset.set(result.datasetId, result));
    for (const [id, result] of lastResultByDataset) {
      const stored = repository.getDatasetRegistry(id);
      if (Number(stored.record_count || 0) !== Number(result.rowsAfter)) {
        throw new Error(
          'Контроль пакетного COMMIT не пройден для Dataset «' + id + '».'
        );
      }
      results
        .filter(item => item.datasetId === id)
        .forEach(item => {
          item.committedAt = stored.updated_at || null;
          item.revision = stored.active_revision || null;
        });
    }

    candidate.combined.meta.sourceType = 'sqlite';
    candidate.combined.meta.fileName = 'Equipment_Combined · Reclassifier.db';
    candidate.combined.meta.loadedAt = new Date().toISOString();

    return Object.freeze({
      batchId: committed.batchId,
      results: Object.freeze(results),
      changedDatasetIds: committed.changedDatasetIds,
      derivedCandidates: Object.freeze({ combined: candidate.combined }),
      combinedPreview: Object.freeze({
        rows: candidate.combined.records.length,
        validationStatus: candidate.combined.validation?.status || 'valid'
      })
    });
  }

  globalThis.ReclassifierDatabaseIntegration = Object.freeze({
    prepare: integrationPrepare,
    commit: integrationCommit,
    commitBatch: integrationCommitBatch
  });
