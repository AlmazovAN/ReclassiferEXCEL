'use strict';
// PR6: Report Snapshot coverage parity, missing-month chart gaps and offline PDF progress.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const presentation = require('../src/js/app/reliability_report_presentation.js');
const renderer = require('../src/js/app/reliability_pdf.js');

const result = value => Number.isFinite(value)
  ? {dataState:'available',value}
  : {dataState:'no-data',value:null,reason:'source-missing'};
const rows = [
  {period:'2026-01',label:'Янв',vbr:result(94),sla:result(98)},
  {period:'2026-02',label:'Фев',vbr:result(null),sla:result(97)},
  {period:'2026-03',label:'Мар',vbr:result(92),sla:result(null)},
  {period:'2026-04',label:'Апр',vbr:result(93),sla:result(96)}
];
const snapshot={
  type:'reliability-report',
  schemaVersion:'1.0.0',status:'partial',
  calculatedAt:'2026-10-16T08:00:00.000Z',
  query:{period:{id:'latest',label:'Последний'},mine:{id:'all',label:'Все рудники'},
    equipmentClass:{id:'all',label:'Все виды'}},
  diagnostics:{stage:'full',sourceSignature:'rev-1'},
  results:{vbr:{id:'vbr',title:'ВБР',unit:'%',dataState:'available',value:93},
    sla:{id:'sla',title:'SLA',unit:'%',dataState:'no-data',value:null}},
  series:{monthly:rows},
  sources:[{id:'itsm_data',available:true,activeRevision:8},
    {id:'mobile_brigade_data',available:false,activeRevision:0}],
  breakdowns:{labor:[],problemManagement:[]}
};

assert.deepEqual(presentation.summary(snapshot),{
  kpiAvailable:1,kpiTotal:2,sourceAvailable:1,sourceTotal:2,
  monthCount:4,status:'partial'
});
const vbr = presentation.monthly(snapshot,'vbr');
const sla = presentation.monthly(snapshot,'sla');
assert.deepEqual(vbr.map(p=>p.value),[94,null,92,93]);
assert.deepEqual(sla.map(p=>p.value),[98,97,null,96]);
assert.deepEqual(presentation.segments(vbr).map(run=>run.map(p=>p.index)),[[0],[2,3]]);
assert.deepEqual(presentation.segments(sla).map(run=>run.map(p=>p.index)),[[0,1],[3]]);
assert(Object.isFrozen(vbr)&&Object.isFrozen(vbr[0]),
  'read-only chart projection should not mutate Report Snapshot');

const source=fs.readFileSync('src/js/app/reliability_dashboard.js','utf8');
const scope={ReclassifierReliabilityPresentation:presentation,
  escapeHtml:input=>String(input??'').replaceAll('&','&amp;')
    .replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;')};
scope.globalThis=scope;
vm.createContext(scope);
vm.runInContext(source+'\nthis.pr6Render={renderReliabilityLineChart,reliabilityLineChartPoints,reliabilityLinePath,renderReliabilityEvidence};',scope);
const chart=scope.pr6Render.renderReliabilityLineChart({
  id:'vbr-dynamics',title:'Динамика ВБР',description:'Без домыслов',
  points:vbr,minValue:0,maxValue:100
});
const path=chart.match(/class="reliability-chart-line series-1" d="([^"]*)"/)?.[1]||'';
assert.equal((path.match(/M /g)||[]).length,2,
  'VBR line must break at one missing observation');
assert.equal((path.match(/L /g)||[]).length,1,
  'VBR chart must connect only adjacent observed months');
assert(chart.includes('Фактические значения: 3 из 4 мес.'));
assert(chart.includes('Пропуски: 1'));
assert(!chart.includes('NaN'),'missing data must not produce broken SVG attributes');
const evidence=scope.pr6Render.renderReliabilityEvidence(snapshot);
assert(evidence.includes('1 из 2'));
assert(evidence.includes('Наполнение:'));
assert(evidence.includes('4 месяцев'));
assert(evidence.includes('Доступно источников:'));
assert(!evidence.includes('Недоступно источников:'), 'Compact toolbar should not repeat source warnings');
const noProjection=scope.pr6Render.renderReliabilityLineChart({
  id:'sla-dynamics',title:'SLA',description:'Проверка',
  points:[vbr[1],vbr[1]],minValue:0,maxValue:100
});
assert(noProjection.includes('недостаточно'));
assert(!noProjection.includes('<svg'));
const unchanged=JSON.stringify(snapshot);
const pdf=renderer.createPlan(snapshot);
assert.deepEqual(pdf.evidence,presentation.summary(snapshot));
assert.equal(JSON.stringify(snapshot),unchanged,'renderers must not modify input data');
const changedHistorical={...snapshot,series:{monthly:[
  {...rows[0],vbr:result(95)},...rows.slice(1)]}};
assert.notEqual(renderer.snapshotFingerprint(changedHistorical),
  renderer.snapshotFingerprint(snapshot),
  'Historical VBR change must alter PDF identity');
assert.throws(()=>renderer.createPlan({...snapshot,diagnostics:{stage:'primary'}}),
  /полного Report Snapshot/);

// Headless canvas double: verifies actual successfully encoded page count,
// PDF bytes and progress without installing a network-dependent renderer.
function contextDouble() {
  const state={};
  return new Proxy(state,{
    get(object,key) {
      if(key==='measureText')return value=>({width:String(value??'').length*7.8});
      if(key in object)return object[key];
      return ()=>{};
    },set(object,key,value){object[key]=value;return true;}
  });
}
const originalDocument=global.document;
global.document={
  createElement(name) {
    assert.equal(name,'canvas');
    const ctx=contextDouble();
    return {
      width:0,height:0,
      getContext:()=>ctx,
      toBlob(callback){callback(new Blob([new Uint8Array([0xff,0xd8,0xff,0xd9])],
        {type:'image/jpeg'}));}
    };
  }
};
(async()=>{
  const progress=[];
  const result=await renderer.render(snapshot,{onProgress:state=>progress.push(state)});
  assert(result.pageCount>=1);
  assert(result.blob.size>600);
  assert.equal(result.blob.type,'application/pdf');
  const encoded=progress.filter(state=>state.stage==='encode');
  assert.equal(encoded.length,result.pageCount);
  for(let i=0;i<encoded.length;i++){
    assert.equal(encoded[i].completed,i+1);
    assert.equal(encoded[i].total,result.pageCount);
    assert.equal(encoded[i].percent,Math.floor((i+1)/result.pageCount*95));
  }
  assert.equal(progress.at(-1).stage,'complete');
  assert.equal(progress.at(-1).percent,100);
  assert.deepEqual([...progress.map(p=>p.percent)].sort((a,b)=>a-b),
    progress.map(p=>p.percent),'progress must represent completed pages');
  assert.equal(JSON.stringify(snapshot),unchanged);
  console.log('PR6: WEB/PDF evidence parity, gap-preserving SVG and measured PDF page progress OK');
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(()=>{
  global.document=originalDocument;
});
