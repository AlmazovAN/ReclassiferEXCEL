const assert = require('node:assert/strict');
const presence = require('../src/js/modules/itsm/mb_presence.js');

const mb = [
  { request: ' inc-123 ', transport: 'Камера', equipmentUnit: '' },
  { request: 'INC-123', transport: '', equipmentUnit: '' },
  { request: 'ritm-55', transport: '', equipmentUnit: 'Не указано' }
];
const index = presence.buildIndex(mb);
assert.equal(index.size, 2, 'Two MB tasks from one ITSM request must count once.');
assert.equal(presence.evaluate(index, 'INC-123', '2026-09-20', {latestSourceDate:'2026-09-25'}), 'Есть в МБ');
assert.equal(presence.evaluate(index, 'INC-404', '2026-09-20', {latestSourceDate:'2026-09-25'}), 'Нет в МБ');
assert.equal(presence.evaluate(index, 'INC-404', '2026-09-26', {latestSourceDate:'2026-09-25'}), 'Нет в МБ');
assert.equal(presence.evaluate(index, 'INC-404', '2026-09-20', {}, true), 'Нет в МБ');
assert.equal(presence.evaluate(index, 'INC-404', null, {latestSourceDate:'2026-09-25'}), 'Нет в МБ');
assert.equal(presence.evaluate(index, 'INC-404', '2026-09-20', {earliestSourceDate:'2026-09-21',latestSourceDate:'2026-09-25'}), 'Нет в МБ');
assert.equal(presence.evaluate(index, 'INC-123', '2026-09-20', {}, false), 'Нет данных МБ');
assert.equal(presence.evaluate(index, '', '2026-09-20', {latestSourceDate:'2026-09-25'}), 'Нет данных МБ');

const noMatch = { records: [], meta: { latestSourceDate: '2026-09-25' } };
assert.equal(presence.fromCurrentDatasets('INC-123', '2026-09-20', noMatch), 'Нет в МБ');
assert.equal(presence.fromCurrentDatasets('INC-123', '2026-09-20', {
  records: mb, meta: {latestSourceDate:'2026-09-25'}
}), 'Есть в МБ', 'A new MB Dataset must recompute the live answer.');
assert.equal(presence.fromCurrentDatasets('INC-123', '2026-09-20', null), 'Нет данных МБ');

console.log('ITSM ↔ MB request presence: ID-only lookup, duplicate MB, unavailable dataset and live update OK');
