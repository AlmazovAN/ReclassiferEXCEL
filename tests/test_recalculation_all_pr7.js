// PR-7: one complete supported recalculation, never a silent partial update.
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const workspaceSource = fs.readFileSync('src/js/app/recalculation_workspace.js','utf8');
async function workspaceCoverage() {
  const targets = new Map([
    ['mobile_brigade_data', { records: [{request:'INC-1'}] }],
    ['itsm_data', { records: [{number:'INC-1'}] }]
  ]);
  const calls = [];
  const runtime = { mode:()=> 'sqlite', get: id => targets.get(id) };
  const coreApi = { create:()=>({
    async preview({steps}) {
      calls.push('preview:' + steps.map(step=>step.datasetId).join(','));
      return Object.freeze({
        kind:'recalculation-preview', mode:'sqlite', hasChanges:true,
        datasets:[{ datasetId:'itsm_data', changed:1, checked:1 }],
        changed:1, checked:2
      });
    },
    assertCurrent:()=>true
  }) };
  const fake = name=>({create:()=>({createStep:()=>{
    calls.push('step:'+name);
    return {datasetId:name,calculate:()=>({})};
  }})});
  let writes = 0;
  const commit = {create:()=>({apply:(_plan,{confirmed,assertCurrent})=>{
    assert.equal(confirmed,true);
    assertCurrent(_plan);
    writes++;
    return {mode:'sqlite',changedDatasetIds:['itsm_data','kpi_source']};
  }})};
  const ctx = vm.createContext({module:{exports:{}},console});
  vm.runInContext(workspaceSource,ctx);
  const api = ctx.ReclassifierRecalculationWorkspace;
  const service = api.create({runtime,core:coreApi,
    itsm:fake('itsm_data'),mb:fake('mobile_brigade_data'),commit});
  const ready=service.describeAll();
  assert.equal(ready.ready,true);
  assert.deepEqual(Array.from(ready.missing),[]);
  assert.deepEqual(Array.from(ready.supported),
    ['mobile_brigade_data','itsm_data']);
  assert.equal(ready.includesKpiSource,true);
  assert(Object.isFrozen(ready));
  assert(Object.isFrozen(ready.missing));

  const plan=await service.prepareAll();
  assert.deepEqual(calls,[
    'step:mobile_brigade_data', 'step:itsm_data',
    'preview:mobile_brigade_data,itsm_data'
  ]);
  assert.equal(writes,0,'preview must not commit');
  assert.throws(()=>service.apply(plan),/подтверждение/);
  assert.equal(writes,0);
  service.apply(plan,{confirmed:true});
  assert.equal(writes,1);
  assert.throws(()=>service.apply(plan,{confirmed:true}),/уже применён/);

  targets.delete('mobile_brigade_data');
  const missing=service.describeAll();
  assert.equal(missing.ready,false);
  assert.deepEqual(Array.from(missing.missing),['mobile_brigade_data']);
  await assert.rejects(()=>service.prepareAll(),/полный пересчёт невозможен/);
  assert.equal(writes,1,'missing target cannot cause partial commit');
  targets.set('mobile_brigade_data',{records:[]});
  await assert.rejects(()=>service.prepareAll(),/отсутствуют или пусты/);
  targets.set('mobile_brigade_data',{records:[{request:'INC-1'}]});
  targets.set('itsm_data',{records:[],validation:{status:'invalid'}});
  await assert.rejects(()=>service.prepareAll(),/itsm_data/);
  assert.equal(writes,1);
}

async function uiCoverage() {
  const source=fs.readFileSync('src/js/app/database_recalculation_ui.js','utf8');
  let prepares=0, applies=0, previews=0;
  let confirmAnswer=false, pending=false;
  const plan={
    kind:'recalculation-preview',mode:'sqlite',asOfDate:'2026-10-15',
    checked:2,changed:1,hasChanges:true,skippedMissingSource:0,
    datasets:[
      {datasetId:'mobile_brigade_data',changed:0,checked:1,
       unchanged:1,skippedMissingSource:0,skippedByRule:0,samples:[]},
      {datasetId:'itsm_data',changed:1,checked:1,unchanged:0,
       skippedMissingSource:0,skippedByRule:0,samples:[]}
    ]
  };
  const service={
    describeAll:()=>({ready:true,missing:[],supported:['mobile_brigade_data','itsm_data']}),
    async prepareAll({signal}) {
      prepares++;
      if(pending){
        await new Promise(resolve=>setImmediate(resolve));
        if(signal.aborted) throw Error('отменено');
      }
      return plan;
    },
    async prepare(){previews++;return plan;},
    assertCurrent:()=>true,
    apply(_plan,config){
      assert.equal(config.confirmed,true);
      applies++;
      return {mode:'sqlite',changedDatasetIds:['itsm_data','kpi_source'],noOp:false};
    }
  };
  let syncs=0;
  const controls=new Map();
  const ctx=vm.createContext({
    state:{route:'database'},databaseWorkspaceState:{busy:false,health:null},
    document:{getElementById:id=>controls.get(id)||null},
    escapeHtml:value=>String(value),
    databasePauseQueuePreparation:()=>{},
    databaseRequestQueuePreparation:()=>{},
    databaseReprepareQueueCandidates:()=>{},
    databaseNextPaint:()=>Promise.resolve(),
    databaseSynchronizeWorkspace:()=>{syncs++;return {ok:true};},
    renderDatabaseWorkspace:()=>{},
    log:()=>{},
    confirm:()=>confirmAnswer,
    console
  });
  ctx.globalThis=ctx;
  ctx.ReclassifierRecalculationWorkspace={create:()=>service};
  vm.runInContext(source,ctx);
  const markup=ctx.databaseRecalculationMarkup();
  assert.match(markup,/databaseRecalculationAllButton/);
  assert.match(markup,/Пересчитать всё \(предпросмотр\)/);
  assert.match(markup,/Equipment Catalog/);
  assert.match(markup,/без отдельных обработчиков/);
  assert.match(markup,/databaseRecalculationApplyButton" disabled/);

  await ctx.databasePrepareRecalculation({all:true});
  assert.equal(prepares,1);
  assert.equal(ctx.databaseWorkspaceState.busy,false);
  assert.match(ctx.databaseRecalculationMarkup(),/все поддерживаемые данные/i);
  await ctx.databaseApplyRecalculation();
  assert.equal(applies,0,'full preview must still require user confirmation');
  confirmAnswer=true;
  await ctx.databaseApplyRecalculation();
  assert.equal(applies,1);
  assert.equal(syncs,1);
  assert.match(ctx.databaseRecalculationMarkup(),/Завершён единый пересчёт/);
  await ctx.databaseApplyRecalculation();
  assert.equal(applies,1,'no second commit with consumed preview');

  const state=vm.runInContext('databaseRecalculationState',ctx);
  pending=true;
  const started=ctx.databasePrepareRecalculation({all:true});
  await Promise.resolve();
  state.cancelRequested=true;
  await started;
  assert.equal(state.preview,null);
  assert.equal(state.status,'cancelled');
  assert.equal(applies,1);
  assert.equal(ctx.databaseWorkspaceState.busy,false);
  assert.equal(previews,0,'full mode never silently replaces selected mode');
}

(async()=>{
  await workspaceCoverage();
  await uiCoverage();
  console.log('PASS PR7 full supported recalculation: source coverage, stage order, confirmation, no partial commit, cancellation and SQLite synchronization');
})().catch(error=>{console.error(error);process.exitCode=1;});
