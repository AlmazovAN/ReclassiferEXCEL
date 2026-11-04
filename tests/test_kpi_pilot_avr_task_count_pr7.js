// PR-7: production pilot is one declared KPI, not an approved corporate KPI.
// Exercise real MB normalization and grouping, not fabricated finished results.
'use strict';
const assert=require('node:assert/strict');
require('../src/js/app/reliability_dashboard_data.js');
require('../src/js/modules/itsm/mb_presence.js');
require('../src/js/kpi/source_facts.js');
require('../src/js/kpi/preparation/common.js');
require('../src/js/kpi/preparation/labor.js');
require('../src/js/kpi/calculator/common.js');
require('../src/js/kpi/calculator/declarative.js');
require('../src/js/kpi/calculator/definitions.js');
require('../src/js/kpi/calculator/labor/calculate.js');
const catalogDefs=globalThis.ReclassifierKpiDefinitions;
const factory=globalThis.ReclassifierKpiDeclarative;
const common=globalThis.ReclassifierKpiCalculatorCommon;
const labor=globalThis.ReclassifierKpiPrepareLabor;
const legacy=globalThis.ReclassifierKpiCalculateLabor;
const pilot=factory.get('avr_task_count');
assert.equal(factory.definitions.length,1);
assert.equal(pilot.id,'avr_task_count');
assert.equal(pilot.kind,'count');
assert.equal(pilot.unit,'шт.');
assert.equal(pilot.source,'labor');
assert.equal(pilot.forecastPolicy,'historical-next-month');
assert.equal(pilot.formulaVersion,'1.0.0');
assert.equal(catalogDefs.avr_task_count.methodologyStatus,'draft');
assert.equal(catalogDefs.avr_task_count.formula,'Σ avrTaskCount');
assert.equal(pilot.components.length,3);
assert(Object.isFrozen(pilot));
assert(Object.isFrozen(pilot.components));

const records=[
  {recordKey:'1',factDate:'2026-09-04',site:'Северный',
    equipmentPlacement:'Навесное',finalTaskType:'АВР',laborState:'valid',laborHours:4},
  {recordKey:'2',factDate:'2026-09-05',site:'Северный',
    equipmentPlacement:'Навесное',finalTaskType:'АВР',laborState:'missing',laborHours:null},
  {recordKey:'3',factDate:'2026-09-06',site:'Северный',
    equipmentPlacement:'Навесное',finalTaskType:'АВР',laborState:'valid_zero',laborHours:0},
  {recordKey:'4',factDate:'2026-09-07',site:'Северный',
    equipmentPlacement:'Навесное',finalTaskType:'ТО по графику',laborState:'valid',laborHours:10},
  {recordKey:'5',factDate:'',site:'Северный',
    equipmentPlacement:'Навесное',finalTaskType:'АВР',laborState:'valid',laborHours:9},
  {recordKey:'6',factDate:'2026-08-06',site:'Северный',
    equipmentPlacement:'Навесное',finalTaskType:'АВР',laborState:'valid',laborHours:5},
  {recordKey:'7',factDate:'2026-09-11',site:'Таймырский',
    equipmentPlacement:'Навесное',finalTaskType:'АВР',laborState:'valid',laborHours:2},
  {recordKey:'8',factDate:'2026-09-11',site:'Северный',
    equipmentPlacement:'Стационарное',finalTaskType:'АВР',laborState:'valid',laborHours:2}
];
const prepared=labor.prepare(records);
assert.equal(prepared.meta.rowsWithoutFactDate,1);
assert(prepared.rows.some(x=>x.taskCount>1),'Group aggregation must occur before COUNT');
const families={labor:prepared};
const query={
  period:'2026-09-01',
  filters:{mine:'Северный',equipmentClass:'mounted'}
};
const events=[];
const result=factory.calculate('avr_task_count',families,{
  ...query,audit:{selection:e=>events.push({kind:'selection',...e}),
    subset:e=>events.push({kind:'subset',...e})}
});
assert.equal(result.dataState,'available');
assert.equal(result.value,3);
assert.equal(result.unit,'шт.');
assert.equal(result.formulaVersion,'1.0.0');
assert.equal(result.components.avrTaskCount,3);
assert.equal(result.components.avrUsableTaskCount,2);
assert.equal(result.components.avrUnusableTaskCount,1);
assert.equal(result.components.avrTaskCount,
  result.components.avrUsableTaskCount+result.components.avrUnusableTaskCount);
assert.equal(result.query.period.kind,'single-month');
assert(Object.isFrozen(result));
assert(Object.isFrozen(result.components));
const subset=events.filter(x=>x.kind==='subset');
assert.equal(subset.length,3);
assert(subset.every(x=>x.tableId==='mobile_brigade_labor'&&
  x.field==='finalTaskType'&&x.acceptedTypes[0]==='АВР'));
assert.equal(subset[0].sumField,'taskCount');
assert.equal(subset[0].sumValue,3);
assert.equal(subset[0].inputRows-subset[0].outputRows,subset[0].excludedRows);
assert(events.some(x=>x.kind==='selection'));

const hours=legacy.calculateAvr(families,query);
assert.equal(hours.value,4);
assert.equal(result.value,3);
assert.notEqual(result.value,hours.value,
  'Task volume is NOT labor hours and does not depend on usable labor.');

const august=factory.calculate('avr_task_count',families,{
  period:'2026-08-01',filters:query.filters});
assert.equal(august.value,1);
const allMines=factory.calculate('avr_task_count',families,{
  period:'2026-09-01',filters:{equipmentClass:'mounted'}});
assert.equal(allMines.value,4);
const allTypes=factory.calculate('avr_task_count',families,{
  period:'2026-09-01',filters:{mine:'Северный'}});
assert.equal(allTypes.value,4,'Stationary and mounted tasks must sum without deduplicating');
const noAvr=factory.calculate('avr_task_count',{labor:{
  rows:Object.freeze([{period:'2026-09',site:'Северный',
    finalTaskType:'ТО по графику',taskCount:2,
    usableLaborTaskCount:2,unusableLaborTaskCount:0}])
}},{period:'2026-09-01',filters:{mine:'Северный'}});
assert.equal(noAvr.dataState,'available');
assert.equal(noAvr.value,0,
  'Zero is justified only when observed source rows exist but none match AVR');
const noSource=factory.calculate('avr_task_count',{},query);
assert.equal(noSource.dataState,'unavailable');
assert.equal(noSource.reason,'source-not-loaded');
assert.equal(noSource.value,null);
const noRows=factory.calculate('avr_task_count',families,{period:'2027-03-01'});
assert.equal(noRows.dataState,'no-data');
assert.equal(noRows.value,null);
assert.equal(factory.calculate('avr_task_count',families,{
  period:'2026-09-01',filters:{nonexistent:'x'}
}).reason,'unsupported-filter');
assert.throws(()=>factory.createRegistry([{
  ...pilot,id:'another_avr',components:[{...pilot.components[0],field:'untrusted'}]
}]),/Invalid KPI component declaration/);
console.log('PR-7 pilot: real MB preparation -> 3 AVR tasks versus 4 labor hours, audit, periods/filters, 0/no-data/missing guards and frozen results OK');
