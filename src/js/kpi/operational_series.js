// FILE CONTRACT: daily/weekly/monthly operational volume series for native SVG.
// Two measures ONLY: completed INC count (ITSM completedAt) and validated
// Mobile Brigade labor hours (factDate). These are NOT VBR/KTG/SLA KPI ratios.
// No formula rewriting, SQL, persistence or Dataset mutation.
(() => {
  'use strict';
  const facts=globalThis.ReclassifierKpiSourceFacts;
  if (!facts?.itsmDatasetFacts || !facts?.mobileLaborFact || !facts?.key) {
    throw new Error('KPI source facts are required for operational time series.');
  }
  const METRICS=Object.freeze({
    inc: Object.freeze({label:'Завершённые INC',unit:'шт',source:'itsm_data'}),
    labor: Object.freeze({label:'Фактические трудозатраты',unit:'чел.-ч',source:'mobile_brigade_data'})
  });
  const MAX_BUCKETS=Object.freeze({day:366,week:156,month:120});
  let lastInstances=null;
  let cache=null;

  function dayId(value) {
    if(value instanceof Date && Number.isFinite(value.getTime())) {
      const y=value.getFullYear(),m=value.getMonth()+1,d=value.getDate();
      return String(y).padStart(4,'0')+'-'+String(m).padStart(2,'0')+'-'+String(d).padStart(2,'0');
    }
    const s=String(value??'').trim();
    let m=s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T\s]|$)/);
    if (!m) {
      const other=s.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})(?:\D|$)/);
      if (other) m=[null,other[3],other[2],other[1]];
    }
    if(!m)return null;
    const year=Number(m[1]),month=Number(m[2]),day=Number(m[3]);
    const dt=new Date(Date.UTC(year,month-1,day));
    return dt.getUTCFullYear()===year && dt.getUTCMonth()===month-1 &&
      dt.getUTCDate()===day
      ? String(year).padStart(4,'0')+'-'+String(month).padStart(2,'0')+'-'+String(day).padStart(2,'0') : null;
  }
  function addDays(day,n) {
    const dt=new Date(day+'T00:00:00Z');
    dt.setUTCDate(dt.getUTCDate()+n);
    return dt.toISOString().slice(0,10);
  }
  function bucketId(day,scale) {
    if(scale==='day')return day;
    if(scale==='month')return day.slice(0,7);
    const dt=new Date(day+'T00:00:00Z');
    const offset=(dt.getUTCDay()+6)%7;
    dt.setUTCDate(dt.getUTCDate()-offset);
    return dt.toISOString().slice(0,10);
  }
  function nextBucket(bucket,scale) {
    if(scale==='day')return addDays(bucket,1);
    if(scale==='week')return addDays(bucket,7);
    return addDays(bucket+'-01',32).slice(0,7)===bucket
      ? null : (()=>{const [y,m]=bucket.split('-').map(Number);
        return String(y+(m===12?1:0))+'-'+String(m===12?1:m+1).padStart(2,'0');})();
  }
  function buildDaily(instances) {
    const byMetric={inc:new Map(),labor:new Map()};
    const skipped={inc:0,labor:0};
    const itsm=instances.itsm_data;
    if(itsm?.meta?.sourceType!=='error') {
      const itsmFacts=facts.itsmDatasetFacts(
        itsm?.meta?.fields || globalThis.ReclassifierItsmDatasetSchema?.fields || [],
        itsm?.records||[],itsm?.fullDataset||null);
      for(const fact of itsmFacts) {
        if(fact.requestType!=='INC')continue;
        const date=dayId(fact.completedAt);
        if(!date){skipped.inc++;continue;}
        const key=JSON.stringify([date,facts.key(fact.mine),fact.equipmentClass||null]);
        const row=byMetric.inc.get(key)||{date,mine:facts.key(fact.mine),equipmentClass:fact.equipmentClass||null,value:0};
        row.value++;
        byMetric.inc.set(key,row);
      }
    }
    const mb=instances.mobile_brigade_data;
    if(mb?.meta?.sourceType!=='error') {
      for(const record of mb?.records||[]) {
        const fact=facts.mobileLaborFact(record);
        const date=dayId(fact.factDate);
        if(!date || !fact.laborUsable){skipped.labor++;continue;}
        const key=JSON.stringify([date,facts.key(fact.site),fact.equipmentClass||null]);
        const row=byMetric.labor.get(key)||{date,mine:facts.key(fact.site),equipmentClass:fact.equipmentClass||null,value:0};
        row.value+=fact.laborHours;
        byMetric.labor.set(key,row);
      }
    }
    return {inc:Array.from(byMetric.inc.values()),labor:Array.from(byMetric.labor.values()),
      skipped:Object.freeze(skipped)};
  }
  function snapshot(instances) {
    if(lastInstances && lastInstances.itsm_data===instances.itsm_data &&
      lastInstances.mobile_brigade_data===instances.mobile_brigade_data) return cache;
    // Rebuild only after authoritative source identity changes. Keep daily
    // aggregate rows; do not retain raw Dataset record references.
    const rebuilt=buildDaily(instances);
    lastInstances={itsm_data:instances.itsm_data,mobile_brigade_data:instances.mobile_brigade_data};
    cache=rebuilt;
    return rebuilt;
  }
  // Observation horizon comes from valid event dates in each source. It is
  // NOT a certification that zero-activity days or missing rows are complete.
  function observedRange(instances,metric) {
    if(!METRICS[metric]||!instances)return Object.freeze({from:null,through:null});
    const rows=snapshot(instances)[metric]||[];
    let from=null,through=null;
    for(const row of rows){
      if(!from||row.date<from)from=row.date;
      if(!through||row.date>through)through=row.date;
    }
    return Object.freeze({from,through});
  }
  function series(input={}) {
    const {instances,metric='inc',scale='month',groups=[{id:'all',label:'Все',mineValues:null}],
      classes=['stationary','mounted'],range='1y',endMonth=null,window=1}=input;
    if(!instances || !METRICS[metric] || !MAX_BUCKETS[scale] ||
        !['1m','3m','1y','all'].includes(range) || !Number.isInteger(window) ||
        window<1 || window>12)throw new Error('Недопустимые параметры операционного временного ряда.');
    const prepared=snapshot(instances),rows=prepared[metric];
    const allowed=rows.filter(row=>classes.includes(row.equipmentClass) &&
      (!endMonth || row.date.slice(0,7)<=endMonth));
    const first=allowed.reduce((v,r)=>v===null||r.date<v?r.date:v,null);
    const last=allowed.reduce((v,r)=>v===null||r.date>v?r.date:v,null);
    const max=MAX_BUCKETS[scale];
    const naturalStart=first?bucketId(first,scale):null;
    // A report month is a calendar boundary, not "last INC event". Keep
    // empty tail buckets visible, including a selected month with zero INC.
    const selectedEnd=endMonth && /^\d{4}-(0[1-9]|1[0-2])$/.test(endMonth)
      ? new Date(Date.UTC(+endMonth.slice(0,4),+endMonth.slice(5,7),0))
          .toISOString().slice(0,10)
      : last;
    const naturalEnd=selectedEnd?bucketId(selectedEnd,scale):null;
    const monthCount={ '1m':1,'3m':3,'1y':12,all:null }[range];
    let startDate=first;
    if(monthCount!==null && selectedEnd){
      const year=+selectedEnd.slice(0,4),month=+selectedEnd.slice(5,7)-1;
      const left=new Date(Date.UTC(year,month-(monthCount-1),1))
        .toISOString().slice(0,10);
      startDate=!first||first<left?left:first;
    }
    let boundsStart=startDate?bucketId(startDate,scale):null;
    const boundsEnd=naturalEnd;
    // Do not allocate unbounded DOM/SVG arrays even in "Все" mode.
    if(boundsEnd && boundsStart) {
      const values=[];
      for(let d=boundsEnd;d>=boundsStart&&values.length<max;){
        values.push(d);
        if(scale==='month'){
          const y=+d.slice(0,4),m=+d.slice(5,7);
          d=String(m===1?y-1:y)+'-'+String(m===1?12:m-1).padStart(2,'0');
        }else d=addDays(d,scale==='day'?-1:-7);
      }
      boundsStart=values.at(-1);
    }
    const periods=[];
    if(boundsStart&&boundsEnd) {
      for(let d=boundsStart;d<=boundsEnd&&periods.length<max;d=nextBucket(d,scale)){
        if(!d)break;
        periods.push(d);
      }
    }
    const result=groups.flatMap(group=>classes.map(cls=>{
      const mineSet=group.mineValues===null?null:
        new Set(group.mineValues.map(facts.key));
      const totals=new Map();
      for(const row of allowed) {
        if(row.equipmentClass!==cls||(mineSet&&!mineSet.has(row.mine)))continue;
        const bucket=bucketId(row.date,scale);
        if(bucket<boundsStart||bucket>boundsEnd)continue;
        totals.set(bucket,(totals.get(bucket)||0)+row.value);
      }
      const points=periods.map((period,i)=>{
        const value=totals.get(period)||0;
        const lookback=periods.slice(Math.max(0,i-window+1),i+1);
        const trend=window>1&&lookback.length===window
          ?lookback.reduce((sum,p)=>sum+(totals.get(p)||0),0)/window:null;
        return Object.freeze({period,value,rollingValue:trend,dataState:'available'});
      });
      return Object.freeze({
        id:group.id+':'+cls,mineId:group.id,mineLabel:group.label,
        equipmentClass:cls,equipmentLabel:cls==='mounted'?'Навесное':'Стационарное',
        kpiId:metric,points:Object.freeze(points)
      });
    }));
    return Object.freeze({metric,scale,range,window,series:Object.freeze(result),
      start:boundsStart,end:boundsEnd,unit:METRICS[metric].unit,
      label:METRICS[metric].label,skippedRows:prepared.skipped[metric],
      truncated:Boolean(naturalStart&&boundsStart>naturalStart)});
  }
  const api=Object.freeze({version:'1.0.0',METRICS,dayId,bucketId,series,observedRange,
    invalidate(){lastInstances=null;cache=null;}});
  globalThis.ReclassifierKpiOperationalSeries=api;
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
})();
