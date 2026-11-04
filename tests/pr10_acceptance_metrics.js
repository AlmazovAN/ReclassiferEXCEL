'use strict';
// PR10: auditable, fixed-schema CI measurements. No Dataset rows, mine names,
// equipment names, filter values, source identifiers, or request content.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const BASELINE=Object.freeze({
  reference:'PR1 / pre-optimisation offline Chromium, representative run',
  reportColdMs:8695.1,reportWarmMs:0.1,
  chartSixSeries13MonthsMs:116.9,chartRepeatMs:1.2,
  // Historical observations are NOT performance budgets or guaranteed
  // reproducible baselines; runner CPU, heap and build sizes may differ.
  machineComparable:false
});
const FIELDS=Object.freeze(['reportColdMs','reportWarmMs',
  'chartSixSeries13MonthsMs','chartRepeatMs','chartFullHistoryMs',
  'passportInitialDomMs','passportFirstFrameMs','passportFullDataMs',
  'dashboardReadyMs','filterCycleMs','browserUsedHeapBytes',
  'browserHeapAfterBytes','browserHeapPeakBytes','pdfBytes','sqliteBytes',
  'htmlBytes','exportedHtmlBytes','totalDatasetRows','itsmRows',
  'sourceCount','networkRequests','cacheHits','cacheMisses','cacheSize',
  'cacheCapacity','factualKpisCompared','monthsCompared']);
const REQUIRED=['reportColdMs','reportWarmMs','chartSixSeries13MonthsMs',
  'chartRepeatMs','pdfBytes','sqliteBytes','htmlBytes','totalDatasetRows',
  'itsmRows','networkRequests','factualKpisCompared'];
function positive(field,value){
  return FIELDS.includes(field)&&
    (value===null||(typeof value==='number'&&Number.isFinite(value)&&value>=0));
}
function createReport(input={}){
  const measurements={};
  for(const field of FIELDS){
    const value=Object.hasOwn(input,field)?input[field]:null;
    if(!positive(field,value))
      throw new TypeError('Invalid PR10 numeric measurement: '+field);
    measurements[field]=value;
  }
  for(const field of REQUIRED)
    assert(Number.isFinite(measurements[field]),'Missing acceptance metric '+field);
  assert(measurements.totalDatasetRows>250000,
    'FULL HTML fixture coverage fell below the declared baseline scope');
  assert.equal(measurements.itsmRows,50331);
  assert.equal(measurements.networkRequests,0,
    'Local HTML must make zero external network attempts');
  assert(measurements.factualKpisCompared>=13,
    'Complete Worker vs Calculator result comparison required');
  assert(measurements.cacheCapacity===null||
    measurements.cacheSize<=measurements.cacheCapacity,
    'Materialized cache may never exceed its configured bound');
  const delta={};
  for(const name of ['reportColdMs','reportWarmMs',
    'chartSixSeries13MonthsMs','chartRepeatMs']){
    const value=measurements[name];
    delta[name]=value===null?null:Number((value-BASELINE[name]).toFixed(3));
  }
  return Object.freeze({
    schemaVersion:1,project:'Reclassifier',purpose:'PR10 final offline acceptance',
    measuredOn:'github-actions-chromium',
    baseline:BASELINE,
    comparisonCaveat:'One CI run on a different machine: deltas are informative, not a statistically validated speedup.',
    measurements:Object.freeze(measurements),
    deltaFromPr1Ms:Object.freeze(delta),
    safety:{
      noExternalRequests:true,
      immutableCalculatorParity:true,
      evidence:'Offline Chromium and deterministic Node tests',
      noRawData:true
    }
  });
}
function writeReport(file,values){
  const report=createReport(values);
  fs.mkdirSync(path.dirname(file),{recursive:true});
  fs.writeFileSync(file,JSON.stringify(report,null,2)+'\n');
  return report;
}
module.exports={BASELINE,FIELDS,createReport,writeReport};
if(require.main===module){
  assert.throws(()=>createReport({}),/Missing acceptance metric/);
  const good={reportColdMs:8500,reportWarmMs:0.1,
    chartSixSeries13MonthsMs:120,chartRepeatMs:1.2,pdfBytes:100000,
    sqliteBytes:330000000,htmlBytes:33000000,totalDatasetRows:260582,
    itsmRows:50331,networkRequests:0,factualKpisCompared:13,
    cacheSize:130,cacheCapacity:2048};
  const result=createReport(good);
  assert.equal(result.measurements.totalDatasetRows,260582);
  assert.equal(result.deltaFromPr1Ms.reportColdMs,-195.1);
  assert.equal(result.comparisonCaveat.includes('not a statistically'),true);
  assert.throws(()=>createReport({...good,networkRequests:1}),/zero external/);
  assert.throws(()=>createReport({...good,cacheSize:2049}),/configured bound/);
  assert.throws(()=>createReport({...good,itsmRows:5}),/50331/);
  assert.equal(Object.hasOwn(createReport({...good,filterValues:['private']}).measurements,
    'filterValues'),false,'Unexpected private input must never reach the report');
  assert.deepEqual(Object.keys(result.measurements),FIELDS);
  const raw=JSON.stringify(result);
  for(const token of ['Северный','INC-','equipmentName','records','filterValues'])
    assert(!raw.includes(token),'Metric leak: '+token);
  console.log('PR10 fixed-schema acceptance metrics: privacy, baseline caveat, bounds and quality gates OK');
}
