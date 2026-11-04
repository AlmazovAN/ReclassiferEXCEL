'use strict';
// PR4: deterministic runtime contract for automatic, low-priority KPI refresh.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const Auto = require('../src/js/app/kpi_auto_refresh.js');

const finish = async () => {
  await Promise.resolve();
  await Promise.resolve();
  await new Promise(resolve => setImmediate(resolve));
};
function fixture() {
  let ready = false;
  let busy = false;
  let inputs = true;
  let worker = true;
  let user = false;
  let cached = null;
  let nextTimer = 0;
  const timers = new Map();
  const statuses = [];
  const jobs = [];
  let invalidated = 0;
  const report = {
    getCachedSnapshot() {return cached;},
    invalidate() {invalidated++;},
    buildSnapshotAsync(state,opts) {
      const job={state,opts};
      job.promise=new Promise((resolve,reject)=>{job.resolve=resolve;job.reject=reject;});
      jobs.push(job);
      return job.promise;
    }
  };
  const runner=Auto.create({
    report,
    header:{setKpi:(phase,percent)=>statuses.push([phase,percent])},
    isReady:()=>ready,
    isBusy:()=>busy,
    hasInputs:()=>inputs,
    hasWorker:()=>worker,
    userOnKpiRoute:()=>user,
    setTimeout(fn,ms) {const id=++nextTimer;timers.set(id,{fn,ms});return id;},
    clearTimeout(id) {timers.delete(id);},
    delayMs:20
  });
  async function tick() {
    const [id,task]=timers.entries().next().value || [];
    if(!task) throw Error('Expected an outstanding refresh timer.');
    timers.delete(id);
    task.fn();
    await finish();
    return task.ms;
  }
  return {runner,report,jobs,statuses,tick,timers,
    setReady:v=>ready=v,setBusy:v=>busy=v,setInputs:v=>inputs=v,
    setWorker:v=>worker=v,setCached:v=>cached=v,setUser:v=>user=v,
    invalidations:()=>invalidated};
}
(async()=>{
  const x=fixture();
  assert.equal(x.runner.request('unrelated',['initiators']),false,
    'non-KPI reference changes must not schedule recomputation');
  assert.equal(x.invalidations(),0);
  x.runner.request('bootstrap',['itsm_data']);
  assert.equal(x.timers.size,0,'no Worker clone during initial Dataset hydration');
  x.setReady(true);
  x.runner.request('baseline-ready');
  x.runner.request('batch-1',['itsm_data']);
  x.runner.request('batch-2',['mobile_brigade_data']);
  assert.equal(x.timers.size,1,'coalesce rapid consecutive commits');
  assert.equal(x.invalidations(),3);
  x.setBusy(true);
  assert.equal(await x.tick(),20);
  assert.equal(x.jobs.length,0,'do not read locked SQLite while import is committing');
  assert.equal(x.timers.size,1);
  x.setBusy(false);
  assert.equal(await x.tick(),1200);
  assert.equal(x.jobs.length,1);
  assert.equal(x.jobs[0].opts.priority,5,'auto work must yield to interactive priorities 1/2');
  assert.equal(x.jobs[0].opts.stage,'full');
  assert.deepEqual(x.jobs[0].state,{period:'latest',mine:'all',equipmentClass:'all'});
  assert.equal(x.jobs[0].opts.signal.aborted,false);
  x.jobs[0].opts.onProgress({percent:48,label:'Готово 4/12'});
  assert.deepEqual(x.statuses.at(-1),['calculating',48]);
  const old=x.jobs[0];
  x.runner.request('new source',['drivers']);
  assert.equal(old.opts.signal.aborted,true,'stale revision cancels prior work');
  old.opts.onProgress({percent:100,label:'Old'});
  assert.deepEqual(x.statuses.at(-1),['stale',null],
    'cancelled Worker cannot publish old completion');
  old.resolve({status:'ready',diagnostics:{stage:'full'}});
  await finish();
  assert.equal(x.runner.status().completed,0);
  await x.tick();
  assert.equal(x.jobs.length,2);
  x.jobs[1].resolve({status:'partial',diagnostics:{stage:'full'}});
  await finish();
  assert.equal(x.runner.status().completed,1);
  assert.deepEqual(x.statuses.at(-1),['partial',null],
    'incomplete sources must not appear green');
  assert.equal(x.runner.status().pending,false);

  x.setCached({status:'ready',diagnostics:{stage:'full'}});
  x.runner.request('return',['itsm_data']);
  await x.tick();
  assert.equal(x.jobs.length,2,'reuse revision-valid cached Snapshot');
  assert.deepEqual(x.statuses.at(-1),['ready',null]);

  x.setCached(null);
  x.setInputs(false);
  x.runner.request('empty');
  await x.tick();
  assert.equal(x.jobs.length,2,'CORE with no input never seeds Worker');
  assert.deepEqual(x.statuses.at(-1),['idle',null]);
  x.setInputs(true);
  x.setWorker(false);
  x.runner.request('unsupported-browser');
  await x.tick();
  assert.deepEqual(x.statuses.at(-1),['stale',null]);
  assert.equal(x.jobs.length,2);

  x.setWorker(true);
  x.setUser(true);
  const before=x.statuses.length;
  x.runner.request('while-dashboard-open');
  await x.tick();
  assert.equal(x.jobs.length,3,'background calculation is still permitted');
  assert.equal(x.statuses.length,before,'interactive page owns header updates');
  x.jobs[2].resolve({status:'ready',diagnostics:{stage:'full'}});
  await finish();
  assert.equal(x.runner.status().completed,2);
  assert.equal(x.statuses.length,before);
  x.runner.dispose();
  assert.equal(x.runner.status().running,false);
  assert.equal(x.runner.request('after-dispose'),false);

  const y=fixture();
  y.setReady(true);
  y.runner.request('bad');
  await y.tick();
  y.jobs[0].reject(new Error('Worker crashed'));
  await finish();
  assert.match(y.runner.status().lastError,/Worker crashed/);
  assert.deepEqual(y.statuses.at(-1),['error',null]);
  y.runner.dispose();

  const build=fs.readFileSync('build/build.py','utf8');
  assert(build.includes('"app/kpi_auto_refresh.js",'));
  assert(build.indexOf('"app/kpi_auto_refresh.js",') <
    build.indexOf('"app/runtime.js",'));
  const runtime=fs.readFileSync('src/js/app/runtime.js','utf8');
  assert(runtime.includes('ReclassifierKpiAutoRefreshFactory'));
  assert(runtime.includes("request?.('baseline-ready')"));
  const pipeline=fs.readFileSync('src/js/app/dataset_pipeline.js','utf8');
  assert(pipeline.includes("notifyKpiSourceChange(prepared.map(item => item.id))"));
  const db=fs.readFileSync('src/js/app/database_ui_state.js','utf8');
  for(const reason of ['database-opened','integration-committed',
                       'equipment-batch-committed','recalculation-committed']) {
    assert(db.includes(reason),'SQLite trigger missing '+reason);
  }
  const report=fs.readFileSync('src/js/app/reliability_report_service.js','utf8');
  assert(report.includes('reportProgress(35,'));
  assert(report.includes("'Месячная история ' + (index + 1)"));
  assert(report.includes('remember(snapshotCache,stateCacheKey(state),snapshot,MAX_SNAPSHOTS)'));
  const workerSource=fs.readFileSync('src/js/workers/kpi_worker.js','utf8');
  assert(workerSource.includes("onProgress: update =>"));
  console.log('PR4: debounced Worker auto-refresh, data revisions, truthful progress/cache and cancellation OK');
})().catch(error=>{console.error(error);process.exitCode=1;});
