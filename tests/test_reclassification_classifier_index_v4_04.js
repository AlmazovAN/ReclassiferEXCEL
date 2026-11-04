'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const {buildIndex, levels} = require('../src/js/modules/reclassification/classifier_index_v4.js');
const branchA = ['СВР', 'Кабель камеры', 'Обрыв', 'Механическое воздействие'];
const branchB = ['Станция', 'Блок питания', 'Нет питания', 'Причина не установлена'];
const makeRecord = path => Object.fromEntries(levels.map((level, i) => [level, path[i]]));
const makeDataset = paths => ({ records: paths.map(makeRecord), validation: {status: 'valid'},
  meta: {dataVersion: 'synthetic-1', dataFingerprint: 'synthetic-digest', sourceType: 'synthetic'} });
const dataset = makeDataset([branchA, branchB, branchA, ['СВР', 'Камера', 'Нет видео', null]]);
const before = JSON.stringify(dataset);
const index = buildIndex(dataset);
assert.equal(index.list().length, 2);
assert.deepEqual(index.diagnostics.duplicateRows, [2]);
assert.deepEqual(index.diagnostics.incompleteRows, [3]);
assert.equal(index.provenance.dataFingerprint, 'synthetic-digest');
assert.equal(index.lookup(branchA).status, 'EXACT');
assert.deepEqual(index.lookup(['  свр ', 'Кабель\u00a0камеры', 'ОБРЫВ', branchA[3]]).branches[0].path, branchA);
assert.equal(index.lookup(['СВР', ...branchB.slice(1)]).status, 'NOT_FOUND');
assert.equal(index.lookup(branchA.slice(0, 3)).status, 'INCOMPLETE');
assert.equal(index.lookup(new Array(4)).status, 'INCOMPLETE');
assert.equal(index.lookup(['СВР', 'Кабель камеры', 'Обрыв', 'Причина не установлена']).status, 'NOT_FOUND');
assert.deepEqual(index.children([' свр ']).values, ['Кабель камеры']);
assert.deepEqual(index.children(branchA.slice(0, 3)).values, [branchA[3]]);
assert.deepEqual(index.children(['Нет']).values, []);
assert.throws(() => index.children(branchA), TypeError);
assert.deepEqual(index.byComponent('element', ' блок питания ').equipment, ['Станция']);
assert.throws(() => index.byComponent('unknown', 'СВР'), TypeError);
assert.equal(JSON.stringify(dataset), before);
assert.throws(() => { index.list()[0].path[0] = 'Changed'; }, TypeError);
assert.throws(() => { index.provenance.dataVersion = 'Changed'; }, TypeError);
dataset.records[0].equipment = 'Changed after build';
assert.equal(index.lookup(branchA).status, 'EXACT');
assert.throws(() => buildIndex({records: [], validation: {status: 'invalid'}}), TypeError);
assert.throws(() => buildIndex([]), TypeError);
assert.throws(() => buildIndex({records: [branchA], validation: {status: 'valid'}}), TypeError);
assert.throws(() => buildIndex({records: [{...makeRecord(branchA), disabled: 'Нет'}], validation: {status: 'valid'}}), TypeError);
assert.equal(buildIndex(makeDataset([])).list().length, 0);

// Case and spacing collisions preserve distinct canonical spellings, never arbitrary first-match.
const variant = ['свр', ...branchA.slice(1)];
const collision = buildIndex(makeDataset([branchA, variant]));
assert.equal(collision.diagnostics.normalizationCollisions.length, 1);
assert.equal(collision.lookup(['Свр', ...branchA.slice(1)]).status, 'AMBIGUOUS');
assert.equal(collision.lookup(branchA).status, 'EXACT');
assert.equal(collision.lookup(branchA).collision, true);
assert.equal(collision.children(['СвР']).ambiguousPrefix, true);
assert.equal(collision.list().length, 2);
// Punctuation and е/ё remain distinct: no unsanctioned semantic equivalence.
const distinct = buildIndex(makeDataset([branchA, ['СВР!', ...branchA.slice(1)]]));
assert.equal(distinct.diagnostics.normalizationCollisions.length, 0);

