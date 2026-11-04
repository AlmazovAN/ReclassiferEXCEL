const assert = require('node:assert/strict');
require('../src/js/modules/itsm/rules.js');
require('../src/js/modules/reclassification/rules.js');
const rules = globalThis.ReclassifierReclassificationRules;
const paths = [
  ['СВР','Кабель камеры','Обрыв кабеля','Механическое воздействие'],
  ['СВР','Кабель камеры','Обрыв кабеля','Некачественный монтаж'],
  ['СВР','Кабель камеры','Обрыв кабеля','Причина не установлена'],
  ['СВР','Камера','Внутренний отказ','Попадание влаги'],
  ['СВР','Другое','Не является отказом','Отказ не подтверждён'],
  ['ПО (программное обеспечение)','Внутреннее программное обеспечение','Сбой ПО','Сбой программного обеспечения'],
  ['Другое','Другое','Другое','Другое']
];
const context = rules.buildContext(paths,{ordinaryRitmTemplates:['Полное описание планового ТО']});
const base = {
  number:'INC-1',createdAt:'2026-09-01',completedAt:'2026-09-02',closedAt:null,
  sourceEquipment:'СВР',sourceElement:'Кабель камеры',sourceFault:'Обрыв кабеля',sourceReason:'Механическое воздействие',
  closingCode:'Выполнено полностью',description:'Нет изображения камеры',closureNote:'Обнаружен обрыв кабеля камеры. Кабель камеры восстановлен. Оборудование работает.'
};
const run = overrides => rules.evaluateRow({row:{...base,...overrides},context});
let result = run({completedAt:null,closedAt:'2026-09-03'});
assert.equal(result.dateSource,'Дата закрытия');
assert.equal(result.dateCompleted,null);
assert.equal(result.analysisDate,'2026-09-03');
assert.equal(result.status,'KEEP');
assert.equal(run({completedAt:null,closedAt:null}).status,'PENDING');
assert.equal(run({completedAt:'31.02.2026',closedAt:'2026-09-03'}).dateSource,'Дата закрытия');
assert.equal(run({closingCode:'Отменено пользователем'}).status,'CANCELLED');
assert.equal(run({state:'Отменён'}).readyForApply,false);

result=run({closureNote:'Обнаружен обрыв кабеля камеры. Кабель камеры восстановлен. После ремонта неисправности не выявлены.'});
assert.equal(result.failureState,'FAILURE');
assert.equal(result.status,'KEEP');
result=run({closureNote:'Повреждений камеры не выявлено. Оборудование работает.'});
assert.equal(result.status,'BASELINE');
assert.equal(result.reviewedLevels,4);
assert.equal(result.selectedValid,true);
assert.equal(result.readyForApply,false);
result=run({closureNote:'Неисправности не выявлены.'});
assert.equal(result.status,'REVIEW');
assert.equal(result.fault,'Обрыв кабеля');
result=run({closureNote:'Отказ не подтверждён.'});
assert.equal(result.status,'CHANGE');
assert.equal(result.fault,'Не является отказом');
assert.ok(result.levelDecisions.every(d=>d.level===0||d.evidence));

// A complaint about the camera must not replace an explicitly repaired cable with the camera node.
result=run({sourceElement:'Другое',sourceFault:'Другое',sourceReason:'Другое',
  closureNote:'Обнаружен обрыв кабеля камеры. Кабель камеры восстановлен. Причина: механическое воздействие.'});
assert.equal(result.status,'CHANGE');
assert.deepEqual(result.candidate,paths[0]);
assert.equal(result.firstChanged,'Элемент');

// Each changed level may be supported by a different chronological engineer comment.
result=run({sourceElement:'Другое',sourceFault:'Другое',sourceReason:'Другое',
  closureNote:'(03.09.2026 12:00:00+0700): Кабель камеры восстановлен. Оборудование исправно. '+
    '(02.09.2026 12:00:00+0700): Причина: некачественный монтаж. '+
    '(01.09.2026 12:00:00+0700): Обнаружен обрыв кабеля камеры.'});
assert.equal(result.status,'CHANGE');
assert.equal(result.incidentReason,'Некачественный монтаж');
assert.match(result.levelDecisions.find(d=>d.level===3).evidence,/некачественный монтаж/);

result=run({sourceElement:'Другое',sourceFault:'Другое',sourceReason:'Другое',
  closureNote:'Обнаружен обрыв кабеля камеры. Кабель камеры восстановлен.'});
assert.equal(result.stage,7);
assert.equal(result.status,'REVIEW');
assert.deepEqual(result.candidate,['СВР','Кабель камеры','Обрыв кабеля']);
assert.equal(result.readyForApply,false);
assert.notEqual(result.incidentReason,'Некачественный монтаж');

