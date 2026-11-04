// PR-8: same-cohort quality correction from independent, date-stamped revision
// evidence. Does not extrapolate next month or alter the official KPI formula.
(() => {
  'use strict';
  const VERSION='0.1.0',METHOD='revision-lag-median-delta',DAY=86400000;
  const IDS=new Set(['classification_quality','classification_quality_cgps']);
  const freeze=x=>{
    if(x&&typeof x==='object'&&!Object.isFrozen(x)){
      Object.values(x).forEach(freeze);Object.freeze(x);
    }
    return x;
  };
  const date=x=>{
    if(typeof x!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(x))return null;
    const n=Date.parse(x+'T00:00:00Z');
    return Number.isFinite(n)&&new Date(n).toISOString().slice(0,10)===x?n:null;
  };
  const monthEnd=x=>{
    if(typeof x!=='string'||!/^\d{4}-(0[1-9]|1[0-2])$/.test(x))return null;
    const [y,m]=x.split('-').map(Number);
    return Date.UTC(y,m,0);
  };
  const median=x=>{const a=[...x].sort((p,q)=>p-q),i=a.length>>1;
    return a.length%2?a[i]:(a[i-1]+a[i])/2;};
  const pct=x=>100*x.successCount/x.totalCount;
  const invalidState=(state,required)=>{
    if(!state||!Number.isInteger(state.successCount)||
      !Number.isInteger(state.totalCount)||state.totalCount<1||
      state.successCount<0||state.successCount>state.totalCount||
      typeof state.populationHash!=='string'||state.populationHash.length<8||
      !Array.isArray(state.sources)||state.sources.length!==required.length)
      return true;
    const ids=state.sources.map(s=>s?.datasetId);
    return new Set(ids).size!==ids.length||
      required.some(id=>!ids.includes(id))||
      state.sources.some(s=>!Number.isInteger(s.revision)||s.revision<1||
        typeof s.contentHash!=='string'||s.contentHash.length<8);
  };
  const unavailable=(id,reason,state='insufficient',extra={})=>freeze({
    kpiId:id,forecastType:'same-cohort-reclassification-lag',
    dataState:state,reason,value:null,observedValue:null,
    methodId:METHOD,methodVersion:VERSION,status:'experimental-not-approved',...extra
  });
  function predict(input={}){
    const id=String(input.kpiId||'');
    if(!IDS.has(id))return unavailable(id,'unsupported-classification-kpi','unavailable');
    const asOf=date(input.asOf),targetEnd=monthEnd(input.cohortMonth);
    if(asOf===null||targetEnd===null||asOf<targetEnd)
      return unavailable(id,'cohort-not-closed-or-asof-invalid');
    if(input.auditBasis!=='case-level-versioned-asof')
      return unavailable(id,'no-versioned-asof-audit-history');
    const required=id==='classification_quality'?['itsm_data']:
      ['itsm_data','mobile_brigade_data'];
    const current=input.current,observedAt=date(current?.observedAt);
    if(observedAt===null||observedAt<targetEnd||observedAt>asOf||
       asOf-observedAt>7*DAY||invalidState(current,required))
      return unavailable(id,'current-vintage-unverified','unavailable');
    const observedValue=pct(current),age=Math.floor((observedAt-targetEnd)/DAY);
    if(!Array.isArray(input.history)||input.history.length<8)
      return unavailable(id,'insufficient-audited-cohorts','insufficient',{
        observedValue,cohortMonth:input.cohortMonth,auditPairs:input.history?.length||0});
    const knownMonths=new Set(),pairs=[];
    for(const pair of input.history){
      const end=monthEnd(pair?.cohortMonth);
      const first=date(pair?.early?.observedAt),last=date(pair?.final?.observedAt);
      if(end===null||end>=targetEnd||knownMonths.has(pair.cohortMonth)||
         first===null||last===null||first<end||last<=first||last>asOf||
         invalidState(pair.early,required)||invalidState(pair.final,required)||
         pair.early.populationHash!==pair.final.populationHash||
         pair.early.totalCount!==pair.final.totalCount||
         Math.abs(Math.floor((first-end)/DAY)-age)>7||
         last-first<7*DAY||last-first>180*DAY)
        return unavailable(id,'invalid-or-leaking-vintage-pair','unavailable',{
          observedValue,cohortMonth:input.cohortMonth});
      knownMonths.add(pair.cohortMonth);
      pairs.push({cohort:pair.cohortMonth,first,last,
        initial:pct(pair.early),final:pct(pair.final),
        delta:pct(pair.final)-pct(pair.early)});
    }
    pairs.sort((a,b)=>a.first-b.first);
    if(pairs.some((p,i)=>i>0&&p.first<=pairs[i-1].first))
      return unavailable(id,'ambiguous-audit-order','unavailable',{observedValue});
    const error=[],baseline=[];
    for(const pair of pairs){
      const trained=pairs.filter(p=>p.first<pair.first&&p.last<=pair.first);
      if(trained.length<4)continue;
      const predicted=Math.max(0,Math.min(100,pair.initial+
        median(trained.map(p=>p.delta))));
      error.push(Math.abs(pair.final-predicted));
      baseline.push(Math.abs(pair.final-pair.initial));
    }
    if(error.length<3)
      return unavailable(id,'insufficient-causal-backtests','insufficient',{
        observedValue,validationPairs:error.length,auditPairs:pairs.length});
    const mae=error.reduce((a,b)=>a+b,0)/error.length;
    const baselineMae=baseline.reduce((a,b)=>a+b,0)/baseline.length;
    const quality=freeze({metric:'MAE-percentage-points',mae,baselineMae,
      validationPairs:error.length,trainingPairs:pairs.length,
      passed:mae<baselineMae});
    if(!quality.passed)
      return unavailable(id,'not-better-than-unchanged-quality','insufficient',{
        observedValue,quality,auditPairs:pairs.length});
    const correction=median(pairs.map(p=>p.delta));
    const value=Math.max(0,Math.min(100,observedValue+correction));
    return freeze({
      kpiId:id,forecastType:'same-cohort-reclassification-lag',
      dataState:'available',reason:null,value,observedValue,
      change:value-observedValue,horizon:input.cohortMonth,
      asOf:input.asOf,target:'eventual-quality-of-same-closed-cohort',
      methodId:METHOD,methodVersion:VERSION,
      status:'experimental-not-approved',quality,
      auditBasis:input.auditBasis,auditPairs:pairs.length,
      sourceRevisions:current.sources.map(s=>({
        datasetId:s.datasetId,revision:s.revision,contentHash:s.contentHash
      }))
    });
  }
  function evaluateSnapshot(snapshot,kpiId,input){
    const fact=snapshot?.results?.[kpiId],current=input?.current;
    if(!fact||fact.dataState!=='available'||!current||
       fact.components?.classificationSuccessCount!==current.successCount||
       fact.components?.classificationTotalCount!==current.totalCount)
      return unavailable(kpiId,'snapshot-component-mismatch','unavailable');
    return predict({...input,kpiId});
  }
  const api=Object.freeze({version:VERSION,methodId:METHOD,
    supported:Object.freeze([...IDS]),contractVersion:'1.0.0',
    predict,evaluateSnapshot});
  globalThis.ReclassifierKpiClassificationLagForecast=api;
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
})();
