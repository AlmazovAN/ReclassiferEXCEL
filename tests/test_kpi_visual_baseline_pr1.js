// PR-1: lock existing line chart semantics and PDF projection before KPI Definition V2.
// Assertions describe the CURRENT UI, not a proposed chart redesign.
'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const escapeHtml=value=>String(value??'').replace(/[&<>"]/g,ch=>({
  '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'
})[ch]);
const scope=vm.createContext({
  document:{getElementById:()=>({clientWidth:980})},
  escapeHtml,Intl,Date,Math,Number,Object,Array,Set,Map,JSON,console
});
for(const file of ['src/js/app/reliability_dashboard.js',
    'src/js/app/reliability_kpi_chart.js']){
  vm.runInContext(fs.readFileSync(path.resolve(__dirname,'..',file),'utf8'),
    scope,{filename:file});
}
vm.runInContext("reliabilityKpiChartUiState.kpiId='vbr'; reliabilityKpiChartUiState.mineIds=['all'];",scope);
const makeSeries=(equipmentClass,forecast,kpiId='vbr')=>({
  id:'all:'+equipmentClass,mineId:'all',mineLabel:'Все',
  equipmentClass,equipmentLabel:equipmentClass==='mounted'?'Навесное':'Стационарное',
  kpiId,forecast
});
const view=points=>({window:1,points});
const ratio={
  forecastType:'reporting-month-nowcast',dataState:'available',
  kpiId:'vbr',value:93.8,observedValue:97.1,
  horizon:'2026-09',coverageThrough:'2026-09-15',
  methodId:'linear-trend',methodVersion:'1.0.0',
  quality:{historicalMonths:8,validationMonths:2},
  methodComponents:{failureCount:{methodId:'linear-trend'}}
};
const percentPoints=[
  {period:'2026-07',value:96,rollingValue:null},
  {period:'2026-08',value:95,rollingValue:null},
  {period:'2026-09',value:97.1,rollingValue:null}
];
const plot=(series,points,unit,scale='month')=>
  scope.kpiChartSvgMulti([{series,view:view(points)}],
    unit,'Динамика',scale);
const count=(text,pattern)=>(text.match(pattern)||[]).length;
const mounted=plot(makeSeries('mounted',ratio),percentPoints,'%');
assert(mounted.includes('stroke="#207c5e"'),'Mounted line color is a baseline');
assert(mounted.includes('data-forecast-kind="percentage"'));
assert(mounted.includes('stroke-dasharray="5 4"'));
assert.equal(count(mounted,/class="reliability-chart-forecast-segment"/g),1);
assert.equal(count(mounted,/class="reliability-chart-forecast-point"/g),1);
assert.equal(count(mounted,/data-kpi-chart-point-series=/g),2,
  'A partial observed percent is in the tooltip, not a separate visible last marker');
assert(mounted.includes('93,8 %'),'Percentage forecast is a visible separate value');
assert(mounted.includes('факт по 2026-09-15: 97,1 %'),
  'Observed unfinished-month percent remains available in forecast tooltip');
assert(mounted.includes('Прогноз не является фактом.'));
assert(!mounted.includes('class="reliability-chart-point-value"'),
  'Ordinary point labels remain off by default');

const stationary=plot(makeSeries('stationary',{...ratio,value:91.1}),
  [{period:'2026-07',value:93},{period:'2026-08',value:92},
   {period:'2026-09',value:97.1}].map(x=>({...x,rollingValue:null})),'%');
assert(stationary.includes('stroke="#2868ae"'),'Stationary color is a baseline');
assert(stationary.includes('data-forecast-kind="percentage"'));

// Absolute hours and incident COUNTS keep the final accumulated FACT as a
// visible, selectable point; their dotted extension ends at the month forecast.
const laborForecast={
  forecastType:'reporting-month-volume-nowcast',dataState:'available',
  metricId:'labor',value:1350,observedValue:847,
  horizon:'2026-09',coverageThrough:'2026-09-15',
  methodId:'last-value',methodVersion:'1.0.0',
  quality:{historicalMonths:1,validationMonths:0},
  methodComponents:{laborHours:{methodId:'last-value'}}
};
const absolutePoints=[
  {period:'2026-07',value:1297,rollingValue:null},
  {period:'2026-08',value:1253,rollingValue:null},
  {period:'2026-09',value:847,rollingValue:null}
];
const hours=plot(makeSeries('mounted',laborForecast,'labor'),
  absolutePoints,'чел.-ч');
