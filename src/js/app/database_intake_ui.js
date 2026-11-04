// FILE CONTRACT: Database Excel intake UI.
// Purpose: classify queued Excel files, validate readiness and hand ready items to background candidate preparation.
// Owns: recognition/readiness presentation and file intake inspection state.
// Reads: Dataset Recognizer, Database Contract and shared Database workspace state.
// Writes: intake UI state only; does not mutate SQLite.
// Public API: databaseAcceptExcelFiles, databaseRemoveIntakeItem plus intake classification helpers.
// Must not: execute integration commits or access raw SQLite.
// Related tests: test_reference_architecture.py, test_database_workspace_contract.py,
//                smoke_app_runtime.js, test_architecture_guardrails.py.

// ============================================================================
// INTAKE CLASSIFICATION AND VALIDATION PRESENTATION
// ============================================================================
  function databaseQueueDatasetId(classification) {
    if (globalThis.ReclassifierDatasetRecognizer?.datasetId) {
      return globalThis.ReclassifierDatasetRecognizer.datasetId(classification);
    }
    const id = classification?.id || 'unknown';
    if (id === 'itsm') return 'itsm_data';
    if (id === 'mobile_brigade') return 'mobile_brigade_data';
    if (id === 'failure_classifier') return 'failure_classifier';
    if (id.startsWith('equipment:')) return id.slice('equipment:'.length);
    if (globalThis.ReclassifierDatabaseContract?.datasets?.[id]) return id;
    return null;
  }

  function databaseQueueStrategy(classification) {
    const datasetId = databaseQueueDatasetId(classification);
    return datasetId
      ? globalThis.ReclassifierDatabaseContract?.datasets?.[datasetId]?.strategy || '—'
      : '—';
  }

  function databaseRecognitionBadge(inspection) {
    if (!inspection || inspection.confidence <= 0) {
      return '<span class="status-badge warning">Не распознано</span>';
    }
    const badgeClass = inspection.confidence >= 95 ? 'loaded' : 'warning';
    return '<span class="status-badge ' + badgeClass + '">' +
      escapeHtml(inspection.confidence + '% · ' + inspection.confidenceLabel) +
      '</span>';
  }

  function databaseReadinessBadge(inspection) {
    if (!inspection) return '<span class="status-badge warning">Не готов</span>';
    if (!inspection.ready) return '<span class="status-badge warning">Требует исправления</span>';
    if (inspection.validation?.status === 'warning') {
      return '<span class="status-badge warning">Можно применить с предупреждениями</span>';
    }
    return '<span class="status-badge loaded">Готов к применению</span>';
  }

  function databaseFreshnessInspectionLabel(inspection) {
    const freshness = inspection?.freshness || {};
    if (freshness.source === 'not-applicable') return 'Не применяется';
    const from = freshness.from || null;
    const to = freshness.to || null;
    if (!from && !to) return 'Не определена';
    const range = from && to && from !== to ? from + ' → ' + to : (to || from);
    const sourceLabel = freshness.source === 'content'
      ? 'из содержимого'
      : freshness.source === 'filename-contract'
        ? 'из имени файла'
        : freshness.source;
    return range + (sourceLabel ? ' · ' + sourceLabel : '');
  }

  function databaseValidationMarkup(inspection) {
    const validation = inspection?.validation || {};
    const errors = Array.from(validation.errors || []);
    const warnings = Array.from(validation.warnings || []);
    if (!errors.length && !warnings.length) {
      return '<div class="database-validation-ok">Структура и данные прошли проверку.</div>';
    }
    let html = '';
    if (errors.length) {
      html += '<div class="database-validation-list invalid"><strong>Ошибки</strong><ul>' +
        errors.map(item => '<li>' + escapeHtml(item) + '</li>').join('') + '</ul></div>';
    }
    if (warnings.length) {
      html += '<div class="database-validation-list warning"><strong>Предупреждения</strong><ul>' +
        warnings.map(item => '<li>' + escapeHtml(item) + '</li>').join('') + '</ul></div>';
    }
    return html;
  }

  function databaseQueueKey(file) {
    return [
      String(file?.name || ''),
      Number(file?.size || 0),
      Number(file?.lastModified || 0)
    ].join('|');
  }

