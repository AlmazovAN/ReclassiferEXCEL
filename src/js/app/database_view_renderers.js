// FILE CONTRACT: Database workspace table/card renderers.
// Purpose: render active Dataset/reference rows, import history rows and the compact Excel intake queue.
// Owns: read-only table/queue markup for Database Workspace.
// Reads: intake inspections, audit view model and shared Database UI helpers.
// Writes: HTML strings only.
// Public API: databaseRenderHistoryRows, databaseRenderActiveReferenceRows, databaseRenderIntakeCards.
// Must not: mutate workspace state, commit integration or access persistence directly.
// Related tests: test_reference_architecture.py, test_database_workspace_contract.py,
//                smoke_app_runtime.js, test_architecture_guardrails.py.

// ============================================================================
// TABLE/CARD RENDERERS
// ============================================================================
  function databaseRenderHistoryRows(history, datasetById) {
    const filtered = databaseAuditFilteredHistory(history);
    if (!filtered.length) {
      return '<tr><td colspan="8"><span class="small">История по выбранному фильтру пуста.</span></td></tr>';
    }

    return filtered.map(row => {
      const dataset = datasetById.get(row.dataset_id);
      const finishedAt = row.finished_at || row.started_at;
      const versionText = 'App ' + (row.app_version || '—') +
        ' · DB ' + (row.db_schema_version ?? '—') +
        ' · Dataset ' + (row.dataset_schema_version || '—');

      return '<tr>' +
        '<td>' + escapeHtml(databaseFormatTimestamp(finishedAt)) + '</td>' +
        '<td><strong>' + escapeHtml(dataset?.title || row.dataset_id || '—') + '</strong>' +
          '<div class="small"><code>' + escapeHtml(row.dataset_id || '—') + '</code></div></td>' +
        '<td>' + databaseHistoryStatusBadge(row.status) + '</td>' +
        '<td><strong>' + escapeHtml(row.source_file_name || '—') + '</strong>' +
          '<div class="small">' + escapeHtml(row.integration_strategy || '—') + '</div></td>' +
        '<td class="database-audit-diff">' + escapeHtml(databaseHistoryDiffText(row)) + '</td>' +
        '<td>' + escapeHtml(row.rows_after ?? '—') + '</td>' +
        '<td><span class="small">' + escapeHtml(versionText) + '</span></td>' +
        '<td>' + databaseHistoryDetails(row) + '</td>' +
      '</tr>';
    }).join('');
  }

  function databaseActiveSourceBadge(label, present, title = '') {
    return '<span class="database-source-badge ' + (present ? 'present' : 'absent') + '"' +
      (title ? ' title="' + escapeHtml(title) + '"' : '') + '>' +
      escapeHtml(label) + '</span>';
  }

  function databaseActiveFreshnessMarkup(row) {
    const from = row?.freshnessFrom || null;
    const to = row?.freshnessTo || null;
    if (!from && !to) return '<span class="database-active-muted">—</span>';
    if (from && to && from !== to) {
      return '<span class="database-active-freshness-from">' + escapeHtml(from) + '</span>' +
        '<span class="database-active-freshness-arrow">→</span>' +
        '<strong>' + escapeHtml(to) + '</strong>';
    }
    return '<strong>' + escapeHtml(to || from) + '</strong>';
  }

  function databaseActiveAttemptMarkup(attempt) {
    if (!attempt) {
      return '<span class="database-active-muted">—</span>';
    }
    return databaseHistoryStatusBadge(attempt.status) +
      '<div class="database-active-attempt-time">' +
        escapeHtml(databaseFormatTimestamp(attempt.timestamp)) +
      '</div>';
  }

  function databaseDependencyMarkup(dependency) {
    if (!dependency) return '';
    if (dependency.status === 'current') {
      return '<div class="small"><span class="status-badge loaded">зависимости актуальны</span></div>';
    }
    const affected = Array.from(dependency.mismatches || []).join(', ');
    const label = dependency.status === 'untracked'
      ? 'зависимости не зафиксированы'
      : 'требуется пересчёт';
    const title = affected ? ' title="' + escapeHtml('Изменились: ' + affected) + '"' : '';
    return '<div class="small"><span class="status-badge warning"' + title + '>' +
      escapeHtml(label) + '</span></div>';
  }

  function databaseRenderActiveReferenceRows(rows) {
    if (!rows.length) {
      return '<tr><td colspan="5"><span class="small">Действующие справочники пока недоступны.</span></td></tr>';
    }

    return rows.map(row => {
      const schemaMismatch = row.schemaDb && row.schemaApp && row.schemaDb !== row.schemaApp;
      const runtimeTitle = row.active?.runtimeSource
        ? 'Источник Runtime: ' + row.active.runtimeSource
        : '';
      const sourceFile = row.sourceFileName || 'Источник не определён';

      return '<tr>' +
        '<td class="database-active-reference">' +
          '<strong>' + escapeHtml(row.title || row.id) + '</strong>' +
          '<div><code>' + escapeHtml(row.id) + '</code></div>' +
          '<div class="database-active-file">' + escapeHtml(sourceFile) + '</div>' +
        '</td>' +
        '<td class="database-active-mode">' +
          '<span class="status-badge">' + escapeHtml(row.mode || '—') + '</span>' +
          '<div class="database-schema-pair' + (schemaMismatch ? ' mismatch' : '') + '">' +
            '<span>SchAPP <strong>' + escapeHtml(row.schemaApp || '—') + '</strong></span>' +
            '<span>SchDB <strong>' + escapeHtml(row.schemaDb || '—') + '</strong></span>' +
          '</div>' +
          databaseDependencyMarkup(row.dependency) +
        '</td>' +
        '<td><div class="database-active-sources">' +
          databaseActiveSourceBadge('start HTML', Boolean(row.active?.startHtml)) +
          databaseActiveSourceBadge('SQLite DB', Boolean(row.active?.sqliteDb)) +
          databaseActiveSourceBadge('active Runtime', Boolean(row.active?.activeRuntime), runtimeTitle) +
        '</div></td>' +
        '<td><div class="database-active-freshness">' +
          databaseActiveFreshnessMarkup(row) +
        '</div></td>' +
        '<td class="database-active-attempt">' +
          databaseActiveAttemptMarkup(row.latestAttempt) +
        '</td>' +
      '</tr>';
    }).join('');
  }

  function databaseQueueFormatNumber(value) {
    if (value === null || value === undefined || value === '') return '—';
    return Number.isFinite(Number(value))
      ? Number(value).toLocaleString('ru-RU')
      : '—';
  }

  function databaseQueueFreshnessMarkup(row) {
    const from = row?.freshnessFrom || null;
    const to = row?.freshnessTo || null;
    if (!from && !to) return '<span class="database-queue-muted">—</span>';
    if (from && to && from !== to) {
      return '<span class="database-queue-freshness-from">' + escapeHtml(from) + '</span>' +
        '<span class="database-queue-freshness-arrow">→</span>' +
        '<strong>' + escapeHtml(to) + '</strong>';
    }
    return '<strong>' + escapeHtml(to || from) + '</strong>';
  }

  function databaseQueueChangeText(row, currentDataset) {
    const change = row?.databaseChange || null;
    const before = change?.rowsBefore ?? currentDataset?.recordCount ?? null;
    const incoming = change?.rowsIncoming ?? row?.normalizedRows ?? row?.sourceRows ?? null;
    const after = change?.rowsAfter ?? null;

    const parts = [
      'до ' + databaseQueueFormatNumber(before),
      'вход ' + databaseQueueFormatNumber(incoming)
    ];

    if (row?.mode === 'UPSERT' && change) {
      parts.push('+' + databaseQueueFormatNumber(change.rowsInserted));
      parts.push('~' + databaseQueueFormatNumber(change.rowsUpdated));
      if (Number(change.rowsUnchanged || 0) > 0) {
        parts.push('=' + databaseQueueFormatNumber(change.rowsUnchanged));
      }
    } else if (row?.mode === 'REPLACE' && change) {
      parts.push('−' + databaseQueueFormatNumber(change.rowsDeleted));
      parts.push('+' + databaseQueueFormatNumber(change.rowsInserted));
    } else {
      parts.push('изменение —');
    }

    parts.push('после ' + databaseQueueFormatNumber(after));
    return parts.join(' · ');
  }

  function databaseQueueAffectedText(row) {
    const change = row?.databaseChange || null;
    if (!change) return '—';
    if (row?.mode === 'UPSERT') {
      const inserted = Number(change.rowsInserted || 0);
      const updated = Number(change.rowsUpdated || 0);
      return databaseQueueFormatNumber(inserted + updated) +
        ' (+' + databaseQueueFormatNumber(inserted) +
        ' · ~' + databaseQueueFormatNumber(updated) + ')';
    }
    if (row?.mode === 'REPLACE') {
      return databaseQueueFormatNumber(change.rowsAfter);
    }
    return '—';
  }

  function databaseQueueIssueText(item) {
    const errors = Array.from(item?.inspection?.validation?.errors || []);
    const warnings = Array.from(item?.inspection?.validation?.warnings || []);
    if (item?.integrationError) return item.integrationError;
    if (item?.synchronizationError) return item.synchronizationError;
    if (errors.length) return errors[0];
    if (warnings.length) return warnings[0];
    return '';
  }

  function databaseRenderIntakeCards() {
    if (!databaseWorkspaceState.intake.length) {
      return '<div class="database-intake-empty">' +
        '<strong>Очередь пуста</strong>' +
        '<span>Добавьте один или несколько Excel-файлов.</span>' +
        '</div>';
    }

    const stateModel = globalThis.ReclassifierDatasetDbStateModel;
    const snapshot = stateModel?.snapshot
      ? stateModel.snapshot(databaseWorkspaceState.intake)
      : { queue: [], datasets: [] };
    const datasetById = new Map(
      Array.from(snapshot.datasets || []).map(row => [row.id, row])
    );
    const databaseInfo = databaseCurrentInfo();
    const integrationAvailable = Boolean(globalThis.ReclassifierDatabaseIntegration);

    const contract = globalThis.ReclassifierDatabaseContract;
    const pendingEquipment = databaseWorkspaceState.intake.filter(item => {
      const id = item?.inspection?.datasetId || item?.pendingPlan?.inspection?.datasetId;
      const definition = id ? contract?.datasets?.[id] : null;
      return definition?.kind === 'equipment' && item?.integrationStatus !== 'committed';
    });
    const equipmentBatchSize = pendingEquipment.length;
    const equipmentBatchReady = equipmentBatchSize > 0 && pendingEquipment.every(item =>
      item?.integrationStatus === 'prepared' && item?.pendingPlan
    );
    const equipmentBatchNotice = equipmentBatchSize > 1
      ? '<div class="notice database-equipment-batch-notice"><strong>Equipment-пакет: ' +
          escapeHtml(equipmentBatchSize) + ' файла.</strong> ' +
          (equipmentBatchReady
            ? 'Все кандидаты готовы. Подтверждение любого файла применит пакет атомарно и опубликует один общий Equipment_Combined.'
            : 'Пакет будет доступен к подтверждению после подготовки всех Equipment-файлов.') +
        '</div>'
      : '';

    const rows = databaseWorkspaceState.intake.map((item, index) => {
      const row = snapshot.queue?.[index] || stateModel?.queueItem?.(item) || {};
      const currentDataset = databaseInfo && row.datasetId
        ? datasetById.get(row.datasetId) || null
        : null;
      const issue = databaseQueueIssueText(item);
      const activeStatus = String(item.integrationStatus || '').toLowerCase();
      const committed = activeStatus === 'committed';
      const prepared = activeStatus === 'prepared' && Boolean(item.pendingPlan);
      const preparing = activeStatus === 'preparing';
      const queued = activeStatus === 'queued' || (!activeStatus && item.inspection?.ready);
      const committing = activeStatus === 'committing';
      const invalid = item.inspection && !item.inspection.ready;
      const affectedLabel = row.mode === 'UPSERT'
        ? 'upsert'
        : (row.mode === 'REPLACE' ? 'replace' : 'изменение');

      let action = '';
      if (committing) {
        const progress = databaseWorkspaceState.commitProgress;
        const total = Number(progress?.totalRows || row.normalizedRows || row.sourceRows || 0);
        const processed = Number(progress?.processedRows || 0);
        const percent = total > 0 ? Math.min(100, Math.floor(processed * 100 / total)) : 0;
        if (item.batchCommit) {
          action =
            '<button class="button ghost" disabled>Пакет…</button>' +
            '<span class="database-queue-action-note">атомарный COMMIT</span>';
        } else {
          action =
            '<button class="button ghost database-abort-integration-button" data-integration-index="' + index + '">' +
              'Прервать</button>' +
            '<span class="database-queue-action-note">' + escapeHtml(percent + '%') + '</span>';
        }
      } else {
        let label = databaseInfo ? 'В очереди…' : 'Ожидает БД';
        let note = databaseInfo ? 'ожидает обработки' : 'нужна SQLite';
        let title = databaseInfo ? 'Ожидает повторной подготовки кандидата' :
          'Сначала откройте или разверните Reclassifier.db';
        let buttonClass = 'button primary database-confirm-integration-button';
        let disabled = true;

        if (committed) {
          label = 'Загружено';
          note = 'COMMITTED';
          title = 'Файл уже применён к текущей БД';
          buttonClass += ' committed';
        } else if (invalid) {
          label = 'Недоступно';
          note = 'ошибка файла';
          title = 'Файл не прошёл проверку';
        } else if (activeStatus === 'error') {
          label = 'Ошибка обработки';
          note = 'подготовка не завершена';
          title = item.integrationError || 'Ошибка подготовки кандидата, данные не применены';
        } else if (!integrationAvailable) {
          label = 'Недоступно';
          note = 'нет Integration Engine';
          title = 'Dataset Integration Engine недоступен';
        } else if (preparing) {
          label = 'Обработка…';
          note = 'формируется кандидат';
          title = 'Файл нормализуется и сравнивается с текущей БД';
        } else if (prepared) {
          const definition = row.datasetId ? contract?.datasets?.[row.datasetId] : null;
          const equipmentBatch = definition?.kind === 'equipment';
          label = equipmentBatch && equipmentBatchSize > 1 ? 'Применить пакет' : 'Подтвердить';
          note = equipmentBatch && equipmentBatchSize > 1
            ? (equipmentBatchReady ? 'Equipment · ' + equipmentBatchSize + ' файла' : 'ожидает весь пакет')
            : 'кандидат готов';
          title = equipmentBatch && equipmentBatchSize > 1
            ? 'Атомарно применить все подготовленные Equipment-файлы'
            : 'Применить уже рассчитанный кандидат к Dataset';
          disabled = Boolean(databaseWorkspaceState.busy) ||
            (equipmentBatch && !equipmentBatchReady);
        } else if (databaseInfo && queued) {
          label = 'В очереди…';
          note = 'ожидает обработки';
          title = 'Кандидат будет рассчитан автоматически';
        }

        action =
          '<button class="' + buttonClass + '"' +
            ' data-integration-index="' + index + '"' +
            (disabled ? ' disabled' : '') +
            ' title="' + escapeHtml(title) + '">' + escapeHtml(label) + '</button>' +
          (note ? '<span class="database-queue-action-note">' + escapeHtml(note) + '</span>' : '');
      }

      const metadata = [
        formatBytes(row.fileSize ?? item.size),
        databaseQueueFormatNumber(row.sourceRows ?? row.normalizedRows) + ' строк',
        'схема ' + (row.schemaApp || '—')
      ].join(' / ');

      return '<article class="database-intake-row' +
          (invalid || activeStatus === 'error' ? ' invalid' : '') +
          (committed ? ' committed' : '') + '">' +
        '<div class="database-queue-file">' +
          '<strong>' + escapeHtml(row.fileName || item.name || 'Excel') + '</strong>' +
          '<span>' + escapeHtml(metadata) + '</span>' +
          (issue
            ? '<small class="' + (invalid || activeStatus === 'error' ? 'invalid' : 'warning') + '">' +
                escapeHtml(issue) + '</small>'
            : '') +
        '</div>' +
        '<div class="database-queue-mode">' +
          '<span class="status-badge' + (row.mode ? ' loaded' : ' warning') + '">' +
            escapeHtml(row.mode || '—') + '</span>' +
        '</div>' +
        '<div class="database-queue-rows">' +
          '<span>в файле: <strong>' + escapeHtml(databaseQueueFormatNumber(row.sourceRows ?? row.normalizedRows)) + '</strong></span>' +
          '<span>' + escapeHtml(affectedLabel) + ': <strong>' +
            escapeHtml(databaseQueueAffectedText(row)) + '</strong></span>' +
        '</div>' +
        '<div class="database-queue-freshness">' + databaseQueueFreshnessMarkup(row) + '</div>' +
        '<div class="database-queue-action">' + action + '</div>' +
        '<div class="database-queue-change">' +
          escapeHtml(databaseQueueChangeText(row, currentDataset)) +
        '</div>' +
        '<div class="database-queue-remove">' +
          '<button class="database-remove-intake-button" data-integration-index="' + index + '"' +
            (databaseWorkspaceState.busy ? ' disabled' : '') +
            ' aria-label="Убрать файл из очереди" title="Убрать из очереди">' +
            '<svg viewBox="0 0 24 24" aria-hidden="true">' +
              '<path d="M8 9v8m4-8v8m4-8v8M5 6h14M9 6V4h6v2m-8 0 1 14h8l1-14"/>' +
            '</svg>' +
          '</button>' +
        '</div>' +
      '</article>';
    }).join('');

    return equipmentBatchNotice +
      '<div class="database-intake-queue-scroll">' +
      '<div class="database-intake-queue">' +
        '<div class="database-intake-queue-header">' +
          '<span>Файл</span>' +
          '<span>Режим</span>' +
          '<span>Строк</span>' +
          '<span>Свежесть</span>' +
          '<span></span>' +
          '<span>Изменения БД</span>' +
          '<span></span>' +
        '</div>' +
        rows +
      '</div>' +
    '</div>';
  }

