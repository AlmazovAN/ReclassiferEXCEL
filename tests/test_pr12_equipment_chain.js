'use strict';
// PR12: cross-layer acceptance for mine-scoped Equipment accumulation,
// persisted observations, conservative history population and safe failure.
const assert=require('node:assert/strict');
const partitions=require('../src/js/modules/equipment/equipment_partitions.js');
const history=require('../src/js/modules/equipment/equipment_history.js');
const population=require('../src/js/modules/equipment/equipment_population.js');
const equipment=(id,unit,location,retired=null)=>({
  id,unit,location,name:'Device '+id,equipment_type:'Стационарное',
  commissioning_date:'',not_working_since:retired
});
const start=[
  equipment('O-1','Октябрьский','-300'),
  equipment('O-2','Октябрьский','-500'),
  equipment('M-1','Маяк','-100')
];
const empty={records:[],joinIndex:new Map()};
const observed=(previousRows,nextRows,sections,sourceDate,prior)=>history.observe({
  datasetId:'stationary',previousRows,nextRows,sections,sourceDate,
  previousHistory:prior,recordedAt:sourceDate+'T11:00:00Z',
  sourceName:'CatalogStationaryEquipment-'+sourceDate+'.xlsx'
});
const first=partitions.merge('stationary',empty,start,new Map());
assert.equal(first.records.length,3);
let journal=observed([],first.records,['Октябрьский','Маяк'],'2025-01-01');
const originalSnapshot=JSON.stringify(journal);
assert.equal(population.evaluate({stationary:journal},{
  asOf:'2025-01-01',mine:'Октябрьский',sources:['stationary']
}).active,2);
assert.equal(population.evaluate({stationary:journal},{
  asOf:'2025-01-01',mine:'Маяк',sources:['stationary']
}).active,1);
const afterOctober=partitions.merge('stationary',first,
  [equipment('O-1','Октябрьский','-350'),
   equipment('O-2','Октябрьский','-500','2025-03-01')],
  partitions.ownership({stationary:first})
);
assert.equal(afterOctober.records.length,3);
assert.equal(afterOctober.records.find(r=>r.id==='M-1').location,'-100',
  'Replacing October mine must preserve Mayak unchanged');
const april=observed(first.records,afterOctober.records,
  ['Октябрьский'],'2025-04-01',journal);
assert.equal(JSON.stringify(journal),originalSnapshot,
  'Import staging must never mutate prior history');
assert(april.events.some(e=>e.type==='decommissioned' && e.id==='O-2'));
assert(april.events.some(e=>e.type==='attributes_changed' && e.id==='O-1'));
const before=population.evaluate({stationary:april},{
  asOf:'2025-02-28',mine:'Октябрьский',sources:['stationary']
});
const after=population.evaluate({stationary:april},{
  asOf:'2025-04-01',mine:'Октябрьский',sources:['stationary']
});
assert.equal(before.active,2);
assert.equal(after.active,1);
assert.equal(after.inactive,1);
assert.equal(after.bySource[0].observedOn,'2025-04-01');
const mayak=population.evaluate({stationary:april},{
  asOf:'2025-04-01',mine:'Маяк',sources:['stationary']
});
assert.equal(mayak.active,1);
assert.equal(mayak.bySource[0].observedOn,'2025-01-01',
  'Mayak is not silently refreshed by October upload');
const idempotent=partitions.merge('stationary',
  {records:afterOctober.records,joinIndex:afterOctober.joinIndex},
  [equipment('O-1','Октябрьский','-350'),
   equipment('O-2','Октябрьский','-500','2025-03-01')],
  partitions.ownership({stationary:afterOctober})
);
const journalAgain=observed(afterOctober.records,idempotent.records,
  ['Октябрьский'],'2025-04-01',april);
assert.equal(journalAgain.events.length,april.events.length,
  'Repeated identical snapshot must not generate spurious equipment change events');
assert.equal(idempotent.records.length,3);
const restored=JSON.parse(JSON.stringify(journalAgain));
assert.deepEqual(population.evaluate({stationary:restored},{
  asOf:'2025-04-01',mine:'Октябрьский',sources:['stationary']
}),after,'Portable JSON must preserve historical population');
const invalid=partitions.merge.bind(null,'stationary',
  {records:afterOctober.records},[
    equipment('O-1','Октябрьский','-350'),
    equipment('O-1','Октябрьский','-350')],new Map());
assert.throws(invalid,/повторный ID/);
assert.equal(afterOctober.records.length,3,'Failed import must not alter active source');
assert.equal(population.evaluate({stationary:restored},{
  asOf:'2024-12-31',mine:'Октябрьский',sources:['stationary']
}).active,null,'No observation before the first snapshot is not zero');
const owners=partitions.ownership({stationary:afterOctober});
const zabbix=partitions.merge('zabbix',empty,
 [{zabbix__id:'Z-1',equipment:'O-1',zabbix__name:'Host A'}],owners);
assert.equal(zabbix.records[0].__partition_unit,'октябрьский');
assert.throws(()=>partitions.merge('zabbix',empty,
 [{zabbix__id:'Z-X',equipment:'UNKNOWN'}],owners),/не определён рудник/);
console.log('PR12 Equipment chain: mine isolation, repeated import, history, retrospective counts, JSON portability and Zabbix guards OK');
