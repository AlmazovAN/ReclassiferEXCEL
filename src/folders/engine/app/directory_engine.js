// FILE CONTRACT: file-only Directory discovery and normalization.
// Purpose: classify selected local Excel files by workbook headers and prepare references.
// Owns: transient scan candidates; never persists handles, file bytes or workbook objects.
// Reads: SheetJS, existing Reference/Equipment/Classifier/DKN handlers.
// Writes: no source file writes; publishes validated reference batch only.
// Public API: ReclassifierDirectoryEngine.scan(), .enumerate(), .manifest().
// Must not: perform direct export, background poll, pick a duplicate silently or write Excel.
// Related tests: tests/test_directory_workspace.js, tests/test_emergency_excel_mode.py.
(() => {
  'use strict';

  const ITSM = Object.freeze([
    ['reclassification', 'Реклассификация'],
    ['drivers', 'Драйверы оборудования'],
    ['customers', 'Заказчики'],
    ['type_request', 'Типовые запросы'],
    ['initiators', 'Инициаторы'],
    ['exceptions', 'Исключения'],
    ['problem_grade', 'Связь с IT-проблемами']
  ]);
  const MB = Object.freeze([
    ['mounted', 'Навесное оборудование'],
    ['stationary', 'Стационарное оборудование'],
    ['transport', 'Транспорт'],
    ['zabbix', 'Zabbix'],
    ['combined', 'Equipment_Combined']
  ]);
  const OPTIONAL = Object.freeze([
    ['failure_classifier', 'Классификатор отказов'],
    ['dkn_roadmap', 'Дорожная карта ДКН']
  ]);
  const SOURCE_IDS = new Set([...ITSM, ...MB, ...OPTIONAL].map(item => item[0]));
  const EQUIPMENT_IDS = Object.freeze(['mounted', 'stationary', 'transport', 'zabbix']);
  const REQUIRED_IDS = Object.freeze([...ITSM, ...MB].map(item => item[0]));
  const {maxFiles:MAX_FILES, includeExcel, enumerate, relativeFiles,
    inspectRoot, ensureWorkspaceFolders, inspectSelection} = folderDirectory;
  let scanGeneration = 0;

  function manifest() {
    return Object.freeze({itsm: ITSM, mobileBrigade: MB, optional: OPTIONAL, requiredIds: REQUIRED_IDS});
  }


  function stationaryDiagnostic(workbook) {
    const xlsx = globalThis.XLSX;
    const required = equipmentConfig.stationary.requiredHeaders;
    let best = {missing:required, sheetName:null, row:null};
    for (const sheetName of workbook.SheetNames || []) {
      const rows = xlsx.utils.sheet_to_json(workbook.Sheets[sheetName], {
        header:1, raw:true, defval:null, range:0
      });
      for (let index = 0; index < Math.min(rows.length, 20); index++) {
        const headers = new Set((rows[index] || []).map(normalizeEquipmentHeader));
        const missing = required.filter(header => !headers.has(normalizeEquipmentHeader(header)));
        if (missing.length < best.missing.length) best = {missing, sheetName, row:index + 1};
      }
    }
    if (!best.sheetName) return 'Заголовок Stationary не распознан. Обязательные колонки: ' + required.join(', ') + '.';
    const location = 'Лист «' + best.sheetName + '», строка ' + best.row + '. ';
    return location + (best.missing.length
      ? 'В заголовке Stationary отсутствуют обязательные колонки: ' + best.missing.join(', ') + '.'
      : 'Структура файла определена как другой тип. Проверьте состав листов Stationary.');
  }

  async function sha256(bytes) {
    const hashBytes=globalThis.ReclassifierLocalExportLimits?.hashBytes;
    if(hashBytes) return hashBytes(new Uint8Array(bytes));
    if (!globalThis.crypto?.subtle) return null;
    const digest = await globalThis.crypto.subtle.digest('SHA-256',bytes);
    return Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2,'0')).join('');
  }

  // Читаем начало листов для распознавания структуры. SHA-256 идентифицирует конкретное содержимое файла.
  async function classify(entry) {
    // XLSX is ZIP-based: the parser needs input bytes even with sheetRows=45.
    // Parse only first header rows and discard the raw buffer/workbook after the
    // classification. Do NOT retain full workbooks for ITSM/MB on Refresh.
    let buffer = null;
    let workbook = null;
    try {
      buffer = await entry.file.arrayBuffer();
      workbook = globalThis.XLSX.read(buffer, {
        type:'array', dense:true, sheetRows:45, cellDates:false, cellHTML:false, cellText:false
      });
      const detected = globalThis.ReclassifierDatasetClassifier.classifyWorkbook(workbook,{partialItsm:entry.folder==='itsm'});
      if (!detected || typeof detected.id !== 'string') {
        throw new Error('Определитель формата не вернул тип источника.');
      }
      const id = detected.id.startsWith('equipment:')
        ? detected.id.slice('equipment:'.length) : detected.id;
      const stationaryFile = entry.folder === 'catalogs' &&
        equipmentConfig.stationary?.filePattern?.test(entry.file.name);
      if (stationaryFile && id !== 'stationary') {
        return {id:'stationary', diagnostic:stationaryDiagnostic(workbook)};
      }
      const fingerprint = await sha256(buffer);
      const created = workbook.Props?.CreatedDate;
      return {id,label:detected.label || id,sha256:fingerprint,
        createdAt:created instanceof Date&&Number.isFinite(created.getTime())?created.toISOString():null,
        sheetName:detected.sheetName || null,headerRow:detected.headerRow ?? null,
        headerMap:detected.headerMap || null};
    } finally {
      workbook = null;
      buffer = null;
    }
  }

  const prepare = createFolderReferenceReader({
    referenceIds:ITSM.map(([id])=>id), equipmentIds:EQUIPMENT_IDS,
    readWorkbook:readFolderWorkbook,
    processReferenceFile, sha256, normalizeEquipmentWorkbook, equipmentConfig,
    identifyEquipmentCatalog:typeof identifyEquipmentCatalog === 'function' ? identifyEquipmentCatalog : null,
    normalizeFailureClassifierWorkbook,
    getDatasetSchemaVersion:id=>globalThis.ReclassifierDatasetCatalog.get(id).schemaVersion,
    dkn:globalThis.ReclassifierDknRoadmap, xlsx:globalThis.XLSX
  });

  function filenameDate(name) {
    const iso = name.match(/(?:^|[^\d])(20\d{2})[-_.](\d{2})[-_.](\d{2})(?!\d)/);
    const local = name.match(/(?:^|[^\d])(\d{2})[-_.](\d{2})[-_.](20\d{2})(?!\d)/);
    if (!iso && !local) return null;
    const [year,month,day] = iso ? iso.slice(1) : local.slice(1).reverse();
    const date = year+'-'+month+'-'+day;
    const parsed = new Date(date+'T00:00:00Z');
    return Number.isFinite(parsed.getTime()) && parsed.toISOString().startsWith(date) ? date : null;
  }

  function referenceIndicators(meta) {
    return [
      [meta?.exactDuplicateRows, 'Дубли строк'],
      [meta?.duplicateNumberCount, 'Повторяющиеся номера'],
      [meta?.ambiguousClassifierKeyCount, 'Пересечения привязок проблем'],
      [meta?.incompleteClassifierCount, 'Строк с неполной цепочкой'],
      [meta?.missingProblemIdCount, 'Строк без номера ИТ-проблемы']
    ].filter(([count]) => count > 0)
      .map(([count,label]) => label + ': ' + count.toLocaleString('ru-RU'));
  }

  function asStatus(status, files = [], details = [], rows = null) {
    return {status, files:files.map(item => item.path), details:Array.from(details), rows};
  }

  function workState(id, work, issues) {
    const files = work.map(entry => entry.path);
    const details = issues.map(issue => issue.message);
    const maxBytes = 192 * 1048576;
    const oversized = maxBytes ? work.filter(entry => entry.file.size > maxBytes) : [];
    if (oversized.length) {
      details.push('Превышен предел размера входной книги XLSX: ' +
        oversized.map(entry => entry.path).join('; ') + '.');
    }
    const unsupported = work.filter(entry => !/\.xlsx$/i.test(entry.file.name));
    if (unsupported.length) {
      details.push('Для накопительной выгрузки поддерживается XLSX. Найдены книги другого формата: ' +
        unsupported.map(entry => entry.path).join('; ') + '. Пока только чтение.');
    }
    return {
      status: issues.length ? 'invalid' :
        !files.length ? 'missing' :
        unsupported.length || oversized.length ? 'warning' : 'ready',
      files, count: files.length, details,
      // Business processors are attached in PR-04/05; this is schema-only readiness.
      eligible: files.length > 0 && issues.length === 0 && unsupported.length === 0 && oversized.length === 0
    };
  }

  // Распознаём книги, проверяем набор справочников и сохраняем их рабочие поля для расчёта.
  async function scan(entries, progress = () => {}, { exportOnly = false, includeCombined = !exportOnly, preparedReferences = null, showInactive = false } = {}) {
    if (!globalThis.XLSX || !globalThis.ReclassifierDatasetClassifier?.classifyWorkbook) {
      throw new Error('Не загружены компоненты разбора Excel.');
    }
    if (!Array.isArray(entries) || entries.length > MAX_FILES) {
      throw new Error('Неподдерживаемая выборка файлов.');
    }

    const generation = ++scanGeneration;
    const candidates = new Map();
    const found = new Map();
    const errors = [];
    const catalogIssues = [];
    const workIssues = {itsm:[], mobileBrigade:[]};
    const work = {itsm:[], mobileBrigade:[]};
    const statuses = new Map();
    const seenPaths = new Set();
    const files = new Map();
    if(preparedReferences){
      for(const [id] of ITSM){
        statuses.set(id,preparedReferences.statuses.get(id));
        candidates.set(id,{records:preparedReferences.exportReferences[id]});
      }
      for(const [name,file] of preparedReferences.files){
        if(file.folder==='catalogs') files.set(name,{...file,generation});
      }
    }
    let scanned = 0;
    let catalogsReady = false;
    let published = false;
    let referenceLookups = null;

    function indexFile(entry, classification = {}) {
      if (!files.has(entry.path)) {
        files.set(entry.path,{
          ...classification,path:entry.path,folder:entry.folder,name:entry.file.name,
          size:entry.file.size,lastModified:entry.file.lastModified,generation
        });
      }
      return files.get(entry.path);
    }

    function recordError(entry, message) {
      const indexed = indexFile(entry);
      indexed.status = 'invalid';
      indexed.diagnostics = [...(indexed.diagnostics || []),message];
      const item = {path:entry.path, message:entry.path + ': ' + message};
      errors.push(item.message);
      if (entry.folder === 'catalogs') catalogIssues.push(item);
      else if (entry.folder === 'itsm') workIssues.itsm.push(item);
      else if (entry.folder === 'mb') workIssues.mobileBrigade.push(item);
      // Unconfigured root folders cannot publish into the working set.
    }

    const referenceTypes = [...(preparedReferences ? [] : ITSM), ...(includeCombined ? MB.filter(item => item[0] !== 'combined') : []),
        ...(exportOnly ? [] : OPTIONAL)];
    const stepCount = entries.length + referenceTypes.length;

    try {
      for (let index = 0; index < entries.length; index++) {
        const entry = entries[index];
        if (!entry || !entry.file || !entry.path ||
            !['catalogs','itsm','mb'].includes(entry.folder)) {
          throw new Error('В выборке присутствует источник вне трёх рабочих подпапок.');
        }
        if (!includeExcel(entry.file.name, entry.folder)) continue;
        scanned++;
        progress('Распознавание ' + (index + 1) + '/' + entries.length + ': ' + entry.file.name, 100 * index / stepCount,
          entry.folder === 'catalogs' ? undefined : {kind:entry.folder,phase:'reading'});
        const normalizedPath = entry.path.replaceAll('\\','/').toLocaleLowerCase('ru-RU');
        if (seenPaths.has(normalizedPath)) {
          recordError(entry, 'Повторяющийся путь файла в выборке; автоматический выбор запрещён.');
          continue;
        }
        seenPaths.add(normalizedPath);
        let classification;
        try {
          classification = await classify(entry);
        } catch (error) {
          recordError(entry, 'Не удалось прочитать Excel: ' + (error?.message || String(error)));
          continue;
        }
        const id = classification.id;
        indexFile(entry,classification);
        if (id === 'itsm' && entry.folder === 'itsm') {
          work.itsm.push(entry);
        } else if (id === 'mobile_brigade' && entry.folder === 'mb') {
          work.mobileBrigade.push(entry);
        } else if (SOURCE_IDS.has(id) && id !== 'combined' && entry.folder === 'catalogs') {
          const list = found.get(id) || [];
          list.push(entry);
          found.set(id, list);
        } else if (entry.folder !== 'catalogs') {
          Object.assign(files.get(entry.path),{status:'skipped',diagnostics:['Посторонняя книга пропущена.']});
        } else if (id === 'unknown') {
          recordError(entry, 'Файл не распознан по структуре заголовков; проверьте тип выгрузки.');
        } else {
          recordError(entry, 'Тип «' + (classification.label || id) +
            '» не соответствует папке ' + entry.folder + '.');
        }
        // Yield once per file. Neither workbook nor source ArrayBuffer survives classify().
        await new Promise(resolve => setTimeout(resolve, 0));
      }

      for (const [index,[id,label]] of referenceTypes.entries()) {
        const items = found.get(id) || [];
        progress('Проверка справочника: ' + (items[0]?.file.name || label),
          100 * (entries.length + index) / stepCount);
        const supportsVariants = id === 'mounted' || id === 'stationary';
        if (!items.length) {
          statuses.set(id, asStatus('missing', [], ['Файл не обнаружен по структуре заголовков.']));
        } else if (items.length > 1 && !supportsVariants) {
          statuses.set(id, asStatus('warning', items,
            ['Найдено ' + items.length +
              ' файлов одного типа. Необходимо устранить неоднозначность; автоматический выбор запрещён.']));
        } else {
          try {
            const instances = [];
            for (const entry of items) {
              const metadata = files.get(entry.path);
              if (metadata.diagnostic) throw new Error(metadata.diagnostic);
              const source = await prepare(entry, id, metadata.sha256);
              if (source.validation?.status === 'invalid') {
                throw new Error(source.validation.errors.join(' ') || 'Справочник не прошёл проверку.');
              }
              instances.push(source);
            }
            const instance = instances.at(-1);
            if (instances.length > 1) {
              instance.records = globalThis.ReclassifierEquipmentPartitions.mergeFileRows(id,
                instances.map(source => source.records));
              const warnings = instances.flatMap(source => source.validation?.warnings || []);
              instance.validation = {status:warnings.length ? 'warning' : 'valid',errors:[],warnings};
              instance.meta.normalizedRows = instance.records.length;
            }
            const validation = instance?.validation || {};
            const details = [...(validation.errors || []), ...(validation.warnings || [])];
            if (!['valid','warning'].includes(validation.status) || validation.errors?.length) {
              statuses.set(id, asStatus('invalid', items,
                details.length ? details : ['Нормализатор не подтвердил корректность справочника.']));
            } else if (!Array.isArray(instance.records) ||
              (!instance.records.length && !globalThis.ReclassifierDatasetCatalog.get(id)?.allowEmpty)) {
              statuses.set(id, asStatus('invalid',items,['Нормализованный справочник пуст.']));
            } else {
              const compact=globalThis.ReclassifierLocalExportLimits?.compactReference;
              candidates.set(id, exportOnly&&compact
                ? {...instance,records:compact(id,instance.records)}
                : instance);
              const status = asStatus(details.length ? 'warning' : 'ready',items,details,instance.records.length);
              status.date = id === 'reclassification' ? instance.meta?.latestRequestDate : items.map(item => filenameDate(item.file.name)).filter(Boolean).sort().at(-1) || null;
              if (details.length) status.indicators = referenceIndicators(instance.meta);
              statuses.set(id,status);
            }
          } catch (error) {
            statuses.set(id, asStatus('invalid',items,[error?.message || String(error)]));
          }
        }
        for (const item of items) {
          const file = files.get(item.path);
          const status = statuses.get(id);
          Object.assign(file,{status:status.status,rows:status.rows,diagnostics:status.details});
        }
        await new Promise(resolve => setTimeout(resolve, 0));
      }

      if (showInactive) {
        for (const id of [...EQUIPMENT_IDS,'failure_classifier']) {
          const items = found.get(id) || [];
          const available = id === 'failure_classifier'
            ? typeof normalizeFailureClassifierWorkbook === 'function'
            : typeof normalizeEquipmentWorkbook === 'function' && Boolean(equipmentConfig[id]);
          const detected = items.length === 1 && !files.get(items[0].path)?.diagnostic;
          const item = asStatus('inactive',items,[
            ...(items.length > 1 ? ['Распознано несколько файлов.'] : []),
            ...(items.length === 1 ? [items[0].path,files.get(items[0].path)?.diagnostic].filter(Boolean) : [])
          ]);
          item.badgeState = !available || !items.length ? 'error'
            : items.length > 1 ? 'warning' : detected ? 'ready' : 'error';
          item.date = detected ? filenameDate(items[0].file.name) : null;
          item.note = !available ? 'Обработчик недоступен' : detected ? (id === 'failure_classifier' ? 'Формат распознан · используется для реклассификации' : 'Формат распознан · временно не используется')
            : items.length ? 'Обработчик есть · проверьте файлы' : 'Обработчик есть · файл не найден';
          statuses.set(id,item);
        }
      }

      if (includeCombined) {
        const missingEquipment = EQUIPMENT_IDS.filter(id => !candidates.has(id));
        if (missingEquipment.length) {
          const details = missingEquipment.map(id => {
            const label = MB.find(([sourceId]) => sourceId === id)[1];
            const status = statuses.get(id);
            return label + ' · ' + (status?.details[0] || 'Источник не готов.');
          });
          statuses.set('combined', asStatus('missing', [], details));
        } else {
          progress('Пересчёт Equipment_Combined');
          try {
            const sources = Object.fromEntries(EQUIPMENT_IDS.map(id => [id,candidates.get(id)]));
            const combined = buildEquipmentCombinedFromCatalogs(sources,'derived');
            const allowEmpty = globalThis.ReclassifierDatasetCatalog.get('combined')?.allowEmpty === true;
            if (!combined || !['valid','warning'].includes(combined.validation?.status) ||
                combined.validation?.errors?.length || !Array.isArray(combined.records) ||
                (!allowEmpty && !combined.records.length)) {
              throw new Error('Алгоритм не подготовил допустимый Equipment_Combined.');
            }
            candidates.set('combined',combined);
            statuses.set('combined',asStatus(
              combined.validation?.warnings?.length ? 'warning' : 'ready',[],
              [
                ...(combined.validation?.warnings || []),
                'Транспорт: совпадений ' + (combined.meta?.transportMatches ?? 0) +
                  ' из ' + (combined.meta?.transportCandidates ?? 0) +
                  '; без связи ' + (combined.meta?.transportUnmatched ?? 0) + '.',
                'Zabbix: совпадений по ID оборудования ' + (combined.meta?.zabbixEquipmentMatches ?? 0) + '.'
              ],combined.records.length
            ));
          } catch (error) {
            statuses.set('combined',asStatus('invalid',[],[error?.message || String(error)]));
          }
        }
      }

      if (generation !== scanGeneration) throw new Error('Сканирование заменено более новым обновлением.');
      catalogsReady = !exportOnly && catalogIssues.length === 0 && REQUIRED_IDS.every(id =>
        candidates.has(id) && ['ready','warning'].includes(statuses.get(id)?.status)
      );
      if (catalogsReady) {
        try {
          // The dataset pipeline validates the entire candidate batch before any publish.
          // Do not update equipment state until the transaction has succeeded.
          const references = Object.fromEntries(ITSM.map(([id]) => [id,candidates.get(id).records]));
          referenceLookups = globalThis.ReclassifierItsmRules?.buildLookups(references);
          globalThis.ReclassifierDatasetLifecycleManager.activateBatch([...candidates.values()]);
          published = true;
        } catch (error) {
          catalogsReady = false;
          const message = 'Не удалось опубликовать полный комплект справочников: ' +
            (error?.message || String(error));
          errors.push(message);
          catalogIssues.push({path:'catalogs',message});
        }
      }

      const workStatuses = Object.freeze({
        itsm:workState('itsm',work.itsm,workIssues.itsm),
        mobileBrigade:workState('mobileBrigade',work.mobileBrigade,workIssues.mobileBrigade)
      });
      for (const [type, entries] of Object.entries(work)) {
        for (const entry of entries) {
          const file = files.get(entry.path);
          Object.assign(file,{status:workStatuses[type].status,diagnostics:workStatuses[type].details});
        }
      }
      const referencesReady=ITSM.every(([id])=>candidates.has(id));
      const exportReferences=referencesReady
        ? Object.fromEntries(ITSM.map(([id])=>[id,candidates.get(id).records])) : null;
      const processingReady = published &&
        workStatuses.itsm.eligible && workStatuses.mobileBrigade.eligible;
      return {
        statuses, work, workStatuses, errors,
        catalogIssues:catalogIssues.map(issue => issue.message),
        workIssues:{
          itsm:workIssues.itsm.map(issue => issue.message),
          mobileBrigade:workIssues.mobileBrigade.map(issue => issue.message)
        },
        catalogsReady:published, allReady:published,
        processingReady, published, exportReferences,
        generation,files,
        combined: candidates.get('combined') || null,
        publishedInstances:published ? new Map(candidates) : null,
        referenceLookups:published ? referenceLookups : null,
        scanned
      };
    } finally {
      // Never retain rejected normalized candidates, raw workbooks, or input buffers.
      candidates.clear();
      found.clear();
      seenPaths.clear();
    }
  }

  function staleScan(message) {
    return Object.assign(new Error(message + ' Выполните «Обновить».'),{code:'DIRECTORY_SCAN_STALE'});
  }

  function assertCurrent(scan) {
    const active = globalThis.ReclassifierDatasetLifecycleManager?.active;
    if (!scan?.published || scan.generation !== scanGeneration || !scan.publishedInstances ||
        !active || [...scan.publishedInstances].some(([id,instance]) => active(id) !== instance)) {
      throw staleScan('Рабочий комплект устарел.');
    }
  }

  function assertSourceVersion(scan, entry, fingerprint) {
    const indexed = scan.files?.get(entry.path);
    if (!indexed || indexed.generation !== scan.generation || !indexed.sha256 ||
        indexed.sha256 !== fingerprint) {
      throw staleScan(entry.path + ': файл изменён или его версия не подтверждена.');
    }
  }

  async function verifyWorkspace(root, scan, checkpoint = () => {}) {
    assertCurrent(scan);
    const current = await enumerate(root);
    if (current.length !== scan.files.size || current.some(entry => !scan.files.has(entry.path))) {
      throw staleScan('Состав рабочих файлов изменился.');
    }
    for (const entry of current) {
      checkpoint();
      const indexed = scan.files.get(entry.path);
      if (!indexed.sha256 || indexed.size !== entry.file.size ||
          await sha256(await entry.file.arrayBuffer()) !== indexed.sha256) {
        throw staleScan(entry.path + ': файл изменён или его версия не подтверждена.');
      }
    }
    assertCurrent(scan);
  }

  function assertExportScan(scan) {
    if(!scan?.exportReferences || scan.generation!==scanGeneration) {
      throw staleScan('Не подтверждены справочники ITSM.');
    }
    const errors=[...scan.workIssues.itsm,...scan.workIssues.mobileBrigade];
    if(errors.length) throw new Error(errors.join('\n'));
  }

  function exportReferenceHashes(scan) {
    assertExportScan(scan);
    return ITSM.map(([id])=>{
      const path=scan.statuses.get(id).files[0];
      const sha=scan.files.get(path)?.sha256;
      if(!sha) throw staleScan(path+': не подтверждена версия справочника.');
      return [id,sha];
    });
  }

  // Перед записью повторно сверяем состав входных файлов и их SHA-256 со снимком, по которому считали.
  async function verifyExportSources(root,scan,checkpoint=()=>{}) {
    assertExportScan(scan);
    const referencePaths=new Set(ITSM.map(([id])=>scan.statuses.get(id).files[0]));
    const current=await enumerate(root);
    const relevant=entry=>entry.folder!=='catalogs'||referencePaths.has(entry.path);
    const indexed=[...scan.files.values()].filter(relevant);
    const checked=current.filter(relevant);
    if(checked.length!==indexed.length||checked.some(entry=>!scan.files.has(entry.path))) {
      throw staleScan('Состав входных XLSX изменился.');
    }
    // A newly added catalog may be a second version of a required reference.
    if(current.some(entry=>entry.folder==='catalogs'&&!scan.files.has(entry.path))) {
      throw staleScan('В Catalogs появились новые книги.');
    }
    for(const entry of checked){
      checkpoint();
      assertSourceVersion(scan,entry,await (globalThis.ReclassifierLocalExportLimits?.hashBlob?.(entry.file) ??
        sha256(await entry.file.arrayBuffer())));
    }
    assertExportScan(scan);
  }

  async function verifyEquipmentSources(root, scan) {
    if (!scan?.combined || scan.generation !== scanGeneration) {
      throw staleScan('Расчёт оборудования устарел.');
    }
    const indexed = [...scan.files.values()].filter(file => file.folder === 'catalogs');
    const current = await enumerate(root,'catalogs');
    if (current.length !== indexed.length || current.some(entry => !scan.files.has(entry.path))) {
      throw staleScan('Состав папки Catalogs изменился.');
    }
    for (const entry of current) {
      if (EQUIPMENT_IDS.includes(scan.files.get(entry.path).id)) {
        assertSourceVersion(scan,entry,await (globalThis.ReclassifierLocalExportLimits?.hashBlob?.(entry.file) ??
        sha256(await entry.file.arrayBuffer())));
      }
    }
    if (scan.generation !== scanGeneration) throw staleScan('Расчёт оборудования устарел.');
  }

  function release(scan) {
    if (!scan) return;
    if (scan.generation === scanGeneration) scanGeneration++;
    const instances = scan.publishedInstances;
    if (instances) {
      globalThis.ReclassifierDatasetLifecycleManager?.releaseBatch?.(instances);
      instances.clear();
    }
    scan.files?.clear();
    scan.referenceLookups = null;
    scan.exportReferences = null;
    scan.combined = null;
  }

  globalThis.ReclassifierDirectoryEngine = Object.freeze({manifest,enumerate,relativeFiles,inspectRoot,ensureWorkspaceFolders,inspectSelection,scan,assertCurrent,assertSourceVersion,verifyWorkspace,verifyEquipmentSources,assertExportScan,exportReferenceHashes,verifyExportSources,release});
})();
