'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
let reads={mounted:0,stationary:0,combined:0};
const rows=[
 {dataset_id:'mounted',active_revision:1,record_count:2,updated_at:'2026-10-29',content_hash:'m1'},
 {dataset_id:'stationary',active_revision:1,record_count:1,updated_at:'2026-10-29',content_hash:'s1'}
];
const contract={mounted:{persisted:true,title:'Mounted',kind:'equipment'},
 stationary:{persisted:true,title:'Stationary',kind:'equipment'},
 combined:{persisted:false,title:'Combined',kind:'equipment',
   dependencies:['mounted','stationary']}};
const legacy={get:()=>null,
 list:()=>Object.keys(contract).map(id=>({id,kind:'equipment',active:null}))};
const database={hasOpenDatabase:()=>true,
 getDatabaseInfo:()=>({valid:true,databaseUuid:'db-1'}),
 listDatasets:()=>rows.map(x=>({...x})),
 getDataset:id=>{reads[id]++;return {
   records:Array.from({length:rows.find(x=>x.dataset_id===id).record_count},(_,i)=>({id,i})),
   state:{},fullDataset:null
 }}};
const phases=[];
const ctx={console,Map,Set,Array,Object,Number,String,JSON,Error,
 RECLASSIFIER_BUILD:{testLabel:'TEST_14_PR322'},
 ReclassifierLegacyDatasetStore:legacy,
 ReclassifierDatabaseRepository:database,
 ReclassifierDatabaseContract:{datasets:contract},
 ReclassifierDatabaseMemoryDiagnostics:{mark:(p,e,d)=>phases.push({p,e,d})},
 globalThis:null};
ctx.globalThis=ctx;vm.createContext(ctx);
vm.runInContext(fs.readFileSync('src/js/app/data_repository.js','utf8'),ctx);
const repo=ctx.ReclassifierRuntimeDataRepository;
let computed=0;
repo.registerDerived('combined',()=>{
 computed++;
 return {id:'combined',records:[{combined:true}],
   meta:{sourceType:'sqlite',normalizedRows:1},
   validation:{status:'valid',errors:[],warnings:[]}};
});
const list=repo.list();
assert.deepEqual(reads,{mounted:0,stationary:0,combined:0});
assert.equal(computed,0,'Derived resolver must not run for list metadata');
assert.equal(list.find(x=>x.id==='combined').active.meta.sourceType,'sqlite');
assert.equal(repo.source('combined'),'sqlite');
assert.equal(computed,0,'Derived source probe must not build Equipment_Combined');
const active=list.find(x=>x.id==='combined').active;
assert.equal(active.records.length,1);
assert.equal(computed,1);
repo.get('mounted');
assert.equal(reads.mounted,1);
const oldEpoch=repo.cacheEpoch();
repo.invalidate(['stationary']);
assert(repo.cacheEpoch()>oldEpoch);
repo.get('mounted');
assert.equal(reads.mounted,1,'Unrelated mounted cache must be retained');
repo.list();
assert.equal(computed,1,'Listing after invalidate must not build derived');
repo.get('combined');
assert.equal(computed,2,'Changed dependency must invalidate combined resolver');
assert(phases.some(x=>x.p==='runtime-derived-lazy'));
console.log('PASS TEST_14 derived: zero materializations during list/source; on-demand, selective invalidation');
