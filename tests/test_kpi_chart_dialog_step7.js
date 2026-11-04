// Chart modal PR 2: independent multi-series controls, SVG and keyboard-focus lifecycle.
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
class FakeNode{
 constructor(id){this.id=id;this.listeners={};this.innerHTML='';this.textContent='';
  this.open=false;this.focusCount=0;this.isConnected=true;}
 addEventListener(type,fn){(this.listeners[type]||=[]).push(fn);}
 emit(type,event={}){for(const fn of this.listeners[type]||[])fn({target:this,...event});}
 showModal(){this.open=true;}close(){this.open=false;this.emit('close');}
 focus(){this.focusCount++;}
}
const nodes=new Map(),getNode=id=>{
 if(!nodes.has(id))nodes.set(id,new FakeNode(id));return nodes.get(id);
};
// The period slider must not reference a particular KPI in its labels.
assert(!fs.readFileSync('src/js/app/reliability_kpi_chart.js','utf8').includes('Период ВБР'));
assert(fs.readFileSync('src/js/app/reliability_kpi_chart.js','utf8').includes('renderKpiMonthRange'));
const mineOptions=[{id:'Октябрьский',label:'р. Октябрьский'},{id:'Таймырский',label:'р. Таймырский'},
 {id:'Северный',label:'р. Северный'},{id:'zf',label:'ЗФ'},{id:'all',label:'Все'}];
let calls=0;const projections=[];const fetchOptions=[];const summaryIntervals=[];let summaries=0;
const apiMock={
 buildKpiChartMultiData:(kpiId,filters,mineIds,classes,options)=>{
  fetchOptions.push({...options});
  calls++;assert.equal(filters.equipmentClass,'all');
  return {kpiId,selectedMonth:options?.range==='custom'?options.toMonth:'2026-10',availableFrom:'2026-05',availableTo:'2026-10',mineOptions,selectedMines:mineIds,
   reportingCoverage:{reportMonth:'2026-10',reportMonthStatus:'incomplete'},
   selectedClasses:classes,equipmentNameOptions:[{id:'БКМ',label:'БКМ'},{id:'СВР',label:'СВР'}],series:mineIds.flatMap(mineId=>classes.map(equipmentClass=>({
    id:mineId+':'+equipmentClass,mineId,mineLabel:mineId,
    equipmentClass,equipmentLabel:equipmentClass==='mounted'?'Навесное':'Стационарное',
    kpiId,points:[{period:'2026-08',value:90},{period:'2026-09',value:null},
      {period:'2026-10',value:80}]
   })))};
 },
 buildOperationalChartData:(metric,scale,filters,mines,classes,options)=>({
   metric,scale,unit:metric==='inc'?'шт':'чел.-ч',
   label:metric==='inc'?'Завершённые INC':'Фактические трудозатраты',
   truncated:false,
   series:mines.flatMap(mineId=>classes.map(equipmentClass=>({
     id:mineId+':'+equipmentClass,mineId,mineLabel:mineId,
     equipmentClass,equipmentLabel:equipmentClass==='mounted'?'Навесное':'Стационарное',
     points:[
       {period:scale==='day'?'2026-10-04':scale==='week'?'2026-09-28':'2026-09',value:2,rollingValue:null},
       {period:scale==='day'?'2026-10-05':scale==='week'?'2026-10-05':'2026-10',value:4,rollingValue:3}
     ]
   })))
 }),
 buildKpiSelectionSummary:(kpiId,filters,mines,classes,interval)=>{
   summaries++;
   summaryIntervals.push({...interval});
   const count=(Number(interval.toMonth.slice(0,4))-Number(interval.fromMonth.slice(0,4)))*12+
     Number(interval.toMonth.slice(5,7))-Number(interval.fromMonth.slice(5,7))+1;
   if(kpiId==='ktg'){
     const values={calendarHours:12000,incidentHours:1472,actualMaintenanceHours:453,
       plannedMaintenanceHours:453,unplannedMaintenanceHours:0,
       otherHours:0,availableHours:11547,productiveHours:10075};
     return {kpiId,fromMonth:interval.fromMonth,toMonth:interval.toMonth,
       result:{dataState:'available',value:10075/11547*100,components:values}};
   }
   const baseline=100,failures=20,exposure=baseline*count;
   return {kpiId,fromMonth:interval.fromMonth,toMonth:interval.toMonth,
     result:{dataState:'available',value:(1-failures/exposure)*100,
       components:{failureCount:failures,equipmentCount:exposure},
       diagnostics:{reportingMonths:count,baselineEquipmentCount:baseline}}};
 }
};
const view={project:params=>{
 projections.push(params);
 return {kpiId:params.kpiId,window:params.window,range:params.range,
  points:[{period:'2026-08',value:90,rollingValue:null},
   {period:'2026-09',value:null,rollingValue:null},
   {period:'2026-10',value:80,rollingValue:params.window>1?85:null}],
  hasData:true};
}};
const scope={console,Intl,escapeHtml:esc,document:{getElementById:getNode},
 ReclassifierReliabilityReportService:apiMock,
 ReclassifierKpiChartViewModel:view,
 ReclassifierKpiCatalog:{get:id=>({id,definition:{title:id,unit:'%'}})}};
