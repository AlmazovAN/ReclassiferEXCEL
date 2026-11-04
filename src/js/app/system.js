  const journalViewFilters = { category: 'all', level: 'all', query: '' };
  globalThis.ReclassifierJournalMonitorRefresh = () => {
    if (state.route === 'log') refreshJournalVisibleRows();
  };

  function journalVisibleRows() {
    const journal = globalThis.ReclassifierDiagnosticJournal;
    const all = journal?.lines() || state.log;
    const filtered = journal?.select?.(journalViewFilters) || all;
    return { total: all.length, lines: filtered };
  }

  // Update only the output nodes, preserving focus while the user searches.
  function refreshJournalVisibleRows() {
    const result = journalVisibleRows();
    const output = document.getElementById('journalEntries');
    if (output) output.textContent = result.lines.join('\n') ||
      (result.total ? 'По фильтру ничего не найдено.' : 'Журнал пока пуст.');
    const count = document.getElementById('journalVisibleCount');
    if (count) count.textContent = 'Показано ' + result.lines.length + ' из ' + result.total;
    refreshJournalDiagnostics();
  }



  function journalDiagnosticsMarkup(report) {
    const m = report?.memory || {};
    const tab = report?.tab || {};
    const show = value => value == null ? 'недоступно' : formatBytes(value);
    const first = m.firstUsedJsHeapBytes;
    const last = m.lastUsedJsHeapBytes;
    const lastObservation = report?.samples?.at(-1);
    const delta = first === null || first === undefined || last === null || last === undefined
      ? 'недоступно' : (last - first >= 0 ? '+' : '−') + formatBytes(Math.abs(last - first));
    return '<div class="info-list">' +
      '<div class="info-row"><span class="info-key">Мониторинг</span><strong>' +
        (report?.captureEnabled ? 'включён · раз в 30 секунд' : 'выключен · новых замеров нет') + '</strong></div>' +
      '<div class="info-row"><span class="info-key">Показания JavaScript heap</span><strong>' +
        escapeHtml(show(last)) + '</strong></div>' +
      '<div class="info-row"><span class="info-key">Максимум / изменение</span><strong>' +
        escapeHtml(show(m.peakUsedJsHeapBytes) + ' / ' + delta) + '</strong></div>' +
      '<div class="info-row"><span class="info-key">Выделенный heap / лимит</span><strong>' +
        escapeHtml(show(lastObservation?.memory?.allocatedJsHeapBytes) + ' / ' +
          show(lastObservation?.memory?.jsHeapLimitBytes)) + '</strong></div>' +
      '<div class="info-row"><span class="info-key">Физическая RAM (грубая оценка)</span><strong>' +
        (m.deviceMemoryGB == null ? 'недоступна' : escapeHtml(String(m.deviceMemoryGB) + ' ГБ')) +
        '</strong></div>' +
      '<div class="info-row"><span class="info-key">Последний замер</span><strong>' +
        escapeHtml(lastObservation?.timestamp || 'нет') + '</strong></div>' +
      '<div class="info-row"><span class="info-key">Объём наблюдений</span><strong>' +
        (report?.sampleCount || 0) + ' (из них с данными памяти: ' +
        (report?.supportedMemorySamples || 0) + ')</strong></div>' +
      '<div class="info-row"><span class="info-key">Вкладка</span><strong>' +
        escapeHtml(String(tab.visibility || 'недоступно')) + '; фокус: ' +
        (tab.focused === null || tab.focused === undefined ? 'недоступно' :
          tab.focused ? 'есть' : 'нет') + '</strong></div>' +
      '<div class="info-row"><span class="info-key">Изменения вкладки</span><strong>' +
        (tab.visibilityChanges || 0) + ' видимости, ' +
        (tab.focusChanges || 0) + ' фокуса</strong></div></div>';
  }

  function refreshJournalDiagnostics() {
    const output = document.getElementById('journalDiagnosticsMetrics');
    if (output) output.innerHTML = journalDiagnosticsMarkup(
      globalThis.ReclassifierDiagnosticJournal?.diagnosticsReport?.());
  }

  function downloadDiagnosticCategoryJson(category) {
    const journal = globalThis.ReclassifierDiagnosticJournal;
    const data = journal?.exportCategorySnapshot?.(category, build.version);
    if (!data) {
      setJournalCategoryStatus('Неизвестная категория отчёта.');
      return false;
    }
    const fileName = 'Reclassifier_Journal_' + category + '.json';
    try {
      const blob = new Blob([JSON.stringify(data, null, 2)], {type: 'application/json;charset=utf-8'});
      const url = URL.createObjectURL(blob);
      try {
        const link = document.createElement('a');
        link.href = url;
        link.download = fileName;
        document.body.appendChild(link);
        link.click();
        link.remove();
      } finally {
        setTimeout(() => URL.revokeObjectURL(url), 1500);
      }
      setJournalCategoryStatus('Подготовлен JSON: ' + fileName +
        '; событий: ' + data.retainedEventCount + '.');
      return true;
    } catch (error) {
      setJournalCategoryStatus('Не удалось скачать JSON: ' + (error?.message || String(error)));
      return false;
    }
  }

  function setJournalCategoryStatus(message) {
    const status = document.getElementById('journalCategoryActionStatus');
    if (status) status.textContent = message;
  }

  function renderLog() {
    setHeader('Система', 'Журнал', 'События текущего запуска приложения.');
    const profiler=globalThis.ReclassifierPerformanceProfiler;
    const journal=globalThis.ReclassifierDiagnosticJournal;
    const settings=journal?.settings() || {};
    const toggles=[
      ['general', 'Общие события', 'Навигация, клики по кнопкам и обычные сообщения приложения (без содержимого полей)'],
      ['import_export', 'Импорт и экспорт', 'Операции с Excel, справочниками и SQLite: этапы, результаты и ошибки'],
      ['runtime', 'Отказы рантайма', 'Сбои WebWorker и исполнения приложения'],
      ['diagnostics', 'Расширенная диагностика', 'Дополнительные технические сообщения'],
      ['performance', 'Производительность', 'Замеры времени выполнения и счётчики']
    ];
    const toggleMarkup=toggles.map(([id, name, description]) =>
      '<div class="journal-setting"><label class="journal-setting-label"><input type="checkbox" data-journal-toggle="' + id +
      '" id="journalToggle_' + id + '"' + (settings[id] ? ' checked' : '') + '>' +
      '<span><strong>' + escapeHtml(name) + '</strong><small>' +
      escapeHtml(description) + '</small></span></label>' +
      '<button class="button ghost" type="button" data-journal-download="' + id +
      '" id="journalDownload_' + id + '">Скачать JSON</button></div>').join('');
    const visible=journalVisibleRows();
    const categoryMarkup=[['all','Все категории'], ...Object.entries(journal?.labels || {})]
      .map(([id, name]) => '<option value="' + escapeHtml(id) + '"' +
        (journalViewFilters.category === id ? ' selected' : '') + '>' +
        escapeHtml(name) + '</option>').join('');
    const levelMarkup=[['all','Все уровни'], ['ERROR','ERROR'], ['WARN','WARN'],
      ['INFO','INFO'], ['DEBUG','DEBUG']]
      .map(([id, name]) => '<option value="' + id + '"' +
        (journalViewFilters.level === id ? ' selected' : '') + '>' + name + '</option>').join('');
    const report=profiler?.snapshot();
    const number=value=>Number(value).toLocaleString('ru-RU',{maximumFractionDigits:2});
    const timingRows=(report?.timings||[]).map(item=>`
      <tr><td>${escapeHtml(item.name)}</td>
      <td>${number(item.count)}</td><td>${number(item.totalMs)}</td>
      <td>${number(item.avgMs)}</td><td>${number(item.maxMs)}</td></tr>`).join('');
    const countRows=Object.entries(report?.counters||{}).map(([name,value])=>`
      <tr><td>${escapeHtml(name)}</td><td>${number(value)}</td></tr>`).join('');
    el.pageContent.innerHTML = `
      <article class="card" id="journalSettingsPanel">
        <h3>Регистрация событий</h3>
        <p>Настройки действуют до закрытия страницы. Отключение записи в журнал
        не отменяет обработку, проверки и сообщения об ошибках.</p>
        <div class="journal-settings-grid">${toggleMarkup}</div>
        <div class="action-row"><button class="button" id="clearLogButton">Очистить все логи</button></div>
        <p class="small">Каждая галочка включает и прекращает регистрацию своей категории немедленно.
        При отключении ранее записанные события остаются доступными для экспорта. События других
        отмеченных категорий продолжают записываться. Сохраняются последние ${journal?.capacity || 300} сообщений
        суммарно по всем категориям. Расширенная диагностика по умолчанию выключена.</p>
        <p class="small" id="journalCategoryActionStatus" role="status" aria-live="polite"></p>
      </article>
      <article class="card" id="journalDiagnosticsPanel">
        <h3>Расширенная диагностика: память и вкладка</h3>
        <div id="journalDiagnosticsMetrics">${journalDiagnosticsMarkup(journal?.diagnosticsReport?.())}</div>
        <div class="action-row">
          <button class="button ghost" id="journalDiagnosticsSampleButton"
            ${settings.diagnostics ? '' : 'disabled'}>Снять показания сейчас</button>
          <button class="button ghost" id="journalDiagnosticsDownloadButton">Скачать диагностику JSON</button>
        </div>
        <p class="small">Измеряется только то, что браузер разрешает видеть этой странице:
        оценка JavaScript heap (если доступна), последнее изменение и пик; видимость и фокус вкладки.
        Это не потребление всей оперативной памяти браузером, SQLite/WASM или соседними вкладками.
        Рост JavaScript heap сам по себе не доказывает утечку памяти.</p>
      </article>
      <article class="card">
        <div class="action-row" style="margin-top:0; margin-bottom:14px">
          <button class="button" id="copyLogButton">Скопировать текст</button>
          <button class="button" id="downloadLogJsonButton">Скачать JSON</button>
        </div>
        <p class="small">Экспорт содержит сообщения текущего запуска, включая возможные имена файлов.
        Проверьте содержимое перед передачей третьим лицам.</p>
        <p class="small" id="journalActionStatus" role="status" aria-live="polite"></p>
        <div class="journal-filter-row">
          <label>Поиск
            <input id="journalSearchInput" type="search" placeholder="Текст события" value="${escapeHtml(journalViewFilters.query)}" autocomplete="off">
          </label>
          <label>Категория
            <select id="journalCategoryFilter">${categoryMarkup}</select>
          </label>
          <label>Уровень
            <select id="journalLevelFilter">${levelMarkup}</select>
          </label>
          <button class="button ghost" id="journalResetFiltersButton">Сбросить фильтры</button>
        </div>
        <p class="small" id="journalVisibleCount">Показано ${visible.lines.length} из ${visible.total}</p>
        <p class="small">Фильтры меняют только отображение. Копирование и JSON содержат весь сохранённый журнал.</p>
        <div class="log-box" id="journalEntries">${escapeHtml(visible.lines.join('\n') || (visible.total ? 'По фильтру ничего не найдено.' : 'Журнал пока пуст.'))}</div>
      </article>
      <article class="card" id="performanceProfilePanel">
        <h3>Профиль производительности</h3>
        <p>Сбор замеров: ${report?.enabled === false ? 'приостановлен' : 'включён'}.
        Ранее собранные замеры остаются до сброса.</p>
        <p id="kpiBackgroundStatus">KPI Worker: ${escapeHtml((() => {
          const kpi = globalThis.ReclassifierKpiBackgroundJobs?.status();
          if (!kpi) return 'недоступен';
          const stateLabel = {idle:'нет заданий',queued:'ожидание',running:'расчёт',disposed:'остановлен'};
          return (stateLabel[kpi.state] || kpi.state) +
            ', в очереди: ' + kpi.queued +
            ', источник в Worker: ' + (kpi.sourceLoaded ? 'подготовлен' : 'не передавался');
        })())}</p>
        <p>Кэш KPI (основной поток): ${escapeHtml((() => {
          const stats=globalThis.ReclassifierKpiComputationService?.status?.().materializedResults;
          return stats ? stats.size+'/'+stats.capacity+' результатов; попаданий: '+
            stats.hits+', промахов: '+stats.misses+', вытеснений: '+stats.evictions : 'недоступен';
        })())}</p>
        <p>Кэш KPI (фоновый Worker): ${escapeHtml((() => {
          const stats=globalThis.ReclassifierKpiBackgroundJobs?.status()?.materializedResults;
          return stats ? stats.size+'/'+stats.capacity+' результатов; попаданий: '+
            stats.hits+', промахов: '+stats.misses+', вытеснений: '+stats.evictions : 'пока нет измерений';
        })())}</p>
        <p>Локальная диагностика времени вычислений. Вложенные этапы пересекаются;
        их длительности нельзя складывать. Данные Dataset и параметры фильтров не сохраняются.</p>
        <div class="action-row" style="margin-bottom:12px">
          <button class="button" id="refreshPerformanceButton">Обновить замеры</button>
          <button class="button" id="downloadPerformanceButton">Скачать профиль JSON</button>
          <button class="button" id="clearPerformanceButton">Сбросить замеры</button>
        </div>
        <p>Событий: ${report?.retainedEventCount ?? 0} (хранится не более 250).
          Долгие задачи: ${report?.longTaskSupport ? 'поддерживаются' : 'не поддерживаются'}.
          JS-память: ${report?.usedJsHeapBytes == null ? 'недоступна' : formatBytes(report.usedJsHeapBytes)}.</p>
        <div style="overflow-x:auto">
          <table class="kpi-passport-table">
            <thead><tr><th>Этап</th><th>Вызовы</th><th>Всего, мс</th><th>Среднее, мс</th><th>Максимум, мс</th></tr></thead>
            <tbody>${timingRows||'<tr><td colspan="5">Замеров пока нет</td></tr>'}</tbody>
          </table>
        </div>
        <h4>Счётчики выполнения и попаданий в кэш</h4>
        <div style="overflow-x:auto">
          <table class="kpi-passport-table">
            <thead><tr><th>Счётчик</th><th>Количество</th></tr></thead>
            <tbody>${countRows||'<tr><td colspan="2">Счётчиков пока нет</td></tr>'}</tbody>
          </table>
        </div>
      </article>
    `;
    el.pageContent.querySelectorAll('[data-journal-download]').forEach(node =>
      node.addEventListener('click', () => downloadDiagnosticCategoryJson(node.dataset.journalDownload)));
    document.getElementById('journalDiagnosticsDownloadButton')?.addEventListener('click', () =>
      downloadDiagnosticCategoryJson('diagnostics'));
    document.getElementById('journalDiagnosticsSampleButton')?.addEventListener('click', () => {
      journal?.sampleDiagnostics?.('manual');
      refreshJournalVisibleRows();
    });
    el.pageContent.querySelectorAll('[data-journal-toggle]').forEach(node =>
      node.addEventListener('change', event => {
        journal?.setEnabled(node.dataset.journalToggle, event.target.checked);
        renderLog();
      }));
    document.getElementById('journalSearchInput')?.addEventListener('input', event => {
      journalViewFilters.query = String(event.target.value || '').slice(0, 120);
      refreshJournalVisibleRows();
    });
    document.getElementById('journalCategoryFilter')?.addEventListener('change', event => {
      journalViewFilters.category = event.target.value;
      refreshJournalVisibleRows();
    });
    document.getElementById('journalLevelFilter')?.addEventListener('change', event => {
      journalViewFilters.level = event.target.value;
      refreshJournalVisibleRows();
    });
    document.getElementById('journalResetFiltersButton')?.addEventListener('click', () => {
      journalViewFilters.query = '';
      journalViewFilters.category = 'all';
      journalViewFilters.level = 'all';
      renderLog();
    });
    document.getElementById('copyLogButton').addEventListener('click', () => {
      void copyDiagnosticJournal();
    });
    document.getElementById('downloadLogJsonButton').addEventListener('click', () => {
      downloadDiagnosticJournalJson();
    });
    document.getElementById('clearLogButton').addEventListener('click', () => {
      journal?.clear();
      state.log = [];
      renderLog();
      setJournalActionStatus('Журнал очищен.');
    });
    document.getElementById('refreshPerformanceButton').addEventListener('click',renderLog);
    document.getElementById('clearPerformanceButton').addEventListener('click',()=>{
      profiler?.reset();
      renderLog();
    });
    document.getElementById('downloadPerformanceButton').addEventListener('click',()=>{
      const data=JSON.stringify(profiler?.snapshot()||{},null,2);
      const blob=new Blob([data],{type:'application/json;charset=utf-8'});
      const url=URL.createObjectURL(blob);
      const link=document.createElement('a');
      link.href=url;
      link.download='Reclassifier_Performance_Profile.json';
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(()=>URL.revokeObjectURL(url),1500);
    });
  }

  function setJournalActionStatus(message) {
    const status = document.getElementById('journalActionStatus');
    if (status) status.textContent = message;
  }

  async function copyDiagnosticJournal() {
    const lines = globalThis.ReclassifierDiagnosticJournal?.lines() || state.log;
    if (!lines.length) {
      setJournalActionStatus('Журнал пуст: копировать нечего.');
      return false;
    }
    const text = lines.join('\n');
    try {
      if (globalThis.navigator?.clipboard?.writeText) {
        await globalThis.navigator.clipboard.writeText(text);
      } else {
        // Restricted file:// contexts may lack the async Clipboard API.
        const field = document.createElement('textarea');
        field.value = text;
        field.style.position = 'fixed';
        field.style.left = '-9999px';
        document.body.appendChild(field);
        try {
          field.select();
          if (!document.execCommand?.('copy')) throw new Error('Копирование запрещено браузером.');
        } finally {
          field.remove();
        }
      }
      setJournalActionStatus('Текст журнала скопирован.');
      return true;
    } catch (error) {
      setJournalActionStatus('Не удалось скопировать журнал: ' + (error?.message || String(error)));
      return false;
    }
  }

  function downloadDiagnosticJournalJson() {
    try {
      const journal = globalThis.ReclassifierDiagnosticJournal;
      const payload = journal?.exportSnapshot(build.version) || {
        schemaVersion: 1, application: 'Reclassifier',
        exportedAt: new Date().toISOString(),
        events: state.log.map(message => ({message}))
      };
      const content = JSON.stringify(payload, null, 2);
      const blob = new Blob([content], {type: 'application/json;charset=utf-8'});
      const url = URL.createObjectURL(blob);
      try {
        const link = document.createElement('a');
        link.href = url;
        link.download = 'Reclassifier_Journal.json';
        document.body.appendChild(link);
        link.click();
        link.remove();
      } finally {
        // Keep the object URL valid during the browser's download handoff.
        setTimeout(() => URL.revokeObjectURL(url), 1500);
      }
      setJournalActionStatus('JSON журнала подготовлен для скачивания.');
      return true;
    } catch (error) {
      setJournalActionStatus('Не удалось скачать JSON журнала: ' + (error?.message || String(error)));
      return false;
    }
  }

  function renderAbout() {
    setHeader('Система', 'О приложении', 'Назначение, состав данных, алгоритмы и техническая информация текущей сборки.');
    el.pageContent.innerHTML = `
      <div class="grid cols-2">
        <article class="card flat">
          <h2>Reclassifier</h2>
          <p>Локальное браузерное приложение для подготовки справочников и обработки Excel-выгрузок. Исходные Excel читаются на компьютере пользователя, расчёты выполняются в браузере. Результаты обработки скачиваются как XLSX. Пока БД закрыта, применённые Dataset можно сохранить в самодостаточный HTML; после подключения Reclassifier.db изменения записываются только в SQLite и переносятся экспортом файла базы.</p>
          <div class="info-list">
            <div class="info-row"><span class="info-key">Версия приложения</span><strong>${escapeHtml(build.version)}</strong></div>
            <div class="info-row"><span class="info-key">Сборка</span><strong>${escapeHtml(build.builtAt || '—')}</strong></div>
            <div class="info-row"><span class="info-key">Excel parser</span><strong>${escapeHtml(build.excelParser || 'SheetJS')}</strong></div>
            <div class="info-row"><span class="info-key">SQLite</span><strong>${escapeHtml(build.sqliteVersion || '—')} · embedded WASM</strong></div>
            <div class="info-row"><span class="info-key">Database Core</span><strong>${globalThis.ReclassifierDatabaseRepository ? 'встроен' : 'недоступен'}</strong></div>
            <div class="info-row"><span class="info-key">Worker</span><strong>${state.workerReady ? 'готов' : 'не инициализирован'}</strong></div>
            <div class="info-row"><span class="info-key">Runtime</span><strong>offline-only</strong></div>
          </div>
        </article>

        <article class="card flat">
          <h3>Как устроено</h3>
          <p>Исходники разделены по компонентам, но релиз собирается в единый HTML. Общая оболочка отвечает только за навигацию и runtime; предметные модули, Reference Manager и Equipment имеют собственные config / logic / manager / UI-слои.</p>
          <p>Тяжёлая обработка «Реклассификации», ITSM и «Мобильных бригад» выполняется в WebWorker, чтобы Excel-парсинг, преобразование файлов и расчёты не блокировали интерфейс. Python-контракты сохранены как параллельный инструмент для дальнейших модулей.</p>
          <p>SQLite Core, Dataset Recognizer, Dataset Integration Engine и SQLite-first runtime repository встроены в HTML. Команда создания базы создаёт пустую Reclassifier.db; пользователь импортирует свои Dataset локально; Equipment_Combined остаётся производным. Если Reclassifier.db открыта, она является единственным авторитетным источником Dataset. Раздел БД выполняет quick_check, foreign_key_check, сверку Dataset Registry и контроль journal_mode=DELETE; команда «Скачать Reclassifier.db» экспортирует уже активную БД после успешной проверки целостности.</p>
        </article>

        <article class="card flat">
          <h3>Справочники</h3>
          <p>Reference Manager управляет ${escapeHtml(Object.keys(referenceConfig).length)} логическими наборами: Reclassification, Drivers, Customers, TypeRequest, Initiators, Exceptions, ProblemGrade и автоматически формируемым Mobile Brigade Data. При загрузке Excel формат распознаётся по заголовкам, данные нормализуются, проверяются и только после этого становятся доступны аналитическим модулям.</p>
          <p>Сборка не содержит бизнес-данных. После обработки свежих МБ-файлов создаётся UPSERT-кандидат: совпавшие задачи обновляются, новые добавляются, незатронутые строки сохраняются. В HTML-режиме подтверждённые наборы можно сохранить в HTML-снимок. При открытой Reclassifier.db новые загрузки следует интегрировать через раздел базы.</p>
        </article>

        <article class="card flat">
          <h3>Оборудование</h3>
          <p>Equipment работает с пятью исходными каталогами: Mounted, Stationary, Transport, Transport StartPoints и Zabbix. Из текущего полного набора строится производный Equipment_Combined.</p>
          <p>Обновление двухфазное: «Обработать» создаёт и проверяет кандидат, затем «Применить данные» заменяет только загруженные источники. Остальные текущие источники сохраняются, после чего Equipment_Combined пересчитывается полностью. Правила: Equipment Merge Rules ${escapeHtml(window.ReclassifierEquipment?.rulesVersion || '—')}.</p>
        </article>

        <article class="card flat">
          <h3>Классификатор отказов</h3>
          <p>Раздел принимает рабочий классификатор и системную выгрузку «Причина инцидента», автоматически распознаёт формат и фильтрует строки до области поддержки: пустая услуга или ОГР, только активные записи и не САДУ.</p>
          <p>В рабочем справочнике сохраняются только пять текстовых полей: услуга, оборудование, элемент, неисправность и причина. ID и служебные признаки после обработки не публикуются. Данные загружаются локально и хранятся в подключённой SQLite. Схема: Failure Classifier ${escapeHtml(window.ReclassifierFailureClassifier?.schemaVersion || '—')}.</p>
        </article>

        <article class="card flat">
          <h3>Реклассификация</h3>
          <p>Модуль принимает ITSM XLSX/XLSM, находит рабочую таблицу по 10 обязательным полям и формирует отдельный 10-польный Reclassification XLSX в WebWorker.</p>
          <p>Текущие Reclassification Rules ${escapeHtml(globalThis.ReclassifierReclassificationRules?.version || '—')} работают в базовом режиме: напрямую переносят из ITSM даты, территорию, номер, текущую цепочку классификации, описание и примечание к закрытию. После обработки готовится план UPSERT рабочего RE-CLASS по полю «Номер»; сам справочник меняется только после отдельного подтверждения. Внешние справочники и классификатор отказов на этом этапе не влияют на результат.</p>
        </article>

        <article class="card flat">
          <h3>ITSM</h3>
          <p>ITSM использует семь обычных Reference-наборов и Mobile Brigade Data, формируя 34 расчётные колонки AB:BI. Рабочие Dataset приложение получает из пользовательской SQLite.</p>
          <p>Цепочка обработки: исходный XLSX → WebWorker → SheetJS → ITSM Rules ${escapeHtml(globalThis.ReclassifierItsmRules?.version || '—')} → итоговый XLSX + кандидат ITSM Dataset. В HTML-режиме после подтверждения набор включается в HTML-снимок; при подключённой БД импорт и история изменений управляются Dataset Integration Engine.</p>
        </article>

        <article class="card flat">
          <h3>Мобильные бригады</h3>
          <p>Модуль объединяет несколько выгрузок по именам колонок, допускает различия схем ЗФ/КФ и формирует единую таблицу из 38 полей: две исходные колонки комментариев объединяются в одну без потери служебных префиксов, затем рассчитываются 6 аналитических полей.</p>
          <p>Свежесть каждого источника определяется по дате в имени файла и дополнительно хранится по участкам; Source.Name в итоговый XLSX не добавляется. Mobile Brigade Dataset загружается из пользовательской SQLite. При обработке свежих МБ-выгрузок поле «Дата создания вызова ITSM» обогащается по связи «Заявка» → ITSM «Номер»; «Возраст пред-бэклога» пока не рассчитывается. Текущий ITSM использует связь по заявке, идентификатор техники и трудозатраты; остальные поля сохраняются как контекст. Свежие МБ-файлы можно применять частями и с нахлёстом периода: UPSERT заменяет совпавшие задачи, добавляет новые и не удаляет остальные. Правила: Mobile Brigade Rules ${escapeHtml(globalThis.ReclassifierMobileBrigadeRules?.version || '—')}.</p>
        </article>

        <article class="card flat">
          <h3>Безопасность и границы версии</h3>
          <p>Готовое приложение работает без сети: CSP запрещает соединения через <code>connect-src 'none'</code>, а runtime guard дополнительно блокирует fetch/XHR/WebSocket/EventSource/sendBeacon.</p>
          <p>ITSM, «Мобильные бригады», Reference Manager, Equipment и «Классификатор отказов» имеют рабочую предметную логику. «Реклассификация» работает в базовом режиме прямого переноса 10 полей из ITSM и обновления RE-CLASS по номеру; подключение внешних справочников и классификатора отказов остаётся следующим этапом.</p>
        </article>
      </div>
    `;
  }
