const assert=require('node:assert/strict');
globalThis.XLSX=require('../vendor/xlsx.full.min.js');
require('../src/js/app/dataset_catalog.js');
require('../src/js/app/field_registry.js');
require('../src/js/modules/itsm/mb_presence.js');
require('../src/js/modules/itsm/dataset_schema.js');
require('../src/js/kpi/source_facts.js');
require('../src/js/modules/itsm/kpi_source.js');
require('../src/js/modules/itsm/rules.js');
require('../src/js/workers/itsm_processor.js');
require('../src/js/modules/reclassification/rules.js');
require('../src/js/modules/reclassification/rules_v4.js');
require('../src/js/modules/reclassification/engine_registry.js');
require('../src/js/modules/reclassification/runtime_source.js');
require('../src/js/workers/reclassification_xlsx_format.js');
require('../src/js/modules/reclassification/classifier_index_v4.js');
require('../src/js/modules/reclassification/facts_v4.js');
require('../src/js/modules/reclassification/event_v4.js');
require('../src/js/modules/reclassification/objects_v4.js');
require('../src/js/modules/reclassification/elements_v4.js');
require('../src/js/modules/reclassification/failure_v4.js');
require('../src/js/modules/reclassification/cause_v4.js');
require('../src/js/modules/reclassification/path_review_v4.js');
require('../src/js/modules/reclassification/review_policy_v4.js');
require('../src/js/modules/reclassification/diagnostics_v4.js');
require('../src/js/workers/reclassification_processor.js');
const worker=globalThis.ReclassifierReclassificationWorkerProcessor;
const standardWorker=globalThis.ReclassifierItsmWorkerProcessor;
const full=['СВР','Кабель камеры','Обрыв кабеля','Механическое воздействие'];
const classifier=[full,['СВР','Камера','Внутренний отказ','Попадание влаги'],['СВР','Другое','Другое','Другое'],['СВР','Другое','Не является отказом','Отказ не подтверждён']];
const headers=['Дата создания Вызова','Дата выполнения обращения','Дата закрытия','Номер','Территории MES','Наименование оборудования','Элемент','Неисправность','Причина инцидента','Категорированная информация обращения.Краткое описание','Категорированная информация обращения.Описание','Примечания к разрешению','Открыл','Измерение цели обслуживания.Прошло (рабочее время)','Код закрытия','Доп.информация по причине','Состояние'];
const references={reclassification:[],drivers:[],customers:[],type_request:[],initiators:[],exceptions:[],problem_grade:[],mobile_brigade_data:[],mobile_brigade_meta:{latestSourceDate:'2026-10-01'}};
const firstComment='Иванов И.И. 01.09.2026\nПроверена камера.\n  Переносы внутри комментария сохранены.';
references.mobile_brigade_data=[
 {request:' inc-keep ',taskNumber:'МБ-1',combinedComment:firstComment},
 {request:'INC-KEEP',taskNumber:'МБ-2',combinedComment:'Восстановлен кабель камеры.'},
 {request:'INC-KEEP',taskNumber:'МБ-3',combinedComment:firstComment},
 {request:'INC-KEEP',combinedComment:' \n\t '},
 {request:'INC-KEEP-OTHER',combinedComment:'Текст другой заявки'},
 {request:'INC-PENDING',combinedComment:'Диагностика незавершённой заявки'},
 {request:'INC-CANCELLED',combinedComment:'Комментарий отменённой заявки'},
 {request:'INC-REVIEW',combinedComment:'Комментарий заявки для проверки'},
 {request:null,combinedComment:'Комментарий без связи с ITSM'},
 {request:'INC-CLOSED',combinedComment:null}
];
function row(overrides={}) {
 const v={created:'2026-09-01',completed:'2026-09-02',closed:'2026-09-03',number:'INC-KEEP',equipment:full[0],element:full[1],fault:full[2],cause:full[3],short:'Неисправность СВР',description:'Нет изображения камеры',closure:'Обнаружен обрыв кабеля камеры. Кабель камеры восстановлен.',code:'Выполнено полностью',extra:'',state:'Закрыто',...overrides};
 return [v.created,v.completed,v.closed,v.number,'р. Северный',v.equipment,v.element,v.fault,v.cause,v.short,v.description,v.closure,'Иванов И.И.',2,v.code,v.extra,v.state];
}
function bytes(rows,prefix=0) {
 const wb=XLSX.utils.book_new();
 XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet([...Array.from({length:prefix},(_,i)=>['Служебная строка '+i]),headers,...rows]),'Обращение');
 XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet([['Оригинальный другой лист'],[123]]),'Справочно');
 return XLSX.write(wb,{bookType:'xlsx',type:'array'});
}
const read=b=>XLSX.read(new Uint8Array(b),{type:'array',cellDates:true,cellStyles:true});
const aoa=s=>XLSX.utils.sheet_to_json(s,{header:1,raw:true,defval:null});
const process=(buffer,overrides={},progress=()=>{})=>worker.process({bytes:buffer,fileName:'Исходный.xlsx',references,classifierRecords:classifier,asOfDate:'2026-10-03',...overrides},progress);
(async()=>{
 const source=bytes([row(),row({number:'INC-BASELINE',closure:'Работы выполнены.'}),row({number:'INC-CHANGE',element:'Другое',fault:'Другое',cause:'Другое',extra:'Причина: механическое воздействие.'}),row({number:'RITM-ORDINARY',element:'',fault:'',cause:'',short:'Техническое обслуживание оборудования (ТО)/Запросы на обслуживание СДГР',description:'Выполнить ТО',closure:'ТО выполнено.'}),row({number:'RITM-FAILURE',element:'Другое',fault:'Другое',cause:'Другое',short:'Техническое обслуживание оборудования (ТО)/Запросы на обслуживание СДГР',extra:'Причина: механическое воздействие.'}),row({number:'INC-CLOSED',completed:''}),row({number:'INC-PENDING',completed:'',closed:''}),row({number:'INC-CANCELLED',code:'Отменено пользователем'}),row({number:'INC-REVIEW',equipment:'Неизвестная система',element:'',fault:'',cause:''})]);
 const progress=[];const result=await process(source,{},p=>progress.push(p));
 // V4-02: explicit 3.3 selection must be semantically identical to no engineId.
 const explicitLegacy=await process(source,{engineId:'legacy-3.3'});
 assert.deepEqual(explicitLegacy.stats,result.stats,'Explicit legacy statistics changed');
 assert.deepEqual(explicitLegacy.referenceRecords,result.referenceRecords,
   'Explicit legacy Re-Class records changed');
 assert.deepEqual(aoa(read(explicitLegacy.bytes).Sheets.ITSM),aoa(read(result.bytes).Sheets.ITSM),
   'Explicit legacy 68-column ITSM changed');
 assert.deepEqual(aoa(read(explicitLegacy.reclassBytes).Sheets.Reclassification),
   aoa(read(result.reclassBytes).Sheets.Reclassification),
   'Explicit legacy 10-column Re-Class changed');
 assert(result.bytes instanceof ArrayBuffer);assert(result.reclassBytes instanceof ArrayBuffer);
 assert.equal(result.outputName,'Исходный_ITSM_Диагностика.xlsx');assert.equal(result.rulesVersion,'3.3.0');
 assert.equal(result.stats.rows,9);assert.equal(result.stats.usedClosingDate,1);assert.equal(result.stats.statusCounts.BASELINE,1);
 assert.deepEqual(result.stats.expertComparison,{
   noMarking:9,partialMarking:0,invalidMarking:0,validMarking:0,
   readyCompared:0,readyMatched:0,readyDifferent:0
 });
 assert(result.stats.batchSizes.diagnostic<=400 && result.stats.batchSizes.reference<=400);
 assert.equal(result.stats.statusCounts.PENDING,1);assert.equal(result.stats.statusCounts.CANCELLED,1);
 assert.equal(result.stats.qualityCounts['INC с исправлением'],1);assert.equal(result.stats.qualityCounts['RITM вместо INC'],1);assert.equal(result.stats.qualityCounts['RITM без изм'],1);
 assert.equal(Object.values(result.stats.statusCounts).reduce((a,b)=>a+b),9);assert.equal(Object.values(result.stats.qualityCounts).reduce((a,b)=>a+b),9);
 assert.equal(progress.at(-1).percent,100);assert(progress.some(p=>p.label.startsWith('ITSM:')));assert(progress.some(p=>p.label==='Диагностика нового алгоритма'));
 assert(progress.every((p,i)=>i===0||p.percent>=progress[i-1].percent));
 const book=read(result.bytes);
 const zip=XLSX.CFB.read(new Uint8Array(result.bytes),{type:'array'});
 const readPart=name=>{
   const index=zip.FullPaths.findIndex(p=>p.replace(/\\/g,'/').endsWith('/'+name));
   assert(index>=0,'Missing XML part: '+name);
   return new TextDecoder().decode(zip.FileIndex[index].content);
 };
 const workbookXml=readPart('xl/worksheets/sheet1.xml');
 const stylesXml=readPart('xl/styles.xml');
 assert.match(workbookXml,/ySplit="2" topLeftCell="A3"/,'First two rows must be frozen');
 assert.match(workbookXml,/<mergeCell ref="D1:H1"\/>/);
 assert.match(workbookXml,/<mergeCell ref="I1:N1"\/>/);
 assert.match(workbookXml,/<mergeCell ref="O1:T1"\/>/);
 assert.match(workbookXml,/sqref="N3:N11 T3:T11"/,'Only body cells have quality highlighting');
 assert.match(workbookXml,/<autoFilter ref="A2:CN11"\/>/);
 assert.match(stylesXml,/FFF7D7B5/);
 assert.match(stylesXml,/FFF0BE91/);
 assert.match(stylesXml,/FFDDECC8/);
 assert.match(stylesXml,/FFFFEB9C/);
 assert.match(stylesXml,/FFFFC7CE/);

 // Excel may repair XLSX when OOXML style collection counts are stale.
 for(const [parent,child] of [
   ['fonts','font'],['fills','fill'],['borders','border'],
   ['cellXfs','xf'],['dxfs','dxf']
 ]){
   const part=stylesXml.match(new RegExp('<'+parent+'\\b[^>]*>([\\s\\S]*?)<\\/'+parent+'>'));
   assert(part,'OOXML styles collection missing: '+parent);
   const declared=Number(part[0].match(/\bcount="(\d+)"/)?.[1]);
   const actual=(part[1].match(new RegExp('<'+child+'(?=[\\s/>])','g'))||[]).length;
   assert.equal(declared,actual,'OOXML styles count must match entries: '+parent);
 }
 const xmlOrder=['</sheetData>','<autoFilter','<mergeCells','<conditionalFormatting']
   .map(tag=>workbookXml.indexOf(tag));
 assert(xmlOrder.every(index=>index>=0),'Missing worksheet structures');
 assert(xmlOrder.every((at,index)=>index===0||at>xmlOrder[index-1]),
   'SpreadsheetML requires autoFilter before mergeCells before conditionalFormatting');

 assert.match(workbookXml,/<row[^>]*r="1"[^>]*ht="25"/);
 assert.match(workbookXml,/<row[^>]*r="2"[^>]*ht="38"/);
 assert.equal(result.bytes.byteLength>0,true,'A complete zipped XLSX must be produced');
 assert.deepEqual(book.SheetNames,['ITSM','Справочно','KPI_Source','Reclassification','Сводка алгоритма']);
 const report=book.Sheets.ITSM,rows=aoa(report);
 assert(report);
 assert.equal(rows.length,11,'Two heading rows plus nine requests');
 assert.equal(result.stats.columns,worker.reportColumns.length);
 assert.equal(rows[1].length,worker.reportColumns.length);
 assert.equal(new Set(rows[1]).size,worker.reportColumns.length,'Unique report header names');
 assert.equal(rows[0][3],'Первичная классификация в головном объекте ITSM');
 assert.equal(rows[0][8],'Инженерная реклассификация специалистом ОПиН');
 assert.equal(rows[0][14],'Реклассификация машинным алгоритмом Reclassifier 3.3');
 assert.equal(rows[1][13],'Кач классификации (инженерная проверка)');
 assert.equal(rows[1][19],'Новое Качество классификации');
 assert.equal(rows[1][21],'Примечания к разрешению');
 assert.equal(rows[1][22],'Доп.информация по причине');
 assert.equal(rows[1][37],'МесЗакр');
 assert.equal(rows[0][38],'Независимый технический разбор V4 (без применения)');
 assert.equal(rows[1][38],'V4: версия технического разбора');
 for(const name of ['Симптомы','Диагностика','Действия','Результаты','Отрицания','Предположения','V4: факт отказа'])
   assert(rows[1].indexOf(name)>=38,'Missing V4 diagnosis '+name);
 for(const name of ['этап отсечения','Кандидат причины','Veto сработал','Проверено уровней'])
   assert(!rows[1].includes(name),'Obsolete diagnostics retained: '+name);

 assert.equal(rows[1].includes('Доп.информация по причине'),true);
 assert.equal(rows[1].length,92,'A:AL + AM:CN, no obsolete diagnostics');
 assert.deepEqual(rows[1].slice(0,38),[
  "Дата создания Вызова",
  "Дата выполнения обращения",
  "Номер",
  "INC",
  "Наименование оборудования",
  "Элемент",
  "Неисправность",
  "Причина инцидента",
  "INC после рекласс",
  "Наим1",
  "Элем1",
  "Неис1",
  "Прич1",
  "Кач классификации (инженерная проверка)",
  "Тип после нового алгоритма",
  "Новое оборудование",
  "Новый элемент",
  "Новая неисправность",
  "Новая причина",
  "Новое Качество классификации",
  "Категорированная информация обращения.Описание",
  "Примечания к разрешению",
  "Доп.информация по причине",
  "Категорированная информация обращения.Изменил",
  "Территории MES",
  "Услуга СДГР (по наименованию)",
  "Место установки объекта обслуживания",
  "Код закрытия",
  "НаименованиеТехники",
  "Группа инициаторов",
  "ИсклВБР-ЦГПС",
  "ИсклВБР-Спутник",
  "Наличие заявки в МБ",
  "ТО/ Монтаж/ Разовое",
  "ГодОткр",
  "МесОткр",
  "ГодЗакр",
  "МесЗакр"
],'Exact A:AL headers and order');
 assert.deepEqual(rows[1].slice(38),globalThis.ReclassifierTechnicalDiagnosticsV4.columns,'Exact V4 AM:CN order');
 assert(book.Sheets.ITSM['!cols']?.length===worker.reportColumns.length,'Column widths must be stored');
 assert.equal(book.Sheets.ITSM['!merges']?.length,3);
 assert(book.Sheets.ITSM['A3'].t==='d','Registered timestamp should be a native Excel date');
 assert(book.Sheets.ITSM['B3'].t==='d','Completed timestamp should be a native Excel date');
 assert.equal(report['!autofilter'].ref,'A2:CN11');
 const mergedLabel='Примечания к закрытию (объединённые с доп)';
 const reasonPrefix='Доп.информация по причине: ';
 const mergedNote='Обнаружен обрыв кабеля камеры. Кабель камеры восстановлен. '+reasonPrefix+'Причина: механическое воздействие.';
 const getRow=number=>rows.find(r=>r[2]===number);
 const value=(number,label)=>getRow(number)[rows[1].indexOf(label)];
 assert.equal(value('INC-CHANGE','Примечания к разрешению'),'Обнаружен обрыв кабеля камеры. Кабель камеры восстановлен.');
 assert.equal(value('INC-CHANGE','Доп.информация по причине'),'Причина: механическое воздействие.');
 assert.match(value('INC-CHANGE','Симптомы'),/Нет изображения камеры/);
 assert.match(value('INC-CHANGE','Диагностика'),/Примечание к закрытию:0–/);
 assert.equal(value('INC-CHANGE','V4: аналитический тип'),'INC');
 assert.equal(value('INC-CHANGE','V4: оборудование по диагностике'),'СВР');
 assert.equal(value('INC-CHANGE','V4: отказавший объект'),'Кабель камеры');
 assert.equal(value('INC-CHANGE','V4: статус выбора объекта'),'Объект выбран');
 assert.match(value('INC-CHANGE','V4: основание выбора объекта'),/Обнаружен обрыв кабеля камеры/);
 assert.equal(value('INC-CHANGE','V4: готово к применению'),'Нет: требуется инженерное подтверждение; автоприменение V4 отключено');
 assert.equal(Object.values(result.stats.technicalCounts).reduce((a,b)=>a+b),9);
 assert.equal(Object.values(result.stats.objectCounts).reduce((a,b)=>a+b),9);

 assert.equal(value('INC-CHANGE','Доп.информация по причине').split(reasonPrefix).length,1);
 assert.equal(worker.parseItsmWorkbook(source).records.find(r=>r.number==='INC-CHANGE').closureNote,mergedNote);
 const refRows=aoa(read(result.reclassBytes).Sheets.Reclassification);
 assert.equal(refRows[0][9],mergedLabel);
 assert.equal(result.referenceRecords.find(r=>r.number==='INC-CHANGE').closureNote,mergedNote);
 assert.equal(result.referenceRecords.find(r=>r.number==='INC-KEEP').closureNote,'Обнаружен обрыв кабеля камеры. Кабель камеры восстановлен.');
 assert.equal(standardWorker.combineClosureNotes('Строка 1\nСтрока 2','Детали'),'Строка 1\nСтрока 2 '+reasonPrefix+'Детали');
 assert.equal(standardWorker.combineClosureNotes('', 'Детали'),reasonPrefix+'Детали');
 assert.equal(standardWorker.combineClosureNotes('Только примечание',''),'Только примечание');
 assert.equal(standardWorker.combineClosureNotes(mergedNote,'Причина: механическое воздействие.'),mergedNote);
 assert.equal(standardWorker.combineClosureNotes(null,null),null);
 assert.deepEqual(aoa(book.Sheets['Справочно']),[['Оригинальный другой лист'],[123]]);
 const standard=await standardWorker.process({bytes:source,fileName:'Исходный.xlsx',references,asOfDate:'2026-10-03'});
 const standardRows=aoa(read(standard.bytes).Sheets['Обращение']);
 const runtimeInstance={
   records:standard.itsmData.records,
   meta:{fullDatasetScope:'complete'},
   fullDataset:{...standard.itsmFullDataset,coverage:'complete',
     recordKeys:standard.itsmData.records.map(r=>r[3])}
 };
 const runtimeSource=globalThis.ReclassifierReclassificationRuntimeSource.prepare(runtimeInstance);
 const runtimeResult=await process(undefined,{
   runtimeSource,fileName:'Active_Runtime_ITSM.xlsx'
 });
 assert.equal(runtimeResult.stats.rows,result.stats.rows,'Entire active ITSM must be processed');
 assert.equal(runtimeResult.stats.columns,worker.reportColumns.length);
 assert.deepEqual(runtimeResult.referenceRecords,result.referenceRecords,
   'Machine/engineer classification should be identical for file and Active Runtime');
 // Active Runtime contains ITSM's previously calculated Re-Class columns,
 // which may serve as comparison markings. The raw source may have none.
 // Check algorithm outcomes and source data, not marker-dependent diagnostics.
 const runtimeRows=aoa(read(runtimeResult.bytes).Sheets.ITSM);
 for(const label of [
   'Дата создания Вызова','Дата выполнения обращения','Номер',
   'Наименование оборудования','Элемент','Неисправность','Причина инцидента',
   'Новое оборудование','Новый элемент','Новая неисправность','Новая причина',
   'Новое Качество классификации','Решение алгоритма классификации',
   'Примечания к разрешению','Доп.информация по причине','Включено в Reclassification',
   'V4: оборудование по диагностике','V4: отказавший объект','V4: статус выбора объекта',
   'V4: основание выбора объекта','V4: факт отказа после разбора объектов'
 ]){
   const index=rows[1].indexOf(label);
   assert(index>=0,'Missing report field '+label);
   assert.deepEqual(runtimeRows.slice(2).map(row=>row[index]),
     rows.slice(2).map(row=>row[index]),'Runtime/file parity: '+label);
 }
 assert.equal(aoa(read(runtimeResult.reclassBytes).Sheets.Reclassification).length,
   aoa(read(result.reclassBytes).Sheets.Reclassification).length);
 const closureIndex=standard.itsmData.fields.indexOf('closureNote');
 assert.equal(standard.itsmData.columns[closureIndex],mergedLabel);
 assert.equal(standard.itsmData.records[2][closureIndex],mergedNote);
 assert.equal(standard.itsmFullDataset.rows[2][standardRows[0].indexOf('Примечания к разрешению')],mergedNote);
 for(const [newLabel,originalLabel] of [
   ['Дата создания Вызова','Дата создания Вызова'],['Номер','Номер'],
   ['Наименование оборудования','Наименование оборудования'],
   ['Наим1','Наим1'],['Прич1','Прич1'],
   ['Доп.информация по причине','Доп.информация по причине']
 ]) {
   const v=rows[2][rows[1].indexOf(newLabel)];
   const original=standardRows[1][standardRows[0].indexOf(originalLabel)];
   if(newLabel==='Дата создания Вызова') {
     assert(v instanceof Date,'Date must be an Excel date, not text');
     assert.equal(v.toISOString().slice(0,10),original);
   } else assert.deepEqual(v,original,newLabel);
 }
 const commentLabel='Объединённый комментарий из МБ';
 assert.equal(rows[1].indexOf(commentLabel),63);
 assert.equal(value('INC-KEEP',commentLabel),[firstComment,'Восстановлен кабель камеры.',firstComment].join('\n\n'));
 assert.equal(value('INC-PENDING',commentLabel),'Диагностика незавершённой заявки');
 assert.equal(value('INC-CANCELLED',commentLabel),'Комментарий отменённой заявки');
 assert.equal(value('INC-REVIEW',commentLabel),'Комментарий заявки для проверки');
 assert.equal(value('INC-CLOSED',commentLabel),null);
 assert.equal(value('INC-BASELINE','Решение алгоритма классификации'),'Штатная ветка сохранена; факт отказа не подтверждён');
 assert.equal(value('INC-BASELINE','Включено в Reclassification'),'Нет');
 assert.equal(value('INC-BASELINE','Новое Качество классификации'),'INC без изм');
 assert.equal(value('INC-BASELINE','V4: факт отказа'),'Недостаточно данных');
 assert.equal(result.stats.usedClosingDate,1);
 assert.match(value('INC-CHANGE','Диагностика'),/Обнаружен обрыв кабеля/);
 assert.equal(value('INC-CHANGE','Новый элемент'),full[1]);
 assert.match(value('INC-CHANGE','V4: основание вывода'),/обрыв кабеля/);
 assert.equal(value('RITM-FAILURE','V4: аналитический тип'),'INC');
 const numbers=new Set(result.referenceRecords.map(r=>r.number));
 assert(numbers.has('INC-CLOSED'));
 for(const n of ['INC-BASELINE','INC-PENDING','INC-CANCELLED','INC-REVIEW'])assert(!numbers.has(n));
 assert.equal(result.referenceRecords.find(r=>r.number==='INC-CLOSED').dateCompleted,null);
 assert.equal(refRows[0].length,10);
 const extraOnly=await process(bytes([row({number:'INC-EXTRA-ONLY',closure:'',extra:'Причина: механическое воздействие.'})]));
 const extraRows=aoa(read(extraOnly.bytes).Sheets.ITSM);
 assert.equal(extraRows[2][extraRows[1].indexOf('Примечания к разрешению')],null,
  'Original V must remain empty when only W is populated');
 assert.equal(extraRows[2][extraRows[1].indexOf('Доп.информация по причине')],
   'Причина: механическое воздействие.');
 assert.equal(extraOnly.stats.withoutClosureNote,0);
 const manualRefs={...references,reclassification:[{number:'INC-MANUAL',equipment:full[0],element:full[1],fault:full[2],incidentReason:full[3]}]};
 const manual=await process(bytes([row({number:'INC-MANUAL',element:'Другое',fault:'Другое',cause:'Другое',closure:'Работы выполнены.'})]),{references:manualRefs});
 const mr=aoa(read(manual.bytes).Sheets.ITSM);
 const mv=label=>mr[2][mr[1].indexOf(label)];
 assert.equal(mv('Новый элемент'),full[1]);
 assert.equal(mv('Новое Качество классификации'),'INC с исправлением');
 assert.equal(manual.stats.baselineMode,'standard');
 assert.equal(mv('Решение алгоритма классификации'),'Штатная ветка сохранена; факт отказа не подтверждён');
 const delayed=await process(bytes([row({number:'INC-DUP'}),[],row({number:'INC-DUP'})],25));
 const dr=aoa(read(delayed.bytes).Sheets.ITSM);
 assert.equal(delayed.stats.rows,3);
 assert.equal(dr[1][38],'V4: версия технического разбора');
 assert.equal(dr[2][dr[1].indexOf('V4: факт отказа')],'Отказ подтверждён текстом диагностики');
 assert.equal(dr[3][dr[1].indexOf('Решение алгоритма классификации')],'Нужна проверка');
 assert.equal(dr[4][dr[1].indexOf('V4: факт отказа')],'Отказ подтверждён текстом диагностики');
 // A review report is not a replacement for the complete source ITSM export.
 await assert.rejects(()=>process(result.bytes),/обязательн|заголовк/i);
 // Historical 42- and 43-column diagnostic blocks are still accepted as input
 // when attached to the complete 62-column ITSM sheet.
 for(const legacySize of [42,43]){
   const previous=read(standard.bytes);
   XLSX.utils.sheet_add_aoa(previous.Sheets['Обращение'],
     [worker.diagnosticColumns.slice(0,legacySize)],{origin:{r:0,c:62}});
   const upgraded=await process(XLSX.write(previous,{bookType:'xlsx',type:'array'}));
   assert.equal(upgraded.stats.columns,worker.reportColumns.length);
   assert.equal(aoa(read(upgraded.bytes).Sheets.ITSM)[1].length,worker.reportColumns.length);
 }
 // PR-5: compare independent engineer labels only when complete AND valid.
 // The four expert fields are placed outside the reserved AB:BJ ITSM output block.
 const expertWb=read(bytes([
   row({number:'INC-ENG-EXACT'}),
   row({number:'INC-ENG-DIFF'}),
   row({number:'INC-ENG-PARTIAL'}),
   row({number:'INC-ENG-INVALID'}),
   row({number:'INC-ENG-EMPTY'})
 ]));
 const expertSheet=expertWb.Sheets['Обращение'];
 XLSX.utils.sheet_add_aoa(expertSheet,
   [['Наим1','Элем1','Неис1','Прич1'],
    full,
    ['СВР','Камера','Внутренний отказ','Попадание влаги'],
    [full[0],full[1],null,null],
    ['СВР','Несуществующий узел','Неправильный отказ','Нет причины'],
    [null,null,null,null]],
   {origin:{r:0,c:17}});
 const expert=await process(XLSX.write(expertWb,{bookType:'xlsx',type:'array'}));
 const summaryExpert=expert.stats.expertComparison;
 assert.equal(summaryExpert.noMarking,1);
 assert.equal(summaryExpert.partialMarking,1);
 assert.equal(summaryExpert.invalidMarking,1);
 assert.equal(summaryExpert.validMarking,2);
 assert.equal(summaryExpert.readyCompared,
   summaryExpert.readyMatched+summaryExpert.readyDifferent);
 assert.equal(summaryExpert.readyCompared,2,'Both valid expert labels must be compared');
 assert.equal(summaryExpert.readyMatched,1);
 assert.equal(summaryExpert.readyDifferent,1);
 const expertRows=aoa(read(expert.bytes).Sheets.ITSM);
 assert.equal(expertRows.length,7);
 assert.equal(expertRows[1].length,worker.reportColumns.length,'Engineer comparison must not add extra report fields');
 const summarySheet=aoa(read(expert.bytes).Sheets['Сводка алгоритма']);
 assert(summarySheet.some(r=>r[0]==='Совпадение готовой машинной и инженерной классификации'&&r[1]===1));
 assert(summarySheet.some(r=>r[0]==='Расхождение готовой машинной и инженерной классификации'&&r[1]===1));
 const withoutEngineer=await process(bytes([
   row({number:'INC-ENG-EXACT'}),
   row({number:'INC-ENG-DIFF'}),
   row({number:'INC-ENG-PARTIAL'}),
   row({number:'INC-ENG-INVALID'}),
   row({number:'INC-ENG-EMPTY'})
 ]));
 assert.deepEqual(expert.referenceRecords,withoutEngineer.referenceRecords,
   'Engineer marking must never influence generated ReClass decisions');
 assert.deepEqual(expert.stats.statusCounts,withoutEngineer.stats.statusCounts);
 // More than two diagnostic chunks, including a partial tail, must preserve
 // every row and its original position in the formatted report.
 const largeSource=bytes(Array.from({length:805},(_,i)=>
   row({number:'INC-BATCH-'+String(i).padStart(4,'0')})
 ));
 const large=await process(largeSource);
 assert.equal(large.stats.rows,805);
 assert.equal(large.stats.batchSizes.diagnostic,400);
 assert(large.stats.batchSizes.reference<=400);
 const largeRows=aoa(read(large.bytes).Sheets.ITSM);
 assert.equal(largeRows.length,807,'Two headers and 805 requests required');
 assert.equal(largeRows[2][2],'INC-BATCH-0000');
 assert.equal(largeRows[402][2],'INC-BATCH-0400');
 assert.equal(largeRows[806][2],'INC-BATCH-0804');
 assert.equal(largeRows[1].length,worker.reportColumns.length);
 const preparedStandard=await standardWorker.process({
   bytes:largeSource,fileName:'source.xlsx',references,asOfDate:'2026-10-03',
   deferExport:true,omitFullDatasetRows:true
 });
 assert.equal(preparedStandard.itsmData.records.length,805);
 assert.equal(preparedStandard.itsmFullDataset.rows.length,0,
   'Internal cascade should not duplicate all raw source rows');
 assert.equal(preparedStandard.itsmFullDataset.sourceRows,805);
 assert.equal(preparedStandard.itsmFullDataset.coverage,'omitted-for-reclassification');

 const independent=await process(bytes([row({number:'INC-MANUAL',element:'Другое',fault:'Другое',cause:'Другое',closure:'Работы выполнены.'})]),{references:manualRefs,baselineMode:'source'});
 const ir=aoa(read(independent.bytes).Sheets.ITSM);
 assert.equal(independent.stats.baselineMode,'source');
 assert.equal(independent.referenceRecords.length,0);
 assert.equal(ir[2][ir[1].indexOf('Новый элемент')],'Другое');
 assert.match(ir[2][ir[1].indexOf('Опора алгоритма классификации')],/без опоры на ReClass/);
 const altered=await process(source,{references:{...references,mobile_brigade_data:[{request:'INC-KEEP',combinedComment:'Отказ не подтверждён. Выполнен демонтаж.'}]}});
 assert.deepEqual(altered.referenceRecords,result.referenceRecords);
 assert.deepEqual(altered.stats.statusCounts,result.stats.statusCounts);
 assert.deepEqual(altered.stats.objectCounts,result.stats.objectCounts);
 await assert.rejects(()=>process(source,{classifierRecords:[]}),/классификатор/i);
 await assert.rejects(()=>process(source,{references:null}),/снимок действующих справочников/i);
 const unsafe=read(source);
 unsafe.Sheets['Обращение'].AB1={t:'s',v:'Чужая исходная колонка'};
 unsafe.Sheets['Обращение'].AB2={t:'s',v:'Сохранить меня'};
 unsafe.Sheets['Обращение']['!ref']='A1:AB10';
 await assert.rejects(()=>process(XLSX.write(unsafe,{bookType:'xlsx',type:'array'})),/AB:BJ/);
 console.log('PR2 Reclassification: compact report, source parity, distinct engineering and machine classification, 92 headings with V4 evidence after AL, date columns, ReClass contract and legacy diagnostic input OK');
})().catch(e=>{console.error(e);globalThis.process.exitCode=1;});
