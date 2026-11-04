'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const records=new Map();
function local(blocked=false){
  return {
    get length(){return records.size},
    key:i=>[...records.keys()][i]??null,
    getItem:k=>{if(blocked)throw Error('SecurityError');return records.get(k)??null},
    setItem:(k,v)=>{if(blocked)throw Error('QuotaExceededError');records.set(k,String(v))},
    removeItem:k=>{if(blocked)throw Error('SecurityError');records.delete(k)}
  };
}
function boot(label='TEST_16_PR326',blocked=false){
  const ctx={RECLASSIFIER_BUILD:{testLabel:label},localStorage:local(blocked),
    console,Date,Math,JSON,Map,Set,Number,String,Array,Object,Promise,
    setTimeout,clearTimeout};
  ctx.globalThis=ctx;
  vm.createContext(ctx);
  for(const filename of ['diagnostic_v2.js','diagnostic_history.js'])
    vm.runInContext(fs.readFileSync('src/js/app/'+filename,'utf8'),ctx);
  return {v2:ctx.ReclassifierDiagnosticV2,history:ctx.ReclassifierDiagnosticHistory};
}
(async()=>{
  const a=boot();
  assert.equal(a.v2.enabled(),true);
  assert.equal(a.v2.checkpoint('candidate-records',{
    inputBufferBytes:18351654,rows:54753,fileName:'SECRET',userText:'CONFIDENTIAL'
  },'start'),true);
  assert.equal(a.v2.status().running.phase,'candidate-records');
  assert.equal(a.history.append('runtime','test16_s1',0,{
    phase:'candidate-records',event:'start',at:new Date().toISOString()
  },{sessionId:'test16_s1',eventCount:1,status:'running'}),true);
  const first=a.v2.status();
  assert.equal(first.globalSeq,1);
  assert.equal(first.lastWalAck,1);
  assert.equal(first.walAcknowledged,1);
  assert.equal(first.resources.inputBufferBytes,18351654);
  assert(!JSON.stringify(first).includes('SECRET'));
  const b=boot();
  assert.equal(b.v2.status().interruptions.length,1,
    'Restart must retain interrupted previous session and last checkpoint');
  assert.equal(b.v2.status().interruptions[0].phase,'candidate-records');
  assert.equal(b.v2.status().globalSeq,1);
  assert.equal(b.v2.status().previousBoot.resources.inputBufferBytes,18351654,
    'The last resource checkpoint must survive a crash/restart');
  assert.equal(b.history.append('runtime','test16_s2',0,{
    phase:'runtime-sqlite-materialize',event:'start',datasetId:'mobile_brigade_data',
    at:new Date().toISOString()
  },{sessionId:'test16_s2',eventCount:1,status:'running'}),true);
  assert.equal(b.v2.status().globalSeq,2);
  const counts=await b.history.counts();
  assert.equal(counts.runtime,2,'Archive count includes both tabs and uncommitted WAL');
  assert.equal(counts.walPending,2);
  const totals=await b.v2.refreshArchive();
  assert.equal(totals.runtime,2);
  assert(b.v2.statusText({eventCount:1}).includes('Архив Runtime: 2'));
  const report=await b.history.collect('runtime');
  assert.equal(report.storage.eventsRecovered,2);
  assert.equal(report.diagnosticV2.globalSeq,2);
  assert.equal(report.diagnosticV2.interruptions.length,1);
  assert.equal(report.storage.missingSequences,0);
  assert(report.sessions.some(session=>session.sessionId==='test16_s1'));
  assert(report.sessions.some(session=>session.sessionId==='test16_s2'));
  assert.equal(b.history.append('runtime','test16_s2',1,{
    phase:'runtime-sqlite-materialize',event:'end',
    datasetId:'mobile_brigade_data',at:new Date().toISOString()
  },{sessionId:'test16_s2',eventCount:2,status:'prepared'}),true);
  const c=boot();
  const recorded=c.v2.status().interruptions.length;
  c.history.append('runtime','test16_s3',0,{
    phase:'queue-upload',event:'start',at:new Date().toISOString()
  },{sessionId:'test16_s3',eventCount:1,status:'running'});
  assert.equal(c.v2.status().running,null,'Queue upload alone must not be recorded as OOM');
  c.history.append('xlsx','test16_x1',0,{
    phase:'xlsx-worker-export',event:'start',at:new Date().toISOString()
  },{sessionId:'test16_x1',eventCount:1,status:'running'});
  c.history.append('xlsx','test16_x1',1,{
    phase:'xlsx-export',event:'end',at:new Date().toISOString()
  },{sessionId:'test16_x1',eventCount:2,status:'completed'});
  assert.equal(c.v2.status().running,null,'Completed XLSX must close worker marker');
  const d=boot();
  assert.equal(d.v2.status().interruptions.length,recorded,
    'Completed queue/XLSX operations must not cause false-positive interrupted sessions');
  const failed=boot('TEST_16_PR326',true);
  assert.equal(failed.v2.checkpoint('candidate-records',{rows:1},'start'),false);
  assert(failed.v2.status().storageFailures>0);
  const prod=boot('RELEASE');
  assert.equal(prod.v2.enabled(),false);
  assert.equal(prod.v2.checkpoint('candidate-records',{rows:1},'start'),false);
  const ui=fs.readFileSync('src/js/app/database_ui_state.js','utf8');
  assert([...ui].length<30000,'UI state limit: 30k characters');
  console.log('PASS TEST_16 V2: crash snapshots, no false interruption, WAL, global sequence, archive totals, PII filtering');
})().catch(error=>{console.error(error);process.exitCode=1;});
