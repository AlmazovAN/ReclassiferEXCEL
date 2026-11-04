// FILE CONTRACT: browser runtime orchestration.
// Purpose: create the shared WebWorker, correlate requests, guard module operations and bootstrap data.
// Owns: top-level Worker/UI orchestration and application initialization sequence.
// Reads: assembled worker asset, build metadata and module registrations.
// Writes: transient application state and runtime status UI.
// Public API: workerRequest and runModuleProbe inside the assembled application scope; request lifecycle is delegated to createWorkerClient().
// Must not: contain subject-specific business rules or direct SQLite persistence.
// Related tests: smoke_app_runtime.js, test_js_fragment_contract.py,
//                test_architecture_guardrails.py.

  let moduleOperationSequence = 0;

// ============================================================================
// SHARED WEBWORKER CREATION AND MESSAGE ROUTING
// ============================================================================
  function createWorker() {
    log('Начато создание общего WebWorker.', 'DEBUG', 'diagnostics');
    const workerCode = assets.worker;
    const sheetJsSource = document.getElementById('sheetjsVendorSource')?.textContent || '';
    if (!workerCode) {
      log('Worker asset отсутствует в сборке.', 'WARN', 'runtime');
      return null;
    }
    if (!sheetJsSource) {
      log('SheetJS source для WebWorker отсутствует в сборке.', 'WARN', 'runtime');
      return null;
    }

    const url = URL.createObjectURL(
      new Blob([sheetJsSource, '\n', workerCode], { type: 'text/javascript' })
    );
    try {
      return new Worker(url);
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  function handleWorkerMessage(message, meta) {
    if (message.type === 'READY') {
      state.workerReady = true;
      el.runtimeDot.classList.add('ready');
      const readyModules = [
        message.payload?.reclassification ? 'Реклассификация' : '',
        message.payload?.itsm ? 'ITSM' : '',
        message.payload?.mobileBrigade ? 'МБ' : ''
      ].filter(Boolean);
      el.runtimeState.textContent = 'Готово к работе';
      log(
        'WebWorker инициализирован' +
        (readyModules.length ? ': ' + readyModules.join(', ') + '.' : '.')
      );
      return;
    }

    if (message.type === 'WORKER_ERROR' && !meta.settled) {
      log(message.payload?.message || 'Ошибка WebWorker.', 'ERROR', 'runtime');
      return;
    }

    if (message.type === 'NOT_IMPLEMENTED') {
      log(message.payload?.message || 'Обработка не реализована.', 'WARN', 'runtime');
      alert(message.payload?.message || 'Обработка пока не реализована.');
    }
  }

  function handleWorkerFatal(error, meta) {
    state.workerReady = false;
    el.runtimeDot.classList.remove('ready');
    el.runtimeState.textContent = 'WebWorker недоступен';
    log(
      (error?.message || 'WebWorker аварийно завершил работу.') +
      (meta?.rejectedRequests ? ' Отменено запросов: ' + meta.rejectedRequests + '.' : ''),
      'ERROR'
    );
  }

  const workerClient = createWorkerClient({
    createWorker,
    requestTimeoutMs: 10 * 60 * 1000,
    // Release the completed SheetJS Worker heap between large brigade files.
    recycleAfterTypes: ['PROCESS_MOBILE_BRIGADE', 'EXPORT_DATASET_XLSX_STREAM'],
    onWorkerRecycled({completedType} = {}) {
      globalThis.ReclassifierDatabaseMemoryDiagnostics?.mark?.(
        completedType === 'EXPORT_DATASET_XLSX_STREAM'
          ? 'xlsx-worker-recycled' : 'mb-worker-recycled', 'end');
      if (completedType === 'EXPORT_DATASET_XLSX_STREAM') {
        globalThis.ReclassifierXlsxExportDiagnostics?.mark?.('xlsx-worker-recycled','end');
      }
    },
    onWorkerCreated(worker) {
      state.workerReady = false;
      el.runtimeDot.classList.remove('ready');
      el.runtimeState.textContent = 'Инициализация WebWorker…';
      worker.postMessage({ type: 'PING' });
    },
    onMessage: handleWorkerMessage,
    onFatal: handleWorkerFatal
  });

  workerClient.start();

  // Dedicated KPI worker: lazy-started on the first explicit queued KPI request.
  // The current Report Service remains synchronous until PR 5; starting the
  // application must not clone large SQLite datasets into another Worker.
  const kpiBackgroundFactory = globalThis.ReclassifierKpiBackgroundJobsFactory;
  globalThis.ReclassifierKpiBackgroundJobs = kpiBackgroundFactory?.create({
    workerCode: assets.kpiWorker || '',
    createClient: createWorkerClient
  }) || null;

  // Low-priority calculator is started after successful baseline hydration or
  // relevant Dataset COMMIT. No SQLite reads during a write lock.
  const kpiAutoFactory = globalThis.ReclassifierKpiAutoRefreshFactory;
  globalThis.ReclassifierKpiAutoRefresh = kpiAutoFactory?.create({
    report: globalThis.ReclassifierReliabilityReportService,
    header: globalThis.ReclassifierHeaderIndicators,
    isReady: () => state.baselineReady === true && state.bootstrapState === 'ready',
    isBusy: () => Boolean(state.processingModuleId ||
      (typeof databaseWorkspaceState !== 'undefined' && databaseWorkspaceState.busy) ||
      (['TEST_14_PR322','TEST_15_PR324','TEST_16_PR326','TEST_17_PR332','TEST_18_PR335'].includes(globalThis.RECLASSIFIER_BUILD?.testLabel) &&
        globalThis.ReclassifierXlsxExportDiagnostics?.isRunning?.())),
    hasWorker: () => typeof Worker === 'function' &&
      Boolean(assets.kpiWorker && globalThis.ReclassifierKpiBackgroundJobs?.runReport),
    hasInputs: () => {
      const diagnostic=globalThis.ReclassifierDatabaseMemoryDiagnostics;
      const test12=['TEST_12_PR322','TEST_13_PR322','TEST_14_PR322','TEST_15_PR324','TEST_16_PR326','TEST_17_PR332','TEST_18_PR335'].includes(globalThis.RECLASSIFIER_BUILD?.testLabel);
      if(test12) diagnostic?.mark?.('kpi-input-check','start');
      try {
        const repo=globalThis.ReclassifierDatabaseRepository;
        const sqlite=['TEST_13_PR322','TEST_14_PR322','TEST_15_PR324','TEST_16_PR326','TEST_17_PR332','TEST_18_PR335'].includes(globalThis.RECLASSIFIER_BUILD?.testLabel) &&
          repo?.hasOpenDatabase?.();
        const available=sqlite
          ? Boolean(Number(repo.getDatasetRegistry('itsm_data')?.record_count||0)>0 ||
            Number(repo.getDatasetRegistry('mobile_brigade_data')?.record_count||0)>0)
          : Boolean(datasetStore.get('itsm_data')?.records?.length ||
            datasetStore.get('mobile_brigade_data')?.records?.length);
        if(test12) diagnostic?.mark?.('kpi-input-check','end',{ready:available?1:0});
        return available;
      } catch(error) {
        if(test12) diagnostic?.mark?.('kpi-input-check','error');
        throw error;
      }
    },
    userOnKpiRoute: () => state.route === 'reliability_dashboard' ||
      state.route === 'kpi_passports'
  }) || null;

// ============================================================================
// PROMISE-BASED WORKER REQUEST API
// ============================================================================
  function workerRequest(type, payload, transfer = [], onProgress = null, onBatch = null) {
    return workerClient.request(type, payload, transfer, onProgress, onBatch);
  }

  function updateProcessingButton(button, progress = {}) {
    if (!button) return;
    const raw = Number(progress.percent);
    const percent = Number.isFinite(raw) ? Math.max(0, Math.min(100, Math.round(raw))) : 0;
    const label = String(progress.label || 'Обработка').trim() || 'Обработка';
    button.classList.add('processing-progress');
    button.style.setProperty('--process-progress', percent + '%');
    button.textContent = label + '… ' + percent + '%';
    button.setAttribute('aria-valuenow', String(percent));
    button.setAttribute('aria-valuemin', '0');
    button.setAttribute('aria-valuemax', '100');
  }

  function resetProcessingButton(button, text = 'Обработать') {
    if (!button) return;
    button.classList.remove('processing-progress');
    button.style.removeProperty('--process-progress');
    button.removeAttribute('aria-valuenow');
    button.removeAttribute('aria-valuemin');
    button.removeAttribute('aria-valuemax');
    button.textContent = text;
  }

// ============================================================================
// GENERIC MODULE OPERATION LIFECYCLE GUARD
// ============================================================================
  async function runModuleProbe(moduleId) {
    if (!state.baselineReady) {
      alert('Дождитесь завершения загрузки стартовых данных.');
      return;
    }
    if (state.processingModuleId) {
      alert('Уже выполняется обработка. Дождитесь её завершения.');
      return;
    }
    if (!state.sourceFile) return;

    const module = moduleConfig[moduleId];
    const sourceFile = state.sourceFile;
    log(`Запуск модуля ${module.title}; файл: ${sourceFile.name}`, 'INFO', 'import_export');

    const processor = moduleProcessors[moduleId];
    if (processor) {
      const operationId = 'module-' + (++moduleOperationSequence);
      state.processingModuleId = moduleId;
      state.processingOperationId = operationId;

      const processButton = document.getElementById('processButton');
      const selectButton = document.getElementById('selectSourceButton');
      const clearButton = document.getElementById('clearFileButton');
      const originalText = processButton?.textContent || 'Обработать';
      if (processButton) {
        processButton.disabled = true;
        updateProcessingButton(processButton, { percent: 0, label: 'Подготовка' });
      }
      if (selectButton) selectButton.disabled = true;
      if (clearButton) clearButton.disabled = true;

      try {
        const result = await processor({
          sourceFile,
          operationId,
          onProgress: progress => updateProcessingButton(processButton, progress)
        });
        if (state.processingOperationId !== operationId || state.sourceFile !== sourceFile) {
          throw new Error('Исходный файл изменён во время обработки. Результат не применён.');
        }
        const outputName = result?.outputName;
        alert(module.title + ' обработан.' + (outputName ? ' Файл «' + outputName + '» сохранён в загрузки браузера.' : ''));
      } catch (error) {
        const message = error?.message || String(error);
        log('Ошибка ' + module.title + ': ' + message, 'ERROR', 'import_export');
        alert('Не удалось обработать ' + module.title + ': ' + message);
      } finally {
        if (state.processingOperationId === operationId) {
          state.processingModuleId = null;
          state.processingOperationId = null;
        }
        if (state.route === moduleId) {
          moduleRenderers[moduleId]?.();
        } else if (processButton) {
          processButton.disabled = false;
          resetProcessingButton(processButton, originalText);
        }
      }
      return;
    }

    try {
      workerClient.post({ type: 'PROCESS', moduleId, fileName: sourceFile.name });
    } catch (error) {
      log('WebWorker недоступен: ' + (error?.message || String(error)), 'ERROR', 'runtime');
      alert('WebWorker недоступен. Подробности в журнале.');
    }
  }

  document.querySelectorAll('.nav-item').forEach(btn => btn.addEventListener('click', () => navigate(btn.dataset.route)));

// ============================================================================
// APPLICATION BOOTSTRAP AND LOCAL SNAPSHOT RESTORE
// ============================================================================
  function initializeApplication() {
    state.baselineReady = false;
    state.bootstrapState = 'loading';
    state.bootstrapError = null;
    const buildModePill = document.getElementById('buildModePill');
    if (buildModePill) buildModePill.textContent = 'CORE · без встроенных данных';
    log('Режим данных: core-no-data. Подключите SQLite с локальными корпоративными Dataset.');
    log(`Reclassifier ${build.version || 'dev'} CORE запущен без встроенных Dataset.`);
    render();

    setTimeout(async () => {
      const startedAt = performance.now();
      const profiler=globalThis.ReclassifierPerformanceProfiler;
      const profileStarted=profiler?.start('startup.hydrate.total');
      let restored = 0;
      let hydrationError = null;
      try {
        const datasetStamp=profiler?.start('startup.hydrate.datasetPack');
        restored = await hydrateDatasetPack();
        profiler?.end('startup.hydrate.datasetPack',datasetStamp);
      } catch (error) {
        hydrationError = error instanceof Error ? error : new Error(String(error));
        log('Ошибка загрузки данных: ' + hydrationError.message, 'ERROR', 'runtime');
      } finally {
        profiler?.end('startup.hydrate.total',profileStarted);
        state.baselineReady = !hydrationError;
        state.bootstrapState = hydrationError ? 'failed' : 'ready';
        state.bootstrapError = hydrationError?.message || null;
        if (hydrationError) {
          log('Запуск ограничен до восстановления локального Dataset из SQLite.', 'ERROR', 'runtime');
        } else {
          // Avoid both a cold SQLite read and a Worker clone before first paint.
          // CORE with no data stays idle until a real SQLite is connected.
          globalThis.ReclassifierKpiAutoRefresh?.request?.('baseline-ready');
          log((restored === 0 ? 'CORE готов: встроенных Dataset нет; подключите SQLite. ' : 'Данные восстановлены из локального снимка: ' + restored + '. ') +
            'Время загрузки ' + Math.round(performance.now() - startedAt) + ' мс.');
        }
        render();
      }
    }, 0);

  }

  initializeApplication();
})();
