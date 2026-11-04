  function equipmentStatusInfo(instance) {
    if (!instance) return { text: 'не загружен', className: '', warning: false };
    if (instance.validation?.status === 'invalid') return { text: 'ошибка', className: 'invalid', warning: false };
    const sourceType = instance.meta?.sourceType;
    const integrated = sourceType === 'embedded' || sourceType === 'sqlite';
    const warning = instance.validation?.status === 'warning';
    const text = sourceType === 'sqlite' ? 'Из SQLite' : (integrated ? 'Интегрирован' : 'Обновлён');
    return { text, className: warning ? 'warning' : 'loaded', warning };
  }

  function equipmentStatusMarkup(instance) {
    const info = equipmentStatusInfo(instance);
    return '<span class="status-badge ' + info.className + '">' + escapeHtml(info.text) +
      (info.warning ? '<span class="status-warning-icon" title="Есть предупреждения">!</span>' : '') + '</span>';
  }

  function equipmentFreshnessLabel(id, instance) {
    if (!instance) return '—';
    if (id === 'combined') return instance.meta?.freshnessLabel || 'составная';
    return instance.meta?.freshness || 'не определена';
  }

  function equipmentStagingMarkup() {
    const staging = state.equipmentStaging;
    const files = staging.files || [];
    const fileList = files.length
      ? '<div class="equipment-staging-files">' + files.map(file => '<div class="equipment-staging-file"><strong>' + escapeHtml(file.name) + '</strong><span>' + escapeHtml(formatBytes(file.size)) + '</span></div>').join('') + '</div>'
      : '<div class="small">Файлы ещё не выбраны.</div>';
    const messages = (staging.messages || []).length
      ? '<div class="equipment-staging-messages">' + staging.messages.map(message => '<div>' + escapeHtml(message) + '</div>').join('') + '</div>'
      : '';
    return fileList + messages;
  }

  function equipmentPreview(instance, id) {
    const columns = id === 'combined' ? EQUIPMENT_COMBINED_COLUMNS : equipmentConfig[id].approvedColumns;
    if (!instance) return '<div class="empty-state compact">Файл ещё не загружен.</div>';
    if (!columns.length) {
      return '<div class="empty-state compact">Этот источник не публикует отдельные поля в Equipment_Combined. Файл проверяется по схеме и используется как служебный источник текущего набора Equipment.</div>';
    }
    if (!instance.records?.length) return '<div class="empty-state compact">Нет записей для отображения.</div>';
    const preview = instance.records.slice(0, 60);
    const head = columns.map(column => '<th>' + escapeHtml(column) + '</th>').join('');
    const body = preview.map(record => '<tr>' + columns.map(column => '<td>' + escapeHtml(record[column] ?? '—') + '</td>').join('') + '</tr>').join('');
    return '<div class="table-scroll preview-table-wrap equipment-preview"><table class="reference-table preview-table"><thead><tr>' + head + '</tr></thead><tbody>' + body + '</tbody></table></div>' +
      '<div class="small" style="margin-top:8px">Показаны первые ' + preview.length + ' из ' + instance.records.length + ' записей. Для Equipment_Combined также выводятся расчётные поля.</div>';
  }

  function equipmentValidationMarkup(instance) {
    if (!instance) return '<div class="small">Файл ещё не загружен.</div>';
    const errors = instance.validation?.errors || [];
    const warnings = instance.validation?.warnings || [];
    if (!errors.length && !warnings.length) return '<div class="validation-ok">Ошибок и предупреждений нет.</div>';
    let html = '';
    if (errors.length) html += '<div class="validation-block invalid"><strong>Ошибки</strong><ul>' + errors.map(item => '<li>' + escapeHtml(item) + '</li>').join('') + '</ul></div>';
    if (warnings.length) html += '<div class="validation-block warning"><strong>Предупреждения</strong><ul>' + warnings.map(item => '<li>' + escapeHtml(item) + '</li>').join('') + '</ul></div>';
    return html;
  }

  function renderEquipmentHistory(id) {
    const entries = state.equipmentHistory[id] || [];
    if (!entries.length) return '<div class="reference-history-empty">История появится после загрузки или замены файла в этом запуске.</div>';
    return '<div class="reference-history">' + entries.map(entry => {
      const statusText = entry.action === 'rejected' ? 'Отклонён' : 'Обновлён';
      const statusClass = entry.action === 'rejected' ? 'invalid' : (entry.status === 'warning' ? 'warning' : 'loaded');
      return '<div class="reference-history-item"><div class="reference-history-marker"></div><div class="reference-history-body">' +
        '<div class="reference-history-head"><strong>' + escapeHtml(entry.action === 'updated' ? 'Файл заменён' : entry.action === 'rejected' ? 'Загрузка отклонена' : 'Файл загружен') + '</strong>' +
        '<span class="status-badge ' + statusClass + '">' + escapeHtml(statusText) + (entry.status === 'warning' ? '<span class="status-warning-icon">!</span>' : '') + '</span></div>' +
        '<div class="reference-history-file">' + escapeHtml(entry.fileName) + '</div><div class="small">' + escapeHtml(new Date(entry.at).toLocaleString('ru-RU')) + '</div></div></div>';
    }).join('') + '</div>';
  }

  function equipmentPersistentHistoryMarkup(id, instance) {
    if (id === 'combined') {
      return '<p class="small">История ведётся отдельно по каждому исходному каталогу. ' +
        'Equipment_Combined пересчитывается из текущих источников.</p>';
    }
    const history = globalThis.ReclassifierRuntimeDataRepository?.get?.(id)
      ?.meta?.equipmentHistory || instance?.meta?.equipmentHistory;
    if (!history?.snapshots?.length) {
      return '<p class="small">Исторические наблюдения появятся после следующего ' +
        'подтверждённого обновления секций. Предыдущие даты не восстанавливаются по догадкам.</p>';
    }
    const recent = history.events.slice(-25).reverse().map(event => {
      const meaning = {
        first_observed:'Впервые наблюдается',
        returned_to_observation:'Снова наблюдается',
        moved:'Изменён рудник',
        attributes_changed:'Изменены реквизиты',
        decommissioned:'Окончательно выведен',
        missing_from_complete_scope:'Отсутствует в полной секции'
      }[event.type] || event.type;
      return '<tr><td>' + escapeHtml(event.id) + '</td><td>' +
        escapeHtml(meaning) + '</td><td>' +
        escapeHtml(event.before?.unit || '—') + '</td><td>' +
        escapeHtml(event.after?.unit || '—') + '</td><td>' +
        escapeHtml(event.sourceDate || 'не установлена') + '</td><td>' +
        escapeHtml(event.eventDate || '—') + '</td></tr>';
    }).join('');
    return '<div class="small">Снимков: ' + history.snapshots.length +
      ', событий: ' + history.events.length +
      '. Дата наблюдения относится к источнику, не к вводу в эксплуатацию. ' +
      'Дата события фиксируется только при подтверждённом выбытии.</div>' +
      (recent ? '<div class="table-scroll"><table class="reference-table">' +
        '<thead><tr><th>ID</th><th>Событие</th><th>Было</th><th>Стало</th>' +
        '<th>Дата наблюдения</th><th>Дата события</th></tr></thead>' +
        '<tbody>' + recent + '</tbody></table></div>' : '');
  }

  function downloadEquipmentCombined() {
    const instance = state.equipmentCombined;
    if (!instance?.records?.length || !window.XLSX) return;
    const sheet = window.XLSX.utils.json_to_sheet(instance.records, { header: EQUIPMENT_COMBINED_COLUMNS });
    const book = window.XLSX.utils.book_new();
    window.XLSX.utils.book_append_sheet(book, sheet, 'Equipment_Combined');
    window.XLSX.writeFile(book, 'Equipment_Combined.xlsx');
  }

  function bindEquipmentStagingDropzone(dropzone) {
    if (!dropzone) return;
    bindDatasetDropzone('equipmentCombinedDropzone', 'selectEquipmentCombinedFilesButton',
      files => setEquipmentStagingFiles(files), () => renderEquipmentDetail('combined'), true);
  }

  function renderEquipmentDetail(id) {
    const config = equipmentConfig[id];
    const instance = id === 'combined' ? state.equipmentCombined : state.equipmentCatalogs[id];
    const meta = instance?.meta || {};
    setHeader('Данные', config.title, config.description);
    const sourceList = id === 'combined' && meta.sourceCatalogs?.length
      ? '<div class="info-list">' + meta.sourceCatalogs.map(source => '<div class="info-row"><span class="info-key">' + escapeHtml(equipmentConfig[source.id]?.title || source.id) + '</span><strong>' + escapeHtml(source.freshness || '—') + '</strong></div>').join('') + '</div>'
      : '';
    const mergeStats = id === 'combined' && instance
      ? '<div class="reference-metrics">' +
        '<div><span>Строк Equipment</span><strong>' + escapeHtml(meta.normalizedRows ?? 0) + '</strong></div>' +
        '<div><span>Колонок</span><strong>' + escapeHtml(EQUIPMENT_COMBINED_COLUMNS.length) + '</strong></div>' +
        '<div><span>Transport найден</span><strong>' + escapeHtml((meta.transportMatches ?? 0) + ' / ' + (meta.transportCandidates ?? 0)) + '</strong></div>' +
        '<div><span>Связано с Zabbix</span><strong>' + escapeHtml(meta.zabbixEquipmentMatches ?? 0) + '</strong></div>' +
        '<div><span>Правила</span><strong>Equipment ' + escapeHtml(EQUIPMENT_RULES_VERSION) + '</strong></div></div>'
      : '';

    const uploadPanel = id === 'combined'
      ? '<aside class="card flat reference-upload-panel"><h3>Загрузка обновлений</h3>' +
        '<p>Выберите от 1 до 6 Excel-файлов. Можно обновить один или несколько источников — Mounted, Stationary, Transport, StartPoints и Zabbix; остальные будут взяты из текущего рабочего набора. Equipment_Combined может присутствовать шестым только как контрольный файл и не используется как источник пересчёта.</p>' +
        '<div class="dropzone reference-dropzone" id="equipmentCombinedDropzone"><div><div class="dropzone-title">Перетащите Excel сюда</div><div class="dropzone-text">или выберите один / несколько файлов</div><button class="button" id="selectEquipmentCombinedFilesButton">Выбрать файлы</button></div></div>' +
        '<div class="reference-history-title">Подготовленная партия</div>' + equipmentStagingMarkup() +
        '<div class="equipment-action-row"><button class="button primary" id="processEquipmentButton"' + (state.equipmentStaging.files.length ? '' : ' disabled') + '>Обработать</button></div>' +
        renderDatasetCandidate('combined', equipmentValidationMarkup, candidate => equipmentPreview(candidate, 'combined')) +
        '<div class="small equipment-action-help">«Обработать» строит кандидат и не меняет рабочие данные. «Применить данные» заменяет только загруженные источники и публикует полный пересчитанный Equipment_Combined.</div>' +
        '<div class="reference-history-title">История текущего запуска</div>' + renderEquipmentHistory('combined') + '</aside>'
      : '<aside class="card flat reference-upload-panel"><h3>Источник Equipment_Combined</h3><p>Этот каталог обновляется только через плашку загрузки в Equipment_Combined. Так частичная загрузка одного источника всегда пересчитывается вместе с остальными текущими каталогами.</p>' +
        '<div class="reference-history-title">Постоянная история оборудования</div>' +
        equipmentPersistentHistoryMarkup(id, instance) +
        '<div class="reference-history-title">История текущего запуска</div>' +
        renderEquipmentHistory(id) + '</aside>';

    el.pageContent.innerHTML = '<div class="reference-detail-toolbar"><button class="button ghost" id="equipmentBackButton">← Справочники</button>' +
      (id === 'combined' && instance?.records?.length ? '<button class="button" id="downloadEquipmentCombinedButton">Скачать XLSX</button>' : '') + '</div>' +
      '<div class="reference-control-grid">' +
      '<article class="card"><h2>' + escapeHtml(config.title) + '</h2><p>' + escapeHtml(config.description) + '</p>' +
      '<div class="reference-metrics">' +
      '<div><span>Статус</span><strong>' + equipmentStatusMarkup(instance) + '</strong></div>' +
      '<div><span>Файл</span><strong>' + escapeHtml(meta.fileName || '—') + '</strong></div>' +
      '<div><span>Записи</span><strong>' + escapeHtml(meta.normalizedRows ?? '—') + '</strong></div>' +
      '<div><span>Свежесть</span><strong>' + escapeHtml(equipmentFreshnessLabel(id, instance)) + '</strong></div></div>' + mergeStats +
      '<h3 style="margin-top:20px">Проверка</h3>' + equipmentValidationMarkup(instance) +
      (sourceList ? '<h3 style="margin-top:20px">Источники Combined</h3>' + sourceList : '') + '</article>' +
      uploadPanel + '</div>' +
      '<article class="card" style="margin-top:18px"><h3>Данные</h3><p>' + (id === 'combined' ? 'Итоговые и расчётные поля рабочего справочника.' : 'Нормализованные поля текущего источника.') + '</p>' + equipmentPreview(instance, id) + '</article>';

    document.getElementById('equipmentBackButton')?.addEventListener('click', () => { state.activeEquipmentId = null; renderReferences(); });
    document.getElementById('downloadEquipmentCombinedButton')?.addEventListener('click', downloadEquipmentCombined);

    if (id === 'combined') {
      bindEquipmentStagingDropzone(document.getElementById('equipmentCombinedDropzone'));
      document.getElementById('processEquipmentButton')?.addEventListener('click', async () => {
        const button = document.getElementById('processEquipmentButton');
        if (button) button.disabled = true;
        await processEquipmentStaging();
        renderEquipmentDetail('combined');
      });
      bindDatasetCandidate('combined', commitEquipmentStaging, () => renderEquipmentDetail('combined'));
    }
  }

  // Rendered at the bottom of References; Equipment retains its own detail and workflow.
  function renderEquipmentCatalogSection() {
    const buildNotice = '<div class="notice equipment-build-notice"><strong>Каталоги оборудования не входят в сборку.</strong> Для расчёта загрузите пользовательские источники локально.</div>';

    const rows = EQUIPMENT_CATALOG_ORDER.map(id => {
      const config = equipmentConfig[id];
      const current = id === 'combined' ? state.equipmentCombined : state.equipmentCatalogs[id];
      const currentMeta = current?.meta || {};
      const records = currentMeta.normalizedRows ?? (current?.records?.length ?? '—');
      return '<tr class="reference-row" data-equipment-open="' + escapeHtml(id) + '">' +
        '<td><button class="link-button reference-name" data-equipment-open-button="' + escapeHtml(id) + '">' + escapeHtml(config.title) + '</button><div class="small">' + escapeHtml(config.description) + '</div></td>' +
        '<td>' + equipmentStatusMarkup(current) + '</td>' +
        '<td>' + (current ? '<div class="reference-file">' + escapeHtml(currentMeta.fileName || '—') + '</div>' : '<span class="small">—</span>') + '</td>' +
        '<td>' + escapeHtml(records) + '</td>' +
        '<td>' + escapeHtml(config.approvedColumns.length) + '</td>' +
        '<td>' + escapeHtml(equipmentFreshnessLabel(id, current)) + '</td>' +
        '<td class="reference-actions"><button class="button" data-equipment-open-button="' + escapeHtml(id) + '">Открыть</button></td></tr>';
    }).join('');

    return '<article class="card" id="equipmentCatalogSection" style="margin-top:18px"><h2>Справочники оборудования</h2>' +
      buildNotice +
      '<p>Основная точка обновления — Equipment_Combined. Загрузка работает в два этапа: «Обработать» строит проверенный кандидат без изменения рабочих данных; «Применить данные» заменяет только загруженные источники, сохраняет остальные текущие источники и полностью пересчитывает Equipment_Combined.</p>' +
      '<div class="table-scroll" style="margin-top:18px"><table class="reference-table"><thead><tr><th>Справочник</th><th>Статус</th><th>Файл</th><th>Записи</th><th>Поля</th><th>Свежесть</th><th></th></tr></thead><tbody>' + rows + '</tbody></table></div></article>' +
      '<details class="notice" style="margin-top:18px"><summary>Подробное описание алгоритма · Equipment Merge Rules ' + escapeHtml(EQUIPMENT_RULES_VERSION) + '</summary><p>Stationary + Mounted объединяются вертикально; Transport связывается с Mounted по unit + transport/name; Zabbix — по equipment → id; «Статус эксплуатации» = «Не активен», если not_working_since непустой, иначе «Активен».</p></details>';

  }

  function bindEquipmentCatalogSection() {
    el.pageContent.querySelectorAll('[data-equipment-open-button]').forEach(button => button.addEventListener('click', event => {
      event.stopPropagation();
      state.activeEquipmentId = button.dataset.equipmentOpenButton;
      renderReferences();
    }));
    el.pageContent.querySelectorAll('[data-equipment-open]').forEach(row => row.addEventListener('click', () => {
      state.activeEquipmentId = row.dataset.equipmentOpen;
      renderReferences();
    }));
  }
