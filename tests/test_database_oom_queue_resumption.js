'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const integration = fs.readFileSync('src/js/app/database_integration_ui.js','utf8');
const connection = fs.readFileSync('src/js/app/database_connection_ui.js','utf8');
const render = fs.readFileSync('src/js/app/database_view_renderers.js','utf8');
const intake = fs.readFileSync('src/js/app/database_intake_ui.js','utf8');
const start = integration.indexOf('  async function databasePrepareCandidate(index, options = {}) {');
const end = integration.indexOf('  async function databasePrepareIntakeQueue(',start);
assert(start>=0 && end>start,'Missing preparation function');

function createHarness(behavior='busy',keepItem=true) {
  const item={name:'MB-2025.xlsx',size:22_589_517,
    file:{name:'MB-2025.xlsx'},inspection:{datasetId:'mobile_brigade_data',ready:true}};
  const workspace={intake:[item],busy:false,queuePreparationGeneration:17,
    queuePreparationRequested:false,queuePreparationReason:null};
  const events=[];
  const plan={records:[{id:1}],preview:{rowsAfter:123},
    inspection:{...item.inspection,classification:{id:'mobile_brigade'}}};
  const engine={async prepare() {
    if(behavior==='busy') workspace.busy=true;
    if(behavior==='generation') workspace.queuePreparationGeneration++;
    if(!keepItem) workspace.intake=[];
    return plan;
  }};
  const source=integration.slice(start,end);
  const prepare=new Function('workspace','events','engine',
    'const databaseWorkspaceState=workspace;'+
    'const globalThis={ReclassifierDatabaseIntegration:engine};'+
    'const databaseCurrentInfo=()=>({valid:true});'+
    'const databaseNextPaint=async()=>{};'+
    'const databaseMemoryDiagnostics={mark:(...args)=>events.push(args)};'+
    'const state={route:"home"};'+
    'const renderDatabaseWorkspace=()=>{};'+
    'const log=()=>{};'+source+
    '\nreturn databasePrepareCandidate;')(workspace,events,engine);
  return {item,workspace,events,prepare,plan};
}

(async()=>{
  let h=createHarness('busy');
  assert.equal(await h.prepare(0,{generation:17}),false);
  assert.equal(h.item.integrationStatus,'queued');
  assert.equal(h.workspace.queuePreparationRequested,true);
  assert.equal(h.workspace.queuePreparationReason,'candidate-interrupted');
  assert(!h.item.pendingPlan,'Discarded candidate must not retain large arrays');
  assert(h.events.some(e=>e[0]==='candidate-discarded'));

  h=createHarness('generation');
  assert.equal(await h.prepare(0,{generation:17}),false);
  assert.equal(h.item.integrationStatus,'queued');
  assert.equal(h.workspace.queuePreparationRequested,true);

  h=createHarness('generation',false);
  assert.equal(await h.prepare(0,{generation:17}),false);
  assert.equal(h.workspace.queuePreparationRequested,false,
    'Removed file must not reappear in the queue');

  h=createHarness('success');
  assert.equal(await h.prepare(0,{generation:17}),true);
  assert.equal(h.item.integrationStatus,'prepared');
  assert.equal(h.item.pendingPlan,h.plan);
  assert.equal(h.workspace.queuePreparationRequested,false);

  assert.match(connection,/databaseRequestQueuePreparation\('database-save-finished'\)/,
    'Disk save must resume candidates waiting on the busy flag');
  assert.match(render,/databaseInfo \? 'В очереди…' : 'Ожидает БД'/,
    'Connected SQLite must not show waiting-for-database on queued candidate');
  assert.match(intake,/queuePreparationRunning &&[\s\S]*?queuePreparationCurrentIndex !== null/,
    'A second XLSX must not parse concurrently with an existing heavy Worker');
  console.log('Database candidate busy/generation recovery and accurate queue status: OK');
})().catch(e=>{console.error(e);process.exitCode=1});
