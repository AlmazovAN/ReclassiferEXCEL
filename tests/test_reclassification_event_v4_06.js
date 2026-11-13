'use strict';
const assert = require('node:assert/strict');
require('../src/js/modules/reclassification/facts_v4.js');
require('../src/js/modules/reclassification/event_v4.js');
const api = globalThis.ReclassifierEventAssessmentV4;
const base = {number:'RITM-001', shortDescription:'Плановая настройка обзора камеры',description:'Изменить угол обзора',closureNote:'Угол обзора изменён. Неисправностей не обнаружено.'};
const run = changes => api.analyze({...base,...changes});
let r = run({});
assert.equal(r.failureState,'NON_FAILURE');
assert.equal(r.analyticalType,'RITM');
assert.equal(r.excludeFromReclassification,true);
assert.equal(r.reviewRequired,false);
assert.deepEqual(r.candidatePath,[null,null,null,null]);
assert.equal(r.readyForApply,false);
for (const source of ['RITM-1','INC-1','unknown']) {
  const fault = run({number:source, description:'Нет изображения камеры',closureNote:'Обнаружен обрыв кабеля. Кабель заменён, связь восстановлена.'});
  assert.equal(fault.failureState,'FAILURE',source);
  assert.equal(fault.analyticalType,'INC',source);
  assert.equal(fault.excludeFromReclassification,false);
  assert.equal(fault.nextAction,'CONTINUE_TECHNICAL_CLASSIFICATION');
}
r = run({number:'INC-1'});
assert.equal(r.failureState,'NON_FAILURE');
assert.equal(r.analyticalType,'UNKNOWN');
assert.equal(r.policyPending,'INC_NON_FAILURE_V4_12');
assert.equal(r.excludeFromReclassification,false);
for (const text of ['Заменили блок питания.','Возможно обнаружен обрыв кабеля.','Обрыв не подтверждён.','Не обнаружен обрыв кабеля.','Ранее обнаружен обрыв кабеля.','Если обнаружен обрыв, заменить кабель.','Связь восстановлена после замены БП.']) {
  assert.equal(run({shortDescription:'Проверка',description:'Нет изображения',closureNote:text}).failureState,'UNKNOWN',text);
}
r = run({shortDescription:'Проверка',description:'Нет изображения',closureNote:'Неисправностей не обнаружено.'});
assert.equal(r.failureState,'UNKNOWN','Negative check must not erase unresolved symptoms');
r = run({description:'',closureNote:'Обнаружен обрыв кабеля. По результатам проверки оборудование исправно.'});
assert.equal(r.failureState,'CONFLICT');
assert.equal(r.nextAction,'MANUAL_REVIEW');
assert.equal(run({description:'',closureNote:'Демонтаж завершён.'}).failureState,'NON_FAILURE');
assert.equal(run({shortDescription:'Монтаж',description:'',closureNote:'Монтаж не выполнен.'}).failureState,'UNKNOWN');
assert.equal(run({shortDescription:'Монтаж',description:'Возможно повреждён кабель',closureNote:'Монтаж завершён.'}).failureState,'UNKNOWN');
assert.equal(run({description:'',closureNote:42}).failureState,'UNKNOWN');
assert.equal(run({shortDescription:'Монтаж',description:'',closureNote:''}).failureState,'UNKNOWN');
assert.equal(api.analyze({number:'RITM-1'}).failureState,'UNKNOWN');
assert.equal(api.analyze({number:'INCIDENT'}).sourceType,'UNKNOWN');
assert.equal(api.analyze({number:'  ritm12345 '}).sourceType,'RITM');
const input={number:'RITM-1',description:'Нет связи',closureNote:'Выявлено короткое замыкание кабеля.'};
const before=JSON.stringify(input);r=api.analyze(input);
assert.equal(r.failureState,'FAILURE');
for(const e of r.evidence) assert.equal(input[e.field].slice(e.start,e.end),e.text);
assert.equal(JSON.stringify(input),before);
assert(Object.isFrozen(r.evidence[0]));
for(const field of ['sourceEquipment','expertPath','requestType','closingCode','legacyResult']) {
  Object.defineProperty(input,field,{get(){throw Error('Forbidden read: '+field);}});
}
assert.equal(api.analyze(input).failureState,'FAILURE');
console.log('V4-06 event gate: service, hidden RITM failures, unknowns, conflicts, evidence, isolation PASS');

assert.equal(api.analyze({number:'RITM-1',closureNote:'Измерено отсутствие входного напряжения.'}).failureState,'FAILURE');
assert.equal(api.analyze({number:'RITM-1',closureNote:'Проверено: камера не работает.'}).failureState,'FAILURE');
assert.equal(api.analyze({number:'RITM-1',closureNote:'Не обнаружено отсутствие питания.'}).failureState,'UNKNOWN');

assert.equal(run({description:'Нет напряжения',closureNote:'Монтаж завершён.'}).failureState,'UNKNOWN');
