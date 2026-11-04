'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync('src/js/app/data_repository.js','utf8');
const registry=['itsm_data','mobile_brigade_data'].map((id,i)=>({
  dataset_id:id,title:id,kind:'source',dataset_schema_version:'1.0.0',
  integration_strategy:'UPSERT',active_revision:i+1,record_count:2,
  updated_at:'2026-10-29T19:39:10Z',content_hash:'hash-'+i,
  persisted:1
}));
const payload={
  itsm_data:{
    id:'itsm_data',records:[['INC-1'],['INC-2']],
    state:{fields:['number'],fullDataset:{columns:['Номер','Просрочен по разрешению','Описание']}},
    fullDataset:{columns:['Номер','Просрочен по разрешению','Описание'],
      recordKeys:['INC-1','INC-2'],
      rows:[['INC-1',true,'Long details'],['INC-2',false,'Other details']],coverage:'complete'}
  },
  mobile_brigade_data:{
    id:'mobile_brigade_data',records:[{request:'INC-1'},{request:'INC-2'}],
    state:{fullDataset:{columns:['Номер','Описание']}},
    fullDataset:{columns:['Номер','Описание'],
      rows:[['TASK-1','Long description'],['TASK-2','Another long description']],coverage:'complete'}
  }
};
const reads={full:0,kpi:0,fullOnly:0};
const checkpoints=[];
const database={
  hasOpenDatabase:()=>true,
  getDatabaseInfo:()=>({databaseUuid:'test17-db',valid:true}),
  listDatasets:()=>registry.map(x=>({...x})),
  getDataset(id){reads.full++;return {...payload[id],registry:registry.find(x=>x.dataset_id===id)}},
  getDatasetFullRows(id){
    reads.fullOnly++;
    const {records,...rest}=payload[id];
    return {...rest,registry:registry.find(x=>x.dataset_id===id)}
  },
  getKpiDataset(id){
    reads.kpi++;
    const full=payload[id];
    return {
      ...full,registry:registry.find(x=>x.dataset_id===id),
      fullDataset:id==='mobile_brigade_data'?null:{
        ...full.fullDataset,columns:['Просрочен по разрешению'],
        rows:full.fullDataset.rows.map(row=>[row[1]])
      }
    }
  }
};
const context={console,JSON,Date,Math,Map,Set,Array,Object,String,Number,Error,
  RECLASSIFIER_BUILD:{testLabel:'TEST_17_PR332'},
  ReclassifierDatabaseRepository:database,
  ReclassifierDatabaseContract:{datasets:{
    itsm_data:{title:'ITSM',kind:'source',persisted:true},
    mobile_brigade_data:{title:'MB',kind:'source',persisted:true}
  }},
  ReclassifierDiagnosticV2:{checkpoint:(phase,values)=>
    checkpoints.push({phase,values})},
  ReclassifierLegacyDatasetStore:{get:id=>payload[id]}
};
context.globalThis=context;
vm.createContext(context);
vm.runInContext(source,context);
const runtime=context.ReclassifierRuntimeDataRepository;
assert.equal(runtime.mode(),'sqlite');
const mobileKpi=runtime.getForKpi('mobile_brigade_data');
assert.equal(reads.kpi,1);
assert.equal(mobileKpi.fullDataset,undefined);
assert.equal(mobileKpi.records.length,2);
assert.equal(runtime.getForKpi('mobile_brigade_data'),mobileKpi,
  'The projected source must be revision-cached');
assert.equal(reads.kpi,1);
const mobileFull=runtime.get('mobile_brigade_data');
assert.equal(reads.full,0,'After KPI, full view must not re-decode the entire analytical dataset');
assert.equal(reads.fullOnly,1,'After KPI, upgrade should read only Full Dataset rows');
assert.equal(mobileFull.records,mobileKpi.records,
  'KPI and Full Runtime must share the same analytical array');
assert.equal(checkpoints.at(-1).values.runtimeCacheRows,2,
  'Diagnostic counts distinct analytical arrays, not duplicated KPI and Full cache references');
assert.equal(mobileFull.fullDataset.rows[0][1],'Long description');
assert.equal(runtime.getForKpi('mobile_brigade_data'),mobileKpi);
const itsmFull=runtime.get('itsm_data');
assert.equal(reads.full,1);
assert.equal(itsmFull.fullDataset.columns.length,3);
const itsmKpi=runtime.getForKpi('itsm_data');
assert.equal(reads.kpi,1,'Full cached ITSM should share analytical records');
assert.equal(itsmKpi.records,itsmFull.records,
  'No duplicate analytical arrays when the full Dataset already exists');
assert.equal(itsmKpi.fullDataset.columns.length,1);
assert.deepEqual([...itsmKpi.fullDataset.rows].map(row=>Array.from(row)),[[true],[false]]);
assert.equal(itsmFull.fullDataset.columns.length,3,'Full Runtime must not be mutated');
runtime.invalidate(['mobile_brigade_data']);
assert.equal(runtime.getForKpi('mobile_brigade_data').fullDataset,undefined);
assert.equal(reads.kpi,2,'Dataset revision invalidation must refresh KPI projection');
const other=runtime.getForKpi('itsm_data');
assert.equal(other,itsmKpi,'Unchanged dataset projection remains cached');
assert.equal(reads.full,1);
registry[0].active_revision++;
runtime.invalidate(['itsm_data']);
assert.notEqual(runtime.getForKpi('itsm_data'),itsmKpi);
assert.equal(reads.kpi,3);
console.log('PASS TEST_17 Runtime: bidirectional record sharing, full-only upgrade, scoped invalidation and unmodified generic data');
