// V4-10 conservative fourth level. A dictionary label is not causal evidence.
(() => {
'use strict';
const version='4.0.0-cause.1';
const freeze=x=>{if(x&&typeof x==='object'&&!Object.isFrozen(x)){Object.values(x).forEach(freeze);Object.freeze(x);}return x;};
const norm=s=>typeof s==='string'?s.toLocaleLowerCase('ru-RU').replace(/ё/g,'е').replace(/\s+/g,' ').trim():'';
const causal=/(?:из-за|вследствие|по причине|причина(?: отказа| неисправности)?\s*[:—-]|вызван[а-я]*\s+)/iu;
const maybe=/возможн[а-я]*|вероятн[а-я]*|предположительн[а-я]*|под вопросом|не подтвержден[а-я]*|ранее/iu;
const unknown=/причина\s+(?:не\s+(?:установлена|выявлена|определена)|неизвестна)/iu;
const match=(text,term)=>norm(text).includes(norm(term))&&Boolean(norm(term));
function analyze(failure,event,context){
 if(!failure||!event?.extraction?.facts||!context?.index?.list||!context.index.causeSemantics)
   throw new TypeError('V4_CAUSE_INPUT_REQUIRED');
 const prefix=[failure.selectedEquipment,failure.selectedElement,failure.selectedFailure];
 let status='BLOCKED_BY_FAILURE',selectedCause=null,semanticKind=null;
 const evidence=[],limitations=[],causeCandidates=[],candidatePath=[...prefix,null];
 if(failure.status==='NOT_APPLICABLE')status='NOT_APPLICABLE';
 else if(failure.status!=='SELECTED'||prefix.some(v=>!v))limitations.push('PRIOR_LEVEL_UNRESOLVED');
 else {
   const branches=context.index.list().filter(b=>prefix.every((v,i)=>b.path[i]===v));
   causeCandidates.push(...new Set(branches.map(b=>b.path[3])));
   if(!branches.length){status='INVALID_PREFIX';limitations.push('PREFIX_NOT_IN_CLASSIFIER');}
   else {
     const found=new Set(),issues=new Set();
   const diagnosedFields=new Set((failure.evidence||[]).map(e=>e.field));
     for(const fact of event.extraction.facts){
       if(!diagnosedFields.has(fact.field))continue;
       if(!['closureNote','extraReason'].includes(fact.field)&&fact.kind!=='diagnosis')continue;
       if(['hypothesis','planned','ambiguous','negated'].includes(fact.assertion))continue;
       const text=fact.text;
       if(maybe.test(norm(text)))continue;
       const isUnknown=unknown.test(norm(text));
       if(!isUnknown&&!causal.test(norm(text)))continue;
       for(const b of branches){
         const sem=context.index.causeSemantics(b.path),cause=b.path[3];
         if(sem.status!=='REVIEWED_LABEL'||sem.requiresEngineeringReview){
           issues.add(sem.status==='CONFLICT'?'CONFLICTING_CAUSE_SEMANTICS':'UNREVIEWED_CAUSE_SEMANTICS');continue;
         }
         if(!['factual_cause','explicit_unknown'].includes(sem.kind))continue;
         const supported=sem.kind==='explicit_unknown'?isUnknown:!isUnknown&&match(text,cause);
         if(!supported)continue;
         found.add(cause);
         evidence.push({cause,semanticKind:sem.kind,field:fact.field,factId:fact.id,
           start:fact.start,end:fact.end,text:fact.text,
           semanticSources:sem.entries.filter(x=>x.status==='approved').map(x=>x.source)});
       }
     }
     if(found.size===1){
       status='SELECTED';selectedCause=[...found][0];candidatePath[3]=selectedCause;
       semanticKind=context.index.causeSemantics([...prefix,selectedCause]).kind;
     }else if(found.size>1){status='AMBIGUOUS_CAUSE';limitations.push('MULTIPLE_SUPPORTED_CAUSES');}
     else {status='UNRESOLVED';limitations.push('NO_APPROVED_EXPLICIT_CAUSE_EVIDENCE');limitations.push(...issues);}
   }
 }
 return freeze({version,status,selectedEquipment:prefix[0]||null,selectedElement:prefix[1]||null,
  selectedFailure:prefix[2]||null,selectedCause,semanticKind,causeCandidates,evidence,limitations,
  candidatePath,provenance:context.provenance,reviewRequired:status!=='SELECTED'&&status!=='NOT_APPLICABLE',
  readyForApply:false,independentlyVerified:false});
}
globalThis.ReclassifierCauseAssessmentV4=Object.freeze({version,analyze});
})();
