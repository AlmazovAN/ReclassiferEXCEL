// FILE CONTRACT: Database workspace preview/confirmation UI for PR3–PR7.
// Reads: ReclassifierRecalculationWorkspace and shared route state.
// Writes: no raw SQL; explicit mutations go only through confirmed commit API.
// Other Data route controls must be locked while recalculation is running.
const databaseRecalculationState = {
  selectedItsm: true,
  selectedMb: true,
  status: 'idle',
  busy: false,
  cancelRequested: false,
  progress: null,
  preview: null,
  service: null,
  result: null,
  error: null,
  synchronizationError: null,
  scope: null,
  completedScope: null,
  coverage: null
};

function databaseRecalculationClear(reason = 'idle') {
  if (databaseRecalculationState.busy) {
    databaseRecalculationState.cancelRequested = true;
  }
  databaseRecalculationState.preview = null;
  databaseRecalculationState.service = null;
  databaseRecalculationState.scope = null;
  databaseRecalculationState.progress = null;
  databaseRecalculationState.status = reason;
}

function databaseRecalculationSelected() {
  const ids = [];
  if (databaseRecalculationState.selectedMb) ids.push('mobile_brigade_data');
  if (databaseRecalculationState.selectedItsm) ids.push('itsm_data');
  return ids;
}

function databaseRecalculationLabel(id) {
  return id === 'itsm_data' ? 'ITSM Sirius' :
    id === 'mobile_brigade_data' ? 'Мобильные бригады' : id;
}

function databaseRecalculationValue(value) {
  if (value instanceof Date) return value.toLocaleString('ru-RU');
  if (value === null) return '∅';
  if (value === undefined) return '—';
  const rendered = typeof value === 'object' ? JSON.stringify(value) : String(value);
  return rendered.length > 110 ? rendered.slice(0, 107) + '…' : rendered;
}

