// FILE CONTRACT: shared Reference UI helpers.
// Purpose: render status/history/source metadata and bind the Reference file dropzone.
// Owns: small reusable Reference presentation helpers shared by route/detail components.
// Reads: Reference Manager status helpers, Dataset Lifecycle history and common UI utilities.
// Writes: DOM bindings only; does not parse workbooks or mutate Dataset state.
// Public API: internal assembled-script functions used by Reference UI fragments.
// Must not: own directory scanning, Dataset previews or route composition.
// Related tests: test_reference_architecture.py, test_database_workspace_contract.py,
//                smoke_app_runtime.js, test_architecture_guardrails.py.

// ============================================================================
// STATUS, HISTORY AND SOURCE PRESENTATION
// ============================================================================
  function referenceStatusMarkup(instance) {
    const status = instance?.validation?.status;
    const warning = status === 'warning';
    return '<span class="status-badge ' + referenceStatusClass(instance) + '">' +
      escapeHtml(referenceStatusText(instance)) +
      (warning ? '<span class="status-warning-icon" title="Есть предупреждения">!</span>' : '') +
      '</span>';
  }

  function currentReferenceSourceText(instance) {
    if (!instance) return 'Справочник ещё не загружен';
    if (instance.meta?.sourceType === 'sqlite') return 'Источник: Reclassifier.db';
    if (instance.meta?.sourceType === 'snapshot') return 'Источник: HTML-снимок';
    if (instance.meta?.sourceType === 'embedded') return 'Источник: встроенные данные';
    if (instance.meta?.sourceType === 'generated') return instance.id === 'itsm_data'
      ? 'Источник: модуль «ITSM»'
      : 'Источник: модуль «Мобильные бригады»';
    return 'Источник: загруженный Excel';
  }

  function renderReferenceHistory(referenceId) {
    const entries = globalThis.ReclassifierDatasetLifecycleManager?.history(referenceId) || [];
    if (!entries.length) {
      return '<div class="reference-history-empty">История появится после первой загрузки или замены файла в этом запуске.</div>';
    }

    return '<div class="reference-history">' + entries.map(entry => {
      const statusClass = entry.validationStatus === 'valid' ? 'loaded' : (entry.validationStatus || '');
      const statusText = entry.validationStatus === 'invalid'
        ? 'Требует внимания'
        : entry.validationStatus === 'warning'
          ? 'Готов с предупреждениями'
          : 'Готов';
      const warningIcon = entry.validationStatus === 'warning'
        ? '<span class="status-warning-icon" title="Есть предупреждения">!</span>'
        : '';
      const actionText = entry.sourceType === 'generated'
        ? 'Набор данных сформирован'
        : (entry.action === 'updated' ? 'Набор обновлён' : 'Файл загружен');
      const at = entry.at ? new Date(entry.at).toLocaleString('ru-RU') : '—';

      return '<div class="reference-history-item">' +
        '<div class="reference-history-marker"></div>' +
        '<div class="reference-history-body">' +
        '<div class="reference-history-head"><strong>' + escapeHtml(actionText) + '</strong>' +
        '<span class="status-badge ' + statusClass + '">' + escapeHtml(statusText) + warningIcon + '</span></div>' +
        '<div class="reference-history-file">' + escapeHtml(entry.fileName) + '</div>' +
        '<div class="small">' + escapeHtml(at) + (Number.isFinite(entry.fileSize) ? ' · ' + escapeHtml(formatBytes(entry.fileSize)) : '') + '</div>' +
        '</div></div>';
    }).join('') + '</div>';
  }

// ============================================================================
// FILE SELECTION / DROPZONE BINDING
// ============================================================================
  function bindReferenceDropzone(referenceId) {
    bindDatasetDropzone('referenceDropzone', 'selectReferenceFileButton',
      file => loadReferenceFile(referenceId, file), () => {
        if (state.route === 'references' && state.activeReferenceId === referenceId) renderReferenceDetail(referenceId);
      });
  }

