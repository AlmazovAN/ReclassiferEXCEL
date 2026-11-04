'use strict';
const assert = require('node:assert/strict');

require('../src/js/app/dataset_catalog.js');
require('../src/js/app/field_registry.js');
require('../src/js/modules/itsm/dataset_schema.js');
require('../src/js/modules/itsm/mb_presence.js');
require('../src/js/modules/itsm/rules.js');
require('../src/js/app/recalculation_core.js');
require('../src/js/modules/itsm/recalculation.js');

const schema = globalThis.ReclassifierItsmDatasetSchema;
const rules = globalThis.ReclassifierItsmRules;
const adapter = globalThis.ReclassifierItsmRecalculation;
const idx = Object.fromEntries(schema.fields.map((field, i) => [field,i]));
function row(number, equipment, extras = {}) {
  const r = Array(schema.fields.length).fill(null);
  Object.assign(r, {
    [idx.number]:number,
    [idx.createdAt]:'2025-04-01T07:00:00',
    [idx.completedAt]:'2025-04-03T12:00:00',
    [idx.territory]:'р. Северный',
    [idx.sourceEquipment]:equipment,
    [idx.sourceElement]:'Исх элемент',
    [idx.sourceFault]:'Исх неисправность',
    [idx.sourceReason]:'Исх причина',
    [idx.shortDescription]:'Ремонт',
    [idx.openedBy]:'Тестовый автор',
    [idx.closureCode]:'Выполнено полностью',
    [idx.slaHours]:13
  });
  for(const [key,value] of Object.entries(extras)) r[idx[key]]=value;
  return r;
}
const prior={
  reclassifiedEquipment:'Камера согласованная',
  reclassifiedElement:'Узел сохранённый',
  reclassifiedFault:'Нет изображения',
  reclassifiedReason:'Обрыв кабеля',
  classificationQuality:'INC с исправлением',
  driversByName:1,
  driversByMine:1,
  problemLink:'нет',
  result6LaborHours:0,
  mbPresence:'Нет в МБ'
};
const previous = [
 row('INC-OLD','Старая камера',prior),
 row('INC-NEW','Старый блок',{reclassifiedEquipment:'Старый блок',
   reclassifiedElement:'Исх элемент',reclassifiedFault:'Исх неисправность',
   reclassifiedReason:'Исх причина',slaHours:5}),
 row('INC-LEGACY','Сервер',{slaHours:7, ...{
   reclassifiedEquipment:null,reclassifiedElement:null,
   reclassifiedFault:null,reclassifiedReason:null
 }}),
];
const baseFull = {
  columns:['Номер','Измерение цели обслуживания.SLA.Прошло (рабочее время)','Нестандартный исходный реквизит'],
  rows:[['INC-OLD',7200,'RAW-DO-NOT-CHANGE']],
  recordKeys:['inc-old'],coverage:'partial'
};
const instances = new Map();
function dataset(id, records, meta = {}) {
  const value={id,records,meta,validation:{status:'valid',errors:[],warnings:[]}};
  instances.set(id,value);
  return value;
}
const itsm=dataset('itsm_data',previous,{fields:Array.from(schema.fields),activeRevision:2});
itsm.fullDataset=baseFull;
dataset('reclassification', [
 {number:'INC-NEW',equipment:'Новая камера',element:'Питание',fault:'Отключение',incidentReason:'Обрыв питания'}
]);
dataset('drivers',[
 {name:'Камера согласованная',mine:'р. Северный',value:11,system:'Видео',service:'Связь'},
 {name:'Новая камера',mine:'р. Северный',value:27,system:'Видео',service:'Связь'},
 {name:'Сервер',mine:'р. Северный',value:2,system:'Сервер',service:'Связь'},
]);
dataset('initiators',[{initiator:'Тестовый автор',group:'Служба'}]);
dataset('customers',[{mine:'р. Северный',customerInternal:'КФ'}]);
dataset('type_request',[{shortDescription:'Ремонт',workType:'ТО'}]);
dataset('exceptions',[]);
dataset('problem_grade',[
 {equipment:'Камера согласованная',element:'Узел сохранённый',
  fault:'Нет изображения',reason:'Обрыв кабеля',problemId:'PRB-OLD',normalizationDecision:'Нормализовать'},
 {equipment:'Новая камера',element:'Питание',fault:'Отключение',
  reason:'Обрыв питания',problemId:'PRB-NEW',normalizationDecision:'Нормализовать'}
]);
const mb=dataset('mobile_brigade_data',[
 {recordKey:'north|one',request:'INC-OLD',laborHours:2,
  equipmentPlacement:'Стационарное',equipmentUnit:'БКМ-1'},
 {recordKey:'north|two',request:' inc-old ',laborHours:1.5,
  equipmentPlacement:'Стационарное',equipmentUnit:'БКМ-2'},
 {recordKey:'north|new',request:'INC-NEW',laborHours:4,
  equipmentPlacement:'Навесное',transport:'ПДМ-1'}
],{latestSourceDate:'2026-09-30'});
let mode='legacy';
const runtime={mode:()=>mode,get:id=>instances.get(id)||null};
const service=adapter.create({runtime});
(async()=>{
  const itsmBefore=JSON.stringify(previous);
  const mbBefore=JSON.stringify(mb.records);
  const fullBefore=JSON.stringify(baseFull);
  const plan=await service.preview({asOfDate:'2026-10-14T12:00:00.000Z',sampleLimit:10});
  assert.equal(plan.mode,'legacy');
  assert.equal(plan.canCommit,false);
  assert.equal(plan.datasets.length,1);
  const details=plan.datasets[0];
  assert.equal(details.datasetId,'itsm_data');
  assert.equal(details.checked,3);
  assert.equal(details.fullSourceCoverage,'partial');
  assert.equal(details.fullSourceRows,1);
  assert.equal(details.changed,3);
  const old=details.changes.find(x=>x.key==='inc-old').fields;
  for(const key of ['reclassifiedEquipment','reclassifiedElement','reclassifiedFault','reclassifiedReason'])
    assert.equal(Object.hasOwn(old,key),false,'Missing ReClass must preserve '+key);
  assert.equal(old.driversByName.after,11,'Driver count must follow approved old classification.');
  assert.equal(old.result6LaborHours.after,3.5);
  assert.equal(old.equipmentName.after,'БКМ-1; БКМ-2');
  assert.equal(old.mbPresence.after,'Есть в МБ');
  assert.equal(old.problemLink.after,'PRB-OLD');
  assert.equal(old.slaHours.after,2,'SLA calculated only when genuine raw seconds exist.');
  const newer=details.changes.find(x=>x.key==='inc-new').fields;
  assert.equal(newer.reclassifiedEquipment.after,'Новая камера');
  assert.equal(newer.reclassifiedElement.after,'Питание');
  assert.equal(newer.reclassifiedFault.after,'Отключение');
  assert.equal(newer.reclassifiedReason.after,'Обрыв питания');
  assert.equal(newer.driversByName.after,27);
  assert.equal(newer.problemLink.after,'PRB-NEW');
  assert.equal(newer.result6LaborHours.after,4);
  assert.equal(Object.hasOwn(newer,'slaHours'),false,'Missing raw SLA must not zero out old value.');
  const legacy=details.changes.find(x=>x.key==='inc-legacy').fields;
  for(const key of ['reclassifiedEquipment','reclassifiedElement','reclassifiedFault','reclassifiedReason'])
    assert.equal(Object.hasOwn(legacy,key),false,'Legacy raw-only classification must remain unchanged.');
  assert.equal(Object.hasOwn(legacy,'slaHours'),false);
  assert.equal(legacy.mbPresence.after,'Нет в МБ');
  assert.equal(JSON.stringify(previous),itsmBefore);
  assert.equal(JSON.stringify(mb.records),mbBefore);
  assert.equal(JSON.stringify(baseFull),fullBefore);
  assert.equal(service.assertCurrent(plan),true);

  // Every referenced revision is watched, not just the target ITSM Dataset.
  const reclass=instances.get('reclassification');
  instances.set('reclassification',{...reclass,records:[]});
  assert.throws(()=>service.assertCurrent(plan),/reclassification/);
  instances.set('reclassification',reclass);
  instances.set('drivers',{...instances.get('drivers')});
  assert.throws(()=>service.assertCurrent(plan),/drivers/);
  mode='sqlite';
  assert.throws(()=>service.assertCurrent(plan),/источник Runtime/);
  mode='legacy';

  // A temporary unavailable reference must fail closed, not erase computed data.
  const missing=instances.get('problem_grade');
  instances.delete('problem_grade');
  await assert.rejects(()=>service.preview(),/problem_grade/);
  instances.set('problem_grade',missing);

  // The same calculator must work against the authoritative SQLite facade.
  mode='sqlite';
  const sqlite=adapter.create({runtime});
  const sqlPlan=await sqlite.preview({asOfDate:'2026-10-14T12:00:00.000Z'});
  assert.equal(sqlPlan.mode,'sqlite');
  assert.equal(sqlPlan.datasets[0].changed,3);
  assert.equal(sqlite.assertCurrent(sqlPlan),true);

  // A normal Excel Rules evaluation must not apply the fallback when no ReClass entry.
  const normal=rules.evaluateRow({
    created:'2025-04-01',completed:'2025-04-03',number:'INC-OLD',
    territory:'р. Северный',equipment:'Старая камера',element:'Исх элемент',
    fault:'Исх неисправность',reason:'Исх причина',
    shortDescription:'Ремонт',openedBy:'Тестовый автор',
    closureCode:'Выполнено полностью',slaWorking:7200
  },rules.buildLookups({reclassification:[],drivers:[],customers:[],type_request:[],
    initiators:[],exceptions:[],problem_grade:[]}),
    {asOfDate:'2026-10-14'});
  assert.equal(normal.output['Наим1'],'Старая камера');
  assert.equal(rules.version,'1.2.1','Existing ITSM processing business-rule version must remain unchanged.');
  console.log('PR4 ITSM recalculation: partial ReClass, old classification, 8 sources, MB enrichment, SLA, preview-only and SQLite OK');
})().catch(error=>{console.error(error);process.exitCode=1;});
