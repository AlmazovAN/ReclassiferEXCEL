'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const source = fs.readFileSync('src/js/app/worker_client.js','utf8');
const makeClient = new Function(source + '\nreturn createWorkerClient;')();

class FakeWorker {
  constructor() { this.handlers = new Map(); this.sent = []; this.terminated = false; }
  addEventListener(event, handler) {
    const items = this.handlers.get(event) || []; items.push(handler);
    this.handlers.set(event, items);
  }
  postMessage(message) { this.sent.push(message); }
  terminate() { this.terminated = true; }
  emit(message) {
    for (const callback of this.handlers.get('message') || []) callback({data:message});
  }
  request(type) { return this.sent.find(m => m.type === type && m.requestId); }
}

(async () => {
  let seq=0;
  const workers=[];
  const client=makeClient({
    createWorker:()=>{const w=new FakeWorker(); workers.push(w); return w;},
    recycleAfterTypes:['PROCESS_MOBILE_BRIGADE'],
    requestTimeoutMs:600000,
    setTimeoutFn:()=>++seq,
    clearTimeoutFn:()=>{}
  });
  const a=client.request('PROCESS_MOBILE_BRIGADE',{});
  const w1=workers[0];
  w1.emit({type:'MOBILE_BRIGADE_RESULT',requestId:w1.request('PROCESS_MOBILE_BRIGADE').requestId,payload:{records:2}});
  assert.deepEqual(await a,{records:2});
  assert.equal(w1.terminated,true,'MB Worker must be terminated after its last result');
  assert.equal(client.state().active,false);
  const b=client.request('PROCESS_OTHER',{});
  const w2=workers[1];
  assert.notEqual(w1,w2,'Next job must get fresh Worker');
  w2.emit({type:'WORKER_RESULT',requestId:w2.request('PROCESS_OTHER').requestId,payload:7});
  assert.equal(await b,7);
  assert.equal(w2.terminated,false,'Non-MB jobs do not trigger recycling');

  const mb=client.request('PROCESS_MOBILE_BRIGADE',{});
  const other=client.request('PROCESS_OTHER',{});
  const mbId=w2.sent.filter(m=>m.type==='PROCESS_MOBILE_BRIGADE').at(-1).requestId;
  const otherId=w2.sent.filter(m=>m.type==='PROCESS_OTHER').at(-1).requestId;
  w2.emit({type:'MOBILE_BRIGADE_RESULT',requestId:mbId,payload:{ok:true}});
  assert.deepEqual(await mb,{ok:true});
  assert.equal(w2.terminated,false,'Must not terminate with another job in flight');
  w2.emit({type:'WORKER_RESULT',requestId:otherId,payload:8});
  assert.equal(await other,8);
  assert.equal(w2.terminated,true,'Deferred recycling must happen once all jobs finish');

  const failed=client.request('PROCESS_MOBILE_BRIGADE',{});
  const w3=workers[2];
  w3.emit({type:'WORKER_ERROR',requestId:w3.request('PROCESS_MOBILE_BRIGADE').requestId,payload:{message:'XLSX error'}});
  await assert.rejects(failed,/XLSX error/);
  assert.equal(w3.terminated,true,'Failed MB Worker must also release memory');
  client.dispose();
  console.log('Mobile Brigade Worker lifecycle/recycle between XLSX imports: OK');
})().catch(e=>{console.error(e);process.exitCode=1});
