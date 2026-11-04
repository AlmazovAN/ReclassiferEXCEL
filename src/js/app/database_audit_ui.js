// FILE CONTRACT: Database import audit view model.
// Purpose: derive read-only audit/history summaries and filter state for Database presentation.
// Owns: import-history status formatting, diff summaries and audit snapshot/filter logic.
// Reads: repository history/overview rows and shared Database workspace state.
// Writes: HTML strings/view models only.
// Public API: internal audit helpers used by Database renderers.
// Must not: mutate Dataset state or execute database operations.
// Related tests: test_reference_architecture.py, test_database_workspace_contract.py,
//                smoke_app_runtime.js, test_architecture_guardrails.py.

// ============================================================================
// AUDIT / HISTORY VIEW MODEL
// ============================================================================
  function databaseAuditSnapshot(datasets, overview) {
    const integratedDatasets = datasets.filter(row => Number(row.active_revision || 0) > 0);
    const totalRecords = integratedDatasets.reduce(
      (sum, row) => sum + Number(row.record_count || 0),
      0
    );
    return {
      integratedDatasets,
      totalRecords,
      attempts: Number(overview?.attempts || 0),
      committedCount: Number(overview?.committed || 0),
      failedCount: Number(overview?.failed || 0),
      latestAttempt: overview?.latestAttempt || null,
      latestCommittedAt: overview?.latestCommittedAt || null,
      latestFailedAt: overview?.latestFailedAt || null,
      latestAttemptByDataset: new Map(
        Array.from(overview?.latestAttemptByDataset || []).map(row => [row.dataset_id, row])
      ),
      latestCommittedByDataset: new Map(
        Array.from(overview?.latestCommittedByDataset || []).map(row => [row.dataset_id, row])
      )
    };
  }

  function databaseAuditSummaryMarkup(snapshot, datasets) {
    if (!datasets.length) {
      return '<div class="database-audit-empty">Подключите Reclassifier.db, чтобы увидеть контроль интеграций.</div>';
    }
    const lastSuccess = databaseFormatTimestamp(snapshot.latestCommittedAt);
    const lastFailure = databaseFormatTimestamp(snapshot.latestFailedAt);

    return '<div class="database-audit-summary">' +
      '<div><span>Интегрировано Dataset</span><strong>' +
        escapeHtml(snapshot.integratedDatasets.length + ' / ' + datasets.filter(row => Number(row.persisted || 0) === 1).length) +
      '</strong></div>' +
      '<div><span>Строк в активных Dataset</span><strong>' + escapeHtml(snapshot.totalRecords) + '</strong></div>' +
      '<div><span>Успешных импортов</span><strong>' + escapeHtml(snapshot.committedCount) + '</strong></div>' +
      '<div><span>Ошибок / rollback</span><strong>' + escapeHtml(snapshot.failedCount) + '</strong></div>' +
      '<div><span>Последний успешный импорт</span><strong>' + escapeHtml(lastSuccess) + '</strong></div>' +
      '<div><span>Последняя ошибка</span><strong>' + escapeHtml(lastFailure) + '</strong></div>' +
    '</div>';
  }

  function databaseAuditDatasetOptions(datasets) {
    const selected = databaseWorkspaceState.auditDatasetId;
    return '<option value="all"' + (selected === 'all' ? ' selected' : '') + '>Все Dataset</option>' +
      datasets
        .filter(row => Number(row.persisted || 0) === 1)
        .map(row =>
          '<option value="' + escapeHtml(row.dataset_id) + '"' +
            (selected === row.dataset_id ? ' selected' : '') + '>' +
            escapeHtml(row.title || row.dataset_id) +
          '</option>'
        ).join('');
  }

  function databaseAuditFilteredHistory(history) {
    const datasetId = databaseWorkspaceState.auditDatasetId;
    const status = databaseWorkspaceState.auditStatus;
    const limit = Number(databaseWorkspaceState.auditLimit) || 50;

    return history
      .filter(row => datasetId === 'all' || row.dataset_id === datasetId)
      .filter(row => status === 'all' || row.status === status)
      .slice(0, limit);
  }

  // Read-only integration preview and history presentation.
  function databaseIntegrationFieldDiffMarkup(preview) {
    if (!preview || preview.datasetId !== 'itsm_data') return '';
    const diff = preview.fieldDiff;
    if (!diff) {
      return (preview.fieldDiffUnavailable
        ? '<p class="small">' + escapeHtml(preview.fieldDiffUnavailable) + '</p>'
        : '');
    }
    if (!diff.columns.length && !diff.formatOnlyRows) {
      return '<p class="small">Ни одно поле существующих строк не отличается.</p>';
    }
    return '<details class="database-field-diff">' +
      '<summary>Какие поля изменились (' + escapeHtml(diff.columns.length) + ')</summary>' +
      '<p class="small">Изменились исходные поля: ' +
        escapeHtml(diff.sourceChangedRows.toLocaleString('ru-RU')) +
        ' заявок; расчётные поля: ' +
        escapeHtml(diff.derivedChangedRows.toLocaleString('ru-RU')) +
        ' заявок. Категории могут пересекаться, значения и номера заявок не отображаются.</p>' +
      '<div class="table-scroll"><table class="reference-table">' +
      '<thead><tr><th>Поле</th><th>Тип</th><th>Изменившихся заявок</th></tr></thead><tbody>' +
      diff.columns.map(row => '<tr><td>' + escapeHtml(row.label) + '</td>' +
        '<td>' + (row.scope === 'source' ? 'Исходное' : 'Расчётное') + '</td>' +
        '<td>' + escapeHtml(Number(row.count).toLocaleString('ru-RU')) + '</td></tr>').join('') +
      '</tbody></table></div>' +
      (diff.formatOnlyRows
        ? '<p class="small">Различия формата JSON или структуры: ' +
            escapeHtml(diff.formatOnlyRows.toLocaleString('ru-RU')) + '.</p>'
        : '') +
      '</details>';
  }

  function databaseHistoryStatusBadge(status) {
    const value = String(status || '—').toUpperCase();
    if (value === 'COMMITTED') {
      return '<span class="status-badge loaded">COMMITTED</span>';
    }
    if (value === 'FAILED' || value === 'ROLLED_BACK') {
      return '<span class="status-badge warning">' + escapeHtml(value) + '</span>';
    }
    return '<span class="status-badge">' + escapeHtml(value) + '</span>';
  }

  function databaseHistoryDiffText(row) {
    if (!row) return '—';
    const before = row.rows_before ?? '—';
    const incoming = row.rows_incoming ?? '—';
    const inserted = row.rows_inserted ?? 0;
    const updated = row.rows_updated ?? 0;
    const unchanged = row.rows_unchanged ?? 0;
    const deleted = row.rows_deleted ?? 0;
    const after = row.rows_after ?? '—';
    return 'до ' + before +
      ' · вход ' + incoming +
      ' · +' + inserted +
      ' · ~' + updated +
      ' · =' + unchanged +
      ' · −' + deleted +
      ' · после ' + after;
  }

  function databaseHistoryDetails(row) {
    let details = null;
    if (row?.details_json) {
      try {
        details = JSON.parse(row.details_json);
      } catch (_) {
        details = { raw: String(row.details_json) };
      }
    }
    if (!row?.message && !details) return '<span class="small">—</span>';

    let content = '';
    if (row?.message) {
      content += '<div class="database-audit-message">' + escapeHtml(row.message) + '</div>';
    }
    if (details && Object.keys(details).length) {
      content += '<pre class="database-audit-json">' +
        escapeHtml(JSON.stringify(details, null, 2)) +
        '</pre>';
    }
    return '<details class="database-audit-details"><summary>Детали</summary>' + content + '</details>';
  }
