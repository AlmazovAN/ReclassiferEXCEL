'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const messages=[];
let prepareCalls=0,calcCalls=0,finalized=0;
const ctx={
  self:{postMessage:message=>messages.push(message)},
  ReclassifierKpiComputationService:{
    status(){return {materializedResults:{size:0,capacity:2048,hits:0,misses:0,evictions:0}};},
    prepare(pack,signature){prepareCalls++;assert.equal(signature,'version-1');
      return {version:'test-prep',families:{},sourceRows:pack.instances.itsm_data.records.length};},
    calculate({prepared,sources,query,kpis,trace}){
      calcCalls++;assert.equal(prepared.version,'test-prep');
      assert.equal(query.period,'2026-09-01');
      if(trace)assert.equal(trace.forKpi('vbr'),'collector');
      return {version:'same-calculator',results:Object.fromEntries(kpis.map(k=>[k,{value:95,dataState:'available'}]))};
    }
  },
  ReclassifierReliabilityReportService:{
    buildSnapshot(state,{stage,onProgress}){
      assert.equal(state.mine,'all');
      onProgress?.({percent:35,label:'Основные показатели рассчитаны'});
      onProgress?.({percent:90,label:'Месячная история 12/12'});
      return {type:'reliability-report',diagnostics:{stage},results:{vbr:{value:95}}};
    }
  },
  ReclassifierKpiExecutionTrace:{createCollector(){return {
    forKpi:()=> 'collector',
    finalize:results=>{finalized++;return {observed:results.vbr.value};}
  };}}
};
vm.createContext(ctx);
vm.runInContext(fs.readFileSync('src/js/workers/kpi_worker.js','utf8'),ctx);
function send(type,requestId,payload){
  messages.length=0;
  ctx.self.onmessage({data:{type,requestId,payload}});
  return messages.map(v=>({type:v.type,payload:v.payload}));
}
assert.equal(send('PING','ping').at(-1).type,'KPI_READY');
const pack={instances:{itsm_data:{records:[]}},sources:[{id:'itsm_data',available:true}]};
let result=send('KPI_INIT','init',{sourcePack:pack,signature:'version-1'});
assert.equal(result[0].type,'WORKER_PROGRESS');
assert.equal(result.at(-1).type,'KPI_INITIALIZED');
assert.equal(prepareCalls,1);
const session=result.at(-1).payload.session;
let stageResult=send('KPI_REPORT','primary',{session,state:{mine:'all'},stage:'primary'});
assert.equal(stageResult.at(-1).type,'KPI_REPORT_RESULT');
assert.equal(stageResult.at(-1).payload.snapshot.diagnostics.stage,'primary');
assert(stageResult.some(v=>v.type==='WORKER_PROGRESS' && v.payload.percent===35));
assert(stageResult.some(v=>v.type==='WORKER_PROGRESS' && v.payload.percent===90));
assert(stageResult.findIndex(v=>v.type==='WORKER_PROGRESS' && v.payload.percent===90) <
  stageResult.length-1,'intermediate progress must precede result');
stageResult=send('KPI_REPORT','full',{session,state:{mine:'all'},stage:'full'});
assert.equal(stageResult.at(-1).payload.snapshot.results.vbr.value,95);
assert.equal(send('KPI_REPORT','wrong',{session:session-1,state:{mine:'all'}}).at(-1).type,'WORKER_ERROR');
const query={period:'2026-09-01',filters:{}};
result=send('KPI_CALCULATE','req',{session,query,kpis:['vbr'],trace:true});
assert.equal(result.at(-1).type,'KPI_RESULT');
assert.equal(result.at(-1).payload.calculated.version,'same-calculator');
assert.equal(result.at(-1).payload.calculated.results.vbr.value,95);
assert.equal(result.at(-1).payload.executionTrace.observed,95);
assert.equal(calcCalls,1);
assert.equal(finalized,1);
result=send('KPI_CALCULATE','bad',{session:session-1,query,kpis:['vbr']});
assert.equal(result.at(-1).type,'WORKER_ERROR');
assert.equal(calcCalls,1,'A stale worker session must not calculate');
result=send('KPI_CALCULATE','no-seed',{session:session+1,query,kpis:['vbr']});
assert.equal(result.at(-1).type,'WORKER_ERROR');

const build=fs.readFileSync('build/build.py','utf8');
assert(build.includes('kpi_worker_js = '));
assert(build.includes('"kpiWorker": kpi_worker_js'));
assert(!fs.readFileSync('src/js/workers/kpi_worker.js','utf8').includes('importScripts('));
const runtime=fs.readFileSync('src/js/app/runtime.js','utf8');
assert(runtime.includes('ReclassifierKpiBackgroundJobs'));
const report=fs.readFileSync('src/js/app/reliability_report_service.js','utf8');
assert(report.includes('calculateKpiAsync('));
console.log('PR4 KPI worker protocol: session isolation, progress, Calculator and trace path OK');
