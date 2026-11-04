'use strict';
// V4-03 schema/partition tests use only fictional technical narratives.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {validateCorpus,pathKey}=require('./reclassification_v4_03_validator.js');
const corpus=JSON.parse(fs.readFileSync(
  path.join(__dirname,'fixtures','reclassification_v4_03_synthetic_corpus.json'),'utf8'));
const valid=validateCorpus(corpus);
assert.equal(valid.ok,true,valid.errors.join('\n'));
assert.deepEqual([valid.summary.total,valid.summary.development,valid.summary.holdout,valid.summary.stationary],
  [17,12,5,2]);
const requireFailure=(edit,needle)=>{
  const copy=JSON.parse(JSON.stringify(corpus));
  edit(copy);
  const result=validateCorpus(copy);
  assert(!result.ok,'Validator accepted invalid fixture: '+needle);
  assert(result.errors.some(message=>message.includes(needle)),
    'Expected '+needle+'; got '+result.errors.join('; '));
};
assert.equal(corpus.cases.filter(c=>c.review.expectedStatus==='READY').length,3);
assert(corpus.cases.every(c=>c.review.reason),'Unexplained expected status');
assert(corpus.cases.every(c=>c.observations?.reported &&
  ['diagnosed','performed','outcome'].every(key=>Object.hasOwn(c.observations,key))));

assert(corpus.cases.some(c=>c.review.disposition==='INC_NON_FAILURE_OPEN'));
assert(corpus.cases.some(c=>c.reference.engineerBranchStatus==='outside_classifier'));
assert(corpus.cases.every(c=>c.population!=='stationary'||
  c.review.status==='requires_independent_review'));
requireFailure(c=>c.cases[0].incidentGroup=c.cases[12].incidentGroup,'incidentGroup across');
requireFailure(c=>c.cases[12].source={...c.cases[0].source},'identical text');
requireFailure(c=>c.cases[0].review.applyReady=true,'incomplete/uncertain');
requireFailure(c=>{delete c.cases[0].observations.reported},'reporter observation required');
requireFailure(c=>c.cases[1].review.levelEvidence.cause='', 'level evidence: cause');
requireFailure(c=>c.cases[1].review.proposedPath=['СВР','Кабель камеры','Обрыв кабеля','Выдуманная причина'],
  'READY path does not exist');
requireFailure(c=>c.cases[8].reference.engineerBranchStatus='in_classifier',
  'engineer path membership');
requireFailure(c=>c.cases[4].review.expectedStatus='READY','READY path');
requireFailure(c=>c.cases[0].review.expectedStatus='PARTIAL','ordinary RITM');
requireFailure(c=>c.cases[0].source.description='Email test@example.com', 'privacy');
requireFailure(c=>c.cases[11].review.status='independently_verified', 'stationary requires named reviewer');
// Splitting a duplicate into holdout, but leaving the other in development, must fail.
requireFailure(c=>c.cases[10].partition='holdout','incidentGroup across');
const decision=corpus.cases.find(x=>x.id==='SYN-INC-UNKNOWN-CAUSE-01');
assert(corpus.classifier.some(path=>pathKey(path)===pathKey(decision.review.proposedPath)));
assert.match(decision.review.levelEvidence.cause, /причина\s+(?:неизвестна|не\s+установлена)/i);
console.log('V4-03: 17 synthetic cases, split isolation, review gates and invalid mutations OK');
