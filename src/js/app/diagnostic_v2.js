// TEST_16: small, synchronous crash checkpoint independent of Runtime UI rings.
// No raw Dataset values, file names, text, or guessed RSS estimates.
(() => {
  'use strict';
  const KEY=globalThis.ReclassifierDiagnosticScope?.enabled
    ?globalThis.ReclassifierDiagnosticScope.v2Key:'reclassifier.diagnostic-v2.state';
  const enabled=()=>['TEST_16_PR326','TEST_17_PR332'].includes(globalThis.RECLASSIFIER_BUILD?.testLabel)||
    globalThis.ReclassifierDiagnosticScope?.enabled===true;
  const freshId=()=>Date.now().toString(36)+'_'+Math.random().toString(36).slice(2,10);
  const bootId=freshId();
  const validText=value=>String(value||'').toLowerCase()
    .replace(/[^a-z0-9_-]/g,'').slice(0,54);
  const validNumber=value=>Number.isSafeInteger(value)&&value>=0?value:null;
  const safeRead=()=>{
    try { const obj=JSON.parse(localStorage.getItem(KEY)||'null');
      return obj?.schemaVersion===2?obj:null;
    } catch (_) {return null;}
  };
  const previous=enabled()?safeRead():null;
  const previousBoot=previous?.bootId&&previous.bootId!==bootId ? {
    bootId:String(previous.bootId).slice(0,40),
    globalSeq:validNumber(previous.globalSeq)||0,
    lastWalAck:validNumber(previous.lastWalAck)||0,
    lastAt:previous.lastAt||null,
    lastPhase:validText(previous.lastPhase),
    running:previous.running||null,
    resources:previous.resources&&typeof previous.resources==='object'
      ?Object.fromEntries(Object.entries(previous.resources)
        .filter(([k,v])=>/^(inputBufferBytes|sqliteVfsInputBytes|wasmCapacityBytes|rows|fullRows|batchRows|workerGeneration|pendingMessages|runtimeCacheRows|runtimeCacheFullRows|runtimeCacheInstances)$/.test(k)&&validNumber(v)!==null))
      :{},
    checkpointPersisted:true
  }:null;
  const interruptions=Array.isArray(previous?.interruptions)
    ?previous.interruptions.slice(-8):[];
  if(previous?.running?.phase && previous?.bootId !== bootId) {
    interruptions.push({
      bootId:String(previous.bootId||'').slice(0,40),
      at:previous.lastAt||null,phase:validText(previous.running.phase),
      datasetId:validText(previous.running.datasetId),
      operationId:previous.running.operationId||null,
      lastWalAck:previous.lastWalAck||0,
      globalSeq:previous.globalSeq||0,status:'recovered-interrupted'
    });
  }
  let state={
    schemaVersion:2,bootId,globalSeq:validNumber(previous?.globalSeq)||0,
    registered:validNumber(previous?.registered)||0,
    lastWalAck:validNumber(previous?.lastWalAck)||0,
    walAcknowledged:validNumber(previous?.walAcknowledged)||0,
    storageFailures:validNumber(previous?.storageFailures)||0,
    lastAt:new Date().toISOString(),lastPhase:'boot',
    running:null,eventsByKind:previous?.eventsByKind||{runtime:0,xlsx:0},
    archiveCounts:null,interruptions:interruptions.slice(-8),
    previousBoot,resources:{},checkpointPersisted:false,lastError:null
  };
  const active=new Map();
  const critical=new Set(['candidate-records','candidate-prepare',
    'runtime-sqlite-materialize','kpi-worker-init','kpi-auto-calculate',
    'sqlite-open','sqlite-vfs-create','recognizer-xlsx','mb-worker',
    'xlsx-export','xlsx-worker-export','queue-drain']);
  let uiListener=null;
  function persist() {
    if(!enabled())return false;
    try {
      const saved={...state,archiveCounts:undefined,checkpointPersisted:undefined};
      localStorage.setItem(KEY,JSON.stringify(saved));
      state.checkpointPersisted=true;state.lastError=null;return true;
    } catch (_) {
      state.checkpointPersisted=false;state.storageFailures++;
      state.lastError='v2-local-storage-unavailable';
      return false;
    }
  }
  function notify(){try{uiListener?.();}catch(_){}}
  function event(kind,sessionId,localSeq,payload){
    if(!enabled())return null;
    state.globalSeq++;
    state.registered++;
    state.lastAt=payload?.at||new Date().toISOString();
    state.lastPhase=validText(payload?.phase);
    state.eventsByKind[kind]=(validNumber(state.eventsByKind[kind])||0)+1;
    const phase=state.lastPhase,operationId=String(sessionId)+':'+String(localSeq);
    const datasetId=validText(payload?.datasetId);
    if(payload?.event==='start'&&critical.has(phase))
      active.set(phase+':'+datasetId,{phase,datasetId,operationId});
    if(['end','error'].includes(payload?.event)) {
      active.delete(phase+':'+datasetId);
      if(phase==='xlsx-export'){
        // The worker phase has a start but intentionally no matching end.
        active.delete('xlsx-worker-export:');
      }
    }
    const now=[...active.values()];
    state.running=now.length?now[now.length-1]:null;
    persist();
    notify();
    return {globalSeq:state.globalSeq,bootId,operationId};
  }
  function ack(seq,ok) {
    if(!enabled())return;
    if(ok){
      state.lastWalAck=Math.max(state.lastWalAck,validNumber(seq)||0);
      state.walAcknowledged++;
    } else state.storageFailures++;
    persist();
  }
  // Named checkpoints before a heavyweight synchronous call persist even if
  // it never returns. These do not claim memory has been physically released.
  function checkpoint(phase,metrics={},phaseEvent='checkpoint'){
    if(!enabled())return false;
    const name=validText(phase);
    state.lastAt=new Date().toISOString();state.lastPhase=name;
    if(phaseEvent==='start')state.running={phase:name,
      datasetId:validText(metrics.datasetId),operationId:'cp:'+bootId+':'+(state.globalSeq+1)};
    if(['end','error'].includes(phaseEvent) && state.running?.phase===name)
      state.running=null;
    const allowed=['inputBufferBytes','sqliteVfsInputBytes','wasmCapacityBytes',
      'rows','fullRows','batchRows','workerGeneration','pendingMessages',
      'runtimeCacheRows','runtimeCacheFullRows','runtimeCacheInstances'];
    const sample={};
    for(const k of allowed)if(validNumber(metrics[k])!==null)sample[k]=metrics[k];
    state.resources={...state.resources,...sample};
    return persist();
  }
  async function refreshArchive(){
    if(!enabled()||!globalThis.ReclassifierDiagnosticHistory?.counts)return null;
    try {
      const totals=await globalThis.ReclassifierDiagnosticHistory.counts();
      state.archiveCounts=totals;notify();return totals;
    } catch (_){state.lastError='archive-counts-unavailable';notify();return null;}
  }
  function statusText(current){
    if(!enabled())return '';
    const tot=state.archiveCounts;
    const archived=tot?tot.runtime:'проверяется';
    const currentCount=Number(current?.eventCount||0);
    return (globalThis.ReclassifierDiagnosticScope?.enabled
      ?'HTML: '+globalThis.ReclassifierDiagnosticScope.filename+
        ' · версия: '+globalThis.ReclassifierDiagnosticScope.testLabel+' · ':'')+
      'Архив Runtime: '+archived+' · текущая сессия: '+currentCount+
      ' · глобальный №: '+state.globalSeq+' · WAL подтверждено: '+state.walAcknowledged+
      ' · предыдущих прерываний: '+state.interruptions.length+
      (state.lastError?' · ОШИБКА ЗАПИСИ':'');
  }
  function status(){return JSON.parse(JSON.stringify(state));}
  function subscribe(listener){uiListener=typeof listener==='function'?listener:null;}
  if(enabled())persist();
  globalThis.ReclassifierDiagnosticV2=Object.freeze({
    enabled,event,ack,checkpoint,refreshArchive,statusText,status,subscribe
  });
})();
