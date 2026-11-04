// FILE CONTRACT: Database Dataset integration UI.
// Purpose: prepare integration candidates in the background and execute explicit user-confirmed commits/aborts.
// Owns: background candidate queue, pending integration plans, commit progress and confirmation orchestration.
// Reads: ReclassifierDatabaseIntegration, shared Database workspace state and Repository metadata.
// Writes: persistent Dataset changes only through ReclassifierDatabaseIntegration.
// Public API: internal integration handlers/render helpers used by Database route.
// Must not: write SQLite directly or own Dataset normalization rules.
// Related tests: test_reference_architecture.py, test_database_workspace_contract.py,
//                smoke_app_runtime.js, test_architecture_guardrails.py.

// ============================================================================
// INTEGRATION PREVIEW, DIFF AND PROGRESS PRESENTATION
// ============================================================================
  // Session-only operation identifiers; never store filenames or Dataset rows.
  let databaseJournalOperationSequence = 0;
  const databaseJournalOperationIds = new WeakMap();
  function databaseJournalOperation(item, phase, level = 'INFO', newAttempt = false) {
    if (!item || typeof item !== 'object') return;
    if (newAttempt || !databaseJournalOperationIds.has(item)) {
      databaseJournalOperationIds.set(item, ++databaseJournalOperationSequence);
    }
    const dataset = String(item.inspection?.datasetId || item.pendingPlan?.inspection?.datasetId || 'unknown');
    const safeDataset = /^[a-zA-Z0-9_.-]{1,70}$/.test(dataset) ? dataset : 'unknown';
    log('[DBOP-' + databaseJournalOperationIds.get(item) + '] ' + phase +
      ' · Dataset ' + safeDataset, level, 'import_export');
  }

  function databaseIntegrationPreviewText(preview) {
    if (!preview) return 'Diff ещё не рассчитан.';
    const processing = preview.processing;
    const classifierProcessing = processing
      ? 'Исходных: ' + processing.candidateRows +
        ' · исключено фильтрами: ' + processing.filteredRows +
        ' · после фильтров: ' + processing.afterFiltersRows +
        ' · дедупликация: −' + processing.duplicatesRemoved +
        ' · '
      : '';
    if (preview.strategy === 'UPSERT') {
      return 'До: ' + preview.rowsBefore +
        ' · вход: ' + preview.rowsIncoming +
        ' · добавить: ' + preview.rowsInserted +
        ' · обновить: ' + preview.rowsUpdated +
        ' · без изменений: ' + preview.rowsUnchanged +
        ' · после: ' + preview.rowsAfter;
    }
    return classifierProcessing + 'До: ' + preview.rowsBefore +
      ' · вход: ' + preview.rowsIncoming +
      ' · удалить старых: ' + preview.rowsDeleted +
      ' · записать новых: ' + preview.rowsInserted +
      ' · после: ' + preview.rowsAfter;
  }

  function databaseIntegrationResultMarkup(item) {
    if (item.integrationStatus === 'preparing') {
      return '<div class="database-integration-state pending"><strong>Проверка изменений…</strong>' +
        '<span>Файл повторно проверяется, подготавливается и сравнивается с текущими данными.</span></div>';
    }
    if (item.integrationStatus === 'prepared' && item.pendingPlan) {
      return '<div class="database-integration-state pending"><strong>Изменения готовы — требуется подтверждение</strong>' +
        '<span>' + escapeHtml(databaseIntegrationPreviewText(item.integrationPreview)) + '</span>' +
        '<span>База данных не изменится, пока вы не нажмёте «Применить изменения». ' +
        (item.integrationPreview.strategy === 'UPSERT'
          ? 'Режим обновления сохраняет записи, которых нет во входном файле.'
          : (item.integrationPreview.partitionField
              ? 'Режим замены заменяет только секции: ' +
                (item.integrationPreview.partitions || []).join(', ') +
                '. Остальные секции набора сохраняются.'
              : 'Режим замены полностью заменяет текущий набор данных.')) + '</span>' +
        databaseIntegrationFieldDiffMarkup(item.integrationPreview) + '</div>';
    }
    if (item.integrationStatus === 'committing') {
      const progress = databaseWorkspaceState.commitProgress;
      const totalRows = Math.max(1, Number(progress?.totalRows || item.integrationPreview?.rowsIncoming || 1));
      const processedRows = Math.min(totalRows, Number(progress?.processedRows || 0));
      return '<div class="database-integration-state pending"><strong>Применение изменений…</strong>' +
        '<span id="databaseIntegrationProgressText">' +
          escapeHtml(databaseCommitProgressText(progress)) + '</span>' +
        '<progress id="databaseIntegrationProgressBar" max="' + totalRows +
          '" value="' + processedRows + '"></progress>' +
        '<span>Операцию можно прервать: незавершённая транзакция будет отменена.</span></div>';
    }
    if (item.integrationStatus === 'cancelled' && item.integrationPreview) {
      return '<div class="database-integration-state"><strong>' +
        (item.cancelledDuringCommit ? 'Интеграция прервана — записи откатились' : 'План отклонён') +
        '</strong>' +
        '<span>' + escapeHtml(databaseIntegrationPreviewText(item.integrationPreview)) + '</span></div>';
    }
    if (item.integrationStatus === 'error') {
      return '<div class="database-integration-state invalid"><strong>Изменения не применены</strong>' +
        '<span>' + escapeHtml(item.integrationError || 'Неизвестная ошибка') + '</span></div>';
    }
    if (item.integrationResult) {
      const result = item.integrationResult;
      return '<div class="database-integration-state success"><strong>Изменения применены · версия ' +
        escapeHtml(result.revision || '—') + '</strong><span>' +
        escapeHtml(databaseIntegrationPreviewText(result)) +
        (result.committedAt ? ' · ' + escapeHtml(databaseFormatTimestamp(result.committedAt)) : '') +
        '</span></div>';
    }
    if (item.integrationPreview) {
      return '<div class="database-integration-state"><strong>Последнее сравнение</strong><span>' +
        escapeHtml(databaseIntegrationPreviewText(item.integrationPreview)) + '</span></div>';
    }
    return '';
  }

  function databaseCommitProgressText(progress) {
    if (!progress) return 'Подготовка транзакции…';
    const processed = Number(progress.processedRows || 0);
    const total = Number(progress.totalRows || 0);
    const percent = total ? Math.floor(processed * 100 / total) : 0;
    return 'Обработано ' + processed.toLocaleString('ru-RU') + ' / ' +
      total.toLocaleString('ru-RU') + ' строк · ' + percent + '%.' +
      (databaseWorkspaceState.commitCancelRequested ? ' Прерывание…' : '');
  }

  function databaseUpdateCommitProgress(progress) {
    databaseWorkspaceState.commitProgress = progress;
    const line = document.getElementById('databaseIntegrationProgressText');
    if (line) line.textContent = databaseCommitProgressText(progress);
    const bar = document.getElementById('databaseIntegrationProgressBar');
    if (bar) {
      bar.value = Number(progress?.processedRows || 0);
      bar.max = Math.max(1, Number(progress?.totalRows || 0));
    }
  }

  function databaseAbortCommit(index) {
    const item = databaseWorkspaceState.intake[index];
    if (!item || item.integrationStatus !== 'committing' || !databaseWorkspaceState.busy) return;
    databaseWorkspaceState.commitCancelRequested = true;
    databaseUpdateCommitProgress(databaseWorkspaceState.commitProgress);
    log('Запрошен откат текущей интеграции: ' + item.name + '.', 'WARN', 'import_export');
  }

  function databaseCancelIntegration(index) {
    const item = databaseWorkspaceState.intake[index];
    if (!item || databaseWorkspaceState.busy || !item.pendingPlan) return;
    delete item.pendingPlan;
    item.integrationStatus = 'cancelled';
    databaseJournalOperation(item, 'PREPARE_REJECTED', 'WARN');
    log('План интеграции отклонён пользователем: ' + item.name + '.', 'INFO', 'import_export');
    if (state.route === 'database') renderDatabaseWorkspace();
  }

