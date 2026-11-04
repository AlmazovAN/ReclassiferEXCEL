'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.resolve(__dirname,'..');
const context=vm.createContext({
  document:{getElementById:()=>({clientWidth:1000})},
  escapeHtml:value=>String(value??'').replace(/[&<>"]/g,ch=>({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'
  })[ch]),
  Intl,Date,Math,Number,Object,Array,Set,Map,JSON,console
});
for(const file of ['src/js/app/reliability_dashboard.js','src/js/app/reliability_kpi_chart.js'])
  vm.runInContext(fs.readFileSync(path.join(root,file),'utf8'),context,{filename:file});
const forecast={
  forecastType:'reporting-month-nowcast',dataState:'available',kpiId:'vbr',
  value:93.8,observedValue:97.1,horizon:'2026-09',asOf:'2026-09-15',
  coverageThrough:'2026-09-15',methodId:'linear-trend',methodVersion:'1.0.0',
  methodComponents:{failureCount:{methodId:'linear-trend',methodVersion:'1.0.0'}},
  quality:{historicalMonths:8,validationMonths:2},caveats:[]
};
const points=[
  {period:'2026-07',label:'Июл',value:96},
  {period:'2026-08',label:'Авг',value:95},
  {period:'2026-09',label:'Сен',value:97.1}
];
const params={id:'vbr',title:'ВБР',description:'Показатели',points,
  minValue:0,maxValue:100,forecast};
const main=context.renderReliabilityLineChart(params);
assert(main.includes('reliability-chart-forecast-ghost'));
assert(main.includes('stroke-dasharray="5 4"'));
assert(main.includes('93,8 %'));
assert(main.includes('2026-09-15'));
assert(main.includes('Прогноз итога отчётного месяца'));
assert(main.includes('Пунктирный последний участок'));
assert(!context.renderReliabilityLineChart({...params,forecast:null})
  .includes('reliability-chart-forecast-ghost'));
assert(!context.renderReliabilityLineChart({...params,forecast:{...forecast,value:null}})
  .includes('reliability-chart-forecast-ghost'));
const presentation=context.reliabilityForecastPresentation(forecast,'%');
assert.equal(presentation.ready,true);
assert.match(presentation.detail,/2026-09.*не факт/);
assert.match(presentation.tooltip,/linear-trend/);
assert.equal(context.reliabilityForecastPresentation({...forecast,dataState:'insufficient'},'%').ready,false);
vm.runInContext("reliabilityKpiChartUiState.kpiId='vbr'; reliabilityKpiChartUiState.mineIds=['all'];",context);
const series={id:'all:mounted',mineId:'all',mineLabel:'Все',equipmentClass:'mounted',
  equipmentLabel:'Навесное',forecast};
const svg=context.kpiChartSvgMulti([{series,view:{points,window:1}}],'%','ВБР','month');
assert(svg.includes('reliability-chart-forecast-ghost'));
assert(svg.includes('stroke-dasharray="5 4"'));
assert(svg.includes('2026-09-15'));
assert(svg.includes('93,8 %'));
assert(svg.includes('Пунктирный последний участок'));
const missingSvg=context.kpiChartSvgMulti([{series:{...series,forecast:null},
  view:{points,window:1}}],'%','ВБР','month');
assert(!missingSvg.includes('reliability-chart-forecast-ghost'));
console.log('PR-4 web SVG forecast, card cutoff, dashed final endpoint and unavailable guards OK');
