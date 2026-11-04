'use strict';
const assert=require('node:assert/strict');
require('../src/js/app/reliability_dashboard_data.js');
require('../src/js/modules/itsm/mb_presence.js');
require('../src/js/kpi/source_facts.js');
for(const p of ['common','failures','equipment','labor','sla','classification','prb','ktg','index'])
  require('../src/js/kpi/preparation/'+p+'.js');
require('../src/js/kpi/calculator/common.js');
require('../src/js/kpi/calculator/definitions.js');
for(const p of ['vbr','ktg','sla','classification_quality','classification_quality_cgps','labor','problem_management'])
  require('../src/js/kpi/calculator/'+p+'/calculate.js');
require('../src/js/kpi/calculator/index.js');
require('../src/js/kpi/catalog/contracts.js');
require('../src/js/kpi/catalog/index.js');
const engine=require('../src/js/kpi/forecast_engine.js');
const days=period=>new Date(Date.UTC(Number(period.slice(0,4)),
  Number(period.slice(5,7)),0)).getUTCDate();
const periods=Array.from({length:9},(_,i)=>new Date(Date.UTC(2026,i,1)).toISOString().slice(0,7));
const source=()=>periods.map((period,i)=>{
  const failureCount=(1+i*.1)*days(period);
  const hours={incidentHours:(2+i*.25)*days(period),
    plannedMaintenanceHours:(1+i*.1)*days(period),
    unplannedMaintenanceHours:.5*days(period),otherHours:.25*days(period)};
  const cal=24*days(period)*10;
  return {period,dataState:'available',value:95,components:{failureCount,
    equipmentCount:1000,...hours,calendarHours:cal,availableHours:cal-hours.plannedMaintenanceHours,
    productiveHours:cal-hours.incidentHours-hours.plannedMaintenanceHours-
      hours.unplannedMaintenanceHours-hours.otherHours},
    diagnostics:{partialCoverage:false}};
});
const inputs=source();
const vbrCurrent={dataState:'available',value:98,components:{failureCount:20,equipmentCount:1000},
  diagnostics:{populationBasis:'fixed-drivers-reference'}};
const ktgCurrent={dataState:'available',value:99,components:{
  calendarHours:7440,equipmentUnits:10,incidentHours:25,plannedMaintenanceHours:12,
  unplannedMaintenanceHours:8,otherHours:4},diagnostics:{partialCoverage:false}};
const query=(id,current,overrides={})=>({
  kpiId:id,selectedMonth:'2026-10',asOf:'2026-10-10T11:00:00.000Z',
  current,points:inputs,...overrides
});
const vbr=engine.predictCurrentMonth(query('vbr',vbrCurrent));
assert.equal(vbr.dataState,'available');
assert.equal(vbr.forecastType,'current-month-nowcast');
assert.equal(vbr.horizon,'2026-10');
assert.equal(vbr.elapsedDays,10);
assert.equal(vbr.remainingDays,21);
assert.equal(vbr.populationBasis,'fixed-drivers-reference');
assert.equal(vbr.methodComponents.failureCount.methodId,'linear-trend');
assert(vbr.projectedComponents.failureCount>vbrCurrent.components.failureCount);
assert(Math.abs(vbr.value-(1-vbr.projectedComponents.failureCount/1000)*100)<1e-10);
assert(vbr.value<vbrCurrent.value);
assert.equal(vbr.quality.status,'provisional');
assert(Object.isFrozen(vbr));
assert(Object.isFrozen(vbr.projectedComponents));
assert.match(vbr.caveats.join(','),/без исторических снимков/);
const ktg=engine.predictCurrentMonth(query('ktg',ktgCurrent));
assert.equal(ktg.dataState,'available');
assert.equal(ktg.forecastType,'current-month-nowcast');
assert.equal(ktg.projectedComponents.equipmentUnits,10);
assert.equal(ktg.projectedComponents.calendarHours,7440);
assert.equal(ktg.projectedComponents.actualMaintenanceHours,
  ktg.projectedComponents.plannedMaintenanceHours);
assert(Math.abs(ktg.value-100*ktg.projectedComponents.productiveHours/
  ktg.projectedComponents.availableHours)<1e-10);
assert(ktg.projectedComponents.incidentHours>25);
assert(ktg.projectedComponents.actualDowntimeHours>25);
const bad={...inputs[2],components:{...inputs[2].components,failureCount:NaN}};
const partial={...inputs[2],diagnostics:{partialCoverage:true}};
assert.equal(engine.predictCurrentMonth(query('vbr',vbrCurrent,{points:[...inputs.slice(0,2),bad,...inputs.slice(3)]})).reason,
  'missing-or-partial-component-history');
assert.equal(engine.predictCurrentMonth(query('vbr',vbrCurrent,{points:[...inputs.slice(0,2),partial,...inputs.slice(3)]})).reason,
  'missing-or-partial-component-history');
assert.equal(engine.predictCurrentMonth(query('vbr',vbrCurrent,{points:inputs.slice(3)})).reason,
  'insufficient-complete-history');
assert.equal(engine.predictCurrentMonth(query('vbr',vbrCurrent,{asOf:'2026-11-01'})).reason,
  'not-current-incomplete-month');
assert.equal(engine.predictCurrentMonth(query('vbr',vbrCurrent,{asOf:'2026-10-31'})).reason,
  'last-calendar-day-no-remaining-days');
assert.equal(engine.predictCurrentMonth(query('vbr',vbrCurrent,{asOf:'2026-10-02'})).reason,
  'early-current-month');
assert.equal(engine.predictCurrentMonth(query('vbr',vbrCurrent,{current:{dataState:'no-data'}})).reason,
  'current-components-unavailable');
assert.equal(engine.predictCurrentMonth(query('vbr',vbrCurrent,{
  current:{...vbrCurrent,components:{failureCount:20,equipmentCount:0}}
})).reason,'equipment-baseline-missing');
assert.equal(engine.predictCurrentMonth(query('ktg',ktgCurrent,{
  current:{...ktgCurrent,components:{...ktgCurrent.components,calendarHours:0}}
})).reason,'calendar-or-equipment-baseline-missing');
assert.equal(engine.predictCurrentMonth(query('sla',vbrCurrent)).reason,
  'kpi-nowcast-not-supported');
assert.equal(engine.predict({kpiId:'vbr',selectedMonth:'2026-09',points:inputs}).reason,
  'historical-data-required',
  'Old unsupported future-month VBR extrapolation stays explicitly blocked');
assert.equal(engine.predict({kpiId:'ktg',selectedMonth:'2026-09',points:inputs}).reason,
  'historical-data-required');
const partialKt=engine.predictCurrentMonth(query('ktg',{
  ...ktgCurrent,diagnostics:{partialCoverage:true}
}));
assert.equal(partialKt.quality.status,'provisional-partial');
assert.match(partialKt.caveats.join(','),/частично/);
// Missing middle period is never interpreted as a zero-failure month.
const gap=[...inputs];gap[3]={...gap[3],period:'2026-02'};
assert.equal(engine.predictCurrentMonth(query('vbr',vbrCurrent,{points:gap})).reason,
  'noncontiguous-component-history');
console.log('PR8 current month nowcast: VBR/KTG component trends, calendar, MAE validation, limits, source quality and frozen outputs OK');