const alias = {term: 'БП', level: 'element', canonical: 'Блок питания', scope: ['Станция'],
  status: 'approved', kind: 'equivalent', source: 'Synthetic engineering review A'};
const semantics = {canonical: branchB[3], scope: ['Станция'], status: 'approved',
  kind: 'explicit_unknown', source: 'Synthetic engineering review B'};
const aliased = buildIndex(makeDataset([branchA, branchB]), {aliases: [alias], causeSemantics: [semantics]});
assert.equal(aliased.resolveAlias('element', 'БП').status, 'RESOLVED');
assert.deepEqual(aliased.resolveAlias('element', 'БП').branches[0].path, branchB);
assert.equal(aliased.resolveAlias('element', 'БП', ['СВР']).status, 'UNRESOLVED');
assert.equal(aliased.lookup(['Станция', 'БП', ...branchB.slice(2)]).status, 'NOT_FOUND');
assert.equal(aliased.causeSemantics(branchB).kind, 'explicit_unknown');
assert.equal(aliased.causeSemantics(branchB).evidenceProven, false);
assert.equal(aliased.causeSemantics(branchA).requiresEngineeringReview, true);
assert.equal(aliased.causeSemantics(['СВР', ...branchB.slice(1)]).status, 'NOT_FOUND');
assert.equal(aliased.causeReviewRegister().length, 2);
const proposed = buildIndex(makeDataset([branchB]), {aliases: [{...alias, status: 'proposed'}]});
assert.equal(proposed.resolveAlias('element', 'БП').status, 'UNRESOLVED');
const diagnostic = buildIndex(makeDataset([branchB]), {aliases: [{...alias, kind: 'diagnostic'}]});
assert.equal(diagnostic.resolveAlias('element', 'БП').status, 'UNRESOLVED');
assert.throws(() => buildIndex(makeDataset([branchA]), {aliases: [alias]}), /absent/);
assert.throws(() => buildIndex(makeDataset([branchB]), {aliases: [{...alias, source: ''}]}), /source/);
const ambiguity = buildIndex(makeDataset([branchA, branchB]), {aliases: [alias,
  {...alias, canonical: branchA[1], scope: ['СВР']}]});
assert.equal(ambiguity.resolveAlias('element', 'БП').status, 'AMBIGUOUS');
assert.equal(ambiguity.resolveAlias('element', 'БП', ['Станция']).status, 'RESOLVED');
const conflict = buildIndex(makeDataset([branchB]), {causeSemantics: [semantics,
  {...semantics, kind: 'factual_cause', source: 'Disagreeing synthetic reviewer'}]});
assert.equal(conflict.causeSemantics(branchB).status, 'CONFLICT');
assert.equal(conflict.causeSemantics(branchB).evidenceProven, false);
const actionPath = ['СВР', 'Камера', 'Другое', 'Монтаж'];
const action = buildIndex(makeDataset([actionPath]));
assert.equal(action.causeSemantics(actionPath).kind, 'unreviewed');
assert.deepEqual(action.causeSemantics(actionPath).suggestedKinds, ['action_or_circumstance']);
assert.equal(action.causeSemantics(actionPath).requiresEngineeringReview, true);
assert.equal(action.causeSemantics(actionPath).evidenceProven, false);
// Browser/Worker global surface has the same pure API; no window/document available.
const sandbox = {};
vm.runInNewContext(fs.readFileSync(require.resolve('../src/js/modules/reclassification/classifier_index_v4.js'), 'utf8'), sandbox);
assert.equal(sandbox.ReclassifierClassifierIndexV4.version, '4.0.0-v4-04');
console.log('V4-04 index: membership, non-Cartesian paths, collisions, aliases, semantics, immutability and worker API OK');
