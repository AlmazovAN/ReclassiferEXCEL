const assert = require('assert');
const rules = require('../src/js/modules/itsm/rules.js');

function baseInput(number) {
  return {
    created: '2026-09-20T08:00:00',
    completed: '2026-09-20T10:00:00',
    closed: null,
    number,
    territory: 'р. Северный',
    equipment: 'Камера',
    element: 'Видео',
    fault: 'Нет изображения',
    reason: 'Обрыв кабеля',
    shortDescription: 'Аварийный ремонт',
    openedBy: 'Иванов И.И.',
    slaWorking: 3600,
    closureCode: 'Выполнено полностью'
  };
}

const references = {
  reclassification: [],
  drivers: [],
  customers: [],
  type_request: [],
  initiators: [],
  exceptions: [],
  problem_grade: [],
  mobile_brigade_meta: {
    latestSourceDate: '2026-09-25'
  },
  mobile_brigade_data: [
    {
      request: 'INC-100',
      laborHours: 1.5,
      equipmentPlacement: 'Навесное',
      transport: 'ПДМ-17',
      equipmentUnit: 'UNIT-IGNORED'
    },
    {
      request: ' inc-100 ',
      laborHours: 2.25,
      equipmentPlacement: 'Навесное',
      transport: 'ПДМ-17',
      equipmentUnit: 'UNIT-IGNORED-2'
    },
    {
      request: 'INC-200',
      laborHours: 0.5,
      equipmentPlacement: 'Стационарное',
      transport: 'TRANSPORT-IGNORED',
      equipmentUnit: 'БКМ-1'
    },
    {
      request: 'INC-200',
      laborHours: 1,
      equipmentPlacement: 'Стационарное',
      transport: 'TRANSPORT-IGNORED-2',
      equipmentUnit: 'БКМ-2'
    },
    {
      request: 'INC-200',
      laborHours: 0.25,
      equipmentPlacement: 'Стационарное',
      transport: 'TRANSPORT-IGNORED-3',
      equipmentUnit: 'БКМ-1'
    }
  ]
};

const lookups = rules.buildLookups(references);

const mounted = rules.evaluateRow(baseInput('INC-100'), lookups, { asOfDate: '2026-09-25T00:00:00' });
assert.strictEqual(mounted.output['НаименованиеТехники'], 'ПДМ-17');
assert.strictEqual(mounted.output['рез6'], 3.75);

const stationary = rules.evaluateRow(baseInput('INC-200'), lookups, { asOfDate: '2026-09-25T00:00:00' });
assert.strictEqual(stationary.output['НаименованиеТехники'], 'БКМ-1; БКМ-2');
assert.strictEqual(stationary.output['рез6'], 1.75);

const missingCovered = rules.evaluateRow(baseInput('INC-404'), lookups, { asOfDate: '2026-09-25T00:00:00' });
assert.strictEqual(missingCovered.output['НаименованиеТехники'], 'нет в МБ');
assert.strictEqual(missingCovered.output['рез6'], 0);

const missingNewer = rules.evaluateRow({
  ...baseInput('INC-405'),
  created: '2026-09-26T08:00:00'
}, lookups, { asOfDate: '2026-09-27T00:00:00' });
assert.strictEqual(missingNewer.output['НаименованиеТехники'], 'нет данных МБ');
assert.strictEqual(missingNewer.output['рез6'], 0);

const missingSameDay = rules.evaluateRow({
  ...baseInput('INC-406'),
  created: '2026-09-25T23:59:59'
}, lookups, { asOfDate: '2026-09-27T00:00:00' });
assert.strictEqual(missingSameDay.output['НаименованиеТехники'], 'нет в МБ');
assert.strictEqual(missingSameDay.output['рез6'], 0);

const missingWithoutDate = rules.evaluateRow({
  ...baseInput('INC-407'),
  created: null
}, lookups, { asOfDate: '2026-09-27T00:00:00' });
assert.strictEqual(missingWithoutDate.output['НаименованиеТехники'], 'нет данных МБ');
assert.strictEqual(missingWithoutDate.output['рез6'], 0);

const lookupsWithoutFreshness = rules.buildLookups({
  ...references,
  mobile_brigade_meta: {}
});
const missingWithoutFreshness = rules.evaluateRow(
  baseInput('INC-408'),
  lookupsWithoutFreshness,
  { asOfDate: '2026-09-27T00:00:00' }
);
assert.strictEqual(missingWithoutFreshness.output['НаименованиеТехники'], 'нет данных МБ');
assert.strictEqual(missingWithoutFreshness.output['рез6'], 0);

// Without a Mobile Brigade Dataset, pure rules retain unknown placeholders;
// the browser ITSM flow permits processing and explains this reduced enrichment.
const legacyLookups = rules.buildLookups({
  reclassification: [],
  drivers: [],
  customers: [],
  type_request: [],
  initiators: [],
  exceptions: [],
  problem_grade: []
});
const legacy = rules.evaluateRow(baseInput('INC-100'), legacyLookups, { asOfDate: '2026-09-25T00:00:00' });
assert.strictEqual(legacy.output['НаименованиеТехники'], rules.placeholder);
assert.strictEqual(legacy.output['рез6'], rules.placeholder);

console.log('ITSM Mobile Brigade enrichment: equipment + labor + freshness statuses OK');
