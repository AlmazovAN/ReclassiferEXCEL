// V4-07: object binding from original diagnostic evidence and the V4-04 index.
// No engineering labels, source classifications or legacy inference are read.
(() => {
  'use strict';
  const version='4.0.0-objects.1';
  const norm=value=>value.toLocaleLowerCase('ru-RU').replace(/ё/g,'е').replace(/\s+/g,' ').trim();
  const freeze=value=>{
    if(value&&typeof value==='object'&&!Object.isFrozen(value)){
      Object.values(value).forEach(freeze);Object.freeze(value);
    }
    return value;
  };
  const escape=text=>text.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  // Limited grammatical forms, not engineering equivalents or aliases.
  const families=[
    [/^камер(?:а|ы|е|у|ой|ою|ам|ами|ах)?$/, 'камер(?:а|ы|е|у|ой|ою|ам|ами|ах)?'],
    [/^кабел(?:ь|я|ю|ем|е|и|ей|ям|ями|ях)$/, 'кабел(?:ь|я|ю|ем|е|и|ей|ям|ями|ях)'],
    [/^блок(?:а|у|ом|е|и|ов|ам|ами|ах)?$/, 'блок(?:а|у|ом|е|и|ов|ам|ами|ах)?'],
    [/^питани(?:е|я|ю|ем|и|й|ям|ями|ях)$/, 'питани(?:е|я|ю|ем|и|й|ям|ями|ях)'],
    [/^коммутатор(?:а|у|ом|е|ы|ов|ам|ами|ах)?$/, 'коммутатор(?:а|у|ом|е|ы|ов|ам|ами|ах)?'],
    [/^датчик(?:а|у|ом|е|и|ов|ам|ами|ах)?$/, 'датчик(?:а|у|ом|е|и|ов|ам|ами|ах)?']
  ];
  function pattern(term){
    const words=norm(term).split(' ');
    const body=words.map(word=>families.find(([form])=>form.test(word))?.[1]||escape(word)).join('\\s+');
    return new RegExp('(^|[^\\p{L}\\p{N}_])('+body+')(?=$|[^\\p{L}\\p{N}_])','giu');
  }
  function buildContext(index){
    if(!index?.list||!index?.byComponent||!Array.isArray(index.aliases))throw new TypeError('V4_OBJECT_INDEX_REQUIRED');
    const entries=[],seen=new Set();
    const add=(level,canonical,term,scope,mode)=>{
      const key=JSON.stringify([level,canonical,term,scope]);
      if(!seen.has(key)){seen.add(key);entries.push({level,canonical,term,scope,mode,regex:pattern(term)});}
    };
    for(const branch of index.list())for(const level of ['equipment','element']){
      const canonical=branch.path[level==='equipment'?0:1];
      // Generic dictionary placeholders do not identify a physical object.
      if(!/^(другое|прочее|не определено|нет данных|все)$/i.test(canonical))add(level,canonical,canonical,[],'canonical_or_grammatical_form');
    }
    for(const alias of index.aliases)if(['equipment','element'].includes(alias.level)&&alias.status==='approved'&&alias.kind==='equivalent')
      add(alias.level,alias.canonical,alias.term,alias.scope,'approved_alias');
    const branches=index.list();
    function mentions(fact){
      const result=[];
      for(const entry of entries){
        entry.regex.lastIndex=0;
        for(const match of fact.text.matchAll(entry.regex)){
          const local=match.index+match[1].length;
          const suffix=fact.text.slice(local+match[2].length).match(/^(?:\s*№\s*([\p{L}\p{N}-]+)|\s*-\s*(\d[\p{L}\p{N}-]*))/u);
          const end=local+match[2].length+(suffix?.[0].length||0);
          result.push({level:entry.level,canonical:entry.canonical,scope:entry.scope.slice(),mode:entry.mode,
            field:fact.field,factId:fact.id,start:fact.start+local,end:fact.start+end,
            text:fact.text.slice(local,end),instance:suffix?norm(suffix[1]||suffix[2]):null});
        }
      }
      // "Камера" inside "Кабель камеры" is the dependent noun, not a second
      // failed object. Equal-span alternatives stay visible as ambiguities.
      return result.filter(m=>!result.some(other=>other.start<=m.start&&other.end>=m.end&&
        (other.start<m.start||other.end>m.end))).filter((m,i,all)=>all.findIndex(x=>
          JSON.stringify([x.level,x.canonical,x.start,x.end,x.scope])===JSON.stringify([m.level,m.canonical,m.start,m.end,m.scope]))===i);
    }
    function compatible(mention){
      return branches.filter(b=>b.path[mention.level==='equipment'?0:1]===mention.canonical&&
        mention.scope.every((value,i)=>norm(b.path[i])===norm(value)));
    }
    return Object.freeze({index,mentions,compatible,version,provenance:index.provenance});
  }
  function fromPreparedRecords(records,meta={},options={}){
    if(!Array.isArray(records))throw new TypeError('V4_PREPARED_CLASSIFIER_REQUIRED');
    const prepared=records.map(record=>{
      if(Array.isArray(record)){
        if(record.length!==4)throw new TypeError('V4_RAW_CLASSIFIER_FLAGS_NOT_ALLOWED');
        return Object.fromEntries(['equipment','element','failure','cause'].map((field,i)=>[field,record[i]]));
      }
      if(!record||typeof record!=='object'||Object.hasOwn(record,'disabled')||Object.hasOwn(record,'sadu'))
        throw new TypeError('V4_RAW_CLASSIFIER_FLAGS_NOT_ALLOWED');
      return {equipment:record.equipment,element:record.element,failure:record.failure??record.fault,cause:record.cause};
    });
    // Transport contract: callers already supply the active, filtered Dataset,
    // as for legacy processing. This adapter does not filter raw workbooks.
    const index=globalThis.ReclassifierClassifierIndexV4?.buildIndex({records:prepared,validation:{status:'valid'},meta},options);
    return buildContext(index);
  }
  const defectAnchor=/обрыв[а-я]*|коротк[а-я]* замыкани[а-я]*|неисправ[а-я]*|поврежден[а-я]*|отказ[а-я]*|разрушен[а-я]*|сгор[а-я]*|отсутств[а-я]* (?:входн[а-я]* )?(?:питани[а-я]*|напряжени[а-я]*)|не (?:работает|включается|отвечает)/g;
  function analyze(assessment,context){
    if(!assessment?.extraction?.facts||!Array.isArray(assessment.evidence)||!context?.mentions)throw new TypeError('V4_EVENT_AND_OBJECT_CONTEXT_REQUIRED');
    const roles={symptoms:[],diagnosis:[],actions:[],results:[],uncertain:[]};
    const failed=[],healthy=[],limitations=[];
    const codes=new Map();
    for(const e of assessment.evidence){if(!codes.has(e.factId))codes.set(e.factId,[]);codes.get(e.factId).push(e.code);}
    for(const fact of assessment.extraction.facts){
      const found=context.mentions(fact),evidenceCodes=codes.get(fact.id)||[];
      const uncertain=['hypothesis','planned','ambiguous'].includes(fact.assertion)||evidenceCodes.includes('HISTORICAL_OR_OTHER_EVENT');
      const role=uncertain?'uncertain':fact.kind==='action'?'actions':fact.kind==='result'?'results':
        fact.kind==='diagnosis'||evidenceCodes.includes('EXPLICIT_DIAGNOSTIC_FAILURE')||evidenceCodes.includes('EXPLICIT_NON_FAILURE_OBSERVATION')?'diagnosis':fact.kind==='symptoms'?'symptoms':'uncertain';
      roles[role].push(...found);
      if(evidenceCodes.includes('EXPLICIT_NON_FAILURE_OBSERVATION'))healthy.push({fact,found});
      if(!evidenceCodes.includes('EXPLICIT_DIAGNOSTIC_FAILURE')||uncertain)continue;
      const anchors=Array.from(fact.text.toLocaleLowerCase('ru-RU').replace(/ё/g,'е').matchAll(defectAnchor),m=>({start:fact.start+m.index,end:fact.start+m.index+m[0].length}));
      const elements=found.filter(m=>m.level==='element'),targets=elements.length?elements:found.filter(m=>m.level==='equipment');
      if(!targets.length||!anchors.length){
        const onlyFunctionLoss=anchors.length&&anchors.every(a=>/отсутств|не (?:работает|включается|отвечает)/.test(fact.text.slice(a.start-fact.start,a.end-fact.start)));
        limitations.push(onlyFunctionLoss?'LOSS_OF_FUNCTION_NOT_LOCALIZED':'UNBOUND_DIAGNOSTIC_DEFECT');continue;
      }
      for(const anchor of anchors){
        const distances=targets.map(m=>({mention:m,distance:m.start>=anchor.end?m.start-anchor.end:anchor.start>=m.end?anchor.start-m.end:0}));
        const nearest=Math.min(...distances.map(x=>x.distance));
        // A bounded lexical link is intentionally conservative. Conjunctions,
        // comparisons, negation and foreign objects are never crossed.
        const close=distances.filter(x=>x.distance===nearest&&x.distance<=60).filter(({mention:m})=>{
          const gap=fact.text.slice(Math.min(anchor.end,m.end)-fact.start,Math.max(anchor.start,m.start)-fact.start);
          return !/[;.!?]|(?:^|\s)(?:и|но|или|не|без|для|после|до)(?:\s|$)/i.test(gap);
        });
        if(!close.length){limitations.push('UNBOUND_DIAGNOSTIC_DEFECT');continue;}
        const anchorText=norm(fact.text.slice(anchor.start-fact.start,anchor.end-fact.start));
        const functional=/отсутств|не (?:работает|включается|отвечает)/.test(anchorText);
        const local=close.filter(({mention:m})=>{
          const gap=norm(fact.text.slice(Math.min(anchor.end,m.end)-fact.start,Math.max(anchor.start,m.start)-fact.start));
          return !functional&&!/(?:^|\s)(?:питания|напряжения|связи|изображения)(?:\s|$)/.test(gap);
        });
        if(!local.length){limitations.push('LOSS_OF_FUNCTION_NOT_LOCALIZED');continue;}
        for(const {mention} of local)failed.push({mention,fact,anchor});
        const ordered=targets.slice().sort((a,b)=>a.start-b.start);
        for(let i=1;i<ordered.length;i++){
          const gap=fact.text.slice(ordered[i-1].end-fact.start,ordered[i].start-fact.start);
          if(/(?:^|\s)(?:и|или|а)(?:\s|$)/i.test(gap)){
            failed.push({mention:ordered[i-1],fact,anchor},{mention:ordered[i],fact,anchor});
            limitations.push('COORDINATED_OBJECTS');
          }
        }
      }
    }
    const groups=new Map();
    for(const item of failed){
      const m=item.mention;
      const equipmentContext=[...new Set(roles.diagnosis.filter(x=>x.level==='equipment'&&x.factId===item.fact.id).map(x=>x.canonical))].sort();
      if(m.scope.length&&equipmentContext.length&&!equipmentContext.some(value=>norm(value)===norm(m.scope[0])))continue;
      const key=JSON.stringify([m.level,m.canonical,m.instance,m.scope,equipmentContext]);
      if(!groups.has(key))groups.set(key,{...m,equipmentContext,evidence:[]});
      if(groups.get(key).evidence.some(e=>e.factId===item.fact.id&&e.anchorStart===item.anchor.start&&e.mentionStart===m.start))continue;
      groups.get(key).evidence.push({field:item.fact.field,factId:item.fact.id,start:item.fact.start,end:item.fact.end,text:item.fact.text,
        mentionStart:m.start,mentionEnd:m.end,anchorStart:item.anchor.start,anchorEnd:item.anchor.end});
    }
    const targets=[...groups.values()];
    // Different unlabelled instances cannot be invented from repeated words.
    // Explicit different № values remain separate physical candidates.
    let effectiveFailureState=assessment.failureState;
    const disjointHealthy=healthy.length&&targets.length&&healthy.every(({found})=>{
      const leaves=found.filter(m=>m.level==='element');
      return leaves.length&&leaves.every(m=>targets.every(t=>t.level==='element'&&
        (m.canonical!==t.canonical||(m.instance&&t.instance&&m.instance!==t.instance))));
    });
    if(assessment.failureState==='CONFLICT'&&disjointHealthy){effectiveFailureState='FAILURE';limitations.push('HEALTHY_OTHER_OBJECT');}
    let status=effectiveFailureState==='NON_FAILURE'?'NOT_APPLICABLE':effectiveFailureState==='CONFLICT'?'CONFLICT':'UNRESOLVED';
    let selectedEquipment=null,failedObject=null,equipmentCandidates=[];
    if(targets.length>1){
      const sameSpan=targets.every(t=>t.field===targets[0].field&&t.start===targets[0].start&&t.end===targets[0].end);
      const sameObject=targets.every(t=>t.level===targets[0].level&&t.canonical===targets[0].canonical);
      status=sameSpan?(sameObject?'AMBIGUOUS_EQUIPMENT':'AMBIGUOUS_OBJECT'):'MULTIPLE_OBJECTS';
      equipmentCandidates=[...new Set(targets.flatMap(t=>context.compatible(t).map(b=>b.path[0])))];
      limitations.push(sameSpan?'AMBIGUOUS_TERM':'NO_PRIMARY_OBJECT');
    }
    else if(targets.length===1){
      const target=targets[0];
      let possible=context.compatible(target);
      const localEquipment=roles.diagnosis.filter(m=>m.level==='equipment'&&m.factId===target.factId);
      const contextualEquipment=[...roles.symptoms,...roles.diagnosis].filter(m=>m.level==='equipment');
      const scope=localEquipment; // Symptom equipment never disambiguates the failed object by itself.
      if(scope.length){
        const allowed=new Set(scope.map(m=>m.canonical));
        const scoped=possible.filter(b=>allowed.has(b.path[0]));
        if(scoped.length)possible=scoped;
        else limitations.push('EQUIPMENT_CONTEXT_MISMATCH');
      }
      equipmentCandidates=[...new Set(possible.map(b=>b.path[0]))];
      if(equipmentCandidates.length===1&&contextualEquipment.length&&!contextualEquipment.some(m=>m.canonical===equipmentCandidates[0]))limitations.push('REPORTED_EQUIPMENT_DIFFERS');
      const normalizedParents=new Set(equipmentCandidates.map(norm));
      const unsafe=limitations.some(x=>['UNBOUND_DIAGNOSTIC_DEFECT','EQUIPMENT_CONTEXT_MISMATCH'].includes(x));
      if(effectiveFailureState==='FAILURE'&&equipmentCandidates.length===1&&!unsafe){
        status='SELECTED';selectedEquipment=equipmentCandidates[0];
        failedObject={level:target.level,canonical:target.canonical,instance:target.instance,
          selectionMode:scope.length?'diagnostic_object_with_equipment_context':'diagnostic_object_with_unique_classifier_parent'};
      }else if(equipmentCandidates.length>1||normalizedParents.size>1){status='AMBIGUOUS_EQUIPMENT';limitations.push('MULTIPLE_CLASSIFIER_PARENTS');}
      else if(effectiveFailureState==='CONFLICT'){status='CONFLICT';limitations.push('SAME_OR_UNSCOPED_CONTRADICTION');}
    }
    if(!targets.length&&effectiveFailureState==='FAILURE')limitations.push('NO_IDENTIFIED_FAILED_OBJECT');
    return freeze({version,status,selectedEquipment,failedObject,equipmentCandidates,
      targets,roles,effectiveFailureState,limitations:[...new Set(limitations)],
      provenance:context.provenance,candidatePath:[selectedEquipment,null,null,null],
      reviewRequired:!['SELECTED','NOT_APPLICABLE'].includes(status),readyForApply:false,
      independentlyVerified:false});
  }
  globalThis.ReclassifierObjectAssessmentV4=Object.freeze({version,buildContext,fromPreparedRecords,analyze});
})();
