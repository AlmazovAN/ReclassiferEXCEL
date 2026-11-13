const engine = ReclassifierDirectoryEngine;
const writer = ReclassifierSafeExcelWriter;
const processor = ReclassifierFolderExportProcessor;
let prepared = null;
let preparedRoot = null;
let running = false;
let importedRoot = null;
let importedBooks = null;
let fileReads = null;
const observedBlobs = new WeakSet();

// Keep native Blob instances for the ZIP reader, including the slices it reuses in output books.
function observeImportedBlob(blob, group) {
  if (observedBlobs.has(blob)) return blob;
  const read = blob.arrayBuffer.bind(blob);
  const stream = blob.stream.bind(blob);
  const slice = blob.slice.bind(blob);
  Object.defineProperties(blob,{
    arrayBuffer:{value:()=>{
      if (fileReads) fileReads[group].buffers++;
      return read();
    }},
    stream:{value:()=>{
      if (fileReads) fileReads[group].streams++;
      return stream();
    }},
    slice:{value:(...args)=>{
      const part = slice(...args);
      return fileReads ? observeImportedBlob(part,group) : part;
    }}
  });
  observedBlobs.add(blob);
  return blob;
}

async function refreshReferences(root, progress, publish) {
  engine.release(prepared);
  prepared = null;
  preparedRoot = null;
  const scan = await engine.scan(await engine.enumerate(root,'catalogs'),progress,{exportOnly:true,showInactive:true});
  publish([...scan.statuses].map(([id,item])=>({id,status:item.status,ready:item.files?.length===1,details:item.details,indicators:item.indicators,date:item.date,note:item.note,badgeState:item.badgeState})));
  if (!scan.exportReferences) {
    engine.release(scan);
    throw new Error('Комплект справочников не готов. Проверьте плашки справочников.');
  }
  prepared = scan;
  preparedRoot = root;
  return {};
}

async function workSources(scan) {
  const sources = {itsm:[],mb:[]};
  for (const [kind, entries] of [['itsm',scan.work.itsm],['mb',scan.work.mobileBrigade]]) {
    for (const entry of entries) {
      const {sha256,createdAt} = scan.files.get(entry.path);
      if (!/\.xlsx$/i.test(entry.file.name) || !sha256) throw new Error(entry.path + ': требуется проверенный XLSX.');
      sources[kind].push({file:entry.file,path:entry.path,sha256,createdAt});
    }
  }
  return sources;
}

function summarize(plan) {
  return Object.fromEntries(Object.entries(plan.summary).map(([kind, item])=>[kind,{
    rows:item.rows, added:item.added, updated:item.updated, start:item.start, end:item.end,
    missingDate:item.missingDate
  }]));
}

