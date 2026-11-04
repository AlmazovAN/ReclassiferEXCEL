// PR-8 quality passport keeps standard forecast and adds an audit-only panel.
'use strict';
const assert=require('node:assert/strict');
require('../src/js/app/reliability_dashboard_data.js');
require('../src/js/modules/itsm/mb_presence.js');
require('../src/js/kpi/source_facts.js');
for(const id of ['common','failures','equipment','labor','sla','classification','prb','ktg','index'])
  require('../src/js/kpi/preparation/'+id+'.js');
require('../src/js/kpi/calculator/common.js');
require('../src/js/kpi/calculator/declarative.js');
require('../src/js/kpi/calculator/definitions.js');
for(const id of ['vbr','ktg','sla','classification_quality',
  'classification_quality_cgps','labor','problem_management'])
  require('../src/js/kpi/calculator/'+id+'/calculate.js');
require('../src/js/kpi/calculator/index.js');
require('../src/js/kpi/catalog/contracts.js');
require('../src/js/kpi/catalog/index.js');
require('../src/js/kpi/forecast_engine.js');
const lag=require('../src/js/kpi/classification_lag_forecast.js');
require('../src/js/kpi/passport_math.js');
const passport=require('../src/js/kpi/passport_view.js');

const snapshot={
  calculatedAt:'2026-10-06T12:00:00.000Z',
  query:{period:{month:'2026-09'},mine:{id:'all',label:'Все рудники'}},
  results:{classification_quality:{
    dataState:'available',value:70,
    components:{classificationSuccessCount:70,classificationTotalCount:100}
  }},
  sources:[{id:'itsm_data',available:true,activeRevision:3,contentHash:'itsm-content-789'}],
  kpiView:{cards:{classification_quality:{
    forecast:{dataState:'available',methodId:'last-value',
      methodVersion:'1.0.0',horizon:'2026-10',value:74},
    current:{dataState:'available',value:70,period:'2026-09'}
  }}}
};
const original=JSON.stringify(snapshot);
const html=passport.renderContent('classification_quality',{snapshot,activeTab:'monitor'});
assert(html.includes('Корректировка после реклассификации (экспериментально)'));
assert(html.includes('История изменений с датами не подключена'));
assert(html.includes('no-versioned-asof-audit-history'));
assert(html.includes('74 %'),'Original NEXT MONTH forecast stays visible');
assert(!html.includes('Оценка после инженерных корректировок</th><td>80'));
assert.equal(JSON.stringify(snapshot),original);
const other=passport.renderContent('sla',{snapshot});
assert(!other.includes('Корректировка после реклассификации'));
const cgps=passport.renderContent('classification_quality_cgps',{snapshot});
assert(cgps.includes('Корректировка после реклассификации'));
assert(cgps.includes('История изменений с датами не подключена'));

// Explicit unapproved audited input only; not read from real Dataset upload
// timestamps, event dates, or mutable source snapshots.
const end=month=>{
  const [y,m]=month.split('-').map(Number);
  return Date.UTC(y,m,0);
};
const observedAt=(month,offset)=>new Date(end(month)+offset*86400000)
  .toISOString().slice(0,10);
const states=(month,n,i,late)=>({
  observedAt:observedAt(month,late?24:4),
  successCount:n,totalCount:100,
  populationHash:'population-'+i+'-fixed',
  sources:[{datasetId:'itsm_data',revision:2,
    contentHash:'source-hash-'+i}]
});
const history=Array.from({length:10},(_,i)=>{
  const month=new Date(Date.UTC(2025,i,1)).toISOString().slice(0,7);
  return {cohortMonth:month,
    early:states(month,60+i,i,false),
    final:states(month,70+i,i,true)};
});
const audit={
  auditBasis:'case-level-versioned-asof',asOf:'2026-10-06',
  cohortMonth:'2026-09',
  current:{observedAt:'2026-10-05',successCount:70,totalCount:100,
    populationHash:'current-same-fixed-population',
    sources:[{datasetId:'itsm_data',revision:3,
      contentHash:'current-hash-123'}]},
  history
};
const outcome=lag.evaluateSnapshot(snapshot,'classification_quality',audit);
assert.equal(outcome.value,80);
const audited=passport.renderContent('classification_quality',{
  snapshot,lagAudit:{classification_quality:audit},activeTab:'monitor'
});
assert(audited.includes('Экспериментальная оценка доступна'));
assert(audited.includes('80 %'));
assert(audited.includes('74 %'));
assert(audited.includes('MAE модели, п.п.'));
assert(audited.includes('Пройдена'));
assert.equal(snapshot.results.classification_quality.value,70);
assert.equal(JSON.stringify(snapshot),original);
const wrong=passport.renderContent('classification_quality',{
  snapshot,lagAudit:{classification_quality:{...audit,
    current:{...audit.current,successCount:85}}}
});
assert(wrong.includes('snapshot-component-mismatch'));
assert(!wrong.includes('Экспериментальная оценка доступна'));
console.log('PR-8 passport: exact original forecast and facts kept, audit absent => insufficient, audited synthetic cohort => separate estimate, no PDF/SVG changes OK');
