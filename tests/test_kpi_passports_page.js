// Step 6: searchable KPI Passports route and identical shared modal/page content.
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

require('../src/js/app/reliability_dashboard_data.js');
require('../src/js/modules/itsm/mb_presence.js');
require('../src/js/kpi/source_facts.js');
require('../src/js/kpi/preparation/common.js');
require('../src/js/kpi/preparation/failures.js');
require('../src/js/kpi/preparation/equipment.js');
require('../src/js/kpi/preparation/labor.js');
require('../src/js/kpi/preparation/sla.js');
require('../src/js/kpi/preparation/classification.js');
require('../src/js/kpi/preparation/prb.js');
require('../src/js/kpi/preparation/ktg.js');
require('../src/js/kpi/preparation/index.js');
require('../src/js/kpi/calculator/common.js');
require('../src/js/kpi/calculator/definitions.js');
require('../src/js/kpi/calculator/vbr/calculate.js');
require('../src/js/kpi/calculator/ktg/calculate.js');
require('../src/js/kpi/calculator/sla/calculate.js');
require('../src/js/kpi/calculator/classification_quality/calculate.js');
require('../src/js/kpi/calculator/classification_quality_cgps/calculate.js');
require('../src/js/kpi/calculator/labor/calculate.js');
require('../src/js/kpi/calculator/problem_management/calculate.js');
require('../src/js/kpi/calculator/index.js');
require('../src/js/kpi/catalog/contracts.js');
require('../src/js/kpi/catalog/index.js');
require('../src/js/kpi/passport_math.js');
require('../src/js/kpi/passport_view.js');

const catalog = globalThis.ReclassifierKpiCatalog;
const sharedPassport = globalThis.ReclassifierKpiPassportView;
const esc = value=>String(value ?? '').replace(/[&<>"']/g,ch=>({
 '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'
}[ch]));

class FakeElement {
  constructor() { this.innerHTML='';this.textContent='';this.value='';this.listeners={};this.dataset={}; }
  addEventListener(event,callback) { this.listeners[event]=callback; }
  emit(event,e={}) { assert.equal(typeof this.listeners[event],'function');return this.listeners[event](e); }
  contains(node) { return node !== null && node !== undefined; }
}
const nodes = new Map();
function getNode(id) {if(!nodes.has(id))nodes.set(id,new FakeElement());return nodes.get(id);}
const header={};
const routes=[];
let snapshotCalls=0;
let cachedSnapshot=null;
const scheduledFrames=[];
const scheduledTimers=[];
const flushDeferred=()=>{
 scheduledFrames.splice(0).forEach(callback=>callback());
 scheduledTimers.splice(0).forEach(callback=>callback());
};
const liveSnapshot={
 schemaVersion:'1.0.0', calculatedAt:'2026-10-08T12:00:00.000Z',
 query:{
   period:{label:'Окт 2026',month:'2026-10'},
   mine:{label:'Северный'},
   equipmentClass:{label:'Навесное'},
   calculator:{filters:{mine:'Северный'}}
 },
 results:{vbr:{dataState:'available',value:95,components:{failureCount:5,equipmentCount:100}}},
 sources:[
  {id:'itsm_data',available:true,activeRevision:4,contentHash:'a',freshness:'2026-10-08'},
  {id:'drivers',available:true,activeRevision:8,contentHash:'b',freshness:'2026-10-08'}
 ],
 kpiView:{cards:{vbr:{current:{dataState:'available',value:95,period:'2026-10'}}}}
};
const filterState={period:'latest',mine:'Северный',equipmentClass:'mounted'};
const scope={
 console,
 Intl,
 requestAnimationFrame:callback=>scheduledFrames.push(callback),
 setTimeout:callback=>scheduledTimers.push(callback),
 escapeHtml:esc,
 setHeader:(a,b,c)=>{header.eyebrow=a;header.title=b;header.description=c;},
 el:{pageContent:getNode('pageContent')},
 document:{getElementById:getNode},
 navigate:route=>routes.push(route),
 reliabilityDashboardFilterState:filterState,
 ReclassifierKpiCatalog:catalog,
 ReclassifierKpiPassportView:sharedPassport,
 ReclassifierReliabilityReportService:{
   getCachedSnapshot:()=>cachedSnapshot,
   buildSnapshot:filters=>{
     snapshotCalls++;
     assert.equal(filters.period,filterState.period);
     cachedSnapshot=liveSnapshot;
     return liveSnapshot;
   }
 }
};
const code=fs.readFileSync('src/js/app/kpi_passports.js','utf8');
const api=vm.runInNewContext(code+
  '\n;({renderKpiPassportsPage,kpiPassportsFilteredEntries,renderKpiPassportsDetail,renderKpiPassportsCatalogList,kpiPassportsPageUiState})',scope);

