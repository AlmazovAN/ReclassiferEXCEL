'use strict';
const assert = require('node:assert/strict');
const pdf = require('../src/js/app/reliability_pdf.js');
const { Blob } = require('node:buffer');

const metric=(id,title,value,state='available',components={},reason=null)=>Object.freeze({
  id,title,value,unit:'%',dataState:state,formulaVersion:'1.0.0',reason,
  components:Object.freeze(components)
});
const base={
  type:'reliability-report',schemaVersion:'1.0.0',status:'ready',
  calculatedAt:'2026-10-09T13:00:00.000Z',
  preparationVersion:'1.0.0',calculatorVersion:'1.0.0',
  query:{period:{id:'2026-09',month:'2026-09',label:'Сентябрь 2026'},
    mine:{id:'Северный',label:'Северный'},equipmentClass:{id:'mounted',label:'Навесное'}},
  results:{
    classification_quality:metric('classification_quality','Качество классификации — общее',90,
      'available',{classificationIncUnchangedCount:90,classificationIncCorrectedCount:0,
        classificationIncUnclassifiedCount:0,classificationRitmInsteadOfIncCount:10,
        classificationSuccessCount:90,classificationTotalCount:100}),
    classification_quality_cgps:metric('classification_quality_cgps','Качество классификации ЦГПС',90/95*100,
      'available',{classificationIncUnchangedCount:90,classificationIncCorrectedCount:0,
        classificationIncUnclassifiedCount:0,classificationRitmInsteadOfIncCount:5,
        classificationSuccessCount:90,classificationTotalCount:95,
        excludedNoMbCount:3,unknownMbCoverageCount:0,excludedOtherInitiatorRitmCount:5})
  },
  series:{monthly:[
    {period:'2026-07',label:'Июль',
      classification_quality:{dataState:'available',value:90},
      classification_quality_cgps:{dataState:'available',value:94.74}},
    {period:'2026-08',label:'Август',
      classification_quality:{dataState:'available',value:85},
      classification_quality_cgps:{dataState:'no-data',value:null,reason:'mb-coverage-unknown'}},
    {period:'2026-09',label:'Сентябрь',
      classification_quality:{dataState:'available',value:90},
      classification_quality_cgps:{dataState:'available',value:90/95*100}}
  ]},
  sources:[{id:'itsm_data',available:true,activeRevision:3},
    {id:'mobile_brigade_data',available:true,activeRevision:4}],
  breakdowns:{labor:[],problemManagement:[]}
};

assert.equal(pdf.version,'1.3.0');
const plan=pdf.createPlan(base);
assert.deepEqual(plan.results.map(result=>result.id),
  ['classification_quality','classification_quality_cgps']);
assert.equal(plan.monthlyQuality.length,3);
assert.equal(plan.monthlyQuality[1].cgps,null);
assert.equal(plan.monthlyQuality[1].overall,85);
assert.equal(plan.monthlyQuality[1].cgpsReason,'mb-coverage-unknown');
const split=pdf.qualitySegments(plan.monthlyQuality,'cgps');
assert.equal(split.length,2,'Unknown MB month must break the line');
assert.deepEqual(split.map(segment=>segment.map(point=>point.index)),[[0],[2]]);
const continuous=pdf.qualitySegments(plan.monthlyQuality,'overall');
assert.equal(continuous.length,1);
assert.deepEqual(continuous[0].map(point=>point.index),[0,1,2]);

const changedMonth={...base,series:{monthly:base.series.monthly.map(row=>
  row.period==='2026-08'?{...row,classification_quality:{dataState:'available',value:55}}:row)}};
assert.notEqual(pdf.snapshotFingerprint(changedMonth),pdf.snapshotFingerprint(base),
  'Changing a historical series point must change PDF identity.');
const changedMbStatus={...base,series:{monthly:base.series.monthly.map(row=>
  row.period==='2026-08'?{...row,classification_quality_cgps:{
    dataState:'available',value:92}}:row)}};
assert.notEqual(pdf.snapshotFingerprint(changedMbStatus),pdf.snapshotFingerprint(base));
assert.equal(pdf.fileName(base),pdf.fileName(base));

const logged=[];
const jpeg=Uint8Array.from([0xff,0xd8,0xff,0xd9]);
const documentOriginal=globalThis.document;
function context() {
  const ctx={
    fillText(v,x,y) {logged.push({t:String(v),x,y});},
    measureText(v) {return {width:String(v).length*7.5};},
    fillRect() {},beginPath(){},moveTo(){},lineTo(){},arcTo(){},
    closePath(){},fill(){},stroke(){},arc(){},save(){},restore(){},
    translate(){},rotate(){},
    textAlign:'left'
  };
  return ctx;
}
globalThis.document={
  createElement(name) {
    assert.equal(name,'canvas');
    return {width:0,height:0,getContext:()=>context(),
      toBlob(callback) {callback(new Blob([jpeg],{type:'image/jpeg'}));}};
  }
};
(async()=>{
  try{
    const result=await pdf.render(base);
    assert(result.pageCount>=2,'Quality details must remain after removing the duplicate comparison chart');
    assert(result.bytes>600);
    assert.equal(result.fingerprint,pdf.snapshotFingerprint(base));
    const log=logged.map(item=>item.t).join('\n');
    for(const term of ['Ключевые показатели','Качество классификации ЦГПС',
      'Динамика SLA','Качество классификации: состав расчёта',
      'A · INC без изм','B · INC с исправлением','C · INC не классифицирован',
      'D · RITM вместо INC (ЦГПС)','Нет в МБ: 3','Нет данных МБ: 0',
      'RITM иных инициаторов: 5','90 / 95','90 / 100','ITSM Сириус.number']) {
      assert(log.includes(term),'PDF canvas should show '+term);
    }
    const unavailable={
      ...base,
      results:{
        ...base.results,
        classification_quality_cgps:{
          ...base.results.classification_quality_cgps,
          dataState:'no-data',value:null,reason:'mb-coverage-unknown',
          components:{...base.results.classification_quality_cgps.components,
            unknownMbCoverageCount:4}
        }
      }
    };
    logged.length=0;
    const disabledPdf=await pdf.render(unavailable);
    assert(disabledPdf.pageCount>=2);
    const disabled=logged.map(item=>item.t).join('\n');
    assert(disabled.includes('Нет данных МБ: 4'));
    assert(disabled.includes('Итог недоступен: Dataset МБ отсутствует или недоступен'));
    assert(!disabled.includes('90 / 95 × 100 = 94,7'));
    const original=JSON.stringify(base);
    pdf.createPlan(base);
    assert.equal(JSON.stringify(base),original,'PDF must not mutate the live snapshot');

    const legacy={...base,results:{vbr:metric('vbr','ВБР',95)},series:{monthly:[]}};
    logged.length=0;
    const legacyPdf=await pdf.render(legacy);
    assert(legacyPdf.pageCount>=1);
    assert(logged.map(x=>x.t).join(' ').includes('Месячная динамика'));
    assert(!logged.map(x=>x.t).join(' ').includes('Нет в МБ: 0'),
      'No fake CGPS components may appear in legacy Snapshot.');

    console.log('PR6 PDF: both KPI cards, A/B/C/D pages, MB exclusions, strict gaps, no-data status, fingerprint and offline rendering OK');
  }finally {
    globalThis.document=documentOriginal;
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
