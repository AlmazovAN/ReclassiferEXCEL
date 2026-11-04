  const reclassificationRules = globalThis.ReclassifierReclassificationRules;
  if (!reclassificationRules) throw new Error('Reclassification rules module is not loaded.');
  const RECLASSIFICATION_RULES_VERSION = reclassificationRules.version;
  let pendingReclassUpsert = null;
  let reclassificationOperationSequence = 0;
  let reclassificationLastStats = null;
  let reclassificationLastReclassFile = null;
  let reclassificationLastReportFile = null;
  let reclassificationLastReportSource = null;

  function displayReclassificationDate(key) {
    if(typeof key!=='string' || key.length!==10 || key[4]!=='-' || key[7]!=='-')return 'Не определена';
    return key.slice(8,10)+'.'+key.slice(5,7)+'.'+key.slice(0,4);
  }

  function downloadReclassificationResult(bytes, outputName) {
    const blob = new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
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

  function assertReclassificationOperationCurrent(sourceFile, operationId) {
    if (operationId && state.processingOperationId !== operationId) {
      throw new Error('Операция реклассификации уже неактуальна. Результат не применён.');
    }
    if (state.sourceFile !== sourceFile) {
      throw new Error('Исходный ITSM-файл изменён во время реклассификации. Результат не применён.');
    }
  }

  function assertReclassificationRuntimeCurrent(instance, mode, operationId) {
    if (operationId && state.processingOperationId !== operationId) {
      throw new Error('Операция реклассификации уже неактуальна. Результат не применён.');
    }
    const runtime=globalThis.ReclassifierRuntimeDataRepository;
    if (runtime.mode() !== mode || runtime.get('itsm_data') !== instance) {
      throw new Error('Активная база ITSM изменилась во время реклассификации. Результат отклонён.');
    }
  }

  function completeReclassificationResult(result, sourceName, sourceSheet) {
    if (!(result?.bytes instanceof ArrayBuffer)) {
      throw new Error('Reclassification Worker не вернул готовый XLSX.');
    }
    if (!Array.isArray(result.referenceRecords)) {
      throw new Error('Reclassification Worker не вернул массив записей RE-CLASS.');
    }
    const prepared = result.referenceRecords.length ? window.ReclassifierReferenceManager.prepareReclassificationUpsert(
      result.referenceRecords,
      {
        fileName: result.reclassOutputName || result.outputName,
        sourceFileName: sourceName,
        sourceSheet: sourceSheet || result.sourceSheet || null,
        rulesVersion: result.rulesVersion,
        sourceType: 'generated'
      }
    ) : null;
    pendingReclassUpsert = prepared;
    reclassificationLastStats = result.stats || {};
    reclassificationLastReclassFile = result.reclassBytes instanceof ArrayBuffer
      ? {bytes:result.reclassBytes,name:result.reclassOutputName} : null;
    reclassificationLastReportFile = {bytes:result.bytes,name:result.outputName};
    reclassificationLastReportSource = sourceName;
    const stats=result.stats || {};
    log('Каскад реклассификации завершён из «'+sourceName+'»: исходных строк '+
      (stats.rows||0)+'; готовых решений '+(stats.readyRows||0)+
      '; предложений исправления '+(stats.statusCounts?.CHANGE||0)+
      '; нужна проверка '+(stats.statusCounts?.REVIEW||0)+
      '; использована дата закрытия '+(stats.usedClosingDate||0)+
      '; без описания '+(stats.withoutDescription||0)+
      '; без примечания к закрытию '+(stats.withoutClosureNote||0)+
      '. Файл: '+result.outputName, 'INFO', 'import_export');
    return result;
  }

  async function processReclassificationRuntime(operation = {}) {
    if (!state.baselineReady) throw new Error('Дождитесь завершения загрузки стартовых данных.');
    const runtime=globalThis.ReclassifierRuntimeDataRepository;
    const instance=runtime.get('itsm_data');
    const mode=runtime.mode();
    const operationId=operation.operationId || state.processingOperationId || null;
    const source=globalThis.ReclassifierReclassificationRuntimeSource.prepare(instance);
    assertReclassificationRuntimeCurrent(instance,mode,operationId);
    const references=itsmReferencePayload();
    const classifierRecords=runtime.records('failure_classifier');
    if(!classifierRecords.length)throw new Error('Загрузите действующий классификатор отказов в разделе «Данные».');
    const asOfDate=new Date();asOfDate.setHours(0,0,0,0);
    const result=await workerRequest('PROCESS_RECLASSIFICATION',{
      runtimeSource:source,fileName:'Active_Runtime_ITSM.xlsx',
      classifierRecords,classifierMeta:runtime.get('failure_classifier')?.meta||{},references,asOfDate:asOfDate.toISOString()
    },[],operation.onProgress);
    assertReclassificationRuntimeCurrent(instance,mode,operationId);
    return completeReclassificationResult(result,'Active Runtime ITSM',result.sourceSheet);
  }

  async function processReclassificationFile(operation = {}) {
    const sourceFile = operation.sourceFile || state.sourceFile;
    const operationId = operation.operationId || state.processingOperationId || null;

    if (!state.baselineReady) throw new Error('Дождитесь завершения загрузки стартовых данных.');
    if (!sourceFile) throw new Error('Выберите исходную ITSM-выгрузку.');

    assertReclassificationOperationCurrent(sourceFile, operationId);
    const inputBuffer = await sourceFile.arrayBuffer();
    assertReclassificationOperationCurrent(sourceFile, operationId);
    const references = itsmReferencePayload();
    const asOfDate = new Date();
    asOfDate.setHours(0,0,0,0);
    const classifierRecords = globalThis.ReclassifierRuntimeDataRepository.records('failure_classifier');
    if (!classifierRecords.length) throw new Error('Загрузите и примените действующий классификатор отказов в разделе «Данные».');

    const result = await workerRequest('PROCESS_RECLASSIFICATION', {
      bytes: inputBuffer,
      fileName: sourceFile.name,
      classifierRecords, classifierMeta:globalThis.ReclassifierRuntimeDataRepository.get('failure_classifier')?.meta||{}, references, asOfDate: asOfDate.toISOString()
    }, [inputBuffer], operation.onProgress);

    assertReclassificationOperationCurrent(sourceFile, operationId);

    return completeReclassificationResult(result,sourceFile.name,result.sourceSheet);
  }

  function applyPendingReclassUpsert() {
    globalThis.ReclassifierRuntimeDataRepository?.assertLegacyWriteAllowed?.();
    if (!pendingReclassUpsert?.instance) {
      throw new Error('Сначала сформируйте Reclassification.');
    }
    const plan = pendingReclassUpsert.plan;
    const instance = window.ReclassifierReferenceManager.applyReplacement(pendingReclassUpsert.instance);
    pendingReclassUpsert = null;
    log(
      'RE-CLASS обновлён UPSERT по номеру: обновлено ' + plan.matchedNumbers +
      '; добавлено ' + plan.addedNumbers +
      '; итог ' + instance.records.length + ' строк.'
    , 'INFO', 'import_export');
    renderReclassificationModule();
    return { instance, plan };
  }

  function selectReclassificationSource(file) {
    if (!state.baselineReady) {
      log('Выбор файла Reclassification заблокирован: стартовые данные ещё загружаются.', 'WARN');
      return;
    }
    if (state.processingModuleId) {
      log('Выбор файла Reclassification заблокирован: выполняется обработка.', 'WARN');
      return;
    }
    state.sourceFile = file;
    pendingReclassUpsert = null;
    reclassificationLastStats = null;
    reclassificationLastReclassFile = null;
    reclassificationLastReportFile = null;
    reclassificationLastReportSource = null;
    log('Выбрана ITSM-выгрузка для каскада реклассификации: ' + file.name + ' (' + formatBytes(file.size) + ')', 'INFO', 'import_export');
    renderReclassificationModule();
  }

  function renderReclassificationModule() {
    const module = moduleConfig.reclassification;
    const baselineLoading = state.baselineReady === false;
    const processing = state.processingModuleId === 'reclassification';
    const workspaceLocked = baselineLoading || Boolean(state.processingModuleId);
    const runtimeRepository=globalThis.ReclassifierRuntimeDataRepository;
    const sqliteAuthoritative = Boolean(runtimeRepository?.isSqliteAuthoritative?.());
    const activeItsm=runtimeRepository?.get?.('itsm_data');
    const activeReclass=runtimeRepository?.get?.('reclassification');
    const itsmPeriod=globalThis.ReclassifierDatasetExcelExport?.period?.('itsm_data',activeItsm) ||
      {from:null,to:null,undated:'—'};
    const referencePeriod=globalThis.ReclassifierReclassificationRuntimeSource?.reclassFreshness?.(activeReclass) ||
      {rows:activeReclass?.records?.length || 0,latestCompleted:null};
    const periodLabel=itsmPeriod.from&&itsmPeriod.to
      ? displayReclassificationDate(itsmPeriod.from)+' — '+displayReclassificationDate(itsmPeriod.to)
      : 'Нет корректных дат регистрации';
    const full=activeItsm?.fullDataset;
    const runtimeAvailable=Boolean(Array.isArray(activeItsm?.records) && activeItsm.records.length &&
      Array.isArray(full?.columns) && Array.isArray(full?.rows) &&
      full.rows.length===activeItsm.records.length &&
      !['partial','incoming-batch'].includes(full.coverage) &&
      !['partial','incoming-batch'].includes(activeItsm.meta?.fullDatasetScope));
    setHeader('Обработка', module.title, module.description);

    el.pageContent.innerHTML = `
      <div class="workspace">
        <article class="card">
          <h2>ITSM и диагностика реклассификации</h2>
          <p>Используйте все обращения из активной ITSM-базы (HTML или подключённой Reclassifier.db) либо выберите исходную Excel-выгрузку. Для обеих веток используется штатная ITSM и консервативный алгоритм Re-Class.</p>
          <p class="small">Этот экран формирует диагностический отчёт и предлагает обновление ReClass. Он не добавляет обращения в накопительный ITSM Dataset. Для этого используйте отдельный модуль ITSM после применения нужных изменений классификации.</p>
          <div class="action-row"><button class="button ghost" id="openItsmProcessingButton">Перейти к накоплению данных ITSM</button></div>
          <div class="action-row">
            <button class="button primary" id="processReclassificationRuntimeButton" ${runtimeAvailable&&!workspaceLocked?'':'disabled'}>Обработать всю базу ITSM</button>
          </div>
          <p class="muted">${runtimeAvailable
            ? 'Активная база ITSM: '+escapeHtml(activeItsm.records.length)+' обращений, полный Full Dataset.'
            : 'Для запуска по базе нужен полный ITSM Full Dataset. Если его нет, выберите исходный Excel-файл ниже.'}</p>
          ${baselineLoading ? '<div class="notice">Загрузка стартовых данных ещё не завершена. Реклассификация временно недоступна.</div>' : ''}
          ${processing ? '<div class="notice">Идёт реклассификация. До завершения нельзя менять исходный файл или переходить в другой раздел.</div>' : ''}

          <div class="dropzone" id="reclassificationDropzone">
            <div>
              <div class="dropzone-title">Или перетащите исходную выгрузку ITSM сюда</div>
              <div class="dropzone-text">или выберите Excel-файл на компьютере</div>
              <button class="button" id="selectReclassificationSourceButton" ${workspaceLocked ? 'disabled' : ''}>Выбрать файл</button>
            </div>
          </div>

          <div class="file-summary ${state.sourceFile ? 'visible' : ''}">
            <div class="file-name">${state.sourceFile ? escapeHtml(state.sourceFile.name) : ''}</div>
            <div class="file-meta">${state.sourceFile ? formatBytes(state.sourceFile.size) + ' · ' + escapeHtml(state.sourceFile.type || 'Excel') : ''}</div>
          </div>

          <div class="action-row">
            <button class="button primary" id="processReclassificationButton" ${state.sourceFile && !workspaceLocked ? '' : 'disabled'}>Обработать ITSM и добавить диагностику</button>
            <button class="button ghost" id="clearReclassificationSourceButton" ${state.sourceFile && !workspaceLocked ? '' : 'disabled'}>Очистить</button>
          </div>

          ${reclassificationLastStats ? `
            <div class="notice" style="margin-top:16px">
              <strong>Отчёт ITSM с диагностикой V4</strong>
              <p>Источник готового отчёта: ${escapeHtml(reclassificationLastReportSource || 'не определён')}.
                Файл: ${escapeHtml(reclassificationLastReportFile?.name || 'не сформирован')}.</p>
              <div class="action-row">
                <button class="button primary" id="downloadProcessedReclassificationButton"
                  ${reclassificationLastReportFile&&!workspaceLocked?'':'disabled'}>Скачать диагностику V4 (ITSM A:CN)</button>
                 <button class="button ghost" id="downloadLegacyReclassificationButton"
                   ${reclassificationLastReclassFile&&!workspaceLocked?'':'disabled'}>Скачать реклассификацию (3.3)</button>
              </div>
              ${reclassificationLastStats.missingSourceColumns?.includes('Доп.информация по причине') ?
                 '<p class="muted">Предупреждение: в активном источнике отсутствует отдельное W «Доп.информация по причине». Исходный W невозможно восстановить из объединённого примечания.</p>' : ''}
              <p>Исходных строк: ${escapeHtml(reclassificationLastStats.rows || 0)}.
                Готовых решений: ${escapeHtml(reclassificationLastStats.readyRows || 0)}.
                Предложений исправления: ${escapeHtml(reclassificationLastStats.statusCounts?.CHANGE || 0)}.
                Штатных веток сохранено без подтверждения отказа: ${escapeHtml(reclassificationLastStats.statusCounts?.BASELINE || 0)}.
                Нужна проверка: ${escapeHtml(reclassificationLastStats.statusCounts?.REVIEW || 0)}.
                Частично разобрано: ${escapeHtml(reclassificationLastStats.partialRows || 0)}.
                По дате закрытия: ${escapeHtml(reclassificationLastStats.usedClosingDate || 0)}.</p>
              <p>Сравнение с инженерной классификацией:
                допустимых полных инженерных разметок ${escapeHtml(reclassificationLastStats.expertComparison?.validMarking || 0)};
                сопоставлено готовых машинных решений ${escapeHtml(reclassificationLastStats.expertComparison?.readyCompared || 0)},
                совпадений ${escapeHtml(reclassificationLastStats.expertComparison?.readyMatched || 0)},
                расхождений ${escapeHtml(reclassificationLastStats.expertComparison?.readyDifferent || 0)}.
                Остальные обращения присутствуют в отчёте, но не участвуют в этом сопоставлении.</p>
              <p>На листе «ITSM» сохранены все строки и колонки A:AL. После AL (с AM) показаны симптомы, диагностика, действия,
                результаты, отрицания, предположения и основания вывода V4 о факте отказа.
                Отдельно показаны оборудование, отказавший объект и доказательства его выбора.
                Колонки O:T и отдельный файл «Reclassification» содержат решения алгоритма 3.3; V4 выдаёт предложения для инженерной проверки без автоматического применения.
                В колонке «Объединённый комментарий из МБ» собраны все непустые комментарии мобильных бригад по номеру обращения, разделённые пустой строкой.
                Комментарии МБ служат для просмотра и не участвуют в техническом разборе.
                Каждый фрагмент V4 содержит исходное поле и положение в тексте. Порядок между разными полями не считается хронологией.
                Лист «Reclassification» содержит только результаты legacy 3.3; кандидаты V4 в него не включаются.</p>
            </div>
          ` : ''}

          ${pendingReclassUpsert ? `
            <div class="card flat" style="margin-top:16px">
              <h3>План обновления реклассификации</h3>
              <p>
                Excel сформирован и доступен по кнопке «Скачать обработанный файл». Текущий справочник в разделе «Данные» пока не изменён.
                Обновление будет выполнено по ключу <strong>«Номер»</strong>.
              </p>
              <div class="info-list">
                <div class="info-row"><span class="info-key">Сейчас в RE-CLASS</span><strong>${escapeHtml(pendingReclassUpsert.plan.currentRows)}</strong></div>
                <div class="info-row"><span class="info-key">Строк в новой обработке</span><strong>${escapeHtml(pendingReclassUpsert.plan.incomingRows)}</strong></div>
                <div class="info-row"><span class="info-key">Будет обновлено по номеру</span><strong>${escapeHtml(pendingReclassUpsert.plan.matchedNumbers)}</strong></div>
                <div class="info-row"><span class="info-key">Будет добавлено новых</span><strong>${escapeHtml(pendingReclassUpsert.plan.addedNumbers)}</strong></div>
                <div class="info-row"><span class="info-key">Старых строк останется без изменений</span><strong>${escapeHtml(pendingReclassUpsert.plan.unchangedCurrentRows)}</strong></div>
                <div class="info-row"><span class="info-key">Итоговый размер RE-CLASS</span><strong>${escapeHtml(pendingReclassUpsert.plan.finalRows)}</strong></div>
              </div>
              ${pendingReclassUpsert.plan.incomingDuplicateNumbers || pendingReclassUpsert.plan.currentDuplicateNumbers ? `
                <div class="notice" style="margin-top:12px">
                  <strong>Обнаружены повторяющиеся номера</strong>
                  <p style="margin:8px 0 0">
                    Во входных данных: ${escapeHtml(pendingReclassUpsert.plan.incomingDuplicateNumbers)};
                    в текущем RE-CLASS: ${escapeHtml(pendingReclassUpsert.plan.currentDuplicateNumbers)}.
                    Для повторяющегося номера используется последняя входная запись; существующие дубли обновляются одинаковым результатом.
                  </p>
                </div>
              ` : ''}
              ${sqliteAuthoritative
                ? '<div class="notice" style="margin-top:12px">Подключена Reclassifier.db. Чтобы сохранить подготовленные данные, скачайте отдельный файл ReClass кнопкой ниже и интегрируйте его через раздел «Работа с базой данных».</div>'
                : ''}
              <div class="action-row">
                ${reclassificationLastReclassFile ? '<button class="button ghost" id="downloadReclassForDatabaseButton">Скачать отдельный ReClass</button>' : ''}
                <button class="button primary" id="applyReclassReplacementButton" ${sqliteAuthoritative ? 'disabled' : ''}>
                  ${sqliteAuthoritative ? 'Интегрируйте через БД' : 'Применить реклассификацию'}
                </button>
              </div>
            </div>
          ` : ''}

          <div class="notice" style="margin-top:18px">
            <strong>Консервативный каскад · правила ${escapeHtml(RECLASSIFICATION_RULES_VERSION)}</strong>
            <p style="margin:10px 0 0">
              Дата выполнения, а при её отсутствии дата закрытия, определяет возможность разбора.
              Отмена устанавливается отдельно по явному признаку. Алгоритм проверяет
              «Оборудование → Элемент → Неисправность → Причина» внутри одной допустимой ветки.
              Для каждого поля сохраняется основание из описания и истории комментариев.
              «Качество классификации» обозначает категорию изменения относительно исходных полей: «RITM без изм», «INC с изменениями» и другие. Это не оценка точности.
              Изменения относительно штатной ITSM отмечены отдельной колонкой.
            </p>
          </div>

          <div class="notice" style="margin-top:12px">
            <strong>Перед применением</strong>
            <p style="margin:10px 0 0">
              Проверьте предложения алгоритма 3.3 в колонках O:T и технические основания V4 справа от AH. Неоднозначные случаи,
              обычные RITM, штатные ветки без подтверждения отказа, отменённые обращения и строки без дат не включаются в обновление RE-CLASS.
              Разметка исходного файла используется только для сравнения после расчёта. При недостатке оснований штатная классификация остаётся в результате.
              Вывод V4 о факте отказа сам по себе не разрешает применение классификации.
            </p>
          </div>
        </article>

        <aside class="side-panel">
          <article class="card flat">
            <h3>Охват данных</h3>
            <div class="info-list">
              <div class="info-row"><span class="info-key">Источник ITSM</span><strong>${sqliteAuthoritative ? 'Подключённая SQLite' : 'Активный HTML Dataset'}</strong></div>
              <div class="info-row"><span class="info-key">Обращений ITSM</span><strong>${escapeHtml(activeItsm?.records?.length || 0)}</strong></div>
              <div class="info-row"><span class="info-key">Период регистрации ITSM</span><strong>${escapeHtml(periodLabel)}</strong></div>
              <div class="info-row"><span class="info-key">Без даты регистрации</span><strong>${escapeHtml(itsmPeriod.undated)}</strong></div>
              <div class="info-row"><span class="info-key">Исходные поля ITSM</span><strong>${runtimeAvailable ? 'Полный Full Dataset' : 'Полный набор недоступен'}</strong></div>
              <div class="info-row"><span class="info-key">Записей в действующем Re-Class</span><strong>${escapeHtml(referencePeriod.rows)}</strong></div>
              <div class="info-row"><span class="info-key">Последняя дата выполнения в Re-Class</span><strong>${escapeHtml(displayReclassificationDate(referencePeriod.latestCompleted))}</strong></div>
            </div>
            <p class="muted" style="margin-top:12px">Дата Re-Class — максимальная «Дата выполнения обращения» в действующем справочнике, а не дата проверки специалистом. Период ITSM определяется по полю «Дата создания Вызова». При выборе файла отчёт рассчитывается по нему, а не по указанному выше периоду базы.</p>
          </article>
        </aside>
      </div>`;

    bindDatasetDropzone(
      'reclassificationDropzone',
      'selectReclassificationSourceButton',
      selectReclassificationSource,
      () => {},
      false
    );

    document.getElementById('openItsmProcessingButton')?.addEventListener('click', () => navigate('itsm'));

    document.getElementById('clearReclassificationSourceButton')?.addEventListener('click', () => {
      if (!state.baselineReady || state.processingModuleId) return;
      state.sourceFile = null;
      pendingReclassUpsert = null;
      reclassificationLastStats = null;
      reclassificationLastReclassFile = null;
      reclassificationLastReportFile = null;
      reclassificationLastReportSource = null;
      renderReclassificationModule();
    });

    document.getElementById('downloadProcessedReclassificationButton')?.addEventListener('click', () => {
      if(state.processingModuleId || !reclassificationLastReportFile)return;
      downloadReclassificationResult(reclassificationLastReportFile.bytes,reclassificationLastReportFile.name);
    });

    document.getElementById('downloadLegacyReclassificationButton')?.addEventListener('click', () => {
      if(state.processingModuleId || !reclassificationLastReclassFile)return;
      downloadReclassificationResult(reclassificationLastReclassFile.bytes,reclassificationLastReclassFile.name);
    });

    document.getElementById('downloadReclassForDatabaseButton')?.addEventListener('click', () => {
      if(reclassificationLastReclassFile)downloadReclassificationResult(reclassificationLastReclassFile.bytes,reclassificationLastReclassFile.name);
    });

    document.getElementById('applyReclassReplacementButton')?.addEventListener('click', () => {
      try {
        const applied = applyPendingReclassUpsert();
        alert(
          'RE-CLASS обновлён: ' + applied.plan.matchedNumbers + ' обновлено, ' +
          applied.plan.addedNumbers + ' добавлено, итог ' +
          applied.instance.records.length + ' строк.'
        );
      } catch (error) {
        const message = error?.message || String(error);
        log('Ошибка обновления RE-CLASS: ' + message, 'ERROR', 'import_export');
        alert('Не удалось применить реклассификацию: ' + message);
      }
    });

    document.getElementById('processReclassificationRuntimeButton')?.addEventListener('click', async event => {
      if (!state.baselineReady || state.processingModuleId) return;
      const operationId='reclassification-'+(++reclassificationOperationSequence);
      const button=event.currentTarget;
      state.processingModuleId='reclassification';
      state.processingOperationId=operationId;
      pendingReclassUpsert=null;
      reclassificationLastStats=null;
      reclassificationLastReclassFile=null;
      reclassificationLastReportFile=null;
      reclassificationLastReportSource=null;
      button.disabled=true;
      updateProcessingButton(button,{percent:0,label:'Подготовка Active Runtime'});
      try{
        const result=await processReclassificationRuntime({
          operationId,onProgress:progress=>updateProcessingButton(button,progress)
        });
        alert('Реклассификация всей базы сформирована: '+(result.stats?.rows||0)+
          ' строк. Файл «'+result.outputName+'» готов к скачиванию.');
      }catch(error){
        const message=error?.message||String(error);
        log('Ошибка реклассификации активной ITSM-базы: '+message,'ERROR', 'import_export');
        alert('Не удалось сформировать реклассификацию из базы: '+message);
      }finally{
        if(state.processingOperationId===operationId){
          state.processingModuleId=null;
          state.processingOperationId=null;
        }
        if(state.route==='reclassification')renderReclassificationModule();
      }
    });

    document.getElementById('processReclassificationButton')?.addEventListener('click', async event => {
      if (!state.baselineReady) {
        alert('Дождитесь завершения загрузки стартовых данных.');
        return;
      }
      if (state.processingModuleId) {
        alert('Уже выполняется обработка. Дождитесь её завершения.');
        return;
      }
      if (!state.sourceFile) return;

      const sourceFile = state.sourceFile;
      const operationId = 'reclassification-' + (++reclassificationOperationSequence);
      const button = event.currentTarget;
      const selectButton = document.getElementById('selectReclassificationSourceButton');
      const clearButton = document.getElementById('clearReclassificationSourceButton');
      const applyButton = document.getElementById('applyReclassReplacementButton');
      const oldText = button.textContent;

      state.processingModuleId = 'reclassification';
      state.processingOperationId = operationId;
      pendingReclassUpsert = null;
      reclassificationLastStats = null;
      reclassificationLastReclassFile = null;
      reclassificationLastReportFile = null;
      reclassificationLastReportSource = null;
      button.disabled = true;
      updateProcessingButton(button,{percent:0,label:'Подготовка'});
      if (selectButton) selectButton.disabled = true;
      if (clearButton) clearButton.disabled = true;
      if (applyButton) applyButton.disabled = true;

      try {
        const result = await processReclassificationFile({ sourceFile, operationId, onProgress: progress => updateProcessingButton(button,progress) });
        assertReclassificationOperationCurrent(sourceFile, operationId);
        alert(
          'Реклассификация сформирована: ' +
          (result.stats?.rows || 0) + ' строк, ' +
          (result.stats?.columns || 0) + ' колонок. Файл «' +
          result.outputName + '» готов к скачиванию.'
        );
      } catch (error) {
        const message = error?.message || String(error);
        log('Ошибка обработки ITSM и диагностики: ' + message, 'ERROR', 'import_export');
        alert('Не удалось сформировать реклассификацию: ' + message);
      } finally {
        if (state.processingOperationId === operationId) {
          state.processingModuleId = null;
          state.processingOperationId = null;
        }
        if (state.route === 'reclassification') renderReclassificationModule();
      }
    });
  }

  registerModule('reclassification', reclassificationModuleConfig, renderReclassificationModule, processReclassificationFile);
