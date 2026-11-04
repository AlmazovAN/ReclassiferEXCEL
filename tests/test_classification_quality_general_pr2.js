const assert = require('node:assert/strict');
require('../src/js/kpi/source_facts.js');
require('../src/js/kpi/preparation/common.js');
require('../src/js/kpi/preparation/classification.js');
require('../src/js/kpi/calculator/common.js');
require('../src/js/kpi/calculator/definitions.js');
require('../src/js/kpi/calculator/classification_quality/calculate.js');
require('../src/js/modules/itsm/kpi_source.js');

const facts = globalThis.ReclassifierKpiSourceFacts;
const prepare = globalThis.ReclassifierKpiPrepareClassification.prepare;
const calculate = globalThis.ReclassifierKpiCalculateClassificationQuality.calculate;
const source = globalThis.ReclassifierKpiSource;

function request(id, classificationQuality, options = {}) {
  return {
    number: id,
    createdAt: '2026-09-01',
    completedAt: '2026-10-07',
    closedAt: '2026-10-09',
    classificationQuality,
    typeAfterReclassification: classificationQuality === 'RITM вместо INC' ? 'INC' : 'INC',
    territory: 'р. Северный',
    division: 'КФ',
    sdgrService: 'Навесное оборудование',
    reclassifiedEquipment: 'БКМ',
    openedBy: 'Инициатор',
    mbPresence: 'Нет в МБ',
    ...options
  };
}
function table(records) { return prepare(records.map(facts.itsmFact)); }
function result(records, query = {}) {
  return calculate({classification:table(records)}, query);
}
const accepted = [];
for (let i = 0; i < 90; i += 1) accepted.push(request('INC-' + i, 'INC без изм'));
for (let i = 0; i < 5; i += 1) accepted.push(request('RITM-CGPS-' + i, 'RITM вместо INC', {openedBy:'ЦГПС'}));
for (let i = 0; i < 5; i += 1) accepted.push(request('RITM-OTHER-' + i, 'RITM вместо INC', {openedBy:'Другой инициатор'}));

const overall = result(accepted, {period:'2026-10-01'});
assert.equal(overall.value, 90, 'All 10 wrong RITMs must count against GENERAL KPI.');
assert.equal(overall.components.classificationSuccessCount, 90);
assert.equal(overall.components.classificationTotalCount, 100);
assert.equal(overall.components.classificationIncUnchangedCount, 90);
assert.equal(overall.components.classificationRitmInsteadOfIncCount, 10);
assert.equal(overall.components.classificationIncCorrectedCount, 0);
assert.equal(overall.components.classificationIncUnclassifiedCount, 0);
assert.equal(overall.formulaVersion, '1.1.0');
assert.equal(overall.diagnostics.source.countedUsingCompletionDate, 100);
assert.equal(overall.diagnostics.source.periodBasis, 'completedAt-or-closedAt');
// Even a correct INC absent from Mobile Brigades must remain in GENERAL numerator.
assert.equal(accepted[0].mbPresence, 'Нет в МБ');

const cases = [
  request('INC-SEPT', 'INC без изм', {completedAt:'2026-09-29',closedAt:'2026-10-01'}),
  request('INC-CORRECTED', 'INC с исправлением', {completedAt:'',closedAt:'2026-10-02'}),
  request('INC-UNCLASSIFIED', 'INC не классифицирован', {completedAt:'n/a',closedAt:'2026-10-03'}),
  request('RITM-BAD', 'RITM вместо INC', {completedAt:'2026-10-04',closedAt:'2026-10-11'}),
  request('RITM-OK', 'RITM без изм', {completedAt:'2026-10-05',closedAt:'2026-10-11'}),
  request('INC-UNFINISHED', 'INC без изм', {completedAt:null,closedAt:null}),
  request('INC-NO-CLASS', 'Не оценивалось', {completedAt:'2026-10-06',closedAt:'2026-10-11'})
];
const detailed = table(cases);
assert.equal(detailed.meta.notApplicableRows, 2);
assert.equal(detailed.meta.includedRowsWithoutEventDate, 1);
assert.equal(detailed.meta.countedUsingCompletionDate, 2);
assert.equal(detailed.meta.countedUsingCloseDate, 2);
const sept = calculate({classification:detailed},{period:'2026-09-01'});
assert.equal(sept.value, 100);
assert.equal(sept.components.classificationIncUnchangedCount, 1);
const oct = calculate({classification:detailed},{period:'2026-10-01'});
assert.equal(oct.value, 0);
assert.equal(oct.components.classificationIncCorrectedCount, 1);
assert.equal(oct.components.classificationIncUnclassifiedCount, 1);
assert.equal(oct.components.classificationRitmInsteadOfIncCount, 1);
assert.equal(oct.components.classificationTotalCount, 3);
const across = calculate({classification:detailed}, {period: {start:'2026-09-01',end:'2026-10-31'}});
assert.equal(across.value, 25);
assert.equal(across.components.classificationTotalCount, 4);
assert.equal(across.components.classificationFailureCount, 3);

const scoped = result(accepted.concat([
  request('OTHER-MINE', 'INC с исправлением', {territory:'р. Таймырский'}),
  request('OTHER-EQUIPMENT', 'INC с исправлением', {reclassifiedEquipment:'Точка доступа'})
]), {period:'2026-10-01', filters:{mine:'Северный',equipmentName:'БКМ'}});
assert.equal(scoped.value, 90);
assert.equal(scoped.components.classificationTotalCount, 100);
assert.equal(result(accepted,{period:'2026-10-01',filters:{unknown:'x'}}).reason,'unsupported-filter');

const fields = [
  'number','createdAt','completedAt','closedAt','classificationQuality',
  'typeAfterReclassification','territory','division','sdgrService',
  'reclassifiedEquipment','openedBy','mbPresence'
];
const rows = cases.map(item => fields.map(field => item[field] ?? null));
const aggregate = source.aggregateItsmDataset(fields,rows);
function count(period, metric) {
  return aggregate.records.filter(row=>row.period===period).reduce((sum,row)=>sum+row[metric],0);
}
assert.equal(source.fields.length,22,'KPI_Source schema must stay at 22 columns.');
assert.equal(count('2026-09-01','classificationSuccessCount'),1);
assert.equal(count('2026-09-01','classificationTotalCount'),1);
assert.equal(count('2026-10-01','classificationSuccessCount'),0);
assert.equal(count('2026-10-01','classificationTotalCount'),3);
assert.equal(count('2026-10-01','slaTotalCount'),0, 'SLA source semantics must not change.');
console.log('PR2 general classification: 90% baseline, A/B/C/D, months/ranges, fallback, filters, exclusion, KPI_Source parity OK');