// ============================================================================
// FILE INTAKE / QUEUE MANAGEMENT
// ============================================================================
  async function databaseAcceptExcelFiles(files) {
    if (databaseWorkspaceState.busy) {
      throw new Error('Дождитесь завершения текущей операции с базой данных.');
    }
    // Do not parse another 70k-row XLSX on the main thread while the existing
    // candidate is still being built by the Worker: Opera may exceed its
    // process memory limit even before a second candidate reaches its Worker.
    if (databaseWorkspaceState.queuePreparationRunning &&
        databaseWorkspaceState.queuePreparationCurrentIndex !== null) {
      throw new Error('Подготовка предыдущего Excel ещё выполняется. Новый файл можно добавить после завершения этой операции.');
    }
    const selected = Array.from(files || []);
    if (!selected.length) return;
    if (selected.some(file => !/\.(xlsx|xlsm|xls)$/i.test(file.name || ''))) {
      throw new Error('Поддерживаются только Excel-файлы .xlsx, .xlsm и .xls.');
    }

    databaseMemoryDiagnostics.begin(selected.length);
    databaseMemoryDiagnostics.mark('intake','start',{fileCount:selected.length});
    databaseWorkspaceState.busy = true;
    databaseWorkspaceState.lastError = null;
    if (state.route === 'database') renderDatabaseWorkspace();

    try {
      const byKey = new Map(databaseWorkspaceState.intake.map(item => [item.key, item]));
      for (const [fileIndex, file] of selected.entries()) {
        const key = databaseQueueKey(file);
        databaseMemoryDiagnostics.mark('initial-inspection','start',
          {fileIndex:fileIndex+1,inputBytes:file.size});
        let inspection;
        try {
          inspection = globalThis.ReclassifierDatasetRecognizer?.inspectFile
            ? await globalThis.ReclassifierDatasetRecognizer.inspectFile(file)
            : null;
        } catch (error) {
          inspection = {
            classification: {
              id: 'read_error',
              group: 'Ошибка чтения',
              label: 'Ошибка чтения',
              reason: error?.message || String(error)
            },
            datasetId: null,
            datasetTitle: 'Ошибка чтения',
            datasetSchemaVersion: null,
            strategy: null,
            confidence: 0,
            confidenceLabel: 'Нет',
            sheetName: null,
            headerRow: null,
            sourceRows: null,
            normalizedRows: null,
            freshness: { from: null, to: null, source: 'none', field: null },
            validation: {
              status: 'invalid',
              errors: [error?.message || String(error)],
              warnings: []
            },
            ready: false,
            readyLabel: 'Не готов к интеграции',
            details: {}
          };
        }

        databaseMemoryDiagnostics.mark('initial-inspection',
          inspection?.classification?.id === 'read_error' ? 'error' : 'end',
          {fileIndex:fileIndex+1,rows:inspection?.sourceRows||0,
            ready:inspection?.ready?1:0});
        const classification = inspection?.classification || {
          id: 'unknown',
          group: 'Не распознано',
          label: 'Не распознано',
          reason: 'Dataset Recognizer недоступен'
        };
        byKey.set(key, {
          key,
          file,
          name: file.name,
          size: file.size,
          lastModified: file.lastModified,
          classification,
          inspection,
          // Exact File instance that already passed the expensive XLSX validation.
          // A Blob/File is immutable; reusing its inspection avoids a second
          // full parse when the automatic candidate queue starts.
          inspectedFile: inspection?.ready ? file : null
        });
      }
      databaseWorkspaceState.intake = Array.from(byKey.values());
      databaseMemoryDiagnostics.mark('intake','end',{fileCount:selected.length,
        rows:databaseWorkspaceState.intake.length});
      log('Приёмник БД: добавлено Excel-файлов ' + selected.length +
        '; в очереди ' + databaseWorkspaceState.intake.length + '.', 'INFO', 'import_export');
    } catch (error) {
      databaseMemoryDiagnostics.mark('intake','error');
      databaseMemoryDiagnostics.finish('failed');
      databaseWorkspaceState.lastError = error?.message || String(error);
      log('Приёмник БД: ' + databaseWorkspaceState.lastError, 'ERROR', 'import_export');
      throw error;
    } finally {
      databaseWorkspaceState.busy = false;
      if (state.route === 'database') renderDatabaseWorkspace();
      databaseRequestQueuePreparation('files-added');
    }
  }

  // A successful COMMIT has persisted its result in SQLite/import_history.
  // Keeping a committed File/inspectedFile and old candidate in the intake
  // queue serves no further purpose and extends the life of large allocations.
  // Retain a small result row only when Runtime synchronization has failed,
  // so the warning remains visible and can be investigated.
  function databaseReleaseCommittedQueueItems(items) {
    const releasable = new Set();
    for (const item of items || []) {
      if (!item || item.integrationStatus !== 'committed') continue;
      delete item.pendingPlan;
      delete item.file;
      delete item.inspectedFile;
      if (!item.synchronizationError) releasable.add(item);
    }
    if (!releasable.size) return 0;
    databaseWorkspaceState.intake = databaseWorkspaceState.intake.filter(
      item => !releasable.has(item)
    );
    globalThis.ReclassifierDatabaseMemoryDiagnostics?.mark?.(
      'committed-queue-release','end',
      { released:releasable.size,queueRows:databaseWorkspaceState.intake.length }
    );
    return releasable.size;
  }

  function databaseRemoveIntakeItem(index) {
    if (databaseWorkspaceState.busy || !Number.isInteger(index)) return;
    if (index < 0 || index >= databaseWorkspaceState.intake.length) return;
    databasePauseQueuePreparation('queue-item-removed');
    const [removed] = databaseWorkspaceState.intake.splice(index, 1);
    databaseWorkspaceState.lastError = null;
    log('Убран из очереди: ' + (removed?.name || 'Excel') + '.', 'INFO', 'import_export');
    databaseRequestQueuePreparation('queue-item-removed');
    if (state.route === 'database') renderDatabaseWorkspace();
  }

  function databaseConfirmReplaceCurrent() {
    const info = databaseCurrentInfo();
    if (!info) return true;
    const dirtyWarning = info.dirty
      ? ' В текущей базе есть изменения, которые ещё не были выгружены.'
      : '';
    return confirm(
      'Текущая база «' + (info.fileName || 'Reclassifier.db') +
      '» будет закрыта.' + dirtyWarning + ' Продолжить?'
    );
  }