const dashboardSource=fs.readFileSync('src/js/app/reliability_dashboard.js','utf8');
const source=fs.readFileSync('src/js/app/reliability_kpi_chart.js','utf8');
const app=vm.runInNewContext(dashboardSource+'\n'+source+
 '\n;({bindReliabilityKpiChartDialog,kpiChartSvgSegments,kpiChartSvgMulti,reliabilityKpiChartUiState,renderReliabilityKpiCard,renderKpiFormulaTiles,renderReliabilityLineChart})',scope);
app.bindReliabilityKpiChartDialog({kpiGroups:{dataQuality:[{id:'sla',title:'SLA'},
  {id:'classification_quality',title:'Общее качество классификации'},
  {id:'classification_quality_cgps',title:'Качество классификации ЦГПС'}],
 technicalReliability:[{id:'vbr',title:'ВБР'},{id:'ktg',title:'КТГ'}],organizationalReadiness:[]},labor:{summaryKpis:[]},problemManagement:{summaryKpis:[]}});
const button=getNode('reliabilityKpiChartOpen_sla'),close=getNode('reliabilityKpiChartClose');
const dialog=getNode('reliabilityKpiChartDialog'),body=getNode('reliabilityKpiChartBody');
body.clientWidth=1120;
const responsiveSvg=app.kpiChartSvgMulti([{
  series:{id:'all:stationary',mineId:'all',equipmentClass:'stationary',
    mineLabel:'Все',equipmentLabel:'Стационарное'},
  view:{window:1,points:[{period:'2026-01',value:95,rollingValue:null},
    {period:'2026-02',value:96,rollingValue:null}]}
}],'%', 'ВБР');
assert.match(responsiveSvg,/viewBox="0 0 1040 324"/,
  'SVG should use the available modal width rather than fixed 812px');
assert.match(responsiveSvg,/x2="1016"/,
  'right grid edge should occupy the available modal plot width');

