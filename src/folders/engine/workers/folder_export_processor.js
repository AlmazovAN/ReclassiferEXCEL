(() => {
  'use strict';

  const LEGACY_FORMAT='Reclassifier/folder-exports/1';
  const FORMAT='Reclassifier/folder-exports/2';
  const EXPORT_RULES_VERSION='3';
  const MAX_CHUNK_ROWS=16000;
  const CHUNK_ROWS=globalThis.ReclassifierLocalExportLimits?.chunkRows??MAX_CHUNK_ROWS;
  const FLAT_SHEETS=globalThis.ReclassifierLocalExportLimits?.flatSheets===true;
  const MAX_DATA_ROWS=1048575;
  const MAX_INPUT=192*1048576;
  const MAX_HISTORY=globalThis.ReclassifierLocalExportLimits?.maxBytes??MAX_INPUT;
  const EXCEL_TEXT_LIMIT=32767;
  const SHA=/^[a-f0-9]{64}$/;
  const UNKNOWN_VERSION={value:'',basis:''};
  const normalize=value=>String(value??'').trim().replace(/\s+/g,' ').toLocaleLowerCase('ru-RU');
  const equal=(left,right)=>left===right || (left instanceof Date && right instanceof Date &&
    left.getTime()===right.getTime());
  const locale=(a,b)=>a<b?-1:a>b?1:0;
  const utf8=new TextEncoder();

  function requireThat(condition,message) {
    if(!condition) throw new Error(message);
  }

  // Для каждого типа задаём правила заголовков, ключ строки и способ получения даты.
  function contracts() {
    const itsm=globalThis.ReclassifierItsmWorkerProcessor;
    const mb=globalThis.ReclassifierMobileBrigadeWorkerProcessor;
    const mbRules=globalThis.ReclassifierMobileBrigadeRules;
    return {
      itsm:{name:'ITSM',api:itsm,day:(row,pos)=>itsm.dateValue(row[pos.created]),
        identity:(row,pos)=>({primary:normalize(row[pos.number]),alias:''})},
      mb:{name:'МБ',api:mb,day:(row,pos)=>mb.dateValue(row[pos.get('фактическая дата')]),
        identity:(row,pos)=>{
          const site=normalize(row[pos.get('участок')]);
          const taskNumber=normalize(row[pos.get('номер задачи')]);
          const requestUrl=row[pos.get('ссылка на заявку')];
          const alias=mbRules.extractTaskForShiftId(requestUrl);
          const primary=site&&taskNumber?mbRules.mobileBrigadeRecordKey({site,taskNumber}):'';
          return {primary,alias};
        }}
    };
  }

  function dateKey(value) {
    if(!(value instanceof Date)||!Number.isFinite(value.getTime())) return '';
    const part=value=>String(value).padStart(2,'0');
    return value.getFullYear()+'-'+part(value.getMonth()+1)+'-'+part(value.getDate());
  }

  // Период в имени МБ и время создания книги — разные признаки. Период используем только после проверки дат.
  function mbPeriod(name) {
    const match=String(name).match(/^tasks_(20\d{2}-\d{2}-\d{2})_(20\d{2}-\d{2}-\d{2})(?=[\s_.(]|$)/i);
    if(!match) return null;
    const [,start,end]=match;
    const validDay=value=>{
      const parsed=new Date(value+'T00:00:00Z');
      return Number.isFinite(parsed.getTime())&&parsed.toISOString().slice(0,10)===value;
    };
    return validDay(start)&&validDay(end)&&start<=end?{start,end}:null;
  }

  function sourceVersion(kind,{file:{name},createdAt}) {
    if(kind==='mb'){
      const period=mbPeriod(name);
      if(!period||typeof createdAt!=='string') return UNKNOWN_VERSION;
      const date=new Date(createdAt);
      if(!Number.isFinite(date.getTime())) return UNKNOWN_VERSION;
      const {end}=period;
      const stamp=date.toISOString();
      return stamp.slice(0,10)>=end?{value:stamp,basis:'создание книги XLSX'}:UNKNOWN_VERSION;
    }
    const match=String(name).match(/(?:^|_)(\d{2})_(\d{2})_(20\d{2})_(\d{1,2})_(\d{2})(?=[_. (]|$)/);
    if(match){
      const [,day,month,year,hour,minute]=match;
      const date=new Date(+year,+month-1,+day,+hour,+minute);
      if(dateKey(date)===year+'-'+month+'-'+day&&date.getHours()===+hour&&date.getMinutes()===+minute){
        return {value:year+'-'+month+'-'+day+'T'+hour.padStart(2,'0')+':'+minute,basis:'время в имени файла'};
      }
    }
    if(typeof createdAt!=='string') return UNKNOWN_VERSION;
    const date=new Date(createdAt);
    const day=dateKey(date);
    if(!day) return UNKNOWN_VERSION;
    const clock=[date.getHours(),date.getMinutes()].map(value=>String(value).padStart(2,'0')).join(':');
    return {value:day+'T'+clock,basis:'создание книги XLSX'};
  }


  function columnKey(header,kind) {
    const key=normalize(header);
    if(kind==='itsm'){
      if(['дата создания','дата создания обращения','дата регистрации'].includes(key)) return 'дата создания вызова';
      if(['номер обращения','номер заявки'].includes(key)) return 'номер';
    }
    if(key==='территория mes') return 'территории mes';
    if(['примечание к закрытию','примечания к закрытию'].includes(key)) return 'примечания к разрешению';
    return key;
  }

  function excelText(value) {
    const last=value.charCodeAt(EXCEL_TEXT_LIMIT-1);
    return value.slice(0,last>=0xd800&&last<=0xdbff?EXCEL_TEXT_LIMIT-1:EXCEL_TEXT_LIMIT);
  }

  function normalizeDates(dataset,row,positions) {
    if(dataset.kind!=='itsm') return;
    for(const column of [positions.created,positions.completed,positions.closed]){
      if(column>=0&&row[column]!=null) row[column]=dataset.spec.api.dateValue(row[column])??row[column];
    }
  }

  function newDataset(kind,spec,priorities) {
    return {kind,spec,priorities,columns:[],columnIds:new Map(),origins:[],rows:new Map(),
      numberCollisions:{count:0,examples:[]},seen:new Set(),conflicts:new Map(),coverage:[],generation:null,dependency:null,
      retainedVersions:new Map(),periodUpdates:new Map(),changed:false,added:0,updated:new Set(),duplicates:0,dateMissing:0};
  }

  function columnIds(dataset,header) {
    return header.map(name=>{
      const key=columnKey(name,dataset.kind);
      if(!dataset.columnIds.has(key)){
        dataset.columnIds.set(key,dataset.columns.length);
        dataset.columns.push(name);
      }
      return dataset.columnIds.get(key);
    });
  }

  // Сначала учитываем ручной приоритет, затем подтверждённые версии. Ноль означает, что порядок пока не установлен.
  function order(dataset,left,right) {
    if(left===right) return 0;
    const a=dataset.origins[left],b=dataset.origins[right];
    if(a.sha256===b.sha256) return 0;
    const rankA=dataset.priorities[a.sha256],rankB=dataset.priorities[b.sha256];
    if(Number.isSafeInteger(rankA)&&Number.isSafeInteger(rankB)) return Math.sign(rankA-rankB);
    if(a.stamp&&b.stamp) return locale(a.stamp,b.stamp);
    if(a.sha256===dataset.supplementSha) return 1;
    if(b.sha256===dataset.supplementSha) return -1;
    return 0;
  }

  // A confirmed incoming MB extract may supersede saved fields from an
  // undated historical extract only when their named periods are disjoint.
  function historicalMbOrder(dataset,left,right) {
    if(dataset.kind!=='mb'||(left<dataset.restoredOrigins)===(right<dataset.restoredOrigins)) return 0;
    const oldIndex=Math.min(left,right),newIndex=Math.max(left,right);
    const old=dataset.origins[oldIndex],fresh=dataset.origins[newIndex];
    if(old.sha256===fresh.sha256||old.stamp||!fresh.stamp||fresh.stampBasis!=='создание книги XLSX') return 0;
    const oldPeriod=mbPeriod(old.path.split('/').at(-1));
    const newPeriod=mbPeriod(fresh.path.split('/').at(-1));
    if(!oldPeriod||!newPeriod||oldPeriod.end>=newPeriod.start) return 0;
    const pair=oldIndex+'/'+newIndex;
    let item=dataset.periodUpdates.get(pair);
    if(!item){
      item={old:old.path,fresh:fresh.path,oldEnd:oldPeriod.end,newStart:newPeriod.start,count:0};
      dataset.periodUpdates.set(pair,item);
    }
    item.count++;
    return left===newIndex?1:-1;
  }

  function noteConflict(dataset,key,column,left,right) {
    const from=dataset.origins[left],to=dataset.origins[right];
    const pair=[from.sha256,to.sha256].sort().join('/');
    let conflict=dataset.conflicts.get(pair);
    if(!conflict){
      conflict={count:0,sources:[from,to].map(({sha256,path,sheet,stamp})=>({sha256,path,sheet,stamp})),examples:[]};
      dataset.conflicts.set(pair,conflict);
    }
    conflict.count++;
    if(conflict.examples.length<4) conflict.examples.push({key,column});
  }

  function recordKey(kind,primary,alias) {
    if(kind!=='mb') return primary;
    return alias?'mbid|'+alias:primary?'mbnum|'+primary:'';
  }

  // A resaved source can have a new SHA-256 while claiming the same snapshot.
  // With no version order, keep saved field values and still import missing keys.
  function retainSnapshotField(dataset,before,origin,column) {
    const saved=dataset.origins[before],incoming=dataset.origins[origin];
    if(dataset.restoredOrigins===undefined||before>=dataset.restoredOrigins||origin<dataset.restoredOrigins||
      saved.sha256===incoming.sha256||!saved.stamp||saved.stamp!==incoming.stamp||
      saved.path!==incoming.path||saved.sheet!==incoming.sheet) return false;
    const pair=before+'/'+origin;
    let item=dataset.retainedVersions.get(pair);
    if(!item){
      item={saved:saved.sha256,incoming:incoming.sha256,path:incoming.path,sheet:incoming.sheet,
        stamp:incoming.stamp,count:0,columns:new Map()};
      dataset.retainedVersions.set(pair,item);
    }
    item.count++;
    const name=dataset.columns[column];
    item.columns.set(name,(item.columns.get(name)||0)+1);
    return true;
  }

  // Сливаем данные по полям. Для каждого поля храним источник значения.
  // Так в одной строке могут остаться данные из разных выгрузок, если их колонки различаются.
  function mergeField(dataset,row,column,incoming,origin,sourceRow) {
    if(!(column in row.values)){
      row.values[column]=incoming;
      if(origin!==row.origin) (row.fields??=new Map()).set(column,[origin,sourceRow]);
      dataset.changed=true;
      if(origin!==row.origin&&!row.isNew) dataset.updated.add(row);
      return;
    }
    const before=row.fields?.get(column)?.[0]??row.origin;
    const identical=equal(incoming,row.values[column]);
    const priority=order(dataset,origin,before)||(!identical?historicalMbOrder(dataset,origin,before):0);
    if(!priority&&!identical&&retainSnapshotField(dataset,before,origin,column)) return;
    if(!priority&&!identical){
      noteConflict(dataset,row.key,dataset.columns[column],before,origin);
    } else if(priority>0){
      if(!identical&&!row.isNew) dataset.updated.add(row);
      row.values[column]=incoming;
      (row.fields??=new Map()).set(column,[origin,sourceRow]);
      dataset.changed=true;
    }
  }

  function addRow(dataset,identity,key,values,origin,sourceRow) {
    const {primary,alias}=identity;
    requireThat(key,'Строка '+sourceRow+' без подтверждённого ключа.');
    let row=dataset.rows.get(key);
    if(row?.primary && primary && row.primary!==primary) {
      throw new Error('ID МБ '+alias+' соответствует разным задачам или участкам: '+row.primary+' / '+primary+'.');
    }
    if(!row){
      row={primary,alias,key,values:[],origin,sourceRow,fields:null,isNew:true};
      dataset.rows.set(key,row);
      dataset.added++;
      dataset.changed=true;
    } else if(primary&&!row.primary){
      row.primary=primary;
      dataset.changed=true;
    }
    const columns=dataset.origins[origin].columns;
    for(let i=0;i<columns.length;i++){
      mergeField(dataset,row,columns[i],values[i]??null,origin,sourceRow);
    }
  }

  // Связываем строки МБ без ID с записью по участку и номеру, когда есть ровно один подходящий ID.
  function reconcileMbNumbers(dataset) {
    const byNumber=new Map();
    for(const row of dataset.rows.values()){
      if(!row.alias||!row.primary) continue;
      const group=byNumber.get(row.primary);
      if(!group) byNumber.set(row.primary,row);
      else if(Array.isArray(group)) group.push(row.alias);
      else byNumber.set(row.primary,[group.alias,row.alias]);
    }
    const linkColumn=dataset.columnIds.get('ссылка на заявку');
    for(const [number,match] of byNumber){
      const fallbackKey=recordKey(dataset.kind,number,'');
      const withoutId=dataset.rows.get(fallbackKey);
      if(Array.isArray(match)){
        if(withoutId){
          const source=dataset.origins[withoutId.origin];
          throw new Error(source.path+' / '+source.sheet+', строка '+withoutId.sourceRow+
            ': задача без ID соответствует нескольким записям МБ '+number+
            ' (ID '+match.slice(0,8).join(', ')+').');
        }
        dataset.numberCollisions.count++;
        if(dataset.numberCollisions.examples.length<8){
          dataset.numberCollisions.examples.push({number,ids:match.slice(0,8),count:match.length});
        }
      } else if(withoutId) {
        if(withoutId.thin||match.thin) throw new StreamUnsupported('объединение ключей исторических строк');
        withoutId.values.forEach((value,column)=>{
          // An empty or invalid link cannot replace the known task ID.
          if(column===linkColumn) return;
          const [origin,sourceRow]=withoutId.fields?.get(column)??[withoutId.origin,withoutId.sourceRow];
          mergeField(dataset,match,column,value,origin,sourceRow);
        });
        dataset.rows.delete(fallbackKey);
        dataset.updated.delete(withoutId);
        if(withoutId.isNew) dataset.added--;
        else if(match.isNew){
          match.isNew=false;
          dataset.added--;
          dataset.updated.add(match);
        }
        dataset.changed=true;
      }
    }
  }

  function sheetRows(sheet,options={}) {
    return globalThis.XLSX.utils.sheet_to_json(sheet,{header:1,raw:true,defval:null,blankrows:true,...options});
  }

  function parseBook(bytes,opts={}) {
    return globalThis.XLSX.read(bytes,{type:'array',dense:true,cellDates:true,cellFormula:false,cellHTML:false,...opts});
  }

  function headers(dataset,header) {
    const derived=new Set(dataset.spec.api.folderColumns.map(name=>columnKey(name,dataset.kind)));
    const fields=[],indices=[],seen=new Set();
    header.forEach((value,i)=>{
      if(value==null||String(value).trim()==='') return;
      const name=String(value).trim();
      const key=columnKey(name,dataset.kind);
      requireThat(!seen.has(key),'Повтор заголовка «'+name+'».');
      seen.add(key);
      if(!derived.has(key)){fields.push(name);indices.push(i);}
    });
    return {fields,indices};
  }

  function rangeForHeader(sheet,limit) {
    const range=globalThis.XLSX.utils.decode_range(sheet['!ref']);
    return {...range,e:{...range.e,r:Math.min(range.e.r,range.s.r+limit-1)}};
  }

  function updateCoverage(coverage,day) {
    coverage.rows++;
    if(day){
      if(!coverage.start||day<coverage.start) coverage.start=day;
      if(!coverage.end||day>coverage.end) coverage.end=day;
    }else coverage.missingDate++;
  }

  async function fingerprint(bytes) {
    const hashBytes=globalThis.ReclassifierLocalExportLimits?.hashBytes;
    if(hashBytes) return hashBytes(bytes);
    const digest=await globalThis.crypto.subtle.digest('SHA-256',bytes);
    return Array.from(new Uint8Array(digest),x=>x.toString(16).padStart(2,'0')).join('');
  }

  async function readBytes(file,limit=MAX_INPUT) {
    requireThat(file?.size>0&&file.size<=limit,'Размер XLSX вне диапазона 1 байт–'+limit/1048576+' МиБ: '+file?.name+'.');
    return new Uint8Array(await file.arrayBuffer());
  }

  // Добавочная книга читается по SHA-256. При восстановлении уже учтённый файл может вернуть недостающие строки.
  async function ingest(dataset,source,progress,profileOnly=false,collectIdentity=null) {
    const replay=dataset.seen.has(source.sha256)&&dataset.recoverMissing>0;
    if(dataset.seen.has(source.sha256)&&!replay){
      dataset.duplicates++;
      progress('Уже учтён · '+source.path);
      return;
    }
    progress('Чтение '+source.path);
    const bytes=await readBytes(source.file,MAX_HISTORY);
    requireThat(await fingerprint(bytes)===source.sha256,'Файл изменён после «Обновить»: '+source.path+'.');
    const book=parseBook(bytes);
    const addedBefore=dataset.added;
    let accepted=0;
    const seenMbKeys=new Set();
    for(const name of book.SheetNames){
      const sheet=book.Sheets[name];
      if(!sheet?.['!ref']) continue;
      const range=rangeForHeader(sheet,dataset.kind==='itsm'?100:25);
      const rows=sheetRows(sheet,{range});
      const headerRow=rows.findIndex(row=>dataset.spec.api.folderHeader(row));
      if(headerRow<0) continue;
      const header=rows[headerRow];
      const {fields,indices}=headers(dataset,header);
      const positions=dataset.spec.api.folderHeader(header);
      const origin=dataset.origins.length;
      const {value:stamp,basis:stampBasis}=sourceVersion(dataset.kind,source);
      if(!profileOnly&&!collectIdentity) {
        dataset.origins.push({sha256:source.sha256,path:source.path,sheet:name,stamp,stampBasis,columns:columnIds(dataset,fields)});
      }
      const coverage={sha256:source.sha256,path:source.path,sheet:name,stamp,stampBasis,start:'',end:'',rows:0,missingDate:0,sites:[]};
      const sites=new Map();
      const bounds=globalThis.XLSX.utils.decode_range(sheet['!ref']);
      for(let start=range.s.r+headerRow+1;start<=bounds.e.r;start+=1500){
        const batch=sheetRows(sheet,{range:{s:{r:start,c:range.s.c},e:{r:Math.min(start+1499,bounds.e.r),c:bounds.e.c}}});
        for(let j=0;j<batch.length;j++){
          const row=batch[j];
          if(!row.some(value=>value!==null&&value!=='')) continue;
          const day=dateKey(dataset.spec.day(row,positions));
          updateCoverage(coverage,day);
          if(dataset.kind==='mb'){
            const site=String(row[positions.get('участок')]??'').trim()||'Участок не указан';
            const siteKey=normalize(site);
            if(!sites.has(siteKey)) sites.set(siteKey,{site,start:'',end:'',rows:0,missingDate:0});
            updateCoverage(sites.get(siteKey),day);
          }
          if(!profileOnly) {
            const keyColumn=dataset.kind==='itsm'?positions.number:positions.get('номер задачи');
            if(Number.isFinite(row[keyColumn])){
              const r=start+j,c=range.s.c+keyColumn;
              const original=sheet['!data']?.[r]?.[c]||sheet[globalThis.XLSX.utils.encode_cell({r,c})];
              const shown=String(original?.w||'');
              row[keyColumn]=/^0\d+$/.test(shown)?shown:String(row[keyColumn]);
            }
            normalizeDates(dataset,row,positions);
            const identity=dataset.spec.identity(row,positions);
            const key=recordKey(dataset.kind,identity.primary,identity.alias);
            if(dataset.kind==='mb'&&key){
              if(seenMbKeys.has(key)){
                coverage.ignoredDuplicates=(coverage.ignoredDuplicates||0)+1;
                continue;
              }
              seenMbKeys.add(key);
            }
            if(collectIdentity){
              requireThat(key,'Строка '+(start+j+1)+' без подтверждённого ключа.');
              collectIdentity(key,identity);
            }else if(!replay||dataset.rows.get(key)?.isNew!==false){
              addRow(dataset,identity,key,indices.map(i=>row[i]),origin,start+j+1);
            }
          }
        }
      }
      coverage.sites=[...sites.values()];
      if(!replay) dataset.coverage.push(coverage);
      accepted+=coverage.rows;
      progress('Прочитан лист '+name+' · '+coverage.rows+' строк'+
        (coverage.start?' · даты '+coverage.start+' — '+coverage.end:' · даты не распознаны'));
      delete book.Sheets[name];
    }
    requireThat(accepted>0,'В файле нет распознанных строк '+dataset.spec.name+'.');
    if(replay) progress('Повторное чтение учтённого XLSX · '+source.path+
      ' · восстановлено отсутствующих записей '+(dataset.added-addedBefore));
    dataset.seen.add(source.sha256);
    dataset.changed=true;
  }

  async function collectRows(rows){
    const result=[];
    for await(const row of rows) result.push(row);
    return result;
  }

  function parseMeta(rows) {
    const format=rows.shift()?.[0]?.toString().trim();
    const version=/^Reclassifier\/folder-exports\/(\d{1,8})$/.exec(format)?.[1];
    requireThat(format===FORMAT||format===LEGACY_FORMAT,version
      ? 'Неподдерживаемая версия накопительной книги: '+version+' (поддерживаются 1 и 2).'
      : 'В ячейке _Meta!A1 нет метки формата накопительной книги Reclassifier.');
    return {format,meta:JSON.parse(rows.map(row=>row[0]).join(''))};
  }

  // Читаем основу из ключевой книги. Видимый лист даёт значения, _Index даёт ключи и происхождение,
  // а _Meta связывает части книги, SHA-256 учтённых выгрузок и идентификатор сохранения пары.
  class StreamUnsupported extends Error {}

  async function* restoreRows(dataset,file,progress,options) {
    if(!file) return;
    requireThat(file.size>0&&file.size<=MAX_HISTORY,'Размер накопленной XLSX вне допустимого диапазона.');
    progress('Чтение накопленной книги '+file.name);
    const local=globalThis.ReclassifierLocalExportLimits;
    const archive=await globalThis.ReclassifierFolderExportXlsx.open(file);
    const worksheetIds=await archive.worksheetIds();
    const metaId=worksheetIds.get('_Meta');
    requireThat(metaId,'В накопительной книге нет служебного листа _Meta.');
    if(options.stream&&archive.sharedSize>24*1048576) throw new StreamUnsupported('большая таблица общих строк');
    if(!options.skipHash){
      progress('Проверка ZIP и отпечатка · '+file.name+' · '+Math.round(file.size/1e6)+' Мб');
      options.hash=local?.hashBlob?await local.hashBlob(file):await fingerprint(await file.arrayBuffer());
    }
    progress('Чтение _Meta · '+file.name);
    const context=local?.streamArchive?await archive.excelContext(progress):null;
    let metaRows;
    if(context) metaRows=await collectRows(archive.rows(metaId,1,context));
    else {
      const book=parseBook(await archive.select([metaId]),{sheets:['_Meta']});
      requireThat(book.Sheets._Meta,'Книга имеет зарезервированное имя, но не создана Reclassifier.');
      metaRows=sheetRows(book.Sheets._Meta);
    }
    const {format,meta}=parseMeta(metaRows);
    progress('Метаданные прочитаны · '+file.name);
    const legacy=format===LEGACY_FORMAT;
    const {kind,columns,origins,seen,parts,generation,dependency,coverage,priorities,pairSeen,partCrcs,flat}=meta;
    requireThat(kind===dataset.kind && Array.isArray(columns)&&columns.length>0&&
      columns.every(c=>typeof c==='string')&&new Set(columns.map(c=>columnKey(c,kind))).size===columns.length &&
      Array.isArray(origins)&&origins.every(o=>SHA.test(o.sha256)&&Array.isArray(o.columns)&&
        o.columns.every(i=>Number.isInteger(i)&&i>=0&&i<columns.length)) &&
      Array.isArray(seen)&&seen.every(x=>SHA.test(x))&&Array.isArray(parts)&&parts.length>0&&
      typeof generation==='string'&&generation&&typeof dependency==='string'&&Array.isArray(coverage)&&
      ['itsm','mb'].every(k=>Array.isArray(pairSeen?.[k])&&pairSeen[k].every(hash=>SHA.test(hash)))&&
      seen.every(hash=>pairSeen[kind].includes(hash))&&Array.isArray(partCrcs),
    'Повреждён служебный индекс '+file.name+'.');
    requireThat(partCrcs.length===(flat?parts.length+1:parts.length*2)&&archive.sheetCount===partCrcs.length+1,
      'Состав листов не совпадает со служебным индексом '+file.name+'.');
    requireThat(partCrcs.every(crc=>/^[a-f0-9]{8}$/.test(crc)),'Некорректные контрольные суммы '+file.name+'.');
    const expectedNames=flat?[sheetName(dataset,0),...parts.map((_,i)=>indexName(i))]:
      parts.flatMap((_,i)=>[sheetName(dataset,i),indexName(i)]);
    requireThat(expectedNames.every(name=>worksheetIds.has(name)),'Не найдены подтверждённые листы '+file.name+'.');
    const mismatch=partCrcs.findIndex((crc,i)=>archive.crc(worksheetIds.get(expectedNames[i]))!==crc);
    // Если контрольные суммы изменились, доступный режим восстановления сверяет видимые строки с индексом по ключам.
    if(options.stream&&(!flat||legacy||mismatch>=0)){
      throw new StreamUnsupported(mismatch>=0?'ключевая книга изменена в Excel':'старый формат накопленной книги');
    }
    const recover=mismatch>=0&&flat&&context&&local.repairExports;
    requireThat(mismatch<0||recover,'Контрольная сумма листа № '+(mismatch+1)+
      ' не совпадает со служебным индексом '+file.name+'.');
    requireThat(parts.every((p,i)=>p.data===sheetName(dataset,flat?0:i)&&p.index===indexName(i)&&
      Number.isInteger(p.rows)&&p.rows>0&&p.rows<=MAX_CHUNK_ROWS&&
      (p.indexWidth===undefined||Number.isInteger(p.indexWidth)&&p.indexWidth>6&&p.indexWidth<=16384)),'Некорректные части накопленной книги.');
    Object.assign(dataset,{columns,origins,seen:new Set(seen),generation,dependency,coverage,pairSeen,
      columnIds:new Map(columns.map((c,i)=>[columnKey(c,kind),i]))});
    for(const [sha,rank] of Object.entries(priorities||{})){
      if(SHA.test(sha)&&Number.isSafeInteger(rank)&&!Object.hasOwn(dataset.priorities,sha)) dataset.priorities[sha]=rank;
    }
    await options.onMeta?.();
    const pos=dataset.spec.api.folderHeader(columns);
    requireThat(pos,'Накопленная книга потеряла обязательные колонки.');
    const flatRows=flat?archive.rows(worksheetIds.get(expectedNames[0]),columns.length,context):null;
    if(flatRows) progress('Чтение основного листа · '+file.name);
    let flatHeader=null;
    let recoveredRows=null,recoverMissing=0,editedOverflow=0;
    const recoveredIndex=recover?new Set():null;
    const rowKeys=options.skipHash?new Set():dataset.rows;
    try {
      if(flatRows) flatHeader=(await flatRows.next()).value;
      if(recover){
        progress(dataset.spec.name+' · контрольная сумма изменилась, сверяем видимый лист со служебным индексом');
        requireThat(columns.every((column,i)=>flatHeader?.[i]===column),
          'Изменились заголовки исходных колонок '+dataset.spec.name+'.');
        recoveredRows=new Map();
        for await(const row of flatRows){
          if(row.every(value=>value==null||value==='')) continue;
          const {primary,alias}=dataset.spec.identity(row,pos);
          const key=recordKey(kind,primary,alias);
          requireThat(key&&!recoveredRows.has(key),'Пустой или повторный ключ '+dataset.spec.name+': '+key);
          recoveredRows.set(key,row);
          if(recoveredRows.size%25000===0) progress(dataset.spec.name+' · проверено строк '+recoveredRows.size);
        }
        requireThat(recoveredRows.size>0,'В накопленной книге отсутствуют строки '+dataset.spec.name+'.');
      }
      for(const [partNumber,part] of parts.entries()){
        if(globalThis.ReclassifierLocalExportLimits) {
          progress('Чтение '+file.name+' · часть '+(partNumber+1)+'/'+parts.length);
        }
        let data=null,index;
        const indexId=worksheetIds.get(part.index);
        const dataId=worksheetIds.get(part.data);
        if(context){
          index=await collectRows(archive.rows(indexId,part.indexWidth??6,context));
          if(!flat) data=await collectRows(archive.rows(dataId,columns.length,context));
        }else{
          const projected=await archive.select(flat?[indexId]:[dataId,indexId]);
          const book=parseBook(projected,{sheets:flat?[part.index]:[part.data,part.index]});
          requireThat((flat||book.Sheets[part.data])&&book.Sheets[part.index]&&
            book.SheetNames.length===expectedNames.length+1&&expectedNames.every(n=>book.SheetNames.includes(n)),
          'Не найдены подтверждённые листы '+file.name+'.');
          data=flat?null:sheetRows(book.Sheets[part.data]);
          index=sheetRows(book.Sheets[part.index]);
        }
        const header=flat?flatHeader:data.shift();
        index.shift();
        requireThat((flat||data.length===part.rows)&&index.length===part.rows&&
          columns.every((column,i)=>header?.[i]===column),'Данные и индекс книги не совпадают.');
        for(let i=0;i<part.rows;i++){
          const [storedKey,storedAlias,origin,sourceRow,overrides,storedPrimary]=index[i];
          if(recover){
            requireThat(typeof storedKey==='string'&&storedKey&&!recoveredIndex.has(storedKey)&&
              (legacy||storedKey===recordKey(kind,storedPrimary,storedAlias))&&
              dataset.origins[origin]&&Number.isInteger(sourceRow)&&sourceRow>0,
            'Некорректный ключ или источник в служебном индексе '+dataset.spec.name+': '+storedKey);
            recoveredIndex.add(storedKey);
          }
          const rowValues=recover?recoveredRows.get(storedKey):flat?(await flatRows.next()).value:data[i];
          if(recover&&!rowValues){
            recoverMissing++;
            continue;
          }
          if(recover) recoveredRows.delete(storedKey);
          requireThat(rowValues,'В накопленной книге меньше строк, чем в индексе.');
          // Восстанавливаем полный длинный текст, если видимый фрагмент соответствует сохранённому значению.
          if(part.indexWidth&&index[i][6]!=null){
            const chunks=index[i].slice(6);
            requireThat(chunks.every(chunk=>typeof chunk==='string'&&chunk.length>0),
              'Повреждены фрагменты полного текста накопленной книги.');
            const entries=JSON.parse(chunks.join(''));
            const used=new Set();
            requireThat(Array.isArray(entries)&&entries.length>0,'Повреждён индекс полного текста.');
            for(const [column,value] of entries){
              requireThat(Number.isInteger(column)&&column>=0&&column<columns.length&&!used.has(column)&&
                typeof value==='string'&&value.length>EXCEL_TEXT_LIMIT,'Некорректный полный текст в индексе.');
              used.add(column);
              if(rowValues[column]===excelText(value)) rowValues[column]=value;
              else {
                requireThat(recover,'Текст на листе не совпадает с индексом.');
                editedOverflow++;
              }
            }
          }
          normalizeDates(dataset,rowValues,pos);
          const identity=dataset.spec.identity(rowValues,pos);
          const alias=storedAlias||'';
          const primary=legacy?identity.primary:(storedPrimary||'');
          const key=recordKey(dataset.kind,primary,alias);
          const expected=legacy&&primary?primary:key;
          requireThat(key&&storedKey===expected&&typeof primary==='string'&&
            (!alias||(dataset.kind==='mb'&&typeof alias==='string'&&/^\d+$/.test(alias)))&&
            (!identity.alias||identity.alias===alias)&&
            (alias||primary===identity.primary)&&!rowKeys.has(key)&&
            dataset.origins[origin]&&Number.isInteger(sourceRow)&&sourceRow>0,
          'Повреждён ключ накопленной книги: '+storedKey+'.');
          const row={primary,alias,key,origin,sourceRow,values:[],fields:null,isNew:false};
          for(const column of dataset.origins[origin].columns) row.values[column]=rowValues[column]??null;
          if(overrides){
            requireThat(typeof overrides==='string','Некорректное происхождение полей.');
            const items=JSON.parse(overrides);
            requireThat(Array.isArray(items)&&items.every(([c,o,r])=>
              Number.isInteger(c)&&dataset.origins[o]?.columns.includes(c)&&Number.isInteger(r)&&r>0),
            'Некорректное происхождение полей.');
            row.fields=new Map(items.map(([c,o,r])=>[c,[o,r]]));
            for(const [column] of row.fields) row.values[column]=rowValues[column]??null;
          }
          for(let c=0;c<columns.length;c++){
            requireThat(rowValues[c]==null||(recover&&rowValues[c]==='')||c in row.values,
              'Обнаружено значение вне индекса строки '+key+'.');
          }
          if(options.skipHash) rowKeys.add(key);
          yield row;
        }
      }
      if(flatRows&&!recover) requireThat((await flatRows.next()).done,'В накопленной книге больше строк, чем в индексе.');
    } finally {
      if(flatRows) await flatRows.return();
    }
    if(recover){
      requireThat(!recoveredRows.size,'Найдены ключи, которых нет в служебном индексе '+dataset.spec.name+': '+
        [...recoveredRows.keys()].slice(0,5).join(', '));
      dataset.recovered=true;
      dataset.recoverMissing=recoverMissing;
      progress(dataset.spec.name+' · подтверждено строк '+dataset.rows.size+' · отсутствует строк из прежнего индекса '+recoverMissing);
    }
    if(editedOverflow) progress(dataset.spec.name+' · учтено изменений видимого текста '+editedOverflow);
    const resizeIndex=parts.some((part,index)=>index<parts.length-1
      ? part.rows!==CHUNK_ROWS
      : part.rows>CHUNK_ROWS);
    if(resizeIndex) progress(dataset.spec.name+' · новый размер части индекса '+CHUNK_ROWS+' строк');
    if(recover||legacy||resizeIndex||Boolean(flat)!==FLAT_SHEETS) dataset.changed=true;
  }

  async function restore(dataset,file,progress,options={}) {
    for await(const row of restoreRows(dataset,file,progress,options)){
      dataset.rows.set(row.key,options.project?options.project(row):row);
    }
    return options.hash??null;
  }

  function sheetName(dataset,part) {
    return dataset.spec.name+(part?' '+(part+1):'');
  }

  function indexName(part) {
    return '_Index'+(part?'_'+(part+1):'');
  }

  function table(name,width,count,rows,hidden=false) {
    requireThat(width>0&&width<=16384,'Превышено число колонок XLSX.');
    return {name,width,count,rows,hidden,filter:!hidden};
  }

  // Сортируем строки и формируем видимый лист, части скрытого индекса и метаданные одной книги.
  async function exportDataset(dataset,calculated,summary,generation,dependency,pairSeen,progress,stream) {
    const rows=stream?null:[...dataset.rows.values()];
    const count=dataset.rows.size;
    const positions=dataset.spec.api.folderHeader(dataset.columns);
    requireThat(positions,'Не удалось совместить колонки '+dataset.spec.name+'.');
    if(rows){
      const dateByRow=new Map(rows.map(row=>[row,dateKey(dataset.spec.day(row.values,positions))||'9999']));
      rows.sort((a,b)=>locale(dateByRow.get(a),dateByRow.get(b))||locale(a.key,b.key));
    }
    const outputColumns=[...dataset.columns,...dataset.spec.api.folderColumns];
    const textLimits=summary.textLimits={count:0,examples:[]};
    // Excel ограничивает длину ячейки. Для исходных полей храним полный текст в скрытом индексе по фрагментам.
    const rawTextLimits=summary.rawTextLimits={count:0,examples:[]};
    const overflow=new Map();
    function rawOverflow(row){
      let entries;
      row.values.forEach((value,column)=>{
        if(typeof value!=='string'||value.length<=EXCEL_TEXT_LIMIT) return;
        (entries??=[]).push([column,value]);
        rawTextLimits.count++;
        if(rawTextLimits.examples.length<10) rawTextLimits.examples.push({
          key:row.key,column:dataset.columns[column],length:value.length
        });
      });
      return entries?JSON.stringify(entries).match(/[\s\S]{1,15000}/gu):[];
    }
    if(rows) for(const row of rows){
      const fragments=rawOverflow(row);
      if(fragments.length) overflow.set(row,fragments);
    }
    function indexRow(row,fragments){
      return [row.key,row.alias,row.origin,row.sourceRow,row.fields?
        JSON.stringify([...row.fields].map(([c,[o,r]])=>[c,o,r])):'',row.primary,...fragments];
    }
    const sheets=[],parts=[],indexes=[];

    function dataSheet(name,start,stop){
      return table(name,outputColumns.length,stop-start+1,async function*(){
        yield outputColumns;
        let i=start;
        for await(const row of stream?mergedRows(dataset,stream):rows.slice(start,stop)){
          try {
            if(stream){
              const n=Math.floor(i/CHUNK_ROWS);
              const fragments=rawOverflow(row);
              if(fragments.length){
                requireThat(fragments.length+6<=16384,'Превышено число колонок индекса XLSX.');
                parts[n].indexWidth=Math.max(parts[n].indexWidth??6,6+fragments.length);
              }
              indexes[n].push(indexRow(row,fragments));
            }
            const output=Array.from({length:dataset.columns.length},(_,c)=>{
              const value=row.values[c];
              return typeof value==='string'&&value.length>EXCEL_TEXT_LIMIT?excelText(value):value??null;
            });
            const derived=calculated(row.values,positions);
            for(let c=0;c<derived.length;c++){
              const value=derived[c];
              if(typeof value!=='string'||value.length<=EXCEL_TEXT_LIMIT) continue;
              const column=dataset.columns.length+c;
              textLimits.count++;
              if(textLimits.examples.length<10){
                textLimits.examples.push({sheet:name,cell:globalThis.XLSX.utils.encode_cell({r:i-start+1,c:column}),
                  column:outputColumns[column],key:row.key,length:value.length});
              }
              // The source columns still carry the full text. Avoid splitting a surrogate pair.
              derived[c]=excelText(value);
            }
            yield output.concat(derived);
            i++;
          }catch(error){
            throw new Error(row.key+': '+error.message,{cause:error});
          }
        }
      });
    }
    if(FLAT_SHEETS){
      requireThat(count<=MAX_DATA_ROWS,'Один лист Excel вмещает до '+MAX_DATA_ROWS+' записей и заголовок.');
      sheets.push(dataSheet(sheetName(dataset,0),0,count));
    }
    for(let start=0;start<count;start+=CHUNK_ROWS){
      const stop=Math.min(count,start+CHUNK_ROWS);
      const name=sheetName(dataset,FLAT_SHEETS?0:parts.length),index=indexName(parts.length);
      let overflowWidth=0;
      if(rows) for(let i=start;i<stop;i++) overflowWidth=Math.max(overflowWidth,overflow.get(rows[i])?.length??0);
      const part={data:name,index,rows:stop-start,...(overflowWidth?{indexWidth:6+overflowWidth}:{})};
      const indexNumber=parts.length;
      parts.push(part);
      if(stream) indexes.push([]);
      if(!FLAT_SHEETS) sheets.push(dataSheet(name,start,stop));
      const sheet=table(index,part.indexWidth??6,stop-start+1,function*(){
        yield ['key','taskId','origin','sourceRow','fieldOrigins','primary',
          ...Array.from({length:(part.indexWidth??6)-6},(_,i)=>'rawText_'+(i+1))];
        if(stream){
          yield* indexes[indexNumber];
          indexes[indexNumber]=null;
        }else for(let i=start;i<stop;i++) yield indexRow(rows[i],overflow.get(rows[i])??[]);
      },true);
      if(stream) Object.defineProperty(sheet,'width',{get:()=>part.indexWidth??6});
      sheets.push(sheet);
    }
    const partCrcs=sheets.map(()=>'00000000');
    sheets.forEach((sheet,i)=>{sheet.recordCrc=crc=>{partCrcs[i]=crc;};});
    const json=()=>JSON.stringify({
      kind:dataset.kind,columns:dataset.columns,origins:dataset.origins,seen:[...dataset.seen],
      parts,generation,dependency,pairSeen,partCrcs,coverage:dataset.coverage,priorities:dataset.priorities,
      ...(FLAT_SHEETS?{flat:true}:{})
    });
    const metadata=()=>json().match(/[\s\S]{1,15000}/gu)||[];
    const metaSheet=table('_Meta',1,metadata().length+1,function*(){
      yield [FORMAT];
      for(const part of metadata()) yield [part];
    },true);
    if(stream) Object.defineProperty(metaSheet,'count',{get:()=>metadata().length+1});
    sheets.push(metaSheet);
    const local=globalThis.ReclassifierLocalExportLimits;
    let blob=await globalThis.ReclassifierFolderExportXlsx.write(sheets,progress,(done,total)=>{
      const percent=Math.min(99,Math.floor(done*100/total));
      progress(dataset.spec.name+' · сформировано строк '+done+' из '+total,{kind:dataset.kind,percent});
    });
    if(local?.stageBook) blob=await local.stageBook(blob);
    const sha256=globalThis.ReclassifierLocalExportLimits?.hashBlob
      ? await globalThis.ReclassifierLocalExportLimits.hashBlob(blob)
      : await fingerprint(await blob.arrayBuffer());
    return {blob,rows:count,sha256};
  }

  const MB_EVIDENCE=['Заявка','Фактические трудозатраты','Навесное / Стационарное','Транспорт','Единица оборудования'];

  // Only incoming keys (and fallback aliases they can join) retain complete historical rows.
  async function prepareStreamingMb(dataset,file,sources,progress){
    const keys=new Set(),primaryKeys=new Set();
    let previousDay='',previousKey='';
    let positions, keptColumns, thinCount=0;
    const hash=await restore(dataset,file,progress,{
      stream:true,
      async onMeta(){
        const known=new Set(dataset.seen);
        const profile=newDataset('mb',dataset.spec,{});
        for(const source of sources){
          if(known.has(source.sha256)) continue;
          await ingest(profile,source,progress,false,(key,identity)=>{
            keys.add(key);
            if(identity.primary) primaryKeys.add(identity.primary);
          });
          known.add(source.sha256);
        }
        positions=dataset.spec.api.folderHeader(dataset.columns);
        keptColumns=['Фактическая дата',...MB_EVIDENCE].map(name=>positions.get(normalize(name)))
          .filter(column=>column!==undefined);
      },
      project(row){
        const day=dateKey(dataset.spec.day(row.values,positions))||'9999';
        if(locale(day,previousDay)<0||(day===previousDay&&locale(row.key,previousKey)<0)){
          throw new StreamUnsupported('порядок строк накопленной книги требует полной сортировки');
        }
        previousDay=day;
        previousKey=row.key;
        if(keys.has(row.key)||primaryKeys.has(row.primary)) return row;
        thinCount++;
        const values=Object.fromEntries(keptColumns.map(column=>[column,row.values[column]]));
        return {key:row.key,primary:row.primary,alias:row.alias,values,isNew:false,thin:true};
      }
    });
    return {file,hash,thinCount};
  }

  // The unchanged history is already sorted. Merge that stream with sorted new or modified rows.
  async function* mergedRows(dataset,stream){
    const positions=dataset.spec.api.folderHeader(dataset.columns);
    const sortKey=row=>dateKey(dataset.spec.day(row.values,positions))||'9999';
    const compare=(a,b)=>locale(a.day,b.day)||locale(a.row.key,b.row.key);
    const overlay=[];
    for(const row of dataset.rows.values()){
      if(!row.thin) overlay.push({day:sortKey(row),row});
    }
    overlay.sort(compare);
    let index=0;
    const input=newDataset('mb',dataset.spec,{});
    for await(const row of restoreRows(input,stream.file,()=>{},{stream:true,skipHash:true})){
      if(!dataset.rows.get(row.key)?.thin) continue;
      const current={day:sortKey(row),row};
      while(index<overlay.length&&compare(overlay[index],current)<0) yield overlay[index++].row;
      yield row;
    }
    while(index<overlay.length) yield overlay[index++].row;
  }

  function summaries(dataset) {
    const pos=dataset.spec.api.folderHeader(dataset.columns);
    let missingDate=0,start='',end='';
    if(pos) for(const row of dataset.rows.values()){
      const day=dateKey(dataset.spec.day(row.values,pos));
      if(!day) missingDate++;
      else {
        if(!start||day<start) start=day;
        if(!end||day>end) end=day;
      }
    }
    return {rows:dataset.rows.size,added:dataset.added,updated:dataset.updated.size,
      unchanged:dataset.rows.size-dataset.added-dataset.updated.size,missingDate,start,end,
      retainedVersions:[...dataset.retainedVersions.values()],periodUpdates:[...dataset.periodUpdates.values()],copies:dataset.duplicates,numberCollisions:dataset.numberCollisions,coverage:dataset.coverage,conflicts:[...dataset.conflicts.values()]};
  }

  async function inspect(sources,onProgress) {
    const spec=contracts(),result={};
    for(const kind of ['itsm','mb']){
      const dataset=newDataset(kind,spec[kind],{});
      for(const source of sources[kind]){
        try {await ingest(dataset,source,onProgress,true);}
        catch(error){throw new Error(source.path+': '+error.message,{cause:error});}
      }
      result[kind]=summaries(dataset);
    }
    return {status:'inspected',summary:result};
  }

  // Последовательность обработки: восстановить ITSM, сохранить её строки временно, загрузить МБ.
  // Из МБ извлекаем данные для расчёта ITSM, а из ITSM сохраняем даты для расчёта МБ.
  // Затем по очереди формируем две временные книги. Заменой рабочих файлов занимается другой модуль.
  async function process(payload,onProgress=()=>{}) {
    const progress=(label,book)=>onProgress({label,book});
    if(payload.inspectOnly) return inspect(payload.sources,progress);
    const spec=contracts();
    const priorities=Object.create(null);
    for(const [sha,rank] of Object.entries(payload.priorities||{})){
      if(SHA.test(sha)&&Number.isSafeInteger(rank)) priorities[sha]=rank;
    }
    const datasets={itsm:newDataset('itsm',spec.itsm,priorities),mb:newDataset('mb',spec.mb,priorities)};
    const hashes={},summary={};
    const local=globalThis.ReclassifierLocalExportLimits;
    const mbRules=globalThis.ReclassifierMobileBrigadeRules;
    const dates=new Map();
    let reloadItsm,mbStream;
    const asOf=new Date(payload.asOf);
    requireThat(Number.isFinite(asOf.getTime())&&SHA.test(payload.referenceHash),'Не подтверждены версия правил и дата расчёта.');
    const dependency=FORMAT+'|'+EXPORT_RULES_VERSION+'|'+globalThis.ReclassifierItsmRules.version+'|'+payload.referenceHash+'|'+dateKey(asOf);
    async function mergeSources(dataset,kind){

      dataset.restoredOrigins=dataset.origins.length;
      const sources=payload.sources[kind];
      const versions=new Map(sources.map(source=>[source.sha256,sourceVersion(kind,source)]));
      for(const origin of dataset.origins){
        const version=versions.get(origin.sha256);
        if(!origin.stamp&&version?.value){
          origin.stamp=version.value;
          origin.stampBasis=version.basis;
          dataset.changed=true;
        }
      }
      // With a saved ITSM history, a lone new source is a deliberate
      // supplemental import when the timestamps cannot be compared.
      if(kind==='itsm'&&dataset.rows.size&&sources.length===1&&!dataset.seen.has(sources[0].sha256)){
        const [source]=sources;
        if(!versions.get(source.sha256).value||dataset.origins.some(origin=>!origin.stamp)){
          dataset.supplementSha=source.sha256;
          progress('Пополнение ITSM · '+source.path+' · единственный входной файл, приоритет для строк без сравнимых дат версий');
        }
      }
      const ordered=sources.slice().sort((a,b)=>{
        const rankA=priorities[a.sha256],rankB=priorities[b.sha256];
        const aRank=Number.isSafeInteger(rankA)?rankA:Number.MIN_SAFE_INTEGER;
        const bRank=Number.isSafeInteger(rankB)?rankB:Number.MIN_SAFE_INTEGER;
        if(aRank!==bRank) return aRank-bRank;
        return locale(versions.get(a.sha256).value,versions.get(b.sha256).value)||locale(a.path,b.path);
      });
      for(const source of ordered){
        const {value,basis}=versions.get(source.sha256);
        if(value&&!dataset.seen.has(source.sha256)) {
          progress('Версия '+source.path+' · '+value+' ('+basis+')');
        }
        try {await ingest(dataset,source,progress);}
        catch(error){throw new Error(source.path+': '+error.message,{cause:error});}
      }
      requireThat(dataset.rows.size>0,'Нет исходных данных или накопленной истории '+dataset.spec.name+'.');
      if(kind==='mb') reconcileMbNumbers(dataset);
    }

    for(const kind of ['itsm','mb']){
      let dataset=datasets[kind];
      progress(dataset.spec.name+' · чтение и слияние',{kind,phase:'reading'});
      const file=payload.current[kind];
      try {
        if(kind==='mb'&&file&&FLAT_SHEETS&&local?.streamArchive&&!payload.disableMbStreaming){
          try {
            mbStream=await prepareStreamingMb(dataset,file,payload.sources.mb,progress);
            hashes.mb=mbStream.hash;
            await mergeSources(dataset,kind);
            progress('МБ · потоковый режим · полных строк в памяти '+(dataset.rows.size-mbStream.thinCount));
          }catch(error){
            if(!(error instanceof StreamUnsupported)) throw error;
            progress('МБ · обычный режим · '+error.message);
            mbStream=null;
            dataset=datasets.mb=newDataset('mb',spec.mb,priorities);
          }
        }
        if(kind!=='mb'||!mbStream){
          hashes[kind]=await restore(dataset,file,progress);
          await mergeSources(dataset,kind);
        }
      }catch(error){throw new Error('export_'+kind.toUpperCase()+'.xlsx: '+error.message,{cause:error});}
      summary[kind]=summaries(dataset);
      if(kind==='itsm'){
        const position=spec.itsm.api.folderHeader(dataset.columns);
        for(const {values} of dataset.rows.values()){
          const date=spec.itsm.day(values,position);
          if(date) dates.set(mbRules.key(values[position.number]),date);
        }
        progress('ITSM · временное сохранение строк перед обработкой МБ');
        reloadItsm=await local.stageRows(dataset.rows,progress);
        dataset.updated.clear();
        progress('ITSM · строки во временном хранилище, память освобождена',{kind:'itsm',phase:'staged'});
      }
    }
    const {itsm,mb}=datasets;
    const pairSeen={itsm:[...itsm.seen],mb:[...mb.seen]};
    for(const dataset of [itsm,mb]){
      for(const kind of ['itsm','mb']){
        requireThat((dataset.pairSeen?.[kind]||[]).every(sha=>datasets[kind].seen.has(sha)),
          'Для восстановления пары не хватает входных версий '+datasets[kind].spec.name+
          '. Верните исходные XLSX, участвовавшие в предыдущем сохранении.');
      }
    }
    if(itsm.conflicts.size||mb.conflicts.size) return {status:'conflicts',summary};
    for(const [kind,item] of Object.entries(summary)){
      progress(kind.toUpperCase()+' · готово к расчёту · строк '+item.rows+
        ' · новых '+item.added+' · обновлено '+item.updated+
        ' · сохранено значений накопленной книги '+item.retainedVersions.reduce((sum,version)=>sum+version.count,0));
    }
    // Если обе книги из одного сохранения, источники уже учтены и расчётные зависимости совпадают, запись можно пропустить.
    const sameGeneration=itsm.generation&&itsm.generation===mb.generation;
    if(sameGeneration&&!itsm.changed&&!mb.changed&&itsm.dependency===dependency&&mb.dependency===dependency){
      return {status:'unchanged',summary,hashes};
    }

    progress('Связи обращений ITSM с задачами МБ');
    const mbPos=spec.mb.api.folderHeader(mb.columns);
    requireThat(mbPos,'Нарушена схема исходных колонок МБ.');
    const evidence=[];
    const [requestColumn,laborColumn,placementColumn,transportColumn,unitColumn]=
      MB_EVIDENCE.map(name=>mbPos.get(normalize(name)));
    for(const {values} of mb.rows.values()){
      const request=mbRules.text(values[requestColumn]);
      if(!request) continue;
      evidence.push({request,laborHours:mbRules.parseLaborHours(values[laborColumn]).hours,
        equipmentPlacement:mbRules.text(values[placementColumn]),
        transport:mbRules.text(values[transportColumn]),equipmentUnit:mbRules.text(values[unitColumn])});
    }
    const mbMeta={latestSourceDate:summary.mb.end||null};
    const lookups=globalThis.ReclassifierItsmRules.buildLookups({
      ...payload.references,mobile_brigade_data:evidence,mobile_brigade_meta:mbMeta
    });
    evidence.length=0;
    let reloadMb;
    if(mbStream){
      progress('МБ · поток подготовлен, в памяти только изменения и рабочий индекс',{kind:'mb',phase:'staged'});
    }else{
      progress('МБ · временное сохранение строк перед записью ITSM');
      reloadMb=await local.stageRows(mb.rows,progress);
      progress('МБ · строки во временном хранилище, память освобождена',{kind:'mb',phase:'staged'});
    }
    mb.updated.clear();
    progress('ITSM · подготовка временной книги',{kind:'itsm',percent:0});
    await reloadItsm(itsm.rows);
    const generation=globalThis.crypto.randomUUID();
    const problemConflicts=summary.itsm.problemConflicts={count:0,examples:[]};
    const itsmBook=await exportDataset(itsm,(row,pos)=>{
      const calculated=spec.itsm.api.calculateFolderRow(row,pos,lookups,mbMeta,asOf,false);
      const candidates=calculated.result.audit.problemConflict;
      if(candidates){
        problemConflicts.count++;
        if(problemConflicts.examples.length<10){
          problemConflicts.examples.push({request:row[pos.number],candidates});
        }
      }
      return [...calculated.result.values,calculated.requestPresence];
    },summary.itsm,generation,dependency,pairSeen,progress);
    itsm.rows.clear();
    lookups.mobileBrigadeByRequest.clear();
    progress('ITSM · временная книга записана, строки выгружены из памяти',{kind:'itsm',phase:'prepared',percent:99});
    progress('МБ · подготовка временной книги',{kind:'mb',percent:0});
    if(reloadMb) await reloadMb(mb.rows);
    const mbBook=await exportDataset(mb,(row,pos)=>{
      const result=spec.mb.api.buildOutputRecord(row,pos,dates);
      return spec.mb.api.folderColumns.map(name=>result[name]);
    },summary.mb,generation,dependency,pairSeen,progress,mbStream);
    mb.rows.clear();
    dates.clear();
    progress('МБ · временная книга записана, строки выгружены из памяти',{kind:'mb',phase:'prepared',percent:99});
    return {status:'prepared',generation,summary,hashes,recovered:{itsm:itsm.recovered===true,mb:mb.recovered===true},
      books:{itsm:itsmBook,mb:mbBook}};
  }

  globalThis.ReclassifierFolderExportProcessor=Object.freeze({process});
})();
