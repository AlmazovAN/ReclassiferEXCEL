// V4-08: independent element selection from a V4-07 diagnosed object.
// Only active V4-04 branches are admissible; never read legacy or engineering labels.
(() => {
  'use strict';
  const version='4.0.0-elements.1';
  const freeze=x=>{if(x&&typeof x==='object'&&!Object.isFrozen(x)){Object.values(x).forEach(freeze);Object.freeze(x);}return x;};
  function analyze(objects,context){
    if(!objects||!context?.index?.list)throw new TypeError('V4_OBJECT_AND_INDEX_REQUIRED');
    const failures=context.index.list();
    const equipment=objects.selectedEquipment||null;
    const identified=objects.failedObject||null;
    let status='UNRESOLVED',selectedElement=null;
    const limitations=[],candidates=[];
    if(objects.status==='NOT_APPLICABLE'||objects.effectiveFailureState==='NON_FAILURE'){
      status='NOT_APPLICABLE';
    }else if(objects.status!=='SELECTED'||!equipment||objects.effectiveFailureState!=='FAILURE'){
      status='BLOCKED_BY_OBJECT';
      limitations.push('FIRST_LEVEL_NOT_RESOLVED');
    }else{
      const branches=failures.filter(b=>b.path[0]===equipment);
      if(!branches.length){status='INVALID_EQUIPMENT';limitations.push('EQUIPMENT_NOT_IN_ACTIVE_CLASSIFIER');}
      else if(identified?.level!=='element'){
        status='UNRESOLVED';limitations.push('EQUIPMENT_OBJECT_IS_NOT_ELEMENT_EVIDENCE');
        candidates.push(...new Set(branches.map(b=>b.path[1])));
      }else{
        const allowed=branches.filter(b=>b.path[1]===identified.canonical);
        if(!allowed.length){status='NOT_IN_CLASSIFIER';limitations.push('FAILED_OBJECT_NOT_ALLOWED_ELEMENT');}
        else{
          candidates.push(...new Set(allowed.map(b=>b.path[1])));
          if(candidates.length===1){
            selectedElement=candidates[0];status='SELECTED';
          }else{status='AMBIGUOUS_ELEMENT';limitations.push('MULTIPLE_CANONICAL_ELEMENTS');}
        }
      }
    }
    return freeze({version,status,selectedEquipment:equipment,selectedElement,
      evidence:status==='SELECTED'?{source:'V4-07 diagnosed failed element',object:identified.canonical,
        instance:identified.instance||null,selectionMode:identified.selectionMode,
        targets:objects.targets.filter(t=>t.level==='element'&&t.canonical===identified.canonical)
          .map(t=>({field:t.field,start:t.start,end:t.end,text:t.text,evidence:t.evidence}))}:null,
      elementCandidates:candidates,limitations,candidatePath:[equipment,selectedElement,null,null],
      provenance:context.provenance,reviewRequired:status!=='SELECTED'&&status!=='NOT_APPLICABLE',
      readyForApply:false,independentlyVerified:false});
  }
  globalThis.ReclassifierElementAssessmentV4=Object.freeze({version,analyze});
})();