// ============================================================================
// BACKGROUND CANDIDATE PREPARATION
// ============================================================================
  function databasePauseQueuePreparation(reason = 'paused') {
    databaseWorkspaceState.queuePreparationGeneration += 1;
    databaseWorkspaceState.queuePreparationReason = reason;
  }

  function databaseInvalidateQueueCandidates(reason = 'database-changed') {
    databasePauseQueuePreparation(reason);
    for (const item of databaseWorkspaceState.intake) {
      if (!item || item.integrationStatus === 'committed' || !item.inspection?.ready) continue;
      delete item.pendingPlan;
      delete item.integrationPreview;
      delete item.integrationError;
      delete item.synchronizationError;
      item.integrationStatus = 'queued';
    }
    databaseWorkspaceState.queuePreparationRequested = true;
  }

  async function databasePrepareCandidate(index, options = {}) {
    const item = databaseWorkspaceState.intake[index];
    if (!item || !item.inspection?.ready) return false;

    const info = databaseCurrentInfo();
    if (!info) {
      item.integrationStatus = 'queued';
      return false;
    }
    if (!globalThis.ReclassifierDatabaseIntegration?.prepare) {
      item.integrationStatus = 'error';
      item.integrationError = 'Dataset Integration Engine недоступен в этой сборке.';
      databaseJournalOperation(item, 'PREPARE_FAILED', 'ERROR', true);
      return false;
    }

    const generation = options.generation ?? databaseWorkspaceState.queuePreparationGeneration;
    delete item.pendingPlan;
    item.integrationStatus = 'preparing';
    databaseJournalOperation(item, 'PREPARE_STARTED', 'INFO', true);
    item.integrationError = null;
    delete item.synchronizationError;
    delete item.synchronizedAt;
    if (state.route === 'database') renderDatabaseWorkspace();

    try {
      await databaseNextPaint();
      databaseMemoryDiagnostics.mark('candidate-prepare','start',{fileIndex:index+1,
        inputBytes:item.size||0});
      const plan = await globalThis.ReclassifierDatabaseIntegration.prepare(item);
      databaseMemoryDiagnostics.mark('candidate-prepare','end',
        {fileIndex:index+1,rows:plan.records?.length||0});

      if (generation !== databaseWorkspaceState.queuePreparationGeneration ||
          databaseWorkspaceState.busy) {
        const stillQueued = databaseWorkspaceState.intake.includes(item);
        databaseMemoryDiagnostics.mark('candidate-discarded','end',{
          fileIndex:index+1,
          reason:databaseWorkspaceState.busy ? 'workspace-busy' : 'generation-changed'
        });
        if (stillQueued && item.integrationStatus === 'preparing') {
          item.integrationStatus = 'queued';
          databaseWorkspaceState.queuePreparationRequested = true;
          databaseWorkspaceState.queuePreparationReason = 'candidate-interrupted';
        }
        databaseJournalOperation(item, 'PREPARE_SUPERSEDED', 'WARN');
        return false;
      }

      item.inspection = plan.inspection;
      item.classification = plan.inspection.classification;
      item.integrationPreview = plan.preview;
      item.pendingPlan = plan;
      item.integrationStatus = 'prepared';
      databaseJournalOperation(item, 'PREPARE_READY');
      databaseMemoryDiagnostics.mark('candidate-retained','end',
        {fileIndex:index+1,rows:plan.records?.length||0});
      log('Кандидат подготовлен в фоне, ожидает подтверждения: ' + item.name + '.', 'INFO', 'import_export');
      return true;
    } catch (error) {
      if (generation !== databaseWorkspaceState.queuePreparationGeneration) {
        if (databaseWorkspaceState.intake.includes(item) &&
            item.integrationStatus === 'preparing') {
          item.integrationStatus = 'queued';
          databaseWorkspaceState.queuePreparationRequested = true;
          databaseWorkspaceState.queuePreparationReason = 'candidate-interrupted-after-error';
        }
        databaseJournalOperation(item, 'PREPARE_SUPERSEDED', 'WARN');
        return false;
      }
      delete item.pendingPlan;
      databaseMemoryDiagnostics.mark('candidate-prepare','error',{fileIndex:index+1});
      const message = error?.message || String(error);
      item.integrationStatus = 'error';
      item.integrationError = message;
      databaseJournalOperation(item, 'PREPARE_FAILED', 'ERROR');
      log('Ошибка фоновой подготовки «' + item.name + '»: ' + message, 'ERROR', 'import_export');
      return false;
    } finally {
      if (state.route === 'database') renderDatabaseWorkspace();
    }
  }

  async function databasePrepareIntakeQueue(reason = 'queue-updated') {
    if (databaseWorkspaceState.queuePreparationRunning ||
        databaseWorkspaceState.busy ||
        !databaseCurrentInfo()) {
      databaseWorkspaceState.queuePreparationRequested = true;
      databaseWorkspaceState.queuePreparationReason = reason;
      return;
    }

    const engine = globalThis.ReclassifierDatabaseIntegration;
    if (!engine?.prepare) return;

    const generation = databaseWorkspaceState.queuePreparationGeneration + 1;
    databaseMemoryDiagnostics.mark('queue-drain','start',
      {fileCount:databaseWorkspaceState.intake.length});
    databaseWorkspaceState.queuePreparationGeneration = generation;
    databaseWorkspaceState.queuePreparationRunning = true;
    databaseWorkspaceState.queuePreparationRequested = false;
    databaseWorkspaceState.queuePreparationReason = reason;

    try {
      for (let index = 0; index < databaseWorkspaceState.intake.length; index += 1) {
        if (generation !== databaseWorkspaceState.queuePreparationGeneration ||
            databaseWorkspaceState.busy) {
          break;
        }

        const item = databaseWorkspaceState.intake[index];
        if (!item ||
            !item.inspection?.ready ||
            item.integrationStatus === 'committed' ||
            (item.integrationStatus === 'prepared' && item.pendingPlan)) {
          continue;
        }

        databaseWorkspaceState.queuePreparationCurrentIndex = index;
        await databasePrepareCandidate(index, { generation });
      }
    } finally {
      databaseWorkspaceState.queuePreparationCurrentIndex = null;
      databaseWorkspaceState.queuePreparationRunning = false;
      databaseMemoryDiagnostics.mark('queue-drain','end',
        {fileCount:databaseWorkspaceState.intake.length});
      if (databaseWorkspaceState.intake.some(item => item?.integrationStatus === 'error')) {
        databaseMemoryDiagnostics.finish('failed');
      } else if (!databaseWorkspaceState.queuePreparationRequested &&
        databaseWorkspaceState.intake.every(item => !item?.inspection?.ready ||
          item.integrationStatus === 'prepared' || item.integrationStatus === 'committed')) {
        databaseMemoryDiagnostics.finish('prepared');
      }
      if (state.route === 'database') renderDatabaseWorkspace();

      if (databaseWorkspaceState.queuePreparationRequested &&
          !databaseWorkspaceState.busy &&
          databaseCurrentInfo()) {
        const nextReason = databaseWorkspaceState.queuePreparationReason || 'queue-retry';
        setTimeout(() => void databasePrepareIntakeQueue(nextReason), 0);
      }
    }
  }

  function databaseRequestQueuePreparation(reason = 'queue-updated') {
    databaseWorkspaceState.queuePreparationRequested = true;
    databaseWorkspaceState.queuePreparationReason = reason;
    if (!databaseWorkspaceState.queuePreparationRunning &&
        !databaseWorkspaceState.busy &&
        databaseCurrentInfo()) {
      setTimeout(() => void databasePrepareIntakeQueue(reason), 0);
    }
  }

  function databaseReprepareQueueCandidates(reason = 'database-changed') {
    databaseInvalidateQueueCandidates(reason);
    databaseRequestQueuePreparation(reason);
  }

