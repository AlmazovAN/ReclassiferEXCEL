// FILE CONTRACT: Mobile Brigade module adapter and presentation layer.
// Purpose: manage selected source files, delegate processing to Worker and present Dataset status.
// Owns: module-local file selection state, operation UI and candidate application commands.
// Reads: Mobile Brigade Rules, Dataset adapter, Runtime Repository/Lifecycle Manager and Worker API.
// Writes: UI plus approved Dataset lifecycle operations; workbook I/O stays in Worker.
// Public API: renderMobileBrigadeModule registered through registerModule('mobile_brigade', ...).
// Must not: parse/write Excel directly or duplicate Mobile Brigade classification rules.
// Related tests: test_mobile_brigade_rules.js, test_mobile_brigade_worker_processor.js,
//                test_mobile_brigade_upsert.js, test_architecture_guardrails.py.

  const mobileBrigadeRules = globalThis.ReclassifierMobileBrigadeRules;
  if (!mobileBrigadeRules) throw new Error('Mobile Brigade rules module is not loaded.');

  const MOBILE_BRIGADE_RULES_VERSION = mobileBrigadeRules.version;
  const mobileBrigadeDatasetLifecycle = globalThis.ReclassifierDatasetLifecycleManager;
  const mobileBrigadeDatasetAdapter = globalThis.ReclassifierMobileBrigadeDataset;
  const mobileBrigadeUiFullDatasetContract = globalThis.ReclassifierFullDatasetContract;
  if (!mobileBrigadeDatasetLifecycle || !mobileBrigadeDatasetAdapter || !mobileBrigadeUiFullDatasetContract) {
    throw new Error('Mobile Brigade требует Dataset Lifecycle Manager и Dataset adapter.');
  }
  let mobileBrigadeFiles = [];
  let mobileBrigadeOperationSequence = 0;
  let mobileSqliteStage = null;
  let mobileShowSqliteExport = false;
  let mobileBatchSize = 5000;
  const MB_DIAG_KEY = 'reclassifier.mb.oom-diagnostics.v1';
  let mbDiagEnabled = false;
  function restoreMbDiag() {
    try {
      if (typeof localStorage === 'undefined') return null;
      const data = JSON.parse(localStorage.getItem(MB_DIAG_KEY) || 'null');
      return data?.schemaVersion === 1 ? data : null;
    } catch (_) { return null; }
  }
  let mbDiag = restoreMbDiag();
  let mbDiagPersisted = Boolean(mbDiag);

  function saveMbDiag() {
    try {
      if (typeof localStorage === 'undefined') throw new Error('no storage');
      localStorage.setItem(MB_DIAG_KEY, JSON.stringify(mbDiag));
      mbDiagPersisted = true;
    } catch (_) { mbDiagPersisted = false; }
  }

  function showMbDiag() {
    const el = document.getElementById('mbDiagStatus');
    if (!el) return;
    if (!mbDiag) { el.textContent = 'Отчёт отсутствует.'; return; }
    const recent = mbDiag.history?.at(-1);
    el.textContent = 'Статус: ' + mbDiag.status +
      '; последний начатый этап: ' + (mbDiag.lastStarted || '—') +
      '; последний завершённый этап: ' + (mbDiag.lastCompleted || '—') +
      '; подтверждено партий: ' + (mbDiag.confirmedBatches || 0) +
      '; событие: ' + (recent ? recent.stage + '/' + recent.event : '—') +
      (mbDiagPersisted ? '' : '; сохранение в браузере недоступно');
  }

  function startMbDiag(mode) {
    if (!mbDiagEnabled) return;
    mbDiag = {
      schemaVersion:1, status:'running', mode, startedAt:new Date().toISOString(),
      fileCount:mobileBrigadeFiles.length,
      totalInputBytes:mobileBrigadeFiles.reduce((sum,file)=>sum+(Number(file.size)||0),0),
      history:[], lastStarted:null, lastCompleted:null, confirmedBatches:0,
      memoryMetric:'unavailable'
    };
    saveMbDiag();
    showMbDiag();
  }

  function recordMbDiag(input) {
    if (!mbDiagEnabled || !mbDiag || !input) return;
    const stage = String(input.stage || '');
    const event = String(input.event || '');
    if (!/^[a-z][a-z0-9-]{0,39}$/.test(stage) || !['start','end','error'].includes(event)) return;
    const item = {stage,event,at:new Date().toISOString()};
    // Do not persist arbitrary payload properties, filenames, identifiers or rows.
    for (const key of ['fileIndex','sheetIndex','sheetCount','inputBytes','acceptedRows',
      'batchNumber','batchRows','confirmedBatches']) {
      if (Number.isSafeInteger(input[key]) && input[key]>=0) item[key]=input[key];
    }
    const bytes = typeof performance !== 'undefined' ? performance.memory?.usedJSHeapSize : null;
    if (Number.isFinite(bytes)) {
      item.jsHeapUsedMB = Math.round(bytes / 1048576);
      mbDiag.memoryMetric = 'main-thread performance.memory.usedJSHeapSize';
    }
    mbDiag.history.push(item);
    mbDiag.history = mbDiag.history.slice(-40);
    if (event==='start') mbDiag.lastStarted=stage;
    if (event==='end') mbDiag.lastCompleted=stage;
    if (Number.isSafeInteger(item.confirmedBatches)) {
      mbDiag.confirmedBatches=item.confirmedBatches;
    }
    saveMbDiag();
    showMbDiag();
  }

  function finishMbDiag(status) {
    if (!mbDiagEnabled || !mbDiag) return;
    mbDiag.status = status;
    mbDiag.finishedAt = new Date().toISOString();
    saveMbDiag();
    showMbDiag();
  }

  async function copyMbDiag() {
    if (!mbDiag) return;
    const report = JSON.stringify({...mbDiag,storagePersisted:mbDiagPersisted,
      browser:typeof navigator!=='undefined' ? navigator.userAgent : 'unavailable'}, null, 2);
    try {
      if (!navigator.clipboard?.writeText) throw new Error('unavailable');
      await navigator.clipboard.writeText(report);
      alert('Диагностический отчёт скопирован.');
    } catch (_) {
      const field=document.createElement('textarea');
      field.value=report; field.style.position='fixed'; field.style.left='-9999px';
      document.body.appendChild(field); field.select();
      let copied=false;
      try { copied=document.execCommand('copy'); } catch (_) {}
      field.remove();
      if (copied) alert('Диагностический отчёт скопирован.');
      else window.prompt('Скопируйте диагностический отчёт:',report);
    }
  }

  function mobileBrigadeFilesLocked() {
    return !state.baselineReady || Boolean(state.processingModuleId);
  }

