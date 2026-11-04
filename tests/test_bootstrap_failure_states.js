'use strict';
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const source=fs.readFileSync('src/js/app/runtime.js','utf8');
const first=source.indexOf('  function initializeApplication() {');
const last=source.indexOf('\n  initializeApplication();',first);
assert(first>0&&last>first,'Runtime initialization entrypoint not found');
const boot=source.slice(first,last)+'\ninitializeApplication();';
async function bootWith(restoreError=null){
 const callbacks=[],events=[],state={baselineReady:false};
 const ctx={state,build:{dataMode:'core-no-data'},performance:{now:()=>25},globalThis:null,
  document:{getElementById:()=>({textContent:''})},setTimeout:callback=>callbacks.push(callback),
  render:()=>{},log:(message,level)=>events.push({message,level}),
  hydrateDatasetPack:async()=>{if(restoreError)throw new Error(restoreError);return 0;},
  datasetStore:{list:()=>[],get:()=>null}};
 ctx.globalThis=ctx; vm.runInNewContext(boot,ctx); await callbacks[0](); return {state,events};
}
(async()=>{
 const ready=await bootWith();
 assert.equal(ready.state.bootstrapState,'ready');
 assert.equal(ready.state.baselineReady,true);
 assert(ready.events.some(event=>event.message.includes('подключите SQLite')));
 const failed=await bootWith('HTML data-pack is corrupt');
 assert.equal(failed.state.bootstrapState,'failed');
 assert.equal(failed.state.baselineReady,false);
 assert.match(failed.state.bootstrapError,/corrupt/);
 assert(failed.events.some(event=>event.message.includes('Запуск ограничен')));
 console.log('Bootstrap status: data-free CORE ready without records; invalid local snapshot fails closed');
})().catch(error=>{console.error(error);process.exitCode=1});