// PR9 audit: removed controls must not leave orphan state, and the catalog scrolls with the page.
assert.deepEqual(Object.keys(api.kpiPassportsPageUiState).sort(), ['activeTab','selectedId']);
const passportCss = fs.readFileSync('src/ui/style/zz_pr9_passport_layout.css','utf8');
assert.match(passportCss,/\.kpi-passports-page \.kpi-passports-catalog-list/);
assert.match(passportCss,/overflow-y:\s*visible/);
assert.equal(catalog.list().length,22);
assert.equal(api.kpiPassportsFilteredEntries(catalog).length,21);
assert.equal(api.kpiPassportsFilteredEntries(catalog).length,
  catalog.list().filter(entry => entry.id !== 'data_freshness').length);

api.renderKpiPassportsPage();
assert.equal(snapshotCalls,0,'Cold passport route must paint before reading datasets.');
assert.equal(scheduledFrames.length,1);
assert.match(getNode('pageContent').innerHTML,/Методика доступна. Загружаются фактические значения/);
assert.match(getNode('pageContent').innerHTML,/Техническая документация/);
flushDeferred();
assert.equal(snapshotCalls,1,'Only the deferred phase may build a full Snapshot.');
assert.match(getNode('kpiPassportsSnapshotContext').textContent,/Расчётный срез: Окт 2026 · Северный · Навесное/);
assert.match(getNode('kpiPassportsDetail').innerHTML,/Формула расчёта/);
assert.equal(header.title,'Паспорта KPI');
assert.match(getNode('pageContent').innerHTML,/id="kpiPassportsCatalogList"/);
assert(!getNode('pageContent').innerHTML.includes('kpiPassportsCount'));
assert(!getNode('pageContent').innerHTML.includes('kpiPassportsSearch'));
assert(!getNode('pageContent').innerHTML.includes('kpiPassportsCategory'));
assert(!getNode('pageContent').innerHTML.includes('kpiPassportsStatus'));
assert.match(getNode('pageContent').innerHTML,/data-kpi-passport-select="avr_share"/);
assert.match(getNode('pageContent').innerHTML,/data-kpi-passport-select="ktg"/);
assert.match(getNode('kpiPassportsSnapshotContext').textContent,/Расчётный срез: Окт 2026 · Северный · Навесное/);
assert.match(getNode('pageContent').innerHTML,/id="kpiPassportsDetail"/);
assert.match(getNode('pageContent').innerHTML,/Техническая документация/);
assert.match(getNode('kpiPassportsDetail').innerHTML,/Формула расчёта/);
const list=getNode('kpiPassportsCatalogList');
const detail=getNode('kpiPassportsDetail');
assert.match(getNode('pageContent').innerHTML,/data-kpi-passport-select="kog"/);
const pendingButton={dataset:{kpiPassportSelect:'kog'}};
list.emit('click',{target:{closest:()=>pendingButton}});
assert.equal(api.kpiPassportsPageUiState.selectedId,'kog');
assert.match(detail.innerHTML,/Расчёт ещё не реализован/);
assert.equal(snapshotCalls,1,'Selecting a passport must not recalculate the snapshot.');

