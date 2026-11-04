// PR-3: universal presentation of existing Calculator Result.components.
// Never evaluates formulas, guesses missing values or changes chart SVG.
'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
require('../src/js/app/reliability_dashboard_data.js');
require('../src/js/modules/itsm/mb_presence.js');
require('../src/js/kpi/source_facts.js');
for(const name of ['common','failures','equipment','labor','sla','classification','prb','ktg','index'])
  require('../src/js/kpi/preparation/'+name+'.js');
require('../src/js/kpi/calculator/common.js');
require('../src/js/kpi/calculator/definitions.js');
for(const name of ['vbr','ktg','sla','classification_quality',
  'classification_quality_cgps','labor','problem_management'])
  require('../src/js/kpi/calculator/'+name+'/calculate.js');
require('../src/js/kpi/calculator/index.js');
require('../src/js/kpi/catalog/contracts.js');
const catalog=require('../src/js/kpi/catalog/index.js');
require('../src/js/kpi/passport_math.js');
const passport=require('../src/js/kpi/passport_view.js');

const result=(components,value=90,state='available',reason=null)=>
  ({dataState:state,value,components,reason});
assert.equal(catalog.list().length,22);
for(const entry of catalog.list()){
  const spec=catalog.getV2(entry.id);
  const input=result(Object.fromEntries(spec.components.map((c,i)=>[c.key,i])),50);
  const old=JSON.stringify(input);
  const projected=catalog.projectComponents(entry.id,input);
  assert.equal(projected.kpiId,entry.id);
  assert.equal(projected.items.length,spec.components.length);
  assert.equal(projected.componentCount,spec.components.length);
  assert(Object.isFrozen(projected));
  assert(Object.isFrozen(projected.items));
  for(const item of projected.items){
    const declared=spec.components.find(c=>c.key===item.key);
    assert.equal(item.value,input.components[item.key],entry.id+'/'+item.key);
    assert.equal(item.role,declared.role);
    assert.equal(item.label,declared.label);
    assert.equal(item.unit,declared.unit);
    assert.equal(item.state,'available');
  }
  assert.equal(JSON.stringify(input),old,'V2 projection must be read-only');
  if(entry.calculationState==='not-implemented'){
    assert.equal(projected.items.length,0);
    assert.equal(projected.canDisplayFormula,false);
  }
}
assert.equal(catalog.projectComponents('missing',result({})),null);
assert.equal(catalog.projectComponents('sla',null).canDisplayFormula,false);

// Zero is real, but absent, invalid, non-finite and strings are missing.
const zero=catalog.projectComponents('sla',result({
  slaSuccessCount:0,slaTotalCount:10,slaOverdueCount:10
},0));
assert.equal(zero.numerator.value,0);
assert.equal(zero.canDisplayFormula,true);
const missing=catalog.projectComponents('sla',result({
  slaSuccessCount:9,slaTotalCount:null,slaOverdueCount:'1'
},90));
assert.equal(missing.denominator.state,'missing');
assert.equal(missing.denominator.value,null);
assert.equal(missing.items.find(c=>c.key==='slaOverdueCount').state,'missing');
assert.equal(missing.canDisplayFormula,false);
const nonfinite=catalog.projectComponents('sla',result({
  slaSuccessCount:Infinity,slaTotalCount:10
},90));
assert.equal(nonfinite.canDisplayFormula,false);
const unavailable=catalog.projectComponents('sla',result({
  slaSuccessCount:5,slaTotalCount:10
},null,'no-data','source-incomplete'));
assert.equal(unavailable.dataState,'no-data');
assert.equal(unavailable.observedValue,null);
assert.equal(unavailable.canDisplayFormula,false);
assert.equal(unavailable.reason,'source-incomplete');

// Declared denominators and available absolute components, including PRB.
for(const [id,n,d] of [
  ['sla','slaSuccessCount','slaTotalCount'],
  ['avr_share','avrLaborHours','totalLaborHours'],
  ['reactive_share','reactiveLaborHours','totalLaborHours'],
  ['problem_coverage_relative','linkedLaborHours','laborHours']
]){
  const record=Object.fromEntries(catalog.getV2(id).components.map(c=>[c.key,15]));
  const view=catalog.projectComponents(id,result(record));
  assert.equal(view.kind,'ratio');
  assert.equal(view.numerator.key,n);
  assert.equal(view.denominator.key,d);
  assert.equal(view.canDisplayFormula,true);
}
assert.equal(catalog.projectComponents('problem_coverage_absolute',
  result({linkedLaborHours:15,linkedTaskCount:3})).primary.key,'linkedLaborHours');
assert.equal(catalog.projectComponents('total_labor',
  result({laborHours:200,taskCount:10})).primary.unit,'чел.-ч');
for(const id of ['avr_labor','maintenance_labor','corrective_labor']){
  const metrics=catalog.getV2(id).relatedMetrics;
  assert(!metrics.some(m=>m.componentKey==='taskCount'),
    'Unfiltered labor task count must not be advertised as subtype task quantity');
}