function databaseRecalculationSummary() {
  const state = databaseRecalculationState;
  if (state.busy && state.status === 'preparing') {
    const p = state.progress;
    return '<div class="validation-block warning" role="status" aria-live="polite">' +
      '<strong>Формируется предварительный расчёт</strong><p id="databaseRecalculationProgress">' +
      (p ? escapeHtml(databaseRecalculationLabel(p.datasetId) + ': ' +
        Number(p.processed).toLocaleString('ru-RU') + ' из ' +
        Number(p.total).toLocaleString('ru-RU') + ', изменений ' +
        Number(p.changed).toLocaleString('ru-RU')) :
        'Проверка накопленных записей…') + '</p></div>';
  }
  if (state.busy && state.status === 'applying') {
    return '<div class="validation-block warning" role="status" aria-live="polite">' +
      '<strong>Применение изменений</strong><p>Выполняется согласованная запись Dataset. ' +
      'Не закрывайте страницу до результата операции.</p></div>';
  }
  if (state.error) {
    return '<div class="validation-block invalid" role="alert"><strong>Перерасчёт не выполнен</strong>' +
      '<p>' + escapeHtml(state.error) + '</p></div>';
  }
  if (state.status === 'cancelled') {
    return '<p class="small" role="status">Предварительный расчёт отменён. Данные не изменены.</p>';
  }
  if (state.result) {
    return '<div class="validation-block valid" role="status"><strong>' +
      (state.result.noOp ? 'Изменений нет' : 'Изменения применены') + '</strong>' +
      '<p>' + escapeHtml(state.result.noOp
        ? 'Накопленные Dataset оставлены без изменений.'
        : 'Обновлены: ' + state.result.changedDatasetIds.map(databaseRecalculationLabel).join(', ') + '.') +
      '</p>' +
      (state.completedScope === 'all'
        ? '<p class="small">Завершён единый пересчёт всех поддерживаемых наборов: ' +
          'Мобильные бригады и ITSM. KPI Source обновляется при изменении ITSM. ' +
          'Остальные справочники использованы как исходные данные и не переписывались.</p>'
        : '') +
      (state.synchronizationError ? '<p class="small">Запись выполнена, но проверка Runtime требует внимания: ' +
        escapeHtml(state.synchronizationError) + '</p>' : '') +
      (!state.result.noOp ? '<p class="small">' +
        (state.result.mode === 'sqlite'
          ? 'Для переносимости сохраните обновлённую базу кнопкой «Скачать Reclassifier.db» выше.'
          : 'Для переносимости сохраните актуальный HTML кнопкой «Скачать HTML с данными» ниже.') +
        '</p>' : '') + '</div>';
  }

  const plan = state.preview;
  if (!plan) {
    return '<p class="small">Предварительный расчёт только читает Active Runtime. ' +
      'Ни одна запись не меняется до отдельного подтверждения.</p>';
  }
  const stat = (state.scope === 'all'
      ? '<p class="small"><strong>Охват: все поддерживаемые данные.</strong> ' +
        'Мобильные бригады → ITSM; KPI Source зависит от изменений ITSM. ' +
        'Справочники и Equipment Catalog не перезаписываются.</p>'
      : '') + '<div class="info-list">' +
    '<div class="info-row"><span class="info-key">Источник</span><strong>' +
      escapeHtml(plan.mode === 'sqlite' ? 'SQLite · Reclassifier.db' : 'HTML Dataset Store') +
    '</strong></div>' +
    '<div class="info-row"><span class="info-key">Проверено</span><strong>' +
      Number(plan.checked).toLocaleString('ru-RU') + '</strong></div>' +
    '<div class="info-row"><span class="info-key">Будет обновлено</span><strong>' +
      Number(plan.changed).toLocaleString('ru-RU') + '</strong></div>' +
    '<div class="info-row"><span class="info-key">Без полной исходной строки (пропущено)</span><strong>' +
      Number(plan.skippedMissingSource).toLocaleString('ru-RU') + '</strong></div>' +
    '</div>';
  const sections = plan.datasets.map(group => {
    const preview = group.samples.flatMap(change =>
      Object.entries(change.fields).slice(0, 4).map(([name, diff]) =>
        '<tr><td>' + escapeHtml(change.key) + '</td><td>' + escapeHtml(name) +
        '</td><td>' + escapeHtml(databaseRecalculationValue(diff.before)) +
        '</td><td>' + escapeHtml(databaseRecalculationValue(diff.after)) + '</td></tr>'
      )
    ).slice(0, 20).join('');
    return '<details class="database-queue-technical" style="margin-top:10px">' +
      '<summary>' + escapeHtml(databaseRecalculationLabel(group.datasetId)) +
      ': изменится ' + Number(group.changed).toLocaleString('ru-RU') +
      ' / ' + Number(group.checked).toLocaleString('ru-RU') +
      '; без изменений ' + Number(group.unchanged).toLocaleString('ru-RU') +
      '; пропущено ' + Number(group.skippedMissingSource + group.skippedByRule).toLocaleString('ru-RU') +
      '</summary>' +
      (preview ? '<div class="table-scroll"><table class="reference-table"><thead><tr>' +
        '<th>Номер / ключ</th><th>Поле</th><th>Было</th><th>Станет</th></tr></thead><tbody>' +
        preview + '</tbody></table></div>' :
        '<p class="small">Изменений для просмотра нет.</p>') +
      '</details>';
  }).join('');
  return '<div class="database-recalculation-preview" role="status">' + stat +
    sections + '<p class="small">Показаны примеры, а не все изменяемые записи. ' +
    'Применение выполняется для всего подтверждённого набора изменений.</p></div>';
}

