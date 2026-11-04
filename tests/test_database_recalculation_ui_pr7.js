'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');

const text=fs.readFileSync('src/js/app/database_recalculation_ui.js','utf8');
let renders=0,commits=0,confirmAnswer=false,syncs=0,queuePause=0,queueRefresh=0;
let mode='legacy',stale=false,defer=null;
const plan=Object.freeze({
 kind:'recalculation-preview',mode:'legacy',asOfDate:'2026-10-14',
 checked:9,changed:2,hasChanges:true,skippedMissingSource:1,
 datasets:[{datasetId:'mobile_brigade_data',changed:1,checked:3,
   unchanged:1,skippedMissingSource:0,skippedByRule:1,
   samples:[{key:'mb-1',fields:{itsmCreatedAt:{
     before:null,after:'2026-09-01<script>'}}}],
   changes:[{key:'mb-1',fields:{itsmCreatedAt:{before:null,after:'2026-09-01'}}}]},
  {datasetId:'itsm_data',changed:1,checked:6,unchanged:5,
   skippedMissingSource:1,skippedByRule:0,samples:[],changes:[{key:'INC-1'}]}]
});
const service={
  async prepare(ids,{signal,onProgress}){
    assert.deepEqual(Array.from(ids),['mobile_brigade_data','itsm_data']);
    onProgress({datasetId:'mobile_brigade_data',processed:1,total:3,changed:1});
    if(defer)return new Promise(resolve=>{defer=resolve});
    return plan;
  },
  assertCurrent(p){assert.equal(p,plan);if(stale)throw Error('Dataset changed');return true;},
  apply(p,{confirmed}){assert.equal(confirmed,true);assert.equal(p,plan);commits++;
    return {mode,changedDatasetIds:['mobile_brigade_data','itsm_data','kpi_source']};}
};
const elements=new Map();
const ctx=vm.createContext({
 console,document:{getElementById:id=>elements.get(id)||null},
 globalThis:null,
 state:{route:'database'},databaseWorkspaceState:{busy:false,health:{}},
 escapeHtml:v=>String(v).replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;'),
 databasePauseQueuePreparation:()=>{queuePause++;},
 databaseRequestQueuePreparation:()=>{queueRefresh++;},
 databaseReprepareQueueCandidates:()=>{queueRefresh++;},
 databaseNextPaint:()=>Promise.resolve(),
 databaseSynchronizeWorkspace:()=>{syncs++;return {ok:true};},
 renderDatabaseWorkspace:()=>{renders++;},
 log:()=>{},
 confirm:()=>confirmAnswer
});
ctx.globalThis=ctx;
ctx.ReclassifierRecalculationWorkspace={create:()=>service};
vm.runInContext(text,ctx,{filename:'database_recalculation_ui.js'});
const current=()=>vm.runInContext('databaseRecalculationState',ctx);

(async()=>{
 assert.match(ctx.databaseRecalculationMarkup(),/Пересчёт и актуализация данных/);
 assert.match(ctx.databaseRecalculationMarkup(),/Предварительный пересчёт/);
 assert.match(ctx.databaseRecalculationMarkup(),/databaseRecalculationApplyButton" disabled/);
 await ctx.databasePrepareRecalculation();
 assert.equal(current().status,'prepared');
 assert.equal(ctx.databaseWorkspaceState.busy,false);
 assert.equal(current().preview,plan);
 assert.match(ctx.databaseRecalculationMarkup(),/Применить изменения/);
 assert.match(ctx.databaseRecalculationMarkup(),/mb-1/);
 assert.match(ctx.databaseRecalculationMarkup(),/2026-09-01&lt;script&gt;/,
   'Sample values must be HTML escaped.');
 assert.equal(queuePause,1);
 assert.equal(queueRefresh,1);
 await ctx.databaseApplyRecalculation();
 assert.equal(commits,0,'Declining confirm must never write.');
 confirmAnswer=true;
 stale=true;
 await ctx.databaseApplyRecalculation();
 assert.equal(commits,0);
 assert.equal(current().preview,null);
 assert.match(current().error,/Dataset changed/);
 stale=false;
 await ctx.databasePrepareRecalculation();
 await ctx.databaseApplyRecalculation();
 assert.equal(commits,1);
 assert.equal(current().preview,null);
 assert.equal(current().status,'applied');
 assert.equal(syncs,0);
 assert.match(ctx.databaseRecalculationMarkup(),/Скачать HTML с данными/);
 assert.equal(ctx.databaseWorkspaceState.busy,false);
 // Repeated Apply without a prepared plan cannot write.
 await ctx.databaseApplyRecalculation();
 assert.equal(commits,1);

 // Cancellation is checked after the async worker returns; no preview remains.
 current().result=null;
 defer=true;
 const pending=ctx.databasePrepareRecalculation();
 for(let i=0;i<10 && typeof defer!=='function';i++)await Promise.resolve();
 assert.equal(typeof defer,'function');
 assert.equal(current().busy,true);
 current().cancelRequested=true;
 defer(plan);
 defer=null;
 await pending;
 assert.equal(current().status,'cancelled');
 assert.equal(current().preview,null);
 assert.equal(commits,1);
 assert.equal(ctx.databaseWorkspaceState.busy,false);
 // The same controls work in authoritative SQLite mode and synchronize only
 // after a successful write. SQLite is never mirrored to HTML Dataset Store.
 mode='sqlite';
 await ctx.databasePrepareRecalculation();
 await ctx.databaseApplyRecalculation();
 assert.equal(commits,2);
 assert.equal(syncs,1);
 assert.match(ctx.databaseRecalculationMarkup(),/Скачать Reclassifier.db/);
 assert(renders>=5);
 assert(queueRefresh>=4);
 console.log('PR7 UI: selectable preview, sanitized diff, confirm/decline, stale rejection, cancel, storage-specific sync OK');
})().catch(e=>{console.error(e);process.exitCode=1;});