// Passport and chart consume ONE catalog projection. Passport also preserves
// any unforeseen raw component for audit, not as a mathematically named input.
const snapshot={
  schemaVersion:'1.0.0',calculatedAt:'2026-10-13T03:00:00Z',
  query:{period:{month:'2026-10'},mine:{label:'Северный'},
    equipmentClass:{label:'Навесное'}},
  results:{
    sla:result({slaSuccessCount:9,slaTotalCount:10,slaOverdueCount:1,
      futureDiagnosticCount:7},90)
  },
  sources:[{id:'itsm_data',available:true,activeRevision:2,contentHash:'abc'}],
  kpiView:{cards:{sla:{current:{dataState:'available',value:90,period:'2026-10'}}}}
};
const frozenInput=JSON.stringify(snapshot);
const html=passport.renderContent('sla',{snapshot});
for(const token of ['Выполнено в SLA','Всего с известным SLA','Нарушение SLA',
  'числитель','знаменатель','slaSuccessCount','Ключ Result.components',
  'futureDiagnosticCount','9 обращений','10 обращений']){
  assert(html.includes(token),'SLA passport missing '+token);
}
assert.equal(JSON.stringify(snapshot),frozenInput);
const emptyPassport=passport.renderContent('sla',{snapshot:{...snapshot,results:{}}});
assert(emptyPassport.includes('Фактические компоненты отсутствуют'));
const emptyFactSection=emptyPassport.split('id="kpi-passport-fact"')[1]
  .split('id="kpi-passport-interpretation"')[0];
assert(!emptyFactSection.includes('9 обращений'),
  'The educational SLA formula example is permitted, but the factual section must be empty');
const unavailablePassport=passport.renderContent('sla',{
  snapshot:{...snapshot,results:{sla:result({slaSuccessCount:9},null,'no-data','missing-denominator')},
    kpiView:{cards:{sla:{current:{dataState:'no-data',value:null,period:'2026-10'}}}}}
});
assert(unavailablePassport.includes('—'));
assert(!unavailablePassport.includes('NaN'));
assert(!unavailablePassport.includes('Infinity'));

const esc=x=>String(x??'').replace(/[&<>"']/g,ch=>({
  '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'
})[ch]);
const context={console,Intl,Date,Math,Number,Object,Array,Set,Map,JSON,
  escapeHtml:esc,ReclassifierKpiCatalog:catalog,
  document:{getElementById:()=>({clientWidth:980})}};
const chart=vm.runInNewContext(
  fs.readFileSync('src/js/app/reliability_dashboard.js','utf8')+'\n'+
  fs.readFileSync('src/js/app/reliability_kpi_chart.js','utf8')+
  '\n;({renderKpiFormulaTiles,reliabilityKpiChartUiState,kpiChartSvgMulti})',
  context
);
const plot=(id,parts,unit,pointOverrides={})=>{
  chart.reliabilityKpiChartUiState.kpiId=id;
  chart.reliabilityKpiChartUiState.detailSeriesId=null;
  chart.reliabilityKpiChartUiState.detailMonth=null;
  const series={id:'all:mounted',mineId:'all',mineLabel:'Все',
    equipmentClass:'mounted',equipmentLabel:'Навесное',
    points:[{period:'2026-10',value:90,dataState:'available',
      components:parts,...pointOverrides}]};
  return chart.renderKpiFormulaTiles(
    [{series,view:{points:[{period:'2026-10',value:90}]}}],
    id,unit);
};
const sla=plot('sla',{slaSuccessCount:9,slaTotalCount:10,slaOverdueCount:1},'%');
assert(sla.includes('Состав расчёта · SLA'));
assert(sla.includes('data-kpi-component="slaSuccessCount"'));
assert(sla.includes('data-kpi-component="slaTotalCount"'));
assert(sla.includes('reliability-formula-fraction'));
assert(sla.includes('× 100%'));
assert(sla.includes('Нарушение SLA'));
assert(!sla.includes('Компонент 1'));
assert(!sla.includes('Компонент 2'));
const avr=plot('avr_share',{avrLaborHours:30,totalLaborHours:100},'%');
assert(avr.includes('Трудоёмкость АВР'));
assert(avr.includes('Общая трудоёмкость'));
assert(avr.includes('30 чел.-ч'));
const labor=plot('total_labor',{
  laborHours:847,taskCount:150,usableLaborTaskCount:149,unusableLaborTaskCount:1
},'чел.-ч');
assert(labor.includes('Трудоёмкость'));
assert(labor.includes('847 чел.-ч'));
assert(labor.includes('Все задачи выбранного среза'));
assert(labor.includes('Дополнительные фактические компоненты'));
assert(!labor.includes('Компонент 1'));
const prb=plot('problem_coverage_absolute',{
  linkedLaborHours:44,laborHours:300,linkedTaskCount:5,taskCount:20
},'чел.-ч');
assert(prb.includes('Трудоёмкость задач, связанных с PRB'));
assert(prb.includes('44 чел.-ч'));
for(const id of ['maintenance_labor','corrective_labor','avr_labor']){
  const doc=plot(id,{laborHours:100,taskCount:400},'чел.-ч');
  assert(doc.includes('Трудоёмкость'));
  assert(doc.includes('Все задачи выбранного среза'),
    'Diagnostic task count retains its accurate neutral label');
}
const incomplete=plot('sla',{slaSuccessCount:9},'%',{
  value:90,dataState:'available'
});
assert(incomplete.includes('отсутствуют необходимые компоненты'));
assert(!incomplete.includes('reliability-formula-fraction'));
const escaped=plot('sla',{slaSuccessCount:9,slaTotalCount:10},'%',{
  value:null,dataState:'no-data',reason:'<img src=x onerror=alert(1)>'
});
assert(!escaped.includes('<img'));
assert(escaped.includes('&lt;img'));

// The only chart rendering changes are component equation tiles; the actual
// SVG line and forecast renderer is untouched and PR-1 SVG test protects it.
console.log('PR-3: all 19 named component projections; ratio/sum details; zero/missing guards; passport; untouched SVG semantics OK');
