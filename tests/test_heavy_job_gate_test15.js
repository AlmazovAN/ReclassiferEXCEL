'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');

function load(label='TEST_15_PR324') {
  const phases=[];
  const calls={paused:0,resumed:0,stopped:0};
  let status={state:'running',active:{priority:5},queued:0};
  const ctx={console,RECLASSIFIER_BUILD:{testLabel:label},
    ReclassifierDatabaseMemoryDiagnostics:{mark:(p,e)=>phases.push(p+':'+e)},
    ReclassifierKpiAutoRefresh:{
      pause:()=>{calls.paused++;return true},
      resume:()=>{calls.resumed++;return true}
    },
    ReclassifierKpiBackgroundJobs:{
      status:()=>status,
      preemptAuto:()=>{calls.stopped++;status={state:'idle',active:null,queued:0};return true}
    }
  };
  ctx.globalThis=ctx;
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync('src/js/app/heavy_operation_gate.js','utf8'),ctx);
  return {gate:ctx.ReclassifierHeavyJobGate,calls,phases,setStatus:value=>{status=value}};
}
{
  const {gate,calls,phases}=load();
  const token=gate.begin('xlsx');
  assert.equal(gate.busy(),true);
  assert.equal(gate.status().kind,'xlsx');
  assert.deepEqual(calls,{paused:1,resumed:0,stopped:1});
  assert.throws(()=>gate.begin('import'),/тяжёлая операция/);
  assert.equal(gate.end(token+1),false,'Must not unlock a different operation');
  assert.equal(gate.end(token),true);
  assert.equal(gate.busy(),false);
  assert.deepEqual(calls,{paused:1,resumed:1,stopped:1});
  assert(phases.includes('kpi-auto-preempted:end'));
  assert.equal(gate.end(token),false,'Duplicate release is harmless');
}
{
  const {gate,calls,setStatus}=load();
  setStatus({state:'running',active:{priority:2},queued:0});
  assert.throws(()=>gate.begin('xlsx'),/интерактивного/);
  assert.equal(gate.busy(),false);
  assert.equal(calls.stopped,0,'Interactive KPI worker must survive');
  assert.equal(calls.paused,0);
  setStatus({state:'running',active:{priority:5},queued:1});
  assert.throws(()=>gate.begin('import'),/ожидающего/);
  assert.equal(calls.stopped,0,'Never discard queued interactive tasks');
}
{
  const {gate,calls,setStatus}=load();
  setStatus({state:'idle',active:null,queued:0});
  const token=gate.begin('import');
  assert.equal(calls.paused,1);
  assert.equal(calls.stopped,0);
  assert(gate.end(token));
}
{
  const {gate,calls}=load('PRODUCTION');
  assert.equal(gate.begin('xlsx'),null);
  assert.equal(gate.busy(),false);
  assert.deepEqual(calls,{paused:0,resumed:0,stopped:0});
}
console.log('PASS TEST_15 gate: auto preemption, interactive protection, one lease, prod isolation');
