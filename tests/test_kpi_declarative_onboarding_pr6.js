// PR-6: end-to-end registration of 3 synthetic KPIs in an isolated VM.
// PR-7 preserves the pilot registration while injecting three additional
// synthetic definitions to stress the declarative onboarding architecture.
'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const source=path.join(__dirname,'..');
const configs=[
  {id:'demo_avr_count',title:'Тест · число АВР',category:'labor',
   kind:'count',source:'labor',unit:'шт.',direction:'neutral',
   definition:'Число задач АВР в подготовленном Dataset МБ.',
   purpose:'Тест динамического подключения количественного показателя.',
   components:[{key:'avrCount',label:'Количество АВР',unit:'шт.',
     role:'primary',field:'taskCount',where:{finalTaskType:['АВР']}}]},
  {id:'demo_avr_hours',title:'Тест · часы АВР',category:'labor',
   kind:'sum',source:'labor',unit:'чел.-ч',direction:'neutral',
   definition:'Трудоёмкость задач АВР в подготовленном Dataset МБ.',
   purpose:'Тест динамического подключения суммируемой метрики.',
   components:[{key:'avrHours',label:'Часы АВР',unit:'чел.-ч',
     role:'primary',field:'laborHours',where:{finalTaskType:['АВР']}},
   {key:'avrTaskCount',label:'Задачи АВР',unit:'шт.',
     role:'context',field:'taskCount',where:{finalTaskType:['АВР']}}]},
  {id:'demo_sla_ratio',title:'Тест · доля своевременных',category:'organizationalReadiness',
   kind:'ratio',source:'sla',unit:'%',direction:'higher-is-better',
   definition:'Доля успешных SLA среди обращений с известным SLA.',
   purpose:'Тест динамического подключения процентного показателя.',
   components:[
     {key:'successCount',label:'В срок',unit:'обращений',
       role:'numerator',field:'slaSuccessCount'},
     {key:'allCount',label:'Известно SLA',unit:'обращений',
       role:'denominator',field:'slaTotalCount'}
   ]}
];
const fixtureSource=JSON.stringify(configs);
function makeScope(withFixture){
  const scope=vm.createContext({console,Intl,Date,Math,Map,Set,
    TextEncoder,TextDecoder,Uint8Array,
    escapeHtml:value=>String(value??'').replace(/[&<>"]/g,c=>({
      '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'
    })[c]),
    document:{getElementById:()=>({clientWidth:980})}
  });
  const read=(p)=>fs.readFileSync(path.join(source,'src/js',p),'utf8');
  const scripts=[
    'app/reliability_dashboard_data.js',
    'modules/itsm/mb_presence.js',
    'kpi/source_facts.js',
    ...['common','failures','equipment','labor','sla','classification','prb','ktg','index']
      .map(p=>'kpi/preparation/'+p+'.js'),
    'kpi/calculator/common.js',
    'kpi/calculator/declarative.js',
    'kpi/calculator/definitions.js',
    ...['vbr','ktg','sla','classification_quality','classification_quality_cgps',
      'labor','problem_management'].map(p=>'kpi/calculator/'+p+'/calculate.js'),
    'kpi/calculator/index.js',
    'kpi/catalog/contracts.js',
    'kpi/catalog/index.js',
    'kpi/forecast_engine.js',
    'kpi/report_view_model.js',
    'kpi/chart_view_model.js',
    'kpi/passport_math.js',
    'kpi/passport_view.js',
    'app/reliability_pdf.js',
    'app/reliability_dashboard.js',
    'app/reliability_kpi_chart.js'
  ];
  for(const p of scripts){
    let code=read(p);
    if(withFixture&&p==='kpi/calculator/declarative.js'){
      const before="const REGISTERED=Object.freeze([";
      assert(code.includes(before));
      code=code.replace(before,"const REGISTERED=Object.freeze([..."+fixtureSource+",");
    }
    vm.runInContext(code,scope,{filename:p});
  }
  return scope;
}
const baseline=makeScope(false);
assert.equal(baseline.ReclassifierKpiCatalog.list().length,23);
assert.equal(baseline.ReclassifierKpiCalculator.ids.length,17);
assert.equal(baseline.ReclassifierKpiDeclarative.definitions.length,1);
assert.equal(baseline.ReclassifierKpiDeclarative.definitions[0].id,'avr_task_count');
const ctx=makeScope(true),catalog=ctx.ReclassifierKpiCatalog;
const calculator=ctx.ReclassifierKpiCalculator,declare=ctx.ReclassifierKpiDeclarative;
assert.equal(catalog.list().length,26);
assert.equal(calculator.ids.length,20);
assert.deepEqual(Array.from(declare.definitions.filter(x=>x.id.startsWith('demo_')).map(x=>x.id)),
  configs.map(c=>c.id));
