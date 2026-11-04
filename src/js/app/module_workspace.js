// Shared compact metadata presentation for ITSM and Mobile Brigade.
const reclassifierModuleSourceStatus = (() => {
  'use strict';

  function newestDateInFileName(fileName) {
    const candidates = String(fileName || '').match(/20\d{2}-\d{2}-\d{2}/g) || [];
    return candidates.filter(value => {
      const year = Number(value.slice(0, 4));
      const month = Number(value.slice(5, 7));
      const day = Number(value.slice(8, 10));
      const date = new Date(Date.UTC(year, month - 1, day));
      return date.getUTCFullYear() === year &&
        date.getUTCMonth() + 1 === month && date.getUTCDate() === day;
    }).sort().at(-1) || null;
  }

  function latestSourceNameDate(files = [], meta = {}) {
    const selected = Array.from(files || []).map(file => (
      typeof file === 'string' ? file : file?.name
    )).filter(Boolean);
    const saved = [
      ...(Array.isArray(meta.sourceFiles) ? meta.sourceFiles : []),
      ...(Array.isArray(meta.sourceFreshness) ? meta.sourceFreshness.map(item => item?.fileName) : []),
      ...(Array.isArray(meta.lastSourceFreshness) ? meta.lastSourceFreshness.map(item => item?.fileName) : []),
      meta.sourceFileName,
      /\.xlsx?m?$/i.test(String(meta.fileName || '')) ? meta.fileName : null
    ].filter(Boolean);
    // Do not mistake generated labels such as "ITSM Sirius Data 2026-10-13"
    // for names of actual Excel sources.
    return selected.concat(saved)
      .map(newestDateInFileName).filter(Boolean).sort().at(-1) || null;
  }

  function formatDate(value) {
    if (!value) return '—';
    const [year, month, day] = value.split('-');
    return day + '.' + month + '.' + year;
  }

  function formatRows(value) {
    return Number(value || 0).toLocaleString('ru-RU');
  }

  function compactCard(title, lines) {
    return '<article class="card flat module-compact-card"><h3>' +
      escapeHtml(title) + '</h3><div class="module-compact-lines">' +
      lines.map(([label, value]) => '<p>' + escapeHtml(label) +
        ': <strong>' + escapeHtml(String(value ?? '—')) + '</strong></p>').join('') +
      '</div></article>';
  }


  // A reference snapshot normally has no business timestamp. File mtime is
  // evidence of OS modification, NOT proof of when the system exported it.
  function calendarDate(value) {
    const fromExport = globalThis.ReclassifierDatasetExcelExport?.dateKey?.(value);
    if (fromExport) return fromExport;
    if (value instanceof Date && !Number.isNaN(value.getTime())) {
      return value.getFullYear() + '-' + String(value.getMonth() + 1).padStart(2, '0') +
        '-' + String(value.getDate()).padStart(2, '0');
    }
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
      return calendarDate(new Date(value));
    }
    const text = String(value || '').trim();
    const match = /^(\d{4})-(\d{2})-(\d{2})(?=$|T|\s)/.exec(text);
    if (!match) return null;
    const result = match[1] + '-' + match[2] + '-' + match[3];
    const date = new Date(result + 'T12:00:00Z');
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0,10) === result
      ? result : null;
  }

  const completedDateCache = new WeakMap();
  function latestActualFactDate(instance, today = calendarDate(new Date())) {
    if (!instance || !Array.isArray(instance.records)) return null;
    const cached = completedDateCache.get(instance);
    if (cached?.records === instance.records && cached.today === today) return cached.date;
    let date = null;
    for (const record of instance.records) {
      // Only recorded actual work; null fact dates and future dates are not
      // evidence that an automatically scheduled task has been completed.
      const candidate = globalThis.ReclassifierDatasetExcelExport?.recordDate
        ? globalThis.ReclassifierDatasetExcelExport.recordDate('mobile_brigade_data',record)
        : calendarDate(record?.factDate);
      if (candidate && (!today || candidate <= today) && (!date || candidate > date)) {
        date = candidate;
      }
    }
    completedDateCache.set(instance, {records:instance.records,today,date});
    return date;
  }

  function referenceDate(referenceId, instance, today = calendarDate(new Date())) {
    if (!instance) return {label:'Дата не определена', date:null, note:'Источник не загружен'};
    const meta = instance.meta || {};
    let observed=null, label=null, note=null;
    if (referenceId === 'reclassification') {
      observed = calendarDate(meta.latestRequestDate || meta.latestSourceDate);
      label = 'Последнее выполненное обращение';
      note = 'Максимальная дата из колонки «Дата выполнения обращения»';
    } else if (referenceId === 'itsm_data') {
      observed = calendarDate(meta.latestSourceDate);
      label = 'Последняя созданная заявка';
      note = 'Максимальная «Дата создания вызова»';
    } else if (referenceId === 'mobile_brigade_data') {
      observed = latestActualFactDate(instance,today);
      label = 'Последняя фактическая работа';
      note = 'Максимальная «Фактическая дата» не позже сегодня; даты будущих плановых работ исключены';
    } else {
      observed = calendarDate(meta.sourceExportDate || meta.exportedAt);
      if (observed) {
        label = 'Дата выгрузки';
        note = 'Дата выгрузки из метаданных источника';
      } else {
        observed = calendarDate(meta.sourceFileModifiedAt || instance.file?.lastModified);
        if (observed) {
          label = 'Дата файла';
          note = 'Дата изменения файла в ОС; не подтверждает дату выгрузки из системы';
        } else {
          observed = calendarDate(meta.loadedAt);
          label = observed ? 'Загружено' : 'Дата выгрузки не указана';
          note = observed
            ? 'Дата загрузки в приложение, не дата выгрузки из системы'
            : 'Источник не содержит достоверной даты выгрузки';
        }
      }
    }
    return {label, date:observed, note};
  }

  function referenceRows(ids, resolver = id =>
    typeof datasetStore !== 'undefined' && typeof datasetStore.get === 'function'
      ? datasetStore.get(id) : state.references?.[id]) {
    return Array.from(ids || []).map(id => {
      const instance=resolver(id);
      const source=referenceDate(id,instance);
      // Also render safely in isolated module test harnesses that don't load
      // the reference catalog. Production continues to use the real config.
      const config = typeof referenceConfig === 'undefined' ? null : referenceConfig;
      const title = config?.[id]?.title || id;
      const statusClass = typeof referenceStatusClass === 'function'
        ? referenceStatusClass(instance) : (instance ? 'loaded' : '');
      const statusText = typeof referenceStatusText === 'function'
        ? referenceStatusText(instance) : (instance ? 'Готов' : 'Не загружен');
      return '<div class="info-row module-reference-row">' +
        '<span class="info-key module-reference-name">' +
          escapeHtml(title) +
          '<small title="' + escapeHtml(source.note) + '">' +
            escapeHtml(source.label) + ': ' +
            '<strong class="module-reference-date">' + escapeHtml(source.date ? formatDate(source.date) : '—') + '</strong>' +
          '</small></span>' +
        '<span class="status-badge ' + escapeHtml(statusClass) + '">' +
          escapeHtml(statusText) + '</span>' +
        '</div>';
    }).join('');
  }

  function previewSource(datasetId, instance) {
    const exporter=globalThis.ReclassifierDatasetExcelExport;
    const source=exporter?.exportSource?.(datasetId,instance);
    if (source?.columns?.length) return source;
    // Some isolated/offline test harnesses omit the optional XLSX exporter.
    // Use the authoritative analytical schema to keep read-only preview usable.
    if (datasetId === 'itsm_data' && Array.isArray(instance?.records?.[0])) {
      const width=instance.records[0].length;
      const schema=globalThis.ReclassifierItsmDatasetSchema;
      const labels=[schema?.labels,instance.meta?.columns,instance.meta?.fields]
        .find(items=>Array.isArray(items)&&items.length===width);
      return {mode:'analytical',width,
        columns:Array.from({length:width},(_,i)=>String(labels?.[i]||'Поле '+(i+1)))};
    }
    if (datasetId === 'mobile_brigade_data' && instance?.records?.[0]) {
      const keys=Object.keys(instance.records[0]);
      const labels=new Map((globalThis.MOBILE_BRIGADE_DATA_SCHEMA?.output||[])
        .map(item=>[item[0],item[1]]));
      return {mode:'analytical',keys,width:keys.length,
        columns:keys.map(key=>labels.get(key)||key)};
    }
    return null;
  }

  function previewMarkup(datasetId, instance) {
    const rows = Array.isArray(instance?.records) ? instance.records : [];
    if (!rows.length) return '<p class="small">Строк для просмотра пока нет.</p>';
    const source = previewSource(datasetId,instance);
    if (!source?.columns?.length) return '<p class="small">Не определены поля Dataset.</p>';
    const preview = rows.slice(0,5);
    const cells = preview.map((record,index) => {
      const values = source.mode === 'full' ? instance.fullDataset?.rows?.[index] :
        (datasetId === 'itsm_data' ? record : source.keys.map(key=>record?.[key]));
      return '<tr>' + source.columns.map((_,col) => {
        const value = values?.[col];
        return '<td>' + escapeHtml(value instanceof Date
          ? value.toLocaleString('ru-RU')
          : value == null || value === '' ? '—' : String(value)) + '</td>';
      }).join('') + '</tr>';
    }).join('');
    return '<div class="table-scroll module-dataset-preview-scroll"><table class="reference-table compact-table">' +
      '<thead><tr>' + source.columns.map(title=>'<th>'+escapeHtml(title)+'</th>').join('') +
      '</tr></thead><tbody>' + cells + '</tbody></table></div>' +
      '<p class="small">Первые ' + preview.length + ' из ' + formatRows(rows.length) +
      ' строк · ' + source.columns.length + ' колонок · ' +
      (source.mode === 'full' ? 'полный исходный набор' : 'доступные аналитические поля') + '</p>';
  }

  function datasetSummary(datasetId, instance) {
    if (!instance) return '<article class="card flat module-dataset-card">' +
      '<h3>Данные в текущей базе</h3><p class="small">Dataset пока не загружен.</p></article>';
    const meta=instance.meta || {};
    const rows=instance.records?.length || 0;
    const fullRows=instance.fullDataset?.rows?.length || 0;
    const fullColumns=instance.fullDataset?.columns?.length || null;
    const source=previewSource(datasetId,instance);
    const full=Boolean(fullRows===rows && rows>0 && source?.mode==='full');
    const location=meta.sourceType==='sqlite' ? 'SQLite' :
      meta.sourceType==='embedded' ? 'Встроенные данные HTML' :
      meta.sourceType==='snapshot' ? 'HTML-снимок' : 'Данные HTML';
    const freshness=referenceDate(datasetId,instance);
    return '<article class="card flat module-dataset-card">' +
      '<h3>Данные в текущей базе</h3>' +
      '<div class="module-dataset-meta">' +
        '<div><span>Строк</span><strong>'+formatRows(rows)+'</strong></div>' +
        '<div><span>Исходных строк</span><strong>'+formatRows(fullRows)+' из '+
          formatRows(rows)+' · '+(full?'полный':'частичный')+'</strong></div>' +
        '<div><span>Полей Dataset</span><strong>'+escapeHtml(meta.fieldCount ?? meta.fields?.length ??
          (datasetId==='itsm_data' ? globalThis.ReclassifierItsmDatasetSchema?.fields?.length : 23) ?? '—')+'</strong></div>' +
        '<div><span>Полей исходника</span><strong>'+escapeHtml(fullColumns ?? '—')+'</strong></div>' +
        '<div><span>Источник</span><strong>'+escapeHtml(location)+'</strong></div>' +
        '<div><span>'+escapeHtml(freshness.label)+'</span><strong title="'+escapeHtml(freshness.note)+'">'+
          escapeHtml(freshness.date?formatDate(freshness.date):'—')+'</strong></div>' +
      '</div>' +
      '<details class="module-preview-details"><summary>Просмотр '+(datasetId==='itsm_data'?'ITSM':'Mobile Brigade')+
        ' Dataset · 5 строк</summary>'+previewMarkup(datasetId,instance)+'</details>' +
      '</article>';
  }

  return Object.freeze({
    newestDateInFileName,
    latestSourceNameDate,
    formatDate,
    formatRows,
    calendarDate,
    latestActualFactDate,
    referenceDate,
    referenceRows,
    previewSource,
    previewMarkup,
    datasetSummary,
    compactCard
  });
})();
globalThis.ReclassifierModuleSourceStatus = reclassifierModuleSourceStatus;

  function renderModuleWorkspace(moduleId, options = {}) {
    const module = moduleConfig[moduleId];
    setHeader('Обработка', module.title, module.description);

    const refRows = reclassifierModuleSourceStatus.referenceRows(module.references);

    const showSidePanel = options.showSidePanel !== false;
    const customSidePanelHtml = typeof options.sidePanelHtml === 'function'
      ? options.sidePanelHtml({ refRows })
      : (options.sidePanelHtml ?? null);
    const baselineLoading = state.baselineReady === false;
    const processing = Boolean(state.processingModuleId);
    const workspaceLocked = baselineLoading || processing;
    const processBlockReason = typeof options.processBlockReason === 'function'
      ? options.processBlockReason()
      : (options.processBlockReason || '');
    const noticeHtml = typeof options.noticeHtml === 'function'
      ? options.noticeHtml()
      : (options.noticeHtml || '<div class="notice" style="margin-top:18px">Предметная обработка этого аналитического модуля пока не подключена.</div>');
    const rulesLabel = typeof options.rulesLabel === 'function' ? options.rulesLabel() : (options.rulesLabel || 'не заданы');
    const runtimeLabel = typeof options.runtimeLabel === 'function'
      ? options.runtimeLabel()
      : (options.runtimeLabel || (state.workerReady ? 'Готов' : 'Подготовка'));

    el.pageContent.innerHTML = `
      <div class="workspace ${showSidePanel ? '' : 'single'}">
        <article class="card">
          <h2>Исходный файл</h2>
          <p>Выберите Excel-файл для обработки этим модулем.</p>
          ${baselineLoading ? '<div class="notice">Загрузка стартовых данных ещё не завершена. Выбор и обработка файлов временно недоступны.</div>' : ''}
          ${processing ? '<div class="notice">Идёт обработка файла. До завершения нельзя менять исходный файл или переходить в другой раздел.</div>' : ''}
          <div class="dropzone" id="dropzone">
            <div>
              <div class="dropzone-title">Перетащите Excel сюда</div>
              <div class="dropzone-text">или выберите файл на компьютере</div>
              <button class="button" id="selectSourceButton" ${workspaceLocked ? 'disabled' : ''}>Выбрать файл</button>
            </div>
          </div>
          <div class="file-summary ${state.sourceFile ? 'visible' : ''}" id="fileSummary">
            <div class="file-name">${state.sourceFile ? escapeHtml(state.sourceFile.name) : ''}</div>
            <div class="file-meta">${state.sourceFile ? `${formatBytes(state.sourceFile.size)} · ${escapeHtml(state.sourceFile.type || 'Excel')}` : ''}</div>
          </div>
          <div class="action-row">
            <button class="button primary" id="processButton" ${state.sourceFile && !workspaceLocked && !processBlockReason ? '' : 'disabled'}>Обработать</button>
            <button class="button ghost" id="clearFileButton" ${state.sourceFile && !workspaceLocked ? '' : 'disabled'}>Очистить</button>
          </div>
          ${processBlockReason ? '<div class="notice" role="status">' + escapeHtml(processBlockReason) + '</div>' : ''}
          ${noticeHtml}
        </article>

        ${showSidePanel ? `<aside class="side-panel">
          ${customSidePanelHtml === null ? `<article class="card flat">
            <h3>Используемые справочники</h3>
            <div class="info-list">${refRows || '<div class="small">Справочники не требуются.</div>'}</div>
            <div class="action-row"><button class="button" id="openReferencesButton">Открыть справочники</button></div>
          </article>
          <article class="card flat">
            <h3>Версия</h3>
            <div class="info-list">
              <div class="info-row"><span class="info-key">Приложение</span><strong>${escapeHtml(build.version)}</strong></div>
              <div class="info-row"><span class="info-key">Правила</span><strong>${escapeHtml(rulesLabel)}</strong></div>
              <div class="info-row"><span class="info-key">Runtime</span><strong>${escapeHtml(runtimeLabel)}</strong></div>
              <div class="info-row"><span class="info-key">Источник данных</span><strong>${
                globalThis.ReclassifierRuntimeDataRepository?.mode?.() === 'sqlite'
                  ? 'Reclassifier.db'
                  : 'HTML-снимок'
              }</strong></div>
            </div>
          </article>` : customSidePanelHtml}
        </aside>` : ''}
      </div>
    `;

    bindModuleEvents(moduleId);
  }

  function bindModuleEvents(moduleId) {
    bindDatasetDropzone('dropzone', 'selectSourceButton', file => setSourceFile(file, moduleId));
    document.getElementById('openReferencesButton')?.addEventListener('click', () => navigate('references'));
    document.getElementById('processButton').addEventListener('click', () => runModuleProbe(moduleId));
    document.getElementById('clearFileButton').addEventListener('click', () => {
      if (!state.baselineReady || state.processingModuleId) return;
      state.sourceFile = null;
      moduleRenderers[moduleId]?.();
    });
  }

  function setSourceFile(file, moduleId) {
    if (!state.baselineReady) {
      throw new Error('Дождитесь завершения загрузки стартовых данных.');
    }
    if (state.processingModuleId) {
      throw new Error('Нельзя менять исходный файл во время обработки.');
    }
    state.sourceFile = file;
    log(`Выбран исходный файл для ${moduleConfig[moduleId].title}: ${file.name} (${formatBytes(file.size)})`);
    moduleRenderers[moduleId]?.();
  }