async function refreshExports(root, progress, streamMb, imported, diagnose) {
  if (!prepared || !await root.isSameEntry(preparedRoot)) throw new Error('Сначала обновите справочники.');
  // A file-input snapshot cannot tell whether Excel has since removed its lock file.
  // Imported exports only prepare new books; direct writes still check the live directory.
  if (!imported) {
    progress('Проверка, закрыты ли итоговые книги в Excel');
    await assertExcelExportsClosed(root);
  }
  let id;
  let storage;
  let scan;
  try {
    if (imported) {
      importedOutputBytes = 0;
      diagnose('Импорт: сжатый буфер временных строк, запросов к OPFS нет.');
    } else {
      progress('Открытие временного хранилища браузера (OPFS)');
      const storageRoot = await navigator.storage.getDirectory();
      storage = await storageRoot.getDirectoryHandle('reclassifier-folders',{create:true});
      await recoverPair(root,storage,progress);
      id = crypto.randomUUID();
      workingDirectory = await storage.getDirectoryHandle(id,{create:true});
    }
    progress('Чтение и проверка входных файлов');
    const inputs = [
      ...await engine.enumerate(root,'itsm'),
      ...await engine.enumerate(root,'mb')
    ];
    diagnose('Входных файлов в ITSM и MB: '+inputs.length+'.');
    scan = await engine.scan(inputs,progress,{exportOnly:true,preparedReferences:prepared});
    // Imported files are selection snapshots. The processor checks supplemental bytes
    // against their scan hash and uses the already prepared reference data.
    if (!imported) await engine.verifyExportSources(root,scan);
    const referenceHash = await hashBlob(new Blob([JSON.stringify(engine.exportReferenceHashes(scan))]));
    progress('Проверка накопленных книг ITSM и МБ');
    const current = await writer.inspectFolderExports(root,{requireWrite:!imported});
    diagnose('Накопленные книги · '+bookSizes(current)+'.');
    const plan = await processor.process({
      current, sources:await workSources(scan), references:scan.exportReferences,
      referenceHash, asOf:new Date().toISOString(), disableMbStreaming:!streamMb
    },event=>progress(event.label,undefined,event.book));
    if (plan.books) {
      diagnose('Подготовленные книги · '+bookSizes(Object.fromEntries(Object.entries(plan.books).map(([kind,book])=>[kind,book.blob])))+'.');
    }
    if (plan.status === 'conflicts') {
      for (const item of Object.values(plan.summary)) {
        for (const group of item.conflicts) {
          progress(group.sources.map(source=>source.path+' / '+source.sheet+' ['+(source.stamp||'дата неизвестна')+']')
            .join(' ↔ ')+' · различий '+group.count);
        }
      }
      throw new Error('Нужен ручной приоритет. Проверьте источники или выполните обновление через .py с --manual-priority.');
    }
    if (!imported) await engine.verifyExportSources(root,scan);
    if (plan.status === 'unchanged') {
      if (!imported) await writer.verifyFolderExports(root,plan.hashes);
    } else if (imported) {
      importedBooks = Object.fromEntries(Object.entries(plan.books).map(([kind,book])=>[kind,{
        ...book, name:'export_'+kind.toUpperCase()+'.xlsx', before:plan.hashes[kind]
      }]));
    } else await writePair(root,storage,id,plan,progress);
    return {books:summarize(plan),unchanged:plan.status==='unchanged',
      files:importedBooks && Object.fromEntries(Object.entries(importedBooks).map(([kind,book])=>[kind,{name:book.name,blob:book.blob}]))};
  } catch (error) {
    if (error.code === 'DIRECTORY_SCAN_STALE') {
      engine.release(prepared);
      prepared = null;
      preparedRoot = null;
      throw Object.assign(new Error(error.message.replace('Выполните «Обновить».','Обновите справочники и повторите запуск.')),
        {referencesStale:true});
    }
    throw error;
  } finally {
    engine.release(scan);
    workingDirectory = null;
    importedOutputBytes = null;
    stagedRowBytes = 0;
    if (id && !await getFile(root,PENDING).catch(()=>true)) {
      await storage.removeEntry(id,{recursive:true}).catch(()=>{});
    }
  }
}

function bookSizes(books) {
  return Object.entries(books).map(([kind,blob])=>kind.toUpperCase()+': '+
    (blob ? (blob.size/1048576).toFixed(1)+' МиБ' : 'нет книги')).join(' · ');
}

