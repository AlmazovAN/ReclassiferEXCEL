'use strict';
const assert=require('node:assert/strict');
for(const name of ['classifier_index_v4','facts_v4','event_v4','objects_v4','elements_v4','failure_v4','cause_v4','path_review_v4'])
 require('../src/js/modules/reclassification/'+name+'.js');
const index=globalThis.ReclassifierClassifierIndexV4,o=globalThis.ReclassifierObjectAssessmentV4;
const el=globalThis.ReclassifierElementAssessmentV4,f=globalThis.ReclassifierFailureAssessmentV4;
const c=globalThis.ReclassifierCauseAssessmentV4,audit=globalThis.ReclassifierPathReviewV4;
const rows=[['СВР','Кабель камеры','Обрыв','Механическое повреждение'],
 ['СВР','Кабель камеры','Обрыв','Причина не установлена (Акт, фото)']];
const records=rows.map(([equipment,element,failure,cause])=>({equipment,element,failure,cause}));
const approved=[
 {canonical:'Механическое повреждение',kind:'factual_cause',scope:['СВР','Кабель камеры','Обрыв'],status:'approved',source:'synthetic-approved'},
 {canonical:'Причина не установлена (Акт, фото)',kind:'explicit_unknown',scope:['СВР','Кабель камеры','Обрыв'],status:'approved',source:'synthetic-approved'}
];
const ctx=o.buildContext(index.buildIndex({records,validation:{status:'valid'},meta:{dataVersion:'synthetic-1'}},{causeSemantics:approved}));
const unapproved=o.fromPreparedRecords(rows);
function run(note,context=ctx){
 const event=globalThis.ReclassifierEventAssessmentV4.analyze({number:'INC-1',description:'Нет изображения',closureNote:note});
 const objects=o.analyze(event,context),element=el.analyze(objects,context);
 const failure=f.analyze(element,objects,context),cause=c.analyze(failure,event,context);
 return {event,objects,element,failure,cause,review:audit.analyze(event,objects,element,failure,cause,context)};
}
let r=run('Обнаружен обрыв кабеля камеры СВР. Причина: Механическое повреждение.');
assert.equal(r.review.status,'COMPLETE_UNVERIFIED');
assert.equal(r.review.classificationComplete,true);
assert.deepEqual(r.review.candidatePath,rows[0]);
assert.equal(r.review.readyForApply,false);
assert.equal(r.review.independentlyVerified,false);
assert(Object.isFrozen(r.review.trace));
const unknown=run('Обнаружен обрыв кабеля камеры СВР. Причина не установлена.');
assert.equal(unknown.review.status,'EXPLICIT_UNKNOWN_CAUSE');
assert.equal(unknown.review.causalMechanismKnown,false);
assert.equal(unknown.review.readyForApply,false);
assert.equal(run('Обнаружен обрыв кабеля камеры СВР. Кабель заменён.').review.status,'INCOMPLETE');
assert.equal(run('Обнаружен обрыв кабеля камеры СВР. Причина: Механическое повреждение.',unapproved).review.status,'INCOMPLETE');
const corrupted={...r.cause,candidatePath:['СВР','Кабель камеры','Обрыв','Другая причина']};
assert.equal(audit.analyze(r.event,r.objects,r.element,r.failure,corrupted,ctx).status,'INCONSISTENT');
const changed={...r.cause,evidence:[{...r.cause.evidence[0],text:'подмена'}]};
const invalid=audit.analyze(r.event,r.objects,r.element,r.failure,changed,ctx);
assert.equal(invalid.status,'INCONSISTENT');
assert(invalid.blockers.includes('CAUSE_EVIDENCE_SPAN_INVALID'));
const cross={...r.failure,selectedElement:'Камера'};
assert.equal(audit.analyze(r.event,r.objects,r.element,cross,r.cause,ctx).status,'INCONSISTENT');
const before=JSON.stringify(r.event),source=JSON.stringify(records);
audit.analyze(r.event,r.objects,r.element,r.failure,r.cause,ctx);
assert.equal(JSON.stringify(r.event),before);assert.equal(JSON.stringify(records),source);
const guarded={...r.cause};Object.defineProperty(guarded,'expertPath',{get(){throw Error('forbidden source');}});
assert.equal(audit.analyze(r.event,r.objects,r.element,r.failure,guarded,ctx).status,'COMPLETE_UNVERIFIED');
console.log('V4-11: exact full path, cause semantics, evidence spans, cross-level integrity, unknown mechanism, no apply PASS');
