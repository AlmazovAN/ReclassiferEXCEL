'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
let reads={drivers:0,mounted:0};
let registry=[
  {dataset_id:'drivers',active_revision:1,record_count:200000,
    content_hash:'d1',updated_at:'2026-10-29',source_file_name:'drivers.xlsx'},
  {dataset_id:'mounted',active_revision:1,record_count:50000,
    content_hash:'m1',updated_at:'2026-10-29',source_file_name:'mounted.xlsx'}
];
const definitions={
  drivers:{id:'drivers',title:'Drivers',kind:'reference',persisted:true},
  mounted:{id:'mounted',title:'Mounted',kind:'reference',persisted:true}
};
const legacy={
  get:id=>({id,records:[],meta:{sourceType:'embedded'}}),
  list:()=>Object.keys(definitions).map(id=>({
    id,kind:'reference',active:{id,records:[],meta:{sourceType:'embedded'}}
  }))
};
const db={
  hasOpenDatabase:()=>true,
  getDatabaseInfo:()=>({valid:true,databaseUuid:'database-1'}),
  listDatasets:()=>registry.map(r=>({...r})),
  getDataset(id){
    reads[id]++;
    const row=registry.find(r=>r.dataset_id===id);
    return {id,records:[{v:id}],registry:row,state:{}};
  }
};
const ctx={globalThis:null,console,Map,Set,Array,Object,Number,String,
  RECLASSIFIER_BUILD:{testLabel:'TEST_13_PR322'},
  ReclassifierDatabaseRepository:db,
  ReclassifierLegacyDatasetStore:legacy,
  ReclassifierDatabaseContract:{datasets:definitions}
};
ctx.globalThis=ctx;vm.createContext(ctx);
vm.runInContext(fs.readFileSync('src/js/app/data_repository.js','utf8'),ctx);
const runtime=ctx.ReclassifierRuntimeDataRepository;
const items=runtime.list();
assert.deepEqual(reads,{drivers:0,mounted:0},
  'Listing metadata must never fetch SQLite record arrays');
assert.equal(items[0].active.meta.normalizedRows,200000);
assert.equal(items[1].active.meta.sourceType,'sqlite');
// A data consumer retains access to real records, with validation against
// Registry (adjust fake record count only after verifying cheap list).
registry=registry.map(r=>({...r,record_count:1}));
runtime.invalidate();
assert.equal(runtime.list()[0].active.records[0].v,'drivers');
assert.deepEqual(reads,{drivers:1,mounted:0});
runtime.get('mounted');
assert.deepEqual(reads,{drivers:1,mounted:1});
registry=registry.map(r=>r.dataset_id==='drivers'
  ? {...r,active_revision:2,content_hash:'d2'}:r);
runtime.invalidate(['drivers']);
runtime.get('mounted');
assert.deepEqual(reads,{drivers:1,mounted:1},
  'Selective invalidation must not discard an unrelated Dataset');
runtime.get('drivers');
assert.deepEqual(reads,{drivers:2,mounted:1});
runtime.invalidate();
runtime.get('mounted');
assert.deepEqual(reads,{drivers:2,mounted:2},
  'Full invalidation still clears all Dataset caches on open/close');
console.log('PASS TEST_13 Runtime: metadata list without loads and selective cache invalidation');
