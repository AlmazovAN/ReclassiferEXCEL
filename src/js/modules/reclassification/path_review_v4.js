// V4-11: audit consistency of four independent V4 decisions, never apply them.
(() => {
'use strict';
const version='4.0.0-path-review.1';
const freeze=x=>{if(x&&typeof x==='object'&&!Object.isFrozen(x)){Object.values(x).forEach(freeze);Object.freeze(x);}return x;};
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
function analyze(event,objects,element,failure,cause,context){
 if(!event?.extraction?.facts||!objects||!element||!failure||!cause||!context?.index?.lookup)
   throw new TypeError('V4_PATH_REVIEW_INPUT_REQUIRED');
 const stages=[objects,element,failure,cause];
 const statuses={object:objects.status,element:element.status,failure:failure.status,cause:cause.status};
 const path=[objects.selectedEquipment||null,element.selectedElement||null,
   failure.selectedFailure||null,cause.selectedCause||null];
 const blockers=[],warnings=[],trace=[];
 if(stages.some(stage=>stage.readyForApply===true))blockers.push('UNEXPECTED_UPSTREAM_APPLY_FLAG');
 if(stages.some(stage=>stage.independentlyVerified===true)||event.independentlyVerified===true)
   blockers.push('UNSUPPORTED_INDEPENDENT_VERIFICATION');
 if(objects.status==='NOT_APPLICABLE'||event.failureState==='NON_FAILURE'){
   if(stages.some(stage=>stage.status!=='NOT_APPLICABLE'))blockers.push('NON_FAILURE_STAGE_CONFLICT');
 }else{
   if(objects.effectiveFailureState!=='FAILURE')blockers.push('FAILURE_NOT_ESTABLISHED');
   if(objects.status!=='SELECTED')blockers.push('OBJECT_NOT_SELECTED');
   if(element.status!=='SELECTED')blockers.push('ELEMENT_NOT_SELECTED');
   if(failure.status!=='SELECTED')blockers.push('FAILURE_NOT_SELECTED');
   if(cause.status!=='SELECTED')blockers.push('CAUSE_NOT_SELECTED');
 }
 const declared=[
  objects.candidatePath,
  element.candidatePath,
  failure.candidatePath,
  cause.candidatePath
 ];
 if(declared.some((p,i)=>!Array.isArray(p)||p.length!==4||
     !same(p,[
       [path[0],null,null,null],
       [path[0],path[1],null,null],
       [path[0],path[1],path[2],null],
       path
     ][i])))blockers.push('INCONSISTENT_STAGE_PATHS');
 if(element.selectedEquipment!==path[0]||failure.selectedEquipment!==path[0]||
    failure.selectedElement!==path[1]||cause.selectedEquipment!==path[0]||
    cause.selectedElement!==path[1]||cause.selectedFailure!==path[2])
    blockers.push('CROSS_STAGE_PARENT_MISMATCH');
 if(stages.some(stage=>stage.provenance&&!same(stage.provenance,context.provenance)))
   blockers.push('CLASSIFIER_PROVENANCE_MISMATCH');
 if(!context.provenance?.versionIdentified)warnings.push('CLASSIFIER_VERSION_NOT_IDENTIFIED');
 if(path.every(x=>typeof x==='string'&&x.trim())){
   const found=context.index.lookup(path);
   if(found.status!=='EXACT')blockers.push(found.status==='AMBIGUOUS'?'AMBIGUOUS_CLASSIFIER_PATH':'PATH_NOT_EXACT_IN_CLASSIFIER');
   const semantic=context.index.causeSemantics(path);
   if(semantic.status!=='REVIEWED_LABEL'||semantic.requiresEngineeringReview||
      !['factual_cause','explicit_unknown'].includes(semantic.kind)||
      semantic.kind!==cause.semanticKind)blockers.push('CAUSE_SEMANTICS_NOT_APPROVED');
 }else if(path.some(Boolean))warnings.push('PARTIAL_CLASSIFICATION_PATH');
 const findFact=(entry)=>{
   const f=event.extraction.facts.find(x=>x.id===entry.factId&&x.field===entry.field);
   return f&&typeof entry.start==='number'&&typeof entry.end==='number'&&
     entry.start>=f.start&&entry.end<=f.end&&entry.start<entry.end&&
     typeof entry.text==='string'&&f.text.slice(entry.start-f.start,entry.end-f.start)===entry.text;
 };
 if(objects.status==='SELECTED'&&!objects.targets?.some(t=>t.evidence?.length))blockers.push('OBJECT_EVIDENCE_MISSING');
 if(element.status==='SELECTED'&&!element.evidence?.targets?.some(t=>t.evidence?.length))blockers.push('ELEMENT_EVIDENCE_MISSING');
 for(const e of failure.evidence||[]){
   trace.push({stage:'failure',field:e.field,start:e.start,end:e.end,text:e.text});
   if(!findFact(e))blockers.push('FAILURE_EVIDENCE_SPAN_INVALID');
 }
 if(failure.status==='SELECTED'&&!failure.evidence?.length)blockers.push('FAILURE_EVIDENCE_MISSING');
 for(const e of cause.evidence||[]){
   trace.push({stage:'cause',field:e.field,start:e.start,end:e.end,text:e.text});
   if(!findFact(e))blockers.push('CAUSE_EVIDENCE_SPAN_INVALID');
 }
 if(cause.status==='SELECTED'&&!cause.evidence?.length)blockers.push('CAUSE_EVIDENCE_MISSING');
 const causalFields=new Set((failure.evidence||[]).map(e=>e.field));
 if(cause.status==='SELECTED'&&(cause.evidence||[]).some(e=>!causalFields.has(e.field)))
   blockers.push('CAUSE_NOT_LINKED_TO_DIAGNOSIS_FIELD');
 const uniqueBlockers=[...new Set(blockers)];
 let status='INCOMPLETE';
 if(objects.status==='NOT_APPLICABLE'&&uniqueBlockers.length===0)status='NOT_APPLICABLE';
 else if(uniqueBlockers.some(code=>!['OBJECT_NOT_SELECTED','ELEMENT_NOT_SELECTED','FAILURE_NOT_SELECTED','CAUSE_NOT_SELECTED',
   'FAILURE_NOT_ESTABLISHED'].includes(code)))status='INCONSISTENT';
 else if(uniqueBlockers.length===0)status=cause.semanticKind==='explicit_unknown'?'EXPLICIT_UNKNOWN_CAUSE':'COMPLETE_UNVERIFIED';
 const complete=status==='COMPLETE_UNVERIFIED';
 return freeze({version,status,stageStatuses:statuses,candidatePath:path,
  classificationComplete:complete,causalMechanismKnown:complete,
  blockers:uniqueBlockers,warnings,trace,provenance:context.provenance,
  reviewRequired:status!=='NOT_APPLICABLE',
  readyForApply:false,independentlyVerified:false});
}
globalThis.ReclassifierPathReviewV4=Object.freeze({version,analyze});
})();
