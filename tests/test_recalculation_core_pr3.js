'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function load(path, context) {
  vm.runInContext(fs.readFileSync(path, 'utf8'), context, { filename: path });
}
const context = vm.createContext({
  console, Date, Map, Set, Object, String, Number, Error,
  Array, JSON, Promise, WeakMap
});
context.globalThis = context;
load('src/js/app/dataset_catalog.js', context);
load('src/js/app/field_registry.js', context);
load('src/js/modules/itsm/dataset_schema.js', context);
load('src/js/app/recalculation_core.js', context);
const core = context.ReclassifierRecalculationCore;
const schema = context.ReclassifierItsmDatasetSchema;
assert.equal(core.version, '1.0.0');

function itsmRow(number, createdAt) {
  const row = Array(schema.fields.length).fill(null);
  row[schema.fields.indexOf('number')] = number;
  row[schema.fields.indexOf('createdAt')] = createdAt;
  row[schema.fields.indexOf('result6LaborHours')] = 0;
  row[schema.fields.indexOf('mbPresence')] = 'Нет в МБ';
  return row;
}
const initialItsm = [itsmRow('INC-2025', '2025-06-01'), itsmRow('INC-2026', '2026-07-01')];
const initialMb = [
  { recordKey:'site|task-1', request:'INC-2025', itsmCreatedAt:null,
    laborHours:3, description:'Keep source description'},
  { recordKey:'site|task-2', request:'INC-2026', itsmCreatedAt:null,
    laborHours:5, description:'Another source'}
];
const itsm = {
  id:'itsm_data', records:initialItsm,
  meta:{ fields:Array.from(schema.fields), activeRevision:2 },
  fullDataset:{
    columns:['Номер','Unknown source'],rows:[['INC-2025','raw-kept']],
    recordKeys:['inc-2025'], coverage:'partial'
  }
};
const mb = {id:'mobile_brigade_data', records:initialMb, meta:{activeRevision:1}};
const store = new Map([['itsm_data',itsm],['mobile_brigade_data',mb]]);
let mode = 'sqlite';
const runtime = {mode:()=>mode, get:id=>store.get(id)};
const engine = core.create({
  runtime, catalog:context.ReclassifierDatasetCatalog, itsmSchema:schema
});

