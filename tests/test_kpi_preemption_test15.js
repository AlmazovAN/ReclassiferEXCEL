'use strict';
const assert=require('node:assert/strict');
globalThis.RECLASSIFIER_BUILD={testLabel:'TEST_15_PR324'};
globalThis.ReclassifierKpiTaskScheduler=require('../src/js/app/kpi_task_scheduler.js');
const Background=require('../src/js/app/kpi_background_jobs.js');
const Auto=require('../src/js/app/kpi_auto_refresh.js');
const flush=()=>new Promise(resolve=>setImmediate(resolve));

(async()=>{
  // A cancelled task in the dispatch microtask must not start a Worker.
  let started=0;
  const queue=globalThis.ReclassifierKpiTaskScheduler.create({
    run:()=>{started++;return Promise.resolve('unexpected')}
  });
  let invalidated=false;
  queue.subscribe(status=>{
    if(!invalidated && status.active?.priority===5){
      invalidated=true;
      queue.invalidate();
    }
  });
  const stale=queue.enqueue({key:'would-start',priority:5});
  await assert.rejects(stale,e=>e.code==='RECLASSIFIER_KPI_STALE_TASK');
  await flush();
  assert.equal(started,0,'Cancelled task started after being invalidated');
  queue.dispose();

  const clients=[];
  let firstRejected;
  const workerCode='test';
  globalThis.Worker=class DummyWorker{};
  const jobs=Background.create({
    workerCode,
    createClient:()=>{
      const index=clients.length;
      let generation=1,disposed=false;
      const client={
        state:()=>({active:!disposed,generation}),
        request:(type,body)=>{
          if(index===0) return new Promise((resolve,reject)=>{firstRejected=reject;});
          if(type==='KPI_INIT')return Promise.resolve({session:'session-2'});
          return Promise.resolve({session:'session-2',signature:body?.signature||'revision-1',snapshot:{}});
        },
        dispose:()=>{disposed=true;firstRejected?.(new Error('terminated'))}
      };
      clients.push(client);
      return client;
    }
  });
  const sourcePack={instances:{itsm_data:{records:[1]}},sources:[{id:'itsm_data',available:true}]};
  const job=()=>jobs.runReport({sourcePack,signature:'revision-1',priority:5});
  const pending=job();
  pending.catch(()=>{});
  await flush();
  assert.equal(jobs.status().active?.priority,5);
  assert.equal(clients.length,1,'First low-priority Worker must have started');
  assert.equal(jobs.preemptAuto(),true);
  await assert.rejects(pending);
  await flush();
  assert.equal(jobs.status().state,'idle');
  assert.equal(clients[0].state().active,false,'Worker must be physically disposed');
  assert.equal(jobs.preemptAuto(),false,'No active worker to preempt');
  const next=await job();
  assert.equal(next.signature,'revision-1');
  assert.equal(clients.length,2,'Resume must construct a fresh Worker');
  jobs.dispose();

  // Auto-refresh must not restart while suspended and must resume its pending
  // calculation without publishing a stale aborted result.
  const timers=new Map();
  let timerId=0, calculations=0, lastSignal=null;
  const report={
    getCachedSnapshot:()=>null,
    invalidate:()=>{},
    buildSnapshotAsync:async (_filters, opts)=>{
      calculations++;
      lastSignal=opts.signal;
      return {status:'ready',diagnostics:{stage:'full'}};
    }
  };
  const header={setKpi:()=>{}};
  const auto=Auto.create({report,header,
    setTimeout:(fn)=>{const id=++timerId;timers.set(id,fn);return id},
    clearTimeout:id=>timers.delete(id),
    isReady:()=>true,hasWorker:()=>true,hasInputs:()=>true});
  const drain=async()=>{
    const items=[...timers.values()];timers.clear();
    for(const fn of items)fn();
    await flush();
  };
  auto.request('baseline-ready');
  assert.equal(auto.status().pending,true);
  auto.pause();
  assert.equal(auto.status().suspended,true);
  await drain();
  assert.equal(calculations,0,'Suspended refresh started expensive KPI work');
  auto.resume();
  assert.equal(auto.status().suspended,false);
  await drain();
  assert.equal(calculations,1);
  assert.equal(lastSignal.aborted,false);
  assert.equal(auto.status().completed,1);
  auto.dispose();
  console.log('PASS TEST_15 KPI: no stale Worker dispatch, physical stop, lazy restart, auto pause/resume');
})().catch(error=>{console.error(error);process.exitCode=1;});