assert.equal(declare.definitions.filter(x=>x.id==='avr_task_count').length,1);
assert.deepEqual(Array.from(catalog.list({category:'labor'})
    .filter(x=>x.id.startsWith('demo_')).map(x=>x.id)),
  ['demo_avr_count','demo_avr_hours']);
for(const config of configs){
  const entry=catalog.get(config.id),v2=catalog.getV2(config.id);
  assert(entry&&v2);
  assert.equal(entry.calculationState,'implemented');
  assert.equal(entry.definition.methodology.status,'draft');
  assert.equal(entry.definition.methodology.version,'not-assigned');
  assert.equal(entry.calculation.formula.expression,declare.get(config.id).formula);
  assert.equal(entry.calculation.formula.formulaVersion,'1.0.0');
  assert.equal(entry.calculation.formulaHandler,'ReclassifierKpiDeclarative.calculate');
  assert.equal(v2.measurement.kind,config.kind);
  assert.equal(v2.forecast.policy,'historical-next-month');
  assert.equal(v2.forecast.chartNowcastConnected,false,
    'No invented reporting-month coverage for dynamically registered KPI');
  assert.equal(v2.components.length,config.components.length);
  assert.equal(catalog.projectComponents(config.id,{
    dataState:'available',value:1,components:Object.fromEntries(
      config.components.map(x=>[x.key,1]))
  }).canDisplayFormula,true);
  assert.equal(catalog.getCalculation(config.id).sources[0].datasetId,
    config.source==='labor'?'mobile_brigade_data':'itsm_data');
  assert.equal(catalog.getCalculation(config.id).temporal.periodGrain,'month');
}
// Real prepared records. Task count is aggregated in the component source,
// not the number of preparation groups (one group can represent N tasks).
const records=[
  {recordKey:'a',factDate:'2026-09-02',site:'Северный',
   finalTaskType:'АВР',laborHours:3},
  {recordKey:'b',factDate:'2026-09-03',site:'Северный',
   finalTaskType:'АВР',laborHours:5},
  {recordKey:'c',factDate:'2026-09-04',site:'Северный',
   finalTaskType:'ТО по графику',laborHours:2}
];
// Use the same validated *prepared* family schema as existing Calculator.
const families={
  labor:Object.freeze({id:'mobile_brigade_labor',
    rows:Object.freeze([
      Object.freeze({period:'2026-09',site:'Северный',equipmentClass:'mounted',
        finalTaskType:'АВР',taskCount:2,laborHours:8,
        usableLaborTaskCount:2,unusableLaborTaskCount:0}),
      Object.freeze({period:'2026-09',site:'Северный',equipmentClass:'mounted',
        finalTaskType:'ТО по графику',taskCount:1,laborHours:2,
        usableLaborTaskCount:1,unusableLaborTaskCount:0})
    ])}),
  sla:Object.freeze({id:'sla',rows:Object.freeze([
    Object.freeze({period:'2026-09',mine:'Северный',equipmentClass:'mounted',
      slaSuccessCount:9,slaOverdueCount:1,slaTotalCount:10})
  ])})
};
const query={period:'2026-09-01',filters:{mine:'Северный',equipmentClass:'mounted'}};
const result=calculator.calculate({version:'1.0.0',families},{...query,
  kpis:configs.map(c=>c.id)});
