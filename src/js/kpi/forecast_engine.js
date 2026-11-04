// Step 9: deterministic offline forecast adapters. No network or synthetic history.
(() => {
  'use strict';
  const catalog=globalThis.ReclassifierKpiCatalog;
  if(!catalog?.get)throw new Error('Forecast Engine requires KPI Catalog');
  const VERSION='1.0.0';
  const DEFAULTS=Object.freeze({methodId:'linear-trend',horizonMonths:1,minHistoryMonths:6,
    validationMonths:3,minimumImprovement:0});
  const OVERRIDES=Object.freeze({}); // Future per-KPI method changes go here; never change Calculator.
  const externalAdapter=Object.freeze({
    id:'corporate-ml-api',version:'1.0.0',mode:'external',status:'not-connected',
    // A future permitted corporate adapter can implement the same predict(history, context)
    // contract; no endpoint, token, or external request is embedded in offline HTML.
    inputContract:Object.freeze(['kpiId','history','horizonMonths','modelVersion','sourceRevisions']),
    outputContract:Object.freeze(['value','methodId','methodVersion','quality','horizon'])
  });
  function freeze(x){if(x&&typeof x==='object'&&!Object.isFrozen(x)){Object.values(x).forEach(freeze);Object.freeze(x);}return x;}
  function nextMonth(month){const y=Number(month.slice(0,4)),m=Number(month.slice(5,7));return m===12?String(y+1).padStart(4,'0')+'-01':month.slice(0,4)+'-'+String(m+1).padStart(2,'0');}
  function fit(points,horizon){
    const n=points.length, avgX=(n-1)/2;
    const mean=points.reduce((s,p)=>s+p.value,0)/n;
    let cov=0,variance=0;
    for(let i=0;i<n;i++){cov+=(i-avgX)*(points[i].value-mean);variance+=(i-avgX)**2;}
    return mean+(variance?cov/variance:0)*(n-1+horizon-avgX);
  }
  const adapters=Object.freeze({
    'linear-trend':Object.freeze({id:'linear-trend',version:'1.0.0',predict:(points,h)=>fit(points,h)}),
    'last-value':Object.freeze({id:'last-value',version:'1.0.0',predict:points=>points.at(-1).value})
  });
  function configFor(id,overrides={}){
    const entry=catalog.get(id);
    if(!entry)throw new Error('Unknown forecast KPI: '+id);
    const own=overrides[id]||OVERRIDES[id]||{};
    const config={...DEFAULTS,...own};
    if(!Number.isInteger(config.horizonMonths)||config.horizonMonths<1||config.horizonMonths>12)throw new Error('Invalid forecast horizon');
    if(!Number.isInteger(config.minHistoryMonths)||config.minHistoryMonths<4)throw new Error('Invalid forecast minimum history');
    if(!Number.isInteger(config.validationMonths)||config.validationMonths<2)throw new Error('Invalid forecast validation length');
    return freeze({...config,kpiId:id});
  }
  function unavailable(reason,config,extra={}){
    return freeze({value:null,dataState:'insufficient',reason,horizon:null,methodId:config.methodId,
      methodVersion:adapters[config.methodId]?.version||null,change:null,quality:null,
      requestedHorizonMonths:config.horizonMonths,...extra});
  }
  function predict(input={}){
    const id=input.kpiId,entry=catalog.get(id),config=configFor(id,input.overrides);
    if(!entry?.calculation)return unavailable('kpi-not-implemented',config,{dataState:'unavailable'});
    if(entry.calculation.temporal?.historicalSupported===false)
      return unavailable('historical-data-required',config);
    const adapter=adapters[config.methodId];
    if(!adapter)return unavailable('forecast-method-not-connected',config,{dataState:'unavailable'});
    const all=Array.from(input.points||[]).filter(p=>p?.period<=input.selectedMonth);
    if(all.length<config.minHistoryMonths)return unavailable('insufficient-history',config);
    const history=all.slice(-Math.max(config.minHistoryMonths,all.length));
    if(history.some(p=>p.dataState!=='available'||!Number.isFinite(p.value)))
      return unavailable('missing-or-invalid-history',config);
    for(let i=1;i<history.length;i++)if(nextMonth(history[i-1].period)!==history[i].period)
      return unavailable('noncontiguous-history',config);
    if(history.at(-1).period!==input.selectedMonth)return unavailable('latest-month-missing',config);
    const trials=Math.min(config.validationMonths,history.length-config.minHistoryMonths+1);
    if(trials<2)return unavailable('insufficient-validation-history',config);
    let modelError=0,baselineError=0,denom=0;
    for(let i=history.length-trials;i<history.length;i++){
      const train=history.slice(0,i),actual=history[i].value;
      const model=adapter.predict(train,1),baseline=adapters['last-value'].predict(train,1);
      modelError+=Math.abs(actual-model);
      baselineError+=Math.abs(actual-baseline);
      denom++;
    }
    const mae=modelError/denom,baselineMae=baselineError/denom;
    const quality=freeze({metric:'MAE',mae,baselineMae,validationMonths:denom,
      passed:mae<=baselineMae*(1-config.minimumImprovement)});
    if(!quality.passed)return unavailable('worse-than-naive-baseline',config,{quality});
    let value=adapter.predict(history,config.horizonMonths);
    if(!Number.isFinite(value))return unavailable('invalid-model-output',config,{quality,dataState:'error'});
    const unit=entry.definition?.unit;
    const constrained=unit==='%'?Math.max(0,Math.min(100,value)):Math.max(0,value);
    const horizon=Array.from({length:config.horizonMonths}).reduce(nextMonth,input.selectedMonth);
    return freeze({value:constrained,dataState:'available',reason:null,horizon,
      methodId:adapter.id,methodVersion:adapter.version,change:constrained-history.at(-1).value,
      quality,requestedHorizonMonths:config.horizonMonths,
      bounded:constrained!==value,source:'local-offline'});
  }

  // PR8: separate, explicitly provisional NOWCAST for the unfinished CURRENT
  // calendar month. Existing future-month forecast remains intentionally
  // unsupported for VBR/KTG: historical equipment fleet snapshots are absent.
  const CURRENT_MONTH_METHOD=Object.freeze({
    id:'monthly-components-remaining-days',version:'1.0.0',
    minHistoryMonths:6,validationMonths:2,maxHistoryMonths:12,minElapsedDays:4
  });
  const CURRENT_MONTH_COMPONENTS=Object.freeze({
    vbr:Object.freeze(['failureCount']),
    ktg:Object.freeze(['incidentHours','plannedMaintenanceHours',
      'unplannedMaintenanceHours','otherHours'])
  });
  const monthlyDays=month=>{
    const m=/^(\d{4})-(\d{2})$/.exec(String(month||''));
    if(!m||Number(m[2])<1||Number(m[2])>12)return null;
    return new Date(Date.UTC(Number(m[1]),Number(m[2]),0)).getUTCDate();
  };
  function currentUnavailable(id,reason,extra={}) {
    return freeze({
      value:null,dataState:'insufficient',reason,forecastType:'current-month-nowcast',
      kpiId:id,horizon:null,methodId:CURRENT_MONTH_METHOD.id,
      methodVersion:CURRENT_MONTH_METHOD.version,
      source:'local-offline',change:null,quality:null,...extra
    });
  }
  function projectRate(history,field) {
    // Actual month count or hours, divided by the ACTUAL number of days in
    // each historic calendar month. No interpolation of KPI percentages.
    const values=history.map(row=>({
      period:row.period,
      value:row.components[field]/monthlyDays(row.period)
    }));
    const lastN=CURRENT_MONTH_METHOD.maxHistoryMonths;
    const series=values.slice(-lastN);
    let linearErr=0,naiveErr=0;
    const trials=CURRENT_MONTH_METHOD.validationMonths;
    for(let i=series.length-trials;i<series.length;i++){
      const train=series.slice(0,i);
      const actual=series[i].value;
      linearErr+=Math.abs(actual-adapters['linear-trend'].predict(train,1));
      naiveErr+=Math.abs(actual-adapters['last-value'].predict(train,1));
    }
    const mae=linearErr/trials,baselineMae=naiveErr/trials;
    const useLinear=mae<=baselineMae+1e-12;
    const model=useLinear?adapters['linear-trend']:adapters['last-value'];
    const rawRate=model.predict(series,1);
    if(!Number.isFinite(rawRate))return null;
    return {
      expectedDailyRate:Math.max(0,rawRate),
      methodId:useLinear?'linear-trend':'last-value',
      boundedToZero:rawRate<0,
      validation:Object.freeze({metric:'MAE/day',mae,baselineMae,
        validationMonths:trials,linearAccepted:useLinear})
    };
  }
  function predictCurrentMonth(input={}) {
    const id=input.kpiId;
    if(!Object.hasOwn(CURRENT_MONTH_COMPONENTS,id))
      return currentUnavailable(id,'kpi-nowcast-not-supported',{dataState:'unavailable'});
    const selected=String(input.selectedMonth||'');
    const days=monthlyDays(selected);
    const date=String(input.asOf||'').slice(0,10);
    const utc=/^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
    const asOfDay=utc?Number(utc[3]):NaN;
    if(!days||!utc||date.slice(0,7)!==selected||
       !(asOfDay>=1&&asOfDay<=days)) {
      return currentUnavailable(id,'not-current-incomplete-month');
    }
    const remainingDays=days-asOfDay;
    if(!remainingDays)return currentUnavailable(id,'last-calendar-day-no-remaining-days');
    if(asOfDay<CURRENT_MONTH_METHOD.minElapsedDays)
      return currentUnavailable(id,'early-current-month');
    const current=input.current;
    if(current?.dataState!=='available'||!Number.isFinite(current?.value))
      return currentUnavailable(id,'current-components-unavailable');
    const expectedFields=CURRENT_MONTH_COMPONENTS[id];
    const all=Array.from(input.points||[]).filter(p=>
      typeof p?.period==='string' && p.period<selected);
    // Latest contiguous training window is mandatory. Missing/partial
    // observations never become zeros and never permit a fitted trend.
    const required=CURRENT_MONTH_METHOD.minHistoryMonths+
      CURRENT_MONTH_METHOD.validationMonths;
    if(all.length<required)return currentUnavailable(id,'insufficient-complete-history');
    const history=all.slice(-CURRENT_MONTH_METHOD.maxHistoryMonths);
    const year=Number(selected.slice(0,4)),month=Number(selected.slice(5,7));
    const previousMonth=new Date(Date.UTC(year,month-2,1)).toISOString().slice(0,7);
    if(history.at(-1).period!==previousMonth)
      return currentUnavailable(id,'previous-month-missing');
    for(let i=0;i<history.length;i++){
      const point=history[i],daysInPoint=monthlyDays(point.period);
      if(!daysInPoint||point.dataState!=='available'||!Number.isFinite(point.value)||
         point.diagnostics?.partialCoverage===true ||
         expectedFields.some(f=>!Number.isFinite(point.components?.[f])||
           point.components[f]<0)) {
        return currentUnavailable(id,'missing-or-partial-component-history');
      }
      if(i>0&&nextMonth(history[i-1].period)!==point.period)
        return currentUnavailable(id,'noncontiguous-component-history');
    }
    const projected={},modelQuality={};
    for(const field of expectedFields){
      const currentValue=current.components?.[field];
      if(!Number.isFinite(currentValue)||currentValue<0)
        return currentUnavailable(id,'invalid-current-component');
      const rate=projectRate(history,field);
      if(!rate)return currentUnavailable(id,'invalid-component-trend');
      projected[field]=currentValue+remainingDays*rate.expectedDailyRate;
      modelQuality[field]=rate;
    }
    let rawValue;
    const components={...projected};
    if(id==='vbr'){
      const baseline=current.components?.equipmentCount;
      if(!Number.isFinite(baseline)||baseline<=0)
        return currentUnavailable(id,'equipment-baseline-missing');
      components.equipmentCount=baseline;
      rawValue=(1-projected.failureCount/baseline)*100;
    }else{
      const calendarHours=current.components?.calendarHours;
      const population=current.components?.equipmentUnits;
      if(!Number.isFinite(calendarHours)||calendarHours<=0||
         !Number.isFinite(population)||population<=0)
        return currentUnavailable(id,'calendar-or-equipment-baseline-missing');
      const planned=projected.plannedMaintenanceHours;
      const availableHours=calendarHours-planned;
      if(availableHours<=0)
        return currentUnavailable(id,'projected-available-fund-nonpositive');
      const actualDowntimeHours=projected.incidentHours+
        planned+projected.unplannedMaintenanceHours+projected.otherHours;
      const productiveHours=calendarHours-actualDowntimeHours;
      Object.assign(components,{calendarHours,equipmentUnits:population,
        actualMaintenanceHours:planned,actualDowntimeHours,availableHours,productiveHours});
      rawValue=productiveHours/availableHours*100;
    }
    if(!Number.isFinite(rawValue))
      return currentUnavailable(id,'invalid-projected-kpi');
    const value=Math.max(0,Math.min(100,rawValue));
    const caveats=[
      'Прогноз завершения незакрытого месяца; не фактический KPI',
      'Фиксированный состав оборудования Drivers, без исторических снимков',
      'Текущий календарный день не экстраполируется; полнота выгрузки не проверена'
    ];
    if(current.diagnostics?.partialCoverage){
      caveats.push('Текущие длительности или наблюдения представлены частично');
    }
    if(Object.values(modelQuality).some(m=>m.methodId==='last-value')){
      caveats.push('Для части компонентов вместо линейного тренда использован последний уровень: ошибка MAE ниже');
    }
    return freeze({
      forecastType:'current-month-nowcast',kpiId:id,
      value,dataState:'available',reason:null,horizon:selected,
      methodId:CURRENT_MONTH_METHOD.id,
      methodVersion:CURRENT_MONTH_METHOD.version,
      methodComponents:modelQuality,
      source:'local-offline',
      change:value-current.value,
      asOf:date,calendarDays:days,elapsedDays:asOfDay,
      remainingDays,observedValue:current.value,
      observedComponents:Object.fromEntries(expectedFields.map(f=>[f,current.components[f]])),
      projectedComponents:components,
      quality:{status:current.diagnostics?.partialCoverage?'provisional-partial':'provisional',
        historicalMonths:history.length,validationMonths:CURRENT_MONTH_METHOD.validationMonths},
      bounded:rawValue!==value,
      populationBasis:'fixed-drivers-reference',
      caveats
    });
  }

  // PR-2: models for the last CERTIFIED incomplete REPORTING month.
  // Unlike the legacy calendar-day nowcast, this API has no clock fallback.
  // PR-3 will connect it to Report Snapshot.reportingCoverage and chart data.
  const REPORTING_STRATEGY=Object.freeze({
    id:'monthly-components-remaining-days',version:'2.0.0',
    defaultMethodId:'linear-trend',minimumElapsedDays:4
  });
  const REPORTING_METHODS=freeze({
    'observed-run-rate':{
      id:'observed-run-rate',version:'1.0.0',
      label:'Экстраполяция наблюдаемой суточной интенсивности',
      historyMonths:0,validation:'not-applicable'
    },
    'last-value':{
      id:'last-value',version:adapters['last-value'].version,
      label:'Интенсивность последнего завершённого месяца',
      historyMonths:1,validation:'not-applicable'
    },
    'linear-trend':{
      id:'linear-trend',version:adapters['linear-trend'].version,
      label:'Линейный тренд компонентов с проверкой MAE и резервной моделью',
      historyMonths:CURRENT_MONTH_METHOD.minHistoryMonths+
        CURRENT_MONTH_METHOD.validationMonths,
      validation:'MAE/day versus last-value',fallbackMethodId:'last-value'
    },
    'mixed-components':{
      id:'mixed-components',version:'1.0.0',
      label:'Различные проверенные модели для разных компонентов',
      historyMonths:null,validation:'per-component'
    }
  });
  const reportingMonthsBefore=(month,count)=>{
    const year=Number(month.slice(0,4)),m=Number(month.slice(5,7));
    return Array.from({length:count},(_,i)=>
      new Date(Date.UTC(year,m-2-i,1)).toISOString().slice(0,7)).reverse();
  };
  function reportingUnavailable(id,reason,method,coverage,extra={}) {
    return freeze({
      forecastType:'reporting-month-nowcast',kpiId:id,value:null,
      dataState:'insufficient',reason,horizon:null,
      methodId:method?.id||null,methodVersion:method?.version||null,
      requestedMethodId:method?.id||null,
      strategyId:REPORTING_STRATEGY.id,
      strategyVersion:REPORTING_STRATEGY.version,
      asOf:coverage?.coverageThrough||null,
      coverageThrough:coverage?.coverageThrough||null,
      source:'local-offline',quality:null,change:null,...extra
    });
  }
  // Exactly the required contiguous valid suffix, not all older history.
  // An invalid older point must never block a later fully valid 8-month run.
  function reportingHistory(input,month,fields,months,from) {
    if(months===0)return {history:[]};
    const required=reportingMonthsBefore(month,months);
    const requiredSet=new Set(required);
    // Ignore old invalid/duplicate months outside the required training suffix.
    const all=Array.from(input.points||[]).filter(p=>
      typeof p?.period==='string'&&requiredSet.has(p.period));
    const byPeriod=new Map();
    for(const row of all) {
      if(byPeriod.has(row.period))return {reason:'duplicate-component-period'};
      byPeriod.set(row.period,row);
    }
    if(!byPeriod.has(required.at(-1)))return {reason:'previous-month-missing'};
    if(required.some(period=>!byPeriod.has(period))) {
      const priorCount=Array.from(input.points||[]).filter(p=>
        typeof p?.period==='string'&&p.period<month).length;
      return {reason:priorCount<months
        ? 'insufficient-complete-history':'noncontiguous-component-history'};
    }
    const history=[];
    for(const period of required) {
      if(from>period+'-01')return {reason:'history-not-certified'};
      const row=byPeriod.get(period);
      if(row.dataState!=='available'||!Number.isFinite(row.value)||
         row.diagnostics?.partialCoverage===true||
         fields.some(field=>!Number.isFinite(row.components?.[field])||
           row.components[field]<0)) {
        return {reason:'missing-or-partial-component-history'};
      }
      history.push(row);
    }
    return {history};
  }
  function predictReportingMonth(input={}) {
    const id=input.kpiId;
    const fields=CURRENT_MONTH_COMPONENTS[id];
    const coverage=input.reportingCoverage;
    const requested=String(input.methodId||
      (coverage?.coverageBasis==='observed-event-horizon'
        ?'observed-run-rate':REPORTING_STRATEGY.defaultMethodId));
    const method=REPORTING_METHODS[requested];
    if(!fields)return reportingUnavailable(id,'kpi-nowcast-not-supported',method,coverage,{
      dataState:'unavailable'
    });
    if(!method||method.id==='mixed-components') {
      return reportingUnavailable(id,'forecast-method-not-connected',method,coverage,{
        dataState:'unavailable',requestedMethodId:requested
      });
    }
    // Not a current-date check: reportMonth may be a historical September
    // even if the user runs the application in October, December, etc.
    if(coverage?.reportMonthStatus==='complete'&&
       ['source-export-cutoff','observed-event-horizon'].includes(coverage.coverageBasis)) {
      return reportingUnavailable(id,'report-month-complete',method,coverage);
    }
    if(!coverage||coverage.reportMonthStatus!=='incomplete'||
       !['source-export-cutoff','observed-event-horizon'].includes(coverage.coverageBasis)) {
      return reportingUnavailable(id,coverage?.reportMonthReason||
        'reporting-cutoff-unconfirmed',method,coverage);
    }
    const month=String(coverage.reportMonth||'');
    const days=monthlyDays(month);
    const cutoff=String(coverage.coverageThrough||'');
    const from=String(coverage.coverageFrom||'');
    const match=/^(\d{4})-(\d{2})-(\d{2})$/.exec(cutoff);
    const cutoffDay=match?Number(match[3]):null;
    if(!days||!match||cutoff.slice(0,7)!==month||
       !cutoffDay||cutoffDay>=days||from>month+'-01'||
       !/^\d{4}-\d{2}-\d{2}$/.test(from)) {
      return reportingUnavailable(id,'invalid-reporting-cutoff',method,coverage);
    }
    if(input.selectedMonth&&input.selectedMonth!==month) {
      return reportingUnavailable(id,'selected-report-month-mismatch',method,coverage);
    }
    const remainingDays=days-cutoffDay;
    if(cutoffDay<REPORTING_STRATEGY.minimumElapsedDays) {
      return reportingUnavailable(id,'early-report-month',method,coverage);
    }
    const current=input.current;
    if(current?.dataState!=='available'||!Number.isFinite(current.value)) {
      return reportingUnavailable(id,'current-components-unavailable',method,coverage);
    }
    if(fields.some(field=>!Number.isFinite(current.components?.[field])||
      current.components[field]<0)) {
      return reportingUnavailable(id,'invalid-current-component',method,coverage);
    }
    const checked=reportingHistory(input,month,fields,method.historyMonths,from);
    if(checked.reason)return reportingUnavailable(id,checked.reason,method,coverage);
    const history=checked.history;
    const projected={},modelQuality={};
    for(const field of fields){
      const currentValue=current.components[field];
      let rate;
      if(method.id==='observed-run-rate'){
        rate={
          expectedDailyRate:currentValue/cutoffDay,
          methodId:method.id,methodVersion:method.version,
          boundedToZero:false,
          validation:{status:'not-applicable',reason:'no-historical-model'}
        };
      }else if(method.id==='last-value'){
        const previous=history.at(-1);
        rate={
          expectedDailyRate:previous.components[field]/monthlyDays(previous.period),
          methodId:method.id,methodVersion:method.version,
          boundedToZero:false,
          validation:{status:'not-applicable',reason:'last-complete-month'}
        };
      }else{
        // Adaptive linear regression: per-component validation against
        // last-value MAE, with truthful disclosure of fallback selection.
        rate=projectRate(history,field);
        if(rate)rate={
          ...rate,
          methodVersion:REPORTING_METHODS[rate.methodId].version
        };
      }
      if(!rate||!Number.isFinite(rate.expectedDailyRate)||rate.expectedDailyRate<0){
        return reportingUnavailable(id,'invalid-component-trend',method,coverage);
      }
      projected[field]=currentValue+remainingDays*rate.expectedDailyRate;
      modelQuality[field]=rate;
    }
    const applied=Array.from(new Set(Object.values(modelQuality).map(x=>x.methodId))).sort();
    const actualMethod=applied.length===1?REPORTING_METHODS[applied[0]]:
      REPORTING_METHODS['mixed-components'];
    const components={...projected};
    let rawValue;
    if(id==='vbr'){
      const baseline=current.components?.equipmentCount;
      if(!Number.isFinite(baseline)||baseline<=0) {
        return reportingUnavailable(id,'equipment-baseline-missing',method,coverage);
      }
      components.equipmentCount=baseline;
      rawValue=(1-projected.failureCount/baseline)*100;
    }else{
      const calendarHours=current.components?.calendarHours;
      const population=current.components?.equipmentUnits;
      if(!Number.isFinite(calendarHours)||calendarHours<=0||
         !Number.isFinite(population)||population<=0) {
        return reportingUnavailable(id,'calendar-or-equipment-baseline-missing',
          method,coverage);
      }
      const planned=projected.plannedMaintenanceHours;
      const availableHours=calendarHours-planned;
      if(availableHours<=0)return reportingUnavailable(id,
        'projected-available-fund-nonpositive',method,coverage);
      const actualDowntimeHours=projected.incidentHours+planned+
        projected.unplannedMaintenanceHours+projected.otherHours;
      const productiveHours=calendarHours-actualDowntimeHours;
      Object.assign(components,{calendarHours,equipmentUnits:population,
        actualMaintenanceHours:planned,actualDowntimeHours,
        availableHours,productiveHours});
      rawValue=productiveHours/availableHours*100;
    }
    if(!Number.isFinite(rawValue))return reportingUnavailable(id,
      'invalid-projected-kpi',method,coverage,{dataState:'error'});
    const value=Math.max(0,Math.min(100,rawValue));
    const caveats=[
      'Экспериментальный прогноз завершения отчётного месяца, не фактический KPI',
      'Фиксированный парк Drivers, исторических снимков состава оборудования нет'
    ];
    if(coverage.coverageBasis==='observed-event-horizon')
      caveats.push('Предварительная оценка по дате последнего события: полнота выгрузки не доказана.');
    if(current.diagnostics?.partialCoverage===true) {
      caveats.push('Часть текущих наблюдений или длительностей недоступна');
    }
    if(applied.includes('last-value')&&requested==='linear-trend'){
      caveats.push('Для части компонентов линейный тренд заменён методом last-value по MAE');
    }
    return freeze({
      forecastType:'reporting-month-nowcast',kpiId:id,
      value,dataState:'available',reason:null,horizon:month,
      methodId:actualMethod.id,methodVersion:actualMethod.version,
      requestedMethodId:requested,
      strategyId:REPORTING_STRATEGY.id,
      strategyVersion:REPORTING_STRATEGY.version,
      methodComponents:modelQuality,appliedMethodIds:applied,
      source:'local-offline',
      change:value-current.value,
      asOf:cutoff,coverageFrom:from,coverageThrough:cutoff,
      coverageBasis:coverage.coverageBasis,
      calendarDays:days,elapsedDays:cutoffDay,remainingDays,
      observedValue:current.value,
      observedComponents:Object.fromEntries(fields.map(f=>[f,current.components[f]])),
      projectedComponents:components,
      quality:{
        status:current.diagnostics?.partialCoverage?'provisional-partial':'provisional',
        historicalMonths:history.length,
        validationMonths:requested==='linear-trend'
          ?CURRENT_MONTH_METHOD.validationMonths:0,
        coverageStatus:coverage.reportMonthStatus
      },
      bounded:rawValue!==value,
      populationBasis:'fixed-drivers-reference',caveats
    });
  }


  // PR-7: absolute monthly metrics — INC count and valid Mobile Brigade labor.
  // They are not rates or percentages. The observed month-to-date volume is
  // retained, and only the remaining certified calendar days are projected.
  const REPORTING_VOLUME_METRICS=freeze({
    inc:{id:'inc',unit:'шт',sourceId:'itsm_data',roundToInteger:true,
      component:'incCount',label:'Завершённые INC'},
    labor:{id:'labor',unit:'чел.-ч',sourceId:'mobile_brigade_data',
      roundToInteger:false,component:'laborHours',label:'Трудозатраты МБ'},
    total_labor:{id:'total_labor',unit:'чел.-ч',sourceId:'mobile_brigade_data',
      roundToInteger:false,component:'laborHours',label:'Общая трудоёмкость'},
    avr_labor:{id:'avr_labor',unit:'чел.-ч',sourceId:'mobile_brigade_data',
      roundToInteger:false,component:'laborHours',label:'Трудоёмкость АВР'},
    maintenance_labor:{id:'maintenance_labor',unit:'чел.-ч',
      sourceId:'mobile_brigade_data',roundToInteger:false,
      component:'laborHours',label:'Трудоёмкость ТО'},
    corrective_labor:{id:'corrective_labor',unit:'чел.-ч',
      sourceId:'mobile_brigade_data',roundToInteger:false,
      component:'laborHours',label:'Трудоёмкость корректирующих работ'}
  });
  function volumeUnavailable(id,reason,method,coverage,extra={}){
    return reportingUnavailable(id,reason,method,coverage,{
      forecastType:'reporting-month-volume-nowcast',
      kpiId:REPORTING_VOLUME_METRICS[id]&&id!=='inc'&&id!=='labor'?id:null,
      metricId:id,unit:REPORTING_VOLUME_METRICS[id]?.unit||null,
      observedValue:null,remainingValue:null,
      ...extra
    });
  }
  function predictReportingMetric(input={}) {
    const id=String(input.metricId||'');
    const spec=REPORTING_VOLUME_METRICS[id];
    const coverage=input.reportingCoverage;
    const requested=String(input.methodId||
      (coverage?.coverageBasis==='observed-event-horizon'
        ?'observed-run-rate':REPORTING_STRATEGY.defaultMethodId));
    const method=REPORTING_METHODS[requested];
    if(!spec)return volumeUnavailable(id,'absolute-metric-not-supported',
      method,coverage,{dataState:'unavailable'});
    if(!method||method.id==='mixed-components')return volumeUnavailable(
      id,'forecast-method-not-connected',method,coverage,{
        dataState:'unavailable',requestedMethodId:requested
      });
    if(coverage?.reportMonthStatus==='complete'&&
       ['source-export-cutoff','observed-event-horizon'].includes(coverage.coverageBasis))
      return volumeUnavailable(id,'report-month-complete',method,coverage);
    if(!coverage||coverage.reportMonthStatus!=='incomplete'||
       !['source-export-cutoff','observed-event-horizon'].includes(coverage.coverageBasis)){
      return volumeUnavailable(id,coverage?.reportMonthReason||
        'reporting-cutoff-unconfirmed',method,coverage);
    }
    if(coverage.sourceId!==spec.sourceId)
      return volumeUnavailable(id,'metric-source-coverage-mismatch',method,coverage);
    const month=String(coverage.reportMonth||'');
    const days=monthlyDays(month);
    const cutoff=String(coverage.coverageThrough||'');
    const from=String(coverage.coverageFrom||'');
    const match=/^(\d{4})-(\d{2})-(\d{2})$/.exec(cutoff);
    const cutoffDay=match?Number(match[3]):null;
    if(!days||!match||cutoff.slice(0,7)!==month||
       !cutoffDay||cutoffDay>=days||from>month+'-01'||
       !/^\d{4}-\d{2}-\d{2}$/.test(from))
      return volumeUnavailable(id,'invalid-reporting-cutoff',method,coverage);
    if(input.selectedMonth&&input.selectedMonth!==month)
      return volumeUnavailable(id,'selected-report-month-mismatch',method,coverage);
    if(cutoffDay<REPORTING_STRATEGY.minimumElapsedDays)
      return volumeUnavailable(id,'early-report-month',method,coverage);
    const current=input.current;
    if(current?.dataState!=='available'||!Number.isFinite(current.value))
      return volumeUnavailable(id,'current-components-unavailable',method,coverage);
    if(current.value<0)return volumeUnavailable(id,'invalid-current-component',
      method,coverage);
    if(current?.diagnostics?.partialCoverage===true||
       current?.partialCoverage===true)
      return volumeUnavailable(id,'current-volume-partial-coverage',method,coverage);
    // Convert the historical absolute VALUE to a single component, retaining
    // all existing historical coverage guards and MAE/day fallback semantics.
    const transformed=Array.from(input.points||[]).map(p=>({
      period:p?.period,
      dataState:p?.dataState||'no-data',value:p?.value,
      components:{metricValue:p?.value},
      diagnostics:{partialCoverage:Boolean(
        p?.partialCoverage||p?.diagnostics?.partialCoverage)}
    }));
    const checked=reportingHistory({points:transformed},month,
      ['metricValue'],method.historyMonths,from);
    if(checked.reason)
      return volumeUnavailable(id,checked.reason,method,coverage);
    const history=checked.history;
    let rate;
    if(method.id==='observed-run-rate'){
      rate={expectedDailyRate:current.value/cutoffDay,
        methodId:method.id,methodVersion:method.version,
        boundedToZero:false,
        validation:{status:'not-applicable',reason:'no-historical-model'}};
    }else if(method.id==='last-value'){
      const prev=history.at(-1);
      rate={expectedDailyRate:prev.value/monthlyDays(prev.period),
        methodId:method.id,methodVersion:method.version,
        boundedToZero:false,
        validation:{status:'not-applicable',reason:'last-complete-month'}};
    }else{
      const picked=projectRate(history,'metricValue');
      rate=picked&&{...picked,
        methodVersion:REPORTING_METHODS[picked.methodId].version};
    }
    if(!rate||!Number.isFinite(rate.expectedDailyRate)||
       rate.expectedDailyRate<0)
      return volumeUnavailable(id,'invalid-component-trend',method,coverage);
    const remainingDays=days-cutoffDay;
    const remainingValue=remainingDays*rate.expectedDailyRate;
    const rawProjectedValue=current.value+remainingValue;
    const projectedValue=spec.roundToInteger
      ?Math.round(rawProjectedValue):rawProjectedValue;
    if(!Number.isFinite(projectedValue))
      return volumeUnavailable(id,'invalid-projected-volume',method,coverage,
        {dataState:'error'});
    const notes=[
      'Экспериментальный прогноз абсолютной метрики за полный отчётный месяц',
      'Факт за доступные дни сохраняется отдельно и не заменяется прогнозом',
      'Количество INC учитывается по дате выполнения, часы МБ — по дате фактических работ'
    ];
    if(coverage.coverageBasis==='observed-event-horizon')
      notes.push('Предварительная оценка: дата последнего события не подтверждает полноту загруженных данных.');
    if(spec.roundToInteger)notes.push(
      'Прогноз количества INC округляется до целого; суточная интенсивность остаётся дробной');
    if(method.id==='linear-trend'&&rate.methodId==='last-value')
      notes.push('По MAE линейный тренд заменён последним завершённым месяцем');
    return freeze({
      forecastType:'reporting-month-volume-nowcast',
      metricId:id,kpiId:id==='inc'||id==='labor'?null:id,
      unit:spec.unit,value:projectedValue,
      rawProjectedValue,observedValue:current.value,remainingValue,
      dataState:'available',reason:null,horizon:month,
      methodId:rate.methodId,methodVersion:rate.methodVersion,
      requestedMethodId:requested,
      strategyId:REPORTING_STRATEGY.id,strategyVersion:REPORTING_STRATEGY.version,
      methodComponents:{[spec.component]:rate},
      source:'local-offline',sourceId:spec.sourceId,
      asOf:cutoff,coverageFrom:from,coverageThrough:cutoff,
      coverageBasis:coverage.coverageBasis,
      calendarDays:days,elapsedDays:cutoffDay,remainingDays,
      change:projectedValue-current.value,
      quality:{status:coverage.coverageBasis==='observed-event-horizon'
          ?'provisional-observed-only':'provisional',
        historicalMonths:history.length,
        validationMonths:requested==='linear-trend'
          ?CURRENT_MONTH_METHOD.validationMonths:0,
        coverageStatus:coverage.reportMonthStatus},
      rounding:spec.roundToInteger?'nearest-integer':'none',
      caveats:notes
    });
  }

  // PR-4: Forecast Strategy Registry.
  // Routes existing, audited algorithms. No new mathematics or presentation.
  // The factory permits *developer-registered* KPI-specific strategies in a
  // separate instance; the application's default registry is built-in only.
  function createStrategyRegistry() {
    const strategies=new Map(),selected=new Map();
    const builtin=[
      {id:'historical-next-month',version:VERSION,policy:'historical-next-month',
        methodIds:['linear-trend','last-value'],
        invoke:input=>predict(input)},
      {id:'reporting-month-components',version:REPORTING_STRATEGY.version,
        policy:'reporting-month-components',
        methodIds:['observed-run-rate','last-value','linear-trend'],
        invoke:input=>predictReportingMonth(input)},
      {id:'reporting-month-volume',version:REPORTING_STRATEGY.version,
        policy:'reporting-month-volume',
        methodIds:['observed-run-rate','last-value','linear-trend'],
        invoke:input=>predictReportingMetric(input)}
    ];
    for(const item of builtin)strategies.set(item.id,{
      ...item,kind:'builtin',kpiIds:null
    });
    const descriptor=(strategy,kpiId=null)=>{
      if(!strategy)return null;
      return freeze({
        id:strategy.id,version:strategy.version,policy:strategy.policy,
        kind:strategy.kind,status:'connected',
        methodIds:[...strategy.methodIds],
        kpiId,
        defaultMethodId:strategy.policy==='historical-next-month'
          ?DEFAULTS.methodId:REPORTING_STRATEGY.defaultMethodId,
        // Observed-event coverage deliberately overrides the reporting-month
        // default in the underlying certified algorithm.
        defaultDependsOnCoverage:strategy.policy!=='historical-next-month'
      });
    };
    function forKpi(id){
      const spec=catalog.getV2?.(id);
      if(!spec||spec.forecast.policy==='none')return null;
      return descriptor(strategies.get(selected.get(id)||spec.forecast.policy),id);
    }
    function forMetric(id){
      if(!REPORTING_VOLUME_METRICS[id])return null;
      return descriptor(strategies.get('reporting-month-volume'),id);
    }
    function predictForKpi(input={}){
      const id=String(input.kpiId||'');
      const spec=catalog.getV2?.(id);
      if(!spec)throw new Error('Unknown forecast KPI: '+id);
      if(spec.forecast.policy==='none')return predict(input);
      const strategy=strategies.get(selected.get(id)||spec.forecast.policy);
      if(!strategy)throw new Error('Missing forecast strategy: '+spec.forecast.policy);
      const normalized=strategy.policy==='reporting-month-volume'
        ? {...input,metricId:id}
        : input;
      const result=strategy.invoke(normalized);
      if(strategy.kind==='builtin')return result;
      // Fail closed: a new custom strategy cannot publish a fabricated
      // available forecast with an invalid value or undeclared method.
      if(!result||!['available','insufficient','unavailable','error'].includes(result.dataState)||
         !strategy.methodIds.includes(result.methodId)||
         typeof result.methodVersion!=='string'||!result.methodVersion||
         (result.dataState==='available'
           ?(!Number.isFinite(result.value)||result.value<0||
             (catalog.get(id)?.definition?.unit==='%'&&result.value>100)||
             typeof result.horizon!=='string'||!/^\d{4}-(0[1-9]|1[0-2])$/.test(result.horizon)||
             (strategy.policy==='historical-next-month'
               ? result.horizon!==nextMonth(String(input.selectedMonth||''))
               : result.horizon!==input.reportingCoverage?.reportMonth))
           :result.value!==null)){
        return freeze({
          kpiId:id,value:null,dataState:'unavailable',
          reason:'forecast-strategy-invalid-result',
          methodId:null,methodVersion:null,horizon:null,
          strategyId:strategy.id,strategyVersion:strategy.version
        });
      }
      return freeze({...result,kpiId:id,
        strategyId:strategy.id,strategyVersion:strategy.version});
    }
    function predictForMetric(input={}){
      const id=String(input.metricId||'');
      // Includes operational INC/labor as well as the four labor KPIs.
      // No default method is substituted here: the original engine still
      // decides based on source-export versus observed-event coverage.
      return predictReportingMetric({...input,metricId:id});
    }
    function registerStrategy(config={}){
      const {id,version,policy,methodIds,kpiIds,predict:run}=config;
      if(typeof id!=='string'||!/^[a-z][a-z0-9-]*$/.test(id)||
         strategies.has(id)||typeof version!=='string'||
         !/^\d+\.\d+\.\d+$/.test(version)||
         !['historical-next-month','reporting-month-components',
           'reporting-month-volume'].includes(policy)||
         !Array.isArray(methodIds)||!methodIds.length||
         methodIds.some(value=>typeof value!=='string'||!value)||
         new Set(methodIds).size!==methodIds.length||
         !Array.isArray(kpiIds)||!kpiIds.length||
         new Set(kpiIds).size!==kpiIds.length||
         kpiIds.some(value=>catalog.getV2?.(value)?.forecast.policy!==policy)||
         typeof run!=='function')
        throw new Error('Invalid or incompatible custom forecast strategy');
      const item={
        id,version,policy,kind:'custom',
        methodIds:[...methodIds],kpiIds:[...kpiIds],invoke:run
      };
      strategies.set(id,item);
      return descriptor(item);
    }
    function assignKpi(kpiId,strategyId){
      const entry=catalog.getV2?.(kpiId);
      const strategy=strategies.get(strategyId);
      if(!entry||!strategy||strategy.kind!=='custom'||
         strategy.policy!==entry.forecast.policy||
         !strategy.kpiIds.includes(kpiId))
        throw new Error('Forecast strategy cannot be assigned to KPI '+String(kpiId));
      selected.set(kpiId,strategyId);
      return forKpi(kpiId);
    }
    function restoreDefault(kpiId){
      if(!catalog.getV2?.(kpiId))throw new Error('Unknown forecast KPI: '+kpiId);
      selected.delete(kpiId);
      return forKpi(kpiId);
    }
    function list(){
      return freeze(Array.from(strategies.values(),item=>descriptor(item)));
    }
    return Object.freeze({
      version:'1.0.0',list,forKpi,forMetric,
      predictForKpi,predictForMetric,
      registerStrategy,assignKpi,restoreDefault
    });
  }
  const strategyRegistry=createStrategyRegistry();

  // PR-5: transient ANALYTICAL method selection. It never modifies the
  // Calculator, cached Report Snapshot, exported PDF or built-in defaults.
  // State is keyed by the KPI (operational 'inc'/'labor' use their own IDs).
  function createForecastPreferences() {
    const selected=new Map();
    const listeners=new Set();
    function methodsFor(id){
      const kpi=catalog.getV2?.(id);
      if(kpi?.forecast.policy&&kpi.forecast.policy!=='none')
        return [...strategyRegistry.forKpi(id)?.methodIds||[]];
      if(id==='inc'||id==='labor')
        return [...strategyRegistry.forMetric(id)?.methodIds||[]];
      return [];
    }
    function get(id){return selected.get(String(id||''))||null;}
    function set(id,methodId,origin=''){
      const key=String(id||'');
      const available=methodsFor(key);
      if(!available.length)throw new Error('Forecast method is not configurable for '+key);
      const value=methodId===null||methodId===undefined||methodId==='auto'?null:String(methodId);
      if(value!==null&&!available.includes(value))
        throw new Error('Unsupported forecast method '+value+' for '+key);
      if(get(key)===value)return value;
      if(value===null)selected.delete(key);else selected.set(key,value);
      for(const handler of Array.from(listeners))handler(freeze({kpiId:key,methodId:value,origin}));
      return value;
    }
    function subscribe(handler){
      if(typeof handler!=='function')throw new Error('Forecast preference listener must be a function');
      listeners.add(handler);
      return ()=>listeners.delete(handler);
    }
    return Object.freeze({methodsFor,get,set,subscribe});
  }
  const forecastPreferences=createForecastPreferences();

  const api=Object.freeze({version:VERSION,defaults:DEFAULTS,overrides:OVERRIDES,adapters,
    externalAdapter,configFor,predict,CURRENT_MONTH_METHOD,predictCurrentMonth,
    REPORTING_STRATEGY,REPORTING_METHODS,predictReportingMonth,
    REPORTING_VOLUME_METRICS,predictReportingMetric,
    strategyRegistry,createStrategyRegistry,
    forecastPreferences,createForecastPreferences});
  globalThis.ReclassifierKpiForecastEngine=api;
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
})();