result=run({closureNote:'Вводная заметка: обнаружен обрыв кабеля камеры. '+
  '(01.09.2026 12:00:00+0700): Кабель камеры восстановлен.'});
assert.equal(result.failureState,'FAILURE');
result=run({closureNote:'(02.09.2026 12:00:00+0700): Отказ не подтверждён. '+
  '(01.09.2026 12:00:00+0700): Обнаружен обрыв кабеля камеры.'});
assert.equal(result.failureState,'UNKNOWN');
assert.equal(result.status,'REVIEW');

result=run({number:'RITM-1',shortDescription:'Полное описание планового ТО',description:'Плановые работы',
  closureNote:'Выполнена плановая замена кабеля.'});
assert.equal(result.status,'RITM_OK');
assert.equal(result.veto,false);
result=run({number:'RITM-1',shortDescription:'Полное описание планового ТО',
  closureNote:'Обнаружен обрыв кабеля камеры. Кабель камеры восстановлен.'});
assert.equal(result.veto,true);
assert.equal(result.failureState,'FAILURE');
assert.equal(run({number:'RITM-1',shortDescription:'Другое полное описание планового ТО',
  description:'Плановые работы',closureNote:'Работы выполнены.'}).status,'BASELINE');

result=run({sourceEquipment:'ПО (программное обеспечение)',sourceElement:'Внутреннее программное обеспечение',
  sourceFault:'Сбой ПО',sourceReason:'Сбой программного обеспечения',completedAt:null,closedAt:'2026-09-03',
  description:'Сбой ПО, не работает программа',closureNote:'Устранен сбой программного обеспечения. Программа работает.'});
assert.equal(result.status,'KEEP');
assert.equal(result.dateSource,'Дата закрытия');

const mutationFreeRow=Object.freeze({...base,expertPath:['Чужой','Чужой','Чужой','Чужой']});
const noTarget=rules.evaluateRow({row:{...base},context});
assert.deepEqual(rules.evaluateRow({row:mutationFreeRow,context}),noTarget);
assert.equal(rules.evaluateRow({row:base,context:rules.buildContext([])}).readyForApply,false);
const disabled=rules.buildContext([{equipment:'СВР',element:'Камера',failure:'Отказ',cause:'Влага',disabled:'Да'}]);
assert.equal(disabled.paths.size,0);

// Every accepted result is one current full classifier path, never a cross-branch combination.
for(const sample of [base,{...base,closureNote:'Отказ не подтверждён.'}]) {
 const accepted=rules.evaluateRow({row:sample,context});
 if(accepted.readyForApply) assert.ok(context.paths.has(JSON.stringify([
   accepted.equipment,accepted.element,accepted.fault,accepted.incidentReason
 ].map(v=>v.toLowerCase().replace(/ё/g,'е')))));
}

// Completed corrective action with an initial symptom establishes restoration,
// but the same action during planned maintenance does not establish a failure.
result=run({closureNote:'Заменили кабель камеры. Изображение восстановлено.'});
assert.equal(result.failureState,'FAILURE');
assert.equal(result.status,'KEEP');
result=run({number:'RITM-PLANNED',shortDescription:'Техническое обслуживание оборудования (ТО)/Запросы на обслуживание СДГР',
 description:'Выполнить плановое ТО',closureNote:'Заменили кабель камеры. ТО выполнено.'});
assert.equal(result.status,'RITM_OK');
assert.notEqual(result.failureState,'FAILURE');
result=run({number:'RITM-VETO',shortDescription:'Техническое обслуживание оборудования (ТО)/Запросы на обслуживание СДГР'});
assert.equal(result.veto,true);
assert.equal(result.failureState,'FAILURE');
const unknown=run({closureNote:'Работы выполнены.'});
assert.equal(unknown.status,'BASELINE');
assert.equal(unknown.readyForApply,false);
assert.equal(unknown.sourcePreservedLevels,4);
assert.equal(rules.classificationQuality({row:base,result:unknown,finalPath:paths[0]}),'INC без изм');
assert.equal(rules.classificationQuality({row:{...base,sourceElement:'Камера'},result:run({}),finalPath:paths[0]}),'INC с исправлением');
assert.equal(rules.classificationQuality({row:{...base,number:'RITM-1',sourceFault:'Другое'},result:run({}),finalPath:paths[0]}),'RITM вместо INC');
assert.equal(run({number:null}).readyForApply,false);
assert.equal(run({number:'REQ-1'}).readyForApply,false);