button.emit('click');
assert.equal(calls,1);assert(dialog.open);
assert.equal(app.reliabilityKpiChartUiState.window,1);
assert.equal(app.reliabilityKpiChartUiState.range,'1y');
assert.equal(app.reliabilityKpiChartUiState.classes.length,2);
assert.match(body.innerHTML,/data-kpi-chart-mine="all"/);
assert.match(body.innerHTML,/data-kpi-chart-mine="zf"/);
assert.match(body.innerHTML,/data-kpi-chart-range="1m"/);
assert.match(body.innerHTML,/data-kpi-chart-range="3m"/);
assert.match(body.innerHTML,/data-kpi-chart-range="1y"/);
assert.match(body.innerHTML,/data-kpi-chart-range="all"/);
assert.match(body.innerHTML,/Скользящий тренд/);
assert.match(body.innerHTML,/Доступна статистика с 2026-05 по 2026-10/);
assert.match(body.innerHTML,/stroke="#2868ae"/);
assert.match(body.innerHTML,/stroke="#207c5e"/);
assert.doesNotMatch(body.innerHTML,/stroke-dasharray=/);
assert.match(body.innerHTML,/>авг<|>окт</);
assert.match(body.innerHTML,/reliabilityKpiChartValues/);
assert.doesNotMatch(body.innerHTML,/Сравнение по рудникам|Шаг шкалы|reliabilityKpiChartMine/);
assert.match(body.innerHTML,/Состав расчёта/);
assert.match(body.innerHTML,/reliabilityKpiFormulaSeries/);
assert.match(body.innerHTML,/reliabilityKpiFormulaMonth/);
assert.match(body.innerHTML,/За выбранный месяц расчёт недоступен/);
const detail=(id,components,value=95)=>[{
 series:{id:'all:stationary',mineLabel:'Все',equipmentLabel:'Стационарное',
   points:[{period:'2026-10',value,components,dataState:'available'}]},
 view:{points:[{period:'2026-10',value}]}
}];
app.reliabilityKpiChartUiState.detailSeriesId=null;
app.reliabilityKpiChartUiState.detailMonth=null;
app.reliabilityKpiChartUiState.summary=apiMock.buildKpiSelectionSummary('vbr',{},['all'],['stationary'],{fromMonth:'2026-08',toMonth:'2026-10'});
const vbr=app.renderKpiFormulaTiles(detail('vbr',{equipmentCount:100,failureCount:5}),'vbr','%');
assert.match(vbr,/Состав расчёта · ВБР/);
assert.match(vbr,/Оборудование/);
assert.match(vbr,/Отказы/);
assert.match(vbr,/100/);
assert.match(vbr,/93,3 %/);
assert.match(vbr,/Месяцев/);
assert.match(vbr,/Фонд наблюдения/);
assert.match(vbr,/300/);
assert.doesNotMatch(vbr,/reliabilityKpiFormulaSeries|reliabilityKpiFormulaMonth/);
assert.match(vbr,/reliability-formula-fraction/);
assert.match(vbr,/Drivers/);
app.reliabilityKpiChartUiState.summary={
  fromMonth:'2025-12',toMonth:'2026-03',
  result:{dataState:'available',reason:'partial-coverage',value:98,
    components:{failureCount:4,equipmentCount:200},
    diagnostics:{reportingMonths:2,baselineEquipmentCount:100,
      observedMonths:['2026-01','2026-03'],missingItsmMonths:['2025-12','2026-02'],
      requestedMonthCount:4,partialCoverage:true}}
};
const provisionalVbr=app.renderKpiFormulaTiles(detail('vbr',{
  equipmentCount:200,failureCount:4
}),'vbr','%');
assert.match(provisionalVbr,/Расчёт по неполному периоду/);
assert.match(provisionalVbr,/дек 2025/);
assert.match(provisionalVbr,/фев 2026/);
assert.match(provisionalVbr,/янв 2026/);
assert.match(provisionalVbr,/Месяцев/);
assert.match(provisionalVbr,/Фонд наблюдения/);
assert.match(provisionalVbr,/reliability-formula-fraction/);
const noObservedVbr={
  result:{dataState:'no-data',reason:'itsm-period-without-observations',
    components:{failureCount:0,equipmentCount:0},
    diagnostics:{missingItsmMonths:['2025-12'],reportingMonths:0,
      observedMonths:[],baselineEquipmentCount:100}}
};
app.reliabilityKpiChartUiState.summary=noObservedVbr;
assert.match(app.renderKpiFormulaTiles([], 'vbr','%'),/Нет ни одного месяца/);

app.reliabilityKpiChartUiState.detailSeriesId=null;
app.reliabilityKpiChartUiState.detailMonth=null;
app.reliabilityKpiChartUiState.summary=apiMock.buildKpiSelectionSummary('ktg',{},['all'],['stationary'],{fromMonth:'2026-10',toMonth:'2026-10'});
const ktg=app.renderKpiFormulaTiles(detail('ktg',{
 calendarHours:12000,incidentHours:1472,actualMaintenanceHours:453,
 otherHours:0,plannedMaintenanceHours:453,unplannedMaintenanceHours:0,
 availableHours:11547,productiveHours:10075
},10075/11547*100),'ktg','%');
assert.match(ktg,/КФРВ/);
assert.match(ktg,/ТО факт/);
assert.match(ktg,/ТО план/);
assert.match(ktg,/Прочее/);
assert.match(ktg,/ДФРВ/);
assert.match(ktg,/11.?547/);
assert.match(ktg,/87,3 %/);
assert.match(ktg,/предбэклога/);
assert.match(ktg,/INC/);
assert.match(ktg,/ТО внеплановое/);
assert.doesNotMatch(ktg,/reliabilityKpiFormulaSeries|reliabilityKpiFormulaMonth/);
app.reliabilityKpiChartUiState.summary={
  fromMonth:'2025-12',toMonth:'2026-09',
  result:{
    dataState:'available',reason:'partial-coverage',
    value:10075/11547*100,
    components:{
      calendarHours:12000,incidentHours:1472,actualMaintenanceHours:453,
      plannedMaintenanceHours:453,unplannedMaintenanceHours:0,otherHours:0,
      availableHours:11547,productiveHours:10075
    },
    diagnostics:{
      missingItsmMonths:['2025-12'],
      reportMonths:['2026-01','2026-02','2026-03'],
      selectedUnfinishedRows:3,selectedUnknownDurationRows:1,
      partialCoverage:true
    }
  }
};
const partialKtg=app.renderKpiFormulaTiles([], 'ktg', '%');
assert.match(partialKtg,/Расчёт предварительный/);
assert.match(partialKtg,/дек 2025/);
assert.match(partialKtg,/Фактически рассчитанные месяцы/);
assert.match(partialKtg,/3\s+незавершённых/);
assert.match(partialKtg,/1\s+записей с некорректными часами/);
assert.match(partialKtg,/reliability-formula-fraction/);