function databaseRecalculationMarkup() {
  const ui = databaseRecalculationState;
  const busy = ui.busy || databaseWorkspaceState.busy;
  const prepared = Boolean(ui.preview && !ui.busy && !databaseWorkspaceState.busy);
  return '<article class="card" id="databaseRecalculationPanel" style="margin-top:18px">' +
    '<div class="database-section-head"><div>' +
    '<h2>Пересчёт и актуализация данных</h2>' +
    '<p>Повторно применить актуальные справочники и связи ITSM/МБ к уже накопленным записям ' +
    'без повторной загрузки Excel. Equipment Catalog и Drivers остаются независимыми.</p>' +
    '</div></div>' +
    '<div class="action-row">' +
      '<label><input type="checkbox" id="databaseRecalculationItsm"' +
        (ui.selectedItsm ? ' checked' : '') + (busy ? ' disabled' : '') +
        '> ITSM Sirius</label>' +
      '<label><input type="checkbox" id="databaseRecalculationMb"' +
        (ui.selectedMb ? ' checked' : '') + (busy ? ' disabled' : '') +
        '> Мобильные бригады</label>' +
    '</div>' +
    '<p class="small">Полный поддерживаемый пересчёт использует оба Dataset: сначала МБ, затем ITSM. ' +
    'KPI Source пересобирается при изменении ITSM. Справочники, Drivers и Equipment Catalog ' +
    'используются как входные данные, но не пересчитываются без отдельных обработчиков. ' +
    'При отсутствии обязательного набора полный запуск остановится без записи. ' +
    'Поля возраста заявки не пересчитываются по новой методике.</p>' +
    '<div class="action-row">' +
      '<button class="button" id="databaseRecalculationAllButton"' +
        (busy ? ' disabled' : '') +
        '>Пересчитать всё (предпросмотр)</button>' +
      '<button class="button" id="databaseRecalculationPreviewButton"' +
        (busy || !ui.selectedItsm && !ui.selectedMb ? ' disabled' : '') +
        '>Предварительный пересчёт</button>' +
      '<button class="button primary" id="databaseRecalculationApplyButton"' +
        (!prepared || !ui.preview.hasChanges ? ' disabled' : '') +
        '>Применить изменения</button>' +
      (ui.busy && ui.status === 'preparing'
        ? '<button class="button ghost" id="databaseRecalculationCancelButton">Прервать подготовку</button>'
        : '') +
    '</div>' +
    databaseRecalculationSummary() +
    '</article>';
}

function databaseRecalculationProgress(progress) {
  databaseRecalculationState.progress = progress;
  const node = document.getElementById('databaseRecalculationProgress');
  if (node) node.textContent = databaseRecalculationLabel(progress.datasetId) + ': ' +
    Number(progress.processed).toLocaleString('ru-RU') + ' из ' +
    Number(progress.total).toLocaleString('ru-RU') + ', изменений ' +
    Number(progress.changed).toLocaleString('ru-RU');
}

async function databasePrepareRecalculation(options = {}) {
  const ui = databaseRecalculationState;
  if (ui.busy || databaseWorkspaceState.busy) return;
  const full = options.all === true;
  const selected = full ? [] : databaseRecalculationSelected();
  if (!full && !selected.length) return;
  const factory = globalThis.ReclassifierRecalculationWorkspace;
  if (!factory?.create) {
    ui.error = 'Модуль перерасчёта недоступен в этой сборке.';
    renderDatabaseWorkspace();
    return;
  }
  databaseRecalculationClear('preparing');
  ui.scope = full ? 'all' : 'selected';
  ui.coverage = null;
  ui.completedScope = null;
  ui.busy = true;
  ui.cancelRequested = false;
  ui.error = null;
  ui.result = null;
  ui.synchronizationError = null;
  databasePauseQueuePreparation('recalculation-preview-started');
  databaseWorkspaceState.busy = true;
  if (state.route === 'database') renderDatabaseWorkspace();
  try {
    await databaseNextPaint();
    const service = factory.create();
    if (full && (!service.prepareAll || !service.describeAll)) {
      throw new Error('Модуль полного пересчёта недоступен в этой сборке.');
    }
    if (full) ui.coverage = service.describeAll();
    const config = {
      sampleLimit: 8,
      signal: { get aborted() { return ui.cancelRequested; } },
      onProgress: databaseRecalculationProgress
    };
    const plan = full
      ? await service.prepareAll(config)
      : await service.prepare(selected, config);
    if (ui.cancelRequested) throw new Error('Recalculation: предварительный расчёт отменён.');
    ui.preview = plan;
    ui.service = service;
    ui.status = 'prepared';
    log('Предпросмотр перерасчёта' + (full ? ' (все поддерживаемые)' : '') +
      ': проверено ' + plan.checked +
      ', будет изменено ' + plan.changed + ', источник ' + plan.mode + '.', 'INFO', 'import_export');
  } catch (error) {
    databaseRecalculationClear(ui.cancelRequested ? 'cancelled' : 'error');
    if (!ui.cancelRequested) {
      ui.error = error?.message || String(error);
      log('Ошибка предварительного перерасчёта: ' + ui.error, 'ERROR', 'import_export');
    }
  } finally {
    ui.busy = false;
    databaseWorkspaceState.busy = false;
    databaseRequestQueuePreparation('post-recalculation-preview');
    if (state.route === 'database') renderDatabaseWorkspace();
  }
}

