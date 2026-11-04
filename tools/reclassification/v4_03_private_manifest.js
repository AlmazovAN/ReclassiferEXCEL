#!/usr/bin/env node
'use strict';
// V4-03 LOCAL-ONLY extractor; real ITSM text is never included in tracked fixtures.
// Usage: node tools/reclassification/v4_03_private_manifest.js --itsm /path/ITSM.xlsx
//        [--classifier /path/FailureClassifier.xlsx] [--force]
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const XLSX=require('../../vendor/xlsx.full.min.js');
const args=process.argv.slice(2);
const arg=name=>{const index=args.indexOf('--'+name);return index>=0?args[index+1]:null;};
const itsmPath=arg('itsm');
const classifierPath=arg('classifier');
if(!itsmPath||itsmPath.startsWith('--')||args.includes('--help')){
  console.log('Usage: node tools/reclassification/v4_03_private_manifest.js --itsm /path/ITSM.xlsx [--classifier /path/Classifier.xlsx] [--force]');
  process.exitCode=itsmPath?0:2;
} else {
  try {
    // Deliberately fixed inside gitignored local_data/. Never write this into tests/fixtures.
    const output=path.resolve(__dirname,'..','..','local_data','reclassification_v4_03','private_manifest.json');
    fs.mkdirSync(path.dirname(output),{recursive:true,mode:0o700});
    if(fs.existsSync(output)&&!args.includes('--force'))
      throw new Error('Локальный реестр уже существует. Используйте --force только для осознанной перезаписи.');
    const digest=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
    const normalize=s=>String(s??'').toLocaleLowerCase('ru-RU').replace(/ё/g,'е')
      .replace(/[^а-яa-z0-9]+/gi,' ').trim().replace(/\s+/g,' ');
    const text=value=>value===null||value===undefined?null:String(value).trim()||null;
    const readWorkbook=input=>{
      const bytes=fs.readFileSync(input);
      return {sha256:digest(bytes),book:XLSX.read(bytes,{type:'buffer',cellDates:false})};
    };
    const names={
      number:['Номер'],shortDescription:['Категорированная информация обращения.Краткое описание','Краткое описание'],
      description:['Категорированная информация обращения.Описание','Описание'],
      closureNote:['Примечания к закрытию (объединённые с доп)','Примечания к разрешению','Примечания к закрытию'],
      extraReason:['Доп.информация по причине'],
      equipment:['Наименование оборудования'],element:['Элемент'],
      failure:['Неисправность'],cause:['Причина инцидента'],
      expertEquipment:['Наим1'],expertElement:['Элем1'],expertFailure:['Неис1'],expertCause:['Прич1']
    };
    function findTable(book,required) {
      for(const sheetName of book.SheetNames){
        const rows=XLSX.utils.sheet_to_json(book.Sheets[sheetName],{header:1,raw:false,defval:null});
        for(let headerIndex=0;headerIndex<Math.min(12,rows.length);headerIndex++){
          const header=rows[headerIndex]||[];
          const normalized=header.map(normalize);
          const columns={};
          for(const [key,aliases] of Object.entries(names))
            columns[key]=aliases.map(x=>normalized.indexOf(normalize(x))).find(x=>x>=0)??-1;
          if(required.every(x=>columns[x]>=0))return {rows,headerIndex,columns};
        }
      }
      throw new Error('Не найдена таблица с обязательными колонками: '+required.join(', '));
    }
    const source=readWorkbook(itsmPath);
    const table=findTable(source.book,['number','description','equipment','element','failure','cause']);
    const classifier=classifierPath?readWorkbook(classifierPath):null;
    const allowed=new Set();
    if(classifier){
      const ct=findTable(classifier.book,['equipment','element','failure','cause']);
      const col=ct.columns;
      for(const cells of ct.rows.slice(ct.headerIndex+1)){
        const full=['equipment','element','failure','cause'].map(key=>text(cells[col[key]]));
        if(full.every(Boolean))allowed.add(JSON.stringify(full.map(normalize)));
      }
    }
    const records=[],groups=new Map();
    const get=(cells,key)=>table.columns[key]>=0?text(cells[table.columns[key]]):null;
    const seed='v4-03-private-split-2026';
    for(const row of table.rows.slice(table.headerIndex+1)){
      const number=get(row,'number');if(!number)continue;
      // Identical request IDs share a group; other linked requests need manual grouping.
      const group='request:'+normalize(number);
      const seedHash=digest(Buffer.from(seed+':'+group));
      const partition=parseInt(seedHash.slice(0,8),16)%5===0?'holdout':'development';
      groups.set(group,partition);
      const originType=/^RITM/i.test(number)?'RITM':/^INC/i.test(number)?'INC':'OTHER';
      const primary=['equipment','element','failure','cause'].map(k=>get(row,k));
      const engineering=['expertEquipment','expertElement','expertFailure','expertCause'].map(k=>get(row,k));
      const engineerBranchStatus=engineering.every(Boolean)?
        (classifier?(allowed.has(JSON.stringify(engineering.map(normalize)))?'in_classifier':'outside_classifier'):'not_assessed'):
        'not_assessed';
      records.push({
        localId:'PRIVATE-'+digest(Buffer.from(String(records.length)+':'+number)).slice(0,16),
        incidentGroup:group,partition,requestNumber:number,requestType:originType,
        source:{shortDescription:get(row,'shortDescription'),description:get(row,'description'),
          closureNote:get(row,'closureNote'),extraReason:get(row,'extraReason')},
        observations:{reported:null,diagnosed:null,performed:null,outcome:null},
        reference:{primaryPath:primary,engineeringPath:engineering,
          engineerOrigin:'unverified_engineering',engineerBranchStatus},
        review:{status:'requires_independent_review',failureState:null,disposition:null,
          analyticalType:null,proposedPath:[null,null,null,null],applyReady:false,
          evidenceGrade:null,reason:null,reviewerId:null}
      });
    }
    // Raw source and engineer fields remain together only in this explicitly private local output.
    const pack={schemaVersion:1,privacy:'LOCAL_ONLY_DO_NOT_COMMIT',sourceSha256:source.sha256,
      classifierSha256:classifier?.sha256||null,possibleClassifierPaths:allowed.size,
      notes:['Engineer labels are comparison targets, NOT proof or V4 input.',
        'Stationary cases require an independent human review.',
        'Group linked requests manually BEFORE sealing the holdout.',
        'Confirm no personal/corporate information leaves local_data/.'],
      records};
    fs.writeFileSync(output,JSON.stringify(pack,null,2)+'\n',{encoding:'utf8',mode:0o600});
    // Avoid printing any request IDs, source text, or path-specific facts.
    console.log('Локальный закрытый реестр создан: '+records.length+' обращений.');
    console.log('Только локально (gitignored): local_data/reclassification_v4_03/private_manifest.json');
    console.log('Разделение черновое; экспертные статусы не присвоены.');
  } catch(error){
    console.error('Не удалось создать локальный закрытый реестр: '+error.message);
    process.exitCode=1;
  }
}
