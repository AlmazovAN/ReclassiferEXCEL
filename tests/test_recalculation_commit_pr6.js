'use strict';
const assert = require('node:assert/strict');

require('../src/js/app/dataset_catalog.js');
require('../src/js/app/field_registry.js');
require('../src/js/modules/itsm/dataset_schema.js');
require('../src/js/app/recalculation_core.js');
require('../src/js/app/recalculation_materializer.js');
require('../src/js/app/recalculation_commit.js');

const schema=globalThis.ReclassifierItsmDatasetSchema;
const catalog=globalThis.ReclassifierDatasetCatalog;
const index=Object.fromEntries(schema.fields.map((field,i)=>[field,i]));
const row=(number, labor)=> {
  const record=Array(schema.fields.length).fill(null);
  record[index.number]=number;
  record[index.createdAt]='2026-01-01T10:00:00';
  record[index.result6LaborHours]=labor;
  record[index.mbPresence]='Нет в МБ';
  return record;
};
const fullColumns=Array(62).fill('');
fullColumns[0]='Номер';
fullColumns[17]='RAW UNKNOWN DATA';
fullColumns[27+(index.result6LaborHours-17)]=schema.labels[index.result6LaborHours];
fullColumns[27+(index.mbPresence-17)]=schema.labels[index.mbPresence];
const rawRow=Array(62).fill(null);
rawRow[0]='INC-1';
rawRow[17]='ORIGINAL-RAW';
rawRow[27+(index.result6LaborHours-17)]=1;
const itsm = {
 id:'itsm_data',file:null,records:[row('INC-1',1),row('INC-2',2)],
 validation:{status:'valid',errors:[],warnings:[]},
 meta:{schemaVersion:'1.2.0',fields:Array.from(schema.fields),activeRevision:5,
  latestSourceDate:'2026-09-01'},
 fullDataset:{columns:fullColumns,rows:[rawRow],recordKeys:['inc-1'],coverage:'partial'}
};
const mb={
 id:'mobile_brigade_data',file:null,
 records:[{recordKey:'task-1',request:'INC-1',itsmCreatedAt:null,
   laborHours:3,astroHours:1.5,description:'Preserve'}],
 validation:{status:'valid',errors:[],warnings:[]},
 meta:{schemaVersion:'1.5.0',activeRevision:8},
 fullDataset:{columns:['raw column'],rows:[['source']],recordKeys:['task-1'],coverage:'complete'}
};
const kpiOld={id:'kpi_source',records:[[99]],
 validation:{status:'valid',errors:[],warnings:[]},meta:{activeRevision:3}};
const map=new Map([['itsm_data',itsm],['mobile_brigade_data',mb],['kpi_source',kpiOld]]);
const runtime={
 mode:()=> 'legacy', get:id=>map.get(id)||null,
 assertLegacyWriteAllowed:()=>{},
 invalidate:()=>{}
};
let publishes=0, failBatch=false;
const lifecycle={
 state:id=>({active:map.get(id)||null}),
 activateBatch:batch=>{
   if (failBatch) throw new Error('Synthetic atomic apply failure');
   const copy=new Map(map);
   for(const item of batch) {
     if(!['valid','warning'].includes(item.validation?.status)) throw new Error('Invalid candidate');
     copy.set(item.id,item);
   }
   map.clear();for(const [id,inst] of copy)map.set(id,inst);
   publishes++;
 }
};
const kpi={
 schemaVersion:'1.0.0',
 aggregateItsmDataset:(fields,rows)=>{
   assert.equal(fields.length,52);
   return {
     fields:['period','total'],
     columns:['Period','Total'],
     records:[{period:'2026-01-01',total:rows.reduce((sum,r)=>sum+r[index.result6LaborHours],0)}]
   };
 },
 datasetPayload:(aggregate,count)=>({
    schemaVersion:'1.0.0', fields:aggregate.fields,columns:aggregate.columns,
    records:aggregate.records.map(x=>[x.period,x.total]),latestPeriod:'2026-01-01',
    earliestPeriod:'2026-01-01',sourceRows:count
 })
};
const engine=globalThis.ReclassifierRecalculationCore.create({runtime,catalog,itsmSchema:schema});
const commit=globalThis.ReclassifierRecalculationCommit.create({
 runtime,catalog,schema,materializer:globalThis.ReclassifierRecalculationMaterializer,
 lifecycle,kpi
});