self.onmessage = async ({data}) => {
  const {action,root,streamMb,files,imported,kind,handle,diagnostics} = data;
  if (running) return;
  running = true;
  let stage = 'Подготовка операции';
  const diagnose = message => {
    if (diagnostics) self.postMessage({type:'diagnostics',message});
  };
  fileReads = diagnostics && imported && action !== 'save'
    ? Object.fromEntries(['CATALOGS','ITSM','MB'].map(group=>[group,{buffers:0,streams:0}]))
    : null;
  const progress = (message, percent, book) => {
    stage = message;
    self.postMessage({type:'progress',action,message,percent,book});
  };
  try {
    if (action === 'save') {
      stage = 'Проверка и запись выбранной книги';
      const book = importedBooks?.[kind];
      if (!book) throw new Error('Сначала подготовьте выгрузки.');
      await navigator.locks.request('reclassifier-folders',()=>saveImportedBook(handle,book));
      self.postMessage({type:'saved',name:book.name});
      return;
    }
    if (action === 'reclassification') {
      const workspace = imported ? importedRoot : root;
      const result = await navigator.locks.request('reclassifier-folders',async ()=>{
        if (!workspace) throw new Error('Сначала подключите или импортируйте рабочую папку.');
        const pendingBook = imported ? importedBooks?.itsm : null;
        const source = data.source ?? (pendingBook ? new File([pendingBook.blob],pendingBook.name)
          : await (await writer.exportTargets(workspace,['itsm'])).itsm.handle?.getFile());
        const run = input => runFolderReclassification({
          root:workspace, source:input, prepared, preparedRoot, progress,
          dateFrom:data.dateFrom, dateTo:data.dateTo,
          enumerateCatalogs:folder=>engine.enumerate(folder,'catalogs'),
          async readClassifier(file) {
            const workbook = await readFolderWorkbook(file,XLSX);
            const normalized = normalizeFailureClassifierWorkbook(workbook);
            return {...normalized,meta:{...normalized.meta,fileName:file.name}};
          },
          engine:resolveActiveFolderReclassificationEngine()
        });
        if (source) {
          try {
            return await run(source);
          } catch (error) {
            if (error.code !== 'RECLASS_SOURCE_COLUMNS' || data.source) throw error;
            progress('В '+source.name+' нет всех исходных полей. Поиск исходной выгрузки в подпапке ITSM.',0);
          }
        }
        const candidates = await engine.enumerate(workspace,'itsm');
        if (candidates.length === 1) {
          const {file} = candidates[0];
          progress('Используется исходная книга ITSM: '+file.name,0);
          return run(file);
        }
        const message = candidates.length
          ? 'В подпапке ITSM найдено несколько книг. Нажмите «Выбрать исходную выгрузку ITSM» и укажите книгу за нужный период.'
          : 'В подпапке ITSM нет исходной выгрузки. Нажмите «Выбрать исходную выгрузку ITSM» и укажите исходный Excel с описанием, примечаниями и датой выполнения.';
        throw Object.assign(new Error(message),{code:'RECLASS_SOURCE_COLUMNS'});
      });
      self.postMessage({type:'done',action,...result}, [result.bytes]);
      return;
    }
    importedBooks = null;
    const operation = action === 'references' ? 'Справочники' : 'Выгрузки';
    diagnose(operation+' · режим файлового доступа: '+(imported ? 'импорт снимков' : 'прямой доступ к папке')+'.');
    if (action === 'references') importedRoot = imported ? createImportedDirectory(files,{pendingFile:PENDING,observeFile:observeImportedBlob}) : null;
    const workspace = imported ? importedRoot : root;
    const execute = () => action === 'references'
      ? refreshReferences(workspace,progress,items=>self.postMessage({type:'references',items}))
      : refreshExports(workspace,progress,streamMb===true,imported,diagnose);
    const result = await navigator.locks.request('reclassifier-folders',execute);
    self.postMessage({type:'done',action,...result});
  } catch (error) {
    const errorName = error.cause?.name || error.name || 'Error';
    diagnose('Сбой · '+errorName+' · этап: '+stage);
    const message = action === 'save' && ['NoModificationAllowedError','NotReadableError','NotAllowedError'].includes(errorName)
      ? 'Браузер или Windows не разрешили запись. Закройте итоговую книгу в Excel и повторите сохранение. ('+errorName+')'
      : errorName === 'SecurityError'
      ? 'Браузер ограничил доступ. Этап: '+stage+' · '+errorName
      : error.message;
    self.postMessage({type:'error',action,message,code:error.code,referencesStale:error.referencesStale===true});
  } finally {
    if (fileReads) {
      const counts = Object.entries(fileReads).map(([group,{buffers,streams}])=>
        group+': буферы '+buffers+', потоки '+streams);
      diagnose('Вызовы чтения импортированных файлов · '+counts.join(' · ')+'.');
    }
    fileReads = null;
    running = false;
  }
};
