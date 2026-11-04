// All 19 KPI passports must share one accessible UI format and one Snapshot source.
'use strict';
const assert=require('node:assert/strict');
require('../src/js/app/reliability_dashboard_data.js');
require('../src/js/modules/itsm/mb_presence.js');
require('../src/js/kpi/source_facts.js');
for(const name of ['common','failures','equipment','labor','sla','classification','prb','ktg','index'])
  require('../src/js/kpi/preparation/'+name+'.js');
require('../src/js/kpi/calculator/common.js');
require('../src/js/kpi/calculator/definitions.js');
for(const name of ['vbr','ktg','sla','classification_quality','classification_quality_cgps','labor','problem_management'])
  require('../src/js/kpi/calculator/'+name+'/calculate.js');
require('../src/js/kpi/calculator/index.js');
require('../src/js/kpi/catalog/contracts.js');
require('../src/js/kpi/catalog/index.js');
require('../src/js/kpi/passport_math.js');
require('../src/js/kpi/passport_view.js');

const catalog=globalThis.ReclassifierKpiCatalog;
const view=globalThis.ReclassifierKpiPassportView;
assert.equal(catalog.list().length,22);
assert.equal(typeof view.bindTabs,'function');
const ids=['overview','method','data','monitor'];
for(const item of catalog.list()) {
  const content=view.renderContent(item.id);
  for(const id of ids) {
    assert(content.includes('id="kpi-passport-tab-'+id+'"'),item.id+': tab '+id);
    assert(content.includes('id="kpi-passport-panel-'+id+'"'),item.id+': panel '+id);
  }
  for(const section of ['overview','fact','interpretation','formula','method','sources','visual','forecast','trace','control'])
    assert(content.includes('id="kpi-passport-'+section+'"'),item.id+': '+section);
  assert.equal((content.match(/role="tab"/g)||[]).length,4,item.id);
  assert.equal((content.match(/role="tabpanel"/g)||[]).length,4,item.id);
  assert.equal((content.match(/aria-selected="true"/g)||[]).length,1,item.id);
  assert(!content.includes('NaN')&&!content.includes('Infinity'),item.id);
  assert(content.includes('Методика: draft'),item.id+': status cannot become approved');
}

const snapshot={
  calculatedAt:'2026-10-11T07:00:00Z',
  query:{period:{month:'2026-10',label:'Октябрь'},mine:{label:'Северный'},equipmentClass:{label:'Навесное'}},
  results:{vbr:{value:95,dataState:'available',formulaVersion:'2.0.0',components:{failureCount:5,equipmentCount:100}}},
  sources:[{id:'drivers',available:true,activeRevision:4,contentHash:'h4'}],
  kpiView:{
    cards:{vbr:{current:{value:95,dataState:'available',period:'2026-10'}}},
    seriesById:{vbr:{points:[
      {period:'2026-08',value:90,dataState:'available'},
      {period:'2026-09',value:null,dataState:'no-data'},
      {period:'2026-10',value:95,dataState:'available'}
    ]}}
  }
};
const current=view.renderContent('vbr',{snapshot,activeTab:'monitor'});
assert(current.includes('class="kpi-passport-sparkline"'));
assert(current.includes('95 %'));
assert(current.includes('показано 2 из 3 значений'));
assert(!current.includes('<polyline'),'Missing calendar month must split the line');
assert(current.includes('id="kpi-passport-panel-overview" aria-labelledby="kpi-passport-tab-overview" hidden'));
assert(current.includes('id="kpi-passport-panel-monitor" aria-labelledby="kpi-passport-tab-monitor">'));
const noSeries=view.renderContent('vbr',{snapshot:{...snapshot,kpiView:{cards:snapshot.kpiView.cards}}});
assert(noSeries.includes('Помесячный ряд отсутствует'));
assert(!noSeries.includes('class="kpi-passport-sparkline"'));

const controls=[];
const panels=ids.map(id=>({id:'kpi-passport-panel-'+id,hidden:id!=='overview'}));
const buttons=ids.map(id=>({
  dataset:{kpiPassportTab:id},attributes:{},
  setAttribute(name,value){this.attributes[name]=value;},
  focus(){this.focused=true;}
}));
const host={
  listeners:{},
  addEventListener(type,handler){this.listeners[type]=handler;},
  contains:()=>true,
  querySelectorAll(selector){return selector==='.kpi-passport-panel'?panels:buttons;}
};
const chosen=[];
view.bindTabs(host,tab=>chosen.push(tab));
host.listeners.click({target:{closest:()=>buttons[2]}});
assert.deepEqual(chosen,['data']);
assert.equal(panels[2].hidden,false);
assert(panels.every((panel,i)=>panel.hidden===(i!==2)));
assert.equal(buttons[2].attributes['aria-selected'],'true');
assert.equal(buttons[2].tabIndex,0);
assert.equal(buttons[0].tabIndex,-1);
console.log('Unified passports: 19 definitions, 4 accessible tabs, Snapshot trend gaps and delegates OK');
