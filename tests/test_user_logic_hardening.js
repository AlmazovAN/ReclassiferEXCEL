'use strict';
// User-logic regression: operate through the real mobile-brigade UI module
// with a tiny DOM harness; no fabricated business data or private fixtures.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const repo='src/js/modules/mobile_brigade/ui.js';
const source=fs.readFileSync(repo,'utf8');
const elements=new Map();
class Control {
 constructor(id){this.id=id;this.disabled=false;this.textContent='';this.listeners={};}
 addEventListener(type,fn){this.listeners[type]=fn;}
 click(){if(!this.disabled && this.listeners.click)return this.listeners.click({currentTarget:this});}
}
function element(id){if(!elements.has(id))elements.set(id,new Control(id));return elements.get(id);}
const events=[];
const state={baselineReady:true,processingModuleId:null,processingOperationId:null,references:{}};
const ctx={
 state,console,Map,Set,Array,Number,String,Promise,Date,
 moduleConfig:{mobile_brigade:{title:'Мобильные бригады',description:'test'}},
 mobileBrigadeModuleConfig:{title:'Мобильные бригады'},
 escapeHtml:x=>String(x),formatBytes:x=>String(x),build:{version:'test'},
 log:(...x)=>events.push(x),alert:()=>{},
 setHeader:()=>{},
 el:{pageContent:{innerHTML:''}},
 document:{getElementById:element,querySelectorAll:()=>[]},
 bindDatasetDropzone:()=>{},bindDatasetCandidate:()=>{},
 renderDatasetCandidate:()=>'',renderReferenceValidation:()=>'',renderMobileBrigadeDataPreview:()=>'', 
 updateProcessingButton:()=>{},resetProcessingButton:()=>{},
 datasetStore:{get:()=>null,records:()=>[]},
 registerModule:()=>{},
 globalThis:null
};
ctx.globalThis=ctx;
ctx.ReclassifierMobileBrigadeRules={version:'test'};
const lifecycle={discardCalls:0,discard(){this.discardCalls++;},commit(){}};
ctx.ReclassifierDatasetLifecycleManager=lifecycle;
ctx.ReclassifierMobileBrigadeDataset={};
ctx.ReclassifierFullDatasetContract={};
vm.createContext(ctx);
// The module uses the same shared compact metadata presenter as the full app.
vm.runInContext(fs.readFileSync('src/js/app/module_workspace.js','utf8'),ctx,{
 filename:'src/js/app/module_workspace.js'
});
vm.runInContext(source,ctx,{filename:repo});
const originalRender=ctx.renderMobileBrigadeModule;
const getFiles=()=>vm.runInContext('mobileBrigadeFiles',ctx);
const add=ctx.addMobileBrigadeFiles;
const first={name:'МБ.xlsx',size:100,lastModified:1};
const second={name:'МБ.xlsx',size:200,lastModified:2};
vm.runInContext('renderMobileBrigadeModule = () => {}',ctx);
add([first,second]);
assert.equal(getFiles().length,2,'Same name must NOT overwrite another source file');
assert.strictEqual(getFiles()[0],first);
assert.strictEqual(getFiles()[1],second);
add([first]);
assert.equal(getFiles().length,2,'Re-selecting the exact same File object is idempotent');
state.processingModuleId='mobile_brigade';
ctx.removeMobileBrigadeFile(0);
ctx.clearMobileBrigadeFiles();
add([{name:'new.xlsx',size:1}]);
assert.equal(getFiles().length,2,'In-flight batch may not be modified');
state.processingModuleId=null;
// Use original renderer and its click closure, with a fake async processor.
ctx.renderMobileBrigadeModule=originalRender;
vm.runInContext(`processMobileBrigadeFiles=()=>new Promise(resolve=>{
 globalThis.finishMobileBrigade=()=>resolve({stats:{rows:2},outputName:'out.xlsx'});
 globalThis.processCalls=(globalThis.processCalls||0)+1;
})`,ctx);
ctx.renderMobileBrigadeModule();
const button=element('processMobileBrigadeButton');
async function check(){
 const click=button.listeners.click;
 const pending=click({currentTarget:button});
 assert.equal(state.processingModuleId,'mobile_brigade');
 click({currentTarget:button});
 assert.equal(ctx.processCalls,1,'Double-click must not start a second process');
 assert.equal(element('clearMobileBrigadeButton').disabled,true);
 ctx.finishMobileBrigade();
 await pending;
 assert.equal(state.processingModuleId,null,'Operation guard must reset on success');
 assert.equal(state.processingOperationId,null);
  const itsm=fs.readFileSync('src/js/modules/itsm/ui.js','utf8');
 const from=itsm.indexOf('  function applyItsmDatasetCandidate()');
 const to=itsm.indexOf('\n// ===',from);
 assert(from>=0&&to>from);
 const snippet=itsm.slice(from,to);
 const candidate={id:'itsm_data',records:[1],meta:{latestSourceDate:'2026-10-09'},validation:{status:'valid'},kpiSourceInstance:{id:'kpi_source',records:[2],validation:{status:'invalid'}}};
 let actual={itsm_data:{records:['old']},kpi_source:{records:['old']}};
 const batches=[];
 const life={
  candidate:()=>candidate,
  activateBatch:items=>{
   batches.push(items);
   if(items.some(x=>x.validation.status!=='valid'))throw Error('Invalid derived source');
   actual={itsm_data:items[0],kpi_source:items[1]};
   return items;
  }
 };
 const app={itsmDatasetLifecycle:life,itsmDatasetSchema:{id:'itsm_data'},
  kpiSourceSchema:{id:'kpi_source'},log:()=>{}};
 vm.createContext(app);
 vm.runInContext(snippet,app);
 assert.throws(()=>app.applyItsmDatasetCandidate(),/Invalid derived source/);
 assert.equal(actual.itsm_data.records[0],'old','Atomic validation must not partially apply ITSM');
 assert.equal(actual.kpi_source.records[0],'old','Derived source must remain from old revision');
 candidate.kpiSourceInstance.validation.status='valid';
 app.applyItsmDatasetCandidate();
 assert.equal(batches.length,2);
 assert.equal(actual.itsm_data.records[0],1);
 assert.equal(actual.kpi_source.records[0],2);
 console.log('User logic MB double-click/locked files/same-name + atomic ITSM/KPI Source OK');
}
check().catch(e=>{console.error(e);process.exitCode=1;});
