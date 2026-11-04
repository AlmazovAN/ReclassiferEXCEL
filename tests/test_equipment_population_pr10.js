'use strict';
const assert=require('node:assert/strict');
const history=require('../src/js/modules/equipment/equipment_history.js');
const pop=require('../src/js/modules/equipment/equipment_population.js');
const r=(id,unit,type,retired=null)=>({id,unit,equipment_type:type,not_working_since:retired});
const observe=(id,prev,next,sections,date,prior)=>history.observe({
 datasetId:id,previousRows:prev,nextRows:next,sections,previousHistory:prior,
 sourceDate:date,recordedAt:date+'T12:00:00.000Z'
});
let stationary=observe('stationary',[],[
 r('S1','Октябрьский','Станция'),r('S2','Маяк','Станция')
],['Октябрьский','Маяк'],'2025-01-01');
let mounted=observe('mounted',[],[r('M1','Октябрьский','Радио')],
 ['Октябрьский'],'2025-01-01');
const histories={stationary,mounted};
let result=pop.evaluate(histories,{asOf:'2025-01-01',mine:'Октябрьский'});
assert.equal(result.coverage,'observed-coverage');
assert.equal(result.active,2);
assert.equal(result.total,2);
assert.equal(result.groups.length,2);
assert.equal(pop.evaluate(histories,{asOf:'2024-12-01',mine:'Октябрьский'}).active,null);
assert.equal(pop.evaluate(histories,{asOf:'2024-12-01',mine:'Октябрьский'}).coverage,'incomplete');
const octoberNew=[r('S1','Октябрьский','Станция','2025-03-01'),r('S2','Маяк','Станция')];
stationary=observe('stationary',[r('S1','Октябрьский','Станция'),r('S2','Маяк','Станция')],
 octoberNew,['Октябрьский'],'2025-04-01',stationary);
histories.stationary=stationary;
assert.equal(pop.evaluate(histories,{asOf:'2025-02-01',mine:'Октябрьский'}).active,2);
assert.equal(pop.evaluate(histories,{asOf:'2025-04-01',mine:'Октябрьский'}).active,1);
assert.equal(pop.evaluate(histories,{asOf:'2025-04-01',mine:'Маяк'}).active,null,
 'Incomplete Mounted coverage must not invent a mine-wide total');
assert.equal(pop.evaluate({stationary},{asOf:'2025-04-01',sources:['stationary'],mine:'Маяк'}).active,1,
 'Unchanged mine uses its own January snapshot, not the April replacement');
const x=pop.evaluate(histories,{asOf:'2025-04-01',mine:'Октябрьский'});
assert.equal(x.observedInactive,1);
assert.equal(x.bySource.find(v=>v.source==='stationary').observedOn,'2025-04-01');
assert.throws(()=>pop.evaluate(histories,{asOf:'2025-02-30'}),/дата/);
assert.throws(()=>pop.evaluate(histories,{asOf:'2025-01-01',sources:['combined']}),/источников/);
const bad=observe('stationary',[],[r('B','Шахта','Радио','неизвестно')],
 ['Шахта'],'2025-02-01');
const ambiguous=pop.evaluate({stationary:bad},{asOf:'2025-02-01',sources:['stationary']});
assert.equal(ambiguous.active,null);
assert.equal(ambiguous.uncertainRetirementDate,1);
const snapshotRestored=JSON.parse(JSON.stringify(histories));
assert.deepEqual(pop.evaluate(snapshotRestored,{asOf:'2025-04-01',mine:'Октябрьский'}),x);
assert.equal(pop.evaluate(histories,{asOf:'2025-04-01',mine:'Октябрьский'}).active,1,
 'Read-only operation must be repeatable');
console.log('PR10 Equipment Population: historical scoped coverage, retirement, incomplete/unknown, snapshot persistence and idempotence OK');