assert(hours.includes('stroke="#207c5e"'));
assert(hours.includes('data-forecast-kind="absolute"'));
assert(hours.includes('stroke-dasharray="5 4"'));
assert.equal(count(hours,/data-kpi-chart-point-series=/g),3);
assert(hours.includes('847 чел.-ч'),'Final fact must be annotated without enabling all labels');
assert(hours.includes('class="reliability-chart-point-value"'));
assert(hours.includes('class="reliability-chart-forecast-value"'));
assert(hours.includes('1350')||/1[\s\u00a0\u202f]350/.test(hours));
assert(hours.includes('факт по 2026-09-15: 847 чел.-ч'));
const incForecast={...laborForecast,metricId:'inc',value:1600};
const inc=plot(makeSeries('stationary',incForecast,'inc'),absolutePoints,'шт');
assert(inc.includes('stroke="#2868ae"'));
assert(inc.includes('data-forecast-kind="absolute"'));
assert(inc.includes('847 шт'));
assert(inc.includes('1600 шт')||/1[\s\u00a0\u202f]600 шт/.test(inc));

// A forecast may appear only for the EXACT selected month, observed value,
// reporting-month type and monthly time resolution. No invented endpoints.
for(const bad of [
  null,
  {...laborForecast,dataState:'insufficient',value:null},
  {...laborForecast,observedValue:846},
  {...laborForecast,horizon:'2026-10'},
  {...laborForecast,forecastType:'future-month-forecast'}
]){
  const svg=plot(makeSeries('mounted',bad,'labor'),absolutePoints,'чел.-ч');
  assert(!svg.includes('reliability-chart-forecast-ghost'),
    'Unavailable, mismatched or non-nowcast forecasts must never draw dotted line');
}
for(const scale of ['day','week']){
  assert(!plot(makeSeries('mounted',laborForecast,'labor'),
    absolutePoints,'чел.-ч',scale).includes('reliability-chart-forecast-ghost'));
}
// Missing data is a break; the renderer must not bridge gaps or insert zeroes.
const gap=scope.kpiChartSvgSegments([
  {value:5},{value:null},{value:7}
],'value',0,10,{left:0,top:0,width:100,height:100});
assert.equal(gap.length,2);
assert(gap.every(segment=>segment.length===1));
assert(!plot(makeSeries('mounted',null,'labor'),
  absolutePoints,'чел.-ч').includes('stroke-dasharray="5 4"'));

// Existing report-card and PDF distinguish forecast from the immutable fact.
const overview=scope.renderReliabilityLineChart({
  id:'vbr',title:'ВБР',description:'ИТСМ',
  points:percentPoints.map(p=>({...p,label:p.period})),
  minValue:0,maxValue:100,forecast:ratio
});
assert(overview.includes('reliability-chart-forecast-ghost'));
assert(overview.includes('stroke-dasharray="5 4"'));
assert(overview.includes('Прогноз итога отчётного месяца'));
const pdf=require('../src/js/app/reliability_pdf.js');
const base={
  type:'reliability-report',status:'ready',
  calculatedAt:'2026-10-11T09:00:00.000Z',
  query:{period:{id:'2026-09',month:'2026-09',label:'Сен 2026'},
    mine:{id:'Северный',label:'Северный'},
    equipmentClass:{id:'mounted',label:'Навесное'}},
  results:{vbr:{id:'vbr',title:'ВБР',value:97.1,unit:'%',
    dataState:'available',components:{failureCount:29,equipmentCount:1000},
    formula:'(1 - FailureCount / EquipmentCount) × 100'}},
  series:{monthly:[]},sources:[],
  kpiView:{cards:{vbr:{forecast:ratio}}}
};
const immutable=JSON.stringify(base);
const plan=pdf.createPlan(base);
assert.equal(plan.results[0].value,97.1,'PDF must export fact, never replace it with forecast');
assert.equal(plan.forecastVbr.value,93.8);
assert.equal(plan.forecastVbr.observedValue,97.1);
assert.equal(pdf.snapshotFingerprint(base),plan.fingerprint);
assert.notEqual(pdf.snapshotFingerprint({...base,kpiView:{cards:{vbr:{
  forecast:{...ratio,value:92.8}}}}}),plan.fingerprint);
assert.equal(JSON.stringify(base),immutable,'PDF plan must not mutate snapshot');
console.log('PR-1 visualization baseline: exact SVG colors, fact markers, forecast dashes, labels, guards and PDF fact/forecast separation OK');
