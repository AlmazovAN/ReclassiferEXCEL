// FILE CONTRACT: Reference landing route composition.
// Purpose: render the Reference landing table and navigate to a selected Reference detail.
// Owns: Reference landing-page DOM composition and landing event wiring.
// Reads: Reference config/store and shared status helpers.
// Writes: route-local activeReferenceId state and landing DOM.
// Public API: renderReferences used by application routing.
// Must not: own detail schema rendering, directory probes, previews or persistence.
// Related tests: test_reference_architecture.py, smoke_app_runtime.js,
//                test_file_selection.js, test_architecture_guardrails.py.

// ============================================================================
// REFERENCES LANDING PAGE
// ============================================================================
  function renderReferences() {
    if (state.activeReferenceId) return renderReferenceDetail(state.activeReferenceId);
    if (state.activeEquipmentId) return renderEquipmentDetail(state.activeEquipmentId);

    setHeader('Данные', 'Справочники', 'Загрузка, проверка и применение справочников, которые используются аналитическими модулями.');

    const rows = Object.entries(referenceConfig).map(([id, ref]) => {
      const instance = datasetStore.get(id);
      const meta = instance?.meta || {};
      return '<tr class="reference-row" data-reference-open="' + escapeHtml(id) + '">' +
        '<td><button class="link-button reference-name" data-reference-open-button="' + escapeHtml(id) + '">' + escapeHtml(ref.title) + '</button>' +
        '<div class="small">' + escapeHtml(ref.description) + '</div></td>' +
        '<td>' + referenceStatusMarkup(instance) + '</td>' +
        '<td>' + (instance
          ? '<div class="reference-file">' + escapeHtml(meta.fileName || '—') + '</div><div class="small">' + formatBytes(meta.fileSize) + '</div>'
          : '<span class="small">—</span>') + '</td>' +
        '<td>' + escapeHtml(meta.normalizedRows ?? '—') + '</td>' +
        '<td>' + escapeHtml(referenceFreshnessLabel(id, instance)) + '</td>' +
        '<td class="reference-actions">' + (ref.generatedOnly
          ? '<span class="small">' + ((id === 'itsm_data' || id === 'kpi_source') ? 'Авто из ITSM' : 'Авто из МБ') + '</span>'
          : '<button class="button" data-reference-select="' + escapeHtml(id) + '">' + (instance ? 'Выбрать другой' : 'Выбрать файл') + '</button>') + '</td>' +
        '</tr>';
    }).join('') + (() => {
      // Reuse the existing classifier module and its validations; this is a navigation row only.
      const instance = state.failureClassifier;
      const meta = instance?.meta || {};
      return '<tr class="reference-row" data-failure-classifier-reference-open="true">' +
        '<td><button class="link-button reference-name" data-failure-classifier-reference-open="true">Классификатор отказов</button>' +
        '<div class="small">Рабочий справочник неисправностей оборудования</div></td>' +
        '<td>' + failureClassifierStatusMarkup(instance) + '</td>' +
        '<td>' + (instance ? escapeHtml(meta.fileName || '—') : '<span class="small">—</span>') + '</td>' +
        '<td>' + escapeHtml(meta.normalizedRows ?? '—') + '</td>' +
        '<td>' + escapeHtml(failureClassifierFreshness(instance)) + '</td>' +
        '<td class="reference-actions"><button class="button" data-failure-classifier-reference-open="true">Открыть</button></td></tr>';
    })();

    el.pageContent.innerHTML =
      '<div class="grid cols-2">' +
      '<article class="card flat"><h3>Назначение</h3><p>' +
      (build.coreBuild
        ? 'Здесь хранятся справочники для обработки Excel. CORE-сборка не содержит стартовых рабочих данных: подключите свою SQLite или загрузите исходные Excel-файлы.'
        : 'Здесь хранятся справочники для обработки Excel. В этой сборке доступны стартовые наборы; при необходимости их можно обновить своими Excel-файлами.') +
      '</p></article>' +
      '<article class="card flat"><h3>Обработка данных</h3><p>У каждого справочника есть свой загрузчик. Он распознаёт Excel по структуре, нормализует и проверяет данные, выполняет необходимые преобразования и расчёты, а затем подготавливает готовый набор для системы.</p><p>Логика обработки зависит от типа справочника, поэтому каждый загрузчик применяет только свои правила.</p></article>' +
      '</div>' +
      '<article class="card" style="margin-top:18px">' +
      '<h2>Справочники</h2>' +
      '<p>Файлы обрабатываются локально. Если база Reclassifier.db не подключена, применённые изменения можно перенести в новый HTML через раздел «База данных». Если база подключена, обновления сохраняются через неё.</p>' +
      '<div class="table-scroll"><table class="reference-table">' +
      '<thead><tr><th>Справочник</th><th>Статус</th><th>Файл</th><th>Записи</th><th>Свежесть</th><th></th></tr></thead>' +
      '<tbody>' + rows + '</tbody></table></div></article>' +
      '<div class="notice" style="margin-top:18px">Если для справочника используется «дата последней заявки», она рассчитывается только по содержимому данных как максимальная дата. Дата изменения файла не используется.</div>' +
      renderEquipmentCatalogSection();

    el.pageContent.querySelectorAll('[data-failure-classifier-reference-open]').forEach(node => node.addEventListener('click', event => {
      event.stopPropagation();
      state.activeFailureClassifierId = failureClassifierConfig.id;
      navigate('failure_classifier');
    }));

    el.pageContent.querySelectorAll('[data-reference-select]').forEach(btn => btn.addEventListener('click', event => {
      event.stopPropagation();
      const id = btn.dataset.referenceSelect;
      selectExcelFiles(file => loadReferenceFile(id, file), () => {
        if (state.route === 'references') {
          state.activeReferenceId = id;
          renderReferences();
        }
      });
    }));

    el.pageContent.querySelectorAll('[data-reference-open-button]').forEach(btn => btn.addEventListener('click', event => {
      event.stopPropagation();
      state.activeReferenceId = btn.dataset.referenceOpenButton;
      renderReferences();
    }));

    // Equipment rows use a different route-local selection handler.
    el.pageContent.querySelectorAll('[data-reference-open]').forEach(row => row.addEventListener('click', event => {
      if (event.target.closest('[data-reference-select]')) return;
      state.activeReferenceId = row.dataset.referenceOpen;
      renderReferences();
    }));

    bindEquipmentCatalogSection();
  }



