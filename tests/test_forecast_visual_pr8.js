'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const context=vm.createContext({
  document:{getElementById:()=>({clientWidth:980})},
  escapeHtml:value=>String(value??'').replace(/[&<>"]/g,ch=>({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'
  })[ch]),
  Intl,Date,Math,Number,Object,Array,Set,Map,JSON,console
});
for(const file of ['src/js/app/reliability_dashboard.js',
  'src/js/app/reliability_kpi_chart.js']){
  vm.runInContext(fs.readFileSync(file,'utf8'),context,{filename:file});
}
const ratio={
  forecastType:'reporting-month-nowcast',dataState:'available',
  kpiId:'vbr',value:93.8,observedValue:97.1,
  horizon:'2026-09',coverageThrough:'2026-09-15',
  methodId:'linear-trend',methodVersion:'1.0.0',
  quality:{historicalMonths:8,validationMonths:2},
  methodComponents:{failureCount:{methodId:'linear-trend'}}
};
const monthly=[
  {period:'2026-07',value:96,rollingValue:null},
  {period:'2026-08',value:95,rollingValue:null},
  {period:'2026-09',value:97.1,rollingValue:null}
];
const series=(forecast,kpiId='vbr')=>({
  id:'all:mounted',mineId:'all',mineLabel:'Все',
  equipmentClass:'mounted',equipmentLabel:'Навесное',
  kpiId,forecast
});
const view=points=>({window:1,points});
const inspect=(forecast,points,unit,scale='month',id='vbr')=>
  context.kpiChartSvgMulti([{series:series(forecast,id),view:view(points)}],
    unit,'Динамика',scale);
vm.runInContext(
  "reliabilityKpiChartUiState.kpiId='vbr'; reliabilityKpiChartUiState.mineIds=['all'];",
  context
);
const percent=inspect(ratio,monthly,'%');
assert(percent.includes('data-forecast-kind="percentage"'));
assert(percent.includes('stroke-dasharray="5 4"'));
assert(percent.includes('93,8 %'));
assert(percent.includes('2026-09-15'));
assert.equal((percent.match(/data-kpi-chart-point-series=/g)||[]).length,2,
  'Partial observed percent must not appear as a separately visible/selectable point');
assert(percent.includes('вместо промежуточного процента'));
const percentageState=context.kpiChartForecastState(series(ratio),view(monthly),'%');
assert.equal(percentageState.kind,'percentage');
vm.runInContext("reliabilityKpiChartUiState.showPointValues=true;",context);
const percentLabels=inspect(ratio,monthly,'%');
assert.equal((percentLabels.match(/class="reliability-chart-point-value"/g)||[]).length,2);
assert(!percentLabels.includes('>97,1 %</text>'));
assert(percentLabels.includes('93,8 %'));
vm.runInContext("reliabilityKpiChartUiState.showPointValues=false;",context);
const noRatio=inspect(null,monthly,'%');
assert.equal((noRatio.match(/data-kpi-chart-point-series=/g)||[]).length,3);
assert(!noRatio.includes('reliability-chart-forecast-ghost'));

const volume={
  forecastType:'reporting-month-volume-nowcast',dataState:'available',
  metricId:'labor',value:1350,observedValue:847,
  horizon:'2026-09',coverageThrough:'2026-09-15',
  methodId:'last-value',methodVersion:'1.0.0',
  quality:{historicalMonths:1,validationMonths:0},
  methodComponents:{laborHours:{methodId:'last-value'}}
};
const hours=[
  {period:'2026-07',value:1297,rollingValue:null},
  {period:'2026-08',value:1253,rollingValue:null},
  {period:'2026-09',value:847,rollingValue:null}
];
const labor=inspect(volume,hours,'чел.-ч','month','labor');
assert(labor.includes('data-forecast-kind="absolute"'));
assert(labor.includes('stroke-dasharray="5 4"'));
assert(labor.includes('прогноз итога'));
assert(labor.includes('Факт')||labor.includes('факт'));
assert(labor.includes('847 чел.-ч'));
assert(labor.includes('1350')||/1[\s\u00a0\u202f]350/.test(labor));
assert.equal((labor.match(/data-kpi-chart-point-series=/g)||[]).length,3,
  'Absolute volume must preserve the selectable actual last-month point');
assert(labor.includes('class="reliability-chart-forecast-value"'));
assert(labor.includes('class="reliability-chart-point-value"'),
  'Final accumulated actual value is labelled even with general labels off');
const forecastState=context.kpiChartForecastState(series(volume,'labor'),
  view(hours),'чел.-ч');
assert.equal(forecastState.kind,'absolute');
assert.equal(forecastState.value,1350);
assert(!inspect({...volume,horizon:'2026-10'},hours,'чел.-ч','month','labor')
  .includes('reliability-chart-forecast-ghost'));
assert(!inspect({...volume,observedValue:846},hours,'чел.-ч','month','labor')
  .includes('reliability-chart-forecast-ghost'));
assert(!inspect({...volume,dataState:'insufficient',value:null},
  hours,'чел.-ч','month','labor').includes('reliability-chart-forecast-ghost'));
assert(!inspect(volume,hours,'чел.-ч','day','labor')
  .includes('reliability-chart-forecast-ghost'));
assert(!inspect(volume,hours,'чел.-ч','week','labor')
  .includes('reliability-chart-forecast-ghost'));
