// PR-5: selectable KPI forecast method shared by passport and chart.
// Synthetic data only; all preview calculations must preserve frozen Snapshot
// facts and must not change existing SVG/forecast endpoints.
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
const engine=require('../src/js/kpi/forecast_engine.js');
require('../src/js/kpi/passport_math.js');
const passport=require('../src/js/kpi/passport_view.js');
const prefs=engine.forecastPreferences;
const registry=engine.strategyRegistry;

assert(Object.isFrozen(prefs));
assert.deepEqual(prefs.methodsFor('vbr'),catalog.getV2('vbr').forecast.methodIds);
assert.deepEqual(prefs.methodsFor('ktg'),catalog.getV2('ktg').forecast.methodIds);
assert.deepEqual(prefs.methodsFor('total_labor'),catalog.getV2('total_labor').forecast.methodIds);
assert.deepEqual(prefs.methodsFor('sla'),['linear-trend','last-value']);
assert.deepEqual(prefs.methodsFor('inc'),registry.forMetric('inc').methodIds);
assert.deepEqual(prefs.methodsFor('labor'),registry.forMetric('labor').methodIds);
assert.deepEqual(prefs.methodsFor('kog'),[]);
assert.deepEqual(prefs.methodsFor('fake'),[]);
assert.equal(prefs.get('vbr'),null);
assert.throws(()=>prefs.set('kog','linear-trend'),/not configurable/);
assert.throws(()=>prefs.set('sla','observed-run-rate'),/Unsupported/);
assert.throws(()=>prefs.set('vbr','totally-unknown-method'),/Unsupported/);
assert.equal(prefs.get('sla'),null);
const events=[];
const unsubscribe=prefs.subscribe(update=>events.push(update));
assert.equal(prefs.set('vbr','observed-run-rate','passport'),'observed-run-rate');
assert.equal(prefs.get('vbr'),'observed-run-rate');
assert.equal(events.length,1);
assert.deepEqual(events[0],{kpiId:'vbr',methodId:'observed-run-rate',origin:'passport'});
prefs.set('vbr','observed-run-rate','chart');
assert.equal(events.length,1,'No duplicate event for identical preference');
prefs.set('vbr','auto','passport');
assert.equal(events.length,2);
assert.equal(events[1].methodId,null);
assert.equal(prefs.get('vbr'),null);
unsubscribe();
prefs.set('vbr','last-value','chart');
assert.equal(events.length,2);
prefs.set('vbr','auto','test');

const SEP={sourceId:'itsm_data',reportMonth:'2026-09',
  reportMonthStatus:'incomplete',coverageBasis:'source-export-cutoff',
  coverageFrom:'2026-09-01',coverageThrough:'2026-09-15'};
