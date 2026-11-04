// FILE CONTRACT: Database Workspace route composition.
// Purpose: compose Database route sections and bind user events to narrow Database UI components.
// Owns: top-level Database route DOM composition and event wiring.
// Reads: shared state/health, intake, connection, integration, audit and renderer fragments.
// Writes: route DOM only; operations are delegated to component handlers.
// Public API: renderDatabaseWorkspace used by application routing.
// Must not: access raw SQLite handles or implement Dataset business/integration rules.
// Related tests: test_database_workspace_contract.py, smoke_app_runtime.js,
//                test_database_integration.js, test_architecture_guardrails.py.

// ============================================================================
// DATABASE ROUTE COMPOSITION AND EVENT BINDING
// ============================================================================
  function renderDatabaseWorkspace() {
    setHeader(
      'Данные',
      'База данных',
      'Создание и перенос Reclassifier.db, загрузка Excel и перерасчёт накопленных данных.'
    );

    const info = databaseCurrentInfo();
    const activeReferences = globalThis.ReclassifierDatasetDbStateModel?.datasets?.() || [];
    const busy = databaseWorkspaceState.busy;
    const fileConnection = databaseWorkspaceState.fileConnection;
    const directPickerSupported = typeof window !== 'undefined' &&
      typeof window.showOpenFilePicker === 'function';
    const hasDirectConnection = Boolean(info && fileConnection &&
      fileConnection.databaseUuid === info.databaseUuid);
    const storageGuidance = databaseStorageGuidance(
      info, fileConnection, databaseAutoSaveSession.enabled
    );
    const databaseDetails = info
      ? '<div class="info-list">' +
        '<div class="info-row"><span class="info-key">Файл</span><strong>' +
          escapeHtml(info.fileName || 'Reclassifier.db') + '</strong></div>' +
        '<div class="info-row"><span class="info-key">Доступ к исходному файлу</span><strong>' +
          escapeHtml(hasDirectConnection
            ? 'Прямая запись доступна с разрешения браузера'
            : 'Прямая запись не подключена') + '</strong></div>' +
        '<div class="info-row"><span class="info-key">Автосохранение</span><strong>' +
          (databaseAutoSaveSession.enabled ? 'Включено в этой вкладке' : 'Выключено') +
          '</strong></div>' +
        '</div>' +
        '<details style="margin-top:12px"><summary>Техническая информация: хранение и ревизии</summary>' +
        '<div class="info-list" style="margin-top:8px">' +
        '<div class="info-row"><span class="info-key">Рабочая SQLite (COMMIT)</span><strong>' +
          escapeHtml(databaseWorkingStorageText(info)) + '</strong></div>' +
        '<div class="info-row"><span class="info-key">Сохранение в исходный файл</span><strong>' +
          escapeHtml(databaseFileSaveText(info, fileConnection)) + '</strong></div>' +
        '<div class="info-row"><span class="info-key">Отдельная копия SQLite</span><strong>' +
          escapeHtml(databaseDownloadCopyText(info)) + '</strong></div>' +
        '<div class="info-row"><span class="info-key">Последнее изменение</span><strong>' +
          escapeHtml(databaseFormatTimestamp(info.updatedAt)) + '</strong></div>' +
        '<div class="info-row"><span class="info-key">Синхронизация Runtime</span><strong' +
          (databaseWorkspaceState.synchronization?.status === 'error' ? ' class="database-sync-error"' : '') +
          '>' + escapeHtml(databaseSynchronizationText()) + '</strong></div>' +
        '<div class="info-row"><span class="info-key">Версия приложения</span><strong>' +
          escapeHtml(info.lastWrittenByAppVersion || '—') + '</strong></div>' +
        '<div class="info-row"><span class="info-key">Схема БД</span><strong>' +
          escapeHtml(info.schemaVersion) + '</strong></div>' +
        '<div class="info-row"><span class="info-key">UUID</span><strong class="database-mono">' +
          escapeHtml(info.databaseUuid || '—') + '</strong></div>' +
        '<div class="info-row"><span class="info-key">SQLite</span><strong>' +
          escapeHtml(info.sqliteVersion || build.sqliteVersion || '—') + '</strong></div>' +
        '<div class="info-row"><span class="info-key">Режим хранения</span><strong>Reclassifier.db</strong></div>' +
        '</div><p class="small">Ревизии — счётчики текущей сессии, а не номера Dataset. ' +
        'COMMIT изменяет базу в браузере; запрос скачивания не подтверждает сохранение на диск. ' +
        'Только прямая запись с обратной побайтовой проверкой подтверждает сохранение исходного файла.</p></details>'
      : '<p class="small database-no-file">Подключённая SQLite отсутствует. ' +
        (build.coreBuild ? 'Откройте существующую БД.' :
          'Откройте существующую БД или создайте новую из данных HTML.') + '</p>';

    el.pageContent.innerHTML =
      '<div class="grid cols-2 database-top-grid">' +
      '<article class="card">' +
      '<h2>База данных</h2>' +
      '<div class="action-row">' +
      '<button class="button' + (storageGuidance.action === 'open' ? ' primary' : '') +
        '" id="openDatabaseButton" data-testid="database-open"' + (busy ? ' disabled' : '') +
        '>Открыть существующую БД</button>' +
      '<button class="button' + (storageGuidance.action === 'save' ? ' primary' : '') +
        '" id="saveConnectedDatabaseButton"' +
        (!info || !info.dirty || !hasDirectConnection || busy ? ' disabled' : '') +
        '>Синхронизировать подключённую БД</button>' +
      '<button class="button' + (storageGuidance.action === 'download' ? ' primary' : '') +
        '" id="exportDatabaseButton"' + (!info || busy ? ' disabled' : '') +
        '>Скачать Reclassifier.db</button>' +
      '</div>' +
      '<p class="small" id="databaseSaveProgress" role="status" aria-live="polite">' +
        escapeHtml(databaseSaveProgressText(databaseWorkspaceState.saveProgress)) + '</p>' +
      '</article>' +
      '<article class="card flat database-state-panel"><h3>Состояние базы</h3>' +
      databaseDetails +
      '<details style="margin-top:12px"' +
        (storageGuidance.action === 'check' ? ' open' : '') +
        '><summary>Дополнительные действия и проверка целостности</summary>' +
        '<p class="small">Скачивание HTML сохраняет приложение, а не текущую рабочую SQLite. ' +
        'Проверка целостности не записывает изменения в исходный файл.</p>' +
        '<div class="action-row">' +
        (directPickerSupported
          ? '<button class="button ghost" id="openDatabaseLegacyButton"' +
              (busy ? ' disabled' : '') +
              ' title="Открыть файл без права записи в исходный .db">Открыть без прямой записи</button>'
          : '') +
        '<button class="button' + (storageGuidance.action === 'check' ? ' primary' : '') +
          '" id="checkDatabaseButton"' + (!info || busy ? ' disabled' : '') +
          '>Проверить целостность</button>' +
        '<button class="button" id="downloadApplicationHtmlButton" data-testid="database-export-application"' +
          (!state.baselineReady || busy ? ' disabled' : '') +
          '>Скачать HTML</button>' +
        '</div>' +
        databaseHealthMarkup(info) +
        '<p class="small">Журнал ошибок и технических событий находится в разделе «Система → Журнал».</p>' +
        '<button class="button ghost" id="databaseOpenJournalButton"' + (busy ? ' disabled' : '') +
          '>Открыть журнал</button>' +
      '</details>' +
      '<details style="margin-top:12px"><summary>Автосохранение и восстановление после сбоя</summary>' +
        '<p class="small">Автосохранение включается только на время текущей вкладки и только для файла, открытого с правом записи. ' +
        'После изменения SQLite попытка сохранения выполняется при следующей проверке (обычно до 12 секунд при активной вкладке). ' +
        'Это не запись в момент COMMIT: при внезапном закрытии последние изменения могут пропасть. ' +
        'Если файл на диске изменён или запись не подтверждена, автосохранение отключается.</p>' +
        '<button class="button" id="databaseAutoSaveToggle"' +
          ((!info || !fileConnection || fileConnection.databaseUuid !== info.databaseUuid || busy) ? ' disabled' : '') +
          '>' + (databaseAutoSaveSession.enabled ? 'Выключить автосохранение' : 'Включить автосохранение') + '</button>' +
        '<p class="small">Состояние: ' +
          (databaseAutoSaveSession.enabled ? 'включено для текущей вкладки' : 'выключено') +
          (databaseAutoSaveSession.lastError ? ' · ' + escapeHtml(databaseAutoSaveSession.lastError) : '') + '</p>' +
        '<p class="small">Точка восстановления создаётся <strong>только по кнопке</strong> в локальном хранилище браузера. ' +
        'Нужна дополнительная квота приблизительно в размере базы. Хранилище может быть недоступно или очищено браузером. ' +
        'Восстановление не меняет исходный файл: после него скачайте отдельную SQLite.</p>' +
        '<div class="action-row">' +
          '<button class="button" id="databaseCreateRecovery"' + (!info || busy ? ' disabled' : '') +
            '>Создать точку восстановления</button>' +
          '<button class="button" id="databaseInspectRecovery"' + (busy ? ' disabled' : '') +
            '>Проверить точку и квоту</button>' +
          '<button class="button" id="databaseRestoreRecovery"' + (busy ? ' disabled' : '') +
            '>Восстановить точку</button>' +
          '<button class="button ghost" id="databaseDeleteRecovery"' + (busy ? ' disabled' : '') +
            '>Удалить точку</button>' +
        '</div>' +
        '<p class="small" role="status">' +
          escapeHtml(databaseWorkspaceState.recoveryStatus || 'Точка восстановления в этой вкладке ещё не проверялась.') +
        '</p>' +
      '</details>' +
      '<details style="margin-top:12px"><summary>Создать новую БД из стартовых данных HTML (дополнительно)</summary>' +
        '<p class="small">Не обновляет открытый файл. Создаёт отдельную новую SQLite из стартовых Dataset. ' +
        'В пустом CORE исходных наборов нет.</p>' +
        '<button class="button" id="createDatabaseButton" data-testid="database-create-from-html"' +
          (busy || build.coreBuild ? ' disabled' : '') + '>Развернуть БД из HTML</button>' +
      '</details>' +
      databaseBootstrapMarkup() +
      (databaseWorkspaceState.lastError
        ? '<div class="validation-block invalid" style="margin-top:14px"><strong>Последняя ошибка</strong><p>' +
          escapeHtml(databaseWorkspaceState.lastError) + '</p></div>'
        : '') +
      '</article>' +
      '</div>' +

      '<article class="card" style="margin-top:18px">' +
      '<div class="database-section-head"><div><h2>Загрузить Excel</h2>' +
      '<p>Добавьте один или несколько Excel-файлов. После распознавания каждый файл автоматически обрабатывается в фоне и сравнивается с текущей БД. Когда кандидат рассчитан, появляется кнопка «Подтвердить»; только она транзакционно изменяет Dataset.</p></div></div>' +
      '<div class="dropzone database-dropzone" id="databaseExcelDropzone">' +
      '<div><div class="dropzone-title">' + (busy ? 'Чтение Excel…' : 'Перетащите Excel сюда') + '</div>' +
      '<div class="dropzone-text">.xlsx, .xlsm, .xls · можно несколько файлов</div>' +
      '<button class="button" id="selectDatabaseExcelButton"' + (busy ? ' disabled' : '') + '>Выбрать Excel</button></div>' +
      '</div>' +
      '<div class="database-queue-title"><div><h3>Очередь</h3>' +
        '<p class="small">Один файл — одна строка. Кандидаты рассчитываются автоматически по очереди; по мере готовности появляются точные значения «до / вход / изменения / после».</p>' +
        '<details class="database-queue-technical"><summary>Технические режимы</summary>' +
          'ITSM/МБ: UPSERT. Справочники: REPLACE. Фоновая подготовка только читает и сравнивает данные. «Подтвердить» транзакционно в SQLite применяет уже рассчитанный кандидат.</details></div>' +
        '<button class="button ghost" id="clearDatabaseIntakeButton"' +
          (!databaseWorkspaceState.intake.length || busy ? ' disabled' : '') + '>Очистить очередь</button></div>' +
      databaseRenderIntakeCards() +
      '</article>' +

      databaseRecalculationMarkup() +

      ('<article class="card" style="margin-top:18px">' +
          '<h2>Синхронизация и переносимый HTML</h2>' +
          '<p>При подключённой SQLite именно она является источником данных. «Обновить Runtime» проверяет синхронизацию и сбрасывает устаревшие кеши без создания тяжёлой копии всех Dataset в памяти. Для переносимой автономной копии используйте «Сохранить HTML с данными».</p>' +
          '<p class="small">Применённых обновлений: ' +
            datasetStore.list().filter(item => item.active &&
              item.id !== 'combined' && item.active.meta?.sourceType !== 'embedded').length +
            '. Версия приложения: ' + escapeHtml(build.version || 'dev') + '.</p>' +
          '<button class="button" id="syncSqliteHtmlButton"' +
            (!info || busy ? ' disabled' : '') + '>Обновить Runtime из SQLite</button> ' +
          '<button class="button primary" id="downloadUpdatedHtmlButton" data-testid="database-export-html-snapshot"' +
            (state.baselineReady && !databaseWorkspaceState.busy ? '' : ' disabled') +
            '>Сохранить HTML с данными</button> ' +
          '</article>') +

      '<article class="card" style="margin-top:18px">' +
      '<h2>Действующие справочники</h2>' +
      '<p>Одна строка показывает состояние рабочего Dataset сразу в трёх слоях: стартовом HTML, подключённой SQLite и active Runtime. Зелёная метка означает наличие источника, бледно-красная — отсутствие.</p>' +
      '<div class="table-scroll"><table class="reference-table database-active-table">' +
      '<thead><tr><th>Справочник</th><th>Режим</th><th>Активно</th><th>Свежесть</th><th>Последняя попытка</th></tr></thead>' +
      '<tbody>' + databaseRenderActiveReferenceRows(activeReferences) + '</tbody></table></div>' +
      '</article>' +

      renderReferenceDirectoryProbe();

    document.getElementById('databaseOpenJournalButton')?.addEventListener('click', () => navigate('log'));
    databaseMemoryDiagnostics.status();
    document.getElementById('testDirectoryHandleButton')?.addEventListener('click', () => {
      void probeDirectoryHandle();
    });
    document.getElementById('testWebkitDirectoryButton')?.addEventListener('click', () => {
      probeWebkitDirectory();
    });
    document.getElementById('downloadApplicationHtmlButton')?.addEventListener('click', event => {
      const button = event.currentTarget;
      if (!state.baselineReady || databaseWorkspaceState.busy) return;
      button.disabled = true;
      button.textContent = 'Подготовка HTML…';
      try {
        const result = downloadApplicationHtml();
        log('Сохранена копия HTML приложения: ' + result.fileName + '.', 'INFO', 'import_export');
      } catch (error) {
        log('Не удалось скачать HTML приложения: ' + (error.message || String(error)), 'ERROR', 'import_export');
        alert('Не удалось скачать HTML приложения: ' + (error.message || String(error)));
      } finally {
        button.disabled = !state.baselineReady || databaseWorkspaceState.busy;
        button.textContent = 'Скачать HTML';
      }
    });
    document.getElementById('syncSqliteHtmlButton')?.addEventListener('click', async event => {
      const button=event.currentTarget;
      if (!globalThis.ReclassifierRuntimeDataRepository?.isSqliteAuthoritative?.() ||
          databaseWorkspaceState.busy) return;
      button.disabled=true;
      button.textContent='Обновление Runtime…';
      try {
        // Do not buildDatasetPack/prepareDatasetPackRestore/replaceSqliteMirror
        // during ordinary sync. Those copy every large SQLite Dataset back into
        // dormant HTML storage and can exhaust Opera before the next Excel.
        globalThis.ReclassifierDatabaseMemoryDiagnostics?.mark?.(
          'manual-runtime-refresh','start');
        const result=databaseSynchronizeWorkspace('manual', {
          checkHealth:true, render:true, refreshDerived:false
        });
        globalThis.ReclassifierDatabaseMemoryDiagnostics?.mark?.(
          'manual-runtime-refresh',result.ok ? 'end' : 'error',
          { derivedRebuilt:databaseWorkspaceState.synchronization?.derivedRebuilt || 0 }
        );
        if (!result.ok) throw new Error(result.error || 'Runtime не синхронизирован.');
        alert('Runtime обновлён из SQLite без копирования Dataset в HTML. ' +
          'Для автономного HTML используйте «Сохранить HTML с данными».');
      } catch(error) {
        log('Ошибка синхронизации HTML: '+(error.message||String(error)), 'ERROR', 'import_export');
        alert('Синхронизация не завершена: '+(error.message||String(error)));
      } finally {
        button.disabled = !globalThis.ReclassifierRuntimeDataRepository?.isSqliteAuthoritative?.() ||
          databaseWorkspaceState.busy;
        button.textContent='Обновить Runtime из SQLite';
      }
    });
    document.getElementById('downloadUpdatedHtmlButton')?.addEventListener('click', async event => {
      const button = event.currentTarget;
      button.disabled = true;
      button.textContent = 'Подготовка HTML…';
      try {
        const result = await downloadUpdatedHtml();
        log('Подготовлен к скачиванию HTML с данными: ' + result.fileName + '; Dataset ' + result.count + '.', 'INFO', 'import_export');
        alert('Скачан «' + result.fileName + '»: ' + result.count +
          ' применённых наборов, ' + formatBytes(result.bytes) + '.');
      } catch (error) {
        log('Не удалось сохранить HTML: ' + (error.message || String(error)), 'ERROR', 'import_export');
        alert('Не удалось сохранить HTML: ' + (error.message || String(error)));
      } finally {
        button.disabled = !state.baselineReady || databaseWorkspaceState.busy;
        button.textContent = 'Сохранить HTML с данными';
      }
    });
    document.getElementById('createDatabaseButton')?.addEventListener('click', () => void databaseCreateNew());
    document.getElementById('openDatabaseButton')?.addEventListener('click', databaseChooseFile);
    document.getElementById('openDatabaseLegacyButton')?.addEventListener('click', () => {
      if (!databaseWorkspaceState.busy && databaseConfirmReplaceCurrent()) databaseChooseFileLegacy();
    });
    document.getElementById('saveConnectedDatabaseButton')?.addEventListener('click', () =>
      void databaseSaveConnected());
    document.getElementById('databaseAutoSaveToggle')?.addEventListener('click',
      () => void databaseToggleAutoSave());
    document.getElementById('databaseCreateRecovery')?.addEventListener('click',
      () => void databaseCreateRecovery());
    document.getElementById('databaseInspectRecovery')?.addEventListener('click',
      () => void databaseInspectRecovery());
    document.getElementById('databaseRestoreRecovery')?.addEventListener('click',
      () => void databaseRestoreRecovery());
    document.getElementById('databaseDeleteRecovery')?.addEventListener('click',
      () => void databaseDeleteRecovery());
    document.getElementById('checkDatabaseButton')?.addEventListener('click', () => databaseRunHealthCheck());
    document.getElementById('exportDatabaseButton')?.addEventListener('click', databaseExportCurrent);
    document.getElementById('clearDatabaseIntakeButton')?.addEventListener('click', databaseClearIntake);
    databaseBindRecalculation();
    document.querySelectorAll('.database-remove-intake-button').forEach(button => {
      button.addEventListener('click', () => {
        const index = Number(button.dataset.integrationIndex);
        if (Number.isInteger(index)) databaseRemoveIntakeItem(index);
      });
    });
    document.querySelectorAll('.database-confirm-integration-button').forEach(button => {
      button.addEventListener('click', () => {
        const index = Number(button.dataset.integrationIndex);
        if (Number.isInteger(index)) void databaseCommitIntegration(index);
      });
    });
    document.querySelectorAll('.database-cancel-integration-button').forEach(button => {
      button.addEventListener('click', () => {
        const index = Number(button.dataset.integrationIndex);
        if (Number.isInteger(index)) databaseCancelIntegration(index);
      });
    });
    document.querySelectorAll('.database-abort-integration-button').forEach(button => {
      button.addEventListener('click', () => {
        const index = Number(button.dataset.integrationIndex);
        if (Number.isInteger(index)) databaseAbortCommit(index);
      });
    });
    bindDatasetDropzone(
      'databaseExcelDropzone',
      'selectDatabaseExcelButton',
      files => databaseAcceptExcelFiles(files),
      () => { if (state.route === 'database') renderDatabaseWorkspace(); },
      true
    );
  }
