'use strict';
const assert=require('node:assert/strict');
require('../src/js/app/dataset_catalog.js');
require('../src/js/app/field_registry.js');
require('../src/js/modules/itsm/dataset_schema.js');
require('../src/js/app/reliability_dashboard_data.js');
require('../src/js/modules/itsm/mb_presence.js');
require('../src/js/kpi/source_facts.js');
for(const part of ['common','failures','equipment','labor','sla','classification','prb','ktg','index'])
  require('../src/js/kpi/preparation/'+part+'.js');
require('../src/js/kpi/calculator/common.js');
require('../src/js/kpi/calculator/definitions.js');
for(const part of ['vbr','ktg','sla','classification_quality','classification_quality_cgps','labor','problem_management'])
  require('../src/js/kpi/calculator/'+part+'/calculate.js');
require('../src/js/kpi/calculator/index.js');
require('../src/js/kpi/catalog/contracts.js');
require('../src/js/kpi/catalog/index.js');
require('../src/js/kpi/passport_math.js');
require('../src/js/kpi/passport_view.js');
require('../src/js/kpi/execution_trace.js');

const catalog=globalThis.ReclassifierKpiCatalog;
const passport=globalThis.ReclassifierKpiPassportView;
const template=['overview','formula','method','sources','forecast'];
const ids=['vbr','ktg','classification_quality','classification_quality_cgps'];
const htmls=Object.fromEntries(ids.map(id=>[id,passport.renderContent(id)]));
function order(html) {
  return template.map(name=>html.indexOf('id="kpi-passport-'+name+'"'));
}
for(const id of ids) {
  const html=htmls[id];
  const idx=order(html);
  assert(idx.every(i=>i>=0),id+' must contain all five existing passport sections');
  assert.deepEqual([...idx].sort((a,b)=>a-b),idx,id+' section ordering');
  assert.equal((html.match(/id="kpi-passport-overview"/g)||[]).length,1);
  assert.equal((html.match(/id="kpi-passport-formula"/g)||[]).length,1);
  assert.equal((html.match(/id="kpi-passport-method"/g)||[]).length,1);
  assert.equal((html.match(/id="kpi-passport-sources"/g)||[]).length,1);
  assert.equal((html.match(/id="kpi-passport-forecast"/g)||[]).length,1);
}
const general=htmls.classification_quality;
const cgps=htmls.classification_quality_cgps;
for(const html of [general,cgps]) {
  for(const required of [
    'Как рассчитывается показатель','Фактическая трассировка',
    'Техническая документация','id="kpi-passport-operations"',
    'A + B + C + D','INC без изм','INC с исправлением',
    'INC не классифицирован','RITM вместо INC',
    'Дата выполнения обращения','Дата закрытия',
    'Месяц','Откуда берутся данные','Машинная запись'
  ]) {
    // Raw machine formula is labelled "Версия формулы" in the VBR/KTG layout.
    if(required==='Машинная запись')continue;
    assert(html.includes(required),'Missing '+required);
  }
  assert(html.includes('Текущий результат и происхождение'));
  assert(html.includes('id="kpi-passport-fact"'));
  assert(!html.includes('премиальн'));
  assert(!html.includes('Повреждение кабеля'));
  assert(!html.includes('Источники информации\nСодержание'));
  assert(html.includes('<mfrac>'),'Mathematical fraction required');
  assert(html.includes('<mo>+</mo>'),'A/B/C/D arithmetic required');
  assert(html.includes('Пример условный'),'Example is never a real snapshot result');
  assert(html.includes('Версия формулы'));
  assert(!html.includes('Математическое представление требует сверки'));
  assert(html.includes('Специалист')||html.includes('инженер'),'Engineering review explanation required');
}
assert(general.includes('все подходящие обращения ITSM Сириус'));
assert(general.includes('независимо от группы инициаторов'));
assert(general.includes('независимо от наличия задачи'));
assert(general.includes('сначала суммируются A, B, C, D'));
assert(general.includes('«RITM без изм»'));
assert(general.includes('Категорированная информация обращения.Описание'));
assert(general.includes('Примечание к закрытию'));
assert(general.includes('Наим1'));
assert(general.includes('90%'));
assert(cgps.includes('в рамках деятельности ЦГПС'));
assert(cgps.includes('В данный показатель включаются только обращения,'));
assert(cgps.includes('Группа инициаторов'));
assert(cgps.includes('«Открыл = Интеграция с МБ»') ||
  cgps.includes('«Открыл = Интеграция с МБ»'.replaceAll('«','')));