const inc={...volume,metricId:'inc',value:1350,unit:'шт'};
const qty=inspect(inc,hours,'шт','month','inc');
assert(qty.includes('data-forecast-kind="absolute"'));
assert(qty.includes('847 шт'));
assert(qty.includes('1350 шт')||/1[\s\u00a0\u202f]350 шт/.test(qty));
const graph=context.renderReliabilityLineChart({
  id:'vbr',title:'ВБР',description:'Источник ITSM',
  points:monthly.map(point=>({...point,label:point.period})),
  minValue:0,maxValue:100,forecast:ratio
});
assert.equal((graph.match(/class="reliability-chart-point series-1"/g)||[]).length,2);
assert(graph.includes('Прогноз итога отчётного месяца'));
assert(graph.includes('reliability-chart-forecast-ghost'));
assert(graph.includes('вместо промежуточного процента'));
const overviewNoForecast=context.renderReliabilityLineChart({
  id:'vbr',title:'ВБР',description:'Источник ITSM',
  points:monthly.map(point=>({...point,label:point.period})),
  minValue:0,maxValue:100,forecast:null
});
assert.equal((overviewNoForecast.match(/class="reliability-chart-point series-1"/g)||[]).length,3);
assert(!overviewNoForecast.includes('reliability-chart-forecast-ghost'));
const card=context.reliabilityForecastPresentation(volume,'чел.-ч');
assert.equal(card.ready,true);
assert.match(card.detail,/Факт 847 чел.-ч/);
assert.match(card.tooltip,/2026-09-15/);
const unconfirmedNotice=context.kpiChartOperationalForecastNotice({
  series:[{id:'all:mounted',forecast:{
    forecastType:'reporting-month-volume-nowcast',
    dataState:'insufficient',reason:'reporting-cutoff-unconfirmed',value:null
  }}]
},'month','labor');
assert(unconfirmedNotice.includes('Прогноз не показан'));
assert(unconfirmedNotice.includes('Полнота периода выгрузки не подтверждена'));
assert(unconfirmedNotice.includes('Вводить или подтверждать даты выгрузки вручную не требуется'));
assert(context.kpiChartOperationalForecastNotice({
  series:[{forecast:{dataState:'insufficient',
    reason:'insufficient-complete-history'}}]
},'month','inc').includes('Темп текущего месяца'));
assert(context.kpiChartOperationalForecastNotice({
  series:[{forecast:{dataState:'insufficient',reason:'report-month-complete'}}]
},'month','labor').includes('прогноз оставшихся дней не требуется'));
assert(!context.kpiChartOperationalForecastNotice({
  series:[{forecast:volume}]
},'month','labor'));
assert(context.kpiChartOperationalForecastNotice({},'day','labor')
  .includes('выберите детализацию «М»'));
assert(context.kpiChartOperationalForecastNotice({
  series:[{forecast:{dataState:'insufficient',
    reason:'reporting-cutoff-unconfirmed'}}]
},'month','inc').includes('Вводить или подтверждать даты выгрузки вручную не требуется'));
assert(context.kpiChartForecastReason({reason:'metric-source-coverage-mismatch'})
  .includes('Подтверждён другой источник'));

// PR-10: two percentage KPI chart slices must both project their final
// month as a dashed forecast, never as a certified observed endpoint.
const ktgForecast={...ratio,kpiId:'ktg',
  value:90.4,observedValue:92.1,
  methodComponents:{incidentHours:{methodId:'observed-run-rate'}}};
const kSeries=[
  {series:series(ratio,'vbr'),view:view(monthly)},
  {series:{...series(ktgForecast,'ktg'),id:'all:stationary',
    equipmentClass:'stationary',equipmentLabel:'Стационарное'},
   view:view(monthly.map((point,i)=>i===2?{...point,value:92.1}:
      {...point,value:point.value-2}))}
];
const combined=context.kpiChartSvgMulti(kSeries,'%','Показатель KPI','month');
assert.equal((combined.match(/data-forecast-kind="percentage"/g)||[]).length,2);
assert.equal((combined.match(/class="reliability-chart-forecast-segment"/g)||[]).length,2);
assert.equal((combined.match(/class="reliability-chart-forecast-value"/g)||[]).length,2);
assert.equal((combined.match(/data-kpi-chart-point-series=/g)||[]).length,4);
assert(combined.includes('opacity=".63"'));
const covered={kpiId:'vbr',reportingCoverage:{
  reportMonth:'2026-09',reportMonthStatus:'incomplete'
}};
const unavailableView=[{
  series:series({...ratio,value:null,dataState:'insufficient',
    reason:'invalid-current-component'},'vbr'),
  view:view(monthly)
}];
const noForecast=context.kpiChartPercentForecastNotice(covered,unavailableView);
assert(noForecast.includes('Прогноз KPI пока недоступен'));
assert(noForecast.includes('не итог месяца'));
assert(!context.kpiChartPercentForecastNotice({...covered,reportingCoverage:{
  reportMonth:'2026-09',reportMonthStatus:'complete'
}},unavailableView));
assert(!context.kpiChartPercentForecastNotice({...covered,reportingCoverage:{
  reportMonth:'2026-10',reportMonthStatus:'incomplete'
}},unavailableView));
assert(!context.kpiChartPercentForecastNotice(covered,kSeries));
console.log('PR-8 visuals: percent uses projected endpoint only; absolute INC/labor keeps actual + separate dashed forecast, guards and tooltips OK');