async function databaseApplyRecalculation() {
  const ui = databaseRecalculationState;
  if (ui.busy || databaseWorkspaceState.busy || !ui.preview || !ui.service) return;
  const plan = ui.preview;
  if (!plan.hasChanges) return;
  try {
    ui.service.assertCurrent(plan);
  } catch (error) {
    databaseRecalculationClear('error');
    ui.error = error?.message || String(error);
    if (state.route === 'database') renderDatabaseWorkspace();
    return;
  }
  const summary = plan.datasets.map(group =>
    databaseRecalculationLabel(group.datasetId) + ': ' +
    group.changed.toLocaleString('ru-RU') + ' из ' +
    group.checked.toLocaleString('ru-RU')).join('\n');
  const approved = confirm('Применить перерасчёт накопленных записей?\n\n' +
    summary + '\n\nИсточник: ' +
    (plan.mode === 'sqlite' ? 'SQLite' : 'HTML Dataset Store') +
    '\n' + (plan.datasets.some(x => x.datasetId === 'itsm_data' && x.changed > 0)
      ? 'KPI Source также будет пересобран.\n' : '') +
    'Операция изменит действующие данные. Продолжить?');
  if (!approved) return;

  ui.busy = true;
  ui.status = 'applying';
  ui.error = null;
  databasePauseQueuePreparation('recalculation-commit-started');
  databaseWorkspaceState.busy = true;
  if (state.route === 'database') renderDatabaseWorkspace();
  try {
    await databaseNextPaint();
    const completedScope = ui.scope;
    const result = ui.service.apply(plan, {confirmed:true});
    databaseRecalculationClear('applied');
    ui.completedScope = completedScope;
    ui.result = result;
    databaseWorkspaceState.health = null;
    if (result.mode === 'sqlite' && !result.noOp) {
      const synced = databaseSynchronizeWorkspace('recalculation-committed', {
        checkHealth: true,
        render: false,
        changedDatasetIds: Array.from(result.changedDatasetIds)
      });
      if (!synced.ok) {
        ui.synchronizationError = synced.error ||
          'Изменения сохранены, но синхронизация Runtime не завершена.';
      }
    }
    log('Перерасчёт применён: ' +
      (result.noOp ? 'без изменений' : Array.from(result.changedDatasetIds).join(', ')) +
      (ui.synchronizationError ? '; синхронизация требует проверки.' : '.'), 'INFO', 'import_export');
  } catch (error) {
    databaseRecalculationClear('error');
    ui.error = error?.message || String(error);
    log('Не удалось применить перерасчёт: ' + ui.error, 'ERROR', 'import_export');
  } finally {
    ui.busy = false;
    databaseWorkspaceState.busy = false;
    databaseReprepareQueueCandidates('post-recalculation');
    if (state.route === 'database') renderDatabaseWorkspace();
  }
}

function databaseBindRecalculation() {
  document.getElementById('databaseRecalculationItsm')?.addEventListener('change', event => {
    if (databaseWorkspaceState.busy) return;
    databaseRecalculationState.selectedItsm = event.currentTarget.checked;
    databaseRecalculationClear();
    databaseRecalculationState.result = null;
    databaseRecalculationState.error = null;
    renderDatabaseWorkspace();
  });
  document.getElementById('databaseRecalculationMb')?.addEventListener('change', event => {
    if (databaseWorkspaceState.busy) return;
    databaseRecalculationState.selectedMb = event.currentTarget.checked;
    databaseRecalculationClear();
    databaseRecalculationState.result = null;
    databaseRecalculationState.error = null;
    renderDatabaseWorkspace();
  });
  document.getElementById('databaseRecalculationAllButton')?.addEventListener('click',
    () => void databasePrepareRecalculation({ all: true }));
  document.getElementById('databaseRecalculationPreviewButton')?.addEventListener('click',
    () => void databasePrepareRecalculation());
  document.getElementById('databaseRecalculationApplyButton')?.addEventListener('click',
    () => void databaseApplyRecalculation());
  document.getElementById('databaseRecalculationCancelButton')?.addEventListener('click', () => {
    databaseRecalculationState.cancelRequested = true;
    const node = document.getElementById('databaseRecalculationProgress');
    if (node) node.textContent = 'Запрошено прерывание предварительного расчёта…';
  });
}
