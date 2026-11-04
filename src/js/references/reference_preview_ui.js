// FILE CONTRACT: Reference Dataset preview/status renderers.
// Purpose: render validation, tabular previews and supporting Dataset status blocks.
// Owns: read-only presentation for Reference, Mobile Brigade Data and ITSM Data instances.
// Reads: normalized Dataset instances and schema constants.
// Writes: HTML strings only.
// Public API: internal render helpers consumed by Reference detail composition.
// Must not: select files, mutate Dataset state or access persistence APIs.
// Related tests: test_reference_architecture.py, test_database_workspace_contract.py,
//                smoke_app_runtime.js, test_architecture_guardrails.py.

// ============================================================================
// REFERENCE DATASET PREVIEW RENDERERS
// ============================================================================
  function renderReferenceValidation(instance) {
    if (!instance) return '<div class="small">Файл ещё не загружен.</div>';
    const errors = instance.validation?.errors || [];
    const warnings = instance.validation?.warnings || [];

    if (!errors.length && !warnings.length) {
      return '<div class="validation-ok">Ошибок и предупреждений нет.</div>';
    }

    let html = '';
    if (errors.length) {
      html += '<div class="validation-block invalid"><strong>Ошибки</strong><ul>' +
        errors.map(item => '<li>' + escapeHtml(item) + '</li>').join('') +
        '</ul></div>';
    }
    if (warnings.length) {
      html += '<div class="validation-block warning"><strong>Предупреждения</strong><ul>' +
        warnings.map(item => '<li>' + escapeHtml(item) + '</li>').join('') +
        '</ul></div>';
    }
    return html;
  }

  function renderTypeRequestPreview(instance) {
    if (!instance?.records?.length) {
      return '<div class="empty-state compact">После успешной загрузки здесь появится нормализованный TypeRequest.</div>';
    }

    const preview = instance.records.slice(0, 80);
    const rows = preview.map(row =>
      '<tr><td>' + escapeHtml(row.shortDescription || '—') + '</td>' +
      '<td>' + escapeHtml(row.workType || '—') + '</td>' +
      '<td><code>' + escapeHtml(row.requestKey || '—') + '</code></td></tr>'
    ).join('');

    return planHtml + '<div class="table-scroll preview-table-wrap"><table class="reference-table preview-table">' +
      '<thead><tr><th>Краткое описание (типовой запрос)</th><th>Вид работ</th><th>Нормализованный ключ</th></tr></thead>' +
      '<tbody>' + rows + '</tbody></table></div>' +
      '<div class="small" style="margin-top:8px">Показаны первые ' + preview.length + ' из ' + instance.records.length + ' правил. Для сопоставления очищаются неразрывные/лишние пробелы и регистр; пунктуация и текст формулировки сохраняются.</div>';
  }

  function renderCustomersPreview(instance) {
    if (!instance?.records?.length) {
      return '<div class="empty-state compact">После успешной загрузки здесь появится нормализованный Customers.</div>';
    }

    const preview = instance.records.slice(0, 60);
    const rows = preview.map(row =>
      '<tr><td>' + escapeHtml(row.mine || '—') + '</td>' +
      '<td>' + escapeHtml(row.mineSource || '—') + '</td>' +
      '<td>' + escapeHtml(row.customerInternal || row.customerCode || '—') + '</td>' +
      '<td>' + escapeHtml(row.customerShort || '—') + '</td>' +
      '<td>' + escapeHtml(row.customerFull || '—') + '</td></tr>'
    ).join('');

    return '<div class="table-scroll preview-table-wrap"><table class="reference-table preview-table">' +
      '<thead><tr><th>Рудник</th><th>Исходное название</th><th>Заказчик (для нас)</th><th>Заказчик кратко</th><th>Заказчик полностью</th></tr></thead>' +
      '<tbody>' + rows + '</tbody></table></div>' +
      '<div class="small" style="margin-top:8px">Показаны первые ' + preview.length + ' из ' + instance.records.length + ' записей. Префиксы «р.» / «ш.» убираются только из нормализованного ключа рудника; исходное название сохраняется.</div>';
  }

  function renderProblemGradePreview(instance) {
    if (!instance?.records?.length) {
      return '<div class="empty-state compact">После успешной загрузки здесь появится нормализованный ProblemGrade.</div>';
    }

    const preview = instance.records.slice(0, 60);
    const rows = preview.map(row =>
      '<tr><td>' + escapeHtml(row.problemId || '—') + '</td>' +
      '<td>' + escapeHtml(row.problemStatus || '—') + '</td>' +
      '<td>' + escapeHtml(row.problemName || '—') + '</td>' +
      '<td>' + escapeHtml(row.equipment || '—') + '</td>' +
      '<td>' + escapeHtml(row.element || '—') + '</td>' +
      '<td>' + escapeHtml(row.fault || '—') + '</td>' +
      '<td>' + escapeHtml(row.reason || '—') + '</td>' +
      '<td>' + escapeHtml(row.normalizationDecision || '—') + '</td></tr>'
    ).join('');

    return '<div class="table-scroll preview-table-wrap"><table class="reference-table preview-table">' +
      '<thead><tr><th>IT-проблема</th><th>Статус</th><th>Имя проблемы</th><th>Оборудование</th><th>Элемент</th><th>Неисправность</th><th>Причина</th><th>Нормализация</th></tr></thead>' +
      '<tbody>' + rows + '</tbody></table></div>' +
      '<div class="small" style="margin-top:8px">Показаны первые ' + preview.length + ' из ' + instance.records.length + ' привязок. Ключ классификатора вычисляется из четырёх уровней; вспомогательная Excel-склейка используется только для проверки.</div>';
  }

  function renderExceptionsPreview(instance) {
    if (!instance?.records?.length) {
      return '<div class="empty-state compact">После успешной загрузки здесь появится нормализованный Exceptions.</div>';
    }

    const preview = instance.records.slice(0, 80);
    const rows = preview.map(row =>
      '<tr><td>' + escapeHtml(row.number || '—') + '</td>' +
      '<td>' + escapeHtml(row.exception || '—') + '</td>' +
      '<td>' + escapeHtml(row.decision || '—') + '</td>' +
      '<td>' + escapeHtml(row.category || '—') + '</td></tr>'
    ).join('');

    return '<div class="table-scroll preview-table-wrap"><table class="reference-table preview-table">' +
      '<thead><tr><th>№</th><th>Исключение для причины инцидента</th><th>Решение</th><th>Категория</th></tr></thead>' +
      '<tbody>' + rows + '</tbody></table></div>' +
      '<div class="small" style="margin-top:8px">Показаны первые ' + preview.length + ' из ' + instance.records.length + ' правил. Пустые значения и «?» отображаются как «—».</div>';
  }

  function renderInitiatorsPreview(instance) {
    if (!instance?.records?.length) {
      return '<div class="empty-state compact">После успешной загрузки здесь появится нормализованный Initiators.</div>';
    }

    const preview = instance.records.slice(0, 60);
    const rows = preview.map(row =>
      '<tr><td>' + escapeHtml(row.initiator || '—') + '</td>' +
      '<td>' + escapeHtml(row.group || '—') + '</td>' +
      '<td>' + escapeHtml(row.groupDetailed || '—') + '</td>' +
      '<td>' + escapeHtml(row.comments || '—') + '</td></tr>'
    ).join('');

    return '<div class="table-scroll preview-table-wrap"><table class="reference-table preview-table">' +
      '<thead><tr><th>Инициатор</th><th>Группа</th><th>Группа с комментариями</th><th>Комментарии</th></tr></thead>' +
      '<tbody>' + rows + '</tbody></table></div>' +
      '<div class="small" style="margin-top:8px">Показаны первые ' + preview.length + ' из ' + instance.records.length + ' нормализованных инициаторов. Пустые значения и «?» отображаются как «—».</div>';
  }

  function renderReclassificationPreview(instance) {
    if (!instance?.records?.length) {
      return '<div class="empty-state compact">После успешной загрузки здесь появится нормализованный Reclassification.</div>';
    }

    const preview = instance.records.slice(0, 40);
    const rows = preview.map(row =>
      '<tr><td>' + escapeHtml(row.dateRegistered || '—') + '</td>' +
      '<td>' + escapeHtml(row.dateCompleted || '—') + '</td>' +
      '<td>' + escapeHtml(row.number || '—') + '</td>' +
      '<td>' + escapeHtml(row.territory || '—') + '</td>' +
      '<td>' + escapeHtml(row.equipment || '—') + '</td>' +
      '<td>' + escapeHtml(row.element || '—') + '</td>' +
      '<td>' + escapeHtml(row.fault || '—') + '</td>' +
      '<td>' + escapeHtml(row.incidentReason || '—') + '</td></tr>'
    ).join('');

    return '<div class="table-scroll preview-table-wrap"><table class="reference-table preview-table">' +
      '<thead><tr><th>Дата регистрации</th><th>Дата выполнения</th><th>Номер</th><th>Территория</th><th>Оборудование</th><th>Элемент</th><th>Неисправность</th><th>Причина</th></tr></thead>' +
      '<tbody>' + rows + '</tbody></table></div>' +
      '<div class="small" style="margin-top:8px">Показаны первые ' + preview.length + ' из ' + instance.records.length + ' записей. Набор отсортирован по «Дата выполнения обращения» по возрастанию.</div>';
  }

  function renderDriversPreview(instance) {
    if (!instance?.records?.length) {
      return '<div class="empty-state compact">После успешной загрузки здесь появится вертикальное представление Drivers.</div>';
    }

    const preview = instance.records.slice(0, 40);
    const rows = preview.map(row =>
      '<tr><td>' + escapeHtml(row.mine) + '</td>' +
      '<td>' + escapeHtml(row.name) + '</td>' +
      '<td>' + escapeHtml(row.service || '—') + '</td>' +
      '<td>' + escapeHtml(row.system || '—') + '</td>' +
      '<td>' + escapeHtml(row.value ?? (row.valueState === 'dash' ? '—' : '')) + '</td>' +
      '<td>' + escapeHtml(row.unit || '') + '</td></tr>'
    ).join('');

    return '<div class="table-scroll preview-table-wrap"><table class="reference-table preview-table">' +
      '<thead><tr><th>Рудник</th><th>Наименование</th><th>Сервис</th><th>Система</th><th>Значение</th><th>Ед.</th></tr></thead>' +
      '<tbody>' + rows + '</tbody></table></div>' +
      '<div class="small" style="margin-top:8px">Показаны первые ' + preview.length + ' из ' + instance.records.length + ' вертикальных записей.</div>';
  }

  function renderMobileBrigadeDataPreview(instance) {
    if (!instance?.records?.length) {
      return '<div class="empty-state compact">Набор появится после успешной обработки файлов в модуле «Мобильные бригады».</div>';
    }

    const plan = instance.meta?.upsertPlan || null;
    const planHtml = plan
      ? '<div class="reference-metrics" style="margin-bottom:14px">' +
        '<div><span>Текущий Dataset</span><strong>' + escapeHtml(plan.currentRows) + '</strong></div>' +
        '<div><span>Входная партия</span><strong>' + escapeHtml(plan.incomingRows) + '</strong></div>' +
        '<div><span>Обновится</span><strong>' + escapeHtml(plan.updatedKeys) + '</strong></div>' +
        '<div><span>Без изменений</span><strong>' + escapeHtml(plan.unchangedKeys) + '</strong></div>' +
        '<div><span>Добавится</span><strong>' + escapeHtml(plan.addedKeys) + '</strong></div>' +
        '<div><span>Итоговый Dataset</span><strong>' + escapeHtml(plan.finalRows) + '</strong></div>' +
        '</div>'
      : '';

    const preview = instance.records.slice(0, 60);
    const rows = preview.map(row => {
      const factDate = row.factDate instanceof Date
        ? row.factDate.toLocaleString('ru-RU')
        : (row.factDate || '—');
      return '<tr><td>' + escapeHtml(row.site || '—') + '</td>' +
        '<td>' + escapeHtml(row.taskNumber || row.taskForShiftId || '—') + '</td>' +
        '<td>' + escapeHtml(row.request || '—') + '</td>' +
        '<td>' + escapeHtml(row.requestUrl || '—') + '</td>' +
        '<td>' + escapeHtml(factDate) + '</td>' +
        '<td>' + escapeHtml(row.laborHours ?? '—') + '</td>' +
        '<td>' + escapeHtml(row.astroHours ?? '—') + '</td>' +
        '<td>' + escapeHtml(row.equipmentUnit || '—') + '</td>' +
        '<td>' + escapeHtml(row.equipmentType || '—') + '</td>' +
        '<td>' + escapeHtml(row.transport || '—') + '</td>' +
        '<td>' + escapeHtml(row.equipment || '—') + '</td>' +
        '<td>' + escapeHtml(row.element || '—') + '</td>' +
        '<td>' + escapeHtml(row.fault || '—') + '</td>' +
        '<td>' + escapeHtml(row.incidentReason || '—') + '</td>' +
        '<td>' + escapeHtml(row.description || '—') + '</td>' +
        '<td>' + escapeHtml(row.combinedComment || '—') + '</td></tr>';
    }).join('');

    return planHtml + '<div class="table-scroll preview-table-wrap"><table class="reference-table preview-table">' +
      '<thead><tr><th>Участок</th><th>Задача</th><th>Заявка</th><th>Ссылка</th><th>Фактическая дата</th><th>Чел.-ч</th><th>Астрочас</th><th>Единица оборудования</th><th>Тип оборудования</th><th>Транспорт</th><th>Оборудование</th><th>Элемент</th><th>Неисправность</th><th>Причина инцидента</th><th>Описание</th><th>Объединённый комментарий</th></tr></thead>' +
      '<tbody>' + rows + '</tbody></table></div>' +
      '<div class="small" style="margin-top:8px">Показаны первые ' + preview.length + ' из ' + instance.records.length + ' строк. recordKey используется только для UPSERT; поле «Заявка» остаётся ключом связи с ITSM и не обязано быть уникальным.</div>';
  }


