  function failureClassifierStatusMarkup(instance = state.failureClassifier) {
    const statusClass = failureClassifierStatusClass(instance);
    const warning = instance?.validation?.status === 'warning';
    return '<span class="status-badge ' + statusClass + '">' +
      escapeHtml(failureClassifierStatusText(instance)) +
      (warning ? '<span class="status-warning-icon" title="Есть предупреждения">!</span>' : '') +
      '</span>';
  }

  function renderFailureClassifierHistory() {
    const entries = state.failureClassifierHistory || [];
    if (!entries.length) {
      return '<div class="reference-history-empty">История появится после первой загрузки классификатора в этом запуске.</div>';
    }

    return '<div class="reference-history">' + entries.map(entry => {
      const statusClass = entry.validationStatus === 'valid'
        ? 'loaded'
        : (entry.validationStatus || '');
      const statusText = entry.validationStatus === 'invalid'
        ? 'ошибка'
        : entry.validationStatus === 'warning'
          ? 'с предупреждениями'
          : 'загружен';
      const actionText = entry.action === 'updated' ? 'Классификатор заменён' : 'Классификатор загружен';
      return '<div class="reference-history-item">' +
        '<div class="reference-history-marker"></div>' +
        '<div class="reference-history-body">' +
        '<div class="reference-history-head"><strong>' + escapeHtml(actionText) + '</strong>' +
        '<span class="status-badge ' + statusClass + '">' + escapeHtml(statusText) + '</span></div>' +
        '<div class="reference-history-file">' + escapeHtml(entry.fileName) + '</div>' +
        '<div class="small">' + escapeHtml(entry.formatLabel || '—') +
        ' · ' + escapeHtml(entry.rows ?? 0) + ' рабочих записей' +
        ' · ' + escapeHtml(new Date(entry.at).toLocaleString('ru-RU')) +
        (Number.isFinite(entry.fileSize) ? ' · ' + escapeHtml(formatBytes(entry.fileSize)) : '') +
        '</div></div></div>';
    }).join('') + '</div>';
  }

  function renderFailureClassifierValidation(instance) {
    if (!instance) return '<div class="small">Файл ещё не загружен.</div>';
    const errors = instance.validation?.errors || [];
    const warnings = instance.validation?.warnings || [];
    const meta = instance.meta || {};

    let html =
      '<div class="info-list">' +
      '<div class="info-row"><span class="info-key">Кандидатных строк</span><strong>' + escapeHtml(meta.candidateRows ?? '—') + '</strong></div>' +
      '<div class="info-row"><span class="info-key">Исключено по услуге</span><strong>' + escapeHtml(meta.filteredServiceRows ?? '—') + '</strong></div>' +
      '<div class="info-row"><span class="info-key">Исключено: деактивировано</span><strong>' + escapeHtml(meta.filteredDeactivatedRows ?? '—') + '</strong></div>' +
      '<div class="info-row"><span class="info-key">Исключено: САДУ</span><strong>' + escapeHtml(meta.filteredSaduRows ?? '—') + '</strong></div>' +
      '<div class="info-row"><span class="info-key">Неизвестный флаг деактивации</span><strong>' + escapeHtml(meta.filteredUnknownDeactivatedRows ?? 0) + '</strong></div>' +
      '<div class="info-row"><span class="info-key">Неизвестный флаг САДУ</span><strong>' + escapeHtml(meta.filteredUnknownSaduRows ?? 0) + '</strong></div>' +
      '<div class="info-row"><span class="info-key">После фильтров</span><strong>' +
        escapeHtml(meta.afterFiltersRows ?? (meta.normalizedRows != null
          ? meta.normalizedRows + (meta.duplicatesRemoved ?? 0) : '—')) +
      '</strong></div>' +
      '<div class="info-row"><span class="info-key">Дедупликация: удалено повторов</span><strong>' +
        escapeHtml(meta.duplicatesRemoved ?? 0) +
      '</strong></div>' +
      '<div class="info-row"><span class="info-key">Осталось в справочнике</span><strong>' + escapeHtml(meta.normalizedRows ?? '—') + '</strong></div>' +
      '</div>';

    if (!errors.length && !warnings.length) {
      return html + '<div class="validation-ok" style="margin-top:12px">Фильтры и дедупликация применены. Ошибок и предупреждений нет.</div>';
    }

    if (errors.length) {
      html += '<div class="validation-block invalid" style="margin-top:12px"><strong>Ошибки</strong><ul>' +
        errors.map(item => '<li>' + escapeHtml(item) + '</li>').join('') +
        '</ul></div>';
    }
    if (warnings.length) {
      html += '<div class="validation-block warning" style="margin-top:12px"><strong>Предупреждения</strong><ul>' +
        warnings.map(item => '<li>' + escapeHtml(item) + '</li>').join('') +
        '</ul></div>';
    }
    return html;
  }

  function renderFailureClassifierPreview(instance) {
    if (!instance?.records?.length) {
      return '<div class="empty-state compact">После успешной загрузки здесь появятся рабочие данные классификатора.</div>';
    }

    const preview = instance.records.slice(0, 80);
    const rows = preview.map(row =>
      '<tr>' +
      '<td>' + escapeHtml(row.service || '(пусто)') + '</td>' +
      '<td>' + escapeHtml(row.equipment || '—') + '</td>' +
      '<td>' + escapeHtml(row.element || '—') + '</td>' +
      '<td>' + escapeHtml(row.failure || '—') + '</td>' +
      '<td>' + escapeHtml(row.cause || '—') + '</td>' +
      '</tr>'
    ).join('');

    return '<div class="table-scroll preview-table-wrap"><table class="reference-table preview-table">' +
      '<thead><tr><th>Услуга</th><th>Наименование оборудования</th><th>Элемент</th>' +
      '<th>Неисправность</th><th>Причина</th></tr></thead>' +
      '<tbody>' + rows + '</tbody></table></div>' +
      '<div class="small" style="margin-top:8px">Показаны первые ' + preview.length + ' из ' +
      instance.records.length + ' записей. ID и служебные поля входного Excel в рабочем справочнике не сохраняются.</div>';
  }

  function bindFailureClassifierDropzone() {
    bindDatasetDropzone('failureClassifierDropzone', 'selectFailureClassifierButton',
      file => loadFailureClassifierFile(file), () => {
        if (state.route === 'failure_classifier' && state.activeFailureClassifierId) renderFailureClassifierDetail();
      });
  }

  function renderFailureClassifierDetail() {
    const config = failureClassifierConfig;
    const instance = state.failureClassifier;
    const meta = instance?.meta || {};
    const sourceHeaders = meta.sourceHeaders || [];

    setHeader('Данные', config.title, 'Карточка рабочего классификатора отказов.');

    const formatInfo = instance
      ? '<div class="info-list">' +
        '<div class="info-row"><span class="info-key">Распознанный формат</span><strong>' + escapeHtml(meta.formatLabel || 'Не распознан') + '</strong></div>' +
        '<div class="info-row"><span class="info-key">Лист Excel</span><strong>' + escapeHtml(meta.sourceSheet || '—') + '</strong></div>' +
        '<div class="info-row"><span class="info-key">Строка заголовка</span><strong>' + escapeHtml(meta.headerRow || '—') + '</strong></div>' +
        '<div class="info-row"><span class="info-key">Исходных строк</span><strong>' + escapeHtml(meta.sourceRows ?? '—') + '</strong></div>' +
        '<div class="info-row"><span class="info-key">Отфильтровано</span><strong>' + escapeHtml(meta.filteredRows ?? '—') + '</strong></div>' +
        '</div>' +
        (sourceHeaders.length
          ? '<div class="small" style="margin-top:12px"><strong>Найдены поля:</strong> ' + escapeHtml(sourceHeaders.join(' · ')) + '</div>'
          : '')
      : '<div class="empty-state compact">После загрузки здесь появится распознанный формат и структура входного Excel.</div>';

    const canonicalRows = FAILURE_CLASSIFIER_CANONICAL_COLUMNS.map(([key, title]) =>
      '<div class="info-row"><span class="info-key">' + escapeHtml(key) + '</span><strong>' + escapeHtml(title) + '</strong></div>'
    ).join('');

    el.pageContent.innerHTML =
      '<div class="reference-detail-toolbar">' +
      '<button class="button ghost" id="failureClassifierBackButton">← К справочникам</button></div>' +
      '<div class="grid cols-2 reference-overview">' +
      '<article class="card flat"><h3>Назначение</h3><p>' + escapeHtml(config.description) + '</p>' +
      '<div class="info-list">' +
      '<div class="info-row"><span class="info-key">ID</span><strong>' + escapeHtml(config.id) + '</strong></div>' +
      '<div class="info-row"><span class="info-key">Версия схемы</span><strong>' + escapeHtml(config.schemaVersion) + '</strong></div>' +
      '<div class="info-row"><span class="info-key">Свежесть источника</span><strong>' + escapeHtml(failureClassifierFreshness(instance)) + '</strong></div>' +
      '</div></article>' +
      '<article class="card flat reference-upload-panel"><h3>Загрузка справочника</h3>' +
      '<div class="reference-current-state"><div class="small">Текущий статус</div><strong>' +
      escapeHtml(instance ? ('Используется файл «' + (meta.fileName || '—') + '»') : 'Справочник ещё не загружен') +
      '</strong>' +
      (instance?.meta?.loadedAt ? '<div class="small">' + escapeHtml(new Date(meta.loadedAt).toLocaleString('ru-RU')) + '</div>' : '') +
      '</div>' +
      '<div class="dropzone reference-dropzone" id="failureClassifierDropzone"><div>' +
      '<div class="dropzone-title">Перетащите Excel сюда</div>' +
      '<div class="dropzone-text">' + (instance ? 'или выберите новый файл для замены' : 'или выберите файл на компьютере') + '</div>' +
      '<button class="button" id="selectFailureClassifierButton">' + (instance ? 'Выбрать другой файл' : 'Выбрать файл') + '</button>' +
      '</div></div>' +
      renderDatasetCandidate(FAILURE_CLASSIFIER_ID, renderFailureClassifierValidation, renderFailureClassifierPreview) +
      '<div class="reference-history-title">История загрузки</div>' + renderFailureClassifierHistory() +
      '</article></div>' +

      '<div class="reference-control-grid" style="margin-top:18px">' +
      '<article class="card"><h2>Текущий экземпляр</h2>' +
      '<div class="reference-metrics">' +
      '<div><span>Статус</span><strong>' + failureClassifierStatusMarkup(instance) + '</strong></div>' +
      '<div><span>Формат</span><strong>' + escapeHtml(meta.formatLabel || '—') + '</strong></div>' +
      '<div><span>Рабочие записи</span><strong>' + escapeHtml(meta.normalizedRows ?? '—') + '</strong></div>' +
      '<div><span>Исключено</span><strong>' + escapeHtml(meta.filteredRows ?? '—') + '</strong></div>' +
      '<div><span>Удалено дублей</span><strong>' +
        escapeHtml(meta.duplicatesRemoved ?? 0) +
      '</strong></div>' +
      '<div><span>Варианты услуги</span><strong>' + escapeHtml(meta.serviceCount ?? '—') + '</strong></div>' +
      '<div><span>Оборудование</span><strong>' + escapeHtml(meta.equipmentCount ?? '—') + '</strong></div>' +
      '<div><span>Элементы</span><strong>' + escapeHtml(meta.elementCount ?? '—') + '</strong></div>' +
      '<div><span>Неисправности</span><strong>' + escapeHtml(meta.failureCount ?? '—') + '</strong></div>' +
      '<div><span>Причины</span><strong>' + escapeHtml(meta.causeCount ?? '—') + '</strong></div>' +
      '</div></article>' +
      '<article class="card"><h2>Используется автоматически</h2>' +
      '<div class="empty-state compact">Для других модулей публикуются только пять текстовых полей рабочего классификатора. ID и служебные признаки наружу не передаются.</div>' +
      '</article></div>' +

      '<div class="grid cols-2" style="margin-top:18px">' +
      '<article class="card flat"><h3>Входной Excel</h3>' + formatInfo + '</article>' +
      '<article class="card flat"><h3>Рабочий контракт</h3>' +
      '<p>После фильтрации в системе сохраняются только пять текстовых полей.</p>' +
      '<div class="info-list">' + canonicalRows + '</div></article></div>' +

      '<article class="card" style="margin-top:18px"><h2>Правила фильтрации</h2>' +
      '<div class="info-list">' +
      '<div class="info-row"><span class="info-key">Услуга</span><strong>пусто или ОГР</strong></div>' +
      '<div class="info-row"><span class="info-key">ОГР</span><strong>' + escapeHtml(FAILURE_CLASSIFIER_OGR_SERVICE) + '</strong></div>' +
      '<div class="info-row"><span class="info-key">Деактивирована</span><strong>только «Нет» или пусто</strong></div>' +
      '<div class="info-row"><span class="info-key">САДУ</span><strong>только «Нет» или пусто</strong></div>' +
      '<div class="info-row"><span class="info-key">ID</span><strong>игнорируются после чтения входного файла</strong></div>' +
      '<div class="info-row"><span class="info-key">Дубли</span><strong>одинаковые текстовые комбинации удаляются для всех загрузок этого классификатора</strong></div>' +
      '</div></article>' +

      '<article class="card" style="margin-top:18px"><h2>Проверка</h2>' +
      renderFailureClassifierValidation(instance) + '</article>' +

      '<article class="card" style="margin-top:18px"><h2>Данные</h2>' +
      '<p>Предпросмотр рабочего справочника после фильтрации и нормализации.</p>' +
      renderFailureClassifierPreview(instance) + '</article>';

    document.getElementById('failureClassifierBackButton')?.addEventListener('click', () => {
      state.activeFailureClassifierId = null;
      navigate('references');
    });

    bindFailureClassifierDropzone();
    bindDatasetCandidate(FAILURE_CLASSIFIER_ID, applyFailureClassifierCandidate, renderFailureClassifierDetail);
  }

  function renderFailureClassifier() {
    if (state.activeFailureClassifierId) return renderFailureClassifierDetail();

    const config = failureClassifierConfig;
    const instance = state.failureClassifier;
    const meta = instance?.meta || {};

    setHeader('Данные', 'Классификатор отказов', 'Управление рабочим справочником классификатора отказов.');

    const row =
      '<tr class="reference-row" data-failure-classifier-open="' + escapeHtml(config.id) + '">' +
      '<td><button class="link-button reference-name" data-failure-classifier-open-button="' + escapeHtml(config.id) + '">' +
      escapeHtml(config.title) + '</button><div class="small">' + escapeHtml(config.description) + '</div></td>' +
      '<td>' + failureClassifierStatusMarkup(instance) + '</td>' +
      '<td>' + (instance
        ? '<div class="reference-file">' + escapeHtml(meta.fileName || '—') + '</div><div class="small">' + escapeHtml(formatBytes(meta.fileSize)) + '</div>'
        : '<span class="small">—</span>') + '</td>' +
      '<td>' + escapeHtml(meta.normalizedRows ?? '—') + '</td>' +
      '<td>' + escapeHtml(failureClassifierFreshness(instance)) + '</td>' +
      '<td class="reference-actions"><button class="button" data-failure-classifier-open-button="' +
      escapeHtml(config.id) + '">Открыть</button></td></tr>';

    el.pageContent.innerHTML =
      '<div class="grid cols-2">' +
      '<article class="card flat"><h3>Назначение</h3><p>Раздел принимает рабочую или системную Excel-форму классификатора, фильтрует область нашей поддержки и публикует единый текстовый справочник.</p></article>' +
      '<article class="card flat"><h3>Обработка данных</h3><p>У классификатора свой загрузчик. Он распознаёт Excel по структуре, нормализует и проверяет данные, применяет правила фильтрации и удаляет дубли, после чего помещает готовый рабочий набор в систему.</p><p>В систему передаются только поля, которые нужны для классификации отказов.</p></article>' +
      '</div>' +
      '<article class="card" style="margin-top:18px">' +
      '<h2>Классификаторы</h2>' +
      '<p>В разделе один рабочий справочник — классификатор отказов оборудования.</p>' +
      '<div class="table-scroll"><table class="reference-table">' +
      '<thead><tr><th>Справочник</th><th>Статус</th><th>Файл</th><th>Записи</th><th>Свежесть</th><th></th></tr></thead>' +
      '<tbody>' + row + '</tbody></table></div></article>';

    el.pageContent.querySelectorAll('[data-failure-classifier-open-button]').forEach(button => button.addEventListener('click', event => {
      event.stopPropagation();
      state.activeFailureClassifierId = button.dataset.failureClassifierOpenButton;
      renderFailureClassifier();
    }));

    el.pageContent.querySelectorAll('[data-failure-classifier-open]').forEach(rowNode => rowNode.addEventListener('click', event => {
      if (event.target.closest('[data-failure-classifier-open-button]')) return;
      state.activeFailureClassifierId = rowNode.dataset.failureClassifierOpen;
      renderFailureClassifier();
    }));
  }
