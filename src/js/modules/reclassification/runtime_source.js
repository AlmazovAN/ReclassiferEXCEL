// Read-only handoff from the active ITSM Dataset to the Re-Class worker.
// Never reconstruct missing raw columns from analytical records.
(() => {
  'use strict';
  const normalize = value => String(value ?? '').replace(/\u00a0/g,' ')
    .replace(/\s+/g,' ').trim().toLocaleLowerCase('ru-RU');
  function prepare(instance) {
    const full=instance?.fullDataset;
    const compact=instance?.records;
    if(!Array.isArray(compact)||!compact.length)
      throw new Error('В активной базе ITSM нет обращений для машинной реклассификации.');
    if(!full||!Array.isArray(full.columns)||!Array.isArray(full.rows)||
      full.coverage==='partial'||full.coverage==='incoming-batch'||
      ['partial','incoming-batch'].includes(instance.meta?.fullDatasetScope)||
      full.rows.length!==compact.length)
      throw new Error('В активной базе ITSM отсутствует полный Full Dataset для всех заявок. Загрузите исходную ITSM-выгрузку через раздел базы данных либо используйте ручной выбор файла.');
    if(full.package!=='itsm-full-dataset'||full.aggregation!=='per-source-row')
      throw new Error('Активный Full Dataset ITSM имеет несовместимый формат.');
    const headers=full.columns;
    const numberColumn=headers.indexOf('Номер');
    if(numberColumn<0||headers.length<62||
      !headers.every(label=>typeof label==='string'))
      throw new Error('Full Dataset ITSM не содержит необходимых исходных столбцов.');
    const keys=full.recordKeys;
    if(keys!=null&&(!Array.isArray(keys)||keys.length!==compact.length))
      throw new Error('Нарушена привязка полных строк ITSM к номерам заявок.');
    const seen=new Set();
    for(let i=0;i<compact.length;i++){
      const row=full.rows[i],record=compact[i];
      if(!Array.isArray(row)||row.length!==headers.length||!Array.isArray(record))
        throw new Error('Повреждена строка активной ITSM-базы: '+(i+1)+'.');
      const number=normalize(row[numberColumn]);
      if(!number||seen.has(number)||normalize(record[3])!==number||
        (keys&&normalize(keys[i])!==number))
        throw new Error('Номера обращений ITSM в Full Dataset и Active Runtime не совпадают (строка '+(i+1)+'). Перезагрузите базу.');
      seen.add(number);
    }
    return {package:'itsm-full-dataset',aggregation:'per-source-row',
      columns:headers,rows:full.rows};
  }
  // Last completed *request* date in the active Re-Class reference. The
  // reference has no field for the engineer's actual review/submission date:
  // never present this as the timestamp of an expert decision.
  const freshnessCache=new WeakMap();
  function validDateKey(value) {
    if(value instanceof Date){
      if(Number.isNaN(value.getTime()))return null;
      return validDateKey(value.getFullYear()+'-'+
        String(value.getMonth()+1).padStart(2,'0')+'-'+
        String(value.getDate()).padStart(2,'0'));
    }
    if(typeof value!=='string')return null;
    const iso=value.trim().match(/^(\d{4})-(\d{2})-(\d{2})(?:$|[T\s])/);
    const ru=value.trim().match(/^(\d{1,2})[.\/](\d{1,2})[.\/](\d{4})(?:$|[\s])/);
    if(!iso&&!ru)return null;
    const year=+(iso?iso[1]:ru[3]),month=+(iso?iso[2]:ru[2]),day=+(iso?iso[3]:ru[1]);
    const parsed=new Date(Date.UTC(year,month-1,day));
    if(parsed.getUTCFullYear()!==year||parsed.getUTCMonth()+1!==month||parsed.getUTCDate()!==day)
      return null;
    return String(year).padStart(4,'0')+'-'+String(month).padStart(2,'0')+'-'+String(day).padStart(2,'0');
  }
  function reclassFreshness(instance) {
    if(!instance||!Array.isArray(instance.records))
      return Object.freeze({rows:0,latestCompleted:null});
    const rows=instance.records;
    const metaDate=instance.meta?.latestRequestDate || null;
    const cached=freshnessCache.get(instance);
    if(cached?.records===rows&&cached.metaDate===metaDate)return cached.result;
    let latestCompleted=validDateKey(metaDate);
    if(!latestCompleted){
      for(const record of rows){
        const date=validDateKey(Array.isArray(record)?record[1]:record?.dateCompleted);
        if(date&&(!latestCompleted||date>latestCompleted))latestCompleted=date;
      }
    }
    const result=Object.freeze({rows:rows.length,latestCompleted});
    freshnessCache.set(instance,{records:rows,metaDate,result});
    return result;
  }
  globalThis.ReclassifierReclassificationRuntimeSource=Object.freeze({
    prepare,reclassFreshness
  });
})();
