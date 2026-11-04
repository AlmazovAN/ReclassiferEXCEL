'use strict';
const assert=require('node:assert/strict');
const calculator=require('../src/js/kpi/calculator/common.js');

// Compare the indexed immutable component table against the identical mutable
// input, which deliberately takes the unchanged filtering path. Selection audit
// records must be identical: counts, exclusions, row order and error states.
const rows=Object.freeze([
  {period:'2026-09-01',site:'Северный',equipmentClass:'mounted',laborHours:4},
  {period:'2026-10-01',site:'Таймырский',equipmentClass:'stationary',laborHours:2},
  {period:'2026-10-01',site:'Северный',equipmentClass:'mounted',laborHours:3},
  {period:'2026-10-15',site:'Северный',equipmentClass:'stationary',laborHours:1},
  {period:'2026-10-01',site:'Северный',equipmentClass:'mounted',laborHours:7},
  {period:'2026-11-01',site:'Северный',equipmentClass:'mounted',laborHours:8},
  {period:'2026-10-01',site:'Скалистый',equipmentClass:'mounted',laborHours:5}
].map(Object.freeze));
const frozen=Object.freeze({id:'labor',rows});
const mutable={id:'labor',rows:Array.from(rows,x=>({...x}))};
const filterMap={mine:'site',equipmentClass:'equipmentClass'};
function calculate(table,period,filters){
  const samples=[];
  const selected=calculator.selectRows(table,{
    period,filters,audit:{selection:sample=>samples.push(sample)}
  },filterMap);
  return {keys:selected.rows.map(x=>[x.period,x.site,x.equipmentClass,x.laborHours]),
    sum:calculator.sum(selected.rows,'laborHours'),
    error:selected.error,samples};
}
const samples=[
 ['2026-10-01',{mine:'Северный'}],
 ['2026-10-01',{mine:'Северный',equipmentClass:'mounted'}],
 ['2026-10-01',{mine:'Нет такого'}],
 ['2026-10-01',{equipmentClass:'mounted',mine:'Северный'}],
 ['2026-10-01',{mine:['Северный','Таймырский']}],
 [{start:'2026-09-01',end:'2026-10-01'},{mine:'Северный'}],
 [null,{mine:'Северный'}],
 ['invalid',{mine:'Северный'}],
 ['2026-10-01',{unrecognized:'value'}]
];
for(const [period,filters] of samples) {
  for(let pass=0;pass<3;pass++) {
    const indexed=calculate(frozen,period,filters);
    const reference=calculate(mutable,period,filters);
    assert.deepEqual(indexed,reference,'Indexed rows/audit must match original selection semantics');
  }
}
assert.equal(calculate(frozen,'2026-10-01',{mine:'Северный'}).sum,11);
assert.equal(calculate(frozen,'2026-10-01',{mine:'Северный',equipmentClass:'mounted'}).sum,10);
assert.equal(calculator.percent(5,100).value,5,
 'KPI ratios must still be calculated from original numerator/denominator');

// Sweep many month+field variants through the bounded lazy LRU and ensure
// evicted index entries rebuild to the original values.
for(let i=1;i<=28;i++){
  const period='2026-'+String((i%12)+1).padStart(2,'0')+'-01';
  assert.deepEqual(
    calculate(frozen,period,{mine:'Северный'}),
    calculate(mutable,period,{mine:'Северный'})
  );
}
assert.deepEqual(calculate(frozen,'2026-10-01',{mine:'Северный'}),
  calculate(mutable,'2026-10-01',{mine:'Северный'}));
console.log('PR6 month/dimension indexing: selection rows, order, trace, ranges and formula parity OK');