(async()=>{
  const beforeItsm = JSON.stringify(initialItsm);
  const beforeMb = JSON.stringify(initialMb);
  const asOfDate = '2026-10-14T00:00:00.000Z';
  let sawRaw = 0;
  const completedProgress = [];
  const plan = await engine.preview({
    asOfDate, sampleLimit:1,
    onProgress: value => {
      assert.equal(value.total,2);
      if (value.processed === 2) completedProgress.push(value);
    },
    steps:[
      {
        datasetId:'mobile_brigade_data',
        async calculate({record, getRecord, asOfDate:day}) {
          assert.equal(day,asOfDate);
          const parent = getRecord('itsm_data',record.request);
          assert(parent && Array.isArray(parent));
          const index=schema.fields.indexOf('createdAt');
          // Any mutation of the copy must never change Active Runtime.
          const originalNumber=parent[schema.fields.indexOf('number')];
          parent[schema.fields.indexOf('number')]='TAMPER';
          assert.equal(originalNumber,record.request);
          return {itsmCreatedAt:parent[index]};
        }
      },
      {
        datasetId:'itsm_data',
        calculate({record,key,getRecord,getRowsByField,raw}) {
          if(raw){sawRaw++;assert.equal(raw.values[1],'raw-kept');}
          const group=getRowsByField('mobile_brigade_data','request',key.toUpperCase());
          assert.equal(group.length,1);
          assert.equal(group[0].itsmCreatedAt,
            key==='inc-2025'?'2025-06-01':'2026-07-01');
          group[0].request='DO-NOT-MUTATE-RUNTIME';
          const updatedMb=getRecord('mobile_brigade_data',group[0].recordKey);
          return {result6LaborHours:updatedMb?.laborHours ?? 0,
            mbPresence:updatedMb?'Есть в МБ':'Нет в МБ'};
        }
      }
    ]
  });
  assert.equal(plan.kind,'recalculation-preview');
  assert.equal(plan.mode,'sqlite');
  assert.equal(plan.asOfDate,asOfDate);
  assert.equal(plan.checked,4);
  assert.equal(plan.changed,4);
  assert.equal(completedProgress.length,2);
  assert.deepEqual(completedProgress.map(p=>p.datasetId),
    ['mobile_brigade_data','itsm_data']);
  assert.equal(plan.hasChanges,true);
  assert.equal(plan.canCommit,false);
  assert.equal(plan.datasets[0].fullSourceCoverage,'missing');
  assert.equal(plan.datasets[1].fullSourceCoverage,'partial');
  assert.equal(sawRaw,1);
  assert.equal(plan.datasets[0].samples.length,1);
  assert.equal(plan.datasets[0].changes[0].fields.itsmCreatedAt.after,'2025-06-01');
  assert.equal(plan.datasets[1].changes[0].fields.result6LaborHours.after,3);
  assert.equal(plan.datasets[1].changes[0].fields.mbPresence.after,'Есть в МБ');
  assert.equal(engine.assertCurrent(plan),true);
  assert.equal(JSON.stringify(initialItsm),beforeItsm,'Preview mutated ITSM Runtime data.');
  assert.equal(JSON.stringify(initialMb),beforeMb,'Preview mutated MB Runtime data.');
  assert.equal(itsm.fullDataset.rows[0][1],'raw-kept');

  const noChanges = await engine.preview({
    asOfDate,
    steps:[{datasetId:'itsm_data',calculate:({record})=>({
      result6LaborHours:record[schema.fields.indexOf('result6LaborHours')]
    })}]
  });
  assert.equal(noChanges.changed,0);
  const unchangedProgress=[];
  await engine.preview({steps:[{datasetId:'itsm_data',calculate:()=>null}],
    onProgress:p=>unchangedProgress.push(p)});
  assert.equal(unchangedProgress.at(-1).processed,2);
  assert.equal(unchangedProgress.at(-1).changed,0);
  assert.equal(noChanges.datasets[0].unchanged,2);

  const sourceRequired = await engine.preview({
    asOfDate,
    steps:[{datasetId:'itsm_data', requireSourceRow:true,
      calculate:({raw})=>({result6LaborHours:raw.values[1] ? 9 : 0})}]
  });
  assert.equal(sourceRequired.datasets[0].skippedMissingSource,1);
  assert.equal(sourceRequired.datasets[0].changed,1);
  assert.equal(sourceRequired.datasets[0].fullSourceRows,1);

  await assert.rejects(()=>engine.preview({
    steps:[{datasetId:'itsm_data',calculate:()=>({number:'INVALID'})}]
  }),/запрещено изменять/);
  await assert.rejects(()=>engine.preview({
    steps:[{datasetId:'mobile_brigade_data',
      calculate:()=>({description:'CORRUPTED'})}]
  }),/запрещено изменять/);
  await assert.rejects(()=>engine.preview({
    steps:[{datasetId:'itsm_data',calculate:()=>({unregisteredField:1})}]
  }),/запрещено изменять/);
  await assert.rejects(()=>engine.preview({steps:[
    {datasetId:'itsm_data',calculate:()=>({})},
    {datasetId:'itsm_data',calculate:()=>({})}
  ]}),/повторный/);
  await assert.rejects(()=>engine.preview({steps:[
    {datasetId:'drivers',calculate:()=>({})}
  ]}),/некорректный/);
  await assert.rejects(()=>engine.preview({steps:[
    {datasetId:'itsm_data',calculate:()=>({})}
  ],asOfDate:'no-date'}),/некорректная дата/);
  const aborted={aborted:true};
  await assert.rejects(()=>engine.preview({signal:aborted,steps:[
    {datasetId:'itsm_data',calculate:()=>({})}
  ]}),/отменён/);

  assert.throws(()=>engine.assertCurrent({}),/неизвестный/);
  store.set('mobile_brigade_data',{...mb,records:[...mb.records]});
  assert.throws(()=>engine.assertCurrent(plan),/изменился/);
  store.set('mobile_brigade_data',mb);
  mode='legacy';
  assert.throws(()=>engine.assertCurrent(noChanges),/источник Runtime изменился/);
  mode='sqlite';

  // Source-row extraction is independent of absolute array indexes and
  // protects a historic dataset whose field ordering differs.
  const reversed = [...schema.fields].reverse();
  const reordered=itsmRow('INC-2027','2027-01-01')
    .map((_,i)=>itsmRow('INC-2027','2027-01-01')[schema.fields.indexOf(reversed[i])]);
  store.set('itsm_data',{
    id:'itsm_data',records:[reordered],meta:{fields:reversed},
    fullDataset:{columns:['raw'],rows:[['keep']],coverage:'complete'}
  });
  const alternate = await engine.preview({steps:[{
    datasetId:'itsm_data',calculate:({record})=>({
      result6LaborHours:6
    })
  }]});
  assert.equal(alternate.datasets[0].changed,1);
  assert.equal(alternate.datasets[0].changes[0].key,'inc-2027');

  // Large read-only scan still records only changed rows; does not copy
  // thousands of unaffected source arrays to a persistent Dataset.
  const many=[];
  for(let n=0;n<2200;n++)many.push(itsmRow('INC-'+n,'2026-01-01'));
  store.set('itsm_data',{id:'itsm_data',records:many,meta:{fields:Array.from(schema.fields)}});
  const volume=await engine.preview({steps:[{datasetId:'itsm_data',
    calculate:({index})=>index===2199?{result6LaborHours:1}:{}}]});
  assert.equal(volume.checked,2200);
  assert.equal(volume.changed,1);
  assert.equal(volume.datasets[0].changes.length,1);
  assert.equal(volume.datasets[0].changes[0].rowIndex,2199);
  assert.equal(many[2199][schema.fields.indexOf('result6LaborHours')],0);

  const duplicate=itsmRow('inc-0','2026-02-01');
  store.set('itsm_data',{id:'itsm_data',records:[many[0],duplicate],
    meta:{fields:Array.from(schema.fields)}});
  await assert.rejects(()=>engine.preview({steps:[{
    datasetId:'itsm_data',calculate:()=>({})
  }]}),/повторный ключ/);

  console.log('PR3 recalculation core: staged joins, source protection, partial Full Dataset, legacy order, stale plan, cancellation, 2200 rows OK');
})().catch(err=>{console.error(err);process.exitCode=1;});