// A valid prefix survives an absent/invalid cause; accepted changes still require a full canonical path.
result=run({sourceReason:'Отсутствует классификатор',closureNote:'Кабель камеры восстановлен.'});
assert.equal(result.partial,true);assert.equal(result.stage,7);
assert.deepEqual(result.candidate,['СВР','Кабель камеры','Обрыв кабеля']);
assert(result.levelDecisions.some(d=>d.level===2&&d.mode==='SOURCE'));
assert.deepEqual(result.unresolvedLevels,['Причина']);
const extraContext=rules.buildContext([
 ['ВОЛС','Оптический кабель','Повреждение линии','Механическое воздействие'],
 ['ВОЛС','Оптический кабель','Повреждение линии','Наезд транспорта'],
 ['ВОЛС','Оптический кабель','Повреждение линии','Повреждение в результате взрывных работ'],
 ['АГЗ (аэрогазовая защита)','Датчик концентрации горючих газов','Внутренний отказ','Внутренний отказ']
]);
const evaluate=(row)=>rules.evaluateRow({row:{...base,...row},context:extraContext});
result=evaluate({sourceEquipment:'АГЗ (аэрогазовая защита)',sourceElement:'Другое',sourceFault:'Другое',sourceReason:'Отсутствует классификатор',description:'АГЗ не исправлен',closureNote:'При осмотре обнаружены поврежления датчика концетрации газов.Произвели замену итс2.АГЗ в работе.'});
assert.equal(result.failureState,'FAILURE');assert.equal(result.candidate[1],'Датчик концентрации горючих газов');
assert.equal(result.partial,true);assert.equal(result.readyForApply,false);
assert.equal(result.candidate[2],undefined); // Replacement does not establish an internal fault or root cause.
const optical={sourceEquipment:'ВОЛС',sourceElement:'Оптический кабель',sourceFault:'Повреждение линии',sourceReason:'Механическое воздействие',description:'Нет связи',closureNote:'Обнаружен поврежденный ВОЛС (наезд транспорта). Связь восстановлена.'};
result=evaluate(optical);assert.equal(result.incidentReason,'Наезд транспорта');assert.equal(result.status,'CHANGE');
result=evaluate({...optical,closureNote:'Выявили затухание ВОЛС. Произвели ремонт. На кроссе после взрывных работ были обнаружены сломанные волокна, отсутствовали запасные пары.'});
assert.equal(result.status,'REVIEW');assert.equal(result.incidentReason,'Механическое воздействие');assert.match(result.reason,/причина текущего события/);
result=evaluate({...optical,sourceElement:'Другое',sourceFault:'Другое',sourceReason:'Другое',closureNote:'Причина: наезд транспорта.'});
assert.equal(result.candidate[3],'Наезд транспорта');assert.equal(result.candidate[1],null);assert.equal(result.readyForApply,false);
result=run({description:'А105.3.1; Отказ устройства',closureNote:'На ИС 105.3 был плохой контакт, перезачистили контакты, подключили. Система работает.'});
assert.equal(result.status,'REVIEW');assert.match(result.reason,/Объект работ/);assert.equal(result.fault,base.sourceFault);
result=run({closureNote:'Обнаружено: Отказ не подтверждён. Выполнено: СВР работает и пишет. На карте следы окиси. Почистили контакты.'});
assert.equal(result.failureState,'NON_FAILURE');assert.equal(result.fault,'Не является отказом');
// Equipment alone does not change the standard quality category; date/closure conditions are shared.
assert.equal(rules.classificationQuality({row:base,result:run({}),finalPath:['Другая система',...paths[0].slice(1)]}),'INC без изм');
assert.equal(rules.classificationQuality({row:{...base,closingCode:'Выполнено частично'},result:run({}),finalPath:paths[1]}),'INC без изм');
assert.equal(rules.classificationQuality({row:base,result:run({}),finalPath:[base.sourceEquipment,'Другое','Другое','Другое']}),'INC не классифицирован');
result=run({closureNote:'(02.09.2026 08:00:00+0700): Отказ не подтверждён. (02.09.2026 08:00:00+0300): Обнаружен обрыв кабеля камеры.'});
assert.equal(result.failureState,'FAILURE');
result=run({closureNote:'(02.09.2026 08:00:00+0300): Отказ не подтверждён. (02.09.2026 08:00:00+0700): Обнаружен обрыв кабеля камеры.'});
assert.equal(result.failureState,'UNKNOWN');
console.log('Reclassification 3.3: standard quality, prefix/partial evidence, synonyms, object scope, historical causes, chronology, no target/MB leakage and canonical acceptance OK');
