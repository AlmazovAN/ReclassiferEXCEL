// FILE CONTRACT: Database workspace connection/bootstrap commands.
// Purpose: create/open/export the Reclassifier.db session and manage route-level workspace resets.
// Owns: user commands around database session lifecycle and HTML-to-SQLite bootstrap progress.
// Reads: Database Bootstrap, Repository, shared workspace state and health helpers.
// Writes: Repository only through its public API; updates UI state around those operations.
// Public API: internal handlers used by renderDatabaseWorkspace.
// Must not: implement Dataset recognition/integration rules or access raw SQLite handles.
// Related tests: test_reference_architecture.py, test_database_workspace_contract.py,
//                smoke_app_runtime.js, test_architecture_guardrails.py.

// ============================================================================
// DATABASE LIFECYCLE COMMANDS FROM UI
// ============================================================================
  async function databaseCreateNew() {
    if (databaseWorkspaceState.busy || !databaseConfirmReplaceCurrent()) return;
    if (!state.baselineReady) {
      alert('Стартовые Dataset HTML ещё загружаются. Дождитесь завершения и повторите.');
      return;
    }
    const bootstrap = globalThis.ReclassifierDatabaseBootstrap;
    if (!bootstrap?.collectSeeds) {
      alert('Модуль развёртывания стартовых Dataset недоступен в этой сборке.');
      return;
    }

    databaseWorkspaceState.busy = true;
    databaseWorkspaceState.lastError = null;
    databaseWorkspaceState.health = null;
    databaseResetSynchronizationState();
    databaseUpdateBootstrapProgress({
      phase: 'preparing',
      copiedRows: 0,
      totalRows: 0,
      completedDatasets: 0,
      totalDatasets: 0
    });
    if (state.route === 'database') renderDatabaseWorkspace();

    let created = false;
    try {
      await databaseNextPaint();
      const seeds = bootstrap.collectSeeds();
      const totalRows = seeds.reduce((sum, seed) => sum + seed.records.length, 0);
      databaseUpdateBootstrapProgress({
        phase: 'initializing',
        copiedRows: 0,
        totalRows,
        completedDatasets: 0,
        totalDatasets: seeds.length
      });
      await databaseNextPaint();

      const info = await getDatabaseRepository().createDatabase({
        fileName: 'Reclassifier.db',
        appVersion: build.version
      });
      created = true;
      databaseAutoSaveStop();
      databaseWorkspaceState.fileConnection = null;
      databaseResetIntegrationState();

      // Re-render once the DB handle exists. Subsequent row progress updates the
      // lightweight progress elements directly and does not query SQLite mid-transaction.
      databaseUpdateBootstrapProgress({
        phase: 'dataset',
        title: 'подготовка первой партии',
        copiedRows: 0,
        totalRows,
        completedDatasets: 0,
        totalDatasets: seeds.length
      });
      if (state.route === 'database') renderDatabaseWorkspace();
      await databaseNextPaint();

      const result = await getDatabaseRepository().bootstrapDatasets(
        seeds,
        progress => databaseUpdateBootstrapProgress(progress)
      );
      const health = databaseRunHealthCheck({ render: false });
      if (!health?.ok) {
        throw new Error('База заполнена, но итоговая проверка целостности не пройдена: ' +
          (health?.errors || []).join(' '));
      }
      const synchronized = databaseSynchronizeWorkspace('database-created', {
        checkHealth: false,
        render: false
      });
      if (!synchronized.ok) {
        throw new Error(synchronized.error || 'Не удалось синхронизировать Runtime после развёртывания БД.');
      }

      databaseUpdateBootstrapProgress({
        phase: 'complete',
        copiedRows: result.totalRows,
        totalRows: result.totalRows,
        completedDatasets: result.completedDatasets,
        totalDatasets: result.completedDatasets,
        durationMs: result.durationMs
      });
      log(
        'Reclassifier.db развёрнута из HTML: ' + result.completedDatasets +
        ' Dataset, ' + result.totalRows + ' строк; DB Schema ' + info.schemaVersion + '.'
      , 'INFO', 'import_export');
    } catch (error) {
      databaseWorkspaceState.lastError = error?.message || String(error);
      databaseWorkspaceState.bootstrap = null;
      if (created) {
        try { getDatabaseRepository().closeDatabase(); } catch (_) {}
      }
      log('Не удалось развернуть базу: ' + databaseWorkspaceState.lastError, 'ERROR', 'import_export');
      alert('Не удалось развернуть базу данных: ' + databaseWorkspaceState.lastError);
    } finally {
      databaseWorkspaceState.busy = false;
      if (databaseCurrentInfo()) databaseRequestQueuePreparation('database-created');
      if (state.route === 'database') renderDatabaseWorkspace();
    }
  }

  // Legacy file input gives us only a File snapshot. Native File System Access
  // returns a handle which can also write to the original OS file.
  // The native picker MUST start synchronously in the click handler.
  function databaseChooseFile() {
    if (databaseWorkspaceState.busy || !databaseConfirmReplaceCurrent()) return;
    if (typeof window !== 'undefined' && typeof window.showOpenFilePicker === 'function') {
      let picker;
      try {
        picker = window.showOpenFilePicker({
          multiple: false,
          types: [{
            description: 'SQLite database',
            accept: { 'application/octet-stream': ['.db', '.sqlite', '.sqlite3'] }
          }]
        });
      } catch (error) {
        alert('Браузер не разрешил подключение файла для записи: ' +
          (error?.message || String(error)) + '. Используйте открытие без записи.');
        return;
      }
      Promise.resolve(picker).then(async handles => {
        const handle = handles?.[0];
        if (!handle) return;
        const file = await handle.getFile();
        await databaseOpenSelectedFile(file, handle);
      }).catch(error => {
        if (error?.name === 'AbortError') return;
        alert('Не удалось открыть системный диалог файла: ' +
          (error?.message || String(error)) +
          '. Используйте кнопку «Открыть без прямой записи».');
      });
      return;
    }
    databaseChooseFileLegacy();
  }

  function databaseChooseFileLegacy() {
    if (databaseWorkspaceState.busy) return;
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.db,.sqlite,.sqlite3,application/vnd.sqlite3,application/x-sqlite3';
    input.hidden = true;
    document.body.appendChild(input);
    input.addEventListener('cancel', () => input.remove(), { once: true });
    input.addEventListener('change', () => {
      const file = Array.from(input.files || [])[0] || null;
      input.value = '';
      input.remove();
      if (file) void databaseOpenSelectedFile(file, null);
    }, { once: true });
    input.click();
  }

  async function databaseOpenSelectedFile(file, fileHandle = null) {
    if (databaseWorkspaceState.busy || !file) return;
    databaseWorkspaceState.busy = true;
    databaseWorkspaceState.lastError = null;
    if (state.route === 'database') renderDatabaseWorkspace();
    try {
      const info = await getDatabaseRepository().openDatabase(file, { fileName: file.name });
      databaseAutoSaveStop();
      databaseWorkspaceState.fileConnection = null;
      databaseWorkspaceState.bootstrap = null;
      databaseResetIntegrationState();
      databaseResetSynchronizationState();
      const health = databaseRunHealthCheck({ render: false });
      if (!health?.ok) {
        throw new Error('Открытая база не прошла итоговую проверку целостности.');
      }
      const synchronized = databaseSynchronizeWorkspace('database-opened', {
        checkHealth: false,
        render: false
      });
      if (!synchronized.ok) {
        throw new Error(synchronized.error || 'Не удалось синхронизировать Runtime с открытой БД.');
      }
      if (fileHandle && typeof fileHandle.createWritable === 'function') {
        databaseWorkspaceState.fileConnection = {
          handle: fileHandle,
          databaseUuid: info.databaseUuid,
          size: file.size,
          lastModified: file.lastModified
        };
      }
      log('Открыта база «' + file.name + '»; DB Schema ' + info.schemaVersion +
        (databaseWorkspaceState.fileConnection ? '; возможна запись в исходный файл.' :
          '; для сохранения потребуется скачивание .db.'), 'INFO', 'import_export');
    } catch (error) {
      databaseAutoSaveStop();
      databaseWorkspaceState.fileConnection = null;
      databaseWorkspaceState.lastError = error?.message || String(error);
      log('Не удалось открыть БД «' + file.name + '»: ' + databaseWorkspaceState.lastError, 'ERROR', 'import_export');
      alert('Не удалось открыть базу данных: ' + databaseWorkspaceState.lastError);
    } finally {
      databaseWorkspaceState.busy = false;
      if (databaseCurrentInfo()) databaseRequestQueuePreparation('database-opened');
      if (state.route === 'database') renderDatabaseWorkspace();
    }
  }

  function databaseSaveProgressText(progress) {
    if (!progress) return '';
    if (progress.phase === 'permission') return 'Ожидание разрешения на запись в подключённый файл…';
    if (progress.phase === 'exporting') return 'Подготовка SQLite и проверка целостности…';
    if (progress.phase === 'complete') return 'Запись и побайтовая проверка завершены.';
    const label = progress.phase === 'writing'
      ? 'Запись в исходный файл'
      : 'Побайтовая проверка файла на диске';
    const total = Number(progress.totalBytes) || 0;
    const completed = Math.min(Math.max(Number(progress.completedBytes) || 0, 0), total);
    return label + ': ' + formatBytes(completed) + ' / ' + formatBytes(total) +
      (total ? ' (' + Math.floor(completed / total * 100) + '%)' : '');
  }

  function databaseUpdateSaveProgress(progress) {
    databaseWorkspaceState.saveProgress = progress;
    // This callback runs while the Repository mutex is held. Never query
    // SQLite or re-render the Database route here.
    if (typeof document === 'undefined') return;
    const element = document.getElementById('databaseSaveProgress');
    if (element) element.textContent = databaseSaveProgressText(progress);
  }

  async function databaseSaveConnected(automatic = false) {
    const info = databaseCurrentInfo();
    const linked = databaseWorkspaceState.fileConnection;
    if (databaseWorkspaceState.busy || !info) return;
    if (!linked || linked.databaseUuid !== info.databaseUuid) {
      if (!automatic) alert('Файл открыт без дескриптора записи. Переподключите базу через «Открыть существующую БД» ' +
        'в поддерживаемой Opera либо нажмите «Скачать Reclassifier.db».');
      return false;
    }
    if (!info.dirty) {
      if (!automatic) alert('В рабочей SQLite нет новых изменений, требующих записи в файл.');
      return true;
    }
    databaseWorkspaceState.busy = true;
    databaseWorkspaceState.lastError = null;
    databaseWorkspaceState.saveProgress = { phase: 'permission' };
    if (state.route === 'database') renderDatabaseWorkspace();
    try {
      // Prompt is initiated by a user click; the browser controls consent.
      if (!automatic && typeof linked.handle.requestPermission === 'function') {
        const permission = await linked.handle.requestPermission({ mode: 'readwrite' });
        if (permission !== 'granted') {
          throw new Error('Opera не разрешила запись в исходный файл. Изменения остаются в памяти.');
        }
      }
      if (automatic && typeof linked.handle.queryPermission === 'function' &&
          await linked.handle.queryPermission({ mode: 'readwrite' }) !== 'granted') {
        throw new Error('Разрешение автоматической записи истекло или отозвано.');
      }
      const saved = await getDatabaseRepository().saveDatabaseToFile(linked.handle, {
        size: linked.size,
        lastModified: linked.lastModified
      }, { onProgress: databaseUpdateSaveProgress });
      linked.size = saved.size;
      linked.lastModified = saved.lastModified;
      // Repository owns the confirmed revision/time; UI does not maintain
      // a competing savedAt flag which could outlive later SQLite commits.
      databaseRunHealthCheck({ render: false });
      log('Сохранена подключённая SQLite: ' + saved.fileName +
        ', подтверждена ревизия ' + saved.verifiedRevision +
        ', сверено ' + formatBytes(saved.verifiedBytes) + ' непосредственно с файлом на диске. ' +
        'Время: экспорт ' + (saved.timing.exportMs / 1000).toFixed(1) +
        ' с, запись ' + (saved.timing.writeMs / 1000).toFixed(1) +
        ' с, проверка ' + (saved.timing.verifyMs / 1000).toFixed(1) +
        ' с, всего ' + (saved.timing.totalMs / 1000).toFixed(1) + ' с.', 'INFO', 'import_export');
      if (!automatic) alert('Подключённая БД сохранена: «' + saved.fileName + '». Проверено ' +
        formatBytes(saved.verifiedBytes) + ' записанных данных.');
      return true;
    } catch (error) {
      databaseWorkspaceState.lastError = error?.message || String(error);
      log('Не удалось сохранить исходную SQLite: ' + databaseWorkspaceState.lastError, 'ERROR', 'import_export');
      if (!automatic) alert('Не удалось подтвердить запись в подключённый файл: ' +
        databaseWorkspaceState.lastError + '\nРабочие данные остаются в браузере. ' +
        'Не закрывайте вкладку; используйте «Скачать Reclassifier.db» для резервной копии.');
      return false;
    } finally {
      databaseWorkspaceState.busy = false;
      databaseWorkspaceState.saveProgress = null;
      // A candidate may have finished while SQLite disk verification held
      // the Workspace busy flag. Resume pending preparation after save.
      if (databaseWorkspaceState.queuePreparationRequested &&
          !databaseWorkspaceState.queuePreparationRunning &&
          databaseCurrentInfo()) {
        databaseRequestQueuePreparation('database-save-finished');
      }
      if (state.route === 'database') renderDatabaseWorkspace();
    }
  }

  function databaseExportCurrent() {
    if (databaseWorkspaceState.busy) return;
    const info = databaseCurrentInfo();
    if (!info) return;
    try {
      const bytes = getDatabaseRepository().downloadDatabase(info.fileName || 'Reclassifier.db');
      databaseRunHealthCheck({ render: false });
      log('Запрошено скачивание отдельной копии SQLite после проверки целостности: ' +
        (info.fileName || 'Reclassifier.db') + ' (' + formatBytes(bytes) +
        '). Исходная подключённая БД не обновлялась. Проверьте, что файл действительно сохранён на диск.', 'INFO', 'import_export');
      renderDatabaseWorkspace();
    } catch (error) {
      const message = error?.message || String(error);
      databaseWorkspaceState.lastError = message;
      log('Ошибка выгрузки БД: ' + message, 'ERROR', 'import_export');
      alert('Не удалось выгрузить базу данных: ' + message);
    }
  }

  function databaseCloseCurrent() {
    const info = databaseCurrentInfo();
    if (!info || databaseWorkspaceState.busy) return;
    if (info.dirty && !confirm('В базе есть изменения, которые ещё не выгружены. Закрыть базу без сохранения?')) {
      return;
    }
    databaseAutoSaveStop();
    getDatabaseRepository().closeDatabase();
    databaseWorkspaceState.fileConnection = null;
    databaseWorkspaceState.health = null;
    databaseResetIntegrationState();
    databaseSynchronizeWorkspace('database-closed', {
      checkHealth: false,
      render: false
    });
    log('База данных закрыта.');
    renderDatabaseWorkspace();
  }

  function databaseClearIntake() {
    if (databaseWorkspaceState.busy) return;
    databasePauseQueuePreparation('queue-cleared');
    databaseWorkspaceState.queuePreparationRequested = false;
    databaseWorkspaceState.intake = [];
    databaseWorkspaceState.lastError = null;
    renderDatabaseWorkspace();
  }

  function databaseResetIntegrationState() {
    databasePauseQueuePreparation('database-session-reset');
    databaseWorkspaceState.queuePreparationRequested = false;
    for (const item of databaseWorkspaceState.intake) {
      delete item.pendingPlan;
      delete item.integrationStatus;
      delete item.integrationError;
      delete item.integrationPreview;
      delete item.integrationResult;
      delete item.synchronizationError;
      delete item.synchronizedAt;
    }
  }

