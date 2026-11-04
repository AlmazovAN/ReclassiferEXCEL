// FILE CONTRACT: Database Workspace shared state and health presentation.
// Purpose: own Database route UI state, repository read helpers, bootstrap progress and health status.
// Owns: databaseWorkspaceState plus read-only repository/status helpers.
// Reads: ReclassifierDatabaseRepository and common UI utilities.
// Writes: UI state only; database mutation is delegated to repository/integration commands.
// Public API: internal assembled-script helpers shared by Database UI fragments.
// Must not: access raw SQLite handles or implement Dataset business rules.
// Related tests: test_database_workspace_contract.py, test_database_workspace_synchronization.js,
//                test_database_workspace_final_acceptance.js.
const databaseWorkspaceState = {
 intake: [],
 busy: false,
 lastError: null,
 fileConnection: null,
 saveProgress: null,
 recoveryStatus: null,
 auditDatasetId: 'all',
 auditStatus: 'all',
 auditLimit: 50,
 health: null,
 bootstrap: null,
 commitProgress: null,
 commitCancelRequested: false,
 queuePreparationRunning: false,
 queuePreparationRequested: false,
 queuePreparationGeneration: 0,
 queuePreparationCurrentIndex: null,
 queuePreparationReason: null,
 synchronization: {
   status: 'idle',
   lastAt: null,
   reason: null,
   databaseUuid: null,
   sqliteDatasets: 0,
   runtimeDatasets: 0,
   derivedRebuilt: 0,
   derivedIds: [],
   error: null
 }
 };
 const databaseMemoryDiagnostics = (() => {
 const test18=globalThis.ReclassifierDiagnosticScope?.enabled===true;
 const STORAGE_KEY=test18?globalThis.ReclassifierDiagnosticScope.runtimeKey:
   'reclassifier.database.oom-phases.v1';
 const test12=['TEST_12_PR322','TEST_13_PR322','TEST_14_PR322','TEST_15_PR324','TEST_16_PR326','TEST_17_PR332','TEST_18_PR335'].includes(globalThis.RECLASSIFIER_BUILD?.testLabel);
 const test13=['TEST_13_PR322','TEST_14_PR322','TEST_15_PR324','TEST_16_PR326','TEST_17_PR332','TEST_18_PR335'].includes(globalThis.RECLASSIFIER_BUILD?.testLabel);
 const history=globalThis.ReclassifierDiagnosticHistory;
 const test15=['TEST_15_PR324','TEST_16_PR326','TEST_17_PR332','TEST_18_PR335'].includes(globalThis.RECLASSIFIER_BUILD?.testLabel);
 const test16=['TEST_16_PR326','TEST_17_PR332'].includes(globalThis.RECLASSIFIER_BUILD?.testLabel)||test18;
 const MAX_EVENTS=test18?128:test12?360:80;
 let enabled=test12, retained=null, persisted=false, runSequence=0, importLease=null;
 const starts=new Map();
 const safePhase=value=>String(value||'').toLowerCase().replace(/[^a-z0-9_-]/g,'').slice(0,48);
 function read() {
 try {
   if(typeof localStorage==='undefined') return null;
   const value=JSON.parse(localStorage.getItem(STORAGE_KEY)||'null');
   return value?.schemaVersion===1&&Array.isArray(value.events)?value:null;
 } catch (_) {return null;}
 }
 retained=read();persisted=Boolean(retained);
 if(test13 && retained && !retained.sessionId && history){
 retained.sessionId=history.newSessionId();
 const offset=retained.discardedEvents||0;
 (retained.events||[]).forEach((entry,i)=>
   history.append('runtime',retained.sessionId,offset+i,entry,retained));
 retained.eventCount=offset+(retained.events?.length||0);
 }
 function updateStatus() {
 const node=typeof document!=='undefined'?
   document.getElementById('databaseMemoryDiagStatus'):null;
 if(node) {
   const last=retained?.events?.[retained.events.length-1];
   node.textContent=test16?globalThis.ReclassifierDiagnosticV2?.statusText?.(retained):
     !retained?'Нет сохранённого отчёта.':
     'Статус: '+retained.status+' · последний этап: '+
     (last?last.phase+' / '+last.event:'—')+
     ' · событий в окне: '+retained.events.length+
     (test13?' · IndexedDB: '+history?.status()?.indexedDB+
       ' · WAL: '+history?.status()?.walPending:'')+
     (persisted?'':' · localStorage недоступен');
 }
 if(typeof document==='undefined')return;
 for(const id of ['copyDatabaseMemoryDiagButton','downloadDatabaseMemoryDiagButton']){
   const button=document.getElementById(id);
   if(button)button.disabled=!retained;
 }
 }
 function save() {
 try {
   if(typeof localStorage==='undefined')throw Error('Storage unavailable');
   localStorage.setItem(STORAGE_KEY,JSON.stringify(retained));
   persisted=true;
 } catch (_) {persisted=false;}
 updateStatus();
 }
 function mark(phase,event,numbers={}) {
 if(!enabled||!retained)return;
 if(test15&&retained.finishedAt)begin(0,true);
 const name=safePhase(phase);
 if(!name||!['start','end','error','progress'].includes(event))return;
 if(test18 && name==='runtime-cache' && event==='progress' &&
     Number(numbers.cacheHits)>0) {
   // Hot KPI paths may call Runtime.get('itsm_data') 50k+ times. Those
   // are numeric counters, not 50k independent diagnostic incidents.
   // Never create WAL/IDB writes or a per-hit V2 checkpoint here.
   if(!retained.aggregated)retained.aggregated={
     materializations:0,materializedRecords:0,materializedFullRows:0,
     materializeMs:0,byDataset:{},cacheHits:0,cacheMisses:0,
     distinctHeapSamples:0,maxSampledMainJsHeapMiB:null,
     peakSqliteWasmCapacityMiB:null
   };
   const old=retained.aggregated.cacheHits||0;
   retained.aggregated.cacheHits+=numbers.cacheHits;
   if(Math.floor(old/512)!==Math.floor(retained.aggregated.cacheHits/512))
     save();
   return;
 }
 const time=Date.now();
 const entry={phase:name,event,at:new Date(time).toISOString()};
 if(test12) {
   entry.elapsedMs=Math.max(0,time-(Date.parse(retained.startedAt)||time));
   if(typeof numbers.datasetId==='string' &&
     /^[a-z0-9_-]{1,64}$/.test(numbers.datasetId)) entry.datasetId=numbers.datasetId;
   if(typeof numbers.reason==='string' &&
     /^(list|get|kpi|commit|manual|bootstrap|unknown|derived|ui)$/.test(numbers.reason))
     entry.reason=numbers.reason;
   const key=name+':'+(entry.datasetId||'');
   if(event==='start') starts.set(key,time);
   if(event==='end'||event==='error'){
     const start=starts.get(key);
     if(Number.isFinite(start))entry.durationMs=time-start;
     starts.delete(key);
   }
 }
 const fields=['fileIndex','fileCount','inputBytes','rows','processedRows',
   'sheetCount','batchNumber','batchRows','confirmedBatches','ready'];
 if(test12)fields.push('fullDatasetRows','fullDatasetColumns','cachedRows',
   'cacheHits','cacheMisses','runtimeGetCalls','workerGeneration',
   'activeJobs','pendingRequests','sourceRows','recordCount','fromCache');
 for(const key of fields){
   if(Number.isSafeInteger(numbers[key])&&numbers[key]>=0)entry[key]=numbers[key];
 }
 const memory=typeof performance!=='undefined'?performance.memory:null;
 if(Number.isFinite(memory?.usedJSHeapSize)){
   entry.mainJsHeapMiB=Math.round(memory.usedJSHeapSize/1048576*100)/100;
   retained.memoryMetric='sampled-main-thread-js-heap-only';
 }
 if(test12){
   const db=globalThis.ReclassifierDatabaseRepository?.getDiagnosticMemorySnapshot?.();
   if(Number.isFinite(db?.databaseInputMiB))entry.databaseInputMiB=db.databaseInputMiB;
   if(Number.isFinite(db?.sqliteWasmCapacityMiB))
     entry.sqliteWasmCapacityMiB=db.sqliteWasmCapacityMiB;
   const ag=retained.aggregated||(retained.aggregated={
     materializations:0,materializedRecords:0,materializedFullRows:0,
     materializeMs:0,byDataset:{},cacheHits:0,cacheMisses:0,
     distinctHeapSamples:0,maxSampledMainJsHeapMiB:null,
     peakSqliteWasmCapacityMiB:null
   });
   if(name==='runtime-sqlite-materialize'&&event==='end'){
     ag.materializations++;ag.materializedRecords+=entry.rows||0;
     ag.materializedFullRows+=entry.fullDatasetRows||0;
     ag.materializeMs+=entry.durationMs||0;
     const dataset=entry.datasetId||'unknown';
     const item=ag.byDataset[dataset]||
       (ag.byDataset[dataset]={calls:0,rows:0,fullRows:0,durationMs:0});
     item.calls++;item.rows+=entry.rows||0;
     item.fullRows+=entry.fullDatasetRows||0;
     item.durationMs+=entry.durationMs||0;
   }
   if(Number.isFinite(entry.cacheHits))ag.cacheHits+=entry.cacheHits;
   if(Number.isFinite(entry.cacheMisses))ag.cacheMisses+=entry.cacheMisses;
   if(Number.isFinite(entry.sqliteWasmCapacityMiB)){
     ag.peakSqliteWasmCapacityMiB=Math.max(ag.peakSqliteWasmCapacityMiB||0,
       entry.sqliteWasmCapacityMiB);
   }
   if(Number.isFinite(entry.mainJsHeapMiB)){
     ag.maxSampledMainJsHeapMiB=Math.max(ag.maxSampledMainJsHeapMiB||0,
       entry.mainJsHeapMiB);
     if(retained.__lastHeapSample!==entry.mainJsHeapMiB)ag.distinctHeapSamples++;
     retained.__lastHeapSample=entry.mainJsHeapMiB;
   }
 }
 if(test13 && history && retained.sessionId) {
   const seq=retained.eventCount++;
   history.append('runtime',retained.sessionId,seq,entry,retained);
 }
 retained.events.push(entry);
 if(retained.events.length>MAX_EVENTS){
   retained.events.splice(0,retained.events.length-MAX_EVENTS);
   retained.discardedEvents=(retained.discardedEvents||0)+1;
 }
 if(event==='start')retained.lastStarted=name;
 if(event==='end')retained.lastCompleted=name;
 if(Number.isSafeInteger(entry.confirmedBatches))
   retained.confirmedBatches=entry.confirmedBatches;
 if(test16&&retained.eventCount%64!==0)updateStatus();
 else save();
 }
 function begin(fileCount=0,observation=false){
 if(!enabled)return;
 if(test15&&!observation&&Number(fileCount)>0)
   importLease=globalThis.ReclassifierHeavyJobGate?.begin('import')??null;
 starts.clear();
 retained={
   schemaVersion:1,run:++runSequence,status:observation?'observing':'running',
   ...(test12?{testLabel:globalThis.RECLASSIFIER_BUILD?.testLabel,
     journalKind:'runtime-import-kpi'}:{}),
   ...(test13&&history?{sessionId:history.newSessionId(),eventCount:0}:{}),
   startedAt:new Date().toISOString(),fileCount:Number(fileCount)||0,
   lastStarted:null,lastCompleted:null,confirmedBatches:0,
   memoryMetric:'unavailable',events:[]
 };
 save();
 if(!observation)mark('queue-upload','start',{fileCount:Number(fileCount)||0});
 }
 function finish(status){
 if(!enabled||!retained)return;
 if(!['prepared','failed','cancelled'].includes(status))return;
 retained.status=status;
 retained.finishedAt=new Date().toISOString();
 save();
 if(test13&&history&&retained.sessionId&&retained.eventCount) {
   history.append('runtime',retained.sessionId,retained.eventCount-1,
     retained.events[retained.events.length-1],retained);
 }
 if(importLease!==null){
   globalThis.ReclassifierHeavyJobGate?.end(importLease);
   importLease=null;
 }
 if(test16)void globalThis.ReclassifierDiagnosticV2?.refreshArchive?.();
 }
 function setEnabled(value){enabled=test12||value===true;updateStatus();}
 function report(){
 if(!retained)return null;
 const {__lastHeapSample,...safe}=retained;
 return JSON.stringify({...safe,storagePersisted:persisted,
   browser:typeof navigator!=='undefined'?navigator.userAgent:'unavailable'},null,2);
 }
 function downloadReport(){
 if(test13&&history&&retained?.sessionId)
   return history.download('runtime',retained,
     'Reclassifer_Runtime_Diagnostic_'+globalThis.RECLASSIFIER_BUILD?.testLabel+'_'+
     new Date().toISOString().replace(/[:.]/g,'-')+'.json');
 const value=report();
 if(!value||typeof document==='undefined'||
   typeof Blob==='undefined'||typeof URL==='undefined')return false;
 let url=null;
 try{
   url=URL.createObjectURL(new Blob([value],{type:'application/json;charset=utf-8'}));
   const a=document.createElement('a');
   a.href=url;a.download='Reclassifer_Runtime_Diagnostic_TEST_12_PR322_'+
     new Date().toISOString().replace(/[:.]/g,'-')+'.json';
   a.style.display='none';document.body.appendChild(a);a.click();a.remove();
   return true;
 }catch(_){return false;}
 finally{if(url)setTimeout(()=>URL.revokeObjectURL(url),10000);}
 }
 async function copy(){
 const value=test13&&history&&retained?.sessionId
   ? JSON.stringify(await history.collect('runtime',retained),null,2)
   : report();
 if(!value)return;
 try{
   if(!globalThis.navigator?.clipboard?.writeText)throw Error('No clipboard');
   await globalThis.navigator.clipboard.writeText(value);
   alert('Диагностический отчёт скопирован.');
 }catch(_){
   const field=document.createElement('textarea');
   field.value=value;field.style.position='fixed';field.style.left='-9999px';
   document.body.appendChild(field);field.select();
   let ok=false;try{ok=document.execCommand('copy');}catch(_){}
   field.remove();
   if(ok)alert('Диагностический отчёт скопирован.');
   else window.prompt('Скопируйте диагностический отчёт:',value);
 }
 }
 if(test15)begin(0,true);
 else if(test12&&(!retained||retained.testLabel!==globalThis.RECLASSIFIER_BUILD?.testLabel))begin(0);
 return Object.freeze({
 isEnabled:()=>enabled,setEnabled,begin,mark,finish,report,copy,downloadReport,
 status:updateStatus,snapshot:()=>retained,isPersisted:()=>persisted
 });
 })();
 globalThis.ReclassifierDatabaseMemoryDiagnostics = databaseMemoryDiagnostics;
 if(['TEST_16_PR326','TEST_17_PR332'].includes(globalThis.RECLASSIFIER_BUILD?.testLabel)) {
 globalThis.ReclassifierDiagnosticV2?.subscribe?.(()=>databaseMemoryDiagnostics.status());
 Promise.resolve().then(()=>globalThis.ReclassifierDiagnosticV2?.refreshArchive?.())
   .then(()=>databaseMemoryDiagnostics.status());
 }
 function getDatabaseRepository() {
 const repository = globalThis.ReclassifierDatabaseRepository;
 if (!repository) throw new Error('SQLite Database Core недоступен в этой сборке.');
 return repository;
 }
 function databaseCurrentInfo() {
 try {
   return getDatabaseRepository().getDatabaseInfo();
 } catch (_) {
   return null;
 }
 }
 if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
 window.addEventListener('beforeunload', event => {
   if (!databaseWorkspaceState.busy && !databaseCurrentInfo()?.dirty) return;
   event.preventDefault();
   event.returnValue = '';
 });
 }
 function databaseCurrentDatasets() {
 try {
   return getDatabaseRepository().listDatasets();
 } catch (_) {
   return [];
 }
 }
 function databaseCurrentHistory(limit = 1000, datasetId = null) {
 try {
   return getDatabaseRepository().getImportHistory(datasetId, limit);
 } catch (_) {
   return [];
 }
 }
 function databaseCurrentImportOverview() {
 try {
   return getDatabaseRepository().getImportOverview();
 } catch (_) {
   return {
     attempts: 0,
     committed: 0,
     failed: 0,
     latestCommittedAt: null,
     latestFailedAt: null,
     latestAttempt: null,
     latestAttemptByDataset: [],
     latestCommittedByDataset: []
   };
 }
 }
 function databaseFormatTimestamp(value) {
 if (!value) return '—';
 const parsed = new Date(value);
 return Number.isNaN(parsed.getTime()) ? String(value) : parsed.toLocaleString('ru-RU');
 }
 function databaseFreshnessLabel(row) {
 const from = String(row?.freshness_from || '').trim();
 const to = String(row?.freshness_to || '').trim();
 if (from && to && from !== to) return from + ' → ' + to;
 return to || from || '—';
 }
 function databaseStatusBadge(info) {
 if (!info) return '<span class="status-badge">Не подключена</span>';
 if (!info.valid) return '<span class="status-badge warning">Ошибка</span>';
 if (info.dirty) return '<span class="status-badge warning">Изменения только в браузере — сохраните БД</span>';
 if (info.storage?.diskCurrent) {
   return '<span class="status-badge loaded">Сохранено в подключённый файл</span>';
 }
 return '<span class="status-badge loaded">Подключена</span>';
 }
 function databaseStorageGuidance(info, linked, autoSaveEnabled = false) {
 if (!info) {
   return Object.freeze({
     title: 'База данных не открыта',
     description: 'Откройте Reclassifier.db, чтобы работать с накопленными данными.',
     action: 'open'
   });
 }
 if (!info.valid) {
   return Object.freeze({
     title: 'Требуется проверка базы',
     description: 'Проверка состояния SQLite обнаружила проблему. Не сохраняйте изменения до выяснения причины.',
     action: 'check'
   });
 }
 const connected = Boolean(linked && linked.databaseUuid === info.databaseUuid);
 if (info.dirty) {
   return Object.freeze({
     title: 'Есть изменения, не сохранённые в исходный файл',
     description: connected
       ? ('Изменения находятся в рабочей SQLite браузера. ' +
          (autoSaveEnabled
            ? 'Автосохранение включено, но запись на диск пока не подтверждена. '
            : '') +
          'Сохраните в подключённую БД и дождитесь проверки записи.')
       : ('Изменения находятся в рабочей SQLite браузера. ' +
          'Прямая запись в исходный файл недоступна: скачайте отдельную .db ' +
          'и убедитесь, что файл появился на диске.'),
     action: connected ? 'save' : 'download'
   });
 }
 if (info.storage?.diskCurrent) {
   return Object.freeze({
     title: 'Изменения сохранены в подключённый файл',
     description: 'Последняя запись подтверждена обратной побайтовой проверкой. Можно продолжать работу с данными.',
     action: 'none'
   });
 }
 return Object.freeze({
   title: 'База открыта, новых изменений нет',
   description: 'Рабочая SQLite не менялась после открытия. Можно загружать Excel или просматривать данные.',
   action: 'none'
 });
 }
 function databaseWorkingStorageText(info) {
 const revision = info?.storage?.workingRevision;
 const label = Number.isSafeInteger(revision) ? String(revision) : '—';
 return 'Ревизия сессии ' + label + (info?.dirty
   ? ' · изменения применены в SQLite браузера, исходный файл не обновлён'
   : ' · новых изменений после открытия/сохранения нет');
 }
 function databaseFileSaveText(info, linked) {
 if (!linked || linked.databaseUuid !== info?.databaseUuid) {
   return 'Прямая запись недоступна; можно скачать отдельную копию';
 }
 const storage = info?.storage;
 if (Number.isSafeInteger(storage?.confirmedFileRevision) && storage?.confirmedFileAt) {
   return 'Подтверждена ревизия ' + storage.confirmedFileRevision +
     ' · ' + databaseFormatTimestamp(storage.confirmedFileAt) +
     (info.dirty ? ' · есть более новые изменения в браузере' : '');
 }
 return 'Подключено; запись в этой сессии ещё не подтверждалась';
 }
 function databaseDownloadCopyText(info) {
 const storage = info?.storage;
 if (!Number.isSafeInteger(storage?.downloadRequestedRevision)) {
   return 'Скачивание не запрашивалось';
 }
 return 'Запрошена ревизия ' + storage.downloadRequestedRevision +
   ' · ' + databaseFormatTimestamp(storage.downloadRequestedAt) +
   ' · сохранение браузером на диск не проверено';
 }
 function databaseNextPaint() {
 return new Promise(resolve => {
   let settled = false;
   const finish = () => {
     if (settled) return;
     settled = true;
     clearTimeout(fallback);
     resolve();
   };
   const fallback = setTimeout(finish, 100);
   if (typeof requestAnimationFrame === 'function' &&
       (typeof document === 'undefined' || !document.hidden)) {
     try {
       requestAnimationFrame(() => setTimeout(finish, 0));
     } catch (_) {
     }
   } else {
     setTimeout(finish, 0);
   }
 });
 }
 function databaseBootstrapText(progress = databaseWorkspaceState.bootstrap) {
 if (!progress) return '';
 if (progress.phase === 'initializing') {
   return 'Инициализация SQLite WASM и создание DB Schema…';
 }
 if (progress.phase === 'preparing') {
   return 'Подготовка встроенных Dataset HTML к переносу…';
 }
 if (progress.phase === 'complete') {
   return 'Готово: ' + progress.completedDatasets + ' Dataset · ' +
     progress.totalRows.toLocaleString('ru-RU') + ' строк · ' +
     Math.round(progress.durationMs / 100) / 10 + ' с.';
 }
 const totalRows = Number(progress.totalRows || 0);
 const copiedRows = Number(progress.copiedRows || 0);
 const percent = totalRows > 0 ? Math.min(100, Math.round(copiedRows * 100 / totalRows)) : 0;
 return 'Перенос в SQLite: ' + (progress.title || progress.datasetId || 'Dataset') +
   ' · ' + copiedRows.toLocaleString('ru-RU') + ' / ' +
   totalRows.toLocaleString('ru-RU') + ' строк · ' + percent + '%.';
 }
 function databaseUpdateBootstrapProgress(progress) {
 databaseWorkspaceState.bootstrap = progress;
 const node = document.getElementById('databaseBootstrapProgressText');
 if (node) node.textContent = databaseBootstrapText(progress);
 const bar = document.getElementById('databaseBootstrapProgressBar');
 if (bar) {
   const total = Number(progress?.totalRows || 0);
   const copied = Number(progress?.copiedRows || 0);
   bar.value = total > 0 ? Math.min(total, copied) : 0;
   bar.max = Math.max(1, total);
 }
 }
 function databaseBootstrapMarkup() {
 const progress = databaseWorkspaceState.bootstrap;
 if (!progress) return '';
 const complete = progress.phase === 'complete';
 return '<div class="database-bootstrap-progress ' + (complete ? 'success' : 'pending') + '">' +
   '<strong>' + (complete ? 'База развёрнута' : 'Развёртывание базы…') + '</strong>' +
   '<span id="databaseBootstrapProgressText">' + escapeHtml(databaseBootstrapText(progress)) + '</span>' +
   (complete ? '' :
     '<progress id="databaseBootstrapProgressBar" max="' + escapeHtml(Math.max(1, Number(progress.totalRows || 1))) +
     '" value="' + escapeHtml(Math.max(0, Number(progress.copiedRows || 0))) + '"></progress>') +
   '</div>';
 }
 function databaseResetSynchronizationState() {
 databaseWorkspaceState.synchronization = {
   status: 'idle',
   lastAt: null,
   reason: null,
   databaseUuid: null,
   sqliteDatasets: 0,
   runtimeDatasets: 0,
   derivedRebuilt: 0,
   derivedIds: [],
   error: null
 };
 }
 function databaseSynchronizeWorkspace(reason = 'manual', options = {}) {
 const checkHealth = options.checkHealth !== false;
 const render = options.render === true;
 const runtime = globalThis.ReclassifierRuntimeDataRepository;
 const stateModel = globalThis.ReclassifierDatasetDbStateModel;
 const infoBefore = databaseCurrentInfo();
 try {
   runtime?.invalidate?.(
     Array.isArray(options.changedDatasetIds) ? options.changedDatasetIds : null
   );
   let health = databaseWorkspaceState.health;
   if (infoBefore && checkHealth) {
     databaseWorkspaceState.health = null;
     health = databaseRunHealthCheck({ render: false });
     if (!health?.ok) {
       throw new Error(
         'Синхронизация остановлена: проверка целостности Reclassifier.db не пройдена.'
       );
     }
   }
   const rebuiltDerived = options.refreshDerived !== false &&
     infoBefore && runtime?.refreshDerived
     ? runtime.refreshDerived(
         Array.isArray(options.changedDatasetIds) ? options.changedDatasetIds : null,
         options.derivedCandidates || null
       )
     : [];
   const snapshot = stateModel?.snapshot
     ? stateModel.snapshot(databaseWorkspaceState.intake)
     : null;
   const sqliteRows = Array.from(snapshot?.datasets || [])
     .filter(row => row.active?.sqliteDb);
   const runtimeRows = Array.from(snapshot?.datasets || [])
     .filter(row => row.active?.activeRuntime);
   const mismatches = infoBefore
     ? Array.from(snapshot?.datasets || []).filter(row => {
         const sqliteActive = Boolean(row.active?.sqliteDb);
         const runtimeSqlite = Boolean(
           row.active?.activeRuntime && row.active?.runtimeSource === 'sqlite'
         );
         return sqliteActive !== runtimeSqlite;
       })
     : [];
   if (mismatches.length) {
     throw new Error(
       'Runtime не синхронизирован с SQLite для Dataset: ' +
       mismatches.map(row => row.id).join(', ') + '.'
     );
   }
   const synchronizedAt = new Date().toISOString();
   databaseWorkspaceState.synchronization = {
     status: 'ready',
     lastAt: synchronizedAt,
     reason,
     databaseUuid: snapshot?.database?.databaseUuid || infoBefore?.databaseUuid || null,
     sqliteDatasets: sqliteRows.length,
     runtimeDatasets: runtimeRows.length,
     derivedRebuilt: rebuiltDerived.length,
     derivedIds: rebuiltDerived.map(item => item.id),
     error: null
   };
   for (const item of databaseWorkspaceState.intake) {
     if (item?.integrationStatus !== 'committed') continue;
     delete item.synchronizationError;
     item.synchronizedAt = synchronizedAt;
   }
   log(
     'Синхронизация Database Workspace: ' + reason +
     '; SQLite Dataset ' + sqliteRows.length +
     '; active Runtime ' + runtimeRows.length +
     (rebuiltDerived.length
       ? '; пересчитаны derived: ' + rebuiltDerived.map(item => item.id).join(', ')
       : '') + '.'
   );
   if (reason !== 'manual') globalThis.ReclassifierHeaderIndicators?.invalidateKpi?.();
   const kpiSourceChanged = [
     'database-opened','database-created','database-closed',
     'integration-committed','equipment-batch-committed',
     'recalculation-committed'
   ].includes(reason);
   if (kpiSourceChanged) {
     globalThis.ReclassifierKpiAutoRefresh?.request?.(
       reason, Array.isArray(options.changedDatasetIds) ? options.changedDatasetIds : null
     );
   }
   globalThis.ReclassifierHeaderIndicators?.refreshDatabase?.();
   if (render && state.route === 'database') renderDatabaseWorkspace();
   return Object.freeze({ ok: true, snapshot, health });
 } catch (error) {
   const message = error?.message || String(error);
   databaseWorkspaceState.synchronization = {
     status: 'error',
     lastAt: new Date().toISOString(),
     reason,
     databaseUuid: infoBefore?.databaseUuid || null,
     sqliteDatasets: 0,
     runtimeDatasets: 0,
     derivedRebuilt: 0,
     derivedIds: [],
     error: message
   };
   databaseWorkspaceState.lastError = message;
   log('Ошибка синхронизации Database Workspace: ' + message, 'ERROR');
   if (render && state.route === 'database') renderDatabaseWorkspace();
   return Object.freeze({ ok: false, snapshot: null, health: null, error: message });
 }
 }
 function databaseSynchronizationText() {
 const sync = databaseWorkspaceState.synchronization;
 if (!sync || sync.status === 'idle') return 'Ещё не выполнялась';
 const when = databaseFormatTimestamp(sync.lastAt);
 if (sync.status === 'error') return 'Ошибка · ' + when;
 return 'OK · ' + when +
   ' · SQLite ' + Number(sync.sqliteDatasets || 0).toLocaleString('ru-RU') +
   ' · Runtime ' + Number(sync.runtimeDatasets || 0).toLocaleString('ru-RU');
 }
 function databaseRunHealthCheck({ render = true } = {}) {
 const info = databaseCurrentInfo();
 if (!info) {
   databaseWorkspaceState.health = null;
   if (render && state.route === 'database') renderDatabaseWorkspace();
   return null;
 }
 try {
   databaseWorkspaceState.health = getDatabaseRepository().runHealthCheck();
   databaseWorkspaceState.lastError = databaseWorkspaceState.health.ok
     ? null
     : databaseWorkspaceState.health.errors.join(' ');
   log(
     'Проверка БД: ' + (databaseWorkspaceState.health.ok ? 'OK' : 'FAILED') +
     '; ' + databaseWorkspaceState.health.durationMs + ' мс; ' +
     formatBytes(databaseWorkspaceState.health.estimatedBytes || 0) + '.',
     databaseWorkspaceState.health.ok ? 'INFO' : 'ERROR'
   );
   return databaseWorkspaceState.health;
 } catch (error) {
   databaseWorkspaceState.health = {
     ok: false,
     checkedAt: new Date().toISOString(),
     durationMs: 0,
     estimatedBytes: null,
     journalMode: null,
     quickCheck: { ok: false, messages: [] },
     foreignKeyViolations: [],
     registryMismatches: [],
     missingRegistryDatasets: [],
     errors: [error?.message || String(error)],
     warnings: []
   };
   databaseWorkspaceState.lastError = databaseWorkspaceState.health.errors[0];
   log('Проверка БД: ' + databaseWorkspaceState.lastError, 'ERROR');
   return databaseWorkspaceState.health;
 } finally {
   if (render && state.route === 'database') renderDatabaseWorkspace();
 }
 }
 function databaseHealthMarkup(info) {
 if (!info) {
   return '<div class="database-health empty"><strong>Проверка недоступна</strong><span>Сначала откройте Reclassifier.db.</span></div>';
 }
 const health = databaseWorkspaceState.health;
 if (!health) {
   return '<div class="database-health pending"><strong>Целостность ещё не проверена</strong><span>Запустите проверку перед переносом или архивированием базы.</span></div>';
 }
 const badge = health.ok
   ? '<span class="status-badge loaded">OK</span>'
   : '<span class="status-badge warning">FAILED</span>';
 const details = [
   'quick_check: ' + (health.quickCheck?.ok ? 'ok' : 'ошибка'),
   'foreign keys: ' + (health.foreignKeyViolations?.length || 0),
   'registry mismatch: ' + (health.registryMismatches?.length || 0),
   'journal: ' + (health.journalMode || '—'),
   'размер: ' + (health.estimatedBytes == null ? '—' : formatBytes(health.estimatedBytes)),
   'время: ' + (health.durationMs ?? '—') + ' мс'
 ].join(' · ');
 const issues = [
   ...(health.errors || []).map(item => '<li>' + escapeHtml(item) + '</li>'),
   ...(health.warnings || []).map(item => '<li>' + escapeHtml(item) + '</li>')
 ].join('');
 const datasetStorage = Array.from(health.datasetStorage || []);
 const jsonBytes = datasetStorage.reduce((sum, row) => sum + Number(row.json_bytes || 0), 0);
 const storageTable = datasetStorage.length
   ? '<details><summary>Размер несжатых данных по Dataset · ' +
       escapeHtml(formatBytes(jsonBytes)) + '</summary>' +
       '<p class="small">HTML хранит стартовые данные в сжатых пакетах. SQLite хранит JSON-строки без gzip; ' +
       'размер файла также включает страницы и индексы.</p>' +
       '<div class="table-scroll"><table class="reference-table">' +
         '<thead><tr><th>Dataset</th><th>Строк</th><th>JSON без сжатия</th></tr></thead><tbody>' +
         datasetStorage.map(row => '<tr><td><code>' + escapeHtml(row.dataset_id) + '</code></td>' +
           '<td>' + escapeHtml(Number(row.rows || 0).toLocaleString('ru-RU')) + '</td>' +
           '<td>' + escapeHtml(formatBytes(Number(row.json_bytes || 0))) + '</td></tr>').join('') +
         '</tbody></table></div></details>'
   : '';
 return '<div class="database-health ' + (health.ok ? 'success' : 'invalid') + '">' +
   '<div class="database-health-head"><strong>Переносимость и целостность</strong>' + badge + '</div>' +
   '<span>' + escapeHtml(details) + '</span>' +
   '<span>Проверено: ' + escapeHtml(databaseFormatTimestamp(health.checkedAt)) + '</span>' +
   (issues ? '<ul>' + issues + '</ul>' : '') +
   storageTable +
   '</div>';
 }
