'use strict';
const assert=require('node:assert/strict');
require('../src/js/app/dataset_catalog.js');
require('../src/js/app/field_registry.js');
require('../src/js/modules/itsm/dataset_schema.js');
require('../src/js/app/reliability_dashboard_data.js');
require('../src/js/modules/itsm/mb_presence.js');
require('../src/js/kpi/source_facts.js');
for(const p of ['common','failures','equipment','labor','sla','classification','prb','ktg','index'])
  require('../src/js/kpi/preparation/'+p+'.js');
require('../src/js/kpi/calculator/common.js');
require('../src/js/kpi/calculator/definitions.js');
for(const p of ['vbr','ktg','sla','classification_quality','classification_quality_cgps','labor','problem_management'])
  require('../src/js/kpi/calculator/'+p+'/calculate.js');
require('../src/js/kpi/calculator/index.js');
require('../src/js/kpi/catalog/contracts.js');
require('../src/js/kpi/catalog/index.js');
require('../src/js/kpi/passport_math.js');
require('../src/js/kpi/passport_view.js');
const registry=globalThis.ReclassifierFieldRegistry;
const catalog=globalThis.ReclassifierKpiCatalog;
const passport=globalThis.ReclassifierKpiPassportView;
assert.equal(registry.get('itsm_data','completedAt').sourceLabel,'Дата выполнения обращения');
const vbr=passport.renderContent('vbr');
for(const term of ['Как рассчитывается показатель','Последовательность расчёта',
 'Дата выполнения обращения','Дата закрытия','Drivers',
 'Техническая документация','шт','ИсклВБР-Спутник',
 'id="kpi-passport-method"','id="kpi-passport-filters"','id="kpi-passport-steps"'])
  assert(vbr.includes(term),'VBR missing '+term);
const sla=passport.renderContent('sla');
assert(sla.includes('Дата закрытия'));
assert(sla.includes('Просрочен по разрешению'));
const mb=passport.renderContent('total_labor');
for(const term of ['Фактическая дата','Фактические трудозатраты',
 'Итоговый тип задачи','Устойчивый ключ задачи','Производное поле МБ'])
  assert(mb.includes(term),'MB missing '+term);
const prb=passport.renderContent('problem_coverage_relative');
assert(prb.includes('Связан ли с ИТ-проблемой?'));
assert(prb.includes('Заявка'));
for(const entry of catalog.list()){
 const html=passport.renderContent(entry.id);
 if(entry.calculation){
  assert(html.includes('id="kpi-passport-method"'),entry.id);
  assert(html.includes('Показать колонки'),entry.id);
  assert(html.includes('Машинная запись и версия формулы'),entry.id);
 }else{
  assert(html.includes('id="kpi-passport-method"'),entry.id);
  assert(html.includes('Расчёт ещё не реализован'),entry.id);
 }
}
console.log('Step 3: real source headings, 18 KPI narratives, disclosures and placeholders OK');
