// PR5: compare immutable-table indexes with the pre-optimization full-scan semantics.
'use strict';
const assert=require('node:assert/strict');
require('../src/js/kpi/calculator/common.js');
const c=globalThis.ReclassifierKpiCalculatorCommon;
function legacy(table, query={}, filterMap={}) {
  const normalized=c.normalizedQuery(query), input=Array.from(table?.rows||[]);
  const active=c.activeFilterEntries(normalized.filters), stages=[];
  const unsupported=active.map(([name])=>name).filter(name=>!Object.hasOwn(filterMap,name));
  let rows=input,error=null;
  if(normalized.period.kind==='invalid'){rows=[];error='invalid-period';}
  else if(unsupported.length){rows=[];error='unsupported-filter';}
  else {
    if(normalized.period.kind!=='all'){
      const before=rows.length, months=new Set(normalized.period.months);
      rows=rows.filter(row=>{const month=c.monthId(row?.period);return Boolean(month&&months.has(month));});
      stages.push({stage:'period',field:'period',operator:'month-in',
        expected:normalized.period.months.slice(),inputRows:before,
        outputRows:rows.length,excludedRows:before-rows.length});
    }
    for(const [name,expected] of active){
      const candidates=Array.isArray(filterMap[name])?filterMap[name]:[filterMap[name]];
      const before=rows.length;
      rows=rows.filter(row=>candidates.some(field=>c.valueMatches(row?.[field],expected)));
      stages.push({stage:'dimension',filter:name,fields:candidates.slice(),
        operator:Array.isArray(expected)?'in':'eq',
        expected:Array.isArray(expected)?expected.slice():expected,
        inputRows:before,outputRows:rows.length,excludedRows:before-rows.length});
    }
  }
  return {rows,error,unsupportedFilters:unsupported,stages,period:normalized.period};
}
const map={mine:'mine',equipmentClass:'equipmentClass',
 equipmentType:'equipmentType',equipmentName:['equipmentName','alias']};
const rows=[];
for(let year=2023;year<=2026;year++) for(let mo=1;mo<=12;mo++)
 for(const mine of ['Северный','Октябрьский','Таймырский'])
  for(const cls of ['mounted','stationary']){
    const period=year+'-'+String(mo).padStart(2,'0')+'-01';
    rows.push(Object.freeze({period,mine,equipmentClass:cls,
      equipmentType:mo%2?'БКМ':'ШС',equipmentName:'Радио',alias:'Альтернативное',
      failureCount:mo}));
  }
rows.push(Object.freeze({period:'invalid',mine:'Северный',equipmentClass:'mounted'}));
const frozen=Object.freeze({id:'test_monthly_component',rows:Object.freeze(rows)});
const cases=[
 {period:'2026-10-01',filters:{mine:'Северный',equipmentClass:'mounted'}},
 {period:'2024-02-01',filters:{mine:'Таймырский',equipmentType:'ШС'}},
 {period:{start:'2024-11-01',end:'2025-03-01'},filters:{equipmentClass:'stationary'}},
 {period:{start:'2023-01-01',end:'2026-12-01'},filters:{mine:['Северный','Октябрьский']}},
 {filters:{mine:'Северный',equipmentName:'Альтернативное'}},
 {filters:{mine:'all'}},
 {period:'2028-01-01',filters:{mine:'Северный'}},
 {period:'2026-10-01',filters:{unknown:'x'}},
 {period:'not-a-period'},
 {period:'2026-05-01',filters:{mine:'Октябрьский',equipmentClass:'mounted',equipmentName:'Радио'}},
 {period:{start:'2026-10',end:'2026-09'}},
 {filters:{mine:['Октябрьский','Северный'],equipmentName:'радио'}}
];
for(const query of cases){
  const events=[];
  const got=c.selectRows(frozen,{...query,audit:{selection:payload=>events.push(payload)}},map);
  const expected=legacy(frozen,query,map);
  assert.deepEqual(got.rows,expected.rows,'Data equality for '+JSON.stringify(query));
  assert.equal(got.error,expected.error);
  assert.deepEqual(got.unsupportedFilters,expected.unsupportedFilters);
  assert.deepEqual(events[0].stages,expected.stages,'Exact lineage for '+JSON.stringify(query));
  assert.equal(events[0].inputRows,rows.length);
  assert.equal(events[0].outputRows,expected.rows.length);
}
const mutable={id:'mutable',rows:rows.slice(0,3)};
assert.deepEqual(c.selectRows(mutable,{period:'2023-01-01'},map).rows,
 legacy(mutable,{period:'2023-01-01'},map).rows);
mutable.rows.push({...rows[3],period:'2023-01-01'});
assert.equal(c.selectRows(mutable,{period:'2023-01-01'},map).rows.length,4,
  'Mutable legacy data must never use a stale index.');
// A counter proves repeated explicit month calls never scan row.period again.
let periodReads=0;
const counted=Object.freeze({id:'counted',rows:Object.freeze(
 Array.from({length:1200},(_,n)=>{
   const period='2026-'+String(n%12+1).padStart(2,'0')+'-01';
   return Object.freeze({get period(){periodReads++;return period;},
     mine:Math.floor(n/12)%2?'Северный':'Октябрьский',failureCount:1});
 }))});
for(let i=0;i<60;i++){
 const selected=c.selectRows(counted,{period:'2026-'+String(i%12+1).padStart(2,'0')+'-01',
   filters:{mine:'Северный'}},{mine:'mine'});
 assert.equal(selected.rows.length,50);
}
assert.equal(periodReads,1200,
 'Indexed frozen table should read period once per source row, not once per calculation.');
assert.equal(c.latestMonth(counted),'2026-12');
assert.equal(periodReads,1200,'Latest-month lookup must reuse the same index.');
assert.equal(c.latestMonth(frozen),'2026-12');
console.log('KPI indexed selection: 12 full-scan equivalence cases, exact audit stages, 60 repeated selections/1 indexing pass OK');
