'use strict';
const assert=require('node:assert/strict');
require('../src/js/kpi/source_facts.js');
require('../src/js/kpi/preparation/common.js');
require('../src/js/kpi/preparation/equipment.js');
require('../src/js/kpi/preparation/ktg.js');
require('../src/js/kpi/calculator/common.js');
require('../src/js/kpi/calculator/definitions.js');
require('../src/js/kpi/calculator/ktg/calculate.js');
const facts=globalThis.ReclassifierKpiSourceFacts;
const equip=globalThis.ReclassifierKpiPrepareEquipment.prepare;
const prep=globalThis.ReclassifierKpiPrepareKtg.prepare;
const calc=globalThis.ReclassifierKpiCalculateKtg.calculate;
const driver=(mine,name,service,value)=>({
 mine,name,service,system:'СДГР',value,unit:'шт',valueState:'value'
});
const drivers=equip({records:[
 driver('Северный','БКМ','Навесное оборудование',10),
 driver('Северный','БКМ','Стационарное оборудование',2),
 driver('Все рудники','БКМ','Навесное оборудование',1000),
 driver('Северный','БКМ','Навесное оборудование',5)
]});
assert.equal(drivers.meta.summaryRowsSkipped,1);
const raw=(number,kind,hours,workType='')=>facts.itsmFact({
 number,createdAt:'2026-10-03',completedAt:'2026-10-05',
 territory:'Северный',reclassifiedEquipment:'БКМ',sdgrService:'Навесное оборудование',
 typeAfterReclassification:kind,workType,preBacklogHours:hours,sputnikVbrDecision:'Исключить'
});
const itsm=[
 raw('INC1','INC',10,'Монтаж'),                 // INC always counts, even with excluded work type
 raw('INC2','INC',5,'Плановое ТО'),             // INC must not double-count TO
 raw('RITM1','RITM',4,'Плановое ТО'),
 raw('RITM2','RITM',3,'ТО вне графика'),
 raw('RITM3','RITM',2,'Прочее'),
 raw('RITM4','RITM',1,'#Н/Д'),
 raw('RITM5','RITM',1,''),
 raw('RITM6','RITM',8,'Монтаж'),
 raw('RITM7','RITM',8,'ПО доступ'),
 raw('RITM8','RITM',8,'Консультация'),
 raw('RITM9','RITM',4,'Неизвестное назначение работ')
];
const tables=prep(itsm,drivers);
const oct=calc({ktg:tables},{period:'2026-10-01',filters:{mine:'Северный',equipmentClass:'mounted'}});
assert.equal(oct.dataState,'available');
assert.equal(oct.components.equipmentUnits,15,'Drivers additive quantities, no summary mine');
assert.equal(oct.components.calendarHours,15*24*31);
assert.equal(oct.components.incidentHours,15);
assert.equal(oct.components.actualMaintenanceHours,4);
assert.equal(oct.components.plannedMaintenanceHours,4,'Temporary TO-plan = factual planned TO');
assert.equal(oct.components.unplannedMaintenanceHours,3);
assert.equal(oct.components.otherHours,4);
assert.equal(oct.components.actualDowntimeHours,26);
assert.equal(tables.work.meta.ignoredWorkRows,4);
assert.ok(Math.abs(oct.value-((11160-26)/(11160-4)*100))<1e-9);
assert.equal(tables.work.meta.sourceDataset,'itsm_data');
assert.equal(tables.fleet.meta.sourceDataset,'drivers');
assert.equal(globalThis.ReclassifierKpiDefinitions.ktg.formulaVersion,'2.0.1');
const multi=calc({ktg:tables},{period:{start:'2026-10-01',end:'2026-11-01'}});
assert.equal(multi.dataState,'available');
assert.equal(multi.reason,'partial-coverage');
assert.equal(multi.components.calendarHours,17*24*31,'November without ITSM must not inflate the KFRV');
assert.deepEqual(multi.diagnostics.missingItsmMonths,['2026-11']);
assert.deepEqual(multi.diagnostics.reportMonths,['2026-10']);
assert.ok(Math.abs(multi.value-calc({ktg:tables},{period:'2026-10-01'}).value)<1e-9);
const noDuration=prep([...itsm,raw('INC3','INC','wrong')],drivers);
const provisionalInvalid=calc({ktg:noDuration},{period:'2026-10-01',filters:{equipmentClass:'mounted'}});
assert.equal(provisionalInvalid.dataState,'available','Valid completed work remains visible');
assert.equal(provisionalInvalid.reason,'partial-coverage');
assert.equal(provisionalInvalid.diagnostics.selectedUnknownDurationRows,1);
assert.equal(provisionalInvalid.diagnostics.excludedUnverifiedRequestRows,1);
assert.equal(provisionalInvalid.components.incidentHours,15,'Invalid hours must not be treated as zero/valid');
const noEndFact=facts.itsmFact({
 number:'INC4',createdAt:'2026-10-09',territory:'Северный',
 reclassifiedEquipment:'БКМ',sdgrService:'Навесное оборудование',
 typeAfterReclassification:'INC',preBacklogHours:50
});
const noEnd=prep([...itsm,noEndFact],drivers);
const provisionalOpen=calc({ktg:noEnd},{period:'2026-10-01',filters:{equipmentClass:'mounted'}});
assert.equal(provisionalOpen.dataState,'available');
assert.equal(provisionalOpen.reason,'partial-coverage');
assert.equal(provisionalOpen.diagnostics.selectedUnfinishedRows,1);
assert.equal(provisionalOpen.components.incidentHours,15);
const onlyOpen=prep([noEndFact],drivers);
assert.equal(calc({ktg:onlyOpen},{period:'2026-10-01',filters:{equipmentClass:'mounted'}}).reason,
  'unfinished-itsm-requests','No certified hours: never fabricate a confirmed zero');
const onlyInvalid=prep([raw('INC3','INC','wrong')],drivers);
assert.equal(calc({ktg:onlyInvalid},{period:'2026-10-01',filters:{equipmentClass:'mounted'}}).reason,
  'request-duration-incomplete');
const dec2025=calc({ktg:tables},{period:'2025-12-01'});
assert.equal(dec2025.reason,'itsm-period-without-observations');
const decToOct=calc({ktg:tables},{period:{start:'2025-12-01',end:'2026-10-01'}});
assert.equal(decToOct.dataState,'available');
assert.equal(decToOct.diagnostics.reportingMonths,1);
assert.equal(decToOct.diagnostics.requestedMonthCount,11);
assert.equal(decToOct.components.calendarHours,17*24*31);
assert.ok(Math.abs(decToOct.value-calc({ktg:tables},{period:'2026-10-01'}).value)<1e-9);
assert.equal(calc({ktg:tables},{period:'2026-10-01',filters:{mine:'Другая шахта'}}).reason,'equipment-count-zero-or-missing');
const noItsm=prep([],drivers);
assert.equal(calc({ktg:noItsm},{period:'2026-10-01'}).reason,'itsm-period-without-observations');
const noMbDependency=calc({ktg:tables},{period:'2026-10-01',filters:{equipmentClass:'stationary'}});
assert.equal(noMbDependency.dataState,'available');
assert.equal(noMbDependency.value,100,'No matched downtime, but ITSM calendar observed');
console.log('KTG ITSM/Drivers preparation and calculator: OK');