const LABOR={...SEP,sourceId:'mobile_brigade_data'};
const historicalMonths=Array.from({length:12},(_,i)=>{
  const d=new Date(Date.UTC(2025,9+i,1)).toISOString().slice(0,7);
  return {period:d,value:90,dataState:'available',components:{
    slaSuccessCount:9,slaTotalCount:10
  }};
});
const snapshot={
  schemaVersion:'1.0.0',calculatedAt:'2026-10-13T04:00:00.000Z',
  query:{period:{month:'2026-09',label:'Сентябрь'},
    mine:{label:'Северный'},equipmentClass:{label:'Навесное'}},
  results:{
    vbr:{dataState:'available',value:98,components:{
      failureCount:20,equipmentCount:1000},diagnostics:{partialCoverage:false}},
    total_labor:{dataState:'available',value:847,
      components:{laborHours:847,taskCount:120}},
    sla:{dataState:'available',value:90,
      components:{slaSuccessCount:9,slaTotalCount:10}}
  },
  reportingCoverage:{kpis:{vbr:SEP,total_labor:LABOR}},
  sources:[{id:'itsm_data',activeRevision:1,contentHash:'a',available:true},
    {id:'mobile_brigade_data',activeRevision:1,contentHash:'b',available:true}],
  kpiView:{
    selectedMonth:'2026-09',
    cards:{
      vbr:{current:{value:98,dataState:'available',period:'2026-09'},
        forecast:{forecastType:'reporting-month-nowcast',value:91,
          observedValue:98,dataState:'available',horizon:'2026-09',
          requestedMethodId:'linear-trend',methodId:'linear-trend',
          methodVersion:'1.0.0'}},
      total_labor:{current:{value:847,dataState:'available',period:'2026-09'},
        forecast:{forecastType:'reporting-month-volume-nowcast',
          value:1100,observedValue:847,dataState:'available',horizon:'2026-09',
          methodId:'linear-trend',methodVersion:'1.0.0'}},
      sla:{current:{value:90,dataState:'available',period:'2026-09'},
        forecast:{value:85,dataState:'available',horizon:'2026-10',
          methodId:'linear-trend',methodVersion:'1.0.0'}}
    },
    seriesById:{
      vbr:{points:[{period:'2026-09',value:98,dataState:'available',
        components:{failureCount:20,equipmentCount:1000}}]},
      total_labor:{points:[{period:'2026-09',value:847,dataState:'available',
        components:{laborHours:847}}]},
      sla:{points:historicalMonths}
    }
  }
};
const fingerprint=JSON.stringify(snapshot);
const defaultVbr=passport.renderContent('vbr',{snapshot,activeTab:'monitor'});
assert(defaultVbr.includes('id="kpiPassportForecastMethod"'));
assert(defaultVbr.includes('value="auto" selected'));
assert(defaultVbr.includes('91 %'));
assert(!defaultVbr.includes('Сценарный прогноз по выбранному методу'));

prefs.set('vbr','observed-run-rate','passport');
const scenarioVbr=passport.renderContent('vbr',{snapshot,activeTab:'monitor'});
assert(scenarioVbr.includes('value="observed-run-rate" selected'));
assert(scenarioVbr.includes('Сценарный прогноз по выбранному методу'));
assert(scenarioVbr.includes('96 %'),'20 failures in first 15 days projects to 40 in 30');
assert(scenarioVbr.includes('98 %'),'Observed KPI must not become predicted KPI');
assert(scenarioVbr.includes('не включён в Report Snapshot и PDF'));
assert.equal(JSON.stringify(snapshot),fingerprint);
assert.equal(snapshot.kpiView.cards.vbr.forecast.value,91);
assert.equal(snapshot.results.vbr.value,98);
prefs.set('vbr','auto');
assert(!passport.renderContent('vbr',{snapshot}).includes('Сценарный прогноз по выбранному методу'));
assert(passport.renderContent('vbr',{snapshot}).includes('91 %'));

prefs.set('total_labor','observed-run-rate');
const scenarioLabor=passport.renderContent('total_labor',{snapshot,activeTab:'monitor'});
assert(scenarioLabor.includes('1\u00a0694 чел.-ч')||
  scenarioLabor.includes('1\u202f694 чел.-ч')||
  scenarioLabor.includes('1694 чел.-ч'),'Accumulated labor remains fact; remaining days are forecast');
assert(scenarioLabor.includes('847 чел.-ч'));
assert(scenarioLabor.includes('Сценарный прогноз по выбранному методу'));
prefs.set('total_labor','auto');
prefs.set('sla','last-value');
const scenarioSla=passport.renderContent('sla',{snapshot,activeTab:'monitor'});
assert(scenarioSla.includes('Сценарный прогноз по выбранному методу'));
assert(scenarioSla.includes('2026-10'));
assert(scenarioSla.includes('90 %'));
assert.equal(snapshot.results.sla.value,90);
prefs.set('sla','auto');
for(const id of catalog.list({calculationState:'not-implemented'}).map(x=>x.id))
  assert(!passport.renderContent(id,{snapshot}).includes('kpiPassportForecastMethod'),
    id+' must not permit nonexistent forecasts');