app.reliabilityKpiChartUiState.detailSeriesId=null;
app.reliabilityKpiChartUiState.detailMonth=null;
app.reliabilityKpiChartUiState.summary={result:{dataState:'no-data',reason:'source-missing'}};
const missing=app.renderKpiFormulaTiles([{
 series:{id:'all:mounted',mineLabel:'Все',equipmentLabel:'Навесное',
   points:[{period:'2026-10',value:null,components:{},dataState:'no-data',reason:'source-missing'}]},
 view:{points:[{period:'2026-10',value:null}]}
}],'vbr','%');
assert.match(missing,/Расчёт за выбранный период недоступен/);
assert.match(missing,/Не загружены необходимые источники/);
assert.doesNotMatch(missing,/reliability-formula-tile/);
body.emit('change',{target:{id:'reliabilityKpiFormulaMonth',value:'2026-08'}});
assert.equal(app.reliabilityKpiChartUiState.detailMonth,'2026-08');
assert.equal(calls,1,'Changing displayed component month cannot trigger new source reads.');
body.emit('change',{target:{id:'reliabilityKpiFormulaSeries',value:'all:mounted'}});
assert.equal(app.reliabilityKpiChartUiState.detailSeriesId,'all:mounted');

const click=dataset=>body.emit('click',{target:{closest:()=>({dataset})}});
click({kpiChartRange:'3m'});
assert.equal(projections.at(-1).range,'3m');assert.equal(calls,2);
assert.equal(fetchOptions.at(-1).range,'3m');
body.emit('click',{target:{id:'reliabilityKpiChartPlus',closest:()=>null}});
assert.equal(app.reliabilityKpiChartUiState.window,2);assert.equal(calls,3);
assert.equal(fetchOptions.at(-1).window,2);
body.emit('click',{target:{id:'reliabilityKpiChartMinus',closest:()=>null}});
assert.equal(app.reliabilityKpiChartUiState.window,1);assert.equal(calls,4);
click({kpiChartMine:'Таймырский'});
assert.equal(calls,5);
assert.equal(app.reliabilityKpiChartUiState.mineIds.join(','),'Таймырский');
click({kpiChartMine:'Октябрьский'});
assert.equal(calls,6);
assert.equal(app.reliabilityKpiChartUiState.mineIds.length,2);
click({kpiChartClass:'mounted'});
assert.equal(calls,7);
assert.equal(app.reliabilityKpiChartUiState.classes.join(','),'stationary');
click({kpiChartClass:'mounted'});
assert.equal(calls,8);
assert.equal(app.reliabilityKpiChartUiState.classes.length,2);
dialog.close();assert.equal(button.focusCount,1);
button.emit('click');close.emit('click');assert.equal(button.focusCount,2);
const ktgButton=getNode('reliabilityKpiChartOpen_ktg');
ktgButton.emit('click');
assert.match(body.innerHTML,/Состав расчёта · КТГ/);
assert.match(body.innerHTML,/INC/);
assert.match(body.innerHTML,/1.?472 ч/);
assert.doesNotMatch(body.innerHTML,/reliabilityKpiFormulaSeries|reliabilityKpiFormulaMonth/);
assert.match(body.innerHTML,/reliabilityVbrFrom/);
const ktgSummaryCalls=summaries;
body.emit('change',{target:{id:'reliabilityVbrFrom',value:'3'}});
assert(summaries>ktgSummaryCalls);
const ktgError=app.reliabilityKpiChartUiState.summary;
app.reliabilityKpiChartUiState.summary={result:{dataState:'insufficient',reason:'request-duration-incomplete'}};
assert.match(app.renderKpiFormulaTiles([], 'ktg','%'),/некорректное время предбэклога/);
app.reliabilityKpiChartUiState.summary=ktgError;
dialog.close();
const vbrButton=getNode('reliabilityKpiChartOpen_vbr');
vbrButton.emit('click');
assert.match(body.innerHTML,/reliabilityVbrFrom/);
assert.match(body.innerHTML,/reliabilityVbrTo/);
assert.match(body.innerHTML,/Состав расчёта · ВБР/);
assert.match(body.innerHTML,/Прогноз KPI пока недоступен/);
assert.match(body.innerHTML,/Последний отображаемый процент — промежуточное значение/);
assert.match(body.innerHTML,/reliabilityKpiForecastMethod/);
body.emit('change',{target:{id:'reliabilityKpiForecastMethod',value:'last-value'}});
assert.equal(app.reliabilityKpiChartUiState.forecastMethod,'last-value');
assert.equal(fetchOptions.at(-1).forecastMethodId,'last-value');
assert.match(body.innerHTML,/option value="last-value" selected/);
assert.match(body.innerHTML,/96,7 %/);
assert.doesNotMatch(body.innerHTML,/reliabilityKpiFormulaSeries|reliabilityKpiFormulaMonth/);
const initialSummaries=summaries;
body.emit('change',{target:{id:'reliabilityKpiChartValues',checked:true}});
assert.match(body.innerHTML,/90,0%/);
assert.equal(summaries,initialSummaries,'Graph value labels must not recalculate VBR.');
body.emit('change',{target:{id:'reliabilityVbrFrom',value:'3'}});
assert.equal(app.reliabilityKpiChartUiState.fromMonth,'2026-08');
assert.equal(app.reliabilityKpiChartUiState.range,'custom');
assert.equal(fetchOptions.at(-1).range,'custom');
assert.match(body.innerHTML,/Оборудование/);
const sumAfterFrom=summaries;
body.emit('change',{target:{id:'reliabilityVbrTo',value:'4'}});
assert.equal(app.reliabilityKpiChartUiState.toMonth,'2026-09');
assert.equal(app.reliabilityKpiChartUiState.summary.result.diagnostics.reportingMonths,2);
assert(summaries>sumAfterFrom);
assert.match(body.innerHTML,/Наименование оборудования/);
assert.match(body.innerHTML,/data-kpi-chart-equipment-name="БКМ"/);
assert.doesNotMatch(body.innerHTML,/Скользящий тренд выключен/);
assert.doesNotMatch(body.innerHTML,/Показан период:/);
assert.match(body.innerHTML,/reliability-chart-multi-legend/);
click({kpiChartEquipmentName:'БКМ'});
assert.deepEqual(Array.from(app.reliabilityKpiChartUiState.equipmentNames),['БКМ']);
assert.equal(fetchOptions.at(-1).equipmentNames[0],'БКМ');
assert.equal(summaryIntervals.at(-1).equipmentNames[0],'БКМ');
assert.match(body.innerHTML,/data-kpi-chart-equipment-name="БКМ" class="active" aria-pressed="true"/);
assert.match(body.innerHTML,/Состав расчёта · ВБР/);
click({kpiChartEquipmentName:'СВР'});
assert.equal(app.reliabilityKpiChartUiState.equipmentNames.length,2);
assert.deepEqual(Array.from(summaryIntervals.at(-1).equipmentNames),['БКМ','СВР']);
assert.match(body.innerHTML,/data-kpi-chart-equipment-name="СВР" class="active" aria-pressed="true"/);
click({kpiChartEquipmentNameAll:'true'});
assert.equal(app.reliabilityKpiChartUiState.equipmentNames.length,0);
assert.deepEqual(Array.from(summaryIntervals.at(-1).equipmentNames),[]);
assert.match(body.innerHTML,/data-kpi-chart-equipment-name-all="true" class="active"/);
dialog.close();

