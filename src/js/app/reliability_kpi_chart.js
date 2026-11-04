// FILE CONTRACT: native chart modal for independent mine × equipment-class KPI series.
// Uses KPI Report Service/Calculator results; never averages completed KPI percentages.
const reliabilityKpiChartUiState = {
  kpiId:null,mineIds:['all'],classes:['stationary','mounted'],equipmentNames:[],
  range:'1y',window:1,data:null,opener:null,detailSeriesId:null,detailMonth:null,
  fromMonth:null,toMonth:null,summary:null,summaryKey:null,showPointValues:false,
  metric:'kpi',scale:'month',forecastMethod:null,operational:null,operationalError:null
};
// Shared with both passport surfaces; operational INC and labor have separate IDs.
function kpiChartSelectedMethod(state=reliabilityKpiChartUiState) {
  const key=state.metric==='kpi'?state.kpiId:state.metric;
  const preferences=globalThis.ReclassifierKpiForecastEngine?.forecastPreferences;
  return preferences?preferences.get(key):(state.forecastMethod||null);
}
const kpiChartRussianMonths=Object.freeze(['янв','фев','мар','апр','май','июн',
  'июл','авг','сен','окт','ноя','дек']);
function kpiChartMonthText(id) {
  const month=Number(String(id||'').slice(5,7));
  return kpiChartRussianMonths[month-1]||'—';
}
function kpiChartMonthBefore(id,offset) {
  if(!/^\d{4}-\d{2}$/.test(String(id||'')))return null;
  return new Date(Date.UTC(Number(id.slice(0,4)),Number(id.slice(5,7))-1-offset,1))
    .toISOString().slice(0,7);
}
function kpiChartCalendar(from,to) {
  if(!from||!to||from>to)return [];
  const months=[];
  let id=from;
  while(id<=to&&months.length<1200){
    months.push(id);id=kpiChartMonthBefore(id,-1);
  }
  return months;
}
function kpiChartLineColor(series) {
  const index=Math.max(0,reliabilityKpiChartUiState.mineIds.indexOf(series.mineId))%3;
  return (series.equipmentClass==='mounted'
    ? ['#207c5e','#48a486','#85c7af']
    : ['#2868ae','#5695cc','#94bfdf'])[index];
}
function formatKpiChartValue(value,unit='') {
  if(!Number.isFinite(value))return '—';
  if(unit==='%'&&reliabilityKpiChartUiState.kpiId==='ktg'&&
     typeof formatReliabilityKtgValue==='function')
    return formatReliabilityKtgValue(value)+' %';
  return formatReliabilityMetric(value,unit);
}
function kpiChartSvgSegments(points,key,min,max,geo) {
  const scaled=(point,index)=>({
    x:geo.left+geo.width*(points.length<2?.5:index/(points.length-1)),
    y:geo.top+geo.height-((point[key]-min)/(max-min))*geo.height
  });
  const segments=[];
  let current=[];
  points.forEach((p,i)=>{
    if (!Number.isFinite(p[key])) {
      if(current.length){segments.push(current);current=[];}
    } else current.push(scaled(p,i));
  });
  if(current.length)segments.push(current);
  return segments;
}
// The source owns forecast validity; the SVG only validates that the
// requested visible final point matches the immutable forecast's observed fact.
function kpiChartForecastState(series,view,unit,scale='month') {
  const last=view?.points?.at(-1),forecast=series?.forecast;
  const percentage=unit==='%';
  const expectedType=percentage?'reporting-month-nowcast':
    'reporting-month-volume-nowcast';
  if(scale!=='month'||forecast?.forecastType!==expectedType||
     forecast.dataState!=='available'||!Number.isFinite(forecast.value)||
     !Number.isFinite(last?.value)||forecast.horizon!==last?.period||
     forecast.observedValue!==last.value)return null;
  return {kind:percentage?'percentage':'absolute',forecast,last,
    value:forecast.value};
}
// A forecast may be unavailable for a valid reason. Always show that
// reason rather than presenting an unmarked actual-month chart.
const KPI_CHART_FORECAST_REASONS=Object.freeze({
  'reporting-cutoff-unconfirmed':'Полнота периода выгрузки не подтверждена.',
  'reporting-cutoff-not-certified':'Подтверждение интервала не прошло проверку.',
  'observations-after-certified-cutoff':'Есть события позднее подтверждённой границы выгрузки.',
  'report-month-start-uncovered':'Начало отчётного месяца не покрыто подтверждённым интервалом.',
  'report-month-after-cutoff':'Выбранный месяц находится за границей выгрузки.',
  'report-month-missing':'Отчётный месяц не определён для загруженных данных.',
  'selected-report-month-mismatch':'Выбран другой месяц. Прогноз строится только для последнего отчётного месяца.',
  'report-month-complete':'В последнем календарном дне месяца уже есть события; прогноз оставшихся дней не требуется.',
  'invalid-reporting-cutoff':'Граница выгрузки не соответствует неполному отчётному месяцу.',
  'early-report-month':'По наблюдаемым данным пока недостаточно дней для прогноза.',
  'insufficient-complete-history':'Недостаточно завершённых месяцев для линейного тренда.',
  'previous-month-missing':'Нет данных за непосредственно предыдущий завершённый месяц.',
  'noncontiguous-component-history':'В истории есть пропущенные месяцы.',
  'missing-or-partial-component-history':'В истории есть месяцы с неполными данными.',
  'history-not-certified':'Подтверждённый интервал не покрывает необходимую историю.',
  'current-components-unavailable':'Фактическое значение месяца недоступно.',
  'current-volume-partial-coverage':'Фактические часы учитывают неполное покрытие задач.',
  'metric-source-coverage-mismatch':'Подтверждён другой источник данных, не используемый этой метрикой.'
});
function kpiChartForecastReason(forecast) {
  const reason=forecast?.reason||'reporting-cutoff-unconfirmed';
  return KPI_CHART_FORECAST_REASONS[reason]||
    ('Прогноз недоступен: '+reason+'.');
}
function kpiChartOperationalForecastNotice(op,scale,metric) {
  if(!['inc','labor'].includes(metric))return '';
  if(scale!=='month')
    return '<p class="reliability-chart-forecast-unavailable" role="status">'+
      'Для прогноза итога месяца выберите детализацию «М». В дневном и недельном режимах показывается только факт.</p>';
  const missing=(op?.series||[]).filter(row=>
    row.forecast?.dataState!=='available');
  if(!missing.length)return '';
  const first=missing[0],reason=first.forecast?.reason||'reporting-cutoff-unconfirmed';
  const needsModel=['insufficient-complete-history','previous-month-missing',
    'noncontiguous-component-history','missing-or-partial-component-history',
    'history-not-certified'].includes(reason);
  return '<aside class="reliability-chart-forecast-unavailable" role="status"'+
    ' aria-label="Причина отсутствия прогноза">'+
    '<strong>Прогноз не показан.</strong> '+
    escapeHtml(kpiChartForecastReason(first.forecast))+
    (missing.length>1?' Затронуто рядов: '+missing.length+'.':'')+
    (needsModel
      ? ' Попробуйте метод «Темп текущего месяца».':'')+
    ' Вводить или подтверждать даты выгрузки вручную не требуется.'+
    '</aside>';
}
function kpiChartPercentForecastNotice(data,views) {
  if(!['vbr','ktg'].includes(data?.kpiId))return '';
  const coverage=data.reportingCoverage||{};
  const month=views?.[0]?.view?.points?.at(-1)?.period;
  // A historic or completed month is an observed result, not a missing forecast.
  if(!month||month!==coverage.reportMonth||
      coverage.reportMonthStatus!=='incomplete')return '';
  const missing=(views||[]).filter(item=>
    !kpiChartForecastState(item.series,item.view,'%','month'));
  if(!missing.length)return '';
  const first=missing[0];
  const reason=first.series?.forecast?.reason||
    'current-components-unavailable';
  const suggestions=['insufficient-complete-history','previous-month-missing',
    'noncontiguous-component-history','missing-or-partial-component-history',
    'history-not-certified'].includes(reason);
  return '<aside class="reliability-chart-forecast-unavailable" role="status"'+
    ' aria-label="Статус прогноза KPI">'+
    '<strong>Прогноз KPI пока недоступен.</strong> '+
    escapeHtml(kpiChartForecastReason(first.series?.forecast))+
    (missing.length>1?' Рядов без прогноза: '+missing.length+'.':'')+
    (suggestions?' Попробуйте метод «Темп текущего месяца».':'')+
    ' Последний отображаемый процент — промежуточное значение, не итог месяца.'+
    '</aside>';
}
function kpiChartSvgMulti(views,unit,title,scale='month') {
  const usable=views.filter(v=>v.view?.points?.length);
  const points=usable[0]?.view.points||[];
  const stateFor=v=>kpiChartForecastState(v.series,v.view,unit,scale);
  const values=usable.flatMap(v=>{
    const projected=stateFor(v);
    return [
      ...v.view.points.flatMap((p,i)=>[
        projected?.kind==='percentage'&&i===v.view.points.length-1
          ?null:p.value,
        projected?.kind==='percentage'&&i===v.view.points.length-1
          ?null:p.rollingValue
      ]),
      projected?.value
    ];
  }).filter(Number.isFinite);
  if(!points.length||!values.length)
    return '<p class="reliability-chart-modal-empty">Нет значений для выбранных рудников, видов оборудования и периода.</p>';
  const rawMin=Math.min(...values),rawMax=Math.max(...values);
  const spread=Math.max(1,rawMax-rawMin);
  const pad=Math.max(spread*.16,Math.abs(rawMax)*.012,.6);
  let min=rawMin-pad,max=rawMax+pad;
  if(unit==='%'){min=Math.max(0,min);max=Math.min(100,max);}
  if(min>=max){min=rawMin-1;max=rawMax+1;}
  const body=document.getElementById('reliabilityKpiChartBody');
  const bodyWidth=Number(body?.clientWidth)||Number(body?.getBoundingClientRect?.()?.width)||0;
  const availableWidth=bodyWidth>0?Math.max(0,Math.floor(bodyWidth)-80):0;
  const geo={left:58,top:25,
    width:Math.max(730,(points.length-1)*(points.length>15?44:56),
      availableWidth-82),
    height:238};
  const width=geo.left+geo.width+24,height=324;
  const x=i=>geo.left+geo.width*(points.length<2?.5:i/(points.length-1));
  const y=v=>geo.top+geo.height-(v-min)/(max-min)*geo.height;
  const grid=Array.from({length:5},(_,i)=>{
    const value=min+(max-min)*i/4;
    return '<line class="reliability-chart-modal-grid" x1="'+geo.left+
      '" x2="'+(geo.left+geo.width)+'" y1="'+y(value).toFixed(1)+
      '" y2="'+y(value).toFixed(1)+'"></line>';
  }).join('');
  const ticks=Array.from({length:5},(_,i)=>{
    const value=min+(max-min)*i/4;
    return '<text class="reliability-chart-modal-axis" x="51" y="'+
      (y(value)+4).toFixed(1)+'" text-anchor="end">'+
      escapeHtml(formatReliabilityNumber(value))+'</text>';
  }).join('');
  const tickEvery=points.length>180?24:points.length>90?12:
    points.length>40?6:points.length>24?3:points.length>15?2:1;
  const labels=points.map((p,i)=>{
    if(i%tickEvery!==0&&i!==points.length-1)return '';
    const label=String(p.period||'');
    const short=scale==='day'?label.slice(8,10)+'.'+label.slice(5,7):
      scale==='week'?'н. '+label.slice(8,10)+'.'+label.slice(5,7):
      kpiChartMonthText(label);
    return '<text class="reliability-chart-modal-axis" x="'+
      x(i).toFixed(1)+'" y="'+(height-28)+
      '" text-anchor="middle">'+escapeHtml(short)+'</text>';
  }).join('');
  const path=seg=>seg.map((p,i)=>(i?'L':'M')+
    p.x.toFixed(1)+' '+p.y.toFixed(1)).join(' ');
  const seriesSvg=usable.map(({series,view})=>{
    const color=kpiChartLineColor(series);
    const state=kpiChartForecastState(series,view,unit,scale);
    const percentage=state?.kind==='percentage';
    const absolute=state?.kind==='absolute';
    const observedLine=percentage
      ?view.points.map((point,i)=>i===view.points.length-1
        ?{...point,value:null}:point)
      :view.points;
    const draw=(name,rolling,drawPoints=view.points)=>
      kpiChartSvgSegments(drawPoints,name,min,max,geo)
        .map(seg=>'<path d="'+path(seg)+'" fill="none" stroke="'+color+
          '" stroke-width="'+(rolling?2.5:3.4)+'"'+
          (rolling?' opacity=".43"':'')+
          ' stroke-linecap="round" stroke-linejoin="round"></path>').join('');
    const dots=view.points.map((p,i)=>{
      if(!Number.isFinite(p.value)||percentage&&i===view.points.length-1)
        return '';
      return '<circle data-kpi-chart-point-series="'+escapeHtml(series.id)+
        '" data-kpi-chart-point-month="'+escapeHtml(p.period)+
        '" tabindex="0" role="button" cx="'+x(i).toFixed(1)+
        '" cy="'+y(p.value).toFixed(1)+'" r="3.2" fill="'+color+
        '" stroke="white" stroke-width="1.2"><title>'+
        escapeHtml(series.mineLabel+' · '+series.equipmentLabel+' · '+
          p.period+': факт '+formatKpiChartValue(p.value,unit)+
          (p.partialCoverage?' (предварительно, неполные данные)':''))+
        '</title></circle>';
    }).join('');
    const ghost=!state?'':(()=>{
      const {forecast,last,value,kind}=state;
      const lastIdx=view.points.length-1;
      const xx=x(lastIdx),predictedY=y(value);
      const prev=view.points.at(-2);
      const lineStart=kind==='percentage'&&
        Number.isFinite(prev?.value)?{
          x:x(lastIdx-1),y:y(prev.value)
        }:{x:xx,y:y(last.value)};
      const tooltip=series.mineLabel+' · '+series.equipmentLabel+
        ' · '+forecast.horizon+': прогноз итога '+formatKpiChartValue(value,unit)+
        '; факт по '+forecast.coverageThrough+': '+
        formatKpiChartValue(last.value,unit)+'. Метод '+forecast.methodId+
        ' v'+forecast.methodVersion+'. '+(forecast.coverageBasis==='observed-event-horizon'
          ?'Предварительная оценка по последнему событию, полнота выгрузки неизвестна. '
          :'')+'Прогноз не является фактом.';
      const labelY=predictedY<geo.top+21?predictedY+20:predictedY-10;
      const line=lastIdx>0||kind==='absolute'
        ?'<path class="reliability-chart-forecast-segment" d="M'+
          lineStart.x.toFixed(1)+' '+lineStart.y.toFixed(1)+' L'+
          xx.toFixed(1)+' '+predictedY.toFixed(1)+
          '" fill="none" stroke="'+color+
          '" opacity=".65" stroke-width="2.4" stroke-dasharray="5 4"/>'
        :'';
      return '<g class="reliability-chart-forecast-ghost" data-forecast-kind="'+
        kind+'" role="img" aria-label="'+escapeHtml(tooltip)+'">'+line+
        '<circle class="reliability-chart-forecast-point" cx="'+xx.toFixed(1)+
        '" cy="'+predictedY.toFixed(1)+'" r="6.2" stroke="'+color+
        '" stroke-width="2.5" fill="white" fill-opacity=".75" opacity=".75">'+
        '<title>'+escapeHtml(tooltip)+'</title></circle>'+
        '<text class="reliability-chart-forecast-value" x="'+
        (xx-9).toFixed(1)+'" y="'+labelY.toFixed(1)+
        '" text-anchor="end" fill="'+color+'" opacity=".63" font-size="12">'+
        escapeHtml(formatKpiChartValue(value,unit))+'</text></g>';
    })();
    const valuesSvg=(reliabilityKpiChartUiState.showPointValues||absolute)?
      view.points.map((p,i)=>{
        if(!Number.isFinite(p.value)||
          percentage&&i===view.points.length-1||
          (!reliabilityKpiChartUiState.showPointValues&&
            i!==view.points.length-1))return '';
        const lastActual=absolute&&i===view.points.length-1;
        const dy=lastActual&&y(state.value)<y(p.value)?15:-9;
        return '<text class="reliability-chart-point-value" x="'+
          x(i).toFixed(1)+'" y="'+(y(p.value)+dy).toFixed(1)+
          '" text-anchor="middle" fill="'+color+'">'+
          escapeHtml(unit==='%'?new Intl.NumberFormat('ru-RU',{
            minimumFractionDigits:1,maximumFractionDigits:1
          }).format(p.value)+'%':formatKpiChartValue(p.value,unit))+'</text>';
      }).join(''):'';
    const trendLine=percentage
      ?view.points.map((p,i)=>i===view.points.length-1
        ?{...p,rollingValue:null}:p):view.points;
    return '<g role="group" aria-label="'+
      escapeHtml(series.mineLabel+' · '+series.equipmentLabel)+'">'+
      (view.window>1?draw('rollingValue',true,trendLine):'')+
      draw('value',false,observedLine)+dots+ghost+valuesSvg+'</g>';
  }).join('');
  const legends=usable.map(({series})=>{
    const color=kpiChartLineColor(series);
    return '<span class="reliability-chart-multi-legend-item"><i style="border-color:'+
      color+';border-style:solid" aria-hidden="true"></i>'+
      escapeHtml(series.mineLabel+' · '+series.equipmentLabel)+'</span>';
  }).join('');
  const states=usable.map(stateFor).filter(Boolean);
  const hasPercent=states.some(s=>s.kind==='percentage');
  const hasAbsolute=states.some(s=>s.kind==='absolute');
  return '<figure class="reliability-chart-modal-figure">'+
    '<div class="reliability-chart-modal-scroll" tabindex="0" role="region" aria-label="Динамика выбранных рядов">'+
      '<svg viewBox="0 0 '+width+' '+height+
      '" style="width:'+width+'px;max-width:none" role="img" aria-label="'+
      escapeHtml(title)+' — сравнение рудников и видов оборудования">'+
      grid+ticks+labels+seriesSvg+'</svg></div>'+
    '<figcaption class="reliability-chart-modal-legend reliability-chart-multi-legend">'+
      legends+
      (reliabilityKpiChartUiState.window>1
        ?'<span>Полупрозрачные линии — скользящий тренд</span>':'')+
      (hasPercent?'<span>Пунктирный последний участок и приглушённое значение — прогноз итога отчётного месяца вместо промежуточного процента; факт доступен в подсказке</span>':'')+
      (hasAbsolute?'<span>Сплошная линия и обычная точка — накопленный факт; вертикальный пунктир и приглушённое значение — прогноз итога отчётного месяца</span>':'')+
      '</figcaption></figure>';
}
function renderVbrUnifiedFormula() {
  const state=reliabilityKpiChartUiState;
  const summary=state.summary,result=summary?.result,parts=result?.components||{};
  const from=summary?.fromMonth||state.fromMonth,to=summary?.toMonth||state.toMonth;
  const count=result?.diagnostics?.reportingMonths;
  const baseline=result?.diagnostics?.baselineEquipmentCount;
  const failures=parts.failureCount,exposure=parts.equipmentCount;
  const periodLabel=from&&to?
    kpiChartMonthText(from)+' '+from.slice(0,4)+' — '+
    kpiChartMonthText(to)+' '+to.slice(0,4):'—';
  const heading=`<div class="reliability-formula-head"><h3>Состав расчёта · ВБР</h3>
    <p>Выбранные рудники и классы оборудования · ${escapeHtml(periodLabel)}</p></div>`;
  const diagnostics=result?.diagnostics||{};
  const missed=diagnostics.missingItsmMonths||[];
  const observed=diagnostics.observedMonths||[];
  const fmtMonths=list=>Array.from(list||[]).map(m=>
    kpiChartMonthText(m)+' '+String(m).slice(0,4)).join(', ');
  const coverageMessage=missed.length
    ? `<p class="reliability-formula-notes"><strong>Расчёт по неполному периоду.</strong>
       Месяцы без наблюдений ITSM: ${escapeHtml(fmtMonths(missed))};
       они исключены из расчёта, а не приняты за нулевые отказы.
       ${observed.length?`В расчёт вошли: ${escapeHtml(fmtMonths(observed))}.`:''}
       Парк Drivers учтён только за ${escapeHtml(String(count||0))}
       подтверждённых месяцев.</p>`
    : '';
  const reasons={
    'itsm-period-without-observations':'Нет ни одного месяца с зарегистрированными обращениями ITSM.',
    'equipment-count-zero-or-missing':'Нет численности оборудования в Drivers для выбранных фильтров.',
    'source-missing':'Не загружены необходимые источники ITSM или Drivers.'
  };
  const valid=result?.dataState==='available'&&Number.isFinite(result.value)&&
    Number.isFinite(count)&&count>0&&Number.isFinite(baseline)&&
    Number.isFinite(failures)&&Number.isFinite(exposure)&&exposure===baseline*count;
  if(!valid)return `<section class="reliability-formula-panel" aria-label="Компоненты расчёта">
    ${heading}<p class="reliability-formula-unavailable">Расчёт за выбранный период недоступен.
      ${escapeHtml(reasons[result?.reason]||result?.reason||'Проверьте доступность Drivers и событий ITSM.')}</p>
      ${coverageMessage}</section>`;
  const tile=(name,value,unit)=>`<div class="reliability-formula-tile">
    <span>${escapeHtml(name)}</span><strong>${escapeHtml(formatKpiChartValue(value,unit))}</strong></div>`;
  const equipment=tile('Оборудование',baseline,'шт.');
  const months=tile('Месяцев',count,'мес.');
  const failure=tile('Отказы',failures,'событий');
  const exposureTile=tile('Фонд наблюдения',exposure,'ед.·мес.');
  return `<section class="reliability-formula-panel" aria-label="Компоненты расчёта">
    ${heading}
    ${coverageMessage}
    <div class="reliability-formula-equation">
      <strong class="reliability-formula-symbol">ВБР =</strong>
      <div class="reliability-formula-fraction">
        <div class="reliability-formula-numerator">${equipment}
          <span class="reliability-formula-operator">×</span>${months}
          <span class="reliability-formula-operator">−</span>${failure}</div>
        <div class="reliability-formula-denominator">${exposureTile}</div>
      </div>
      <span class="reliability-formula-operator">× 100%</span>
      <div class="reliability-formula-result"><span>Результат</span>
        <strong>${escapeHtml(formatKpiChartValue(result.value,'%'))}</strong></div>
    </div>
    <p class="reliability-formula-notes">
      ${escapeHtml(formatKpiChartValue(baseline,'шт.'))} × ${escapeHtml(String(count))}
      календарных мес. = ${escapeHtml(formatKpiChartValue(exposure,'ед.·мес.'))}.
      Все выбранные рудники учитываются как объединение, без повторного учёта.
      Отказы суммируются за период; оборудование — фиксированная численность Drivers,
      повторённая для каждого месяца. ВБР не является индивидуальной вероятностью
      отказа одной единицы.</p>
  </section>`;
}
function renderKtgUnifiedFormula() {
  const state=reliabilityKpiChartUiState;
  const result=state.summary?.result,parts=result?.components||{};
  const from=state.summary?.fromMonth||state.fromMonth,
    to=state.summary?.toMonth||state.toMonth;
  const period=from&&to?kpiChartMonthText(from)+' '+from.slice(0,4)+' — '+
    kpiChartMonthText(to)+' '+to.slice(0,4):'—';
  const coverage=result?.diagnostics||{};
  const monthList=months=>Array.from(months||[]).map(m=>
    kpiChartMonthText(m)+' '+String(m).slice(0,4)).join(', ');
  const absent=coverage.missingItsmMonths||[];
  const missingRows=(coverage.selectedUnfinishedRows||0)+
    (coverage.selectedUnknownDurationRows||0);
  const computedMonths=coverage.reportMonths||[];
  const coverageMessage=absent.length||missingRows
    ? `<p class="reliability-formula-notes"><strong>Расчёт предварительный.</strong>
      ${absent.length?`Месяцы без данных ITSM исключены из фонда и сумм: ${escapeHtml(monthList(absent))}. `:''}
      ${computedMonths.length?`Фактически рассчитанные месяцы: ${escapeHtml(monthList(computedMonths))}. `:''}
      ${missingRows?`Не включены в продолжительность: ${escapeHtml(String(coverage.selectedUnfinishedRows||0))}
      незавершённых и ${escapeHtml(String(coverage.selectedUnknownDurationRows||0))}
      записей с некорректными часами. Фактический простой может быть больше рассчитанного.`:''}
      </p>`
    : '';
  const header=`<div class="reliability-formula-head">
    <h3>Состав расчёта · КТГ</h3>
    <p>Выбранные рудники и виды оборудования · ${escapeHtml(period)}</p></div>`;
  const required=['calendarHours','incidentHours','actualMaintenanceHours',
    'plannedMaintenanceHours','unplannedMaintenanceHours','otherHours',
    'availableHours','productiveHours'];
  if(result?.dataState!=='available'||!Number.isFinite(result?.value)||
     !required.every(name=>Number.isFinite(parts[name]))) {
    const reason=result?.reason||'components-not-available';
    const causes={
      'equipment-count-zero-or-missing':'Нет численности оборудования в справочнике Drivers для выбранной группы.',
      'itsm-period-without-observations':'В выбранном периоде нет ни одного месяца с наблюдениями ITSM.',
      'unfinished-itsm-requests':'Есть незавершённые обращения ITSM: динамический предбэклог нельзя считать подтверждённым простоем.',
      'request-duration-incomplete':'Учитываемые обращения ITSM имеют отсутствующее или некорректное время предбэклога.',
      'available-fund-zero-or-negative':'Доступный фонд времени не положительный.'
    };
    return `<section class="reliability-formula-panel" aria-label="Компоненты расчёта">
      ${header}<p class="reliability-formula-unavailable">КТГ недоступен:
      ${escapeHtml(causes[reason]||reason)}</p>${coverageMessage}</section>`;
  }
  const tile=(label,value)=>`<div class="reliability-formula-tile"><span>${escapeHtml(label)}</span>
    <strong>${escapeHtml(formatKpiChartValue(value,'ч'))}</strong></div>`;
  const minus='<span class="reliability-formula-operator">−</span>';
  const plus='<span class="reliability-formula-operator">+</span>';
  return `<section class="reliability-formula-panel" aria-label="Компоненты расчёта">
    ${header}
    ${coverageMessage}
    <div class="reliability-formula-equation">
      <strong class="reliability-formula-symbol">КТГ =</strong>
      <div class="reliability-formula-fraction">
        <div class="reliability-formula-numerator">
          ${tile('КФРВ',parts.calendarHours)}${minus}
          (${tile('INC',parts.incidentHours)}${plus}
          ${tile('ТО факт',parts.actualMaintenanceHours)}${plus}
          ${tile('ТО внеплановое',parts.unplannedMaintenanceHours)}${plus}
          ${tile('Прочее',parts.otherHours)})
        </div>
        <div class="reliability-formula-denominator">
          ${tile('КФРВ',parts.calendarHours)}${minus}
          ${tile('ТО план (допущение)',parts.plannedMaintenanceHours)}
        </div>
      </div>
      <span class="reliability-formula-operator">× 100%</span>
      <div class="reliability-formula-result">
        <span>Результат</span>
        <strong>${escapeHtml(formatKpiChartValue(result.value,'%'))}</strong></div>
    </div>
    <p class="reliability-formula-notes">
      Продолжительность из ITSM, «Время предбэклога (откр-выполн), час»:
      INC ${escapeHtml(formatKpiChartValue(parts.incidentHours,'ч'))},
      плановое ТО факт ${escapeHtml(formatKpiChartValue(parts.actualMaintenanceHours,'ч'))},
      внеплановое ТО ${escapeHtml(formatKpiChartValue(parts.unplannedMaintenanceHours,'ч'))},
      прочее ${escapeHtml(formatKpiChartValue(parts.otherHours,'ч'))}.
      КФРВ = Drivers × 24 ч × календарные дни.
      ТО план временно принято равным фактическому плановому ТО (нет отдельного графика).
      ДФРВ = ${escapeHtml(formatKpiChartValue(parts.availableHours,'ч'))};
      расчётный работоспособный фонд = ${escapeHtml(formatKpiChartValue(parts.productiveHours,'ч'))}.
      Монтаж, ПО доступ и консультации (не-INC) не учитываются.
      Время обращения — оценка, а не прямое измерение простоя.</p>
  </section>`;
}
// The quality KPIs use four auditable request categories, not opaque "component 1".
function renderClassificationFormulaTiles(views,kpiId) {
  const state=reliabilityKpiChartUiState;
  const selected=views.find(v=>v.series.id===state.detailSeriesId)||views[0];
  if(!selected) return '<section class="reliability-formula-panel"><p>Выберите ряд для просмотра состава расчёта.</p></section>';
  state.detailSeriesId=selected.series.id;
  const months=selected.view.points.map(p=>p.period);
  if(!months.includes(state.detailMonth))state.detailMonth=months.at(-1)||null;
  const point=selected.series.points.find(p=>p.period===state.detailMonth);
  const parts=point?.components||{};
  const cgps=kpiId==='classification_quality_cgps';
  const options=views.map(v=>'<option value="'+escapeHtml(v.series.id)+'"'+
    (v.series.id===state.detailSeriesId?' selected':'')+'>'+
    escapeHtml(v.series.mineLabel+' · '+v.series.equipmentLabel)+'</option>').join('');
  const periods=months.map(p=>'<option value="'+escapeHtml(p)+'"'+
    (p===state.detailMonth?' selected':'')+'>'+
    escapeHtml(p.slice(5)+'.'+p.slice(0,4))+'</option>').join('');
  const head='<div class="reliability-formula-head"><h3>Состав расчёта · '+
    (cgps?'Качество классификации ЦГПС':'Качество классификации общее')+'</h3>'+
    '<p>Фактические категории за выбранный месяц; числитель и знаменатель без усреднения процентов.</p></div>'+
    '<div class="reliability-formula-controls"><label>Ряд <select id="reliabilityKpiFormulaSeries" aria-label="Ряд для расчёта">'+
    options+'</select></label><label>Месяц <select id="reliabilityKpiFormulaMonth" aria-label="Месяц для расчёта">'+
    periods+'</select></label></div>';
  const counts=[
    ['A · INC без изм','classificationIncUnchangedCount'],
    ['B · INC с исправлением','classificationIncCorrectedCount'],
    ['C · INC не классифицирован','classificationIncUnclassifiedCount'],
    [cgps?'D · RITM вместо INC (ЦГПС)':'D · RITM вместо INC','classificationRitmInsteadOfIncCount']
  ];
  const hasCounts=counts.every(([,key])=>Number.isFinite(parts[key])) &&
    Number.isFinite(parts.classificationTotalCount);
  const tile=(name,value)=>'<div class="reliability-formula-tile"><span>'+
    escapeHtml(name)+'</span><strong>'+escapeHtml(String(value))+'</strong></div>';
  const reason={
    'mb-coverage-unknown':'Dataset Мобильных бригад отсутствует или недоступен. Процент ЦГПС нельзя рассчитать.',
    'classification-denominator-zero':'Нет обращений, входящих в расчёт за выбранный месяц.',
    'source-missing':'Нет обязательных данных ITSM Сириус или Мобильных бригад.',
    'period-not-in-source-calendar':'Нет наблюдений за выбранный месяц.'
  };
  const unavailable=point?.dataState!=='available'||!Number.isFinite(point?.value);
  let message=unavailable?'<p class="reliability-formula-unavailable">'+
    escapeHtml(reason[point?.reason]||point?.reason||'Расчёт за выбранный месяц недоступен.')+'</p>':'';
  if(!hasCounts) {
    return '<section class="reliability-formula-panel" aria-label="Компоненты расчёта">'+head+
      message+'<p class="reliability-formula-unavailable">Компоненты A/B/C/D не предоставлены источником.</p></section>';
  }
  const n=parts.classificationIncUnchangedCount;
  const d=parts.classificationTotalCount;
  const denominator=counts.map(([label,key])=>
    '<div class="reliability-formula-tile reliability-classification-category">'+
    '<span>'+escapeHtml(label)+'</span><strong>'+
    escapeHtml(String(parts[key]))+'</strong></div>').join('');
  const result=unavailable?'—':formatKpiChartValue(point.value,'%');
  // A is the numerator; the four audited categories are the denominator
  // directly underneath the fraction bar. Never duplicate A/B/C/D above it.
  const equation='<div class="reliability-formula-equation reliability-classification-equation">'+
    '<strong class="reliability-formula-symbol">'+(cgps?'К ЦГПС':'К общ')+' =</strong>'+
    '<div class="reliability-formula-fraction reliability-classification-fraction">'+
    '<div class="reliability-formula-numerator">'+tile('INC без изм (A)',n)+'</div>'+
    '<div class="reliability-formula-denominator reliability-classification-denominator"'+
    ' role="group" aria-label="Знаменатель: сумма категорий A, B, C и D = '+escapeHtml(String(d))+'">'+
    denominator+'</div></div>'+
    '<span class="reliability-formula-operator">× 100%</span>'+
    '<div class="reliability-formula-result"><span>Результат</span><strong>'+
    escapeHtml(result)+'</strong></div></div>';
  const evidence=point?.classificationCoverage;
  const summary=(!cgps&&evidence) ? (() => {
    const data=[
      ['Обращений ITSM в классификации',evidence.classifiedItsmCount],
      ['Есть в обеих системах, месяц совпадает',evidence.bothSameMonthCount],
      ['Есть в обеих системах, месяцы различаются',evidence.bothOtherMonthCount],
      ['Есть в обеих системах, дата работ МБ отсутствует',evidence.bothUndatedMbCount],
      ['Нет номера ITSM для сверки',evidence.missingItsmRequestCount],
      ['Номер ITSM не найден в загруженной МБ',evidence.itsmNotInLoadedMbCount],
      ['Отсутствует подтверждённое покрытие МБ',evidence.itsmUnknownMbCoverageCount],
      ['Выгрузка МБ покрывает месяц, номер не найден',evidence.itsmConfirmedMbAbsenceCount],
      ['Только в загруженной МБ, уникальные номера по месяцу',evidence.mbOnlyLoadedCount],
      ['Для этих номеров МБ покрытие ITSM не подтверждено',evidence.mbUnknownItsmCoverageCount],
      ['Задач МБ без номера заявки',evidence.mbNoRequestTaskCount]
    ];
    const tiles='<div class="reliability-classification-exclusions">'+
      '<div class="reliability-formula-equation">'+
      data.map(([name,value])=>tile(name,Number.isFinite(value)?value:'—')).join('')+
      '</div></div>';
    const groups=Array.isArray(evidence.byInitiator)?evidence.byInitiator:[];
    const groupRows=groups.length
      ? '<div class="kpi-passport-table-wrap"><table class="kpi-passport-table"'+
        ' aria-label="Качество классификации по группам инициаторов">'+
        '<thead><tr><th>Группа инициаторов</th><th>Всего</th>'+
        '<th>A</th><th>B</th><th>C</th><th>D</th>'+
        '<th>Совпал месяц МБ</th><th>Другой месяц МБ</th></tr></thead><tbody>'+
        groups.map(g=>'<tr><td>'+escapeHtml(g.label)+'</td>'+
          ['count','categoryA','categoryB','categoryC','categoryD',
           'bothSameMonthCount','bothOtherMonthCount']
          .map(field=>'<td>'+escapeHtml(String(g[field]??0))+'</td>').join('')+
          '</tr>').join('')+'</tbody></table></div>'
      : '<p>Группы инициаторов за выбранный период не представлены.</p>';
    const warning=evidence.mbPresent
      ? 'Отсутствие номера в загруженном Dataset МБ не доказывает отсутствия обращения в исходной корпоративной системе.'
      : 'Dataset МБ недоступен; совпадения проверить нельзя.';
    return '<div class="reliability-classification-diagnostics"'+
      ' aria-label="Сверка обращений ITSM и МБ"><h5>Сверка ITSM и МБ</h5>'+
      tiles+'<h5>Группы инициаторов</h5>'+groupRows+
      '<p class="reliability-formula-notes">'+escapeHtml(warning+
      ' Месяц ITSM — выполнение или закрытие, месяц МБ — дата фактических работ.'+
      ' Группы взяты из справочника инициаторов по полю «Открыл», неизвестные показаны отдельно.'+
      ' «Только МБ» учитывается отдельно от знаменателя A+B+C+D. '+
      ' Покрытие МБ: '+(evidence.mbCoverageStatus||'unknown')+
      '; покрытие ITSM: '+(evidence.itsmCoverageStatus||'unknown')+'.')+
      '</p></div>';
  })() : '';
  const exclusions=cgps
    ? '<div class="reliability-formula-equation">'+
       tile('Исключено: нет в МБ',parts.excludedNoMbCount??0)+
       tile('Нет данных МБ: Dataset недоступен',parts.unknownMbCoverageCount??0)+
       tile('Исключено: RITM иных инициаторов',parts.excludedOtherInitiatorRitmCount??0)+
       tile('Исключено: RITM без группы инициаторов',parts.excludedUnknownInitiatorRitmCount??'—')+
       tile('Исключено: нет номера ITSM',parts.excludedMissingRequestCount??'—')+
       '</div>' : '';
  const notes=cgps
    ? 'Для INC достаточно совпадения номера с МБ при любой группе инициаторов; для RITM вместо INC требуется группа ЦГПС. Пустая группа не считается ЦГПС. Даты выгрузки не влияют на поиск: «Нет в МБ» означает отсутствие номера в загруженных данных, «Нет данных МБ» — отсутствие самого Dataset.'
    : 'Учитываются все четыре категории ITSM Сириус независимо от наличия в МБ и группы инициаторов. «RITM без изм» в знаменатель не входит.';
  return '<section class="reliability-formula-panel" aria-label="Компоненты расчёта">'+
    head+message+equation+
    '<section class="reliability-classification-remarks" aria-label="Примечания к вычислениям">'+
    '<h4>Примечания к вычислениям</h4>'+
    (exclusions?'<div class="reliability-classification-exclusions">'+exclusions+'</div>':'')+
    summary+
    '<p class="reliability-formula-notes">'+escapeHtml(notes)+'</p></section></section>';
}
function renderKpiFormulaTiles(views,kpiId,unit) {
  if(kpiId==='vbr')return renderVbrUnifiedFormula();
  if(kpiId==='ktg')return renderKtgUnifiedFormula();
  if(kpiId==='classification_quality'||kpiId==='classification_quality_cgps')
    return renderClassificationFormulaTiles(views,kpiId);
  const state=reliabilityKpiChartUiState;
  const selected=views.find(v=>v.series.id===state.detailSeriesId)||views[0];
  if(!selected)return '<section class="reliability-formula-panel"><p>Выберите ряд для просмотра компонентов.</p></section>';
  state.detailSeriesId=selected.series.id;
  const months=selected.view.points.map(p=>p.period);
  if(!months.includes(state.detailMonth))state.detailMonth=months.at(-1)||null;
  const point=selected.series.points.find(p=>p.period===state.detailMonth);
  const catalog=globalThis.ReclassifierKpiCatalog;
  const entry=catalog?.get?.(kpiId),definition=catalog?.getV2?.(kpiId);
  const projection=catalog?.projectComponents?.(kpiId,point);
  const title=entry?.definition?.title||kpiId;
  const options=views.map(v=>'<option value="'+escapeHtml(v.series.id)+'"'+
    (v.series.id===state.detailSeriesId?' selected':'')+'>'+
    escapeHtml(v.series.mineLabel+' · '+v.series.equipmentLabel)+'</option>').join('');
  const periods=months.map(p=>'<option value="'+escapeHtml(p)+'"'+
    (p===state.detailMonth?' selected':'')+'>'+
    escapeHtml(p.slice(5)+'.'+p.slice(0,4))+'</option>').join('');
  const head='<div class="reliability-formula-head"><h3>Состав расчёта · '+
    escapeHtml(title)+'</h3><p>Фактические компоненты выбранного ряда и месяца.</p></div>'+
    '<div class="reliability-formula-controls"><label>Ряд <select id="reliabilityKpiFormulaSeries" aria-label="Ряд для расчёта">'+
    options+'</select></label><label>Месяц <select id="reliabilityKpiFormulaMonth" aria-label="Месяц для расчёта">'+
    periods+'</select></label></div>';
  const wrap=body=>'<section class="reliability-formula-panel" aria-label="Компоненты расчёта">'+head+body+'</section>';
  if(point?.dataState!=='available'||!Number.isFinite(point.value))
    return wrap('<p class="reliability-formula-unavailable">За выбранный месяц расчёт недоступен.'+
      (point?.reason?' Причина: '+escapeHtml(point.reason):'')+'</p>');
  if(!definition||!projection)
    return wrap('<p class="reliability-formula-unavailable">Описание компонентов для этого показателя не подключено к KPI Definition V2.</p>');
  if(!projection.canDisplayFormula)
    return wrap('<p class="reliability-formula-unavailable">В фактическом результате отсутствуют необходимые компоненты формулы. Данные не заменяются нулями.</p>');
  const tile=item=>'<div class="reliability-formula-tile" data-kpi-component="'+
    escapeHtml(item.key)+'"><span>'+escapeHtml(item.label)+'</span><strong>'+
    escapeHtml(formatKpiChartValue(item.value,item.unit))+'</strong></div>';
  const primary=projection.primary;
  const fraction=(n,d)=>'<div class="reliability-formula-fraction">'+
    '<div class="reliability-formula-numerator">'+tile(n)+'</div>'+
    '<div class="reliability-formula-denominator">'+tile(d)+'</div></div>';
  let equation='',suffix='';
  if(definition.measurement.kind==='ratio'){
    equation=fraction(projection.numerator,projection.denominator);
    suffix='<span class="reliability-formula-operator">× 100%</span>';
  }else if(['sum','count'].includes(definition.measurement.kind)&&primary){
    equation=tile(primary);
  }else{
    // Unknown or specialized mathematics must be displayed by its existing
    // audited renderer, never approximated by dividing arbitrary components.
    return wrap('<p class="reliability-formula-unavailable">Для выбранного типа расчёта требуется отдельное представление формулы.</p>');
  }
  const used=new Set([projection.numerator?.key,projection.denominator?.key,primary?.key]);
  const context=projection.items.filter(item=>item.state==='available'&&!used.has(item.key));
  const supporting=context.length
    ?'<details class="reliability-formula-context"><summary>Дополнительные фактические компоненты</summary>'+
      '<div class="reliability-formula-equation">'+context.map(tile).join('')+'</div></details>':'';
  const result='<div class="reliability-formula-result"><span>Результат</span><strong>'+
    escapeHtml(formatKpiChartValue(point.value,unit))+'</strong></div>';
  return wrap('<div class="reliability-formula-equation"><strong class="reliability-formula-symbol">'+
    escapeHtml(title)+' =</strong>'+equation+suffix+result+'</div>'+supporting+
    '<p class="reliability-formula-notes">Значения компонентов получены из KPI Result. '+
    'Формула не пересчитывается интерфейсом. Подробные поля, фильтры и правила агрегации — в паспорте показателя.</p>');

}
function renderKpiMonthRange(data,state) {
  const calendar=kpiChartCalendar(data.availableFrom,data.availableTo);
  if(!calendar.length)return '<div class="reliability-chart-month-range">Периоды недоступны</div>';
  const start=Math.max(0,calendar.indexOf(state.fromMonth));
  const finish=calendar.indexOf(state.toMonth);
  const last=Math.max(0,finish);
  const max=calendar.length-1;
  const pct=index=>max?Math.round(index/max*100):0;
  return `<div class="reliability-chart-month-range" aria-label="Интервал расчёта показателя">
    <div class="reliability-chart-month-range-title">
      <span>Период</span>
      <strong>${escapeHtml(kpiChartMonthText(calendar[start])+' '+calendar[start].slice(2,4))} –
        ${escapeHtml(kpiChartMonthText(calendar[last])+' '+calendar[last].slice(2,4))}</strong>
    </div>
    <div class="reliability-chart-month-range-track" style="--from:${pct(start)}%;--to:${pct(last)}%">
      <div class="reliability-chart-month-range-rail"></div>
      <input type="range" id="reliabilityVbrFrom" min="0" max="${max}" step="1"
        value="${start}" aria-label="Начальный месяц периода" ${!max?'disabled':''}/>
      <input type="range" id="reliabilityVbrTo" min="0" max="${max}" step="1"
        value="${last}" aria-label="Конечный месяц периода" ${!max?'disabled':''}/>
    </div>
    <div class="reliability-chart-month-range-ends"><span>${escapeHtml(kpiChartMonthText(calendar[0])+' '+calendar[0].slice(2,4))}</span>
      <span>${escapeHtml(kpiChartMonthText(calendar[max])+' '+calendar[max].slice(2,4))}</span></div>
  </div>`;
}
function renderKpiChartModalBody() {
  const data=reliabilityKpiChartUiState.data;
  const catalog=globalThis.ReclassifierKpiCatalog;
  const viewApi=globalThis.ReclassifierKpiChartViewModel;
  const entry=catalog?.get(reliabilityKpiChartUiState.kpiId);
  if(!entry||!data||!viewApi?.project)
    return '<p class="reliability-chart-modal-empty">Данные графика недоступны.</p>';
  const state=reliabilityKpiChartUiState;
  const operationalMode=state.metric!=='kpi';
  const op=operationalMode?state.operational:null;
  const views=data.series.map(series=>({
    series,view:viewApi.project({
      kpiId:entry.id,series:{kpiId:entry.id,points:series.points},
      selectedMonth:data.selectedMonth,range:state.range,axisStep:'month',window:state.window
    })
  }));
  const operationalViews=op?.series?.map(series=>({
    series,view:{points:series.points,window:state.window}
  }))||[];
  const allMonths=Array.from(new Set(data.series.flatMap(s=>s.points.map(p=>p.period)))).sort();
  const latest=data.selectedMonth||allMonths.at(-1)||null;
  const earliest=data.availableFrom||allMonths[0]||null;
  const mines=data.mineOptions||[];
  const selection=mine=>state.mineIds.includes(mine.id);
  const buttons=mines.map(mine=>`<button type="button" data-kpi-chart-mine="${escapeHtml(mine.id)}"
    class="${selection(mine)?'active':''}" aria-pressed="${selection(mine)}"
    ${state.mineIds.length>=3&&!selection(mine)?'disabled':''}>${escapeHtml(mine.label)}</button>`).join('');
  const names=data.equipmentNameOptions||[];
  const chosenNames=state.equipmentNames||[];
  // Service returns the effective selection from the same scope used to
  // compute the graph and summary; use it for ARIA and active button styling.
  const activeNames=new Set(data.selectedEquipmentNames||chosenNames);
  const equipmentNameButtons='<button type="button" data-kpi-chart-equipment-name-all="true" class="'+
    (!chosenNames.length?'active':'')+'" aria-pressed="'+(!chosenNames.length)+'">Все</button>'+
    names.map(item=>'<button type="button" data-kpi-chart-equipment-name="'+escapeHtml(item.id)+
    '" class="'+(activeNames.has(item.id)?'active':'')+
    '" aria-pressed="'+activeNames.has(item.id)+'">'+escapeHtml(item.label)+'</button>').join('');
  const showEquipmentNames=['vbr','ktg','classification_quality',
    'classification_quality_cgps'].includes(entry.id);
  const equipment=[['stationary','Стационарное'],['mounted','Навесное']];
  const equipmentButtons=equipment.map(([id,label])=>`<button type="button" data-kpi-chart-class="${id}"
    class="reliability-chart-multi-class ${id} ${state.classes.includes(id)?'active':''}"
    aria-pressed="${state.classes.includes(id)}">${label}</button>`).join('');
  const ranges=[['1m','1М'],['3m','3М'],['1y','1Г'],['all','Все']];
  const chartUnit=operationalMode?(op?.unit||''):entry.definition.unit;
  const chartScale=operationalMode?state.scale:'month';
  const activeForecastViews=operationalMode?operationalViews:views;
  const forecastStates=activeForecastViews.map(v=>({
    series:v.series,state:kpiChartForecastState(v.series,v.view,chartUnit,chartScale)
  })).filter(v=>v.state);
  const forecastDetails=forecastStates.map(({series,state:computed})=>{
    const f=computed.forecast;
    const methods=Object.entries(f.methodComponents||{}).map(([id,part])=>
      id+': '+(part.methodId==='linear-trend'?'линейный тренд':
        part.methodId==='observed-run-rate'?'экстраполяция факта':'последняя интенсивность'));
    return '<li><strong>'+escapeHtml(series.mineLabel+' · '+series.equipmentLabel)+
      ': '+escapeHtml(formatKpiChartValue(f.value,chartUnit))+
      '</strong> · прогноз итога '+escapeHtml(f.horizon)+
      ' (факт по '+escapeHtml(f.coverageThrough)+': '+
      escapeHtml(formatKpiChartValue(f.observedValue,chartUnit))+
      '); метод '+escapeHtml(f.methodId)+' v'+escapeHtml(f.methodVersion)+
      '; компоненты: '+escapeHtml(methods.join(', '))+
      '; '+escapeHtml(f.quality?.historicalMonths)+' месяцев истории, '+
      escapeHtml(f.quality?.validationMonths)+' проверочных. '+
      escapeHtml(f.caveats?.join('; ')||'')+'</li>';
  });
  const forecastNotice=operationalMode
    ? kpiChartOperationalForecastNotice(op,state.scale,state.metric)
    : kpiChartPercentForecastNotice(data,views);
  const engine=globalThis.ReclassifierKpiForecastEngine;
  const methodKey=operationalMode?state.metric:entry.id;
  const permitted=engine?.forecastPreferences?.methodsFor(methodKey)||
    ['linear-trend','last-value','observed-run-rate'];
  const forecastMethods=[['auto','Автоматически'],...permitted.map(id=>[id,
    id==='linear-trend'?'Линейный тренд':
      id==='last-value'?'Последний месяц':
      id==='observed-run-rate'?'Темп текущего месяца':id])];
  const provisional=forecastStates.some(x=>
    x.state.forecast.coverageBasis==='observed-event-horizon');
  const provisionalNote=provisional
    ? '<p class="reliability-chart-forecast-method-note">Предварительный прогноз: дата последнего события принята за горизонт наблюдения, но не подтверждает полноту выгрузки. Расчёт может измениться при поступлении дополнительных данных.</p>'
    :'';
  const explanatoryText=forecastStates.some(x=>x.state.kind==='absolute')
    ? 'Для абсолютных метрик сплошная линия заканчивается фактическим накопленным значением, пунктир соединяет факт и прогноз итога того же месяца. Оба значения доступны на графике.'
    : 'Для процентных KPI пунктир соединяет предыдущий завершённый месяц с прогнозом итога отчётного месяца. Промежуточный процент не выводится отдельной точкой, но остаётся в исходном KPI и подсказке.';
  return `<div class="reliability-chart-modal-top">
    <div><p class="reliability-chart-modal-kicker">Динамика · ${escapeHtml(entry.definition.title)}</p>
      <p class="reliability-chart-modal-slice">Доступна статистика с ${escapeHtml(earliest||'—')} по ${escapeHtml(latest||'—')}</p>
    </div>
  </div>
  <div class="reliability-chart-multi-controls">
    <div class="reliability-chart-multi-caption">Рудники и агрегаты · не более трёх</div>
    <div class="reliability-chart-multi-buttons" role="group" aria-label="Выбор рудников для сравнения">${buttons}</div>
    <div class="reliability-chart-multi-equipment-row">
      <div><div class="reliability-chart-multi-caption">Вид оборудования</div>
        <div class="reliability-chart-multi-buttons" role="group" aria-label="Выбор вида оборудования">${equipmentButtons}</div>
      </div>
      ${!operationalMode&&['vbr','ktg'].includes(entry.id)?renderKpiMonthRange(data,state):''}
    </div>
  </div>
  <div class="reliability-chart-modal-ranges" role="group" aria-label="Вид отображаемой метрики">
    ${[['kpi','Показатель KPI'],['inc','Количество INC'],['labor','Трудозатраты']].map(([id,label])=>
      `<button type="button" data-kpi-chart-metric="${id}" aria-pressed="${state.metric===id}"
        class="${state.metric===id?'active':''}">${label}</button>`).join('')}
  </div>
  <div class="reliability-chart-modal-ranges" role="group" aria-label="Детализация временной шкалы">
    ${[['day','Д'],['week','Н'],['month','М']].map(([id,label])=>
      `<button type="button" data-kpi-chart-scale="${id}" aria-pressed="${(operationalMode?state.scale:'month')===id}"
        class="${(operationalMode?state.scale:'month')===id?'active':''}"
        ${!operationalMode&&id!=='month'?'disabled title="Коэффициенты KPI рассчитываются только по месяцам"':''}
        aria-label="${id==='day'?'День':id==='week'?'Неделя':'Месяц'}">${label}</button>`).join('')}
  </div>
  ${((operationalMode&&state.scale==='month')||
      (!operationalMode&&(catalog?.getV2?.(entry.id)?.forecast?.chartNowcastConnected??
        ['vbr','ktg'].includes(entry.id))))
    ? '<div class="reliability-chart-forecast-method"><label for="reliabilityKpiForecastMethod">Метод прогноза</label>'+
      '<select id="reliabilityKpiForecastMethod" aria-label="Метод прогноза">'+
      forecastMethods.map(([id,label])=>'<option value="'+id+'"'+
        ((kpiChartSelectedMethod(state)||'auto')===id?' selected':'')+'>'+escapeHtml(label)+'</option>').join('')+
      '</select></div>':''
  }
  <p class="reliability-chart-modal-slice">${operationalMode
    ? 'Операционные данные: '+escapeHtml(op?.label||'')+
      ' · источник: '+(state.metric==='inc'?'ITSM, дата выполнения INC':'Мобильные бригады, фактическая дата работ')+
      '. Это не пересчёт коэффициента KPI.'+
      ' Охват: все наименования оборудования выбранных рудников и классов;'+
      ' фильтр конкретных наименований используется только в KPI, а не в INC/трудозатратах.'+
      (op?.start&&op?.end?' Период: '+escapeHtml(op.start)+' — '+escapeHtml(op.end)+'.':'')+
      (op?.truncated?' Показан ограниченный доступный период.':'')
    : 'Показатели KPI рассчитываются по месяцам в соответствии с действующими методиками.'}</p>
  ${state.operationalError&&operationalMode
    ? '<p class="reliability-chart-modal-empty" role="alert">'+escapeHtml(state.operationalError)+'</p>'
    : kpiChartSvgMulti(operationalMode?operationalViews:views,
        operationalMode?(op?.unit||''):entry.definition.unit,
        operationalMode?(op?.label||'Операционная динамика'):entry.definition.title,
        operationalMode?state.scale:'month')}
  ${forecastDetails.length
    ? '<section class="reliability-chart-forecast-note" aria-label="Расшифровка предварительного прогноза"><strong>Прогноз итога отчётного месяца · экспериментально</strong><ul>'+
       forecastDetails.join('')+'</ul><p>'+escapeHtml(explanatoryText)+' Прогноз экспериментальный и не является фактическим KPI.</p></section>'
    : ''}
  ${forecastNotice}
  ${provisionalNote}
  ${!operationalMode&&showEquipmentNames?'<section class="reliability-chart-equipment-names" aria-label="Фильтр наименований оборудования"><div class="reliability-chart-multi-caption">Наименование оборудования</div><div class="reliability-chart-multi-buttons reliability-chart-equipment-name-buttons" role="group" aria-label="Выбор наименований оборудования">'+equipmentNameButtons+'</div></section>':''}
  <div class="reliability-chart-multi-bottom">
    <div class="reliability-chart-modal-ranges" role="group" aria-label="Период отображения">
      ${ranges.map(([id,label])=>`<button type="button" data-kpi-chart-range="${id}" aria-pressed="${state.range===id}" class="${state.range===id?'active':''}">${label}</button>`).join('')}
    </div>
    <div class="reliability-chart-modal-window" role="group" aria-label="Скользящий тренд">
      <span>Скользящий тренд</span>
      <button type="button" id="reliabilityKpiChartMinus" aria-label="Уменьшить окно" ${state.window<=1?'disabled':''}>−</button>
      <strong id="reliabilityKpiChartWindow">${state.window===1?'Выкл.':state.window+' '+
        (operationalMode?(state.scale==='day'?'дн.':state.scale==='week'?'нед.':'мес.'):'мес.')}</strong>
      <button type="button" id="reliabilityKpiChartPlus" aria-label="Увеличить окно" ${state.window>=12?'disabled':''}>+</button>
      <label class="reliability-chart-value-toggle"><input type="checkbox" id="reliabilityKpiChartValues"
        ${state.showPointValues?'checked':''}/> Подписи значений</label>
    </div>
  </div>
  ${operationalMode
    ? '<p class="reliability-chart-modal-slice">Д / Н / М — день, неделя, месяц. Значения по датам агрегируются из исходных событий, а скользящий тренд представляет среднее за выбранное число периодов.</p>'
    : renderKpiFormulaTiles(views,entry.id,entry.definition.unit)}`;
}
function bindReliabilityKpiChartDialog(dashboard) {
  const dialog=document.getElementById('reliabilityKpiChartDialog');
  const content=document.getElementById('reliabilityKpiChartBody');
  const title=document.getElementById('reliabilityKpiChartTitle');
  const close=document.getElementById('reliabilityKpiChartClose');
  const service=globalThis.ReclassifierReliabilityReportService;
  if(!dialog||!content||!close||!title||!service?.buildKpiChartMultiData)
    throw new Error('KPI chart dialog/service unavailable');
  function paint(){
    const profiler=globalThis.ReclassifierPerformanceProfiler;
    const draw=()=>{content.innerHTML=renderKpiChartModalBody();};
    if(profiler)profiler.measure('chart.ui.paint',draw);else draw();
    const timeline=content.querySelector?.('.reliability-chart-modal-scroll');
    if(timeline&&reliabilityKpiChartUiState.range==='all')timeline.scrollLeft=timeline.scrollWidth;
  }
  function fetchSeriesInner(){
    try{
      const state=reliabilityKpiChartUiState;
      state.data=service.buildKpiChartMultiData(state.kpiId,reliabilityDashboardFilterState,
        state.mineIds,state.classes,{range:state.range,window:state.window,
           equipmentNames:state.equipmentNames,
          fromMonth:state.fromMonth,toMonth:state.toMonth,
          forecastMethodId:kpiChartSelectedMethod(state)});
      if(['vbr','ktg'].includes(state.kpiId)&&state.data.availableFrom&&state.data.availableTo){
        if(state.range!=='custom') {
          const count={'1m':2,'3m':4,'1y':13,all:null}[state.range];
          const from=count===null?state.data.availableFrom:
            kpiChartMonthBefore(state.data.availableTo,count-1);
          state.fromMonth=from<state.data.availableFrom?
            state.data.availableFrom:from;
          state.toMonth=state.data.availableTo;
        }
        const signature=JSON.stringify([state.mineIds,state.classes,state.equipmentNames,state.fromMonth,state.toMonth,
          state.data.sources?.map(source=>[source.id,source.activeRevision,source.contentHash,source.freshness,source.rowCount])]);
        if(signature!==state.summaryKey){
          state.summary=service.buildKpiSelectionSummary(state.kpiId,
            reliabilityDashboardFilterState,state.mineIds,state.classes,
            {fromMonth:state.fromMonth,toMonth:state.toMonth,
              equipmentNames:state.equipmentNames});
          state.summaryKey=signature;
        }
      }
      if(state.metric!=='kpi')fetchOperational();else paint();
    }catch(error){
      content.innerHTML=`<p class="reliability-chart-modal-empty" role="alert">Ошибка подготовки графика: ${escapeHtml(error?.message||String(error))}</p>`;
    }
  }
  function fetchOperational(){
    const state=reliabilityKpiChartUiState;
    state.operational=null;
    state.operationalError=null;
    try{
      if(!service.buildOperationalChartData)throw new Error('Операционная детализация недоступна.');
      state.operational=service.buildOperationalChartData(
        state.metric,state.scale,reliabilityDashboardFilterState,
        state.mineIds,state.classes,{range:state.range,window:state.window,
          forecastMethodId:kpiChartSelectedMethod(state)});
    }catch(error){
      state.operationalError=error?.message||String(error);
    }
    paint();
  }
  function fetchSeries() {
    const profiler=globalThis.ReclassifierPerformanceProfiler;
    const run=()=>fetchSeriesInner();
    return profiler ? profiler.measure('chart.ui.fetch',run) : run();
  }
  reliabilityDashboardKpis(dashboard).forEach(item=>{
    const button=document.getElementById('reliabilityKpiChartOpen_'+item.id);
    if(!button)return;
    button.addEventListener('click',()=>{
      const state=reliabilityKpiChartUiState;
      state.kpiId=item.id;
      state.mineIds=reliabilityDashboardFilterState.mine&&reliabilityDashboardFilterState.mine!=='all'?
        [reliabilityDashboardFilterState.mine]:['all'];
      state.classes=reliabilityDashboardFilterState.equipmentClass&&
        reliabilityDashboardFilterState.equipmentClass!=='all'?
        [reliabilityDashboardFilterState.equipmentClass]:['stationary','mounted'];
      state.equipmentNames=[];
      state.range='1y';state.window=1;state.opener=button;state.showPointValues=false;
      state.metric='kpi';state.scale='month';state.forecastMethod=null;state.operational=null;state.operationalError=null;
      state.fromMonth=null;state.toMonth=null;state.summary=null;state.summaryKey=null;
      state.detailSeriesId=null;state.detailMonth=null;
      title.textContent='Динамика: '+item.title;
      // Measure the chart only after the dialog participates in layout;
      // otherwise clientWidth is zero and the plot stays fixed/left-aligned.
      if(typeof dialog.showModal==='function')dialog.showModal();
      fetchSeries();
      close.focus();
    });
  });
  close.addEventListener('click',()=>dialog.close());
  dialog.addEventListener('click',event=>{if(event.target===dialog)dialog.close();});
  dialog.addEventListener('close',()=>{
    const opener=reliabilityKpiChartUiState.opener;
    if(opener&&opener.isConnected!==false&&typeof opener.focus==='function'){
      try{opener.focus({preventScroll:true});}catch(_){opener.focus();}
    }
    reliabilityKpiChartUiState.opener=null;
  });
  content.addEventListener('change',event=>{
    const state=reliabilityKpiChartUiState;
    if(event.target?.id==='reliabilityKpiForecastMethod'){
      const key=state.metric==='kpi'?state.kpiId:state.metric;
      const preferences=globalThis.ReclassifierKpiForecastEngine?.forecastPreferences;
      try{
        if(preferences){
          preferences.set(key,event.target.value,'chart');
          state.forecastMethod=preferences.get(key);
        }else{
          if(!['auto','linear-trend','last-value','observed-run-rate'].includes(event.target.value))
            return;
          state.forecastMethod=event.target.value==='auto'?null:event.target.value;
        }
        if(state.metric!=='kpi')fetchOperational();
        else fetchSeries();
      }catch(_){event.target.value=preferences?.get(key)||state.forecastMethod||'auto';}
      return;
    }
    if(event.target?.id==='reliabilityKpiChartValues'){
      state.showPointValues=Boolean(event.target.checked);
      paint();return;
    }
    if(['vbr','ktg'].includes(state.kpiId)&&
       (event.target?.id==='reliabilityVbrFrom'||event.target?.id==='reliabilityVbrTo')){
      const calendar=kpiChartCalendar(state.data?.availableFrom,state.data?.availableTo);
      if(!calendar.length)return;
      const changedIndex=Math.max(0,Math.min(calendar.length-1,
        Number(event.target.value)||0));
      let first=Math.max(0,calendar.indexOf(state.fromMonth));
      let last=Math.max(first,calendar.indexOf(state.toMonth));
      if(event.target.id==='reliabilityVbrFrom') first=Math.min(changedIndex,last);
      else last=Math.max(changedIndex,first);
      state.fromMonth=calendar[first];state.toMonth=calendar[last];
      state.range='custom';fetchSeries();return;
    }
    if(event.target?.id==='reliabilityKpiFormulaSeries'){
      state.detailSeriesId=event.target.value;
      state.detailMonth=null;
      paint();
    }else if(event.target?.id==='reliabilityKpiFormulaMonth'){
      state.detailMonth=event.target.value;
      paint();
    }
  });
  content.addEventListener('keydown',event=>{
    if(event.key!=='Enter'&&event.key!==' ')return;
    const point=event.target?.closest?.('[data-kpi-chart-point-series]');
    if(!point)return;
    event.preventDefault?.();
    reliabilityKpiChartUiState.detailSeriesId=point.dataset.kpiChartPointSeries;
    reliabilityKpiChartUiState.detailMonth=point.dataset.kpiChartPointMonth;
    paint();
  });
  // Only changes in the selected population trigger a recalculation.
  // Window and range controls simply project the cached raw monthly series.
  content.addEventListener('click',event=>{
    const target=event.target, state=reliabilityKpiChartUiState;
    const point=target?.closest?.('[data-kpi-chart-point-series]');
    if(point?.dataset?.kpiChartPointSeries){
      state.detailSeriesId=point.dataset.kpiChartPointSeries;
      state.detailMonth=point.dataset.kpiChartPointMonth;
      paint();return;
    }
    const newMetric=target?.closest?.('[data-kpi-chart-metric]')?.dataset?.kpiChartMetric;
    if(newMetric&&['kpi','inc','labor'].includes(newMetric)){
      const wasOperational=state.metric!=='kpi';
      state.metric=newMetric;
      if(newMetric==='kpi'){
        state.scale='month';state.operational=null;fetchSeries();
      }else{
        if(state.range==='custom')state.range='1y';
        // Monthly scale makes the confirmed month forecast immediately
        // discoverable. Keep a user-selected D/Н/М scale across INC↔labor.
        if(!wasOperational)state.scale='month';
        fetchOperational();
      }
      return;
    }
    const newScale=target?.closest?.('[data-kpi-chart-scale]')?.dataset?.kpiChartScale;
    if(newScale&&['day','week','month'].includes(newScale)){
      if(state.metric!=='kpi'){state.scale=newScale;fetchOperational();}
      return;
    }
    const mine=target?.closest?.('[data-kpi-chart-mine]')?.dataset?.kpiChartMine;
    if(mine){
      if(state.mineIds.includes(mine)){
        if(state.mineIds.length===1)return;
        state.mineIds=state.mineIds.filter(id=>id!==mine);
      }else if(mine==='all')state.mineIds=['all'];
      else if(state.mineIds.length<3){
        state.mineIds=state.mineIds.length===1&&state.mineIds[0]==='all'?
          [mine]:[...state.mineIds,mine];
      }
      fetchSeries();return;
    }
    if(['vbr','ktg','classification_quality','classification_quality_cgps'].includes(state.kpiId)){
      if(target?.closest?.('[data-kpi-chart-equipment-name-all]')?.dataset?.kpiChartEquipmentNameAll){
        state.equipmentNames=[];fetchSeries();return;
      }
      const equipmentName=target?.closest?.('[data-kpi-chart-equipment-name]')?.dataset?.kpiChartEquipmentName;
      if(equipmentName){
        state.equipmentNames=state.equipmentNames.includes(equipmentName)
          ? state.equipmentNames.filter(name=>name!==equipmentName)
          : [...state.equipmentNames,equipmentName];
        fetchSeries();return;
      }
    }
    const cls=target?.closest?.('[data-kpi-chart-class]')?.dataset?.kpiChartClass;
    if(cls){
      if(state.classes.includes(cls)){
        if(state.classes.length===1)return;
        state.classes=state.classes.filter(id=>id!==cls);
      }else state.classes=[...state.classes,cls];
      // A class change can invalidate some of the chosen names.
      state.equipmentNames=[];
      fetchSeries();return;
    }
    const range=target?.closest?.('[data-kpi-chart-range]')?.dataset?.kpiChartRange;
    if(range&&['1m','3m','1y','all'].includes(range)){
      state.range=range;state.fromMonth=null;state.toMonth=null;
      if(state.metric==='kpi')fetchSeries();else fetchOperational();return;
    }
    if(target?.id==='reliabilityKpiChartPlus'||target?.id==='reliabilityKpiChartMinus'){
      state.window=Math.max(1,Math.min(12,state.window+
        (target.id==='reliabilityKpiChartPlus'?1:-1)));
      if(state.metric==='kpi')fetchSeries();else fetchOperational();
    }
  });
}