assert.equal(result.results.demo_avr_count.value,2);
assert.equal(result.results.demo_avr_hours.value,8);
assert.equal(result.results.demo_sla_ratio.value,90);
assert.equal(result.results.demo_sla_ratio.components.successCount,9);
assert.equal(result.results.demo_sla_ratio.components.allCount,10);
assert.equal(result.results.demo_avr_hours.components.avrTaskCount,2);
assert.equal(result.results.demo_avr_count.formulaVersion,'1.0.0');
const cutoff=calculator.calculateOne('demo_avr_hours',{families:{
  ...families,labor:Object.freeze({id:'mobile_brigade_labor',rows:Object.freeze([
    Object.freeze({period:'2026-09',site:'Северный',
      finalTaskType:'АВР',taskCount:2,laborHours:0,
      usableLaborTaskCount:0,unusableLaborTaskCount:2})
  ])})}},query);
assert.equal(cutoff.dataState,'no-data');
assert.equal(calculator.calculateOne('demo_avr_count',{families:{sla:families.sla}},query).reason,
  'source-not-loaded','Missing labor Dataset must not masquerade as a valid count');
const subtypeMissing=calculator.calculateOne('demo_avr_hours',{families:{
  ...families,labor:Object.freeze({id:'mobile_brigade_labor',rows:Object.freeze([
    Object.freeze({period:'2026-09',site:'Северный',equipmentClass:'mounted',
      finalTaskType:'АВР',taskCount:2,laborHours:0,
      usableLaborTaskCount:0,unusableLaborTaskCount:2}),
    Object.freeze({period:'2026-09',site:'Северный',equipmentClass:'mounted',
      finalTaskType:'ТО по графику',taskCount:3,laborHours:14,
      usableLaborTaskCount:3,unusableLaborTaskCount:0})
  ])})}},query);
assert.equal(subtypeMissing.dataState,'no-data',
  'Usable ТО must not make invalid АВР hours appear available');
assert.equal(subtypeMissing.value,null);

assert.equal(cutoff.value,null);
assert.equal(calculator.calculateOne('demo_sla_ratio',{families:{
  ...families,sla:Object.freeze({id:'sla',rows:Object.freeze([
    Object.freeze({period:'2026-09',mine:'Северный',equipmentClass:'mounted',
      slaSuccessCount:0,slaTotalCount:0})
  ])})}},query).reason,'zero-denominator');
assert.equal(calculator.calculateOne('demo_avr_count',{families}, {
  ...query,filters:{unsupported:'x'}
}).reason,'unsupported-filter');

const v=ctx.ReclassifierKpiReportViewModel;
const byId=result.results;
const monthly=[{period:'2026-09',...byId}];
const view=v.create({selectedMonth:'2026-09',currentResults:byId,
  monthlyResults:monthly,sources:[],filters:query.filters});
for(const config of configs){
  const card=view.cards[config.id];
  assert.equal(card.current.dataState,'available');
  assert.equal(card.current.value,byId[config.id].value);
  assert(view.seriesById[config.id].points.length===1);
  assert(view.seriesById[config.id].points[0].period==='2026-09');
  assert.equal(card.forecast.dataState,'insufficient');
  assert.equal(card.forecast.reason,'insufficient-history');
}
const snapshot={
  type:'reliability-report',status:'ready',
  calculatedAt:'2026-10-13T04:00:00Z',
  query:{period:{id:'2026-09',month:'2026-09',label:'Сен 2026'},
    mine:{id:'Северный',label:'Северный'},
    equipmentClass:{id:'mounted',label:'Навесное'}},
  results:byId,kpiView:view,sources:[],series:{monthly},
  filters:{periods:[],mines:[],equipmentClasses:[]},
  breakdowns:{labor:[],problemManagement:[]}
};
const prior=JSON.stringify(snapshot);
const cardView=ctx.buildReliabilityDashboardView(
  ctx.ReclassifierReliabilityDashboardData,snapshot);
const laborIds=cardView.labor.summaryKpis.map(x=>x.id);
assert(laborIds.includes('demo_avr_count'));
assert(laborIds.includes('demo_avr_hours'));
assert(cardView.kpiGroups.organizationalReadiness.some(x=>x.id==='demo_sla_ratio'));
const cardMarkup=ctx.renderReliabilityKpiCard(
  cardView.labor.summaryKpis.find(x=>x.id==='demo_avr_count'));