(async()=>{
 const snapshots=[JSON.stringify(itsm.records),JSON.stringify(mb.records),JSON.stringify(itsm.fullDataset)];
 const plan=await engine.preview({asOfDate:'2026-10-14',steps:[
   {datasetId:'mobile_brigade_data',calculate:()=>({itsmCreatedAt:'2026-01-01T10:00:00'})},
   {datasetId:'itsm_data',calculate:({key})=>key==='inc-1'?
      {result6LaborHours:3,mbPresence:'Есть в МБ'}:{}}
 ]});
 assert.equal(plan.changed,2);
 assert.throws(()=>commit.apply(plan,{assertCurrent:engine.assertCurrent}),/подтверждение/);
 assert.equal(publishes,0);
 failBatch=true;
 assert.throws(()=>commit.apply(plan,{confirmed:true,assertCurrent:engine.assertCurrent}),
   /Synthetic atomic apply failure/);
 failBatch=false;
 assert.equal(publishes,0);
 assert.equal(map.get('itsm_data'),itsm);
 assert.equal(map.get('mobile_brigade_data'),mb);
 assert.equal(map.get('kpi_source'),kpiOld);
 assert.deepEqual([JSON.stringify(itsm.records),JSON.stringify(mb.records),
     JSON.stringify(itsm.fullDataset)],snapshots);
 const result=commit.apply(plan,{confirmed:true,assertCurrent:engine.assertCurrent,
    rulesVersions:{itsm_data:'1.2.1',mobile_brigade_data:'1.5.0'}});
 assert.equal(result.mode,'legacy');
 assert.deepEqual(Array.from(result.changedDatasetIds),
   ['mobile_brigade_data','itsm_data','kpi_source']);
 assert.equal(publishes,1);
 assert.equal(map.get('itsm_data').records[0][index.result6LaborHours],3);
 assert.equal(map.get('itsm_data').records[1][index.result6LaborHours],2);
 assert.equal(map.get('mobile_brigade_data').records[0].itsmCreatedAt,'2026-01-01T10:00:00');
 assert.equal(map.get('mobile_brigade_data').records[0].description,'Preserve');
 assert.equal(map.get('mobile_brigade_data').fullDataset.rows[0][0],'source');
 const full=map.get('itsm_data').fullDataset;
 assert.equal(full.rows.length,1);
 assert.equal(full.rows[0][17],'ORIGINAL-RAW');
 assert.equal(full.rows[0][27+(index.result6LaborHours-17)],3);
 assert.equal(full.rows[0][27+(index.mbPresence-17)],'Есть в МБ');
 assert.equal(map.get('kpi_source').records[0][1],5);
 assert.equal(map.get('itsm_data').meta.activeRevision,6);
 assert.equal(map.get('mobile_brigade_data').meta.activeRevision,9);
 assert.equal(map.get('itsm_data').meta.dependencyRevisions.mobile_brigade_data,9);
 assert.equal(map.get('kpi_source').meta.dependencyRevisions.itsm_data,6);
 assert.equal(map.get('itsm_data').meta.recalculationHistory.length,1);
 assert.throws(()=>engine.assertCurrent(plan),/изменился/);
 assert.deepEqual([JSON.stringify(itsm.records),JSON.stringify(mb.records),
     JSON.stringify(itsm.fullDataset)],snapshots);

 // A genuinely unchanged preview is strictly no-op: don't regenerate KPI,
 // bump revisions, mutate data, or append journal entries.
 const noop=await engine.preview({steps:[{datasetId:'itsm_data',calculate:()=>({})}]});
 const noResult=commit.apply(noop,{confirmed:true,assertCurrent:engine.assertCurrent});
 assert.equal(noResult.noOp,true);
 assert.equal(publishes,1);

 // A forged/invalid field patch must be rejected before writing anything.
 assert.throws(()=>globalThis.ReclassifierRecalculationMaterializer.validateAndPatch(
   'itsm_data',map.get('itsm_data').records[0],{
     key:'inc-1',
     fields:{number:{before:'INC-1',after:'OTHER'}}
   },schema.fields,schema
 ),/запрещено/);
 assert.equal(publishes,1);
 console.log('PR6 legacy atomic publication, KPI, Full Dataset projection, rollback, stale plan and no-op OK');
})().catch(error=>{console.error(error);process.exitCode=1;});
