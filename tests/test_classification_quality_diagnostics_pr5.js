'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const src=require('../src/js/kpi/source_facts.js');
require('../src/js/modules/itsm/mb_presence.js');
require('../src/js/kpi/preparation/common.js');
const preparation=require('../src/js/kpi/preparation/classification.js');
require('../src/js/kpi/calculator/common.js');
require('../src/js/kpi/calculator/definitions.js');
const calculator=require('../src/js/kpi/calculator/classification_quality/calculate.js');
const certified=(from,through)=>({
  reportingCoverage:{confirmed:true,basis:'source-export-cutoff',
    coverageFrom:from,coverageThrough:through}
});
const itsmMeta=certified('2026-01-01','2026-09-30');
const mbMeta=certified('2026-01-01','2026-10-31');
const itsm=(number,code,initiatorGroup,month='09')=>src.itsmFact({
  number,classificationQuality:{
    A:'INC без изм',B:'INC с исправлением',
    C:'INC не классифицирован',D:'RITM вместо INC'
  }[code],
  typeAfterReclassification:code==='D'?'RITM':'INC',
  completedAt:'2026-'+month+'-15',
  initiatorGroup,
  division:'ЗФ',territory:'Северный',
  sdgrService:'Стационарное оборудование',
  reclassifiedEquipment:'БКМ'
});
const itsmFacts=[
  itsm('INC-1','A','ЦГПС'),
  itsm('INC-2','B','СДГР'),
  itsm('INC-3','C','Заказчик'),
  itsm(null,'D','APIN'),
  itsm('INC-5','A',null),
  itsm('INC-6','A','ЦГПС','10'),
  src.itsmFact({number:'RITM-out',classificationQuality:'RITM без изм',
    completedAt:'2026-09-18'})
];
const mb=(request,month,recordKey)=>({
  request,recordKey,factDate:'2026-'+month+'-17',site:'Северный',
  equipmentPlacement:'Стационарное',
  equipmentType:'БКМ',equipmentUnit:'БКМ',
  laborState:'valid',laborHours:1,finalTaskType:'АВР'
});
const mobile={
  available:true,meta:mbMeta,records:[
    mb(' INC-1 ','09','1'),mb('inc-1','09','2'),
    mb('INC-2','10','3'),mb('INC-ORPHAN','09','4'),
    mb('inc-orphan','09','5'),mb(null,'09','6')
  ]
};
const facts=preparation.prepare(itsmFacts);
const diag=preparation.prepareDiagnostics(itsmFacts,mobile,itsmMeta);
const query={period:'2026-09',filters:{
  mine:'Северный',equipmentClass:'stationary'
}};
const result=calculator.calculate({classification:facts,
  classificationDiagnostics:diag},query);
