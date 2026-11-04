'use strict';
const assert=require('node:assert/strict');
const api=require('../src/js/modules/equipment/equipment_partitions.js');
const catalog={
 mounted:{records:[
   {id:'M-A',unit:'Mine-A',transport:'Truck A'},
   {id:'M-B',unit:'Mine-B',transport:'Truck B'}]},
 stationary:{records:[
   {id:'S-A',unit:'Mine-A'},
   {id:'S-B',unit:'Mine-B'}]}
};
const owners=api.ownership(catalog);
assert.equal(owners.get('M-A'),'mine-a');
assert.equal(owners.get('S-B'),'mine-b');
const scoped=(id,oldRows,newRows)=>api.merge(id,
 {records:oldRows,joinIndex:api.joinIndex(id,oldRows)},newRows,owners);

const mounted=scoped('mounted',catalog.mounted.records,[
 {id:'M-A2',unit:'Mine-A',transport:'New Truck A'}
]);
assert.deepEqual(mounted.records.map(x=>x.id),['M-B','M-A2']);
assert.deepEqual(mounted.replacedPartitions,['Mine-A']);
assert.equal(mounted.removedRows,1);
assert.equal(mounted.preservedRows,1);
const stationary=scoped('stationary',catalog.stationary.records,[
 {id:'S-A2',unit:'Mine-A'}
]);
assert.deepEqual(stationary.records.map(x=>x.id),['S-B','S-A2']);

const transportRows=[
 {transport__id:'T-A',unit:'Mine-A',name:'Truck A'},
 {transport__id:'T-B',unit:'Mine-B',name:'Truck B'}];
const transport=scoped('transport',transportRows,[
 {transport__id:'T-A2',unit:'Mine-A',name:'Truck A2'}
]);
assert.deepEqual(transport.records.map(x=>x.transport__id),['T-B','T-A2']);
assert.equal(transport.joinIndex.get(api.joinKey('Mine-B','Truck B')).transport__id,'T-B');

// StartPoints are source-only: earlier releases stored no records but a
// serialized link index. Reconstruct it before replacing one mine scope.
const startpointLegacy={
 records:[],joinIndex:new Map([
   [api.joinKey('Mine-A','Truck A'),true],
   [api.joinKey('Mine-B','Truck B'),true]
 ])};
const points=api.merge('transport_start_points',startpointLegacy,
 [{unit:'Mine-A',name:'Truck A2'}],owners);
assert.equal(points.records.length,2);
assert.equal(points.records[0].unit,'mine-b');
assert(points.joinIndex.has(api.joinKey('Mine-B','Truck B')));
assert(points.joinIndex.has(api.joinKey('Mine-A','Truck A2')));
assert(!points.joinIndex.has(api.joinKey('Mine-A','Truck A')));

// Legacy Transport rows also persisted only the projected 5 fields and a
// standalone index. The join is recoverable by the stable transport ID.
const legacyTransport={
 records:[{transport__id:'T-A'}, {transport__id:'T-B'}],
 joinIndex:new Map([
   [api.joinKey('Mine-A','Truck A'),{transport__id:'T-A'}],
   [api.joinKey('Mine-B','Truck B'),{transport__id:'T-B'}]
 ])};
const migratedTransport=api.merge('transport',legacyTransport,
 [{transport__id:'T-A2',unit:'Mine-A',name:'Truck A2'}],owners);
assert.equal(migratedTransport.records.length,2);
assert.equal(migratedTransport.records[0].unit,'mine-b');
assert(migratedTransport.joinIndex.has(api.joinKey('Mine-B','Truck B')));

// Zabbix scope is NOT a site_address_* guess: the only trusted mine source
// is the linked equipment ID in Mounted or Stationary.
const zabbixOld={
 records:[{zabbix__id:'Z-A'}, {zabbix__id:'Z-B'}],
 joinIndex:new Map([
   ['M-A',[{zabbix__id:'Z-A'}]],
   ['S-B',[{zabbix__id:'Z-B'}]]
 ])};
const zabbix=api.merge('zabbix',zabbixOld,[
 {zabbix__id:'Z-A2',equipment:'M-A'}
],owners);
assert.deepEqual(zabbix.records.map(x=>x.zabbix__id),['Z-B','Z-A2']);
assert.equal(zabbix.records[0].__partition_unit,'mine-b');
assert.equal(zabbix.records[1].__partition_unit,'mine-a');
assert(zabbix.joinIndex.get('S-B')?.length===1);
assert(!zabbix.joinIndex.has('MISSING'));

// Refuse an unattached new record; deleting an inferred mine from its site
// address would be unsafe.
assert.throws(()=>api.merge('zabbix',zabbixOld,
 [{zabbix__id:'Z-X',equipment:'unknown-id'}],owners),/не определён рудник/);
assert.throws(()=>scoped('mounted',catalog.mounted.records,[
 {id:'M-A',unit:'Mine-B'}
]),/повторный ID/);
assert.throws(()=>scoped('transport',transportRows,[
 {transport__id:'T-A2',unit:'Mine-A',name:'Truck A2'},
 {transport__id:'T-A3',unit:'Mine-A',name:'Truck A2'}
]),/повторная связка/);
assert.throws(()=>scoped('mounted',catalog.mounted.records,
 [{id:'X',unit:''}]),/не определён рудник/);
assert.throws(()=>scoped('transport_start_points',[],[]),/непустая/);

// No source-only provenance is added to the public Equipment_Combined schema.
console.log('PR8 five Equipment mine scopes, legacy StartPoints/Transport/Zabbix join recovery, unknown and collision guards OK');