// ============================================================================
// MOBILE BRIGADE / ITSM SUPPORTING DATASET STATUS PANELS
// ============================================================================
  function mobileBrigadeSourcePeriod(source) {
    const explicitStart = String(source?.periodStart || '').trim();
    const explicitEnd = String(source?.periodEnd || source?.freshness || '').trim();
    const values = [...String(source?.fileName || '').matchAll(/(20\d{2})-(\d{2})-(\d{2})/g)]
      .map(match => match[1] + '-' + match[2] + '-' + match[3])
      .sort();
    return {
      from: explicitStart || values.at(0) || null,
      to: explicitEnd || values.at(-1) || null
    };
  }

  function mobileBrigadeLocalTodayIso() {
    const now = new Date();
    const year = String(now.getFullYear()).padStart(4, '0');
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    return year + '-' + month + '-' + day;
  }

  function mobileBrigadeFormatIsoDate(value) {
    const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
    return match ? match[3] + '.' + match[2] + '.' + match[1] : (value || '—');
  }

  function mobileBrigadeFreshnessBadge(value) {
    if (!value) return '<span class="status-badge warning">Не определена</span>';
    const badgeClass = value === mobileBrigadeLocalTodayIso() ? 'loaded' : 'warning';
    return '<span class="status-badge ' + badgeClass + '">' +
      escapeHtml(mobileBrigadeFormatIsoDate(value)) + '</span>';
  }

  function mobileBrigadeIntegrationBadge(instance) {
    const status = instance?.validation?.status || 'invalid';
    if (status === 'valid') return '<span class="status-badge loaded">Интегрирован</span>';
    if (status === 'warning') return '<span class="status-badge warning">Интегрирован с предупреждениями</span>';
    return '<span class="status-badge warning">Ошибка интеграции</span>';
  }

  function mobileBrigadeScopeSummary(instance) {
    const records = Array.isArray(instance?.records) ? instance.records : [];
    const meta = instance?.meta || {};
    const sources = Array.isArray(meta.sourceFreshness) ? meta.sourceFreshness : [];
    const counts = new Map();

    for (const record of records) {
      const site = String(record?.site || '').trim();
      if (!site) continue;
      counts.set(site, (counts.get(site) || 0) + 1);
    }

    const allPeriods = sources.map(mobileBrigadeSourcePeriod);
    const globalStarts = allPeriods.map(item => item.from).filter(Boolean).sort();
    const globalStart = globalStarts.at(0) || null;
    const scopes = new Set([
      ...counts.keys(),
      ...Object.keys(meta.freshnessByScope || {})
    ]);

    return Array.from(scopes)
      .map(site => {
        const scopedSources = sources.filter(source =>
          Array.isArray(source?.scopes) && source.scopes.some(scope => String(scope || '').trim() === site)
        );
        const periods = scopedSources.length
          ? scopedSources.map(mobileBrigadeSourcePeriod)
          : [];
        const starts = periods.map(item => item.from).filter(Boolean).sort();
        const ends = periods.map(item => item.to).filter(Boolean).sort();
        const freshness = String(meta.freshnessByScope?.[site] || ends.at(-1) || '').trim() || null;
        return {
          site,
          rows: counts.get(site) || 0,
          from: starts.at(0) || globalStart,
          to: ends.at(-1) || freshness,
          freshness
        };
      })
      .sort((left, right) => left.site.localeCompare(right.site, 'ru'));
  }

  function renderMobileBrigadeScopeStatus(instance) {
    if (!instance) {
      return '<div class="empty-state compact">Mobile Brigade Data ещё не загружен.</div>';
    }

    const scopes = mobileBrigadeScopeSummary(instance);
    if (!scopes.length) {
      return '<div class="empty-state compact">В наборе нет заполненных значений «Участок».</div>';
    }

    const integration = mobileBrigadeIntegrationBadge(instance);
    const rows = scopes.map(item => {
      const range = item.from || item.to
        ? mobileBrigadeFormatIsoDate(item.from) + ' — ' + mobileBrigadeFormatIsoDate(item.to)
        : '—';
      return '<tr>' +
        '<td>' + escapeHtml(item.site) + '</td>' +
        '<td>' + escapeHtml(item.rows) + '</td>' +
        '<td>' + escapeHtml(range) + '</td>' +
        '<td>' + mobileBrigadeFreshnessBadge(item.freshness) + '</td>' +
        '<td>' + integration + '</td>' +
        '</tr>';
    }).join('');

    return '<div class="table-scroll"><table class="reference-table compact-table">' +
      '<thead><tr><th>Участок</th><th>Задач МБ</th><th>Диапазон данных</th><th>Свежесть</th><th>Статус</th></tr></thead>' +
      '<tbody>' + rows + '</tbody></table></div>' +
      '<div class="small" style="margin-top:8px">Диапазон строится по накопленным периодам загруженных выгрузок. Свежесть показывает последнюю дату покрытия конкретного участка.</div>';
  }

  function renderItsmSiriusPreview(instance) {
    if (!instance?.records?.length) {
      return '<div class="empty-state compact">ITSM Sirius Data пока пуст.</div>';
    }
    const fields = instance.meta?.fields || [];
    const columns = instance.meta?.columns || [];
    const ids = ['createdAt', 'number', 'territory', 'reclassifiedEquipment', 'reclassifiedFault', 'problemLink', 'workType'];
    const indexes = ids.map(id => fields.indexOf(id));
    const labels = indexes.map(index => columns[index] || ids[index]);
    const preview = instance.records.slice(0, 20);
    const rows = preview.map(row => '<tr>' +
      indexes.map(index => '<td>' + escapeHtml(row?.[index] ?? '—') + '</td>').join('') +
      '</tr>').join('');
    return '<div class="table-scroll preview-table-wrap"><table class="reference-table preview-table">' +
      '<thead><tr>' + labels.map(label => '<th>' + escapeHtml(label) + '</th>').join('') + '</tr></thead>' +
      '<tbody>' + rows + '</tbody></table></div>' +
      '<div class="small" style="margin-top:8px">Показаны первые ' + preview.length + ' из ' +
      instance.records.length + ' накопленных заявок.</div>';
  }

  function renderItsmSiriusStatus(instance) {
    if (!instance) return '<div class="empty-state compact">ITSM Sirius Data ещё не загружен.</div>';
    const meta = instance.meta || {};
    const plan = meta.upsertPlan || null;
    const freshness = meta.latestSourceDate || null;
    const coverage = mobileBrigadeFormatIsoDate(meta.earliestSourceDate) + ' — ' +
      mobileBrigadeFormatIsoDate(meta.latestSourceDate);
    const integration = mobileBrigadeIntegrationBadge(instance);
    const planHtml = plan
      ? '<div class="reference-metrics">' +
        '<div><span>Текущий Dataset</span><strong>' + escapeHtml(plan.currentRows) + '</strong></div>' +
        '<div><span>Входная партия</span><strong>' + escapeHtml(plan.incomingRows) + '</strong></div>' +
        '<div><span>Обновлено</span><strong>' + escapeHtml(plan.matchedNumbers) + '</strong></div>' +
        '<div><span>Добавлено</span><strong>' + escapeHtml(plan.addedNumbers) + '</strong></div>' +
        '<div><span>Сохранено из истории</span><strong>' + escapeHtml(plan.untouchedCurrentRows) + '</strong></div>' +
        '<div><span>Итого</span><strong>' + escapeHtml(plan.finalRows) + '</strong></div>' +
        '</div>'
      : '';
    return '<div class="table-scroll"><table class="reference-table compact-table"><tbody>' +
      '<tr><th>Заявок ITSM</th><td>' + escapeHtml(instance.records?.length || 0) + '</td></tr>' +
      '<tr><th>Диапазон данных</th><td>' + escapeHtml(coverage) + '</td></tr>' +
      '<tr><th>Свежесть</th><td>' + mobileBrigadeFreshnessBadge(freshness) + '</td></tr>' +
      '<tr><th>Статус</th><td>' + integration + '</td></tr>' +
      '<tr><th>Ключ накопления</th><td><code>Номер</code></td></tr>' +
      '</tbody></table></div>' + planHtml +
      '<div class="small" style="margin-top:8px">Новая ITSM-выгрузка обновляет совпавшие номера заявок, добавляет новые и сохраняет заявки, отсутствующие во входной партии.</div>';
  }

