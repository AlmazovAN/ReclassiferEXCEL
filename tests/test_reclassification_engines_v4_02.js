'use strict';
// V4-02: synthetic engine isolation, unchanged legacy decisions, fail-fast behavior.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const {execFileSync} = require('node:child_process');
const fixture = require('./fixtures/reclassification_legacy_v4_01_golden.json');
const blobSha = execFileSync('git', [
  'hash-object', '--path=' + fixture.frozenSource.path, fixture.frozenSource.path
], {encoding:'utf8'}).trim();
assert.equal(blobSha, '8918f6079b5d18ca78074e831d2555eea7faeda7');

require('../src/js/modules/reclassification/rules.js');
const originalRules = globalThis.ReclassifierReclassificationRules;
require('../src/js/modules/reclassification/rules_v4.js');
require('../src/js/modules/reclassification/engine_registry.js');
const v4 = globalThis.ReclassifierReclassificationRulesV4;
const registry = globalThis.ReclassifierReclassificationEngineRegistry;
assert.strictEqual(globalThis.ReclassifierReclassificationRules, originalRules);
assert(Object.isFrozen(originalRules) && Object.isFrozen(v4) && Object.isFrozen(registry));
assert.notStrictEqual(originalRules, v4);
assert.deepEqual(registry.ids, ['legacy-3.3', 'independent-4.0']);
assert.equal(registry.defaultId, 'legacy-3.3');
assert.deepEqual(registry.list().map(x=>[x.id,x.available,x.globalName]), [
  ['legacy-3.3',true,'ReclassifierReclassificationRules'],
  ['independent-4.0',false,'ReclassifierReclassificationRulesV4']
]);
const legacy = registry.resolve();
assert.strictEqual(legacy, registry.resolve('legacy-3.3'));
assert.equal(registry.requireAvailable().version,'3.3.0');
assert.equal(legacy.adaptStatus('RITM_OK'),'RITM_OK');
for (const status of ['KEEP','CHANGE','BASELINE','REVIEW','RITM_OK','PENDING','CANCELLED'])
  assert.equal(legacy.adaptStatus(status), status);
assert.throws(()=>legacy.adaptStatus('READY'),e=>e.code==='RECLASS_UNKNOWN_STATUS');
assert.throws(()=>registry.resolve(''),e=>e.code==='RECLASS_ENGINE_UNKNOWN');
assert.throws(()=>registry.resolve('legacy-4.0'),e=>e.code==='RECLASS_ENGINE_UNKNOWN');
const originalCtx=originalRules.buildContext(fixture.classifier,{
  ordinaryRitmTemplates:fixture.ordinaryRitmTemplates
});
const adaptedCtx=legacy.buildContext(fixture.classifier,{
  ordinaryRitmTemplates:fixture.ordinaryRitmTemplates
});
for (const sample of fixture.ruleCases) {
  const row={...fixture.base,...sample.overrides};
  const raw=originalRules.evaluateRow({row,context:originalCtx});
  const adapted=legacy.evaluateRow({row,context:adaptedCtx});
  assert.deepEqual(adapted, raw, 'Changed legacy decision: '+sample.id);
  assert.equal(adapted.status,sample.expect.status);
}
const masked=v4.projectRow({
  number:'INC-TEST',shortDescription:'Проверить связь',
  description:'Связь отсутствует',closureNote:'Обнаружен обрыв',
  sourceEquipment:'FAKE',sourceElement:'FAKE',sourceFault:'FAKE',sourceReason:'FAKE',
  expertPath:['FAKE'],expertEquipment:'FAKE',expertElement:'FAKE',
  Наим1:'FAKE',Элем1:'FAKE',Неис1:'FAKE',Прич1:'FAKE',
  reclassifiedEquipment:'FAKE',classificationSourceLabel:'FAKE'
});
assert.equal(masked.description,'Связь отсутствует');
for (const forbidden of ['expertPath','expertEquipment','expertElement','sourceEquipment',
  'sourceElement','sourceFault','sourceReason','Наим1','Элем1','Неис1','Прич1',
  'reclassifiedEquipment','classificationSourceLabel'])
  assert(!Object.hasOwn(masked,forbidden),'V4 input leak: '+forbidden);
const failure=e=>e.code==='V4_NOT_IMPLEMENTED' &&
  e.engineId==='independent-4.0' && e.diagnostic?.status==='UNAVAILABLE' &&
  e.diagnostic?.readyForApply===false;
assert.throws(()=>registry.requireAvailable('independent-4.0'),failure);
assert.throws(()=>v4.buildContext(fixture.classifier),failure);
assert.throws(()=>v4.evaluateRow({row:masked}),failure);
// Prove fail-fast happens before the standard ITSM pass or any Excel/export preparation.
globalThis.XLSX={};
require('../src/js/modules/reclassification/classifier_index_v4.js');
require('../src/js/modules/reclassification/facts_v4.js');
require('../src/js/modules/reclassification/event_v4.js');
require('../src/js/modules/reclassification/objects_v4.js');
require('../src/js/modules/reclassification/diagnostics_v4.js');
require('../src/js/workers/reclassification_processor.js');
const worker=globalThis.ReclassifierReclassificationWorkerProcessor;
(async()=>{
  const references={reclassification:[{number:'INC-EXISTING'}]};
  const before=JSON.stringify(references), events=[];
  await assert.rejects(
    worker.process({engineId:'independent-4.0',references,
      classifierRecords:fixture.classifier},p=>events.push(p)),failure
  );
  await assert.rejects(
    worker.process({engineId:'typo',references,
      classifierRecords:fixture.classifier},p=>events.push(p)),
    e=>e.code==='RECLASS_ENGINE_UNKNOWN'
  );
  assert.deepEqual(events,[],'Rejected selection emitted progress');
  assert.equal(JSON.stringify(references),before,'Rejected selection modified reference');
  console.log('V4-02: registered engines, 7 unchanged legacy decisions, raw-only V4 projection, fail-fast OK');
})().catch(e=>{console.error(e);process.exitCode=1;});