// Regression: name choices have always been VBR/KTG clickable, but for
// classification quality they were rendered as inert buttons. Exercise
// the SAME delegated click handler for both quality metrics.
for(const id of ['classification_quality','classification_quality_cgps']){
  const trigger=getNode('reliabilityKpiChartOpen_'+id);
  const previousCalls=calls;
  trigger.emit('click');
  assert(dialog.open);
  assert.equal(app.reliabilityKpiChartUiState.kpiId,id);
  assert(calls>previousCalls);
  assert.match(body.innerHTML,/data-kpi-chart-equipment-name="БКМ"/);
  const before=fetchOptions.length;
  click({kpiChartEquipmentName:'БКМ'});
  assert.equal(fetchOptions.length,before+1,'Selection must request a recalculated quality series');
  assert.deepEqual(Array.from(app.reliabilityKpiChartUiState.equipmentNames),['БКМ']);
  assert.deepEqual(Array.from(fetchOptions.at(-1).equipmentNames),['БКМ']);
  assert.match(body.innerHTML,/data-kpi-chart-equipment-name="БКМ" class="active" aria-pressed="true"/);
  click({kpiChartEquipmentName:'СВР'});
  assert.deepEqual(Array.from(fetchOptions.at(-1).equipmentNames),['БКМ','СВР']);
  assert.match(body.innerHTML,/data-kpi-chart-equipment-name="СВР" class="active" aria-pressed="true"/);
  click({kpiChartEquipmentNameAll:'true'});
  assert.deepEqual(Array.from(fetchOptions.at(-1).equipmentNames),[]);
  assert.match(body.innerHTML,/data-kpi-chart-equipment-name-all="true" class="active"/);
  dialog.close();
}
const markup=app.renderReliabilityKpiCard({id:'sla',title:'SLA',unit:'%',
 value:90,dataStatus:'calculated',dataState:'available'});