assert(cgps.includes('id="kpi-passport-source-itsm_data"'));
assert(cgps.includes('id="kpi-passport-source-mobile_brigade_data"'));
assert(cgps.includes('«Заявка» МБ'));
assert(cgps.includes('Нет в МБ'));
assert(cgps.includes('Нет данных МБ'));
assert(cgps.includes('других инициаторов'));
assert(cgps.includes('94,74'));
assert(cgps.includes('90 «INC без изм»'));
assert(cgps.includes('5 «RITM вместо INC» других инициаторов'));
assert(cgps.includes('поле «Открыл»')||cgps.includes('поля «Открыл»'));
assert.equal(catalog.getCalculation('classification_quality').formula.expression,
  'A / (A + B + C + D) × 100');
assert.equal(catalog.getCalculation('classification_quality_cgps').formula.expression,
  'A_MB / (A_MB + B_MB + C_MB + D_CGPS_MB) × 100');

// Real trace: source/preparation statistics are shown without inspecting row texts.
const table={id:'classification_quality_cgps',rowCount:3,
  grain:['period','mine'],meta:{
    periodBasis:'completedAt-or-closedAt',missingMbRows:2,unknownMbRows:3,
    excludedOtherInitiatorRitmRows:5,includedRows:95,
    countedUsingCompletionDate:95,mbLinkage:'current-mobile-brigade-request'
  }};
const collector=globalThis.ReclassifierKpiExecutionTrace.createCollector({
  prepared:{families:{classificationCgps:table}},
  sources:[
    {id:'itsm_data',available:true,rowCount:110,activeRevision:4},
    {id:'mobile_brigade_data',available:true,rowCount:120,activeRevision:8}
  ],query:{period:'2026-09-01'}
});
const stats=collector.finalize({classification_quality_cgps:{
  value:null,dataState:'no-data',reason:'mb-coverage-unknown',
  formulaVersion:'1.0.0',components:{
    classificationIncUnchangedCount:90,classificationIncCorrectedCount:0,
    classificationIncUnclassifiedCount:0,classificationRitmInsteadOfIncCount:5,
    classificationTotalCount:95,classificationSuccessCount:90,
    excludedNoMbCount:2,unknownMbCoverageCount:3,
    excludedOtherInitiatorRitmCount:5
  }
}}).byKpi.classification_quality_cgps;
assert.equal(stats.preparation[0].tableId,'classification_quality_cgps');
assert.equal(stats.preparation[0].diagnostics.unknownMbRows,3);
assert.equal(stats.preparation[0].diagnostics.missingMbRows,2);
const snap={query:{period:{month:'2026-09',label:'Сентябрь'},
  calculator:{period:'2026-09-01',filters:{}}},sources:[
  {id:'itsm_data',available:true,activeRevision:4},
  {id:'mobile_brigade_data',available:true,activeRevision:8}],
  results:{classification_quality_cgps:{
    value:null,dataState:'no-data',reason:'mb-coverage-unknown',
    components:stats.components,formulaVersion:'1.0.0'}},
  executionTrace:{byKpi:{classification_quality_cgps:stats}}
};
const traced=passport.renderContent('classification_quality_cgps',{snapshot:snap});
assert(traced.includes('Нет данных МБ: Dataset недоступен'));
assert(traced.includes('Исключено: подтверждённо нет в МБ'));
assert(traced.includes('Исключено: RITM других инициаторов'));
assert(traced.includes('unknownMbRows = 3'));
assert(traced.includes('missingMbRows = 2'));
assert(traced.includes('mb-coverage-unknown'));
assert(!traced.includes('94,74 %'),'Illustrative value must not appear as a real result');
assert.equal(catalog.get('classification_quality_cgps').definition.methodology.status,'draft');
console.log('PR5 quality passports: shared VBR/KTG layout, formulas, scope, lineage, evidence and unknown MB OK');
