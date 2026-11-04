const assert = require('node:assert/strict');
const journal = require('../src/js/app/diagnostic_journal.js');
const p = (id, phase, dataset = 'itsm_data', level = 'INFO') =>
  journal.capture('[DBOP-' + id + '] ' + phase + ' · Dataset ' + dataset, level, 'import_export');
const one = id => journal.operationSummary().operations.find(x => x.id === 'DBOP-' + id);
journal.clear();
journal.setEnabled('import_export', true);

p(1, 'PREPARE_STARTED');
p(1, 'PREPARE_READY');
p(1, 'COMMIT_STARTED');
p(1, 'COMMIT_APPLIED');
assert.equal(one(1).status, 'applied');
assert.equal(one(1).eventCount, 4);
assert.equal(one(1).hasStart, true);

p(2, 'PREPARE_STARTED');
p(2, 'PREPARE_READY');
p(2, 'COMMIT_STARTED');
p(2, 'COMMIT_APPLIED');
p(2, 'RUNTIME_SYNC_FAILED', 'itsm_data', 'WARN');
assert.equal(one(2).status, 'applied_sync_warning');

p(3, 'PREPARE_STARTED');
p(3, 'PREPARE_READY');
p(3, 'COMMIT_STARTED');
p(3, 'COMMIT_FAILED', 'itsm_data', 'ERROR');
assert.equal(one(3).status, 'failed');

p(4, 'PREPARE_STARTED');
p(4, 'PREPARE_READY');
p(4, 'COMMIT_STARTED');
p(4, 'COMMIT_ROLLED_BACK', 'itsm_data', 'WARN');
assert.equal(one(4).status, 'rolled_back');

p(5, 'PREPARE_STARTED');
p(5, 'PREPARE_READY');
assert.equal(one(5).status, 'awaiting_confirmation');

p(6, 'PREPARE_STARTED');
assert.equal(one(6).status, 'preparing');

p(7, 'PREPARE_FAILED', 'itsm_data', 'ERROR');
assert.equal(one(7).status, 'failed');
assert.equal(one(7).hasStart, false);

p(8, 'PREPARE_STARTED');
p(8, 'PREPARE_SUPERSEDED', 'itsm_data', 'WARN');
assert.equal(one(8).status, 'superseded');

p(9, 'PREPARE_STARTED');
p(9, 'PREPARE_READY');
p(9, 'PREPARE_REJECTED', 'itsm_data', 'WARN');
assert.equal(one(9).status, 'rejected');

p(10, 'PREPARE_STARTED', 'mounted');
p(10, 'BATCH_COMMIT_STARTED', 'mounted');
p(10, 'BATCH_COMMIT_APPLIED', 'mounted');
assert.equal(one(10).status, 'applied');
assert.equal(one(10).dataset, 'mounted');

// Trace spoofing in other categories or messages is ignored.
journal.capture('[DBOP-123] COMMIT_APPLIED · Dataset itsm_data', 'INFO', 'general');
journal.capture('irrelevant DBOP-999 COMMIT_FAILED', 'ERROR', 'import_export');
assert.equal(journal.operationSummary().totalOperations, 10);
assert.equal(journal.operationSummary().operations[0].id, 'DBOP-10');

const before = journal.entries();
const summary = journal.operationSummary();
assert.deepEqual(journal.entries(), before);
assert.equal(summary.counts.failed, 2);
assert.equal(summary.counts.applied, 2);
assert.equal(summary.counts.applied_sync_warning, 1);
assert.equal(summary.completeHistoryGuaranteed, false);
const exported = journal.exportSnapshot('PR08');
assert.equal(exported.operationSummary.operations.length, 10);
assert.equal(exported.events.length, journal.entries().length);

// Truncated buffers: no false claim that absence of PREPARE_STARTED proves failure.
journal.clear();
p(11, 'PREPARE_STARTED');
for (let index = 0; index < 300; index++) journal.capture('Noise ' + index, 'INFO', 'import_export');
p(11, 'COMMIT_APPLIED');
assert.equal(one(11).hasStart, false);
assert.equal(one(11).status, 'applied');
assert.equal(journal.operationSummary().droppedEvents, 2);
assert.equal(journal.operationSummary().retainedEvents, 300);

// Disabling capture never stops application workflows or mutates the summary.
journal.clear();
journal.setEnabled('import_export', false);
assert.equal(p(12, 'PREPARE_STARTED'), null);
assert.equal(journal.operationSummary().captureEnabled, false);
assert.equal(journal.operationSummary().totalOperations, 0);
journal.setEnabled('import_export', true);
journal.capture('[DBOP-13] PREPARE_STARTED · Dataset itsm_data', 'INFO', 'import_export');
assert.equal(journal.operationSummary().totalOperations, 1);
journal.clear();
assert.equal(journal.operationSummary().totalOperations, 0);
assert.equal(journal.operationSummary().droppedEvents, 0);

console.log('PR-08 DBOP summary, truncated history, export and capture controls: OK');
