'use strict';
const assert = require('node:assert/strict');

require('../src/js/app/dataset_catalog.js');
require('../src/js/app/field_registry.js');
require('../src/js/modules/itsm/dataset_schema.js');
require('../src/js/modules/mobile_brigade/rules.js');
require('../src/js/app/recalculation_core.js');
require('../src/js/modules/mobile_brigade/recalculation.js');

const catalog = globalThis.ReclassifierDatasetCatalog;
const schema = globalThis.ReclassifierItsmDatasetSchema;
const rules = globalThis.ReclassifierMobileBrigadeRules;
const moduleApi = globalThis.ReclassifierMobileBrigadeRecalculation;
assert.equal(moduleApi.version, '1.0.0');
assert.deepEqual(Array.from(moduleApi.calculatedFields), ['itsmCreatedAt']);
assert.deepEqual(Array.from(moduleApi.dependencies), ['itsm_data']);
assert.equal(rules.version, '1.5.0', 'Do not alter existing MB business rules.');

function itsmRow(number, createdAt, fields = schema.fields) {
  const values = Array(fields.length).fill(null);
  values[fields.indexOf('number')] = number;
  values[fields.indexOf('createdAt')] = createdAt;
  return values;
}
const itsm = {
  id: 'itsm_data',
  records: [
    itsmRow(' INC-101 ', '2026-09-10T09:30:00'),
    itsmRow('INC-102', '2026-09-11T11:20:00'),
    itsmRow('INC-103', null),
    itsmRow('INC-104', '11.09.2026 14:45:00')
  ],
  meta: { fields: Array.from(schema.fields), activeRevision: 2 }
};
const expectedFirst = rules.parseItsmCreatedAt('2026-09-10T09:30:00');
const oldDate = new Date(2025, 5, 2, 9, 0);
const initialMb = [
  {recordKey:'north|1',request:' inc-101 ',itsmCreatedAt:oldDate,
    laborHours:5,astroHours:2.5,finalTaskType:'Ремонт',laborState:'valid',
    preBacklogAge:'',description:'Original text'},
  {recordKey:'north|2',request:'INC-102',
    itsmCreatedAt:rules.parseItsmCreatedAt('2026-09-11T11:20:00').toISOString(),
    laborHours:0,astroHours:null,finalTaskType:'Проверка',laborState:'valid_zero',
    preBacklogAge:''},
  {recordKey:'north|3',request:'INC-MISSING',itsmCreatedAt:'2025-01-01T10:00:00',
    laborHours:1,astroHours:1,finalTaskType:'Выезд',preBacklogAge:''},
  {recordKey:'north|4',request:'INC-103',itsmCreatedAt:'2025-02-01T10:00:00',
    laborHours:4,astroHours:2,finalTaskType:'ТО',preBacklogAge:''},
  {recordKey:'north|5',request:' ',itsmCreatedAt:null,
    laborHours:2,astroHours:2,finalTaskType:'Прочее',preBacklogAge:''},
  {recordKey:'north|6',request:' inc-101 ',itsmCreatedAt:expectedFirst.toISOString(),
    laborHours:8,astroHours:4,finalTaskType:'Ремонт',preBacklogAge:''},
  {recordKey:'north|7',request:'INC-104',itsmCreatedAt:null,
    laborHours:1,astroHours:1,finalTaskType:'Проверка',preBacklogAge:''}
];
const mb = {
  id:'mobile_brigade_data',records:initialMb,meta:{activeRevision:3},
  fullDataset:{
    columns:['Номер задачи','Неизвестное исходное поле'],
    rows:[['north|1','PRESERVE-RAW']],recordKeys:['north|1'],coverage:'partial'
  }
};
const store = new Map([['itsm_data',itsm],['mobile_brigade_data',mb]]);
let mode='legacy';
const runtime={get:id=>store.get(id)||null,mode:()=>mode};
const service=moduleApi.create({runtime,catalog,itsmSchema:schema});