// ============================================================================
// FILE SELECTION STATE
// ============================================================================
  function releaseMobileSqliteStage() {
    if (mobileSqliteStage) {
      try {
        globalThis.ReclassifierMobileBrigadeStaging?.discard?.(mobileSqliteStage.id);
      } catch (error) {
        log('Не удалось освободить временную партию МБ: ' +
          (error?.message || String(error)), 'WARN');
      }
      mobileSqliteStage = null;
    }
  }

  function addMobileBrigadeFiles(files) {
    if (mobileBrigadeFilesLocked()) {
      log('Мобильные бригады: изменение списка файлов недоступно во время загрузки или обработки.', 'WARN');
      return;
    }
    const allowed = /\.(xlsx|xlsm|xls)$/i;
    // File.name is NOT a unique ID. Preserve different File objects, even
    // if both exports share a filename; only skip an identical File instance.
    const selected = mobileBrigadeFiles.slice();
    for (const file of Array.from(files || [])) {
      if (!allowed.test(file.name)) {
        log('Мобильные бригады: пропущен неподдерживаемый файл «' + file.name + '».', 'WARN', 'import_export');
        continue;
      }
      if (!selected.includes(file)) selected.push(file);
    }
    mobileBrigadeDatasetLifecycle.discard('mobile_brigade_data');
    releaseMobileSqliteStage();
    mobileBrigadeFiles = selected;
    log('Мобильные бригады: выбрано файлов ' + mobileBrigadeFiles.length + '.', 'INFO', 'import_export');
    renderMobileBrigadeModule();
  }

  function removeMobileBrigadeFile(index) {
    if (mobileBrigadeFilesLocked()) return;
    mobileBrigadeDatasetLifecycle.discard('mobile_brigade_data');
    releaseMobileSqliteStage();
    mobileBrigadeFiles.splice(index, 1);
    renderMobileBrigadeModule();
  }

  function clearMobileBrigadeFiles() {
    if (mobileBrigadeFilesLocked()) return;
    mobileBrigadeDatasetLifecycle.discard('mobile_brigade_data');
    releaseMobileSqliteStage();
    mobileBrigadeFiles = [];
    renderMobileBrigadeModule();
  }

