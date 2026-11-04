// PR-5 Worker -> SQLite ACK/backpressure contract.
// Synthetic messages only; no filesystem access, database or user data.
'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const src=fs.readFileSync(path.join(__dirname,'../src/js/app/worker_client.js'),'utf8');
const createWorkerClient=new Function(src+'\nreturn createWorkerClient;')();
class FakeWorker {
  constructor(){this.handlers=new Map();this.sent=[];this.stopped=false;}
  addEventListener(kind,callback){
    const callbacks=this.handlers.get(kind)||[];
    callbacks.push(callback);this.handlers.set(kind,callbacks);
  }
  postMessage(data){this.sent.push(data);}
  emit(data){for(const handler of this.handlers.get('message')||[])handler({data});}
  terminate(){this.stopped=true;}
}
const tick=()=>new Promise(resolve=>setImmediate(resolve));
(async()=>{
  const worker=new FakeWorker();
  const client=createWorkerClient({createWorker:()=>worker,requestTimeoutMs:300000});
  let allowBatch, batchInvocations=0;
  const gate=new Promise(resolve=>{allowBatch=resolve;});
  const task=client.request('PROCESS_MOBILE_BRIGADE',{streamToSqlite:true},[],null,
    async batch=>{
      batchInvocations++;
      assert.deepEqual(batch.rows,[{recordKey:'key-1'}]);
      assert.equal(batch.sequence,1);
      await gate;
    });
  const requestId=worker.sent[0].requestId;
  worker.emit({type:'WORKER_STAGE_BATCH',requestId,
    payload:{sequence:1,rows:[{recordKey:'key-1'}]}});
  await tick();
  assert.equal(batchInvocations,1);
  assert.equal(worker.sent.filter(message=>message.type==='WORKER_STAGE_ACK').length,0,
    'Worker received ACK before SQLite batch write completed');
  allowBatch();
  await tick();
  const success=worker.sent.filter(message=>message.type==='WORKER_STAGE_ACK');
  assert.equal(success.length,1);
  assert.equal(success[0].sequence,1);
  assert.equal(success[0].ok,true);
  worker.emit({type:'MOBILE_BRIGADE_RESULT',requestId,payload:{rows:1}});
  assert.deepEqual(await task,{rows:1});

  const rejected=client.request('PROCESS_MOBILE_BRIGADE',{streamToSqlite:true},[],null,
    async()=>{throw new Error('SQL write rejected');});
  const request2=worker.sent.findLast(message=>message.type==='PROCESS_MOBILE_BRIGADE').requestId;
  worker.emit({type:'WORKER_STAGE_BATCH',requestId:request2,
    payload:{sequence:1,rows:[{recordKey:'key-2'}]}});
  await tick();
  const failure=worker.sent.filter(message=>
    message.type==='WORKER_STAGE_ACK' && message.requestId===request2);
  assert.equal(failure.length,1);
  assert.equal(failure[0].ok,false);
  assert.match(failure[0].error,/SQL write rejected/);
  worker.emit({type:'WORKER_ERROR',requestId:request2,
    payload:{message:'SQL write rejected'}});
  await assert.rejects(rejected,/SQL write rejected/);
  assert.equal(client.state().pendingRequests,0);
  client.dispose();
  assert.equal(worker.stopped,true);
  console.log('PR-5 Worker SQLite ACK/backpressure and failed SQL write: OK');
})().catch(error=>{console.error(error);process.exitCode=1;});
