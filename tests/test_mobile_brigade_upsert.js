const assert = require('node:assert/strict');

const upsert = require('../src/js/modules/mobile_brigade/upsert.js');

function row(recordKey, value, site = 'Рудник Октябрьский') {
  return {
    site,
    taskNumber: recordKey.split('|').at(-1),
    taskForShiftId: '',
    recordKey,
    request: '',
    value
  };
}

const current = [
  row('рудник октябрьский|task-1', 'old-1'),
  row('рудник октябрьский|task-2', 'same'),
  row('рудник скалистый|task-3', 'keep', 'Рудник Скалистый')
];

const incoming = [
  row('рудник октябрьский|task-1', 'new-1'),
  row('рудник октябрьский|task-2', 'same'),
  row('рудник октябрьский|task-4', 'new-4')
];

const prepared = upsert.prepare(current, incoming, {
  currentMeta: {
    latestSourceDate: '2026-09-04',
    earliestSourceDate: '2026-01-01',
    freshnessByScope: {
      'Рудник Октябрьский': '2026-09-04',
      'Рудник Скалистый': '2026-09-04'
    },
    sourceFreshness: [{ fileName: 'old.xlsx', freshness: '2026-09-04', scopes: ['Рудник Октябрьский'] }]
  },
  incomingMeta: {
    latestSourceDate: '2026-09-29',
    earliestSourceDate: '2026-08-01',
    freshnessByScope: { 'Рудник Октябрьский': '2026-09-29' },
    sourceFreshness: [{ fileName: 'new.xlsx', freshness: '2026-09-29', scopes: ['Рудник Октябрьский'] }]
  }
});

assert.deepStrictEqual(prepared.plan, {
  currentRows: 3,
  currentUniqueKeys: 3,
  currentRowsWithoutKey: 0,
  currentDuplicateKeys: 0,
  incomingRows: 3,
  incomingUniqueKeys: 3,
  incomingRowsWithoutKey: 0,
  incomingDuplicateKeys: 0,
  matchedKeys: 2,
  updatedKeys: 1,
  unchangedKeys: 1,
  addedKeys: 1,
  untouchedCurrentRows: 1,
  finalRows: 4
});
assert.equal(prepared.records.find(item => item.recordKey.endsWith('task-1')).value, 'new-1');
assert.equal(prepared.records.find(item => item.recordKey.endsWith('task-3')).value, 'keep');
assert.equal(prepared.records.find(item => item.recordKey.endsWith('task-4')).value, 'new-4');
assert.equal(prepared.meta.updateMode, 'upsert_by_record_key');
assert.equal(prepared.meta.latestSourceDate, '2026-09-29');
assert.equal(prepared.meta.earliestSourceDate, '2026-01-01');
assert.deepStrictEqual(prepared.meta.freshnessByScope, {
  'Рудник Октябрьский': '2026-09-29',
  'Рудник Скалистый': '2026-09-04'
});
assert.equal(prepared.meta.sourceFreshness.length, 2);

const duplicateIncoming = upsert.prepare(current, [
  row('рудник октябрьский|task-1', 'first'),
  row('рудник октябрьский|task-1', 'last')
]);
assert.equal(duplicateIncoming.plan.incomingDuplicateKeys, 1);
assert.equal(duplicateIncoming.records.find(item => item.recordKey.endsWith('task-1')).value, 'last');
assert.equal(duplicateIncoming.warnings.length, 1);

assert.throws(
  () => upsert.prepare(current, [{ recordKey: '', value: 'bad' }]),
  /без устойчивого recordKey/
);
assert.throws(
  () => upsert.prepare([row('x|1', 'a'), row('x|1', 'b')], [row('x|1', 'c')]),
  /нарушает контракт UPSERT/
);

console.log('Mobile Brigade incremental UPSERT: replace + append + preserve + freshness OK');
