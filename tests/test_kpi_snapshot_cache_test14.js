'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
let epochs=0,readCalls=0,readPersisted=0,sourceRevision=1;
const ids=['itsm_data','mobile_brigade_data','drivers','combined'];
let instances=Object.fromEntries(ids.map(id=>[id,{
 id,records:[{id}],meta:{sourceType:'sqlite',activeRevision:1,
  contentHash:'hash-1',freshness:'2026-10-01'},
 validation:{status:'valid',warnings:[],errors:[]}
}]));
const core={hasOpenDatabase:()=>true,
 getDatabaseInfo:()=>({valid:true,databaseUuid:'db-test'}),
 listDatasets:()=>ids.map(id=>({dataset_id:id,active_revision:sourceRevision,
  content_hash:'hash-'+sourceRevision,updated_at:'2026-10-29',
  record_count:1}))};
const runtime={
 get:id=>{readCalls++;return instances[id]},
 cacheEpoch:()=>epochs,
 cacheSnapshotStamp:()=>JSON.stringify(['db-test',epochs,core.listDatasets()
   .map(row=>[row.dataset_id,row.active_revision,row.updated_at,
     row.content_hash,row.record_count])])
};
const expected=Object.freeze({status:'ready',diagnostics:{stage:'full'}});
const store={identity:()=> 'db-test',read:()=>{readPersisted++;return expected},
 write:()=>{}};
const ctx={globalThis:null,console,Map,Set,Array,Object,Number,String,JSON,
 ReclassifierRuntimeDataRepository:runtime,ReclassifierDatabaseRepository:core,
 ReclassifierKpiSnapshotStore:store,
 RECLASSIFIER_BUILD:{testLabel:'TEST_14_PR322'},
 ReclassifierKpiComputationService:{prepare:()=>({}),calculate:()=>({}),invalidate(){}},
 ReclassifierKpiCalculatorCommon:{selectRows:()=>[]},
 ReclassifierKpiCatalog:{list:()=>[],get:()=>null},
 ReclassifierKpiReportViewModel:{create:()=>({}),withForecasts:()=>({})},
 ReclassifierKpiExecutionTrace:{createCollector:()=>({})},
 ReclassifierReportSnapshot:{create:()=>({}),deepFreeze:x=>x,schemaVersion:'1.0.0'},
 ReclassifierKpiSourceFacts:{version:'1.0.0',
  sourceReportingCoverage:()=>({status:'observed-only',
   coverageFrom:'2026-01-01',coverageThrough:'2026-10-01'}),
  reportingMonthStatus:()=>({status:'observed'})},
 ReclassifierKpiOperationalSeries:{invalidate(){}},
 ReclassifierKpiForecastEngine:{predictReportingMonth:()=>({}),version:'1.0.0'},
 ReclassifierDatabaseMemoryDiagnostics:{mark(){}}
};
ctx.globalThis=ctx;vm.createContext(ctx);
vm.runInContext(fs.readFileSync('src/js/app/reliability_report_service.js','utf8'),ctx);
const report=ctx.ReclassifierReliabilityReportService;
const first=report.getCachedSnapshot({});
assert.equal(first,expected);
assert.equal(readCalls,4,'Initial source validation must inspect all four sources');
assert.equal(readPersisted,1);
const next=report.getCachedSnapshot({});
assert.equal(next,expected);
assert.equal(readCalls,4,'Hot KPI cached Snapshot must not fetch full sources');
epochs++;
report.getCachedSnapshot({});
assert.equal(readCalls,8,'Runtime cache epoch change must force source verification');
sourceRevision++;
instances=Object.fromEntries(ids.map(id=>[id,{
 ...instances[id],meta:{...instances[id].meta,
  activeRevision:sourceRevision,contentHash:'hash-'+sourceRevision}
}]));
report.getCachedSnapshot({});
assert.equal(readCalls,12,'SQLite Registry revision change must force source verification');
assert.equal(readPersisted,2,
 'New source revision must invalidate Snapshot memory cache');
console.log('PASS TEST_14 KPI: hot cache without full Dataset reads; invalidation on epoch/revision');
