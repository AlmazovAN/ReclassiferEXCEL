// FILE CONTRACT: full-history KPI chart with calendar-aligned axis ticks and methodology-correct rolling series.
// Reads: existing KPI Report View points and the versioned Calculation Contract in KPI Catalog.
// Writes: immutable SVG/table-ready values only; no Datasets, new KPI formulas, forecasts or SQL.
// Ratio rolling is SUM(numerators) / SUM(denominators), NEVER average of percentages.
(() => {
  'use strict';

  const catalog = globalThis.ReclassifierKpiCatalog;
  const dates = globalThis.ReclassifierKpiReportViewModel;
  if (!catalog?.getCalculation || !dates?.monthId || !dates?.previousMonth) {
    throw new Error('KPI Chart View Model requires Catalog and Report View Model.');
  }

  const VERSION = '1.1.0';
  // These values describe axis graduation, never a historical data range.
  const AXIS_STEPS = Object.freeze({month:1,quarter:3,halfyear:6,year:12});
  const MAX_WINDOW = 12;
  const RANGE_MONTHS=Object.freeze({'1m':2,'3m':4,'1y':13,all:null,custom:null});

  function freeze(value) {
    if (value && typeof value === 'object' && !Object.isFrozen(value)) {
      Object.values(value).forEach(freeze);
      Object.freeze(value);
    }
    return value;
  }

  function preceding(month, count) {
    let value = dates.monthId(month);
    if (!value || !Number.isInteger(count) || count < 0 || count > 1200) return null;
    for (let i=0; i<count; i+=1) value=dates.previousMonth(value);
    return value;
  }

  function nextMonth(month) {
    const id=dates.monthId(month);
    if (!id) return null;
    const year=Number(id.slice(0,4)),m=Number(id.slice(5,7));
    return m===12
      ? String(year+1).padStart(4,'0')+'-01'
      : id.slice(0,4)+'-'+String(m+1).padStart(2,'0');
  }

  function ratioFields(contract) {
    // The last DIVIDE in the ACTUAL Calculation Contract determines the ratio.
    // No independent per-KPI mapping or duplicated expression evaluation.
    const divide = Array.from(contract.steps).filter(step=>step.operation==='DIVIDE').pop();
    const fields=divide?.inputs;
    if (!fields || fields.length !== 2 || fields.some(x=>typeof x!=='string' || !x)) {
      return null;
    }
    return fields;
  }

  function rolling(input = {}) {
    const id=input.kpiId;
    const contract=catalog.getCalculation(id);
    const points=Array.from(input.points || []);
    const temporal=contract?.temporal?.rolling;
    // VBR and KTG can be recalculated from real monthly components using one
    // fixed, undated equipment baseline. This is a retrospective estimate,
    // not historical equipment inventory or a forecast.
    const expression=contract?.formula?.expression;
    const vbr= id==='vbr' && expression==='(1 - FailureCount / EquipmentCount) × 100';
    const ktg= id==='ktg' && expression==='(CalendarHours - IncidentHours - ActualMaintenanceHours - UnplannedMaintenanceHours - OtherHours) / (CalendarHours - PlannedMaintenanceHours) × 100';
    const method=vbr?'vbr-fixed-population':ktg?'ktg-fixed-population':(temporal?.method || 'unavailable');
    const min=1;
    const max=MAX_WINDOW;
    const window=Number(input.window ?? temporal?.defaultWindow ?? 4);

    if (!Number.isInteger(window) || window<min || window>max) {
      throw new Error('KPI moving window must be an integer from '+min+' to '+max+'.');
    }
    const ratio=method==='ratio-of-sums' ? ratioFields(contract) : null;
    const supported= vbr||ktg||(
      (method==='average'||(method==='ratio-of-sums' && Boolean(ratio))) &&
      contract?.temporal?.historicalSupported!==false
    );
    const results=points.map((point,index)=>{
      if (window===1) {
        return {period:point.period,value:null,dataState:'disabled',reason:'trend-disabled',window};
      }
      if (!supported) {
        return {period:point.period,value:null,dataState:'unavailable',
          reason:method==='unavailable' || contract?.temporal?.historicalSupported===false
            ? 'historical-data-required':'rolling-method-not-supported',window};
      }
      if (index+1<window) {
        return {period:point.period,value:null,dataState:'insufficient',reason:'incomplete-rolling-window',window};
      }
      const subset=points.slice(index+1-window,index+1);
      const contiguous=subset.every((candidate,i)=>i===0 ||
        candidate.period===nextMonth(subset[i-1].period));
      if (!contiguous || subset.some(p=>p?.dataState!=='available'||!Number.isFinite(p.value))) {
        return {period:point.period,value:null,dataState:'insufficient',
          reason:'missing-or-unavailable-month',window};
      }
      let value=null;
      if (method==='average') {
        value=subset.reduce((total,p)=>total+p.value,0)/window;
      } else {
        const [numerator,denominator]=vbr?['failureCount','equipmentCount']:
          ktg?['productiveHours','availableHours']:ratio;
        const components=subset.map(p=>p.components||{});
        if (!components.every(c=>Number.isFinite(c[numerator]) && Number.isFinite(c[denominator]))) {
          return {period:point.period,value:null,dataState:'insufficient',
            reason:'missing-ratio-components',window};
        }
        const num=components.reduce((t,c)=>t+c[numerator],0);
        const den=components.reduce((t,c)=>t+c[denominator],0);
        if (den<=0) {
          return {period:point.period,value:null,dataState:'insufficient',
            reason:'rolling-denominator-zero',window};
        }
        value=(vbr?1-num/den:num/den)*100;
      }
      return {period:point.period,value:Number.isFinite(value)?value:null,
        dataState:Number.isFinite(value)?'available':'error',
        reason:Number.isFinite(value)?null:'invalid-rolling-arithmetic',window};
    });
    return freeze({method,window,minimum:min,maximum:max,supported,
      numerator:ratio?.[0]||null,denominator:ratio?.[1]||null,points:results});
  }

  function axisTicks(points,step) {
    if (!Object.prototype.hasOwnProperty.call(AXIS_STEPS,step)) {
      throw new Error('Unsupported KPI chart axis step: '+step);
    }
    const n=points.length,months=AXIS_STEPS[step];
    if (!n)return freeze([]);
    const boundaries=[];
    for(let i=0;i<n;i++) {
      const period=dates.monthId(points[i].period);
      if (!period)continue;
      const m=Number(period.slice(5,7));
      if ((m-1)%months===0)boundaries.push(i);
    }
    const indices=new Set(boundaries);
    if(!boundaries.length||boundaries[0]>=Math.ceil(months/2))indices.add(0);
    // If the selected slice has no calendar boundary, label both endpoints.
    // Otherwise keep only true calendar graduations to avoid misleading extra ticks.
    if(!boundaries.length)indices.add(n-1);
    return freeze(Array.from(indices).sort((a,b)=>a-b).map(index=>{
      const period=dates.monthId(points[index].period);
      const year=period?.slice(0,4)||'';
      const month=Number(period?.slice(5,7));
      const aligned=Number.isInteger(month) && (month-1)%months===0;
      let label=period ? period.slice(5,7)+'.'+year.slice(2) : String(points[index].period);
      if(aligned && step==='quarter')label=(Math.floor((month-1)/3)+1)+' кв. '+year;
      if(aligned && step==='halfyear')label=(month<=6?'I':'II')+' п/г '+year;
      if(aligned && step==='year')label=year;
      return {index,period:points[index].period,label};
    }));
  }

  function visibleMonths(range='all') {
    if(!Object.prototype.hasOwnProperty.call(RANGE_MONTHS,range))
      throw new Error('Unsupported KPI chart range: '+range);
    return RANGE_MONTHS[range];
  }

  function project(input = {}) {
    const axisStep=String(input.axisStep||'month');
    if (!Object.prototype.hasOwnProperty.call(AXIS_STEPS,axisStep)) {
      throw new Error('Unsupported KPI chart axis step: '+axisStep);
    }
    const series=input.series;
    const id=String(input.kpiId||'');
    if (!series || series.kpiId!==id)throw new Error('KPI chart series mismatch');
    const selected=dates.monthId(input.selectedMonth);
    const points=Array.from(series.points||[]);
    const roll=rolling({kpiId:id,points,window:input.window});
    // Calculate rolling components on the full historical series first.
    // Cropping affects display only, never the rolling arithmetic.
    const displayRange=String(input.range||'all');
    const visibleCount=visibleMonths(displayRange);
    const available=points.map((p,i)=>({period:p.period,value:p.value,
      dataState:p.dataState,reason:p.reason,
      partialCoverage:Boolean(p.partialCoverage),
      excludedUnverifiedRequestRows:p.excludedUnverifiedRequestRows||0,
      rollingValue:roll.points[i].value,
      rollingState:roll.points[i].dataState,
      rollingReason:roll.points[i].reason}))
      .filter(p=>!selected||p.period<=selected);
    const visible=visibleCount===null?available:available.slice(-visibleCount);
    return freeze({kpiId:id,axisStep,range:displayRange,
      axisTicks:axisTicks(visible,axisStep),
      selectedMonth:selected,window:roll.window,
      rollingMethod:roll.method,rollingSupported:roll.supported,
      numerator:roll.numerator,denominator:roll.denominator,
      points:visible,hasData:visible.some(p=>Number.isFinite(p.value))});
  }

  const api=Object.freeze({version:VERSION,axisSteps:Object.freeze(Object.keys(AXIS_STEPS)),
    ranges:Object.freeze(Object.keys(RANGE_MONTHS)),
    preceding,ratioFields,rolling,axisTicks,project});
  globalThis.ReclassifierKpiChartViewModel=api;
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
})();
