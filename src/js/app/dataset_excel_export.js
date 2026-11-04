// Dataset Excel export: read-only period selection for the active ITSM and Mobile Brigade datasets.
// Full Dataset is authoritative for every exported column; compact records supply date keys only.
const reclassifierDatasetExcelExport = (() => {
  'use strict';

  const SETTINGS = Object.freeze({
    itsm_data: Object.freeze({
      prefix: 'itsm', sheetName: 'ITSM',
      outputPrefix: 'ITSM', dateLabel: 'Дата создания Вызова'
    }),
    mobile_brigade_data: Object.freeze({
      prefix: 'mobileBrigade', sheetName: 'Мобильные бригады',
      outputPrefix: 'Mobile_Brigade', dateLabel: 'Фактическая дата'
    })
  });
  const periodCache = new WeakMap();
  const selections = new Map();
  const EXCEL_MAX_DATA_ROWS = 1048575;
  let exporting = false;

  function dateKey(value) {
    if (value instanceof Date || Object.prototype.toString.call(value) === '[object Date]') {
      if (Number.isNaN(value.getTime())) return null;
      return dateKey(value.getFullYear() + '-' +
        String(value.getMonth() + 1).padStart(2, '0') + '-' +
        String(value.getDate()).padStart(2, '0'));
    }
    if (typeof value !== 'string') return null;
    const text = value.trim();
    let year, month, day;
    const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})(?:$|[T\s])/);
    const ru = text.match(/^(\d{1,2})[./](\d{1,2})[./](\d{4})(?:$|[\s])/);
    if (iso) {
      year = Number(iso[1]); month = Number(iso[2]); day = Number(iso[3]);
    } else if (ru) {
      year = Number(ru[3]); month = Number(ru[2]); day = Number(ru[1]);
    } else return null;
    const date = new Date(Date.UTC(year, month - 1, day));
    if (date.getUTCFullYear() !== year ||
        date.getUTCMonth() !== month - 1 ||
        date.getUTCDate() !== day) return null;
    return String(year).padStart(4, '0') + '-' +
      String(month).padStart(2, '0') + '-' + String(day).padStart(2, '0');
  }

  function recordDate(datasetId, record) {
    if (datasetId === 'itsm_data') {
      return dateKey(Array.isArray(record) ? record[0] : record?.createdAt);
    }
    if (datasetId === 'mobile_brigade_data') {
      const value = record?.factDate;
      // The MB parser uses a local wall-clock Date. SQLite/HTML snapshots
      // serialize that Date to UTC ISO. Restore the browser-local calendar
      // day before applying a DATE-only filter, otherwise midnight tasks
      // can slip into the previous day after persistence.
      if (typeof value === 'string' &&
          /^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/i.test(value)) {
        const instant = new Date(value);
        return Number.isNaN(instant.getTime()) ? null : dateKey(instant);
      }
      return dateKey(value);
    }
    throw new Error('Excel-экспорт не поддерживает Dataset ' + datasetId + '.');
  }

  function period(datasetId, instance) {
    if (!SETTINGS[datasetId]) throw new Error('Неизвестный Dataset для экспорта.');
    if (!instance || !Array.isArray(instance.records)) {
      return Object.freeze({ from: null, to: null, dated: 0, undated: 0 });
    }
    const cached = periodCache.get(instance);
    if (cached?.datasetId === datasetId && cached.records === instance.records) {
      return cached.result;
    }
    let from = null, to = null, dated = 0, undated = 0;
    for (const record of instance.records) {
      const key = recordDate(datasetId, record);
      if (!key) { undated += 1; continue; }
      dated += 1;
      if (!from || key < from) from = key;
      if (!to || key > to) to = key;
    }
    const result = Object.freeze({ from, to, dated, undated });
    periodCache.set(instance, { datasetId, records: instance.records, result });
    return result;
  }

  function selection(datasetId, instance) {
    const bounds = period(datasetId, instance);
    const existing = selections.get(datasetId);
    // When the revision changes, do not retain stale limits from another database.
    if (!existing || existing.instance !== instance) {
      const next = { instance, from: bounds.from || '', to: bounds.to || '' };
      selections.set(datasetId, next);
      return next;
    }
    return existing;
  }

  function fullDatasetReady(instance) {
    const full = instance?.fullDataset;
    return Boolean(
      instance && Array.isArray(instance.records) &&
      full && Array.isArray(full.columns) && full.columns.length &&
      Array.isArray(full.rows) && full.rows.length === instance.records.length &&
      full.coverage !== 'partial' && full.coverage !== 'incoming-batch' &&
      instance.meta?.fullDatasetScope !== 'partial' &&
      instance.meta?.fullDatasetScope !== 'incoming-batch'
    );
  }


  const MB_ANALYTICAL_LABELS = Object.freeze({
    site: 'Участок',
    taskNumber: 'Номер задачи',
    taskForShiftId: 'Идентификатор задачи за смену',
    recordKey: 'Ключ записи',
    request: 'Заявка',
    requestUrl: 'Ссылка на заявку',
    factDate: 'Фактическая дата',
    laborHours: 'ФактТрудочас, чел-час',
    astroHours: 'ФактАстрочас, час',
    equipmentPlacement: 'Навесное / Стационарное',
    equipmentUnit: 'Единица оборудования',
    equipmentType: 'Тип оборудования',
    transport: 'Транспорт',
    equipment: 'Оборудование',
    element: 'Элемент',
    fault: 'Неисправность',
    incidentReason: 'Причина инцидента',
    description: 'Описание',
    combinedComment: 'Объединённый комментарий',
    itsmCreatedAt: 'Дата создания вызова ITSM',
    preBacklogAge: 'Возраст пред-бэклога',
    finalTaskType: 'Итоговый тип задачи',
    laborState: 'Состояние трудозатрат'
  });

  function analyticalLayout(datasetId, instance) {
    if (!instance || !Array.isArray(instance.records) || !instance.records.length) {
      return null;
    }
    if (datasetId === 'itsm_data') {
      const first = instance.records.find(row => Array.isArray(row));
      if (!first) return null;
      const width = first.length;
      const schema = globalThis.ReclassifierItsmDatasetSchema;
      const labels = [schema?.labels, instance.meta?.columns, instance.state?.columns,
        instance.meta?.fields, instance.state?.fields].find(items =>
        Array.isArray(items) && items.length === width
      );
      return {
        columns: Array.from({ length: width }, (_, index) =>
          String(labels?.[index] || 'Поле ' + (index + 1))),
        keys: null, width
      };
    }
    if (datasetId === 'mobile_brigade_data') {
      const keys = [];
      const found = new Set();
      // Never lose newly added analytical fields in a later Dataset schema.
      for (const record of instance.records) {
        if (!record || typeof record !== 'object' || Array.isArray(record)) continue;
        for (const key of Object.keys(record)) {
          if (!found.has(key)) {
            found.add(key);
            keys.push(key);
          }
        }
      }
      if (!keys.length) return null;
      return {
        columns: keys.map(key => MB_ANALYTICAL_LABELS[key] || key),
        keys, width: keys.length
      };
    }
    return null;
  }

  function exportSource(datasetId, instance) {
    if (fullDatasetReady(instance)) {
      return {
        mode: 'full',
        columns: instance.fullDataset.columns,
        width: instance.fullDataset.columns.length
      };
    }
    const layout = analyticalLayout(datasetId, instance);
    return layout ? { mode: 'analytical', ...layout } : null;
  }

  function exportNote(datasetId, instance) {
    const source = exportSource(datasetId, instance);
    if (!source) return 'В Active Runtime отсутствуют строки для выгрузки.';
    if (source.mode === 'analytical') {
      return 'Полный Full Dataset не сохранён. Будут выгружены только доступные ' +
        'аналитические поля Active Runtime (' + source.width +
        '), без отсутствующих исходных колонок.';
    }
    return 'Будет выгружен полный Full Dataset (' + source.width + ' колонок).';
  }

  function validatePeriod(datasetId, instance, from, to) {
    const bounds = period(datasetId, instance);
    if (!bounds.from || !bounds.to) {
      throw new Error('В базе отсутствуют записи с корректной датой.');
    }
    if (dateKey(from) !== from || dateKey(to) !== to) {
      throw new Error('Укажите корректные даты начала и окончания периода.');
    }
    if (from > to) throw new Error('Дата «С» не может быть позднее даты «По».');
    if (from < bounds.from || to > bounds.to) {
      throw new Error('Выбранный период выходит за границы данных в базе.');
    }
    if (!exportSource(datasetId, instance)) {
      throw new Error('В Active Runtime нет доступных полей для выгрузки.');
    }
    return bounds;
  }

  function markup(datasetId, instance, disabled = false) {
    const settings = SETTINGS[datasetId];
    if (!settings) return '';
    const bounds = period(datasetId, instance);
    const current = selection(datasetId, instance);
    const source = exportSource(datasetId, instance);
    const unavailable = !bounds.from || !source;
    const locked = disabled || exporting || unavailable;
    const note = !bounds.from
      ? 'В Active Runtime пока нет записей с корректной датой.'
      : exportNote(datasetId, instance) +
        (bounds.undated
          ? ' Без даты: ' + bounds.undated.toLocaleString('ru-RU') + ' строк (в период не входят).'
          : '');
    const format = globalThis.ReclassifierModuleSourceStatus?.formatDate ||
      (value => value || '—');
    const id = settings.prefix;
    const runtimeMode = globalThis.ReclassifierRuntimeDataRepository?.mode?.() || 'legacy';
    const sourceLabel = runtimeMode === 'sqlite' ? 'SQLite (Active Runtime)' :
      'HTML Dataset Store (Active Runtime)';
    return '<article class="card flat dataset-period-export" data-dataset="' + datasetId + '">' +
      '<h3>Скачать обработанный файл</h3>' +
      '<p class="dataset-period-info">Экспорт по <strong>[' +
      escapeHtml(settings.dateLabel) + ']</strong> · ' +
      escapeHtml(source?.width ?? '—') + ' колонок</p>' +
      '<p class="dataset-period-info">Период: <strong>' +
      escapeHtml(format(bounds.from)) + '</strong> — <strong>' +
      escapeHtml(format(bounds.to)) + '</strong> · ' + escapeHtml(sourceLabel) + '</p>' +
      '<div class="dataset-period-fields">' +
      '<label for="' + id + 'ExportFrom">С <input id="' + id + 'ExportFrom" type="date" value="' +
      escapeHtml(current.from) + '" min="' + escapeHtml(bounds.from || '') +
      '" max="' + escapeHtml(bounds.to || '') + '"' + (locked ? ' disabled' : '') +
      '></label>' +
      '<label for="' + id + 'ExportTo">По <input id="' + id + 'ExportTo" type="date" value="' +
      escapeHtml(current.to) + '" min="' + escapeHtml(bounds.from || '') +
      '" max="' + escapeHtml(bounds.to || '') + '"' + (locked ? ' disabled' : '') +
      '></label></div>' +
      '<button class="button primary dataset-period-download" id="' + id +
      'ExportButton"' + (locked ? ' disabled' : '') + '>Скачать обработанный файл</button>' +
      '<p class="dataset-period-note" id="' + id + 'ExportNote" role="status">' +
      escapeHtml(note) + '</p></article>';
  }

  function selectRows(datasetId, instance, from, to) {
    validatePeriod(datasetId, instance, from, to);
    const source = exportSource(datasetId, instance);
    const width = source.width;
    if (!source.columns.every(column => typeof column === 'string')) {
      throw new Error('Набор данных содержит некорректные заголовки колонок.');
    }
    const rows = [];
    for (let index = 0; index < instance.records.length; index += 1) {
      const date = recordDate(datasetId, instance.records[index]);
      if (!date || date < from || date > to) continue;
      let row;
      if (source.mode === 'full') {
        row = instance.fullDataset.rows[index];
      } else if (datasetId === 'itsm_data') {
        row = instance.records[index];
      } else {
        const record = instance.records[index];
        row = source.keys.map(key => record?.[key] ?? null);
      }
      if (!Array.isArray(row) || row.length !== width) {
        throw new Error('Строка с неверным количеством колонок: ' + (index + 1) + '.');
      }
      rows.push(row);
      if (rows.length > EXCEL_MAX_DATA_ROWS) {
        throw new Error('Excel поддерживает не более ' + EXCEL_MAX_DATA_ROWS +
          ' строк данных на одном листе. Выберите меньший период.');
      }
    }
    if (!rows.length) {
      throw new Error('В выбранном периоде отсутствуют записи для выгрузки.');
    }
    return { columns: source.columns, rows, mode: source.mode };
  }

  function download(bytes, name) {
    const trace = globalThis.ReclassifierXlsxExportDiagnostics;
    trace?.mark?.('xlsx-download','start',{outputBytes:bytes?.byteLength || 0});
    if (!(bytes instanceof ArrayBuffer)) {
      throw new Error('Обработчик Excel не вернул готовый файл.');
    }
    const blob = new Blob([bytes], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    });
    const url = URL.createObjectURL(blob);
    try {
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = name;
      anchor.style.display = 'none';
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      trace?.mark?.('xlsx-download','end',{outputBytes:bytes.byteLength});
    } finally {
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
  }

  async function exportPeriod(datasetId, instance, from, to, onProgress) {
    if (exporting || state.processingModuleId) {
      throw new Error('Другая операция уже выполняется.');
    }
    // Validate before creating the Worker operation or copying rows.
    validatePeriod(datasetId, instance, from, to);
    const config = SETTINGS[datasetId];
    const snapshot = {
      mode: globalThis.ReclassifierRuntimeDataRepository?.mode?.() || 'legacy',
      instance,
      records: instance.records,
      fullDataset: instance.fullDataset
    };
    exporting = true;
    state.processingModuleId = datasetId;
    try {
      const subset = selectRows(datasetId, instance, from, to);
      const result = await workerRequest('EXPORT_DATASET_XLSX', {
        sheetName: config.sheetName,
        columns: subset.columns,
        rows: subset.rows,
        datasetId
      }, [], onProgress);

      // If a connected database was replaced while exporting, reject stale output.
      if (datasetStore.get(datasetId) !== snapshot.instance ||
          instance.records !== snapshot.records ||
          instance.fullDataset !== snapshot.fullDataset ||
          (globalThis.ReclassifierRuntimeDataRepository?.mode?.() || 'legacy') !== snapshot.mode) {
        throw new Error('База данных изменилась во время экспорта. Повторите выгрузку.');
      }
      const name = config.outputPrefix + '_' + from + '_' + to + '.xlsx';
      download(result?.bytes, name);
      log('Экспорт ' + datasetId + ' (' + subset.mode + '): ' + subset.rows.length +
        ' строк за период ' + from + ' — ' + to + '. Файл: ' + name);
      return { outputName: name, rows: subset.rows.length, mode: subset.mode,
        longTextCells:result?.longTextCells || 0 };
    } finally {
      exporting = false;
      if (state.processingModuleId === datasetId) state.processingModuleId = null;
    }
  }

  const SQLITE_MB_PAGE_ROWS = 10000;
  function sqliteMobileAnalyticalSchema() {
    const keys = Object.keys(MB_ANALYTICAL_LABELS);
    return {keys,columns:keys.map(key => MB_ANALYTICAL_LABELS[key])};
  }
  let sqliteMbInfoCache = null;
  let sqliteMbSelection = null;

  function sqliteMobileInfo() {
    const repository = globalThis.ReclassifierDatabaseRepository;
    if (!repository?.hasOpenDatabase?.()) return null;
    const database = repository.getDatabaseInfo();
    const registry = repository.getDatasetRegistry('mobile_brigade_data');
    const key = String(database.databaseUuid) + ':' +
      String(registry.active_revision) + ':' + String(registry.record_count);
    if (!sqliteMbInfoCache || sqliteMbInfoCache.key !== key) {
      const info = repository.getMobileBrigadeExportInfo();
      sqliteMbInfoCache = {key, info};
      sqliteMbSelection = {key, from:info.from || '', to:info.to || '',
        mode:info.fullDatasetAvailable ? 'full' : 'analytical'};
    }
    return sqliteMbInfoCache.info;
  }

  function sqliteMobileSummary() {
    const info = sqliteMobileInfo();
    if (!info || !info.rows) {
      return '<article class="card flat module-dataset-card"><h3>Данные в текущей базе</h3>' +
        '<p class="small">В SQLite пока нет данных Мобильных бригад.</p></article>';
    }
    const format = globalThis.ReclassifierModuleSourceStatus?.formatDate ||
      (value => value || '—');
    return '<article class="card flat module-dataset-card">' +
      '<h3>Данные в текущей базе</h3>' +
      '<p>В SQLite находится <strong>' +
      escapeHtml(info.rows.toLocaleString('ru-RU')) +
      '</strong> записей Мобильных бригад.</p>' +
      '<p>Фактические даты работ: <strong>' + escapeHtml(format(info.from)) +
      ' — ' + escapeHtml(format(info.to)) + '</strong>.</p>' +
      '<p>Сохранённые обработанные строки Full Dataset: <strong>' +
      escapeHtml(info.fullRows.toLocaleString('ru-RU')) +
      '</strong>; без исходной строки: <strong>' +
      escapeHtml(info.missingFullRows.toLocaleString('ru-RU')) +
      '</strong>.</p>' +
      (info.undated ? '<p class="small">Без корректной фактической даты: ' +
        escapeHtml(info.undated.toLocaleString('ru-RU')) + ' строк.</p>' : '') +
      '<p class="small">Источник: подключённая SQLite. Для просмотра и экспорта ' +
      'весь Dataset не загружается в JavaScript.</p></article>';
  }

  function sqliteMobileMarkup(disabled = false) {
    const info = sqliteMobileInfo();
    if (!info || !info.rows) {
      return '<article class="card flat"><h3>Экспорт из SQLite</h3>' +
        '<p class="small">Данные Мобильных бригад отсутствуют.</p></article>';
    }
    const select = sqliteMbSelection;
    const format = globalThis.ReclassifierModuleSourceStatus?.formatDate ||
      (value => value || '—');
    const locked = disabled || exporting || !info.from ||
      (select.mode === 'full' && !info.fullDatasetAvailable);
    const missingNotice = info.missingFullRows
      ? 'Сохранённый Full Dataset содержит ' +
        info.fullRows.toLocaleString('ru-RU') + ' из ' +
        info.rows.toLocaleString('ru-RU') + ' записей. ' +
        info.missingFullRows.toLocaleString('ru-RU') +
        ' строк без исходного набора 38 колонок нельзя восстановить из ' +
        '23 аналитических полей. В режиме 38 колонок они явно исключаются; ' +
        'для полного восстановления потребуются исходные файлы Excel.'
      : 'Для всех записей сохранён обработанный Full Dataset.';
    return '<article class="card flat dataset-period-export" data-dataset="mobile_brigade_data">' +
      '<h3>Экспорт Мобильных бригад из SQLite</h3>' +
      '<p class="dataset-period-info">Фактический период: <strong>' +
      escapeHtml(format(info.from)) + ' — ' + escapeHtml(format(info.to)) +
      '</strong> · ' + escapeHtml(info.rows.toLocaleString('ru-RU')) +
      ' записей · ' + escapeHtml(info.columns.length) + ' колонок обработанного Full Dataset.</p>' +
      '<p class="dataset-period-note" role="status">' + escapeHtml(missingNotice) + '</p>' +
      '<label for="sqliteMbExportMode">Состав выгрузки ' +
      '<select id="sqliteMbExportMode"' + (disabled || exporting ? ' disabled' : '') + '>' +
      '<option value="analytical"' + (select.mode === 'analytical' ? ' selected' : '') +
      '>Все записи — аналитические поля (' +
        sqliteMobileAnalyticalSchema().keys.length + ' колонок)</option>' +
      '<option value="full"' + (select.mode === 'full' ? ' selected' : '') +
      (info.fullDatasetAvailable ? '' : ' disabled') +
      '>Обработанные строки Full Dataset (' +
        info.columns.length + ' колонок, только сохранённые)</option></select></label>' +
      '<div class="dataset-period-fields">' +
      '<label for="sqliteMbExportFrom">С <input id="sqliteMbExportFrom" type="date" value="' +
      escapeHtml(select.from) + '" min="' + escapeHtml(info.from || '') +
      '" max="' + escapeHtml(info.to || '') + '"' + (locked ? ' disabled' : '') + '></label>' +
      '<label for="sqliteMbExportTo">По <input id="sqliteMbExportTo" type="date" value="' +
      escapeHtml(select.to) + '" min="' + escapeHtml(info.from || '') +
      '" max="' + escapeHtml(info.to || '') + '"' + (locked ? ' disabled' : '') + '></label>' +
      '</div>' +
      '<button class="button primary" id="sqliteMbExportButton"' +
      (locked ? ' disabled' : '') + '>Скачать XLSX</button>' +
      '<p class="small" id="sqliteMbExportNote" role="status">' +
      'Один XLSX за весь выбранный период. Приложение читает SQLite ' +
      'пакетами и формирует единый Excel. Это может потребовать много памяти.' +
      '</p>' +
      (globalThis.ReclassifierXlsxExportDiagnostics?.enabled?.() ?
        '<div class="notice" style="margin-top:12px">' +
        '<strong>TEST_11_PR322 · подробная диагностика экспорта</strong>' +
        '<p class="small">Два отчёта JSON (экспорт и Runtime/KPI) запрашиваются автоматически ' +
        'после завершения или ошибки. Браузер может запросить разрешение на несколько скачиваний. ' +
        'После сбоя вкладки контрольные точки могут сохраниться в localStorage.</p>' +
        '<p class="small" id="sqliteMbDiagStatus" role="status"></p>' +
        '<button class="button ghost" id="sqliteMbDiagCopy">Копировать отчёт</button> ' +
        '<button class="button ghost" id="sqliteMbDiagDownload">Скачать отчёт JSON</button>' +
        '</div>' : '') + '</article>';
  }

  async function sqliteMobileExportPeriod(from, to, onProgress, mode = 'full') {
    // In TEST_15 obtain exclusive access before the expensive SQLite scan.
    // The gate preempts only auto KPI; an interactive KPI is never terminated.
    const gate=globalThis.ReclassifierHeavyJobGate;
    const lease=gate?.begin?.('xlsx');
    try {
      return await sqliteMobileExportPeriodInner(from,to,onProgress,mode);
    } finally {
      gate?.end?.(lease);
    }
  }
  async function sqliteMobileExportPeriodInner(from, to, onProgress, mode = 'full') {
    if (exporting || state.processingModuleId) {
      throw new Error('Другая операция уже выполняется.');
    }
    const info = sqliteMobileInfo();
    if (!info?.from || !info.to ||
        !['full','analytical'].includes(mode) ||
        (mode === 'full' && !info.fullDatasetAvailable) ||
        dateKey(from) !== from || dateKey(to) !== to ||
        from > to || from < info.from || to > info.to) {
      throw new Error('Выбранный период недопустим для SQLite МБ.');
    }
    const repository = globalThis.ReclassifierDatabaseRepository;
    const version = {uuid:info.databaseUuid,revision:info.revision};
    const columns = mode === 'full'
      ? info.columns.slice()
      : sqliteMobileAnalyticalSchema().columns;
    const trace = globalThis.ReclassifierXlsxExportDiagnostics;
    const diagnosticsActive = trace?.begin?.({
      from,to,mode,sourceRows:info.rows,fullRows:info.fullRows,
      missingFullRows:info.missingFullRows,undated:info.undated,
      columns:columns.length,revision:info.revision
    }) === true;
    if(diagnosticsActive) {
      trace.setCoverage?.(info.monthlyCoverage);
      trace.captureDatabase?.({
        ...repository.getDiagnosticMemorySnapshot?.(),
        sourceRows:info.rows,fullRows:info.fullRows,
        missingFullRows:info.missingFullRows,undated:info.undated,
        revision:info.revision
      });
      trace.mark('sqlite-info-scan','end',{durationMs:info.infoScanDurationMs||0,
        sourceRows:info.rows,fullRows:info.fullRows});
    }
    const oldTrace=globalThis.ReclassifierDatabaseMemoryDiagnostics;
    if (globalThis.RECLASSIFIER_BUILD?.testLabel==='TEST_12_PR322') {
      oldTrace?.mark?.('xlsx-export','start',{rows:info.rows,
        fullDatasetRows:info.fullRows,recordCount:info.rows});
    }
    exporting = true;
    state.processingModuleId = 'mobile_brigade_export';
    let expectedOffset = 0;
    let completed = false;
    try {
      trace?.mark?.('xlsx-worker-request','start',{columns:columns.length});
      const generated = await workerRequest('EXPORT_DATASET_XLSX_STREAM',{
        datasetId:'mobile_brigade_data', sheetName:'Мобильные бригады',
        columns
      },[],progress=>{
        if (progress?.diagnostic && diagnosticsActive) {
          const event = progress.diagnostic;
          trace.mark(event.phase,event.event,event.values || {});
        }
        onProgress?.(progress);
      },({offset,sequence})=>{
        if (!Number.isSafeInteger(offset) || offset !== expectedOffset) {
          throw new Error('Неверный порядок партий экспорта МБ.');
        }
        const current = repository.getDatabaseInfo();
        const registry = repository.getDatasetRegistry('mobile_brigade_data');
        if (current.databaseUuid !== version.uuid ||
            Number(registry.active_revision || 0) !== version.revision) {
          throw new Error('SQLite изменилась во время экспорта XLSX.');
        }
        trace?.mark?.('xlsx-sqlite-page','start',{offset,
          batchNumber:Number.isInteger(sequence) ? sequence+1 : 0});
        const page = repository.getMobileBrigadeExportPage(
          from,to,offset,SQLITE_MB_PAGE_ROWS,mode
        );
        trace?.mark?.('xlsx-sqlite-page','end',{
          offset, batchNumber:Number.isInteger(sequence) ? sequence+1 : 0,
          batchRows:page.rows.length, scannedRows:page.diagnostics?.scannedRows,
          matchedRows:page.diagnostics?.matchedRows,
          jsonChars:page.diagnostics?.jsonChars,
          durationMs:page.diagnostics?.durationMs,
          hasMore:page.hasMore ? 1 : 0
        });
        if (page.columns.length !== columns.length ||
            page.columns.some((name,i)=>name!==columns[i])) {
          throw new Error('Изменилась схема колонок SQLite при экспорте.');
        }
        expectedOffset = page.nextOffset;
        return {rows:page.rows,hasMore:page.hasMore};
      });
      const current = repository.getDatabaseInfo();
      const registry = repository.getDatasetRegistry('mobile_brigade_data');
      if (current.databaseUuid !== version.uuid ||
          Number(registry.active_revision || 0) !== version.revision) {
        throw new Error('SQLite изменилась до завершения XLSX.');
      }
      const name = 'Mobile_Brigade_' + mode + '_' + from + '_' + to + '.xlsx';
      trace?.mark?.('xlsx-worker-transfer','end',{
        totalRows:generated?.rows || 0,outputBytes:generated?.bytes?.byteLength || 0
      });
      trace?.mark?.('xlsx-worker-request','end',{
        totalRows:generated?.rows || 0,outputBytes:generated?.bytes?.byteLength || 0
      });
      trace?.mark?.('xlsx-result','end',{
        totalRows:generated?.rows || 0,outputBytes:generated?.bytes?.byteLength || 0,
        longTextCells:generated?.longTextCells || 0,
        overflowParts:generated?.overflowParts || 0
      });
      download(generated?.bytes,name);
      completed = true;
      return {outputName:name,rows:generated?.rows || 0,mode,
        longTextCells:generated?.longTextCells || 0,
        overflowParts:generated?.overflowParts || 0};
    } catch (error) {
      trace?.mark?.('xlsx-export-failure','error',{totalRows:expectedOffset});
      throw error;
    } finally {
      if (diagnosticsActive) {
        trace.finish(completed ? 'completed' : 'failed',{totalRows:expectedOffset});
        if (!(await trace.downloadReport())) {
          log('Диагностический JSON не был скачан автоматически. ' +
            'Используйте кнопку «Скачать отчёт JSON» на странице МБ.','WARN');
        }
      }
      if (['TEST_12_PR322','TEST_13_PR322','TEST_14_PR322','TEST_15_PR324','TEST_16_PR326','TEST_17_PR332','TEST_18_PR335'].includes(globalThis.RECLASSIFIER_BUILD?.testLabel)) {
        oldTrace?.mark?.('xlsx-export',completed?'end':'error',
          {rows:expectedOffset,recordCount:info.rows});
        // Download the separate Runtime/KPI history after the XLSX journal.
        await oldTrace?.downloadReport?.();
      }
      exporting = false;
      if (state.processingModuleId === 'mobile_brigade_export') {
        state.processingModuleId = null;
      }
    }
  }

  function bindSqliteMobile(render) {
    const fromInput = document.getElementById('sqliteMbExportFrom');
    const toInput = document.getElementById('sqliteMbExportTo');
    const button = document.getElementById('sqliteMbExportButton');
    const modeInput = document.getElementById('sqliteMbExportMode');
    const note = document.getElementById('sqliteMbExportNote');
    const trace = globalThis.ReclassifierXlsxExportDiagnostics;
    trace?.status?.();
    document.getElementById('sqliteMbDiagCopy')?.addEventListener('click',async()=>{
      const copied = await trace?.copy?.();
      if (!copied) alert('Автоматическое копирование недоступно. Скачайте JSON.');
    });
    document.getElementById('sqliteMbDiagDownload')?.addEventListener('click',()=>{
      if (!trace?.downloadReport?.()) alert('Не удалось запросить скачивание JSON.');
    });
    if (!fromInput || !toInput || !modeInput || !button || !note) return;
    const info = sqliteMobileInfo();
    const selection = sqliteMbSelection;
    const updatePeriod = () => {
      if (fromInput.value !== selection.from || toInput.value !== selection.to ||
          modeInput.value !== selection.mode) {
        selection.from=fromInput.value;
        selection.to=toInput.value;
        selection.mode=modeInput.value;
      }
      const valid = Boolean(info &&
        (selection.mode === 'analytical' ||
         (selection.mode === 'full' && info.fullDatasetAvailable)) &&
        dateKey(selection.from) === selection.from &&
        dateKey(selection.to) === selection.to &&
        selection.from <= selection.to &&
        selection.from >= info.from && selection.to <= info.to);
      button.disabled = !valid || exporting || Boolean(state.processingModuleId);
      button.textContent = 'Скачать XLSX';
      note.textContent = valid
        ? selection.mode === 'full'
          ? 'Один XLSX со всеми доступными 38-колоночными строками за период.'
          : 'Один XLSX со всеми датированными аналитическими строками за период.'
        : 'Выберите режим и даты в пределах фактического периода.';
    };
    fromInput.addEventListener('change',updatePeriod);
    toInput.addEventListener('change',updatePeriod);
    modeInput.addEventListener('change',updatePeriod);
    button.addEventListener('click',async()=>{
      if (button.disabled) return;
      button.disabled=true;
      fromInput.disabled=true;
      toInput.disabled=true;
      modeInput.disabled=true;
      button.textContent='Подготовка Excel…';
      try {
        const result=await sqliteMobileExportPeriod(
          selection.from,selection.to,
          progress => {
            if (button.isConnected !== false && progress?.label) {
              button.textContent=progress.label +
                (Number.isFinite(progress.percent)
                  ? '… ' + Math.round(progress.percent) + '%' : '…');
            }
          },selection.mode
        );
        log('SQLite МБ Excel: ' + result.outputName + ' · ' +
          result.rows + ' строк' +
          (result.longTextCells ? '; длинных ячеек ' +
            result.longTextCells + ' (продолжения на дополнительном листе).' : '') + '.');
        if (result.longTextCells) {
          alert('Excel содержит ' + result.longTextCells +
            ' длинных текстовых ячеек. Полные продолжения сохранены ' +
            'на листе «Продолжения текстов» этого же XLSX; ' +
            'первый фрагмент остаётся в основном листе.');
        }
        alert('Экспорт выбранного периода завершён. Скачан ' +
          result.outputName + ' (' + result.rows.toLocaleString('ru-RU') +
          ' строк).');
      } catch (error) {
        const message=error?.message || String(error);
        log('Ошибка экспорта SQLite МБ: '+message,'ERROR');
        alert('Не удалось скачать Excel: '+message);
      } finally {
        if (state.route === 'mobile_brigade') render();
      }
    });
  }

  function bind(datasetId, render) {
    const config = SETTINGS[datasetId];
    if (!config) return;
    const id = config.prefix;
    const fromInput = document.getElementById(id + 'ExportFrom');
    const toInput = document.getElementById(id + 'ExportTo');
    const button = document.getElementById(id + 'ExportButton');
    const note = document.getElementById(id + 'ExportNote');
    if (!fromInput || !toInput || !button || !note) return;
    const instance = datasetStore.get(datasetId);
    const current = selection(datasetId, instance);
    function sync() {
      current.from = fromInput.value;
      current.to = toInput.value;
      try {
        validatePeriod(datasetId, instance, current.from, current.to);
        button.disabled = Boolean(state.processingModuleId || exporting);
        const undated = period(datasetId, instance).undated;
        note.textContent = exportNote(datasetId, instance) +
          (undated ? ' Без даты: ' + undated.toLocaleString('ru-RU') +
            ' строк (в период не входят).' : '');
      } catch (error) {
        button.disabled = true;
        note.textContent = error.message || String(error);
      }
    }
    fromInput.addEventListener('change', sync);
    toInput.addEventListener('change', sync);
    button.addEventListener('click', async () => {
      if (button.disabled) return;
      button.disabled = true;
      fromInput.disabled = true;
      toInput.disabled = true;
      button.textContent = 'Формирование Excel…';
      try {
        const result = await exportPeriod(
          datasetId, instance, current.from, current.to,
          progress => {
            if (button.isConnected !== false && progress?.label) {
              button.textContent = progress.label + '… ' +
                Math.round(Number(progress.percent || 0)) + '%';
            }
          }
        );
        alert('Excel сохранён: ' + result.outputName + ' (' + result.rows + ' строк). ' +
          (result.mode === 'analytical' ? 'Экспортированы только аналитические поля Active Runtime.' : 'Полный Full Dataset.') +
          (result.longTextCells ? ' Продолжения ' + result.longTextCells +
            ' длинных ячеек сохранены на дополнительном листе XLSX.' : ''));
      } catch (error) {
        const message = error?.message || String(error);
        log('Ошибка экспорта ' + datasetId + ': ' + message, 'ERROR');
        alert('Не удалось скачать Excel: ' + message);
      } finally {
        // Re-render to unlock controls (and pick up an updated active revision).
        if (state.route === (datasetId === 'itsm_data' ? 'itsm' : 'mobile_brigade')) {
          render();
        }
      }
    });
  }

  return Object.freeze({
    dateKey, recordDate, period, selection, fullDatasetReady,
    analyticalLayout, exportSource, exportNote, validatePeriod, selectRows,
    markup, bind, exportPeriod,
    sqliteMobileInfo, sqliteMobileSummary, sqliteMobileMarkup,
    sqliteMobileAnalyticalSchema, bindSqliteMobile, sqliteMobileExportPeriod
  });
})();
globalThis.ReclassifierDatasetExcelExport = reclassifierDatasetExcelExport;