assert(cardMarkup.includes('demo_avr_count'));
assert(cardMarkup.includes('reliabilityKpiPassportOpen_demo_avr_count'));
assert(cardMarkup.includes('reliabilityKpiChartOpen_demo_avr_count'));
const passport=ctx.ReclassifierKpiPassportView.renderContent('demo_sla_ratio',{
  snapshot,activeTab:'method'
});
assert(passport.includes('В срок')&&passport.includes('Известно SLA'));
assert(passport.includes('Машинная запись и версия формулы'));
assert(!passport.includes('Иллюстрация отключена'));
// Actual chart controller and SVG: generic new KPI needs no per-ID renderer.
const chartState=vm.runInContext('reliabilityKpiChartUiState',ctx);
chartState.kpiId='demo_avr_count';
chartState.metric='kpi';
chartState.range='1y';
chartState.window=1;
chartState.mineIds=['all'];
chartState.classes=['mounted'];
chartState.equipmentNames=[];
chartState.data={
  selectedMonth:'2026-09',availableFrom:'2026-09',availableTo:'2026-09',
  mineOptions:[{id:'all',label:'Все'}],equipmentNameOptions:[],
  series:[{id:'all:mounted',mineId:'all',mineLabel:'Все',
    equipmentClass:'mounted',equipmentLabel:'Навесное',kpiId:'demo_avr_count',
    forecast:null,
    points:[{period:'2026-09',value:2,dataState:'available',
      components:byId.demo_avr_count.components}]}]
};
const html=ctx.renderKpiChartModalBody();
assert(html.includes('Динамика · Тест · число АВР'));
assert(html.includes('Состав расчёта'));
assert(html.includes('Количество АВР'));
assert(html.includes('<svg'));
assert(!html.includes('class="reliability-chart-forecast-ghost"'),
  'Do not invent a dashed monthly nowcast without confirmed coverage');
const ratioRolling=ctx.ReclassifierKpiChartViewModel.rolling({
  kpiId:'demo_sla_ratio',window:2,points:[
    {period:'2026-08',value:50,dataState:'available',
      components:{successCount:1,allCount:2}},
    {period:'2026-09',value:90,dataState:'available',
      components:{successCount:9,allCount:10}}
  ]
});
assert(Math.abs(ratioRolling.points[1].value-(10/12*100))<1e-10,
  'New KPI rolling percentages must use ratio of summed components');
const pdf=ctx.ReclassifierReliabilityPdfRenderer.createPlan(snapshot);
for(const config of configs)
  assert(pdf.results.some(x=>x.id===config.id),
    'New KPI must have an entry in the existing PDF plan');
assert.equal(JSON.stringify(snapshot),prior,
  'No PDF/dashboard/passport module mutates the source Snapshot');
const chart=ctx.ReclassifierKpiForecastEngine.strategyRegistry;
for(const config of configs){
  assert.equal(chart.forKpi(config.id).policy,'historical-next-month');
  assert.equal(ctx.ReclassifierKpiForecastEngine.forecastPreferences.methodsFor(config.id)[0],
    'linear-trend');
}
assert.throws(()=>declare.createRegistry([{...configs[0],
  id:'bad_query',source:'sql; DROP TABLE' }]),/Invalid/);
assert.throws(()=>declare.createRegistry([{...configs[0],id:'bad_where',
  components:[{...configs[0].components[0],where:{evilField:['yes']}}]}]),/Unsafe/);
assert.throws(()=>declare.createRegistry([{...configs[0],id:'duplicate_demo'},{
  ...configs[0],id:'duplicate_demo'}]),/duplicate/);
assert.throws(()=>declare.createRegistry([{...configs[0],
  id:'bad_percent',kind:'ratio'}]),/Unsupported|Invalid|Incorrect component role/);
assert.equal(JSON.stringify(snapshot),prior);
console.log('PR-6: 3 synthetic COUNT/SUM/RATIO registrations => Calculator, Catalog, V2, cards, Passport, history chart, Forecast, PDF; 19 original KPI intact; 1 pilot + 3 isolated synthetic KPI OK');
