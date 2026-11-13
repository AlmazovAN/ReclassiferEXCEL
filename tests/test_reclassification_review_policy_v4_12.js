'use strict';
const assert=require('node:assert/strict');
for(const name of ['classifier_index_v4','facts_v4','event_v4','objects_v4',
  'elements_v4','failure_v4','cause_v4','path_review_v4','review_policy_v4'])
 require('../src/js/modules/reclassification/'+name+'.js');
const i=globalThis.ReclassifierClassifierIndexV4,o=globalThis.ReclassifierObjectAssessmentV4;
const e=globalThis.ReclassifierElementAssessmentV4,f=globalThis.ReclassifierFailureAssessmentV4;
const c=globalThis.ReclassifierCauseAssessmentV4,v=globalThis.ReclassifierPathReviewV4;
const policy=globalThis.ReclassifierReviewPolicyV4;
const rows=[['СВР','Кабель камеры','Обрыв','Механическое повреждение'],['СВР','Кабель камеры','Обрыв','Причина не установлена (Акт, фото)']];
const ctx=o.buildContext(i.buildIndex({
 records:rows.map(([equipment,element,failure,cause])=>({equipment,element,failure,cause})),
 validation:{status:'valid'},meta:{dataVersion:'v4-12-synthetic'}
},{causeSemantics:[
 {canonical:'Механическое повреждение',kind:'factual_cause',scope:['СВР','Кабель камеры','Обрыв'],status:'approved',source:'synthetic'},
 {canonical:'Причина не установлена (Акт, фото)',kind:'explicit_unknown',scope:['СВР','Кабель камеры','Обрыв'],status:'approved',source:'synthetic'}
]}));
function evaluate(note,number='INC-1',description='Нет изображения'){
 const event=globalThis.ReclassifierEventAssessmentV4.analyze({number,description,closureNote:note});
 const objects=o.analyze(event,ctx),element=e.analyze(objects,ctx);
 const failure=f.analyze(element,objects,ctx),cause=c.analyze(failure,event,ctx);
 const review=v.analyze(event,objects,element,failure,cause,ctx);
 return {event,objects,element,failure,cause,review,result:policy.assess(event,objects,element,failure,cause,review)};
}
let a=evaluate('Обнаружен обрыв кабеля камеры СВР. Причина: Механическое повреждение.');
assert.equal(a.result.status,'CANDIDATE_FOR_ENGINEER');
assert.equal(a.result.route,'MANUAL_REVIEW');
assert.equal(a.result.eligibleForEngineerReview,true);
assert.equal(a.result.autoApplyAllowed,false);
assert.equal(a.result.readyForApply,false);
assert.equal(a.result.engineeringApproved,false);
assert.deepEqual(a.result.candidatePath,rows[0]);
assert(Object.isFrozen(a.result.reviewSteps));
assert.equal(evaluate('Обнаружен обрыв кабеля камеры СВР. Причина не установлена.').result.status,'REVIEW_UNKNOWN_CAUSE');
assert.equal(evaluate('Обнаружен обрыв кабеля камеры СВР. Кабель заменён.').result.status,'INCOMPLETE_REVIEW');
const conflict=policy.assess({...a.event,failureState:'CONFLICT'},a.objects,a.element,a.failure,a.cause,a.review);
assert.equal(conflict.status,'CONFLICT_REVIEW');
assert(conflict.conflicts.includes('DIAGNOSTIC_CONFLICT'));
assert.equal(policy.assess(a.event,a.objects,a.element,a.failure,a.cause,
 {...a.review,status:'INCONSISTENT',blockers:['INCONSISTENT_STAGE_PATHS']}).status,'CONFLICT_REVIEW');
const ritm=policy.assess({extraction:{facts:[]},sourceType:'RITM',failureState:'NON_FAILURE'},
 {status:'NOT_APPLICABLE',effectiveFailureState:'NON_FAILURE'},
 {status:'NOT_APPLICABLE'},{status:'NOT_APPLICABLE'},{status:'NOT_APPLICABLE'},
 {stageStatuses:{},status:'NOT_APPLICABLE',blockers:[],candidatePath:[null,null,null,null]});
assert.equal(ritm.status,'EXCLUDE_ORDINARY_RITM');assert.equal(ritm.route,'EXCLUDE_FROM_V4');
const inc=policy.assess({extraction:{facts:[]},sourceType:'INC',failureState:'NON_FAILURE',policyPending:'INC_NON_FAILURE_V4_12'},
 {status:'NOT_APPLICABLE',effectiveFailureState:'NON_FAILURE'},
 {status:'NOT_APPLICABLE'},{status:'NOT_APPLICABLE'},{status:'NOT_APPLICABLE'},
 {stageStatuses:{},status:'NOT_APPLICABLE',blockers:[],candidatePath:[null,null,null,null]});
assert.equal(inc.status,'REVIEW_INC_NON_FAILURE');assert.equal(inc.route,'MANUAL_REVIEW');
const flagged=policy.assess(a.event,{...a.objects,readyForApply:true},a.element,a.failure,a.cause,a.review);
assert.equal(flagged.status,'CONFLICT_REVIEW');assert.equal(flagged.autoApplyAllowed,false);
const snapshot=JSON.stringify(a.review);policy.assess(a.event,a.objects,a.element,a.failure,a.cause,a.review);
assert.equal(JSON.stringify(a.review),snapshot);
const guarded={...a.review};Object.defineProperty(guarded,'expertClassification',{get(){throw Error('forbidden');}});
assert.equal(policy.assess(a.event,a.objects,a.element,a.failure,a.cause,guarded).status,'CANDIDATE_FOR_ENGINEER');
console.log('V4-12: review routing, conflict priority, INC/RITM handling, unknown cause, strict no-apply PASS');
