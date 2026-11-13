'use strict';
const assert=require('node:assert/strict');
require('../src/js/modules/reclassification/classifier_index_v4.js');
require('../src/js/modules/reclassification/facts_v4.js');
require('../src/js/modules/reclassification/event_v4.js');
require('../src/js/modules/reclassification/objects_v4.js');
const api=globalThis.ReclassifierObjectAssessmentV4;
const indexApi=globalThis.ReclassifierClassifierIndexV4;
const paths=[['СВР','Кабель камеры','Обрыв','Причина'],['СВР','Камера','Отказ','Причина'],['СВР','Блок питания','Отказ','Причина'],['Станция связи','Датчик','Отказ','Причина']];
const context=api.fromPreparedRecords(paths);
const analyze=(closure,extra={},ctx=context)=>{
 const row={number:'INC-1',description:'Нет изображения камеры СВР',closureNote:closure,...extra};
 const event=globalThis.ReclassifierEventAssessmentV4.analyze(row);
 return {row,event,result:api.analyze(event,ctx)};
};
let {row,event,result}=analyze('Обнаружен обрыв кабеля камеры. Кабель заменён, связь восстановлена.');
assert.equal(result.status,'SELECTED');
assert.equal(result.selectedEquipment,'СВР');
assert.equal(result.failedObject.canonical,'Кабель камеры');
assert(result.roles.symptoms.some(m=>m.canonical==='Камера'));
assert(!result.targets.some(m=>m.canonical==='Камера'),'Dependent camera noun is not a second defect');
assert.equal(result.readyForApply,false);
assert.deepEqual(result.candidatePath,['СВР',null,null,null]);
for(const target of result.targets)for(const e of target.evidence){
 assert.equal(row[e.field].slice(e.start,e.end),e.text);
 assert.equal(row[e.field].slice(e.mentionStart,e.mentionEnd),target.text);
}
for(const text of ['Заменён блок питания.','Возможно неисправна камера.','Обрыв кабеля камеры не подтверждён.','Ранее обнаружен обрыв кабеля камеры.','Камера проверена. Связь восстановлена.']){
 assert.equal(analyze(text).result.selectedEquipment,null,text);
}
result=analyze('Выявлен отказ блока питания.').result;
assert.equal(result.failedObject.canonical,'Блок питания','Grammatical forms must match');
assert.equal(analyze('Выявлен отказ микроблока питания.').result.selectedEquipment,null,'No substring matches');
assert.equal(analyze('Выявлен отказ блока питания для камеры.').result.failedObject.canonical,'Блок питания');
assert.equal(analyze('Выявлен отказ блока питания и камеры.').result.status,'MULTIPLE_OBJECTS');
assert.equal(analyze('Выявлен отказ блока питания. Обнаружен обрыв кабеля камеры.').result.status,'MULTIPLE_OBJECTS');
assert.equal(analyze('Выявлен отказ камеры №1. Выявлен отказ камеры №2.').result.status,'MULTIPLE_OBJECTS');
assert.equal(analyze('Обнаружен обрыв кабеля камеры. Выявлен отказ неизвестного модуля.').result.selectedEquipment,null,'Do not ignore another unbound defect');
({event,result}=analyze('Проверена камера: исправна. Обнаружен обрыв кабеля камеры.'));
assert.equal(event.failureState,'CONFLICT');
assert.equal(result.effectiveFailureState,'FAILURE');
assert.equal(result.status,'SELECTED','Healthy camera does not refute a cable defect');
assert(result.limitations.includes('HEALTHY_OTHER_OBJECT'));
result=analyze('Проверен кабель камеры: исправен. Обнаружен обрыв кабеля камеры.').result;
assert.equal(result.status,'CONFLICT');
assert.equal(result.selectedEquipment,null,'No invented chronology');
assert.equal(analyze('Неисправностей не обнаружено. Обнаружен обрыв кабеля камеры.').result.status,'CONFLICT');
const ambiguous=api.fromPreparedRecords([...paths,['СВН','Кабель камеры','Обрыв','Причина']]);
result=analyze('Обнаружен обрыв кабеля камеры.',{},ambiguous).result;
assert.equal(result.status,'AMBIGUOUS_EQUIPMENT','Reported SVR alone must not resolve a generic cable');
assert.equal(analyze('Обнаружен обрыв кабеля камеры СВР.',{},ambiguous).result.selectedEquipment,'СВР');
const dataset={records:paths.map(([equipment,element,failure,cause])=>({equipment,element,failure,cause})),validation:{status:'valid'},meta:{dataVersion:'synthetic-1'}};
const alias={level:'element',term:'БП',canonical:'Блок питания',scope:['СВР'],kind:'equivalent',status:'approved',source:'Synthetic test dictionary'};
const aliased=api.buildContext(indexApi.buildIndex(dataset,{aliases:[alias]}));
assert.equal(analyze('Выявлен отказ БП.',{},aliased).result.failedObject.canonical,'Блок питания');
assert.equal(analyze('Выявлен отказ БП.').result.selectedEquipment,null,'No implicit unapproved alias');
const proposed=api.buildContext(indexApi.buildIndex(dataset,{aliases:[{...alias,status:'proposed'}]}));
assert.equal(analyze('Выявлен отказ БП.',{},proposed).result.selectedEquipment,null);
const collision=api.buildContext(indexApi.buildIndex(dataset,{aliases:[alias,{...alias,canonical:'Камера'}]}));
assert.equal(analyze('Выявлен отказ БП.',{},collision).result.status,'AMBIGUOUS_OBJECT');
assert.throws(()=>api.fromPreparedRecords([{equipment:'СВР',element:'Камера',failure:'Отказ',cause:'Причина',disabled:false}]),/RAW_CLASSIFIER/);
assert.throws(()=>api.fromPreparedRecords([['СВР','Камера','Отказ','Причина','Да']]),/RAW_CLASSIFIER/);
const input={number:'INC-1',description:'Нет изображения',closureNote:'Выявлен отказ камеры.'};
for(const name of ['sourceEquipment','expertPath','sourceElement','legacyResult'])Object.defineProperty(input,name,{get(){throw Error('Forbidden field');}});
event=globalThis.ReclassifierEventAssessmentV4.analyze(input);
const before=JSON.stringify(event),dictionaryBefore=JSON.stringify(dataset);
result=api.analyze(event,context);
assert.equal(JSON.stringify(event),before);
assert.equal(JSON.stringify(dataset),dictionaryBefore);
assert(Object.isFrozen(result.targets[0].evidence));
const service=globalThis.ReclassifierEventAssessmentV4.analyze({number:'RITM-1',shortDescription:'Плановое ТО',closureNote:'ТО выполнено. Неисправностей не обнаружено.'});
assert.equal(api.analyze(service,context).status,'NOT_APPLICABLE');
console.log('V4-07: diagnostic binding, separate roles, grammar, aliases, parent ambiguity, instances, contradictions, source spans and immutability PASS');