assert.equal(result.value,40);
assert.equal(result.components.classificationIncUnchangedCount,2);
assert.equal(result.components.classificationIncCorrectedCount,1);
assert.equal(result.components.classificationIncUnclassifiedCount,1);
assert.equal(result.components.classificationRitmInsteadOfIncCount,1);
assert.equal(result.components.classificationTotalCount,5);
const ev=result.diagnostics.classificationCoverage;
assert.equal(ev.classifiedItsmCount,5);
assert.equal(ev.bothSameMonthCount,1);
assert.equal(ev.bothOtherMonthCount,1);
assert.equal(ev.bothUndatedMbCount,0);
assert.equal(ev.missingItsmRequestCount,1);
assert.equal(ev.itsmNotInLoadedMbCount,2);
assert.equal(ev.itsmConfirmedMbAbsenceCount,2);
assert.equal(ev.itsmUnknownMbCoverageCount,0);
assert.equal(ev.mbOnlyLoadedCount,1,'two MB tasks for one orphan request count once');
assert.equal(ev.mbUnknownItsmCoverageCount,0);
assert.equal(ev.mbNoRequestTaskCount,1);
assert.equal(ev.byInitiator.length,5);
assert.equal(ev.byInitiator.find(x=>x.label==='ЦГПС').categoryA,1);
assert.equal(ev.byInitiator.find(x=>x.label==='СДГР').bothOtherMonthCount,1);
assert.equal(ev.byInitiator.find(x=>x.label==='Заказчик').categoryC,1);
assert.equal(ev.byInitiator.find(x=>x.label==='APIN').categoryD,1);
assert.equal(ev.byInitiator.find(x=>x.label==='Группа не определена').categoryA,1);
assert(Object.isFrozen(ev.byInitiator));
assert(Object.isFrozen(ev.byInitiator[0]));
const october=calculator.calculate({classification:facts,
  classificationDiagnostics:diag},{
  period:'2026-10',filters:{mine:'Северный',equipmentClass:'stationary'}
});
assert.equal(october.value,100);
assert.equal(october.diagnostics.classificationCoverage.itsmUnknownMbCoverageCount,0);
assert.equal(october.diagnostics.classificationCoverage.itsmConfirmedMbAbsenceCount,1);
const partialMb=preparation.prepareDiagnostics(itsmFacts,{
  ...mobile,meta:certified('2026-01-01','2026-09-30')
},itsmMeta);
const octoberUnknown=calculator.calculate({classification:facts,
  classificationDiagnostics:partialMb},{
  period:'2026-10',filters:{mine:'Северный',equipmentClass:'stationary'}
});
assert.equal(octoberUnknown.diagnostics.classificationCoverage.itsmUnknownMbCoverageCount,1);
assert.equal(octoberUnknown.diagnostics.classificationCoverage.itsmConfirmedMbAbsenceCount,0);
const withoutMb=preparation.prepareDiagnostics(itsmFacts,{
  records:[],available:false,meta:{}
},itsmMeta);
const unavailable=calculator.calculate({classification:facts,
  classificationDiagnostics:withoutMb},query);
assert.equal(unavailable.value,result.value,
  'General quality formula must not require Mobile Brigades');
assert.equal(unavailable.diagnostics.classificationCoverage.itsmUnknownMbCoverageCount,4);
assert.equal(unavailable.diagnostics.classificationCoverage.mbPresent,false);
const legacy=calculator.calculate({classification:facts},query);
assert.equal(legacy.value,result.value);
assert.equal(legacy.diagnostics.classificationCoverage,null);
const scoped=calculator.calculate({classification:facts,classificationDiagnostics:diag},{
  period:'2026-09',filters:{mine:'Другой',equipmentClass:'stationary'}
});
assert.equal(scoped.value,null);
assert.equal(scoped.diagnostics.classificationCoverage.classifiedItsmCount,0);
// Real UI function, no fake HTML: the same selected diagnostic is shown below
// the unchanged category formula; no personal request text is rendered.
const source=fs.readFileSync('src/js/app/reliability_kpi_chart.js','utf8');
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({
  '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'
})[c]);
const context=vm.createContext({escapeHtml:esc,Intl,Date,console});
vm.runInContext(fs.readFileSync('src/js/app/reliability_dashboard.js','utf8')+'\n'+source,context);
const point={period:'2026-09',value:result.value,
  dataState:'available',components:result.components,
  classificationCoverage:ev};
const series={id:'s',mineLabel:'Северный',equipmentLabel:'Стационарное',
  points:[point]};
const view={points:[{period:'2026-09',value:result.value}]};
const html=context.renderKpiFormulaTiles([{series,view}],'classification_quality','%');
for(const needle of ['Качество классификации общее','Примечания к вычислениям',
  'Сверка ITSM и МБ','Группы инициаторов','Совпал месяц МБ',
  'Другой месяц МБ','APIN','СДГР','Заказчик','ЦГПС',
  'Номер ITSM не найден в загруженной МБ']){
  assert(html.includes(needle),'Missing diagnostic label: '+needle);
}
assert(html.includes('40 %')||html.includes('40%'));
assert(!html.includes('Качество классификации — общее'));
console.log('PR-5 general classification: immutable formula, initiators, unique MB requests, same/different month, unknown coverage, UI OK');
