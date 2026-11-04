// Step 4: executable KPI card rendering contract from the immutable Report View.
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, ch => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[ch]));
const source = fs.readFileSync('src/js/app/reliability_dashboard.js', 'utf8');
const scope = {
  Intl,
  escapeHtml,
  console,
  document: {
    getElementById() { return null; }
  }
};
const ui = vm.runInNewContext(source + '\n;({reliabilityCardFromTemplate,renderReliabilityKpiCard,formatReliabilitySignedMetric,reliabilityForecastPresentation})', scope);

const template = { id: 'vbr', title: 'ВБР', unit: '%' };
const result = { id:'vbr', title:'ВБР', value:80.4, unit:'%', dataState:'available',
  formula:'(1 - FailureCount / EquipmentCount) × 100', formulaVersion:'1.0.0',
  components:{failureCount:20,equipmentCount:100}, methodologyStatus:'draft',
  sourceComponents:['failure_events','equipment_population'] };

const forecast = {value:82.1, dataState:'available', reason:null, horizon:'2026-11',
  methodId:'approved-trend-v1', change:1.7 };
const snapshot = {
  calculatedAt: '2026-10-08T11:00:00Z',
  query:{period:{label:'Окт 2026'}},
  results:{vbr:result},
  kpiView:{cards:{vbr:{
    current:{value:80.4,dataState:'available',reason:null,period:'2026-10'},
    previous:{value:79.5,dataState:'available',reason:null,period:'2026-09'},
    change:0.9,
    changeUnit:'п.п.',
    forecast,
    target:null,
    status:'neutral'
  }}}
};
const card = ui.reliabilityCardFromTemplate(template,snapshot);
assert.equal(card.value,80.4);
assert.equal(card.previousValue,79.5);
assert.equal(card.change,0.9);
assert.equal(card.changeUnit,'п.п.');
assert.equal(card.forecast.value,82.1);
assert.equal(card.status,'neutral');
assert.equal(card.dataStatus,'calculated');
const markup = ui.renderReliabilityKpiCard(card).replace(/\s+/g,' ');
assert.match(markup, /<strong class="reliability-kpi-value">80,4<\/strong>/);
const strip = markup.split('class="reliability-kpi-meta"')[1].split('class="reliability-kpi-methodology"')[0];
assert.match(strip, /<span>Предыдущее<\/span>\s*<strong>79,5 %<\/strong>/);
assert.match(strip, /<span>Изменение<\/span>\s*<strong>\+0,9 п\.п\.<\/strong>/);
assert.match(strip, /<span>Прогноз<\/span>\s*<strong>82,1 %<\/strong>/);
assert.match(strip, /\+1,7 п\.п\. к текущему/);
assert.match(strip, /Горизонт прогноза: 2026-11/);
assert.doesNotMatch(strip, /<span>Цель<\/span>/);
assert.match(markup, /Паспорт KPI/, 'Old inline passport stays until Step 5.');
assert.equal(ui.formatReliabilitySignedMetric(-2.5,'п.п.'),'−2,5 п.п.');
assert.equal(ui.formatReliabilitySignedMetric(0,'п.п.'),'0 п.п.');
assert.equal(ui.formatReliabilitySignedMetric(null,'п.п.'),'—');

const pending = {value:null,dataState:'not-calculated',reason:'forecast-method-not-defined',
  horizon:null,methodId:null,change:null};
const unforecasted = ui.reliabilityCardFromTemplate(template,{
  ...snapshot,
  kpiView:{cards:{vbr:{...snapshot.kpiView.cards.vbr,forecast:pending,
    previous:{value:null,dataState:'unavailable',reason:'equipment-snapshot-period-mismatch'},
    change:null
  }}}
});
const pendingMarkup=ui.renderReliabilityKpiCard(unforecasted).replace(/\s+/g,' ');
assert.match(pendingMarkup, /<span>Прогноз<\/span>\s*<strong>—<\/strong>/);
assert.match(pendingMarkup, /Методика не задана/);
assert.match(pendingMarkup, /<span>Изменение<\/span>\s*<strong>—<\/strong>/);
assert.match(pendingMarkup, /<span>Предыдущее<\/span>\s*<strong>—<\/strong>/);
assert.doesNotMatch(pendingMarkup, /<strong>82,1 %<\/strong>/);

// Model must refuse a forecast which has no method or horizon even if it contains a number.
for (const incorrect of [
  {...forecast, horizon:null},
  {...forecast, methodId:null},
  {...forecast, dataState:'insufficient'}
]) {
  const view = ui.reliabilityForecastPresentation(incorrect,'%');
  assert.equal(view.value,'—');
  assert.equal(view.ready,false);
}
const malicious = ui.renderReliabilityKpiCard({...card,forecast:{...forecast,horizon:'2026-11" onclick="alert(1)'}}); 
assert.doesNotMatch(malicious, /title="Горизонт прогноза: 2026-11" onclick=/);
assert.match(malicious, /&quot; onclick=&quot;/);

// Data-state takes precedence over accidental stale numbers in a partial Snapshot.
const inaccessible = ui.reliabilityCardFromTemplate(template,{
  ...snapshot,
  results:{vbr:{...result,dataState:'no-data',value:null,reason:'source-missing'}},
  kpiView:{cards:{vbr:{
    ...snapshot.kpiView.cards.vbr,
    current:{value:null,dataState:'no-data',reason:'source-missing'},
    previous:{value:79.5,dataState:'available'},change:null,forecast:pending
  }}}
});
assert.equal(inaccessible.dataState,'no-data');
assert.equal(inaccessible.value,null);
assert.equal(inaccessible.previousValue,79.5);
assert.equal(inaccessible.change,null);
assert.match(ui.renderReliabilityKpiCard(inaccessible), /Нет данных/);

const absent = ui.reliabilityCardFromTemplate({id:'ktg',title:'КТГ',unit:'%'},{
  results:{},
  kpiView:{cards:{ktg:{
    current:{value:null,dataState:'not-applicable',reason:'not-implemented'},
    previous:{value:null,dataState:'not-applicable',reason:'not-implemented'},
    change:null,changeUnit:'п.п.',
    forecast:{value:null,dataState:'unavailable',reason:'kpi-not-implemented',
      horizon:null,methodId:null,change:null},target:null,status:'neutral'
  }}}
});
assert.equal(absent.dataStatus,'not-connected');
assert.equal(absent.dataState,'not-applicable');
const absentMarkup=ui.renderReliabilityKpiCard(absent);
assert.match(absentMarkup,/KPI · не подключён/);
assert.match(absentMarkup,/KPI не подключён/);
assert.doesNotMatch(absentMarkup,/NaN|Infinity/);

// Graceful fallback for older pre-Step-3 Report Snapshots.
const legacy = ui.reliabilityCardFromTemplate(template,{results:{vbr:result},query:{period:{label:'Окт 2026'}}});
assert.equal(legacy.value,80.4);
assert.equal(legacy.previousValue,null);
assert.equal(legacy.change,null);
assert.equal(legacy.forecast,null);
const legacyMarkup=ui.renderReliabilityKpiCard(legacy);
assert.match(legacyMarkup,/Прогноз недоступен/);
assert.doesNotMatch(legacyMarkup,/NaN|Infinity/);
console.log('Reliability KPI cards Step 4: snapshot comparisons, forecast guards, missing states, legacy and escaping OK');
