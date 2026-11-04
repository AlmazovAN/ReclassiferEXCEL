// FILE CONTRACT: read-only historical Equipment population from PR9 complete-scope observations.
// No Drivers, KTG or Equipment_Combined mutation; unknown history is never treated as zero.
// Snapshot dates are source evidence, not commissioning dates or continuous uptime.
(() => {
  'use strict';
  const SOURCES = Object.freeze(['stationary','mounted','transport','transport_start_points','zabbix']);
  const PHYSICAL = Object.freeze(['stationary','mounted']);
  const day = value => {
    const s=String(value??'').slice(0,10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
    const d=new Date(s+'T00:00:00Z');
    return !Number.isNaN(d.valueOf()) && d.toISOString().slice(0,10)===s ? s:null;
  };
  const mine = value => String(value??'').replace(/\u00a0/g,' ')
    .replace(/\s+/g,' ').trim().toLocaleLowerCase('ru-RU');
  const label = value => String(value??'').trim() || 'Не определён';
  const clone = value => JSON.parse(JSON.stringify(value));
  const activeAt = (row, date) => {
    const retired=day(row.notWorkingSince);
    if (retired) return retired>date;
    // A non-empty but unreadable retirement date is not proof of active status.
    return row.notWorkingSince ? null : true;
  };
  function evaluate(histories, options={}) {
    const asOf=day(options.asOf);
    if (!asOf) throw new Error('Equipment Population: требуется корректная дата YYYY-MM-DD.');
    const sources=options.sources || PHYSICAL;
    if (!Array.isArray(sources) || !sources.length ||
        new Set(sources).size!==sources.length ||
        sources.some(s=>!SOURCES.includes(s))) {
      throw new Error('Equipment Population: некорректный набор источников.');
    }
    const filterMine=options.mine==null ? null : mine(options.mine);
    if (filterMine!==null && !filterMine) throw new Error('Equipment Population: пустой рудник.');
    const bySource=[];
    const groups=new Map();
    let totalKnown=0, totalActive=0, totalInactive=0, ambiguous=0;
    const unavailable=[];
    for (const id of sources) {
      const history=histories?.[id];
      if (history && (history.schemaVersion!==1 || !Array.isArray(history.snapshots))) {
        throw new Error('Equipment Population: несовместимый журнал '+id+'.');
      }
      const snapshots=(history?.snapshots||[]).filter(x=>
        x.datasetId===id && x.kind==='observed-complete-scope' &&
        day(x.sourceDate) && day(x.sourceDate)<=asOf);
      const knownMines=new Set();
      // Mine membership is only confirmed by a complete scope observation,
      // not by incidental appearance in another mine or an inherited baseline.
      for(const snap of history?.snapshots||[]) {
        for(const section of snap.sections||[]) {
          const m=mine(section);
          if(m && (filterMine===null || filterMine===m)) knownMines.add(m);
        }
      }
      if(filterMine!==null) knownMines.add(filterMine);
      if(!knownMines.size) {
        unavailable.push({source:id,mine:filterMine,reason:'no-confirmed-scope'});
        bySource.push({source:id,mine:filterMine,known:false,active:null,inactive:null,
          uncertain:null,observedOn:null,reason:'no-confirmed-scope'});
        continue;
      }
      for(const m of knownMines) {
        const candidates=snapshots.filter(s=>(s.sections||[]).some(x=>mine(x)===m))
          .sort((a,b)=>day(b.sourceDate).localeCompare(day(a.sourceDate)) ||
            String(b.observedAt||'').localeCompare(String(a.observedAt||'')));
        const snap=candidates[0];
        if(!snap) {
          unavailable.push({source:id,mine:m,reason:'no-snapshot-as-of'});
          bySource.push({source:id,mine:m,known:false,active:null,inactive:null,
            uncertain:null,observedOn:null,reason:'no-snapshot-as-of'});
          continue;
        }
        const rows=(snap.rows||[]).filter(r=>mine(r.unit)===m);
        const ids=new Set();
        let active=0,inactive=0,uncertain=0;
        for(const row of rows) {
          if(!row.id || ids.has(String(row.id))) {
            throw new Error('Equipment Population: повторный/пустой ID для '+id+' / '+m+'.');
          }
          ids.add(String(row.id));
          const status=activeAt(row,asOf);
          if(status===true) active++;
          else if(status===false) inactive++;
          else uncertain++;
          const type=label(row.equipmentType);
          const key=JSON.stringify([id,m,type]);
          const g=groups.get(key)||{source:id,mine:m,type,active:0,inactive:0,uncertain:0};
          if(status===true)g.active++;
          else if(status===false)g.inactive++;
          else g.uncertain++;
          groups.set(key,g);
        }
        totalKnown+=rows.length;totalActive+=active;totalInactive+=inactive;ambiguous+=uncertain;
        bySource.push({source:id,mine:m,known:true,active,inactive,
          uncertain,total:rows.length,observedOn:day(snap.sourceDate),
          evidence:'last-complete-scope-observation'});
      }
    }
    const complete=unavailable.length===0;
    return {
      schemaVersion:1,asOf,sources:clone(sources),mine:filterMine,
      // These are observed population counts, not verified continuous operation.
      coverage:complete?'observed-coverage':'incomplete',
      total:complete?totalKnown:null,active:complete && ambiguous===0?totalActive:null,
      inactive:complete && ambiguous===0?totalInactive:null,
      observedTotal:totalKnown,observedActive:totalActive,
      observedInactive:totalInactive,uncertainRetirementDate:ambiguous,
      unavailable,bySource,groups:Array.from(groups.values()),
      caveat:'Последний полный наблюдаемый срез до даты; дата ввода не подтверждена. '+
        'Отсутствие истории и непонятная дата выбытия не считаются нулём.'
    };
  }
  const api=Object.freeze({version:'1.0.0',SOURCES,PHYSICAL,evaluate});
  globalThis.ReclassifierEquipmentPopulation=api;
  if(typeof module!=='undefined' && module.exports)module.exports=api;
})();