// Verify delegated binding accepts only methods permitted by its KPI and
// invokes page/modal refresh, while not altering immutable Snapshot.
const handlers={},host={
  addEventListener:(type,handler)=>{handlers[type]=handler;},
  contains:()=>true
};
const refreshed=[];
passport.bindTabs(host,()=>{},id=>refreshed.push(id));
const control={
  value:'last-value',dataset:{kpiPassportForecast:'vbr'},
  closest:selector=>selector==='[data-kpi-passport-forecast]'?control:null
};
handlers.change({target:control});
assert.equal(prefs.get('vbr'),'last-value');
assert.deepEqual(refreshed,['vbr']);
control.value='invalid-model';
handlers.change({target:control});
assert.equal(control.value,'last-value');
assert.deepEqual(refreshed,['vbr']);
control.value='auto';handlers.change({target:control});
assert.equal(prefs.get('vbr'),null);

// Modal graph derives its model from the SAME preference state on opening;
// operational INC/labor are separate from the currently displayed KPI.
const scope={
  console,Intl,Math,Date,Number,Object,Array,Set,Map,JSON,
  ReclassifierKpiForecastEngine:engine,ReclassifierKpiCatalog:catalog,
  ReclassifierKpiChartViewModel:{
    project:({series})=>({points:series.points,window:1})
  },
  escapeHtml:value=>String(value??'').replace(/[&<>"']/g,ch=>({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&#39;'
  })[ch]),
  document:{getElementById:()=>({clientWidth:980})}
};
const chart=vm.runInNewContext(fs.readFileSync(
  'src/js/app/reliability_dashboard.js','utf8')+'\n'+
  fs.readFileSync('src/js/app/reliability_kpi_chart.js','utf8')+
  '\n;({state:reliabilityKpiChartUiState,selected:kpiChartSelectedMethod,render:renderKpiChartModalBody})',
  scope,{filename:'reliability_kpi_chart.js'});
prefs.set('vbr','observed-run-rate','passport');
chart.state.kpiId='vbr';chart.state.metric='kpi';
assert.equal(chart.selected(chart.state),'observed-run-rate');
chart.state.metric='inc';
assert.equal(chart.selected(chart.state),null);
prefs.set('inc','last-value','chart');
assert.equal(chart.selected(chart.state),'last-value');
chart.state.metric='kpi';
assert.equal(chart.selected(chart.state),'observed-run-rate');
prefs.set('total_labor','observed-run-rate','passport');
chart.state.kpiId='total_labor';
assert.equal(chart.selected(chart.state),'observed-run-rate');
chart.state.data={
  selectedMonth:'2026-09',availableFrom:'2026-08',availableTo:'2026-09',
  mineOptions:[],series:[{id:'all:mounted',mineId:'all',mineLabel:'Все',
    equipmentClass:'mounted',equipmentLabel:'Навесное',
    points:[{period:'2026-08',value:750,dataState:'available'},
      {period:'2026-09',value:847,dataState:'available'}],forecast:null}]
};
chart.state.mineIds=['all'];chart.state.classes=['mounted'];
chart.state.window=1;chart.state.range='1y';chart.state.scale='month';
chart.state.equipmentNames=[];chart.state.operational=null;
const chartHtml=chart.render();
assert(chartHtml.includes('id="reliabilityKpiForecastMethod"'));
assert(chartHtml.includes('value="observed-run-rate" selected'));
assert(chartHtml.includes('id="reliabilityKpiChartPlus"'));
assert(!chartHtml.includes('class="reliability-chart-forecast-ghost"'));
for(const id of ['vbr','sla','total_labor','inc'])prefs.set(id,'auto');
assert.equal(JSON.stringify(snapshot),fingerprint);
console.log('PR-5: shared preferences, coherent chart/passport method, numeric scenario, immutable fact/snapshot, validation and baseline visuals OK');