assert.match(markup,/data-kpi-chart-open="sla"/);
const segments=app.kpiChartSvgSegments([{value:90},{value:null},{value:80}],
 'value',0,100,{left:0,top:0,width:100,height:100});
assert.equal(segments.length,2,'Never connect lines across missing months.');
// PR7: the existing SVG modal offers D / Н / М for operational counts
// and labor-hours only. Month-only KPI formulas and original SVG remain intact.
vbrButton.emit('click');
assert.match(body.innerHTML,/data-kpi-chart-metric="inc"/);
assert.match(body.innerHTML,/data-kpi-chart-metric="labor"/);
assert.match(body.innerHTML,/data-kpi-chart-scale="day"/);
assert.match(body.innerHTML,/data-kpi-chart-scale="week"/);
assert.match(body.innerHTML,/data-kpi-chart-scale="month"/);
assert.match(body.innerHTML,/disabled title="Коэффициенты KPI рассчитываются только по месяцам"/);
click({kpiChartMetric:'inc'});
assert.equal(app.reliabilityKpiChartUiState.metric,'inc');
assert.equal(app.reliabilityKpiChartUiState.scale,'month');
assert.match(body.innerHTML,/Операционные данные:/);
assert.match(body.innerHTML,/Завершённые INC/);
assert.match(body.innerHTML,/Вводить или подтверждать даты выгрузки вручную не требуется/);
assert.match(body.innerHTML,/Прогноз не показан/);
assert.doesNotMatch(body.innerHTML,/Состав расчёта · ВБР/);
click({kpiChartScale:'day'});
assert.equal(app.reliabilityKpiChartUiState.scale,'day');
assert.match(body.innerHTML,/>04\.10<|>05\.10</);
click({kpiChartScale:'week'});
assert.equal(app.reliabilityKpiChartUiState.scale,'week');
assert.match(body.innerHTML,/н\. 05\.10/);
click({kpiChartScale:'month'});
assert.equal(app.reliabilityKpiChartUiState.scale,'month');
assert.match(body.innerHTML,/reliabilityKpiForecastMethod/);
assert.match(body.innerHTML,/Прогноз не показан/);
assert.match(body.innerHTML,/Вводить или подтверждать даты выгрузки вручную не требуется/);
body.emit('change',{target:{id:'reliabilityKpiForecastMethod',value:'observed-run-rate'}});
assert.equal(app.reliabilityKpiChartUiState.forecastMethod,'observed-run-rate');
assert.match(body.innerHTML,/option value="observed-run-rate" selected/);
click({kpiChartMetric:'labor'});
assert.equal(app.reliabilityKpiChartUiState.metric,'labor');
assert.equal(app.reliabilityKpiChartUiState.scale,'month',
  'Changing operating metric must preserve selected monthly scale');