const before=sharedPassport.renderContent('sla',{snapshot:liveSnapshot});
const slaButton={dataset:{kpiPassportSelect:'sla'}};
list.emit('click',{target:{closest:()=>slaButton}});
assert.equal(api.kpiPassportsPageUiState.selectedId,'sla');
assert.equal(detail.innerHTML,before,'Page and modal MUST share exact same passport renderer output.');
assert(detail.innerHTML.includes('Как рассчитывается показатель'));
assert(detail.innerHTML.includes('Техническая документация'));

list.emit('click',{target:{closest:()=>({dataset:{kpiPassportSelect:'not-a-kpi'}})}});
assert.equal(api.kpiPassportsPageUiState.selectedId,'sla','Unknown selection must be ignored.');
getNode('kpiPassportsGoReport').emit('click');
assert.deepEqual(routes,['reliability_dashboard']);

// Reopening the route can reuse an already cached Snapshot.
api.renderKpiPassportsPage();
assert.equal(snapshotCalls,1);
flushDeferred();
assert.equal(snapshotCalls,1,'Warm passport view must reuse cached result.');
assert.equal(getNode('kpiPassportsDetail').innerHTML,
 sharedPassport.renderContent('sla',{snapshot:liveSnapshot}));

// Cold source failure cannot block the catalog or introduce unsafe markup.
cachedSnapshot=null;
scope.ReclassifierReliabilityReportService.buildSnapshot=()=>{throw new Error('Сервис временно недоступен');};
api.renderKpiPassportsPage();
assert.match(getNode('pageContent').innerHTML,/id="kpiPassportsCatalogList"/);
assert.match(getNode('pageContent').innerHTML,/Техническая документация/);
flushDeferred();
assert.match(getNode('kpiPassportsSnapshotContext').textContent,/Актуальный Report Snapshot недоступен/);
assert.match(getNode('kpiPassportsSnapshotContext').textContent,/Сервис временно недоступен/);
scope.ReclassifierReliabilityReportService.buildSnapshot=()=>{throw new Error('<img src=x onerror="bad">');};
api.renderKpiPassportsPage();
flushDeferred();
assert(!getNode('kpiPassportsDetail').innerHTML.includes('<img src=x onerror="bad">'));
assert(getNode('kpiPassportsSnapshotContext').textContent.includes('<img src=x onerror="bad">'),
 'Error must be assigned to textContent, not inserted as HTML.');

// Abandoned routes may not carry on with expensive deferred calculations.
let staleCalls=0;
scope.ReclassifierReliabilityReportService.buildSnapshot=()=>{staleCalls++;return liveSnapshot;};
api.renderKpiPassportsPage();
const previousDetail=getNode('kpiPassportsDetail');
nodes.set('kpiPassportsDetail',new FakeElement());
flushDeferred();
assert.equal(staleCalls,0);
nodes.set('kpiPassportsDetail',previousDetail);

// Native Worker path must never call synchronous Calculator for a cold
// passport. Changing route aborts the in-flight request.
let calls=0,workerSignal=null,complete=null;
scope.Worker=function DedicatedKpiWorker(){};
scope.AbortController=AbortController;
scope.ReclassifierReliabilityReportService.getCachedSnapshot=()=>null;
scope.ReclassifierReliabilityReportService.buildSnapshot=()=>{
 throw new Error('Cold synchronous passport calculation is forbidden with Worker');
};
scope.ReclassifierReliabilityReportService.buildSnapshotAsync=(_filters,opts)=>{
 calls++;workerSignal=opts.signal;
 assert.equal(opts.stage,'full');
 return new Promise(resolve=>{complete=resolve;});
};
api.renderKpiPassportsPage();
flushDeferred();
assert.equal(calls,1,'Cold passport must request Worker full Snapshot');
assert.equal(workerSignal.aborted,false);
assert.match(getNode('kpiPassportsSnapshotContext').innerHTML||'Методика доступна',/Методика доступна/);
scope.cancelKpiPassportCalculation();
assert.equal(workerSignal.aborted,true,'Route exit must cancel expensive pending Worker job');
complete(liveSnapshot);

console.log('KPI Passports PR8 + Worker: unfiltered catalog, shared content, selection, cancellation and nonblocking cold request OK');
