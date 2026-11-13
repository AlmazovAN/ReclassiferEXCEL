'use strict';
const assert=require('node:assert/strict');
require('../src/js/modules/reclassification/classifier_index_v4.js');
require('../src/js/modules/reclassification/facts_v4.js');
require('../src/js/modules/reclassification/event_v4.js');
require('../src/js/modules/reclassification/objects_v4.js');
require('../src/js/modules/reclassification/elements_v4.js');
require('../src/js/modules/reclassification/failure_v4.js');
const o=globalThis.ReclassifierObjectAssessmentV4,e=globalThis.ReclassifierElementAssessmentV4,f=globalThis.ReclassifierFailureAssessmentV4;
const context=o.fromPreparedRecords([['СВР','Кабель камеры','Обрыв','Причина'],['СВР','Кабель камеры','Повреждение','Причина'],['СВР','Камера','Отказ','Причина'],['СВН','Кабель камеры','Обрыв','Причина']]);
function run(closing,ctx=context){
 const assessment=globalThis.ReclassifierEventAssessmentV4.analyze({number:'INC-1',description:'Нет изображения камеры',closureNote:closing});
 const objects=o.analyze(assessment,ctx),element=e.analyze(objects,ctx);
 return {assessment,objects,element,result:f.analyze(element,objects,ctx)};
}
let r=run('Обнаружен обрыв кабеля камеры СВР.');
assert.equal(r.element.status,'SELECTED');
assert.equal(r.result.status,'SELECTED');
assert.equal(r.result.selectedFailure,'Обрыв');
assert.deepEqual(r.result.candidatePath,['СВР','Кабель камеры','Обрыв',null]);
assert.equal(r.result.evidence[0].text,'обрыв');
assert.equal(r.result.readyForApply,false);
assert.equal(r.result.independentlyVerified,false);
assert(Object.isFrozen(r.result.evidence[0]));
assert.equal(run('Обнаружен обрыв кабеля камеры.').result.status,'BLOCKED_BY_ELEMENT');
assert.equal(run('Кабель камеры заменён.').result.selectedFailure,null);
assert.equal(run('Возможно повреждение кабеля камеры СВР.').result.selectedFailure,null);
assert.equal(run('Обнаружена неисправность кабеля камеры СВР.').result.status,'UNRESOLVED');
const missing=f.analyze({status:'SELECTED',selectedEquipment:'СВР',selectedElement:'Кабель камеры',
 evidence:{targets:[]}}, {status:'SELECTED',effectiveFailureState:'FAILURE'},context);
assert.equal(missing.status,'UNRESOLVED');
assert.equal(f.analyze({status:'NOT_APPLICABLE'}, {status:'NOT_APPLICABLE'},context).status,'NOT_APPLICABLE');
const before=JSON.stringify(r.objects),prev=JSON.stringify(r.element);f.analyze(r.element,r.objects,context);
assert.equal(JSON.stringify(r.objects),before);assert.equal(JSON.stringify(r.element),prev);
const guarded={...r.element};Object.defineProperty(guarded,'sourceFailure',{get(){throw Error('forbidden label');}});
assert.equal(f.analyze(guarded,r.objects,context).selectedFailure,'Обрыв');
console.log('V4-09: evidence-bound third level, admissible branches and no implicit fallback PASS');
