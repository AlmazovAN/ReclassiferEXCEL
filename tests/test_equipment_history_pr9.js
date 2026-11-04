'use strict';
const assert=require('node:assert/strict');
const api=require('../src/js/modules/equipment/equipment_history.js');
const at=(n)=>'2026-10-'+String(n).padStart(2,'0')+'T12:00:00.000Z';
const row=(id,unit,location,notWorkingSince=null)=>({
  id,unit,location,name:'Camera '+id,equipment_type:'Камера',
  commissioning_date:'2025-01-01',not_working_since:notWorkingSince
});
const mineA=row('EQ-1','Mine-A','-300m');
const mineB=row('EQ-2','Mine-B','-650m');
const initial=api.observe({
 datasetId:'stationary',previousRows:[],nextRows:[mineA,mineB],
 sections:['Mine-A','Mine-B'],sourceName:'CatalogStationaryEquipment-2026-10-01.xlsx',
 sourceDate:'2026-10-01',recordedAt:at(1)
});
assert.equal(initial.events.length,2);
assert.equal(initial.events[0].type,'first_observed');
assert.equal(initial.events[0].eventDate,null);
assert.equal(initial.events[0].sourceDate,'2026-10-01');
assert.equal(initial.snapshots[0].rows.length,2);
assert.equal(initial.snapshots[0].rows[0].commissioningDateUnverified,'2025-01-01');
assert.equal(initial.snapshots[0].rows[0].status,'Активен');

const moved=row('EQ-1','Mine-C','-350m');
const afterMove=api.observe({
 datasetId:'stationary',previousRows:[mineA,mineB],nextRows:[mineB,moved],
 previousHistory:initial,sections:['Mine-A','Mine-C'],
 sourceDate:'2026-10-03',sourceName:'move-2026-10-03.xlsx',recordedAt:at(3)
});
assert.equal(afterMove.snapshots.length,2);
assert.deepEqual(afterMove.snapshots[1].sections,['mine-a','mine-c']);
assert.deepEqual(afterMove.snapshots[1].rows.map(x=>x.id),['EQ-1']);
assert.deepEqual(afterMove.events.filter(x=>x.type==='moved').map(x=>x.id),['EQ-1']);
assert.equal(afterMove.events.at(-1).before.unit,'Mine-A');
assert.equal(afterMove.events.at(-1).after.unit,'Mine-C');
assert.equal(afterMove.events.at(-1).eventDate,null,'Mine move date is not known.');
assert.equal(afterMove.lastKnown['EQ-2'].snapshot.unit,'Mine-B');
assert.equal(initial.snapshots.length,1,'History input must not mutate.');

const failedObservation=api.observe({
 datasetId:'stationary',previousRows:[mineB,moved],nextRows:[mineB],
 previousHistory:afterMove,sections:['Mine-C'],
 sourceDate:'2026-10-04',recordedAt:at(4)
});
const last=failedObservation.events.at(-1);
assert.equal(last.type,'missing_from_complete_scope');
assert.equal(last.id,'EQ-1');
assert.equal(last.eventDate,null);
assert.equal(failedObservation.lastKnown['EQ-1'].present,false);
assert.equal(failedObservation.lastKnown['EQ-1'].terminal,false);