// ============================================================================
// USER-CONFIRMED INTEGRATION EXECUTION
// ============================================================================
  function databaseEquipmentBatchEntries() {
    const contract = globalThis.ReclassifierDatabaseContract;
    return databaseWorkspaceState.intake
      .map((item, index) => ({ item, index, plan: item?.pendingPlan || null }))
      .filter(entry => {
        const id = entry.item?.inspection?.datasetId || entry.plan?.inspection?.datasetId;
        const definition = id ? contract?.datasets?.[id] : null;
        return definition?.kind === 'equipment' &&
          entry.item?.integrationStatus !== 'committed';
      });
  }

  async function databaseCommitEquipmentBatch(triggerIndex) {
    const engine = globalThis.ReclassifierDatabaseIntegration;
    const entries = databaseEquipmentBatchEntries();
    if (!entries.length || databaseWorkspaceState.busy || !engine?.commitBatch) return;

    const allPrepared = entries.every(entry =>
      entry.item?.integrationStatus === 'prepared' && entry.plan
    );
    if (!allPrepared) {
      alert(
        'Equipment-пакет ещё не готов. Дождитесь подготовки всех Equipment-файлов ' +
        'или удалите лишний/ошибочный файл из очереди.'
      );
      return;
    }
    if (!entries.some(entry => entry.index === triggerIndex)) return;

    const plans = entries.map(entry => entry.plan);
    const partitions = plans.map(plan => {
      const list = Array.from(plan.preview?.partitions || []);
      return plan.inspection.datasetId + ': ' + (list.length
        ? list.join(', ') : 'не определены');
    });
    const confirmed = confirm(
      'ВНИМАНИЕ: секционная замена удаляет ВСЕ прежние записи указанных рудников ' +
      'и вставляет записи из загружаемых файлов.\\n\\n' +
      'Подтвердите, что каждый файл содержит ПОЛНЫЙ состав своей секции, ' +
      'а не отдельные изменения.\\n\\n' +
      partitions.join('\\n') + '\\n\\nПрименить изменения?'
    );
    if (!confirmed) return;
    for (const plan of plans) plan.options.partitionScopeConfirmed = true;
    databasePauseQueuePreparation('equipment-batch-commit-started');
    databaseWorkspaceState.busy = true;
    databaseWorkspaceState.lastError = null;
    databaseWorkspaceState.commitCancelRequested = false;
    databaseWorkspaceState.commitProgress = {
      processedRows: 0,
      totalRows: plans.reduce((sum, plan) => sum + Number(plan.records?.length || 0), 0),
      batchSize: plans.length,
      kind: 'equipment-batch'
    };

    for (const entry of entries) {
      delete entry.item.cancelledDuringCommit;
      delete entry.item.synchronizationError;
      delete entry.item.synchronizedAt;
      entry.item.batchCommit = true;
      entry.item.integrationStatus = 'committing';
      databaseJournalOperation(entry.item, 'BATCH_COMMIT_STARTED');
    }
    if (state.route === 'database') renderDatabaseWorkspace();

    let committed = false;
    try {
      await new Promise(resolve => setTimeout(resolve, 0));
      const result = await engine.commitBatch(plans);
      databaseWorkspaceState.health = null;

      entries.forEach((entry, resultIndex) => {
        const itemResult = result.results[resultIndex];
        delete entry.item.pendingPlan;
        entry.item.integrationResult = itemResult;
        entry.item.integrationPreview = itemResult;
        entry.item.integrationStatus = 'committed';
        entry.item.atomicBatchId = result.batchId;
        delete entry.item.integrationError;
      });
      databaseWorkspaceState.lastError = null;

      const synchronized = databaseSynchronizeWorkspace('equipment-batch-committed', {
        checkHealth: true,
        render: false,
        changedDatasetIds: Array.from(result.changedDatasetIds || []),
        derivedCandidates: result.derivedCandidates || null
      });

      if (synchronized.ok) {
        for (const entry of entries) {
          entry.item.synchronizedAt = databaseWorkspaceState.synchronization.lastAt;
        }
      } else {
        for (const entry of entries) {
          entry.item.synchronizationError = synchronized.error ||
            'Equipment-пакет записан, но Runtime не удалось синхронизировать с SQLite.';
        }
      }

      for (const entry of entries) {
        databaseJournalOperation(entry.item, 'BATCH_COMMIT_APPLIED');
        if (!synchronized.ok) databaseJournalOperation(entry.item, 'RUNTIME_SYNC_FAILED', 'WARN');
      }
      log(
        'SQLite Equipment batch: ' + plans.length + ' файлов · batch ' + result.batchId +
        '; Dataset ' + Array.from(result.changedDatasetIds || []).join(', ') +
        '; Equipment_Combined ' + Number(result.combinedPreview?.rows || 0) + ' строк' +
        (synchronized.ok ? '; Runtime синхронизирован.' : '; синхронизация ERROR.')
      , 'INFO', 'import_export');
      committed = true;
    } catch (error) {
      const message = error?.message || String(error);
      databaseWorkspaceState.health = null;
      databaseWorkspaceState.lastError = message;
      for (const entry of entries) {
        delete entry.item.pendingPlan;
        entry.item.integrationStatus = 'error';
        entry.item.integrationError = message;
        databaseJournalOperation(entry.item, 'BATCH_COMMIT_FAILED', 'ERROR');
      }
      log(
        'Equipment batch отклонён/откачен: ' + message,
        'ERROR'
      , 'import_export');
      alert(
        'Equipment-пакет не применён. Все исходные Dataset оставлены в предыдущем состоянии: ' +
        message
      );
      const integrationError = databaseWorkspaceState.lastError;
      databaseSynchronizeWorkspace('equipment-batch-rolled-back', {
        checkHealth: true,
        render: false
      });
      databaseWorkspaceState.lastError = integrationError;
    } finally {
      for (const entry of entries) delete entry.item.batchCommit;
      databaseWorkspaceState.commitProgress = null;
      databaseWorkspaceState.commitCancelRequested = false;
      databaseWorkspaceState.busy = false;
      if (committed) {
        const released = databaseReleaseCommittedQueueItems(entries.map(entry => entry.item));
        if (released) log('Очередь БД: освобождены завершённые Equipment-файлы: ' + released + '.');
        databaseReprepareQueueCandidates('post-equipment-batch');
      }
      if (state.route === 'database') renderDatabaseWorkspace();
    }
  }

  async function databaseCommitIntegration(index) {
    const item = databaseWorkspaceState.intake[index];
    if (!item || databaseWorkspaceState.busy || !item.pendingPlan) return;
    const plan = item.pendingPlan;
    if (plan.definition?.kind === 'equipment' &&
        globalThis.ReclassifierDatabaseIntegration?.commitBatch) {
      await databaseCommitEquipmentBatch(index);
      return;
    }
    databasePauseQueuePreparation('commit-started');
    databaseWorkspaceState.busy = true;
    databaseWorkspaceState.lastError = null;
    databaseWorkspaceState.commitCancelRequested = false;
    databaseWorkspaceState.commitProgress = {
      processedRows: 0,
      totalRows: plan.records.length
    };
    delete item.cancelledDuringCommit;
    delete item.synchronizationError;
    delete item.synchronizedAt;
    item.integrationStatus = 'committing';
    databaseJournalOperation(item, 'COMMIT_STARTED');
    if (state.route === 'database') renderDatabaseWorkspace();
    try {
      // Paint the explicit running state before the synchronous SQL transaction.
      await new Promise(resolve => setTimeout(resolve, 0));
      const result = await globalThis.ReclassifierDatabaseIntegration.commit(plan, {
        onProgress: progress => databaseUpdateCommitProgress(progress),
        isCancelled: () => databaseWorkspaceState.commitCancelRequested
      });
      delete item.pendingPlan;
      databaseWorkspaceState.health = null; // health is stale after a mutation
      item.integrationResult = result;
      item.integrationPreview = result;
      item.integrationStatus = 'committed';
      databaseWorkspaceState.lastError = null;

      const synchronized = databaseSynchronizeWorkspace('integration-committed', {
        checkHealth: true,
        render: false,
        changedDatasetIds: [plan.inspection.datasetId]
      });
      if (synchronized.ok) {
        item.synchronizedAt = databaseWorkspaceState.synchronization.lastAt;
      } else {
        item.synchronizationError = synchronized.error ||
          'COMMIT выполнен, но Runtime не удалось синхронизировать с SQLite.';
      }

      databaseJournalOperation(item, 'COMMIT_APPLIED');
      if (!synchronized.ok) databaseJournalOperation(item, 'RUNTIME_SYNC_FAILED', 'WARN');
      log(
        'SQLite интеграция: ' + result.title + ' · ' + result.strategy +
        '; до ' + result.rowsBefore +
        '; вход ' + result.rowsIncoming +
        '; добавлено ' + result.rowsInserted +
        '; обновлено ' + result.rowsUpdated +
        '; без изменений ' + result.rowsUnchanged +
        '; удалено ' + result.rowsDeleted +
        '; после ' + result.rowsAfter +
        (item.synchronizationError ? '; синхронизация ERROR.' : '; Runtime синхронизирован.') 
      , 'INFO', 'import_export');
    } catch (error) {
      delete item.pendingPlan;
      const message = error?.message || String(error);
      databaseWorkspaceState.health = null;
      if (databaseWorkspaceState.commitCancelRequested &&
          /прерван|отменен|отменён/i.test(message)) {
        item.integrationStatus = 'cancelled';
        item.cancelledDuringCommit = true;
        databaseJournalOperation(item, 'COMMIT_ROLLED_BACK', 'WARN');
        log('Интеграция прервана с откатом Dataset: ' + item.name + '.', 'WARN', 'import_export');
      } else {
        item.integrationStatus = 'error';
        item.integrationError = message;
        databaseWorkspaceState.lastError = message;
        databaseJournalOperation(item, 'COMMIT_FAILED', 'ERROR');
        log('Ошибка интеграции «' + item.name + '»: ' + message, 'ERROR', 'import_export');
        alert('Интеграция не выполнена: ' + message);
      }
      const integrationError = databaseWorkspaceState.lastError;
      databaseSynchronizeWorkspace(
        item.integrationStatus === 'cancelled' ? 'integration-rolled-back' : 'integration-failed',
        { checkHealth: true, render: false }
      );
      if (integrationError) databaseWorkspaceState.lastError = integrationError;
    } finally {
      databaseWorkspaceState.commitProgress = null;
      databaseWorkspaceState.commitCancelRequested = false;
      databaseWorkspaceState.busy = false;
      if (item.integrationStatus === 'committed') {
        const released = databaseReleaseCommittedQueueItems([item]);
        if (released) log('Очередь БД: завершённый файл освобождён после COMMIT: ' + item.name + '.');
        databaseReprepareQueueCandidates('post-commit');
      }
      if (state.route === 'database') renderDatabaseWorkspace();
    }
  }

  async function databaseIntegrateItem(index) {
    if (databaseWorkspaceState.busy) return;
    const item = databaseWorkspaceState.intake[index];
    if (!item) return;

    if (!databaseCurrentInfo()) {
      alert('Сначала разверните или откройте Reclassifier.db.');
      return;
    }
    if (!item.inspection?.ready) {
      alert('Этот Excel не готов к интеграции. Исправьте ошибки Dataset Recognizer.');
      return;
    }

    databasePauseQueuePreparation('manual-reprepare');
    const generation = databaseWorkspaceState.queuePreparationGeneration;
    const prepared = await databasePrepareCandidate(index, { generation });
    if (!prepared) {
      const message = item.integrationError || 'Не удалось подготовить кандидата.';
      databaseWorkspaceState.lastError = message;
      alert('Не удалось подготовить кандидата: ' + message);
    }
  }

  async function databaseLoadItem(index) {
    const item = databaseWorkspaceState.intake[index];
    if (!item || item.integrationStatus !== 'prepared' || !item.pendingPlan) return;
    await databaseCommitIntegration(index);
  }