// ============================================================================
// WORKER PROCESSING / RESULT DOWNLOAD / DATASET APPLICATION
// ============================================================================
  function downloadMobileBrigadeResult(bytes, outputName) {
    const blob = new Blob([bytes], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = outputName;
    anchor.style.display = 'none';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function processMobileBrigadeSqliteStage(operation = {}) {
    const repository = globalThis.ReclassifierMobileBrigadeStaging;
    recordMbDiag({stage:'sqlite-ready',event:'start'});
    if (!repository?.sqliteReady?.()) throw new Error('Подключите SQLite.');
    recordMbDiag({stage:'sqlite-ready',event:'end'});
    releaseMobileSqliteStage();
    mobileBrigadeDatasetLifecycle.discard('mobile_brigade_data');
    const stageStartedAt = typeof performance !== 'undefined' ? performance.now() : Date.now();
    recordMbDiag({stage:'stage-begin',event:'start'});
    const stage = repository.begin(mobileBatchSize);
    recordMbDiag({stage:'stage-begin',event:'end'});
    const sourceFiles = mobileBrigadeFiles.slice();
    const transfer = [];
    const files = [];
    try {
      for (const file of sourceFiles) {
        recordMbDiag({stage:'read-file',event:'start',inputBytes:file.size});
        const bytes = await file.arrayBuffer();
        recordMbDiag({stage:'read-file',event:'end',inputBytes:bytes.byteLength});
        files.push({fileName:file.name,bytes});
        transfer.push(bytes);
      }
      recordMbDiag({stage:'itsm-links',event:'start'});
      const itsmData = repository.itsmLinks();
      recordMbDiag({stage:'itsm-links',event:'end'});
      const result = await workerRequest(
        'PROCESS_MOBILE_BRIGADE',
        {files,itsmData,deferExport:true,streamToSqlite:true,batchSize:mobileBatchSize,
          memoryDiagnostics:mbDiagEnabled},
        transfer,
        operation.onProgress,
        payload => {
          if (state.processingOperationId !== operation.operationId) {
            throw new Error('Операция МБ устарела. Временная партия отклонена.');
          }
          recordMbDiag({stage:'stage-write',event:'start',
            batchNumber:payload.sequence,batchRows:payload.rows?.length||0});
          const result=repository.append(stage.id,payload.sequence,payload.rows);
          recordMbDiag({stage:'stage-write',event:'end',
            batchNumber:payload.sequence,batchRows:payload.rows?.length||0});
          return result;
        }
      );
      if (!result?.stageOnly || result.stats?.rows <= 0) {
        throw new Error('Worker не завершил пакетную обработку МБ.');
      }
      if (state.processingOperationId !== operation.operationId ||
          sourceFiles.length !== mobileBrigadeFiles.length ||
          sourceFiles.some((file,index) => mobileBrigadeFiles[index] !== file)) {
        throw new Error('Выбранные файлы изменились во время обработки.');
      }
      if (result.stats?.batchSize !== mobileBatchSize) {
        throw new Error('Размер пакета МБ в Worker не совпадает с настройкой интерфейса.');
      }
      recordMbDiag({stage:'finalize-preview',event:'start',
        acceptedRows:result.stats?.rows||0});
      const preview = repository.finalize(stage.id,result);
      recordMbDiag({stage:'finalize-preview',event:'end',
        acceptedRows:preview.rowsIncoming});
      mobileSqliteStage = {
        id:stage.id, preview, outputName:result.outputName, stats:result.stats
      };
      for (const sheet of result.stats?.sheetDetails || []) {
        log('Лист «' + sheet.sheetName + '»: найдено ' + sheet.inputRows +
          '; принято ' + sheet.acceptedRows + '; пропущено ' + sheet.skippedRows + '.');
      }
      for (const warning of result.stats?.warnings || []) log('ПРЕДУПРЕЖДЕНИЕ: ' + warning);
      log('SQLite МБ: размер пакета ' + mobileBatchSize +
        ', подтверждено партий ' + (result.stats?.batches || 0) +
        ', подготовка ' + (((typeof performance !== 'undefined' ? performance.now() : Date.now()) - stageStartedAt) / 1000).toFixed(1) + ' с.');
      log('Мобильные бригады подготовлены в SQLite TEMP: ' +
        preview.rowsIncoming + ' строк; новых ' + preview.rowsInserted +
        '; совпавших ' + preview.rowsMatched +
        '; дубликатов ключей ' + preview.duplicateRecordKeys +
        '. Рабочая база не изменена.');
      return {...result,sqliteStage:mobileSqliteStage};
    } catch(error) {
      repository.discard(stage.id);
      throw error;
    }
  }

  async function processMobileBrigadeFiles(operation = {}) {
    if (!mobileBrigadeFiles.length) throw new Error('Не выбраны исходные выгрузки Мобильных бригад.');
    const operationId=operation.operationId || null;
    const sourceFiles=mobileBrigadeFiles.slice();
    const candidate = await mobileBrigadeDatasetLifecycle.prepare('mobile_brigade_data', sourceFiles, async sourceFiles => {

    const files = [];
    const transfer = [];

    for (const file of sourceFiles) {
      recordMbDiag({stage:'read-file',event:'start',inputBytes:file.size});
      const bytes = await file.arrayBuffer();
      recordMbDiag({stage:'read-file',event:'end',inputBytes:bytes.byteLength});
      files.push({ fileName: file.name, bytes });
      transfer.push(bytes);
    }

    recordMbDiag({stage:'itsm-links',event:'start'});
    const itsmInstance = datasetStore.get('itsm_data');
    const itsmLink = globalThis.ReclassifierItsmDatasetSchema?.mobileBrigadeLinkRows;
    if (typeof itsmLink !== 'function') {
      throw new Error('Мобильные бригады: контракт полей ITSM недоступен.');
    }
    const itsmData = itsmLink(
      itsmInstance?.records || [],
      itsmInstance?.meta?.fields || null
    );
    recordMbDiag({stage:'itsm-links',event:'end'});

    const result = await workerRequest(
      'PROCESS_MOBILE_BRIGADE',
      { files, itsmData, deferExport: true, memoryDiagnostics: mbDiagEnabled },
      transfer,
      operation.onProgress
    );

    recordMbDiag({stage:'candidate-merge',event:'start',
      acceptedRows:result.stats?.rows||0});
    const generatedData = result.mobileBrigadeData;
    if (!generatedData || !Array.isArray(generatedData.records)) {
      throw new Error('Worker Мобильных бригад не вернул внутренний набор Mobile Brigade Data.');
    }
    const fullDataset = mobileBrigadeUiFullDatasetContract.validate(result.mobileBrigadeFullDataset, {
      packageId: 'mobile-brigade-full-dataset',
      aggregation: 'per-task-row'
    });
    if (fullDataset.rows.length !== generatedData.records.length) {
      throw new Error('Mobile Brigade Full Dataset не совпадает по числу строк с аналитическим Dataset.');
    }
    const current = datasetStore.get('mobile_brigade_data');
    const incomingMeta = {
      fileName: 'Mobile Brigade Data' + (generatedData.latestSourceDate ? ' ' + generatedData.latestSourceDate : ''),
      latestSourceDate: generatedData.latestSourceDate || null,
      earliestSourceDate: generatedData.earliestSourceDate || null,
      sourceFreshness: generatedData.sourceFreshness || [],
      lastImportedRulesVersion: result.rulesVersion || null,
      itsmLinkContractVersion: globalThis.ReclassifierItsmDatasetSchema?.mobileBrigadeLinkVersion || null,
      freshnessByScope: generatedData.freshnessByScope || {},
      sourceFiles: (generatedData.sourceFreshness || []).map(item => item.fileName).filter(Boolean)
    };
    if (!globalThis.ReclassifierMobileBrigadeUpsert?.prepare) {
      throw new Error('Mobile Brigade UPSERT engine не загружен.');
    }
    const prepared = globalThis.ReclassifierMobileBrigadeUpsert.prepare(
      current?.records || [],
      generatedData.records,
      { currentMeta: current?.meta || {}, incomingMeta }
    );

    const currentFull = current?.fullDataset || null;
    const currentFullKeys = Array.isArray(currentFull?.recordKeys)
      ? currentFull.recordKeys
      : (currentFull?.rows?.length === current?.records?.length
        ? current.records.map(record => record?.recordKey)
        : null);
    const currentFullAvailable = Boolean(
      currentFull && currentFullKeys &&
      currentFullKeys.length === currentFull.rows?.length &&
      current.meta?.fullDatasetScope !== 'incoming-batch'
    );
    const mergedFullDataset = mobileBrigadeUiFullDatasetContract.mergeAligned(
      currentFullAvailable ? currentFull : null,
      currentFullAvailable ? currentFullKeys : [],
      fullDataset,
      generatedData.records.map(record => record?.recordKey),
      {
        packageId: 'mobile-brigade-full-dataset',
        aggregation: 'per-task-row',
        normalizeKey: globalThis.ReclassifierMobileBrigadeUpsert.key,
        currentRecordCount: current?.records?.length || 0,
        expectedRecordCount: prepared.records.length,
        finalRecordKeys: prepared.records.map(record => record?.recordKey)
      }
    );

    const generatedReference = mobileBrigadeDatasetAdapter.prepare(
      prepared.records,
      prepared.meta
    );
    if (prepared.warnings.length) {
      generatedReference.validation.warnings.push(...prepared.warnings);
      generatedReference.validation.status = 'warning';
    }
    generatedReference.fullDataset = mergedFullDataset;
    generatedReference.meta.fullDatasetFieldCount = mergedFullDataset.columns.length;
    generatedReference.meta.fullDatasetRows = mergedFullDataset.rows.length;
    generatedReference.meta.fullDatasetScope = mergedFullDataset.coverage || 'complete';
    if (generatedReference.meta.fullDatasetScope === 'complete' &&
        mergedFullDataset.rows.length !== generatedReference.records.length) {
      throw new Error('Mobile Brigade Full Dataset после UPSERT не совпадает с накопительным Dataset.');
    }

    generatedReference.output = {
      bytes: result.bytes,
      outputName: result.outputName,
      stats: Object.assign({}, result.stats, { upsertPlan: prepared.plan })
    };
    recordMbDiag({stage:'candidate-merge',event:'end',
      acceptedRows:generatedReference.records.length});
    return generatedReference;
    });

    if (candidate.validation?.status === 'invalid') {
      throw new Error(candidate.validation.errors?.[0] || 'Ошибка обработки Mobile Brigade Data.');
    }
    if ((operationId && state.processingOperationId !== operationId) ||
        sourceFiles.length !== mobileBrigadeFiles.length ||
        sourceFiles.some((file,index) => mobileBrigadeFiles[index] !== file)) {
      throw new Error('Операция Мобильных бригад устарела; результат не будет скачан или применён.');
    }
    if (mobileBrigadeDatasetLifecycle.candidate('mobile_brigade_data') !== candidate) {
      throw new Error('Исходные файлы изменены во время обработки. Обработайте выбранную партию ещё раз.');
    }

    // Process and apply independently of Excel export; export is user-initiated
    // through the existing Dataset Excel Export panel after applying data.

    const stats = candidate.output.stats || {};
    for (const sheet of stats.sheetDetails || []) {
      log('Лист «' + sheet.sheetName + '» (' + sheet.fileName + '): исходных строк ' + sheet.inputRows +
        '; принято ' + sheet.acceptedRows + '; пустых/пропущено ' + sheet.skippedRows + '.', 'INFO', 'diagnostics');
    }
    for (const warning of stats.warnings || []) log('ПРЕДУПРЕЖДЕНИЕ: ' + warning, 'WARN', 'import_export');
    log(
      'Мобильные бригады обработаны: файлов ' + (stats.files || 0) +
      '; листов ' + (stats.sheets || 0) + '; строк ' + (stats.rows || 0) +
      '; Mobile Brigade Data ' + candidate.records.length + ' строк' +
      '; ITSM совпадений ' + (stats.rowsMatchedItsm || 0) +
      '; без совпадения ITSM ' + (stats.rowsWithoutItsmMatch || 0) +
      (candidate.meta?.upsertPlan ? '; обновлено ' + candidate.meta.upsertPlan.updatedKeys +
        '; добавлено ' + candidate.meta.upsertPlan.addedKeys : '') +
      '. Экспорт Excel доступен отдельно после применения данных'
    , 'INFO', 'import_export');

    return { ...candidate.output, candidate };
  }

  function applyMobileBrigadeCandidate() {
    if (state.processingModuleId) throw new Error('Дождитесь завершения обработки перед применением данных.');
    const instance = mobileBrigadeDatasetLifecycle.commit('mobile_brigade_data', {
      recordHistory: true
    });
    delete instance.output;
    log(
      'Mobile Brigade Data применён: ' + instance.records.length +
      ' строк; свежесть ' + (instance.meta.latestSourceDate || 'не определена') + '.'
    , 'INFO', 'import_export');
  }

// ============================================================================
// MODULE PRESENTATION
// ============================================================================
  function mobileBrigadeAlgorithmMarkup() {
    return '<details class="module-algorithm">' +
      '<summary>Описание алгоритма обработки</summary>' +
      '<div class="module-algorithm-body">' +
      '<h3>Как это работает</h3>' +
      '<p class="small"><strong>Версия правил:</strong> Mobile Brigade Rules ' + escapeHtml(MOBILE_BRIGADE_RULES_VERSION) +
      ' · Обработка выполняется локально в фоновом потоке браузера.</p>' +
      '<p>Обработка объединяет Excel-файлы и готовит накопительный Dataset: совпавшие задачи обновляются, новые добавляются, остальная история сохраняется.</p>' +
      '<p><strong>Важно:</strong> рабочие данные изменяются только после отдельного нажатия «Применить данные».</p>' +
      '<ol style="margin:10px 0 0 20px; padding:0">' +
      '<li>Для каждого Excel найти рабочий лист по обязательным заголовкам; имя листа и порядок колонок не используются как ключ.</li>' +
      '<li>Забрать 31 исходную колонку по их названиям. Если поле отсутствует в конкретной выгрузке, оставить его пустым.</li>' +
      '<li>Объединить строки всех выбранных файлов в одну таблицу.</li>' +
      '<li>Рассчитать 6 существующих полей: трудочасы, астрочасы, ненулевые труды, месяц смены, год смены и итоговый тип задачи.</li><li>Сопоставить «Заявка» МБ с полем «Номер» действующего ITSM Dataset и при совпадении заполнить «Дата создания вызова ITSM» из `createdAt`. Если совпадения нет, оставить поле пустым. «Возраст пред-бэклога» на этом этапе остаётся пустым.</li>' +
      '<li>Объединить «Комментарий» и «Комментарий по закрытой задаче» в одно поле «Объединённый комментарий»: дубли удаляются, служебные префиксы ФИО/дата/время сохраняются, разные тексты складываются вместе без потери данных.</li><li>Сформировать XLSX ровно из 38 итоговых колонок. Source.Name, исходные две колонки комментариев и промежуточный «Новый тип задач.Новый тип задачи» в результат не попадают.</li>' +
      '<li>Из готового результата сформировать Mobile Brigade Data 1.5: сохранить 17 аналитических полей и 4 технических идентификатора — участок, номер задачи, ID задачи МБ и устойчивый recordKey.</li>' +
      '<li>Сопоставить новую партию с действующим Dataset по recordKey: совпавшие строки заменить свежей версией, новые добавить, отсутствующие во входной партии не удалять.</li>' +
      '</ol>' +
      '<p class="small">Даты исходного покрытия участков хранятся отдельно; дата последних фактических работ определяется по записям, а не по имени файла.</p>' +
      '</div></details>';
  }

  function mobileBrigadeDataMarkup() {
    if (globalThis.ReclassifierRuntimeDataRepository?.mode?.() === 'sqlite') {
      return globalThis.ReclassifierDatasetExcelExport?.sqliteMobileSummary?.() || '';
    }
    return globalThis.ReclassifierModuleSourceStatus.datasetSummary(
      'mobile_brigade_data', datasetStore.get('mobile_brigade_data')
    );
  }

// ============================================================================
// MODULE ROUTE COMPOSITION
// ============================================================================
  function renderMobileBrigadeModule() {
    const module = moduleConfig.mobile_brigade;
    const workspaceLocked=mobileBrigadeFilesLocked();
    const duplicates=new Set();
    const seenNames=new Set();
    for (const file of mobileBrigadeFiles) {
      if (seenNames.has(file.name)) duplicates.add(file.name);
      seenNames.add(file.name);
    }
    setHeader('Обработка', module.title, module.description);

    const filesHtml = mobileBrigadeFiles.length
      ? mobileBrigadeFiles.map((file, index) => {
          return '<div class="info-row">' +
            '<span class="info-key" style="min-width:0; flex:1; overflow-wrap:anywhere">' + escapeHtml(file.name) + '</span>' +
            '<span class="small" style="white-space:nowrap">' + escapeHtml(formatBytes(file.size)) + '</span>' +
            '<button class="button ghost mobile-brigade-remove" data-index="' + index + '" style="padding:6px 10px"' +
            (workspaceLocked ? ' disabled' : '') + '>Убрать</button>' +
            '</div>';
        }).join('')
      : '<div class="small">Файлы пока не выбраны.</div>';

    const moduleStatus = globalThis.ReclassifierModuleSourceStatus;
    const sqliteMode = globalThis.ReclassifierRuntimeDataRepository?.mode?.() === 'sqlite';
    // SQLite view must not instantiate full analytical and source Dataset.
    const instance = sqliteMode ? null : datasetStore.get('mobile_brigade_data');
    const itsmSqliteRows = sqliteMode
      ? globalThis.ReclassifierMobileBrigadeStaging?.itsmRowCount?.() ?? 0
      : null;
    el.pageContent.innerHTML = `
      <div class="workspace">
        <article class="card">
          <h2>Исходные файлы</h2>
          ${workspaceLocked ? '<p class="notice" role="status">Загрузка стартовых данных или обработка Мобильных бригад. Выбор и удаление файлов временно заблокированы.</p>' : ''}
          ${duplicates.size ? '<p class="notice" role="status">Есть файлы с одинаковыми именами ('+
            escapeHtml([...duplicates].join(', '))+'). Оба сохранены в очереди. Проверьте источники перед обработкой.</p>' : ''}
          <p>Выберите все выгрузки Мобильных бригад, которые нужно объединить. Файлы ЗФ и КФ могут иметь разный порядок и неполный набор колонок.</p>
          <div class="dropzone" id="mobileBrigadeDropzone">
            <div>
              <div class="dropzone-title">Перетащите Excel-файлы сюда</div>
              <div class="dropzone-text">или выберите несколько файлов на компьютере</div>
              <button class="button" id="selectMobileBrigadeFilesButton" ${workspaceLocked?'disabled':''}>Выбрать файлы</button>
            </div>
          </div>

          <div class="info-list" style="margin-top:18px">${filesHtml}</div>

          ${sqliteMode ? '<div class="info-row" style="margin:12px 0">' +
            '<label for="mobileBrigadeBatchSize">Размер пакета SQLite</label>' +
            '<select id="mobileBrigadeBatchSize"' + (workspaceLocked ? ' disabled' : '') + '>' +
            [500,1000,2000,5000,10000].map(size =>
              '<option value="' + size + '"' + (size === mobileBatchSize ? ' selected' : '') +
              '>' + size.toLocaleString('ru-RU') + ' строк</option>').join('') +
            '</select></div>' : ''}
          <article class="card flat" style="margin:12px 0">
            <h3>Диагностика памяти Opera</h3>
            <label class="small"><input type="checkbox" id="mbDiagEnabled"
              ${mbDiagEnabled?'checked':''} ${workspaceLocked?'disabled':''}>
              Включить при следующей обработке</label>
            <p class="small" id="mbDiagStatus"></p>
            <button class="button ghost" id="copyMbDiagButton"
              ${mbDiag?'':'disabled'}>Копировать диагностический отчёт</button>
            <p class="small">Сохраняются только этапы и числовые показатели, без имён
              файлов и содержимого строк. После сбоя откройте этот HTML повторно.</p>
          </article>
          <div class="action-row">
            <button class="button primary" id="processMobileBrigadeButton" ${mobileBrigadeFiles.length&&!workspaceLocked ? '' : 'disabled'}>Обработать</button>
            <button class="button ghost" id="clearMobileBrigadeButton" ${mobileBrigadeFiles.length&&!workspaceLocked ? '' : 'disabled'}>Очистить</button>
          </div>

          ${mobileBrigadeAlgorithmMarkup()}
          ${sqliteMode ? '' : renderDatasetCandidate('mobile_brigade_data', renderReferenceValidation, renderMobileBrigadeDataPreview)}
          ${sqliteMode && mobileSqliteStage ? `
            <div class="notice" role="status">
              <strong>Подготовлено в SQLite (рабочая база ещё не изменена)</strong>
              <p>Строк: ${mobileSqliteStage.preview.rowsIncoming}.
              Новых: ${mobileSqliteStage.preview.rowsInserted}.
              Совпавших: ${mobileSqliteStage.preview.rowsMatched}.
              Повторных ключей: ${mobileSqliteStage.preview.duplicateRecordKeys}.
              ${mobileSqliteStage.preview.rowsWithoutRecordKey
                ? 'Без recordKey: ' + mobileSqliteStage.preview.rowsWithoutRecordKey + '. Применение недоступно.'
                : ''}</p>
              <div class="action-row">
                <button class="button primary" id="applyMbSqliteStageButton"
                  ${workspaceLocked || mobileSqliteStage.preview.rowsWithoutRecordKey ? 'disabled' : ''}>Применить данные в SQLite</button>
                <button class="button ghost" id="downloadMbSqliteStageButton"
                  ${workspaceLocked ? 'disabled' : ''}>Скачать Excel</button>
                <button class="button ghost" id="discardMbSqliteStageButton"
                  ${workspaceLocked ? 'disabled' : ''}>Отменить подготовку</button>
              </div>
              <p class="small">После применения необходимо отдельно сохранить изменённую Reclassifier.db.</p>
            </div>` : ''}

          ${mobileBrigadeDataMarkup()}
        </article>

        <aside class="side-panel">
${sqliteMode
            ? (globalThis.ReclassifierDatasetExcelExport?.sqliteMobileMarkup?.(workspaceLocked) || '')
            : (globalThis.ReclassifierDatasetExcelExport?.markup?.(
              'mobile_brigade_data', instance, workspaceLocked) || '')}
          <article class="card flat module-references-card">
            <h3>Используемые справочники</h3>
            <p class="small">ITSM используется при наличии для связи с датой создания заявки; обработка МБ возможна без ITSM.</p>
            <div class="info-list">${sqliteMode
              ? '<div class="info-row"><span class="info-key">ITSM (SQLite)</span>' +
                '<strong>' + escapeHtml(Number(itsmSqliteRows || 0).toLocaleString('ru-RU')) +
                ' записей</strong></div>'
              : moduleStatus.referenceRows(['itsm_data'])}</div>
            <p class="small">Ошибки импорта и технические события доступны в разделе «Система → Журнал».</p>
            <button class="button ghost" id="mobileBrigadeOpenJournalButton" ${state.processingModuleId?'disabled':''}>Открыть журнал</button>
          </article>
        </aside>
      </div>
    `;

    document.getElementById('mobileBrigadeOpenJournalButton')?.addEventListener('click', () => navigate('log'));
    showMbDiag();
    document.getElementById('mbDiagEnabled')?.addEventListener('change', event => {
      if (!state.processingModuleId) mbDiagEnabled=Boolean(event.target.checked);
    });
    document.getElementById('copyMbDiagButton')?.addEventListener('click',copyMbDiag);
    const processButton = document.getElementById('processMobileBrigadeButton');
    bindDatasetDropzone('mobileBrigadeDropzone', 'selectMobileBrigadeFilesButton',
      files => addMobileBrigadeFiles(files), () => {}, true);
    bindDatasetCandidate('mobile_brigade_data', applyMobileBrigadeCandidate, renderMobileBrigadeModule);
    document.getElementById('mobileBrigadeBatchSize')?.addEventListener('change', event => {
      if (state.processingModuleId) return;
      const requested = Number(event.target.value);
      if ([500,1000,2000,5000,10000].includes(requested)) mobileBatchSize = requested;
    });
    if (sqliteMode) {
      globalThis.ReclassifierDatasetExcelExport?.bindSqliteMobile?.(renderMobileBrigadeModule);
    } else {
      globalThis.ReclassifierDatasetExcelExport?.bind?.('mobile_brigade_data', renderMobileBrigadeModule);
    }
    document.getElementById('discardMbSqliteStageButton')?.addEventListener('click', () => {
      if (state.processingModuleId) return;
      releaseMobileSqliteStage();
      renderMobileBrigadeModule();
    });
    document.getElementById('applyMbSqliteStageButton')?.addEventListener('click', async () => {
      if (!mobileSqliteStage || state.processingModuleId) return;
      const stage = mobileSqliteStage;
      state.processingModuleId = 'mobile_brigade';
      try {
        recordMbDiag({stage:'commit',event:'start'});
        const committed = await globalThis.ReclassifierMobileBrigadeStaging.commit(
          stage.id, progress => log('SQLite: записано ' + progress.processedRows +
            ' из ' + progress.totalRows + ' записей МБ.')
        );
        recordMbDiag({stage:'commit',event:'end'});
        finishMbDiag('applied');
        mobileSqliteStage = null;
        mobileShowSqliteExport = false;
        log('SQLite МБ применена: +' + committed.rowsInserted +
          ', обновлено ' + committed.rowsUpdated +
          ', без изменений ' + committed.rowsUnchanged + '.');
        alert('Данные МБ применены в рабочую SQLite. Сохраните обновлённую Reclassifier.db.');
      } catch(error) {
        recordMbDiag({stage:'commit',event:'error'});
        finishMbDiag('failed');
        log('Ошибка применения партии МБ: ' + (error?.message || String(error)), 'ERROR');
        alert('Не удалось применить данные МБ: ' + (error?.message || String(error)));
      } finally {
        state.processingModuleId = null;
        renderMobileBrigadeModule();
      }
    });
    document.getElementById('downloadMbSqliteStageButton')?.addEventListener('click', async () => {
      if (!mobileSqliteStage || state.processingModuleId) return;
      const stage = mobileSqliteStage;
      state.processingModuleId = 'mobile_brigade';
      try {
        recordMbDiag({stage:'manual-export',event:'start'});
        const data = globalThis.ReclassifierMobileBrigadeStaging.exportRows(stage.id);
        const result = await workerRequest('EXPORT_DATASET_XLSX', {
          sheetName:'Мобильные бригады',columns:data.columns,rows:data.rows,
          datasetId:'mobile_brigade_data'
        });
        if (mobileSqliteStage !== stage) throw new Error('Подготовленная партия МБ изменилась.');
        downloadMobileBrigadeResult(result.bytes,stage.outputName);
        recordMbDiag({stage:'manual-export',event:'end'});
      } catch(error) {
        recordMbDiag({stage:'manual-export',event:'error'});
        log('Ошибка ручного экспорта МБ из SQLite: ' + (error?.message || String(error)), 'ERROR');
        alert('Не удалось скачать Excel: ' + (error?.message || String(error)));
      } finally {
        state.processingModuleId = null;
        renderMobileBrigadeModule();
      }
    });




    document.querySelectorAll('.mobile-brigade-remove').forEach(button => {
      button.addEventListener('click', () => removeMobileBrigadeFile(Number(button.dataset.index)));
    });
    document.getElementById('clearMobileBrigadeButton').addEventListener('click', clearMobileBrigadeFiles);

    processButton.addEventListener('click', async () => {
      if (mobileBrigadeFilesLocked() || !mobileBrigadeFiles.length) return;
      const operationId='mobile-brigade-'+(++mobileBrigadeOperationSequence);
      startMbDiag(globalThis.ReclassifierRuntimeDataRepository?.mode?.()==='sqlite'
        ? 'sqlite':'legacy');
      recordMbDiag({stage:'prepare',event:'start'});
      state.processingModuleId='mobile_brigade';
      state.processingOperationId=operationId;
      const originalText = processButton.textContent;
      processButton.disabled = true;
      document.getElementById('selectMobileBrigadeFilesButton').disabled=true;
      document.getElementById('clearMobileBrigadeButton').disabled=true;
      document.querySelectorAll('.mobile-brigade-remove').forEach(btn=>{btn.disabled=true;});
      updateProcessingButton(processButton, { percent: 0, label: 'Подготовка' });
      try {
        const result = await processMobileBrigadeFiles({
          operationId,
          onProgress: progress => {
            if (state.processingOperationId !== operationId) return;
            if (progress?.mbMemoryDiag) {
              recordMbDiag(progress.mbMemoryDiag);
              return;
            }
            updateProcessingButton(processButton, progress);
          }
        });
        recordMbDiag({stage:'prepare',event:'end',acceptedRows:result.stats?.rows||0});
        finishMbDiag('prepared');
        renderMobileBrigadeModule();
        alert(
          'Мобильные бригады обработаны: ' + (result.stats?.rows || 0) +
          ' строк, 38 колонок. Файл «' + result.outputName +
          '» сохранён. Проверьте UPSERT-кандидат и нажмите «Применить данные» для обновления Mobile Brigade Data.'
        );
      } catch (error) {
        recordMbDiag({stage:'prepare',event:'error'});
        finishMbDiag('failed');
        const message = error?.message || String(error);
        log('Ошибка Мобильных бригад: ' + message, 'ERROR', 'import_export');
        renderMobileBrigadeModule();
        alert('Не удалось обработать Мобильные бригады: ' + message);
      } finally {
        if (state.processingOperationId === operationId) {
          state.processingModuleId=null;
          state.processingOperationId=null;
        }
        if (state.route === 'mobile_brigade') renderMobileBrigadeModule();
        else {
          processButton.disabled = false;
          resetProcessingButton(processButton, originalText);
        }
      }
    });
  }

  registerModule('mobile_brigade', mobileBrigadeModuleConfig, renderMobileBrigadeModule, processMobileBrigadeFiles);