for(const text of ['Измерено отсутствие питания камеры.','Выявлен отказ питания камеры.','Проверено: камера не работает.'])assert.equal(analyze(text).result.selectedEquipment,null,text);

result=analyze('Обнаружен   обрыв кабеля камеры.').result;
assert.equal(result.status,'SELECTED');
assert.equal('Обнаружен   обрыв кабеля камеры.'.slice(result.targets[0].evidence[0].anchorStart,result.targets[0].evidence[0].anchorEnd),'обрыв');
assert.equal(analyze('Выявлен отказ камеры-1. Выявлен отказ камеры-2.').result.status,'MULTIPLE_OBJECTS');

assert.equal(analyze('Обнаружен обрыв кабеля камеры СВР. Обнаружен обрыв кабеля камеры СВН.',{},ambiguous).result.status,'MULTIPLE_OBJECTS');
const scopedAlias=api.buildContext(indexApi.buildIndex({...dataset,records:[...dataset.records,{equipment:'СВН',element:'Блок питания',failure:'Отказ',cause:'Причина'}]},{aliases:[alias,{...alias,scope:['СВН']}]}));
assert.equal(analyze('Выявлен отказ БП СВР.',{},scopedAlias).result.selectedEquipment,'СВР');
assert.equal(analyze('Выявлен отказ БП.',{},scopedAlias).result.selectedEquipment,null);

assert.equal(analyze('Измерено отсутствие питания камеры. Выявлен отказ блока питания.').result.failedObject.canonical,'Блок питания');
require('../src/js/modules/reclassification/diagnostics_v4.js');
const refined=analyze('Проверена камера: исправна. Обнаружен обрыв кабеля камеры.');
const renderer=globalThis.ReclassifierTechnicalDiagnosticsV4;
const rendered=renderer.cells(refined.event,{},refined.result);
assert.equal(rendered[renderer.columns.indexOf('V4: аналитический тип')],'INC');
assert.equal(rendered[renderer.columns.indexOf('V4: требуется инженерный разбор')],'Нет');
assert.equal(rendered[renderer.columns.indexOf('V4: статус выбора объекта')],'Объект выбран');