const returned=api.observe({
 datasetId:'stationary',previousRows:[mineB],nextRows:[mineB,moved],
 previousHistory:failedObservation,sections:['Mine-C'],
 sourceDate:'2026-10-05',recordedAt:at(5)
});
assert.equal(returned.events.at(-1).type,'returned_to_observation');
const retired=row('EQ-1','Mine-C','-350m','2026-10-07');
const afterRetire=api.observe({
 datasetId:'stationary',previousRows:[mineB,moved],nextRows:[mineB,retired],
 previousHistory:returned,sections:['Mine-C'],
 sourceDate:'2026-10-08',recordedAt:at(8)
});
const retirement=afterRetire.events.at(-1);
assert.equal(retirement.type,'decommissioned');
assert.equal(retirement.eventDate,'2026-10-07','Real decommission is earlier than source observation.');
assert.equal(retirement.sourceDate,'2026-10-08');
assert.equal(afterRetire.lastKnown['EQ-1'].terminal,true);
assert.equal(afterRetire.snapshots.at(-1).rows[0].status,'Не активен');
assert.deepEqual(api.timeline(afterRetire,'EQ-1').map(e=>e.type),[
 'first_observed','moved','missing_from_complete_scope',
 'returned_to_observation','decommissioned'
]);
assert.throws(()=>api.observe({
 datasetId:'stationary',previousRows:[retired,mineB],nextRows:[moved,mineB],
 previousHistory:afterRetire,sections:['Mine-C'],recordedAt:at(9)
}),/окончательное выбытие/);
assert.throws(()=>api.observe({
 datasetId:'stationary',previousRows:[retired,mineB],
 nextRows:[{...retired,not_working_since:'2026-10-09'},mineB],
 previousHistory:afterRetire,sections:['Mine-C'],recordedAt:at(9)
}),/окончательное выбытие/);

const preexisting=api.observe({
 datasetId:'mounted',previousRows:[row('OLD','Mine-A','Level 1')],
 nextRows:[row('OLD','Mine-A','Level 2')],
 sections:['Mine-A'],sourceDate:null,previousSourceDate:null,
 sourceName:'no-date.xlsx',recordedAt:at(10)
});
assert.equal(preexisting.snapshots[0].kind,'inherited-baseline');
assert.equal(preexisting.snapshots[0].sourceDate,null);
assert.equal(preexisting.snapshots[0].observedAt,null);
assert.equal(preexisting.snapshots[1].sourceDate,null);
assert.equal(preexisting.snapshots[1].observedAt,at(10));
assert.equal(preexisting.events[0].type,'attributes_changed');
assert.equal(preexisting.events[0].eventDate,null);
assert.equal(preexisting.snapshots[0].rows[0].commissioningDateUnverified,'2025-01-01');
assert.equal(preexisting.events.filter(e=>e.type==='decommissioned').length,0);
assert.throws(()=>api.observe({
 datasetId:'mounted',previousRows:[],nextRows:[row('', 'Mine-A',null)],
 sections:['Mine-A'],recordedAt:at(10)
}),/пустой или повторный ID/);
assert.throws(()=>api.observe({
 datasetId:'mounted',previousRows:[],nextRows:[
 row('DUP','Mine-A',null),row('DUP','Mine-A',null)],
 sections:['Mine-A'],recordedAt:at(10)
}),/пустой или повторный ID/);

const transport=api.observe({
 datasetId:'transport',previousRows:[],nextRows:[{
 transport__id:'TR-01',unit:'Mine-A',transport__location:'Depot'
 }],sections:['Mine-A'],recordedAt:at(10)
});
assert.equal(transport.snapshots[0].rows[0].id,'TR-01');
const startPoints=api.observe({
 datasetId:'transport_start_points',previousRows:[],
 nextRows:[{unit:'Mine-A',name:'Truck-1'}],sections:['Mine-A'],
 recordedAt:at(10)
});
assert.equal(startPoints.snapshots[0].rows[0].id,'mine-a\u001ftruck-1');
const zabbix=api.observe({
 datasetId:'zabbix',previousRows:[],
 nextRows:[{zabbix__id:'Z-1',equipment:'EQ-1',__partition_unit:'Mine-A'}],
 sections:['Mine-A'],recordedAt:at(10)
});
assert.equal(zabbix.snapshots[0].rows[0].id,'Z-1');
const serialized=JSON.parse(JSON.stringify(afterRetire));
assert.equal(serialized.events.at(-1).eventDate,'2026-10-07');
console.log('PR9 Equipment History: mine moves, observations, absence, return, terminal decommission, five IDs, JSON persistence OK');