(async()=>{
  const snapshotItsm=JSON.stringify(itsm.records);
  const snapshotMb=JSON.stringify(mb.records);
  const snapshotRaw=JSON.stringify(mb.fullDataset);
  let lastProgress=null;
  const plan=await service.preview({
    asOfDate:'2026-10-14T12:00:00.000Z',
    sampleLimit:1,
    onProgress:value=>{ lastProgress=value; }
  });
  assert.equal(plan.kind,'recalculation-preview');
  assert.equal(plan.mode,'legacy');
  assert.equal(plan.checked,7);
  assert.equal(plan.changed,2);
  assert.equal(plan.hasChanges,true);
  assert.equal(plan.canCommit,false);
  assert.equal(plan.datasets[0].skippedMissingSource,0);
  assert.equal(plan.datasets[0].skippedByRule,3);
  assert.equal(plan.datasets[0].unchanged,2);
  assert.equal(plan.datasets[0].fullSourceCoverage,'partial');
  assert.equal(plan.datasets[0].samples.length,1);
  assert.deepEqual(plan.datasets[0].changes.map(change=>change.key),
    ['north|1','north|7']);
  assert.equal(lastProgress.processed,7);
  assert.equal(service.assertCurrent(plan),true);

  const first=plan.datasets[0].changes[0];
  assert.deepEqual(Object.keys(first.fields),['itsmCreatedAt']);
  assert.equal(first.fields.itsmCreatedAt.before.getTime(),oldDate.getTime());
  assert.equal(first.fields.itsmCreatedAt.after.getTime(),expectedFirst.getTime());
  assert.equal(plan.datasets[0].changes[1].fields.itsmCreatedAt.after.getTime(),
    rules.parseItsmCreatedAt('11.09.2026 14:45:00').getTime());
  assert.equal(JSON.stringify(itsm.records),snapshotItsm,'ITSM source data changed.');
  assert.equal(JSON.stringify(mb.records),snapshotMb,'MB source data changed.');
  assert.equal(JSON.stringify(mb.fullDataset),snapshotRaw,'MB Full Dataset changed.');
  assert.equal(mb.records[0].laborHours,5);
  assert.equal(mb.records[0].astroHours,2.5);
  assert.equal(mb.records[0].preBacklogAge,'');
  assert.equal(mb.records[0].finalTaskType,'Ремонт');

  // Missing source entries must preserve old values even when a newer ITSM
  // source is incomplete, not erase historical successful matches.
  assert.equal(mb.records[2].itsmCreatedAt,'2025-01-01T10:00:00');
  assert.equal(mb.records[3].itsmCreatedAt,'2025-02-01T10:00:00');

  // The exact same read-only logic must run with authoritative SQLite
  // Runtime, whose Date values may have been serialized as UTC strings.
  mode='sqlite';
  const sqlService=moduleApi.create({runtime,catalog,itsmSchema:schema});
  const sqlPlan=await sqlService.preview({asOfDate:'2026-10-14T12:00:00.000Z'});
  assert.equal(sqlPlan.mode,'sqlite');
  assert.equal(sqlPlan.changed,2);
  assert.equal(sqlService.assertCurrent(sqlPlan),true);

  // A copied reference or changed Runtime backend invalidates preview.
  store.set('itsm_data',{...itsm,records:itsm.records.slice()});
  assert.throws(()=>sqlService.assertCurrent(sqlPlan),/itsm_data/);
  store.set('itsm_data',itsm);
  mode='legacy';
  assert.throws(()=>sqlService.assertCurrent(sqlPlan),/источник Runtime/);

  // A record with the same instant must not be recalculated repeatedly,
  // despite Date object vs ISO string serialization differences.
  const originalMb=mb.records;
  mb.records=mb.records.map((record,i)=>{
    if(i===0) return {...record,itsmCreatedAt:expectedFirst.toISOString()};
    if(i===6) return {...record,itsmCreatedAt:rules.parseItsmCreatedAt('11.09.2026 14:45:00')};
    return record;
  });
  const noOp=await service.preview({asOfDate:'2026-10-14T12:00:00.000Z'});
  assert.equal(noOp.changed,0);
  assert.equal(noOp.hasChanges,false);
  mb.records=originalMb;

  // Positional indexes must follow the historical persisted ITSM field
  // order, including when number and createdAt are no longer at [3] and [0].
  const reversed=Array.from(schema.fields).reverse();
  store.set('itsm_data',{...itsm,records:itsm.records.map(record=>
    reversed.map(field=>record[schema.fields.indexOf(field)])),
    meta:{fields:reversed}});
  const oldOrder=await service.preview();
  assert.equal(oldOrder.changed,2);
  store.set('itsm_data',itsm);

  // A stale/empty ITSM Dataset must not make the processor overwrite MB.
  store.delete('itsm_data');
  await assert.rejects(()=>service.preview(),/ITSM не загружен/);
  store.set('itsm_data',itsm);

  // A keyed MB task remains unchanged when the ticket number is not linked,
  // while different MB tasks with the same request share one ITSM date.
  assert.equal(rules.parseItsmCreatedAt('01.09.2026 10:20:30').getFullYear(),2026);
  assert.equal(rules.parseItsmCreatedAt('2026-09-01T10:20:30.000Z').toISOString(),
    '2026-09-01T10:20:30.000Z');
  assert.equal(rules.parseItsmCreatedAt('garbage'),null);

  const duplicate=itsmRow('inc-101','2026-10-01');
  itsm.records.push(duplicate);
  await assert.rejects(()=>service.preview(),/повторный ключ/);
  itsm.records.pop();
  const aborted={aborted:true};
  await assert.rejects(()=>service.preview({signal:aborted}),/отменён/);

  console.log('PR5 MB recalculation: staged ITSM date, missing matches, unchanged parity, no-op, legacy schema, SQLite, duplicates, cancellation OK');
})().catch(error=>{console.error(error);process.exitCode=1;});