assert.match(body.innerHTML,/Мобильные бригады/);
assert.match(body.innerHTML,/Вводить или подтверждать даты выгрузки вручную не требуется/);
assert.match(body.innerHTML,/Прогноз не показан/);
click({kpiChartMetric:'kpi'});
assert.equal(app.reliabilityKpiChartUiState.scale,'month');
assert.match(body.innerHTML,/Состав расчёта · ВБР/);
assert.doesNotMatch(body.innerHTML,/stroke-dasharray=/);
dialog.close();
// PR9: a nowcast is at the SAME monthly X coordinate, never in the next month.
// A mismatched source horizon or observed value must not render a ghost.
const historical=[{period:'2026-09',value:90,rollingValue:null},
  {period:'2026-10',value:80,rollingValue:null}];
const ghostForecast={forecastType:'reporting-month-nowcast',dataState:'available',
  value:76,observedValue:80,horizon:'2026-10',
  methodId:'monthly-components-remaining-days',
  quality:{historicalMonths:9,validationMonths:2},
  methodComponents:{failureCount:{methodId:'linear-trend'}},
  caveats:['Используется текущий Drivers']};
const ghostView={series:{id:'all:mounted',mineId:'all',mineLabel:'Все',
 equipmentClass:'mounted',equipmentLabel:'Навесное',forecast:ghostForecast},
 view:{window:1,points:historical}};
const chartWithGhost=app.kpiChartSvgMulti([ghostView],'%','ВБР');
assert.match(chartWithGhost,/class="reliability-chart-forecast-ghost"/);
assert.match(chartWithGhost,/stroke-dasharray="5 4"/);
assert.match(chartWithGhost,/2026-10: прогноз итога/);
assert.match(chartWithGhost,/Пунктирный последний участок/);
assert.equal((chartWithGhost.match(/data-kpi-chart-point-series=/g)||[]).length,1,
 'Incomplete-month percentage is not displayed as a factual marker');
const chartBadHorizon=app.kpiChartSvgMulti([{...ghostView,
 series:{...ghostView.series,forecast:{...ghostForecast,horizon:'2026-11'}}}],'%','ВБР');
assert.doesNotMatch(chartBadHorizon,/reliability-chart-forecast-ghost/);
assert.doesNotMatch(chartBadHorizon,/stroke-dasharray=/);
const chartBadValue=app.kpiChartSvgMulti([{...ghostView,
 series:{...ghostView.series,forecast:{...ghostForecast,observedValue:81}}}],'%','ВБР');
assert.doesNotMatch(chartBadValue,/reliability-chart-forecast-ghost/);
const disabledForecast=app.kpiChartSvgMulti([{...ghostView,
 series:{...ghostView.series,forecast:{...ghostForecast,dataState:'insufficient',value:null}}}],'%','ВБР');
assert.doesNotMatch(disabledForecast,/reliability-chart-forecast-ghost/);
const operationalNoForecast=app.kpiChartSvgMulti([{
 series:{...ghostView.series,forecast:null},view:ghostView.view
}],'чел.-ч','Трудозатраты','day');
assert.doesNotMatch(operationalNoForecast,/stroke-dasharray=/);
const overview=app.renderReliabilityLineChart({
 id:'vbr-dynamics',title:'ВБР',description:'Источник: ITSM',minValue:0,maxValue:100,
 points:[{period:'2026-09',label:'сен',value:90},
   {period:'2026-10',label:'окт',value:80}],forecast:ghostForecast
});
assert.match(overview,/class="reliability-chart-forecast-ghost"/);
assert.match(overview,/stroke-dasharray="5 4"/);
assert.match(overview,/Фактический ВБР сохранён в данных и подсказке/);
const overviewPast=app.renderReliabilityLineChart({
 id:'vbr-dynamics',title:'ВБР',description:'Источник: ITSM',minValue:0,maxValue:100,
 points:[{period:'2026-09',label:'сен',value:90},
   {period:'2026-10',label:'окт',value:80}],
 forecast:{...ghostForecast,horizon:'2026-11'}
});
assert.doesNotMatch(overviewPast,/reliability-chart-forecast-ghost/);
console.log('KPI multi-series modal: mines, classes, viewport, moving trend, SVG, focus OK');
