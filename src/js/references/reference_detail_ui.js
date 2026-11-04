// FILE CONTRACT: single Reference detail composition.
// Purpose: compose the selected Reference/Dataset detail page from shared preview/status helpers.
// Owns: schema/output/detail sections and detail-page event wiring.
// Reads: Reference config/manager, schemas, preview helpers and Dataset Store.
// Writes: Reference detail DOM and route-local activeReferenceId state.
// Public API: renderReferenceDetail consumed by Reference route composition.
// Must not: classify directory files, normalize workbooks or persist directly to SQLite.
// Related tests: test_reference_architecture.py, smoke_app_runtime.js,
//                test_documentation_contract.py, test_architecture_guardrails.py.

// ============================================================================
// SINGLE REFERENCE DETAIL COMPOSITION
// ============================================================================
  function renderReferenceDetail(referenceId) {
    const config = referenceConfig[referenceId];
    if (!config) {
      state.activeReferenceId = null;
      return renderReferences();
    }

    const instance = datasetStore.get(referenceId);
    const meta = instance?.meta || {};
    const consumers = getReferenceConsumers(referenceId);
    const mobileScopeStats = referenceId === 'mobile_brigade_data'
      ? mobileBrigadeScopeSummary(instance)
      : [];
    const mobileCoverageStarts = mobileScopeStats.map(item => item.from).filter(Boolean).sort();
    const mobileCoverageEnds = mobileScopeStats.map(item => item.to).filter(Boolean).sort();
    const mobileFreshnessValues = mobileScopeStats.map(item => item.freshness).filter(Boolean).sort();
    setHeader('Reference Manager', config.title, config.description);

    const consumerHtml = consumers.length
      ? '<div class="consumer-list">' + consumers.map(item =>
          '<span class="consumer-chip">' + escapeHtml(item.title) + '</span>'
        ).join('') + '</div>'
      : '<p>Нет объявленных зависимостей.</p>';

    let schemaHtml = '<p>Схема ещё не формализована.</p>';
    let outputHtml = '<p>Выходной контракт ещё не формализован.</p>';

    if (referenceId === 'mobile_brigade_data') {
      const outputRows = MOBILE_BRIGADE_DATA_SCHEMA.output.map(column =>
        '<tr><td>' + escapeHtml(column[1]) + '</td><td><code>' + escapeHtml(column[0]) + '</code></td><td>' +
        escapeHtml(column[2]) + '</td><td>' + (column[0] === MOBILE_BRIGADE_DATA_SCHEMA.keyField ? 'ключ UPSERT' : (column[0] === 'request' ? 'связь с ITSM' : 'данные')) + '</td></tr>'
      ).join('');

      schemaHtml = renderMobileBrigadeScopeStatus(instance);

      outputHtml =
        '<div class="table-scroll"><table class="reference-table compact-table">' +
        '<thead><tr><th>Поле</th><th>ID</th><th>Тип</th><th>Роль</th></tr></thead><tbody>' + outputRows + '</tbody></table></div>';
    } else if (referenceId === 'itsm_data') {
      const fields = instance?.meta?.fields || [];
      const columns = instance?.meta?.columns || [];
      schemaHtml = renderItsmSiriusStatus(instance);
      const outputRows = fields.map((field, index) =>
        '<tr><td>' + escapeHtml(columns[index] || field) + '</td><td><code>' + escapeHtml(field) + '</code></td>' +
        '<td>' + (index < 17 ? 'исходное' : 'расчётное') + '</td>' +
        '<td>' + (field === 'number' ? 'ключ UPSERT' : 'данные') + '</td></tr>'
      ).join('');
      outputHtml = '<div class="table-scroll"><table class="reference-table compact-table">' +
        '<thead><tr><th>Поле</th><th>ID</th><th>Группа</th><th>Роль</th></tr></thead><tbody>' +
        outputRows + '</tbody></table></div>';
    } else if (referenceId === 'kpi_source') {
      const kpiMarkup = renderKpiSourceReferenceSchema(instance);
      schemaHtml = kpiMarkup.schemaHtml;
      outputHtml = kpiMarkup.outputHtml;
    } else if (referenceId === 'type_request') {
      const inputRows = TYPE_REQUEST_SCHEMA.requiredHeaders.map((header, index) =>
        '<tr><td>' + escapeHtml(header) + '</td><td>text</td><td>да</td><td>' + (index === 0 ? 'ключ' : 'результат') + '</td></tr>'
      ).join('');

      const outputRows = TYPE_REQUEST_SCHEMA.output.map(column =>
        '<tr><td>' + escapeHtml(column[1]) + '</td><td><code>' + escapeHtml(column[0]) + '</code></td><td>' +
        escapeHtml(column[2]) + '</td><td>' + (column[3] ? 'да' : 'нет') + '</td></tr>'
      ).join('');

      schemaHtml =
        '<div class="table-scroll"><table class="reference-table compact-table">' +
        '<thead><tr><th>Колонка</th><th>Тип</th><th>Колонка обяз.</th><th>Роль</th></tr></thead><tbody>' + inputRows + '</tbody></table></div>' +
        '<div class="notice" style="margin-top:14px">Справочник сопоставляет входную колонку «Краткое описание» с типовым запросом. Для ключа нормализуются пробелы, неразрывные пробелы и регистр; сама формулировка, символы «/», «\\» и пунктуация не упрощаются, чтобы не смешивать разные запросы.</div>';

      outputHtml =
        '<div class="table-scroll"><table class="reference-table compact-table">' +
        '<thead><tr><th>Поле</th><th>ID</th><th>Тип</th><th>Обяз.</th></tr></thead><tbody>' + outputRows + '</tbody></table></div>';
    } else if (referenceId === 'customers') {
      const inputRows = CUSTOMERS_SCHEMA.requiredHeaders.map((header, index) =>
        '<tr><td>' + escapeHtml(header) + '</td><td>text|null</td><td>да</td><td>' + (index === 0 ? 'ключ' : 'данные') + '</td></tr>'
      ).join('');

      const outputRows = CUSTOMERS_SCHEMA.output.map(column =>
        '<tr><td>' + escapeHtml(column[1]) + '</td><td><code>' + escapeHtml(column[0]) + '</code></td><td>' +
        escapeHtml(column[2]) + '</td><td>' + (column[3] ? 'да' : 'нет') + '</td></tr>'
      ).join('');

      schemaHtml =
        '<div class="table-scroll"><table class="reference-table compact-table">' +
        '<thead><tr><th>Колонка</th><th>Тип</th><th>Колонка обяз.</th><th>Роль</th></tr></thead><tbody>' + inputRows + '</tbody></table></div>' +
        '<div class="notice" style="margin-top:14px">Ключ справочника — рудник/шахта. Поле «Заказчик (для нас)» хранит внутреннюю принадлежность (например, ЗФ/КФ), а краткое и полное поля — фактического заказчика. Для сопоставления Reclassifier убирает только начальный префикс «р.» или «ш.», но исходное название сохраняет отдельно. Старый заголовок «Заказчик» также поддерживается.</div>';

      outputHtml =
        '<div class="table-scroll"><table class="reference-table compact-table">' +
        '<thead><tr><th>Поле</th><th>ID</th><th>Тип</th><th>Обяз.</th></tr></thead><tbody>' + outputRows + '</tbody></table></div>';
    } else if (referenceId === 'problem_grade') {
      const inputRows = PROBLEM_GRADE_SCHEMA.columns.map(column => {
        const role = column[0] === 'legacyKey'
          ? 'контроль'
          : ['equipment', 'element', 'fault', 'reason'].includes(column[0])
            ? 'ключ'
            : 'данные';
        return '<tr><td>' + escapeHtml(column[1]) + '</td><td>' + escapeHtml(column[2]) + '</td><td>' +
          (PROBLEM_GRADE_SCHEMA.anchorHeaders.includes(column[1]) ? 'да' : 'нет') + '</td><td>' + role + '</td></tr>';
      }).join('');

      const outputColumns = [
        ['classifierKey', 'Ключ классификатора', 'text'],
        ['classifierPath', 'Цепочка классификатора', 'text'],
        ['problemId', 'Основание № IT-проблемы', 'text|null'],
        ['problemStatus', 'Статус PRB', 'text|null'],
        ['problemName', 'Имя IT-проблемы', 'text|null'],
        ['equipment', 'Наименование оборудования', 'text|null'],
        ['element', 'Элемент', 'text|null'],
        ['fault', 'Неисправность', 'text|null'],
        ['reason', 'Причина', 'text|null'],
        ['classifierConfirmation', 'Подтверждение классификатора', 'text|null'],
        ['normalizationDecision', 'Решение о нормализации', 'text|null'],
        ['primaryExclusion', 'Первичное исключение', 'text|null'],
        ['legacyKey', 'Вспомогательная склейка', 'text|null'],
        ['legacyKeyMatches', 'Склейка совпадает', 'boolean|null']
      ];
      const outputRows = outputColumns.map(column =>
        '<tr><td>' + escapeHtml(column[1]) + '</td><td><code>' + escapeHtml(column[0]) + '</code></td><td>' +
        escapeHtml(column[2]) + '</td></tr>'
      ).join('');

      schemaHtml =
        '<div class="table-scroll"><table class="reference-table compact-table">' +
        '<thead><tr><th>Колонка</th><th>Тип</th><th>Для распознавания</th><th>Роль</th></tr></thead><tbody>' + inputRows + '</tbody></table></div>' +
        '<div class="notice" style="margin-top:14px">«Вспомогательный столбец» не используется для поиска. Reclassifier сам строит ключ из цепочки «Наименование оборудования → Элемент → Неисправность → Причина» и только проверяет, совпадает ли с ним старая Excel-склейка.</div>';

      outputHtml =
        '<div class="table-scroll"><table class="reference-table compact-table">' +
        '<thead><tr><th>Поле</th><th>ID</th><th>Тип</th></tr></thead><tbody>' + outputRows + '</tbody></table></div>';
    } else if (referenceId === 'reclassification') {
      const inputRows = RECLASSIFICATION_SCHEMA.columns.map(column =>
        '<tr><td>' + escapeHtml(column[1]) + '</td><td>' + escapeHtml(column[2]) + '</td><td>' +
        (RECLASSIFICATION_SCHEMA.anchorHeaders.includes(column[1]) ? 'да' : 'нет') + '</td><td>нет</td></tr>'
      ).join('');

      const outputRows = RECLASSIFICATION_SCHEMA.columns.map(column =>
        '<tr><td>' + escapeHtml(column[1]) + '</td><td><code>' + escapeHtml(column[0]) + '</code></td><td>' +
        escapeHtml(column[2]) + '</td></tr>'
      ).join('');

      schemaHtml =
        '<div class="table-scroll"><table class="reference-table compact-table">' +
        '<thead><tr><th>Колонка</th><th>Тип</th><th>Для распознавания</th><th>Значение обяз.</th></tr></thead><tbody>' + inputRows + '</tbody></table></div>' +
        '<div class="notice" style="margin-top:14px">Пустые ячейки допустимы и не отклоняют справочник. Формат распознаётся по заголовкам; ключевое поле — «Номер». Свежесть и порядок обработки определяются по «Дата выполнения обращения».</div>';

      outputHtml =
        '<div class="table-scroll"><table class="reference-table compact-table">' +
        '<thead><tr><th>Поле</th><th>ID</th><th>Тип</th></tr></thead><tbody>' + outputRows + '</tbody></table></div>';
    } else if (referenceId === 'initiators') {
      const inputRows = INITIATORS_SCHEMA.requiredHeaders.map(header =>
        '<tr><td>' + escapeHtml(header) + '</td><td>text|null</td><td>да</td><td>нет</td></tr>'
      ).join('');

      const outputRows = INITIATORS_SCHEMA.output.map(column =>
        '<tr><td>' + escapeHtml(column[1]) + '</td><td><code>' + escapeHtml(column[0]) + '</code></td><td>' +
        escapeHtml(column[2]) + '</td></tr>'
      ).join('');

      schemaHtml =
        '<div class="table-scroll"><table class="reference-table compact-table">' +
        '<thead><tr><th>Колонка</th><th>Тип</th><th>Колонка обяз.</th><th>Значение обяз.</th></tr></thead><tbody>' + inputRows + '</tbody></table></div>' +
        '<div class="notice" style="margin-top:14px">Колонки распознаются по названиям. Пустые ячейки и значения «?», «??» и т.п. считаются «не определено» и не являются ошибкой. Повторные строки одного инициатора объединяются; заполненное значение имеет приоритет над пустым/«?». </div>';

      outputHtml =
        '<div class="table-scroll"><table class="reference-table compact-table">' +
        '<thead><tr><th>Поле</th><th>ID</th><th>Тип</th></tr></thead><tbody>' + outputRows + '</tbody></table></div>';
    } else if (referenceId === 'exceptions') {
      const inputRows = EXCEPTIONS_SCHEMA.requiredHeaders.map((header, index) =>
        '<tr><td>' + escapeHtml(header) + '</td><td>' + (index === 0 ? 'number|text|null' : 'text|null') + '</td><td>да</td><td>нет</td></tr>'
      ).join('');

      const outputRows = EXCEPTIONS_SCHEMA.output.map(column =>
        '<tr><td>' + escapeHtml(column[1]) + '</td><td><code>' + escapeHtml(column[0]) + '</code></td><td>' +
        escapeHtml(column[2]) + '</td></tr>'
      ).join('');

      schemaHtml =
        '<div class="table-scroll"><table class="reference-table compact-table">' +
        '<thead><tr><th>Колонка</th><th>Тип</th><th>Колонка обяз.</th><th>Значение обяз.</th></tr></thead><tbody>' + inputRows + '</tbody></table></div>' +
        '<div class="notice" style="margin-top:14px">Колонки распознаются по названиям. Пустые ячейки и значения «?» считаются «не определено». Точные дубли одного правила объединяются; предупреждение возникает только при разных непустых решениях или категориях для одного текста исключения.</div>';

      outputHtml =
        '<div class="table-scroll"><table class="reference-table compact-table">' +
        '<thead><tr><th>Поле</th><th>ID</th><th>Тип</th></tr></thead><tbody>' + outputRows + '</tbody></table></div>';
    } else if (referenceId === 'drivers') {
      const inputRows = DRIVERS_SCHEMA.requiredHeaders.map((header, index) =>
        '<tr><td>' + escapeHtml(header) + '</td><td>text</td><td>' + (index === 1 ? 'нет' : 'да') + '</td></tr>'
      ).join('');

      const outputRows = DRIVERS_SCHEMA.output.map(column =>
        '<tr><td>' + escapeHtml(column[1]) + '</td><td><code>' + escapeHtml(column[0]) + '</code></td><td>' +
        escapeHtml(column[2]) + '</td><td>' + (column[3] ? 'да' : 'нет') + '</td></tr>'
      ).join('');

      schemaHtml =
        '<div class="table-scroll"><table class="reference-table compact-table">' +
        '<thead><tr><th>Колонка</th><th>Тип</th><th>Обяз.</th></tr></thead><tbody>' + inputRows + '</tbody></table></div>' +
        '<div class="notice" style="margin-top:14px">Все непустые колонки справа от «Система» считаются рудниками/шахтами и распрямляются в вертикальные записи.</div>';

      outputHtml =
        '<div class="table-scroll"><table class="reference-table compact-table">' +
        '<thead><tr><th>Поле</th><th>ID</th><th>Тип</th><th>Обяз.</th></tr></thead><tbody>' + outputRows + '</tbody></table></div>';
    }

    const metrics =
      '<div class="reference-metrics">' +
      '<div><span>Статус</span><strong>' + referenceStatusMarkup(instance) + '</strong></div>' +
      '<div><span>Файл</span><strong>' + escapeHtml(meta.fileName || '—') + '</strong></div>' +
      '<div><span>Загружен</span><strong>' + (meta.loadedAt ? escapeHtml(new Date(meta.loadedAt).toLocaleString('ru-RU')) : '—') + '</strong></div>' +
      '<div><span>Версия данных</span><strong>' + escapeHtml(meta.dataVersion || '—') + '</strong></div>' +
      (referenceId === 'mobile_brigade_data'
        ? '<div><span>Записей</span><strong>' + escapeHtml(meta.normalizedRows ?? '—') + '</strong></div>' +
          '<div><span>Заявок-ключей</span><strong>' + escapeHtml(meta.requestKeyCount ?? '—') + '</strong></div>' +
          '<div><span>Без заявки</span><strong>' + escapeHtml(meta.rowsWithoutRequest ?? '—') + '</strong></div>' +
          '<div><span>Покрытие от</span><strong>' + escapeHtml(mobileBrigadeFormatIsoDate(mobileCoverageStarts.at(0))) + '</strong></div>' +
          '<div><span>Покрытие до</span><strong>' + escapeHtml(mobileBrigadeFormatIsoDate(mobileCoverageEnds.at(-1))) + '</strong></div>' +
          '<div><span>Макс. свежесть</span><strong>' + mobileBrigadeFreshnessBadge(mobileFreshnessValues.at(-1) || null) + '</strong></div>'
        : referenceId === 'itsm_data'
        ? '<div><span>Заявок</span><strong>' + escapeHtml(meta.normalizedRows ?? instance?.records?.length ?? '—') + '</strong></div>' +
          '<div><span>Полей</span><strong>' + escapeHtml(meta.fieldCount ?? 51) + '</strong></div>' +
          '<div><span>Покрытие от</span><strong>' + escapeHtml(mobileBrigadeFormatIsoDate(meta.earliestSourceDate)) + '</strong></div>' +
          '<div><span>Покрытие до</span><strong>' + escapeHtml(mobileBrigadeFormatIsoDate(meta.latestSourceDate)) + '</strong></div>' +
          '<div><span>Свежесть</span><strong>' + mobileBrigadeFreshnessBadge(meta.latestSourceDate || null) + '</strong></div>' +
          '<div><span>Ключ UPSERT</span><strong>Номер</strong></div>'
        : referenceId === 'kpi_source'
        ? renderKpiSourceReferenceMetrics(instance)
        : referenceId === 'drivers'
        ? '<div><span>Исходных строк</span><strong>' + escapeHtml(meta.sourceRows ?? '—') + '</strong></div>' +
          '<div><span>Рудников / шахт</span><strong>' + escapeHtml(meta.mineCount ?? '—') + '</strong></div>' +
          '<div><span>Вертикальных строк</span><strong>' + escapeHtml(meta.normalizedRows ?? '—') + '</strong></div>' +
          '<div><span>Лист Excel</span><strong>' + escapeHtml(meta.sourceSheet || '—') + '</strong></div>'
        : referenceId === 'customers'
          ? '<div><span>Исходных строк</span><strong>' + escapeHtml(meta.sourceRows ?? '—') + '</strong></div>' +
            '<div><span>Рудников / шахт</span><strong>' + escapeHtml(meta.mineCount ?? '—') + '</strong></div>' +
            '<div><span>Заказчиков (для нас)</span><strong>' + escapeHtml(meta.internalCustomerCount ?? '—') + '</strong></div>' +
            '<div><span>Фактических заказчиков</span><strong>' + escapeHtml(meta.customerCount ?? '—') + '</strong></div>' +
            '<div><span>Записей</span><strong>' + escapeHtml(meta.normalizedRows ?? '—') + '</strong></div>' +
            '<div><span>Точных дублей объединено</span><strong>' + escapeHtml(meta.exactDuplicateRows ?? '—') + '</strong></div>' +
            '<div><span>Лист Excel</span><strong>' + escapeHtml(meta.sourceSheet || '—') + '</strong></div>'
          : referenceId === 'type_request'
            ? '<div><span>Исходных строк</span><strong>' + escapeHtml(meta.sourceRows ?? '—') + '</strong></div>' +
              '<div><span>Типовых запросов</span><strong>' + escapeHtml(meta.patternCount ?? '—') + '</strong></div>' +
              '<div><span>Видов работ</span><strong>' + escapeHtml(meta.workTypeCount ?? '—') + '</strong></div>' +
              '<div><span>Записей</span><strong>' + escapeHtml(meta.normalizedRows ?? '—') + '</strong></div>' +
              '<div><span>Конфликтов</span><strong>' + escapeHtml(meta.conflictCount ?? '—') + '</strong></div>' +
              '<div><span>Точных дублей объединено</span><strong>' + escapeHtml(meta.exactDuplicateRows ?? '—') + '</strong></div>' +
              '<div><span>Лист Excel</span><strong>' + escapeHtml(meta.sourceSheet || '—') + '</strong></div>'
            : referenceId === 'reclassification'
          ? '<div><span>Строк</span><strong>' + escapeHtml(meta.normalizedRows ?? '—') + '</strong></div>' +
            '<div><span>Свежесть по</span><strong>Дата выполнения обращения</strong></div>' +
            '<div><span>Сортировка</span><strong>Дата выполнения ↑</strong></div>' +
            '<div><span>Лист Excel</span><strong>' + escapeHtml(meta.sourceSheet || '—') + '</strong></div>'
          : referenceId === 'initiators'
            ? '<div><span>Исходных строк</span><strong>' + escapeHtml(meta.sourceRows ?? '—') + '</strong></div>' +
              '<div><span>Инициаторов</span><strong>' + escapeHtml(meta.normalizedRows ?? '—') + '</strong></div>' +
              '<div><span>Объединено дублей</span><strong>' + escapeHtml(meta.mergedDuplicateRows ?? '—') + '</strong></div>' +
              '<div><span>Лист Excel</span><strong>' + escapeHtml(meta.sourceSheet || '—') + '</strong></div>'
            : referenceId === 'exceptions'
              ? '<div><span>Исходных строк</span><strong>' + escapeHtml(meta.sourceRows ?? '—') + '</strong></div>' +
                '<div><span>Правил</span><strong>' + escapeHtml(meta.normalizedRows ?? '—') + '</strong></div>' +
                '<div><span>Объединено дублей</span><strong>' + escapeHtml(meta.mergedDuplicateRows ?? '—') + '</strong></div>' +
                '<div><span>Лист Excel</span><strong>' + escapeHtml(meta.sourceSheet || '—') + '</strong></div>'
              : referenceId === 'problem_grade'
                ? '<div><span>Исходных строк</span><strong>' + escapeHtml(meta.sourceRows ?? '—') + '</strong></div>' +
                  '<div><span>Привязок</span><strong>' + escapeHtml(meta.normalizedRows ?? '—') + '</strong></div>' +
                  '<div><span>Цепочек классификатора</span><strong>' + escapeHtml(meta.classifierKeyCount ?? '—') + '</strong></div>' +
                  '<div><span>Ошибок legacy-склейки</span><strong>' + escapeHtml(meta.legacyMismatchCount ?? '—') + '</strong></div>' +
                  '<div><span>Неоднозначных цепочек</span><strong>' + escapeHtml(meta.ambiguousClassifierKeyCount ?? '—') + '</strong></div>' +
                  '<div><span>Точных дублей объединено</span><strong>' + escapeHtml(meta.exactDuplicateRows ?? '—') + '</strong></div>' +
                  '<div><span>Лист Excel</span><strong>' + escapeHtml(meta.sourceSheet || '—') + '</strong></div>'
                : '') +
      '</div>';

    el.pageContent.innerHTML =
      '<div class="reference-detail-toolbar">' +
      '<button class="button ghost" id="backToReferencesButton">← К списку справочников</button></div>' +
      '<div class="grid cols-2 reference-overview">' +
      '<article class="card flat"><h3>Назначение</h3><p>' + escapeHtml(config.description) + '</p>' +
      '<div class="info-list"><div class="info-row"><span class="info-key">ID</span><strong>' + escapeHtml(referenceId) + '</strong></div>' +
      '<div class="info-row"><span class="info-key">Версия схемы</span><strong>' + escapeHtml(config.schemaVersion || '0.0.0') + '</strong></div>' +
      '<div class="info-row"><span class="info-key">Свежесть</span><strong>' + escapeHtml(referenceFreshnessLabel(referenceId, instance)) + '</strong></div></div></article>' +
      '<article class="card flat reference-upload-panel"><h3>' + (config.generatedOnly ? 'Автоматическое обновление' : 'Загрузка справочника') + '</h3>' +
      '<div class="reference-current-state">' +
      '<div class="small">Текущий статус</div><strong>' + escapeHtml(currentReferenceSourceText(instance)) + '</strong>' +
      (instance ? '<div class="small">' + escapeHtml(meta.fileName || '—') + (meta.loadedAt ? ' · ' + escapeHtml(new Date(meta.loadedAt).toLocaleString('ru-RU')) : '') + '</div>' : '') +
      '</div>' +
      (config.generatedOnly
        ? '<div class="notice" style="margin-top:14px">Этот набор нельзя заменить вручную. Он обновляется после обработки и нажатия «Применить данные» в модуле «' +
          ((referenceId === 'itsm_data' || referenceId === 'kpi_source') ? 'ITSM' : 'Мобильные бригады') + '».</div>'
        : '<div class="dropzone reference-dropzone" id="referenceDropzone"><div>' +
          '<div class="dropzone-title">Перетащите Excel сюда</div>' +
          '<div class="dropzone-text">' + (instance ? 'или выберите новый файл для замены' : 'или выберите файл на компьютере') + '</div>' +
          '<button class="button" id="selectReferenceFileButton">' + (instance ? 'Заменить файл' : 'Выбрать файл') + '</button>' +
          '</div></div>') +
      (config.externalDataset ? '' : renderDatasetCandidate(referenceId, renderReferenceValidation, candidate => {
        if (referenceId === 'drivers') return renderDriversPreview(candidate);
        if (referenceId === 'customers') return renderCustomersPreview(candidate);
        if (referenceId === 'type_request') return renderTypeRequestPreview(candidate);
        if (referenceId === 'reclassification') return renderReclassificationPreview(candidate);
        if (referenceId === 'initiators') return renderInitiatorsPreview(candidate);
        if (referenceId === 'exceptions') return renderExceptionsPreview(candidate);
        if (referenceId === 'problem_grade') return renderProblemGradePreview(candidate);
        return '';
      })) +
      '<div class="reference-history-title">История загрузки</div>' + renderReferenceHistory(referenceId) +
      '</article></div>' +
      '<div class="reference-control-grid" style="margin-top:18px">' +
      '<article class="card"><h2>Текущий экземпляр</h2>' + metrics + '</article>' +
      '<article class="card"><h2>Используется автоматически</h2>' + consumerHtml +
      '<p class="small">Справочник автоматически подключается к указанным модулям. Ручной выбор внутри модуля не требуется.</p></article></div>' +
      '<div class="grid cols-2" style="margin-top:18px">' +
      '<article class="card flat"><h3>' +
      (referenceId === 'mobile_brigade_data' ? 'Сейчас загружены Mobile Brigade Data' :
        (referenceId === 'itsm_data' ? 'Сейчас загружены ITSM Sirius Data' :
          (referenceId === 'kpi_source' ? 'Сейчас загружен KPI Source' : 'Входной Excel'))) +
      '</h3>' + schemaHtml + '</article>' +
      '<article class="card flat"><h3>Данные для модулей</h3>' + outputHtml + '</article></div>' +
      '<article class="card" style="margin-top:18px"><h2>Проверка</h2>' + renderReferenceValidation(instance) + '</article>' +
      (referenceId === 'mobile_brigade_data'
        ? '<article class="card" style="margin-top:18px"><h2>Mobile Brigade Data</h2>' +
          '<p>Набор обновляется после обработки и нажатия «Применить данные» для МБ и предназначен для последующего обогащения и реклассификации ITSM.</p>' +
          renderMobileBrigadeDataPreview(instance) + '</article>'
        : referenceId === 'itsm_data'
        ? '<article class="card" style="margin-top:18px"><h2>ITSM Sirius Data</h2>' +
          '<p>Накопительный набор обработанных заявок ITSM. Совпадения обновляются по полю «Номер», новые заявки добавляются, незатронутая история сохраняется.</p>' +
          renderItsmSiriusPreview(instance) + '</article>'
        : referenceId === 'drivers'
        ? '<article class="card" style="margin-top:18px"><h2>Нормализованный Drivers</h2>' +
          '<p>Широкая матрица Excel распрямляется по рудникам. Связка «Наименование → Сервис → Система» переносится в каждую вертикальную запись.</p>' +
          renderDriversPreview(instance) + '</article>'
        : referenceId === 'customers'
          ? '<article class="card" style="margin-top:18px"><h2>Нормализованный Customers</h2>' +
            '<p>Каждый рудник/шахта получает внутреннего заказчика «для нас», а также краткое и полное наименование фактического заказчика. Исходное название рудника сохраняется для аудита.</p>' +
            renderCustomersPreview(instance) + '</article>'
          : referenceId === 'type_request'
            ? '<article class="card" style="margin-top:18px"><h2>Нормализованный TypeRequest</h2>' +
              '<p>Типовое краткое описание преобразуется в стабильный ключ и сопоставляется с ожидаемым видом работ: АВР, плановое ТО, ЗнО, монтаж, перенос, доступ и другими категориями из справочника.</p>' +
              renderTypeRequestPreview(instance) + '</article>'
            : referenceId === 'reclassification'
          ? '<article class="card" style="margin-top:18px"><h2>Нормализованный Reclassification</h2>' +
            '<p>Даты приводятся к единому формату, пустые поля сохраняются как пустые значения, строки сортируются по дате выполнения обращения.</p>' +
            renderReclassificationPreview(instance) + '</article>'
          : referenceId === 'initiators'
            ? '<article class="card" style="margin-top:18px"><h2>Нормализованный Initiators</h2>' +
              '<p>Значения «?» и пустые ячейки считаются неизвестными, повторные записи одного инициатора объединяются без потери заполненных данных.</p>' +
              renderInitiatorsPreview(instance) + '</article>'
            : referenceId === 'exceptions'
              ? '<article class="card" style="margin-top:18px"><h2>Нормализованный Exceptions</h2>' +
                '<p>Правила приводятся к единому контракту по тексту причины инцидента; точные дубли объединяются, пустые поля сохраняются как неизвестные.</p>' +
                renderExceptionsPreview(instance) + '</article>'
              : referenceId === 'problem_grade'
                ? '<article class="card" style="margin-top:18px"><h2>Нормализованный ProblemGrade</h2>' +
                  '<p>Привязка строится по четырём уровням классификатора. Вспомогательная Excel-склейка не участвует в поиске и используется только как контроль качества исходного файла.</p>' +
                  renderProblemGradePreview(instance) + '</article>'
                : '');

    document.getElementById('backToReferencesButton').addEventListener('click', () => {
      state.activeReferenceId = null;
      renderReferences();
    });

    if (!config.generatedOnly) bindReferenceDropzone(referenceId);
    if (!config.externalDataset) {
      bindDatasetCandidate(referenceId, () => applyReferenceCandidate(referenceId), () => renderReferenceDetail(referenceId));
    }
  }
