// V4-12: conservative, read-only engineering-review routing and admission policy.
// Does NOT approve/apply independent V4 classification and does not read source/expert answers.
(() => {
 'use strict';
 const version='4.0.0-review-policy.1';
 const freeze=x=>{if(x&&typeof x==='object'&&!Object.isFrozen(x)){Object.values(x).forEach(freeze);Object.freeze(x);}return x;};
 const strongIssues=new Set([
  'INCONSISTENT_STAGE_PATHS','CROSS_STAGE_PARENT_MISMATCH','PATH_NOT_EXACT_IN_CLASSIFIER',
  'CAUSE_EVIDENCE_SPAN_INVALID','FAILURE_EVIDENCE_SPAN_INVALID',
  'CLASSIFIER_PROVENANCE_MISMATCH','UNEXPECTED_UPSTREAM_APPLY_FLAG',
  'UNSUPPORTED_INDEPENDENT_VERIFICATION','NON_FAILURE_STAGE_CONFLICT'
 ]);
 function assess(event,objects,element,failure,cause,pathReview){
   if(!event?.extraction?.facts||!objects||!element||!failure||!cause||!pathReview?.stageStatuses)
     throw new TypeError('V4_REVIEW_POLICY_INPUT_REQUIRED');
   const issues=[],steps=[],conflicts=[];
   const add=(code,action)=>{if(!issues.includes(code))issues.push(code);if(action&&!steps.includes(action))steps.push(action);};
   const original=event.sourceType;
   const nonFailure=objects.status==='NOT_APPLICABLE' && pathReview.status==='NOT_APPLICABLE';
   let status,route;
   const upstream=[objects,element,failure,cause,pathReview];
   if(upstream.some(x=>x.readyForApply===true)){add('UNEXPECTED_APPLY_FLAG','Проверить режим применения');conflicts.push('UNEXPECTED_APPLY_FLAG');}
   if(event.failureState==='CONFLICT'){
     add('CONTRADICTORY_DIAGNOSTICS','Сопоставить утверждения о неисправности и исправности, объекты и контекст');
     conflicts.push('DIAGNOSTIC_CONFLICT');
   }
   if(objects.status==='CONFLICT'||objects.limitations?.includes('SAME_OR_UNSCOPED_CONTRADICTION')){
     add('CONTRADICTORY_OBJECT_DIAGNOSIS','Разделить утверждения по объектам и моментам времени');
     conflicts.push('OBJECT_CONFLICT');
   }
   for(const code of pathReview.blockers||[])if(strongIssues.has(code)){
     add(code,'Проверить согласованность пути, версии справочника и доказательственных фрагментов');
     conflicts.push(code);
   }
   if(nonFailure&&!conflicts.length){
     if(original==='RITM'){
       status='EXCLUDE_ORDINARY_RITM';route='EXCLUDE_FROM_V4';
       add('CONFIRMED_ORDINARY_SERVICE','Оставить классификацию незаполненной');
     }else if(original==='INC'){
       status='REVIEW_INC_NON_FAILURE';route='MANUAL_REVIEW';
       add('INC_NON_FAILURE_POLICY','Инженер проверяет тип обращения и факт отказа; INC автоматически не изменяется');
     }else{
       status='REVIEW_UNKNOWN_TYPE';route='MANUAL_REVIEW';
       add('SOURCE_TYPE_UNDETERMINED','Подтвердить тип обращения');
     }
   }else if(conflicts.length){
     status='CONFLICT_REVIEW';route='MANUAL_REVIEW';
   }else if(event.failureState==='UNKNOWN'||objects.effectiveFailureState==='UNKNOWN'){
     status='INSUFFICIENT_EVIDENCE';route='MANUAL_REVIEW';
     add('FAILURE_NOT_ESTABLISHED','Уточнить результаты диагностики и факт отказа');
   }else if(pathReview.status==='INCONSISTENT'){
     status='PATH_CONSISTENCY_REVIEW';route='MANUAL_REVIEW';
     add('INCONSISTENT_CLASSIFICATION','Проверить установленные уровни и словарь');
   }else if(pathReview.status==='EXPLICIT_UNKNOWN_CAUSE'){
     status='REVIEW_UNKNOWN_CAUSE';route='MANUAL_REVIEW';
     add('EXPLICIT_UNKNOWN_CAUSE','Проверить документальное основание неизвестной причины; не считать установленной физической причиной');
   }else if(pathReview.status==='COMPLETE_UNVERIFIED'){
     status='CANDIDATE_FOR_ENGINEER';route='MANUAL_REVIEW';
     add('FOUR_LEVEL_CANDIDATE_UNVERIFIED','Инженер должен отдельно подтвердить все четыре уровня и достоверность данных');
   }else{
     status='INCOMPLETE_REVIEW';route='MANUAL_REVIEW';
     add('INCOMPLETE_CLASSIFICATION','Уточнить недостающие технические факты и состав оборудования');
   }
   if(event.policyPending)add('INC_NON_FAILURE_POLICY_PENDING','Не выполнять автоматическую смену типа обращения');
   // A conflict cannot be overruled by a later positive conclusion or an engineer-looking label.
   const eligibleForEngineerReview=status==='CANDIDATE_FOR_ENGINEER'||status==='REVIEW_UNKNOWN_CAUSE';
   return freeze({version,status,route,sourceType:original,diagnosticFailureState:event.failureState,
     resolvedFailureState:objects.effectiveFailureState,pathStatus:pathReview.status,
     candidatePath:pathReview.candidatePath.slice(),issues,conflicts,reviewSteps:steps,
     eligibleForEngineerReview,engineeringApproved:false,autoApplyAllowed:false,
     readyForApply:false,independentlyVerified:false,reviewRequired:route==='MANUAL_REVIEW',
     noDataMutation:true});
 }
 globalThis.ReclassifierReviewPolicyV4=Object.freeze({version,assess});
})();
