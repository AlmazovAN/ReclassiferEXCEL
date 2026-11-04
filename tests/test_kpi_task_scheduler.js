'use strict';
const assert=require('node:assert/strict');
const Scheduler=require('../src/js/app/kpi_task_scheduler.js');
const flush=()=>new Promise(resolve=>setImmediate(resolve));

(async()=>{
  const started=[];
  const blockers=[];
  const queue=Scheduler.create({
    run:async (job,progress)=>{
      started.push(job);
      progress({percent:10,label:'Вычисления'});
      return await new Promise(resolve=>blockers.push(resolve));
    },
    maxPending:3
  });
  const one=queue.enqueue({key:'running',priority:3,payload:'running'});
  const duplicate=queue.enqueue({key:'running',priority:3,payload:'not-run'});
  assert.strictEqual(one,duplicate,'Same key must coalesce outstanding tasks');
  await flush();
  assert.deepEqual(started,['running']);
  const low=queue.enqueue({key:'low',priority:4,payload:'low'});
  const high=queue.enqueue({key:'high',priority:1,payload:'high'});
  const mid=queue.enqueue({key:'mid',priority:2,payload:'mid'});
  await assert.rejects(queue.enqueue({key:'overflow',priority:5}),e=>e.code==='RECLASSIFIER_KPI_QUEUE_FULL');
  assert.equal(queue.status().queued,3);
  blockers.shift()('one');
  assert.equal(await one,'one');
  await flush();
  assert.deepEqual(started,['running','high'],'High priority must run before pending background work');
  blockers.shift()('high-result');
  assert.equal(await high,'high-result');
  await flush();
  assert.deepEqual(started,['running','high','mid']);
  blockers.shift()('mid-result');
  assert.equal(await mid,'mid-result');
  await flush();
  blockers.shift()('low-result');
  assert.equal(await low,'low-result');
  await flush();
  assert.equal(queue.status().state,'idle');
  assert.equal(queue.status().completed,4);

  const controller=new AbortController();
  const holding=queue.enqueue({key:'holding',priority:3,payload:'holding'});
  await flush();
  const cancelled=queue.enqueue({key:'cancel',priority:1,signal:controller.signal});
  controller.abort();
  await assert.rejects(cancelled,e=>e.code==='RECLASSIFIER_KPI_CANCELLED');
  blockers.shift()('holding-result');
  await holding;
  await flush();
  assert(!started.includes(null));

  const active=queue.enqueue({key:'active-stale',priority:2,payload:'active-stale'});
  await flush();
  const waiting=queue.enqueue({key:'waiting-stale',priority:2,payload:'waiting-stale'});
  queue.invalidate();
  await assert.rejects(active,e=>e.code==='RECLASSIFIER_KPI_STALE_TASK');
  await assert.rejects(waiting,e=>e.code==='RECLASSIFIER_KPI_STALE_TASK');
  blockers.shift()('ignored');
  await flush();
  assert(!started.includes('waiting-stale'));
  const recovered=queue.enqueue({key:'recovered',priority:1,payload:'recovered'});
  await flush();
  assert.equal(started.at(-1),'recovered');
  blockers.shift()('good');
  assert.equal(await recovered,'good');
  queue.dispose();
  await assert.rejects(queue.enqueue({key:'late'}),e=>e.code==='RECLASSIFIER_KPI_QUEUE_DISPOSED');

  // No PII / filter values should escape in queue status except caller-provided key.
  const status=queue.status();
  assert(!('sourcePack' in status));
  console.log('PR4 KPI scheduler: priority, dedup, capacity, cancellation, stale generations, disposal OK');
})().catch(error=>{console.error(error);process.exitCode=1;});
