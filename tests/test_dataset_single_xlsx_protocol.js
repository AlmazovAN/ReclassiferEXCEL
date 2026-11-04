'use strict';
// End-to-end transport check: Worker repeatedly requests bounded SQLite
// chunks; client acks the chunks, and ONE result resolves the UI request.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const workerSource=fs.readFileSync('src/js/worker.js','utf8');
const clientSource=fs.readFileSync('src/js/app/worker_client.js','utf8');
const makeClient=new Function(clientSource+'\nreturn createWorkerClient;')();

function makeWorker() {
  const listeners=new Map();
  const exports=[];
  const internal={
    ReclassifierDatasetExportWorkerProcessor:{
      createStream({columns}) {
        const data=[];
        exports.push(data);
        return {
          append(rows){data.push(...rows);return data.length;},
          finish(){return {bytes:new ArrayBuffer(8),rows:data.length,
            columns:columns.length,longTextCells:0,overflowParts:0};}
        };
      }
    },
    postMessage(message) {
      for(const listener of listeners.get('message')||[]) {
        listener({data:message});
      }
    }
  };
  new Function('self',workerSource)(internal);
  return {
    exports,
    addEventListener(type,handler){
      const handlers=listeners.get(type)||[];
      handlers.push(handler);
      listeners.set(type,handlers);
    },
    postMessage(message){
      Promise.resolve().then(()=>internal.onmessage({data:message}))
        .catch(error=>{
          for(const h of listeners.get('error')||[])h(error);
        });
    },
    terminate(){}
  };
}
(async()=>{
  const worker=makeWorker();
  const client=makeClient({createWorker:()=>worker,requestTimeoutMs:5000});
  const calls=[];
  const result=await client.request('EXPORT_DATASET_XLSX_STREAM',{
    sheetName:'Мобильные бригады',columns:['Номер задачи']
  },[],null,({sequence,offset})=>{
    calls.push([sequence,offset]);
    const all=Array.from({length:20005},(_,i)=>['MB-'+i]);
    const rows=all.slice(offset,offset+10000);
    return {rows,hasMore:offset+rows.length<all.length};
  });
  assert.equal(result.rows,20005);
  assert.deepEqual(calls,[[0,0],[1,10000],[2,20000]]);
  assert.equal(worker.exports.length,1);
  assert.equal(worker.exports[0].length,20005);
  assert.equal(worker.exports[0][20004][0],'MB-20004');

  let attempts=0;
  await assert.rejects(
    client.request('EXPORT_DATASET_XLSX_STREAM',{
      sheetName:'Мобильные бригады',columns:['Номер задачи']
    },[],null,()=>{attempts++;throw Error('SQLite read failed');}),
    /SQLite read failed/
  );
  assert.equal(attempts,1);
  client.dispose();
  console.log('One XLSX transport, 3 SQLite batches + error propagation: PASS');
})().catch(error=>{console.error(error);process.exitCode=1});
