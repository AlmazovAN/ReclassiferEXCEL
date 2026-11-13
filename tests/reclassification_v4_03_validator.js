// V4-03: corpus audit only. No dependency on the V4 inference engine.
// Public fixtures are strictly synthetic. A separate private extractor is used for real Excel.
'use strict';
(function (root) {
  const normalize=x=>String(x??'').toLocaleLowerCase('ru-RU').replace(/ё/g,'е')
    .replace(/[^a-zа-я0-9]+/gi,' ').replace(/\s+/g,' ').trim();
  const pathKey=a=>JSON.stringify(a.map(normalize));
  const full=p=>Array.isArray(p)&&p.length===4&&p.every(x=>typeof x==='string'&&x.trim());
  const empty=p=>Array.isArray(p)&&p.length===4&&p.every(x=>x===null);
  const splitAllowed=new Set(['development','holdout']);
  const expectedAllowed=new Set(['READY','PARTIAL','REVIEW','RITM_SERVICE','INC_NON_FAILURE']);
  const dispositionAllowed=new Set(['KEEP_RITM','RITM_AS_INC','INC_FAILURE','INC_NON_FAILURE_OPEN','REVIEW']);
  const evidenceLevels=['equipment','element','failure','cause'];
  const tokens=s=>new Set(normalize(s).split(' ').filter(x=>x.length>=4));
  function validateCorpus(data) {
    const errors=[],warnings=[];
    const error=(place,detail)=>errors.push(place+': '+detail);
    if(!data||data.schemaVersion!==1||data.origin!=='synthetic'||
       !Array.isArray(data.cases)||!Array.isArray(data.classifier))
      return {ok:false,errors:['Invalid schema: only synthetic V4-03 corpus v1 is allowed in Git'],warnings};
    const paths=new Set(),ids=new Set(),groups=new Map(),texts=new Map(),similar=[];
    data.classifier.forEach((path,i)=>{
      if(!full(path))error('classifier['+i+']','incomplete path');
      else if(paths.has(pathKey(path)))error('classifier['+i+']','duplicate branch');
      else paths.add(pathKey(path));
    });
    data.cases.forEach((c,i)=>{
      const at='cases['+i+']';
      if(!c||typeof c!=='object'){error(at,'not an object');return;}
      if(!/^SYN-[A-Z0-9-]+$/.test(c.id||'')||ids.has(c.id))
        error(at,'invalid or repeated synthetic ID');
      ids.add(c.id);
      if(!splitAllowed.has(c.partition))error(at,'unknown partition');
      if(!['mounted','stationary'].includes(c.population))error(at,'unknown equipment population');
      if(!['INC','RITM'].includes(c.requestType))error(at,'unknown request type');
      if(!c.incidentGroup||typeof c.incidentGroup!=='string')error(at,'incidentGroup required');
      else {
        if(groups.has(c.incidentGroup)&&groups.get(c.incidentGroup)!==c.partition)
          error(at,'same incidentGroup across development and holdout');
        groups.set(c.incidentGroup,c.partition);
      }
      const s=c.source||{}, sourceFields=['shortDescription','description','closureNote','extraReason'];
      for(const field of sourceFields)
        if(s[field]!==null&&s[field]!==undefined&&typeof s[field]!=='string')
          error(at,'invalid source text: '+field);
      const narrative=sourceFields.map(field=>s[field]||'').join(' ').trim();
      if(!narrative)error(at,'empty source narrative');
      const digest=normalize(narrative);
      if(texts.has(digest)&&texts.get(digest)!==c.partition)
        error(at,'identical text across partitions');
      texts.set(digest,c.partition);
      similar.push({id:c.id,partition:c.partition,tokens:tokens(narrative)});
      // Reviewed facts are not engine input: reporter, diagnosis, intervention and outcome differ.
      const observations=c.observations||{};
      for(const field of ['reported','diagnosed','performed','outcome']){
        const item=observations[field];
        if(item!==null && typeof item!=='string')
          error(at,'observations.'+field+' must be text or null');
      }
      if(!String(observations.reported||'').trim())
        error(at,'reporter observation required');
      const ref=c.reference||{};
      const isPath=p=>Array.isArray(p)&&p.length===4&&p.every(x=>x===null||typeof x==='string');
      if(!isPath(ref.primaryPath)||!isPath(ref.engineerPath))
        error(at,'both reference paths require four nullable levels');
      if(!['none','illustrative','unverified_engineering','verified_independent'].includes(ref.engineerOrigin))
        error(at,'bad engineerOrigin');
      if(!['none','not_assessed','in_classifier','outside_classifier'].includes(ref.engineerBranchStatus))
        error(at,'bad engineerBranchStatus');
      if(full(ref.engineerPath)){
        const actual=paths.has(pathKey(ref.engineerPath))?'in_classifier':'outside_classifier';
        if(ref.engineerBranchStatus!==actual)error(at,'engineer path membership incorrectly marked');
      }
      if(ref.engineerBranchStatus==='in_classifier'&&!full(ref.engineerPath))
        error(at,'incomplete engineer path marked valid');
      const r=c.review||{};
      if(!['synthetic_only','requires_independent_review','independently_verified'].includes(r.status))
        error(at,'review status missing');
      if(!dispositionAllowed.has(r.disposition))error(at,'bad disposition');
      if(!['FAILURE','NON_FAILURE','UNKNOWN'].includes(r.failureState))
        error(at,'bad failureState');
      if(!['INC','RITM','UNKNOWN'].includes(r.analyticalType))
        error(at,'bad analyticalType');
      if(!expectedAllowed.has(r.expectedStatus))error(at,'bad expectedStatus');
      if(!['sufficient','insufficient','disputed'].includes(r.evidenceGrade))
        error(at,'bad evidenceGrade');
      if(typeof r.reason!=='string'||!r.reason.trim())error(at,'rationale required');
      if(typeof r.applyReady!=='boolean')error(at,'applyReady must be boolean');
      if(!isPath(r.proposedPath))error(at,'proposedPath must have four levels');
      if(r.expectedStatus==='READY'){
        if(!full(r.proposedPath)||!paths.has(pathKey(r.proposedPath)))
          error(at,'READY path does not exist in classifier');
        if(!r.applyReady||r.failureState!=='FAILURE'||r.analyticalType!=='INC'||
           r.evidenceGrade!=='sufficient')error(at,'READY is not fully supported');
        for(const level of evidenceLevels)
          if(!String(r.levelEvidence?.[level]||'').trim())
            error(at,'READY requires level evidence: '+level);
      } else if(r.applyReady||!empty(r.proposedPath))
        error(at,'incomplete/uncertain result must not be exported');
      if(c.requestType==='RITM'&&r.disposition==='KEEP_RITM'&&
         (r.expectedStatus!=='RITM_SERVICE'||r.failureState!=='NON_FAILURE'||
          r.analyticalType!=='RITM'))error(at,'ordinary RITM policy violated');
      if(r.disposition==='RITM_AS_INC'&&
         (c.requestType!=='RITM'||r.analyticalType!=='INC'||r.failureState!=='FAILURE'))
        error(at,'hidden failure semantics violated');
      if(r.disposition==='INC_NON_FAILURE_OPEN'&&
         (r.expectedStatus!=='INC_NON_FAILURE'||r.failureState!=='NON_FAILURE'||r.applyReady))
        error(at,'unresolved INC nonfailure policy was auto-applied');
      if(c.population==='stationary'&&r.status==='independently_verified'&&!r.reviewerId)
        error(at,'stationary requires named reviewer');
      if(c.population==='stationary'&&r.status==='synthetic_only'&&r.expectedStatus==='READY')
        warnings.push(at+': synthetic stationary READY cannot replace human review');
    });
    // Reject obvious near-duplicate descriptions crossing splits (manual grouping handles less similar cases).
    for(let i=0;i<similar.length;i++)for(let j=i+1;j<similar.length;j++){
      const a=similar[i],b=similar[j];if(a.partition===b.partition)continue;
      if(a.tokens.size<8||b.tokens.size<8)continue;
      const overlap=[...a.tokens].filter(w=>b.tokens.has(w)).length;
      if(overlap/Math.min(a.tokens.size,b.tokens.size)>=0.92)
        error(a.id+' / '+b.id,'probable duplicate crosses partitions');
    }
    if(/(?:[\w.+-]+@[\w.-]+\.[a-z]{2,}|\b(?:INC|RITM)[-_ ]?\d{6,}\b)/i.test(JSON.stringify(data)))
      error('privacy','possible real number or email in public fixture');
    return {ok:!errors.length,errors,warnings,summary:{
      total:data.cases.length,
      development:data.cases.filter(x=>x.partition==='development').length,
      holdout:data.cases.filter(x=>x.partition==='holdout').length,
      stationary:data.cases.filter(x=>x.population==='stationary').length
    }};
  }
  const api=Object.freeze({validateCorpus,pathKey,normalize});
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
  else root.ReclassifierV403CorpusValidator=api;
})(globalThis);
