'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const src=fs.readFileSync('src/js/app/recalculation_workspace.js','utf8');

(async()=>{
  const actions=[], plans=new WeakSet(), accepted=new WeakSet();
  let mode='legacy',base=0,commits=0;
  const refs=new Map([
    ['itsm_data',{records:[[1]],meta:{revision:1}}],
    ['mobile_brigade_data',{records:[{recordKey:'mb-1'}],meta:{revision:1}}]
  ]);
  const runtime={mode:()=>mode,get:id=>refs.get(id)};
  const coreApi={create:()=>{
    const known=new WeakMap();
    return {
      async preview(config) {
        actions.push('preview:'+config.steps.map(x=>x.datasetId).join(','));
        const plan=Object.freeze({
          kind:'recalculation-preview',canCommit:false,mode,
          checked:2,changed:1,hasChanges:true,
          asOfDate:'2026-10-14T00:00:00.000Z',
          datasets:Object.freeze([
            Object.freeze({datasetId:config.steps.at(-1).datasetId,changed:1,
              checked:2,changes:Object.freeze([{key:'a',fields:{x:{before:0,after:1}}}])})
          ])
        });
        known.set(plan,{mode,sources:Array.from(refs,([id,obj])=>[id,obj])});
        plans.add(plan);
        return plan;
      },
      assertCurrent(plan) {
        const info=known.get(plan);
        if(!info)throw Error('unknown plan');
        if(mode!==info.mode)throw Error('mode changed');
        if(info.sources.some(([id,ref])=>refs.get(id)!==ref))
          throw Error('source revision changed');
        return true;
      }
    };
  }};
  const itsmApi={create:()=>({createStep:()=>{
    actions.push('ITSM step');
    return {datasetId:'itsm_data',dependsOn:['reclassification'],calculate:()=>({})};
  }})};
  const mbApi={create:()=>({createStep:()=>{
    actions.push('MB step');
    return {datasetId:'mobile_brigade_data',dependsOn:['itsm_data'],calculate:()=>({})};
  }})};
  const commitApi={create:()=>({apply:(plan,config)=>{
    assert.equal(config.confirmed,true);
    assert.equal(config.assertCurrent(plan),true);
    assert.equal(config.rulesVersions.mobile_brigade_data,'1.5.0');
    assert.equal(config.rulesVersions.itsm_data,'1.2.1');
    actions.push('commit');
    commits++;
    return {mode,changedDatasetIds:['itsm_data','kpi_source']};
  }})};
  const context=vm.createContext({module:{exports:{}},console});
  vm.runInContext(src,context,{filename:'recalculation_workspace.js'});
  const api=context.ReclassifierRecalculationWorkspace;
  assert.equal(api.version,'1.0.0');
  const service=api.create({runtime,core:coreApi,itsm:itsmApi,mb:mbApi,commit:commitApi});
  const both=await service.prepare(['itsm_data','mobile_brigade_data']);
  assert.deepEqual(actions.slice(0,3),[
    'MB step','ITSM step','preview:mobile_brigade_data,itsm_data'
  ]);
  assert.equal(service.assertCurrent(both),true);
  assert.throws(()=>service.apply(both),/подтверждение/);
  assert.equal(commits,0);
  const result=service.apply(both,{confirmed:true});
  assert.equal(result.mode,'legacy');
  assert.equal(commits,1);
  assert.throws(()=>service.apply(both,{confirmed:true}),/уже применён/);
  assert.equal(commits,1);
  await assert.rejects(()=>service.prepare([]),/выберите/);
  await assert.rejects(()=>service.prepare(['drivers']),/выберите/);
  await assert.rejects(()=>service.prepare(['itsm_data','itsm_data']),/выберите/);
  actions.length=0;
  const mbOnly=await service.prepare(['mobile_brigade_data']);
  assert.deepEqual(actions,['MB step','preview:mobile_brigade_data']);
  actions.length=0;
  const itsmOnly=await service.prepare(['itsm_data']);
  assert.deepEqual(actions,['ITSM step','preview:itsm_data']);
  refs.set('reclassification',{records:[]});
  // The test fake treats every loaded active input as watched for changes.
  refs.set('itsm_data',{...refs.get('itsm_data')});
  assert.throws(()=>service.apply(itsmOnly,{confirmed:true}),/source revision changed/);
  mode='sqlite';
  assert.throws(()=>service.apply(mbOnly,{confirmed:true}),/mode changed/);
  assert.equal(commits,1);
  const newService=api.create({runtime,core:coreApi,itsm:itsmApi,mb:mbApi,commit:commitApi});
  const sqlPlan=await newService.prepare(['mobile_brigade_data','itsm_data']);
  assert.equal(sqlPlan.mode,'sqlite');
  const sqlResult=newService.apply(sqlPlan,{confirmed:true});
  assert.equal(sqlResult.mode,'sqlite');
  assert.equal(commits,2);
  console.log('PR7 workflow: staged order, chosen target, explicit confirmation, single-use, stale sources, both runtime modes OK');
})().catch(e=>{console.error(e);process.exitCode=1;});
