// V4-09: evidence-bound third classifier level. No source/engineering/legacy labels.
(() => {
 'use strict';
 const version='4.0.0-failure.1';
 const freeze=x=>{if(x&&typeof x==='object'&&!Object.isFrozen(x)){Object.values(x).forEach(freeze);Object.freeze(x);}return x;};
 const norm=s=>typeof s==='string'?s.toLocaleLowerCase('ru-RU').replace(/ё/g,'е').replace(/\s+/g,' ').trim():'';
 const escape=s=>s.replace(/[.*+?^$()|[\]{}\\]/g,'\\$&');
 const variants=Object.freeze({
   'обрыв':'обрыв(?:а|ом|е|ы|ов)?',
   'отказ':'отказ(?:а|ом|е|ы|ов)?',
   'повреждение':'повреждени(?:е|я|ю|ем|и|й|ям|ями|ях)',
   'короткое замыкание':'коротк(?:ое|ого|ому|им|ом|ие|их|ими)\\s+замыкани(?:е|я|ю|ем|и|й|ям|ями|ях)'
 });
 function matches(text,term){
   const n=norm(term),pattern=variants[n]||escape(n);
   return new RegExp('(^|[^\\p{L}\\p{N}_])(?:'+pattern+')(?=$|[^\\p{L}\\p{N}_])','u').test(norm(text));
 }
 function analyze(elements,objects,context){
   if(!elements||!objects||!context?.index?.list)throw new TypeError('V4_FAILURE_INPUT_REQUIRED');
   const equipment=elements.selectedEquipment||null,element=elements.selectedElement||null;
   const limitations=[],evidence=[],candidatePath=[equipment,element,null,null];
   let status='BLOCKED_BY_ELEMENT',selectedFailure=null;
   const candidates=[];
   if(elements.status==='NOT_APPLICABLE'||objects.status==='NOT_APPLICABLE')status='NOT_APPLICABLE';
   else if(elements.status!=='SELECTED'||objects.status!=='SELECTED'||!equipment||!element||
           objects.effectiveFailureState!=='FAILURE')limitations.push('PRIOR_LEVEL_UNRESOLVED');
   else {
     const branches=context.index.list().filter(b=>b.path[0]===equipment&&b.path[1]===element);
     candidates.push(...new Set(branches.map(b=>b.path[2])));
     if(!branches.length){status='INVALID_PREFIX';limitations.push('PREFIX_NOT_IN_CLASSIFIER');}
     else {
       const matching=new Set();
       // Only anchored failure evidence from the identified object, not free-text symptoms.
       for(const target of (elements.evidence?.targets||[]))for(const e of (target.evidence||[])){
         if(!Number.isInteger(e.anchorStart)||!Number.isInteger(e.anchorEnd)||
            e.anchorStart<e.start||e.anchorEnd>e.end||e.anchorEnd<=e.anchorStart)continue;
         const phrase=e.text.slice(e.anchorStart-e.start,e.anchorEnd-e.start);
         for(const failure of candidates)if(matches(phrase,failure)){
           matching.add(failure);
           evidence.push({failure,field:e.field,factId:e.factId,start:e.anchorStart,end:e.anchorEnd,
             text:phrase,object:element,objectStart:e.mentionStart,objectEnd:e.mentionEnd});
         }
       }
       if(matching.size===1){status='SELECTED';selectedFailure=[...matching][0];candidatePath[2]=selectedFailure;}
       else if(matching.size>1){status='AMBIGUOUS_FAILURE';limitations.push('MULTIPLE_MATCHING_DEFECTS');}
       else {status='UNRESOLVED';limitations.push('NO_EXACT_DIAGNOSTIC_FAILURE_EVIDENCE');}
     }
   }
   return freeze({version,status,selectedEquipment:equipment,selectedElement:element,selectedFailure,
     failureCandidates:candidates,evidence,limitations,candidatePath,
     provenance:context.provenance,reviewRequired:status!=='SELECTED'&&status!=='NOT_APPLICABLE',
     readyForApply:false,independentlyVerified:false});
 }
 globalThis.ReclassifierFailureAssessmentV4=Object.freeze({version,analyze});
})();
