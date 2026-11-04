'use strict';
const assert=require('node:assert/strict');
require('../src/js/app/reliability_dashboard_data.js');
require('../src/js/modules/itsm/mb_presence.js');
require('../src/js/kpi/source_facts.js');
for(const p of ['common','failures','equipment','labor','sla','classification','prb','ktg','index'])
  require('../src/js/kpi/preparation/'+p+'.js');
require('../src/js/kpi/calculator/common.js');
require('../src/js/kpi/calculator/definitions.js');
for(const p of ['vbr','ktg','sla','classification_quality','classification_quality_cgps','labor','problem_management'])
  require('../src/js/kpi/calculator/'+p+'/calculate.js');
require('../src/js/kpi/calculator/index.js');
require('../src/js/kpi/catalog/contracts.js');
require('../src/js/kpi/catalog/index.js');
const engine=require('../src/js/kpi/forecast_engine.js');
assert.equal(engine.defaults.horizonMonths,1);
assert.equal(engine.configFor('sla').methodId,'linear-trend');
assert.equal(engine.externalAdapter.status,'not-connected');
const months=Array.from({length:12},(_,i)=>'2025-'+String(i+1).padStart(2,'0'));
const pts=values=>values.map((value,i)=>({period:months[i],value,dataState:'available'}));
const linear=engine.predict({kpiId:'total_labor',selectedMonth:'2025-12',
  points:pts(Array.from({length:12},(_,i)=>10+2*i))});
assert.equal(linear.dataState,'available');
assert.equal(linear.value,34);
assert.equal(linear.horizon,'2026-01');
assert.equal(linear.methodId,'linear-trend');
assert.equal(linear.quality.passed,true);
assert.equal(linear.change,2);
assert(Object.isFrozen(linear));
const fixed=engine.predict({kpiId:'sla',selectedMonth:'2025-12',points:pts(Array(12).fill(98))});
assert.equal(fixed.value,98);
assert.equal(fixed.quality.mae,0);
const bounded=engine.predict({kpiId:'sla',selectedMonth:'2025-12',
  points:pts(Array.from({length:12},(_,i)=>88+i*1.2))});
assert.equal(bounded.value,100);
assert.equal(bounded.bounded,true);
const missing=pts(Array.from({length:12},(_,i)=>i+1));
missing[5]={period:months[5],value:null,dataState:'no-data'};
assert.equal(engine.predict({kpiId:'sla',selectedMonth:'2025-12',points:missing}).reason,'missing-or-invalid-history');
assert.equal(engine.predict({kpiId:'sla',selectedMonth:'2025-12',points:pts([1,2,3])}).reason,'insufficient-history');
assert.equal(engine.predict({kpiId:'vbr',selectedMonth:'2025-12',points:pts(Array(12).fill(95))}).reason,'historical-data-required');
assert.equal(engine.predict({kpiId:'ktg',selectedMonth:'2025-12',points:pts(Array(12).fill(95))}).reason,'historical-data-required');
assert.equal(engine.predict({kpiId:'sla',selectedMonth:'2025-12',
  points:pts(Array(12).fill(95)),overrides:{sla:{methodId:'corporate-ml-api'}}}).reason,'forecast-method-not-connected');
const override=engine.predict({kpiId:'sla',selectedMonth:'2025-12',
  points:pts(Array(12).fill(95)),overrides:{sla:{methodId:'last-value'}}});
assert.equal(override.value,95);
assert.equal(override.methodId,'last-value');
assert.equal(engine.configFor('total_labor').methodId,'linear-trend');
const noise=engine.predict({kpiId:'total_labor',selectedMonth:'2025-12',
  points:pts([1,2,3,4,5,6,7,8,8,8,8,8])});
assert.equal(noise.value,null);
assert.equal(noise.reason,'worse-than-naive-baseline');
console.log('Forecast Step 9: 1M horizon, linear trend, MAE baseline, guards, bounds, per-KPI adapters, offline API contract OK');
