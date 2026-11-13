'use strict';
const assert=require('node:assert/strict');
require('../src/js/modules/reclassification/classifier_index_v4.js');
require('../src/js/modules/reclassification/facts_v4.js');
require('../src/js/modules/reclassification/event_v4.js');
require('../src/js/modules/reclassification/objects_v4.js');
require('../src/js/modules/reclassification/elements_v4.js');
require('../src/js/modules/reclassification/failure_v4.js');
require('../src/js/modules/reclassification/cause_v4.js');
const o=globalThis.ReclassifierObjectAssessmentV4,el=globalThis.ReclassifierElementAssessmentV4;
const f=globalThis.ReclassifierFailureAssessmentV4,c=globalThis.ReclassifierCauseAssessmentV4;
const records=[['СВР','Кабель камеры','Обрыв','Механическое повреждение'],['СВР','Кабель камеры','Обрыв','Причина не установлена (Акт, фото)']];
const dataset={records:records.map(([equipment,element,failure,cause])=>({equipment,element,failure,cause})),validation:{status:'valid'},meta:{dataVersion:'synthetic'}};
const semantics=[
 {canonical:'Механическое повреждение',kind:'factual_cause',scope:['СВР','Кабель камеры','Обрыв'],status:'approved',source:'independent synthetic approval'},
 {canonical:'Причина не установлена (Акт, фото)',kind:'explicit_unknown',scope:['СВР','Кабель камеры','Обрыв'],status:'approved',source:'independent synthetic approval'}
];
const ctx=o.buildContext(globalThis.ReclassifierClassifierIndexV4.buildIndex(dataset,{causeSemantics:semantics}));
const defaultCtx=o.fromPreparedRecords(records);
function run(note,context=ctx){
 const event=globalThis.ReclassifierEventAssessmentV4.analyze({number:'INC-1',description:'Нет изображения',closureNote:note});
 const objects=o.analyze(event,context),element=el.analyze(objects,context),failure=f.analyze(element,objects,context);
 return {event,objects,element,failure,result:c.analyze(failure,event,context)};
}
let x=run('Обнаружен обрыв кабеля камеры СВР. Причина: Механическое повреждение.');
assert.equal(x.failure.status,'SELECTED');
assert.equal(x.result.status,'SELECTED');
assert.equal(x.result.selectedCause,'Механическое повреждение');
assert.deepEqual(x.result.candidatePath,['СВР','Кабель камеры','Обрыв','Механическое повреждение']);
assert.equal(x.result.readyForApply,false);
assert(Object.isFrozen(x.result.evidence[0]));
assert.equal(run('Обнаружен обрыв кабеля камеры СВР. Кабель заменён.').result.selectedCause,null);
assert.equal(run('Обнаружен обрыв кабеля камеры СВР. Возможно причина: Механическое повреждение.').result.selectedCause,null);
assert.equal(run('Обнаружен обрыв кабеля камеры СВР. Причина: Механическое повреждение.',defaultCtx).result.selectedCause,null);
assert.equal(run('Обнаружен обрыв кабеля камеры СВР. Причина не установлена.').result.semanticKind,'explicit_unknown');
assert.equal(c.analyze({status:'NOT_APPLICABLE'},x.event,ctx).status,'NOT_APPLICABLE');
assert.equal(c.analyze({status:'SELECTED',selectedEquipment:'СВР',selectedElement:'Камера',selectedFailure:'Обрыв'},x.event,ctx).status,'INVALID_PREFIX');
const earlier=JSON.stringify(x.event);c.analyze(x.failure,x.event,ctx);assert.equal(JSON.stringify(x.event),earlier);
const guarded={...x.failure};Object.defineProperty(guarded,'expertCause',{get(){throw Error('forbidden field');}});
assert.equal(c.analyze(guarded,x.event,ctx).selectedCause,'Механическое повреждение');
console.log('V4-10: explicit cause, approved semantics, unknown state, no arbitrary causes PASS');
