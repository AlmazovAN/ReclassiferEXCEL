(() => {
  'use strict';

  const pageButtons = document.querySelectorAll('[data-page]');
  const rca = typeof createRcaState === 'function'
    ? createRcaState(document.getElementById('rca-save-status')) : null;
  const rcaUi = rca && document.getElementById('rca-content')?.nodeType === 1
    ? createRcaUi(rca, downloadBlob) : null;
  const openedAsFile = location.protocol === 'file:';
  const supportsFolderPicker = typeof window.showDirectoryPicker === 'function';
  const select = document.getElementById('select-folder');
  const importFolder = document.getElementById('import-folder');
  const folderFiles = document.getElementById('folder-files');
  const status = document.getElementById('folder-status');
  const references = document.getElementById('refresh-references');
  const exports = document.getElementById('refresh-exports');
  const panels = {
    references: {
      status: document.getElementById('reference-status'),
      progress: document.getElementById('reference-progress')
    },
    exports: {
      status: document.getElementById('export-status'),
      progress: document.getElementById('export-progress')
    }
  };
  const referenceBadges = document.getElementById('reference-badges');
  const inactiveReferences = document.getElementById('inactive-references');
  const inactiveBadges = document.getElementById('inactive-badges');
  const folderArt = document.getElementById('folder-art');
  const referencesArt = document.getElementById('references-art');
  const scenes = Object.fromEntries(['itsm','mb'].map(kind=>[kind,document.getElementById('scene-'+kind)]));
  const exportBadges = document.getElementById('export-badges');
  const exportFiles = document.getElementById('export-files');
  const exportFileActions = document.getElementById('export-file-actions');
  const saveStatus = document.getElementById('save-status');
  const referenceNames = {
    reclassification:'Реклассификация', drivers:'Драйверы оборудования',
    customers:'Заказчики', type_request:'Типовые запросы', initiators:'Инициаторы',
    exceptions:'Исключения', problem_grade:'Связь с IT-проблемами',
    mounted:'Навесное оборудование', stationary:'Стационарное оборудование',
    transport:'Транспорт', zabbix:'Zabbix', failure_classifier:'Актуальный классификатор отказов'
  };
  let root;
  let importedFiles;
  let worker;
  let referencesReady = false;
  const runReclassification = document.getElementById('run-reclassification');
  const reclassificationSource = document.getElementById('reclassification-source');
  const pickReclassificationSource = document.getElementById('pick-reclassification-source');
  const reclassificationFrom = document.getElementById('reclassification-from');
  const reclassificationTo = document.getElementById('reclassification-to');
  const reclassificationStatus = document.getElementById('reclassification-status');
  const reclassificationProgress = document.getElementById('reclassification-progress');
  const downloadReclassification = document.getElementById('download-reclassification');
  let reclassificationResult = null;
  let busy = false;
  let startedAt = 0;
  let activeAction;
  let memoryRun;
  let journalOperation;
  const {capture, isLogging, persistJournal, scheduleJournal} = createFoldersJournal({
    downloadBlob, getOperation:()=>journalOperation, openedAsFile, supportsFolderPicker, memoryMiB
  });

  function controls() {
    select.disabled = busy || !supportsFolderPicker;
    importFolder.disabled = busy;
    references.disabled = busy || !root;
    exports.disabled = busy || !referencesReady;
    if (runReclassification) runReclassification.disabled = busy || !referencesReady;
    if (downloadReclassification) downloadReclassification.disabled = busy;
    for (const button of exportFileActions.children) button.disabled = busy;
  }

  function formatDate(value) {
    return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value)
      ? value.slice(0,10).split('-').reverse().join('.') : '';
  }

  function clearReferences() {
    referenceBadges.replaceChildren();
    inactiveBadges.replaceChildren();
    inactiveReferences.hidden = true;
  }

  function showBook(kind, percent, phase) {
    const scene = scenes[kind];
    const active = phase !== 'staged' && phase !== 'prepared' && percent !== 100;
    if (active) {
      for (const other of Object.values(scenes)) {
        if (other === scene || other.dataset.state !== 'active') continue;
        other.dataset.state = other.style.getPropertyValue('--fill') === '99%' ? 'prepared' : 'staged';
      }
    }
    scene.dataset.state = active ? 'active' : phase || 'done';
    scene.style.setProperty('--fill',(percent ?? 0)+'%');
    scene.querySelector('.excel-value').textContent = percent === undefined ? '…' : percent+'%';
    scene.querySelector('.scene-phase').textContent = {
      reading:'Чтение', staged:'Данные подготовлены', prepared:'Ожидает сохранения', writing:'Запись и проверка'
    }[phase] || (percent === 100 ? 'Книга готова' : 'Формирование');
  }

  function resetScenes() {
    for (const scene of Object.values(scenes)) {
      delete scene.dataset.state;
      scene.style.removeProperty('--fill');
      scene.querySelector('.excel-value').textContent = '0%';
      scene.querySelector('.scene-phase').textContent = '';
    }
  }

  function showShelf(state, percent = 0) {
    const clean = Math.max(0,Math.min(100,percent))/100;
    referencesArt.dataset.state = state;
    referencesArt.style.setProperty('--clean',clean);
    referencesArt.style.setProperty('--tilt',13*(1-clean)+'deg');
  }

  function badge(list, title, detail, state, diagnostics = [], date) {
    const item = document.createElement('li');
    item.dataset.state = state;
    const label = document.createElement('strong');
    label.textContent = title;
    item.append(label);
    if (date !== undefined) {
      const stamp = document.createElement('small');
      stamp.className = 'badge-date';
      stamp.textContent = formatDate(date) || 'Дата не указана';
      item.append(stamp);
    }
    if (detail) {
      const description = document.createElement('small');
      description.className = 'badge-description';
      description.textContent = detail;
      item.append(description);
    }
    if (diagnostics.length) {
      const details = document.createElement('details');
      const summary = document.createElement('summary');
      summary.textContent = 'Подробности';
      details.append(summary);
      for (const diagnostic of diagnostics) {
        const paragraph = document.createElement('p');
        paragraph.textContent = diagnostic;
        details.append(paragraph);
      }
      item.append(details);
    }
    list.append(item);
  }

  function setOutcome(action, message, error = false) {
    const {status} = panels[action];
    status.textContent = message;
    status.toggleAttribute('data-error',error);
  }

  function setProgress(action, visible, percent) {
    const {progress} = panels[action];
    progress.hidden = !visible;
    if (Number.isFinite(percent)) progress.value = percent;
    else progress.removeAttribute('value');
  }

  function startMemory(action) {
    if (!isLogging('performance')) return;
    if (!window.crossOriginIsolated || typeof performance.measureUserAgentSpecificMemory !== 'function') {
      capture('performance','Общий замер памяти страницы и обработчика недоступен: '
        +'изоляция контекста '+(window.crossOriginIsolated ? 'включена' : 'отключена')+' · API замера '
        +(typeof performance.measureUserAgentSpecificMemory === 'function' ? 'доступен' : 'недоступен')+'.');
      return;
    }

    const run = {action, peak:0, samples:0, timer:null, stage:'Подготовка'};
    memoryRun = run;
    async function sample() {
      try {
        const result = await performance.measureUserAgentSpecificMemory();
        if (memoryRun !== run) return;
        run.samples++;
        run.peak = Math.max(run.peak,result.bytes);
        capture('performance','Память страницы и обработчика · '+memoryMiB(result.bytes)+' МиБ · '+run.stage);
        run.timer = setTimeout(sample,5000);
      } catch (error) {
        if (memoryRun !== run) return;
        capture('performance','Браузер не завершил замер памяти · '+error.name);
      }
    }
    void sample();
  }

  function memoryMiB(bytes) {
    return (bytes/1048576).toLocaleString('ru-RU',{maximumFractionDigits:1});
  }

  function finishMemory() {
    if (!memoryRun) return;
    const {action,peak,samples,timer} = memoryRun;
    memoryRun = null;
    clearTimeout(timer);
    const name = action === 'references' ? 'Справочники' : 'Выгрузки';
    capture('performance',samples
      ? name+' · максимум по замерам памяти: '+memoryMiB(peak)+' МиБ · замеров: '+samples
      : name+' · браузер не успел завершить замер памяти во время операции.');
  }

  function handleMessage({data}) {
    if (data.type === 'diagnostics') {
      capture('diagnostics',data.message);
      return;
    }
    if (data.action === 'reclassification') {
      updateReclassification(data);
      return;
    }
    if (data.type === 'saved' || data.action === 'save') {
      busy = false;
      journalOperation = null;
      saveStatus.textContent = data.type === 'saved' ? 'Сохранено и проверено: '+data.name : data.message;
      saveStatus.toggleAttribute('data-error',data.type !== 'saved');
      capture('import_export',saveStatus.textContent);
      persistJournal();
      controls();
      return;
    }
    if (data.type === 'progress') {
      if (journalOperation) journalOperation.stage = data.message;
      if (memoryRun) memoryRun.stage = data.message;
      if (data.book) showBook(data.book.kind,data.book.percent,data.book.phase);
      if (data.action === 'references' && Number.isFinite(data.percent)) showShelf('active',data.percent);
      setOutcome(data.action,data.message);
      setProgress(data.action,true,data.action === 'references' ? data.percent : undefined);
      capture('import_export',data.message);
      scheduleJournal();
      return;
    }
    if (data.type === 'references') {
      clearReferences();
      for (const item of data.items) {
        if (item.status === 'inactive') {
          badge(inactiveBadges,referenceNames[item.id],item.note,item.badgeState,item.details,item.date ?? null);
          inactiveReferences.hidden = false;
          continue;
        }
        const state = ['ready','warning'].includes(item.status) ? item.status : 'error';
        const detail = {
          ready: '',
          warning: item.indicators?.join(' · ') || (item.ready ? 'Есть предупреждения' : 'Нужно проверить файлы'),
          missing: 'Файл не найден',
          invalid: 'Требуется проверка'
        }[item.status] ?? 'Требуется проверка';
        badge(referenceBadges, referenceNames[item.id] || item.id,
          detail,state,item.details,item.date ?? null);
      }
      return;
    }
    busy = false;
    journalOperation = null;
    finishMemory();
    setProgress(data.action,data.type === 'done',100);
    capture('performance', 'Операция заняла '+Math.round(performance.now()-startedAt)+' мс.');
    if (data.type === 'error') {
      if (data.referencesStale) {
        referencesReady = false;
        clearReferences();
        showShelf('idle');
        setOutcome('references','Обновите справочники.',true);
        setProgress('references',false);
      }
      if (data.action === 'exports') resetScenes();
      else showShelf('idle');
      setOutcome(data.action,data.message,true);
      capture('import_export',data.message);
    } else if (data.action === 'references') {
      referencesReady = true;
      showShelf('done',100);
      setOutcome('references','Справочники готовы.');
      capture('import_export','Справочники готовы.');
    } else {
      exportBadges.replaceChildren();
      for (const [kind,book] of Object.entries(data.books)) {
        showBook(kind,100);
        const period = book.start ? 'Данные с '+formatDate(book.start)+' по '+formatDate(book.end) : 'Даты не распознаны';
        badge(exportBadges,'export_'+kind.toUpperCase()+'.xlsx',
          period+' · '+book.rows.toLocaleString('ru-RU')+' строк', 'ready');
        capture('import_export',kind.toUpperCase()+' · новых '+book.added+' · обновлено '+book.updated);
      }
      if (data.files) showExportFiles(data.files);
      const result = data.unchanged ? 'Обе книги актуальны.'
        : data.files ? 'Обе книги подготовлены к сохранению.' : 'Обе книги обновлены и проверены.';
      setOutcome('exports',result);
      capture('import_export',result);
    }
    persistJournal();
    controls();
  }

  function start(action) {
    activeAction = action;
    journalOperation = {action,stage:'Подготовка'};
    startedAt = performance.now();
    busy = true;
    controls();
    clearExportFiles();
    if (action === 'references') {
      showShelf('active');
      referencesReady = false;
      clearReferences();
      setOutcome('exports','');
      setProgress('exports',false);
    }
    exportBadges.replaceChildren();
    resetScenes();
    setProgress(action,true);
    setOutcome(action,action === 'references' ? 'Подготовка справочников…' : 'Подготовка выгрузок…');
    startMemory(action);
    try {
      if (!worker) {
        const source = JSON.parse(document.getElementById('folders-worker').textContent);
        const url = URL.createObjectURL(new Blob([source],{type:'text/javascript'}));
        try { worker = new Worker(url); }
        finally { URL.revokeObjectURL(url); }
        worker.onmessage = handleMessage;
        worker.onerror = event => {
          finishMemory();
          worker.terminate();
          worker = null;
          busy = referencesReady = false;
          clearReferences();
          showShelf('idle');
          resetScenes();
          const interrupted = 'Фоновая обработка прервана. Обновите справочники и повторите запуск.';
          if (activeAction === 'reclassification') {
            updateReclassification({type:'error',message:interrupted});
          } else if (activeAction === 'save') {
            saveStatus.textContent = interrupted;
            saveStatus.toggleAttribute('data-error',true);
            for (const button of exportFileActions.querySelectorAll('[data-save]')) button.remove();
          } else {
            setProgress(activeAction,false);
            setOutcome(activeAction,interrupted,true);
          }
          capture('runtime',event.message || 'Фоновая обработка прервана.');
          capture('diagnostics','Обработчик остановлен · этап: '+(journalOperation?.stage || 'неизвестен')+'.');
          journalOperation = null;
          persistJournal();
          controls();
        };
      }
      const streamMb = Boolean(importedFiles) || new URLSearchParams(location.hash.slice(1)).get('mb')==='stream';
      capture('import_export',action === 'references' ? 'Запуск обновления справочников.'
        : 'Запуск обновления выгрузок · режим МБ: '+(streamMb?'потоковый':'обычный'));
      persistJournal();
      worker.postMessage({action,root:importedFiles ? null : root,streamMb,imported:Boolean(importedFiles),
        diagnostics:isLogging('diagnostics'),
        files:action === 'references' ? importedFiles : undefined});
    } catch (error) {
      finishMemory();
      busy = false;
      journalOperation = null;
      if (action === 'references') showShelf('idle');
      setProgress(action,false);
      setOutcome(action,error.message,true);
      capture('runtime','Не удалось запустить операцию: '+(error.name || 'Error')+'.');
      persistJournal();
      controls();
    }
  }

  references.addEventListener('click',()=>start('references'));
  exports.addEventListener('click',()=>start('exports'));

  function updateReclassification(data) {
    reclassificationStatus.toggleAttribute('data-error',data.type === 'error');
    if (data.type === 'progress') {
      if (journalOperation) journalOperation.stage = data.message;
      reclassificationStatus.textContent = data.message;
      reclassificationProgress.value = data.percent;
      capture('import_export','Реклассификация · '+data.message,true);
      scheduleJournal();
      return;
    }
    reclassificationProgress.hidden = true;
    busy = false;
    journalOperation = null;
    if (data.type === 'done') {
      reclassificationResult = data;
      downloadReclassification.hidden = false;
      const prepared = data.stats.readyRows ? ' Подготовлено записей ReClass: '+data.stats.readyRows+'.' : '';
      reclassificationStatus.textContent = 'Версия '+data.engineVersion+' · обработано строк: '+data.stats.rows+
        '. Источник: '+data.sourceName+'.'+prepared+' Скачайте диагностический Excel.';
    } else {
      reclassificationStatus.textContent = data.message;
      if (data.code === 'RECLASS_SOURCE_COLUMNS') pickReclassificationSource.hidden = false;
    }
    capture('import_export','Реклассификация · '+reclassificationStatus.textContent,true);
    persistJournal();
    controls();
  }

  function startReclassification(source) {
    if (busy || !referencesReady || !worker) return;
    const dateFrom = reclassificationFrom.value;
    const dateTo = reclassificationTo.value;
    if (dateFrom && dateTo && dateFrom > dateTo) {
      updateReclassification({type:'error',message:'Дата «с» должна быть не позже даты «по».'});
      return;
    }
    busy = true;
    activeAction = 'reclassification';
    journalOperation = {action:activeAction,stage:'Чтение входных данных'};
    reclassificationResult = null;
    pickReclassificationSource.hidden = true;
    downloadReclassification.hidden = true;
    reclassificationProgress.hidden = false;
    updateReclassification({type:'progress',message:'Чтение '+(source?.name || 'export_ITSM.xlsx')+'…',percent:0});
    controls();
    try {
      worker.postMessage({action:activeAction,root:importedFiles ? null : root,
        imported:Boolean(importedFiles),dateFrom,dateTo,source,diagnostics:isLogging('diagnostics')});
    } catch (error) {
      updateReclassification({type:'error',message:error.message});
    }
  }
  runReclassification?.addEventListener('click',()=>startReclassification());
  pickReclassificationSource?.addEventListener('click',()=>reclassificationSource.click());
  reclassificationSource?.addEventListener('change',()=>{
    const source = reclassificationSource.files[0];
    reclassificationSource.value = '';
    if (source) startReclassification(source);
  });
  downloadReclassification?.addEventListener('click',()=>{
    if (!reclassificationResult) return;
    const {bytes,outputName} = reclassificationResult;
    downloadBlob(new Blob([bytes],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}),outputName);
  });

  function downloadBlob(blob, name) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = name;
    link.click();
    setTimeout(()=>URL.revokeObjectURL(url),1000);
  }

  function clearExportFiles() {
    exportFiles.hidden = true;
    exportFileActions.replaceChildren();
    saveStatus.textContent = '';
    saveStatus.removeAttribute('data-error');
  }

  function showExportFiles(files) {
    const addButton = (label,action) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'secondary';
      button.textContent = label;
      button.addEventListener('click',action);
      exportFileActions.append(button);
      return button;
    };
    for (const [kind,file] of Object.entries(files)) {
      if (typeof window.showSaveFilePicker === 'function') {
        addButton('Сохранить '+kind.toUpperCase(),()=>saveExportFile(kind,file.name)).dataset.save = '';
      }
      addButton('Скачать '+kind.toUpperCase(),()=>downloadBlob(file.blob,file.name));
    }
    exportFiles.hidden = false;
  }

  async function saveExportFile(kind, name) {
    activeAction = 'save';
    journalOperation = {action:'save',stage:'Выбор файла для сохранения'};
    busy = true;
    controls();
    try {
      const handle = await window.showSaveFilePicker({suggestedName:name,types:[{
        description:'Книга Excel',accept:{'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':['.xlsx']}
      }]});
      saveStatus.textContent = 'Проверка и сохранение '+name+'…';
      saveStatus.removeAttribute('data-error');
      journalOperation.stage = 'Проверка и запись выбранной книги';
      persistJournal();
      worker.postMessage({action:'save',kind,handle,imported:true,diagnostics:isLogging('diagnostics')});
    } catch (error) {
      busy = false;
      journalOperation = null;
      if (error?.name !== 'AbortError') {
        saveStatus.textContent = 'Прямое сохранение недоступно. Скачайте книгу и перенесите её через Проводник.';
        saveStatus.toggleAttribute('data-error',true);
        capture('diagnostics','Сохранение книги: '+(error?.name || 'Error'));
      }
      persistJournal();
      controls();
    }
  }

  for (const button of pageButtons) {
    button.addEventListener('click', () => {
      const page = button.dataset.page;
      for (const item of pageButtons) {
        const current = item === button;
        document.getElementById(item.dataset.page).hidden = !current;
        if (current) item.setAttribute('aria-current', 'page');
        else item.removeAttribute('aria-current');
      }
      const inRca = page === 'rca-master';
      document.getElementById('main-menu').hidden = inRca;
      document.getElementById('rca-menu').hidden = !inRca;
      if (inRca) document.getElementById('rca-back').focus();
      document.title = 'Reclassifier — ' + button.textContent;
      capture('general', 'Открыта страница «' + button.textContent + '».');
    });
  }

  document.getElementById('rca-back')?.addEventListener('click', async () => {
    if (rca && !rca.canLeave()) {
      const saved = await rca.flushPending();
      if (!saved) return;
      rcaUi?.showSaved(saved);
    }
    const foldersButton = Array.from(pageButtons).find(button => button.dataset.page === 'folders');
    foldersButton.click();
    foldersButton.focus();
  });

  function showStatus(message, error = false) {
    status.textContent = message;
    status.toggleAttribute('data-error', error);
  }

  function resetWorkspace() {
    worker?.terminate();
    worker = null;
    root = null;
    importedFiles = null;
    void rca?.openWorkspace();
    folderArt.removeAttribute('data-connected');
    showShelf('idle');
    referencesReady = false;
    clearReferences();
    exportBadges.replaceChildren();
    clearExportFiles();
    resetScenes();
    for (const action of Object.keys(panels)) {
      setOutcome(action,'');
      setProgress(action,false);
    }
  }

  controls();
  if (!supportsFolderPicker) {
    showStatus('Прямой доступ к папкам недоступен. Нажмите «Выбрать папку для импорта».',true);
  }

  importFolder.addEventListener('click',()=>folderFiles.click());
  folderFiles.addEventListener('change',()=>{
    const selection = inspectFolderImport(folderFiles.files);
    folderFiles.value = '';
    if (!selection) return;
    if (!selection.valid) {
      showStatus('Выберите общую рабочую папку, внутри которой находится Catalogs со справочниками.',true);
      return;
    }
    const {name,files} = selection;
    if ((rca && !rca.canLeave()) || rcaUi?.hasTemporaryChanges()) {
      showStatus('Сначала сохраните изменения RCA или экспортируйте JSON.', true);
      return;
    }
    resetWorkspace();
    root = {name};
    importedFiles = files;
    void rca?.openWorkspace({mode: 'import', files});
    folderArt.setAttribute('data-connected','');
    showStatus('Папка «'+name+'» импортирована для чтения. Для новых входных файлов повторите импорт.');
    capture('import_export','Рабочая папка импортирована для чтения.');
    controls();
  });

  select.addEventListener('click', async () => {
    if ((rca && !rca.canLeave()) || rcaUi?.hasTemporaryChanges()) {
      showStatus('Сначала сохраните изменения RCA или экспортируйте JSON.', true);
      return;
    }
    let offerImport = false;
    busy = true;
    controls();
    try {
      const candidate = await window.showDirectoryPicker({ mode: 'readwrite' });
      const started = performance.now();
      const invalid = await findInvalidWorkspaceFolders(candidate);
      if ((rca && !rca.canLeave()) || rcaUi?.hasTemporaryChanges()) return;
      resetWorkspace();
      capture('performance', 'Проверка папки: ' + Math.round(performance.now() - started) + ' мс.');
      if (invalid.length) {
        showStatus('В выбранной папке должно быть по одной папке: ' + invalid.join(', ') + '.', true);
        capture('import_export', 'Выбранная папка не прошла проверку структуры.');
        return;
      }
      root = candidate;
      void rca?.openWorkspace({mode: 'write', handle: candidate});
      folderArt.setAttribute('data-connected','');
      showStatus('Выбрана папка «' + candidate.name + '».');
      capture('import_export', 'Структура рабочей папки проверена.');
    } catch (error) {
      const name = error?.name || 'Error';
      const message = {
        AbortError: 'Папка не выбрана. Если окно закрылось после выбора, проверьте доступ к этой папке.',
        NotAllowedError: 'Браузер не предоставил доступ к папке на чтение и запись.',
        SecurityError: 'Браузер заблокировал выбор папки. Проверьте, что приложение открыто в отдельной вкладке. На корпоративном ПК уточните ограничения у ИТ-службы.'
      }[name] || 'Не удалось открыть рабочую папку.';
      offerImport = name !== 'AbortError' || !root;
      if (offerImport) showStatus(message+' Можно использовать «Выбрать папку для импорта».', name !== 'AbortError');
      if (name !== 'AbortError') capture('import_export', 'Не удалось открыть рабочую папку.');
      capture('diagnostics', 'Выбор папки завершён с кодом ' + name + '.');
    } finally {
      busy = false;
      controls();
      if (offerImport) importFolder.focus();
    }
  });

  window.addEventListener('error', () => capture('runtime', 'Ошибка выполнения приложения.'));
  window.addEventListener('unhandledrejection', () => capture('runtime', 'Необработанная ошибка операции.'));
})();
