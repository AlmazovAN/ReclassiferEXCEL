// Step 5: catalog-backed passport, source lineage, real Snapshot, placeholders and HTML escaping.
'use strict';
const assert = require('node:assert/strict');
require('../src/js/app/reliability_dashboard_data.js');
require('../src/js/modules/itsm/mb_presence.js');
require('../src/js/kpi/source_facts.js');
require('../src/js/kpi/preparation/common.js');
require('../src/js/kpi/preparation/failures.js');
require('../src/js/kpi/preparation/equipment.js');
require('../src/js/kpi/preparation/labor.js');
require('../src/js/kpi/preparation/sla.js');
require('../src/js/kpi/preparation/classification.js');
require('../src/js/kpi/preparation/prb.js');
require('../src/js/kpi/preparation/ktg.js');
require('../src/js/kpi/preparation/index.js');
require('../src/js/kpi/calculator/common.js');
require('../src/js/kpi/calculator/definitions.js');
require('../src/js/kpi/calculator/vbr/calculate.js');
require('../src/js/kpi/calculator/ktg/calculate.js');
require('../src/js/kpi/calculator/sla/calculate.js');
require('../src/js/kpi/calculator/classification_quality/calculate.js');
require('../src/js/kpi/calculator/classification_quality_cgps/calculate.js');
require('../src/js/kpi/calculator/labor/calculate.js');
require('../src/js/kpi/calculator/problem_management/calculate.js');
require('../src/js/kpi/calculator/index.js');
require('../src/js/kpi/catalog/contracts.js');
require('../src/js/kpi/catalog/index.js');
require('../src/js/kpi/passport_math.js');
require('../src/js/kpi/passport_view.js');

const passport=globalThis.ReclassifierKpiPassportView;
const catalog=globalThis.ReclassifierKpiCatalog;
assert.equal(typeof passport.renderContent,'function');
assert(Object.isFrozen(passport));

const snapshot={
  schemaVersion:'1.0.0',calculatedAt:'2026-10-08T12:08:00.000Z',
  query:{
    period:{month:'2026-10',label:'Окт 2026'},
    mine:{label:'Северный'},
    equipmentClass:{label:'Навесное'},
    calculator:{period:'2026-10-01',filters:{mine:'Северный',equipmentClass:'mounted'}}
  },
  results:{
    sla:{value:90,dataState:'available',formulaVersion:'1.0.0',components:{slaSuccessCount:9,slaTotalCount:10}},
    vbr:{value:95,dataState:'available',formulaVersion:'1.0.0',components:{failureCount:5,equipmentCount:100}}
  },
  sources:[
    {id:'itsm_data',available:true,activeRevision:12,contentHash:'h1',freshness:'2026-10-07'},
    {id:'drivers',available:true,activeRevision:13,contentHash:'h2',freshness:'2026-10-01'},
    {id:'mobile_brigade_data',available:true,activeRevision:14,contentHash:'h3',freshness:'2026-10-07'}
  ],
  kpiView:{cards:{
    sla:{current:{period:'2026-10',value:90,dataState:'available'}},
    vbr:{current:{period:'2026-10',value:95,dataState:'available'}}
  }}
};
const all=passport.renderContent('sla',{snapshot});
assert.match(all,/<h2 id="reliabilityKpiPassportTitle" tabindex="-1">/);
assert(all.includes('SLA — соблюдение соглашения об уровне сервиса'));
assert(all.includes('kpi-passport-overview-prose'));
assert(all.includes('<strong>Назначение:</strong>'));
assert(all.includes('xmlns="http://www.w3.org/1998/Math/MathML"'));
assert(all.includes('Машинная запись и версия формулы'));
assert(all.includes('class="kpi-passport-math-document"'));

assert.match(all,/SLA/);
for(const section of ['overview','formula','sources','joins','filters','steps','aggregation','periods','fact'])
  assert.match(all,new RegExp('id="kpi-passport-'+section+'"'));
for(const label of [
 'Описание и назначение','Источники и колонки','Семантическое поле','Просрочен по разрешению',
 'Поле','Расчётная цепочка','Агрегирование и арифметика','Связи данных',
 'Периоды и прогноз','Текущий результат и происхождение','90 %','9','10',
 'reclassifiedEquipment','closedAt','itsm_data','Подключён','h1','12',
 'Северный','2026-10-08T12:08:00.000Z','Показать расчёт'
]) assert(all.includes(label),'Missing SLA passport item '+label);
assert.match(all,/Построчные JOIN не заявлены/);
assert.match(all,/Методика: draft/);
assert.match(all,/id="kpi-passport-method"/);
assert.match(all,/Техническая документация:/);
assert.match(all,/Показать колонки и реквизиты источника/);
assert.match(all,/Фактическая трассировка недоступна для этого снимка/);

const vbr=passport.renderContent('vbr',{snapshot});
assert.match(vbr,/drivers/);
assert(vbr.includes('ВБР — вероятность безотказной работы'));
assert(vbr.includes('Пример расчёта'));
assert.match(vbr,/id="kpi-passport-sources"/);
assert.match(vbr,/Техническая документация/);
assert.match(vbr,/id="kpi-passport-source-itsm_data"/);
assert.match(vbr,/id="kpi-passport-source-drivers"/);
assert.match(vbr,/id="kpi-passport-operations"/);
assert.match(vbr,/id="kpi-passport-trace"/);
assert.match(vbr,/Версия формулы/);
assert.match(vbr,/Текущий результат и происхождение/);
assert.match(vbr,/id="kpi-passport-fact"/);
assert.equal((vbr.match(/kpi-passport-tech-item"/g)||[]).length,3);
const ktgRef=passport.renderContent('ktg',{snapshot});
for(const marker of ['Техническая документация','id="kpi-passport-source-itsm_data"',
 'id="kpi-passport-source-drivers"','id="kpi-passport-operations"','id="kpi-passport-trace"'])
 assert(ktgRef.includes(marker),'KTG missing '+marker);
assert.match(ktgRef,/Текущий результат и происхождение/);
const first=vbr.indexOf('id="kpi-passport-overview"'),formula=vbr.indexOf('id="kpi-passport-formula"'),
 method=vbr.indexOf('id="kpi-passport-method"'),technical=vbr.indexOf('id="kpi-passport-sources"'),
 forecast=vbr.indexOf('id="kpi-passport-forecast"');
assert(first<formula&&formula<method&&method<technical&&technical<forecast);
assert(vbr.includes('role="tablist"')&&vbr.includes('id="kpi-passport-panel-monitor"'));
assert(vbr.includes('Контроль методики'));
assert.equal((vbr.match(/class="kpi-passport-panel"/g)||[]).length,4);

assert.doesNotMatch(vbr,/Техническая надёжность · vbr/);
assert.doesNotMatch(vbr,/Символьная формула поясняет действующий Calculator/);
assert(vbr.includes('За три месяца зарегистрировано 10, 5 и 5 отказов. Численность оборудования по Drivers — 100 единиц.'));
assert(vbr.includes('<mfrac>'));
assert(vbr.includes('не строгая индивидуальная вероятность'));

assert.match(vbr,/Рудник/);
assert.match(vbr,/Не поддерживается/);
assert.match(vbr,/completedAt/);
assert.match(vbr,/closedAt/);
assert.match(vbr,/Резервная дата учёта отказа/);
assert.match(vbr,/Прич1/);
assert.match(vbr,/Exceptions/);
assert.match(vbr,/специальные правила/);
assert.match(vbr,/Резервный месяц отказа/);
assert.match(vbr,/оборудование-месяц/);
assert.match(vbr,/5/);
assert.match(vbr,/100/);
assert.match(vbr,/h2/);
assert(!vbr.includes('Просрочен по разрешению'),'SLA physical field must not leak into VBR passport.');

const prb=passport.renderContent('problem_coverage_relative',{snapshot});
assert.match(prb,/LOOKUP/);
assert.match(prb,/mobile_brigade_data\.request/);
assert.match(prb,/itsm_data\.number/);
assert.match(prb,/N:1/);
assert.match(prb,/Кардинальность/);
assert.match(prb,/ambiguous/);
assert.match(prb,/numerator/);

const absent=passport.renderContent('kog',{snapshot});
assert.match(absent,/Расчёт не подключён/);
assert.match(absent,/Расчёт ещё не реализован/);
assert.match(absent,/не утверждены и не подключены/);
assert.match(absent,/id="kpi-passport-sources"/);
assert.doesNotMatch(absent,/class="kpi-passport-formula"/);
assert.match(absent,/не рассчитывается|Не рассчитывается|Фактические компоненты отсутствуют/);
assert.match(passport.renderContent('ktg',{snapshot}),/КТГ/);
assert.match(passport.renderContent('ktg',{snapshot}),/Время предбэклога/);
assert.match(passport.renderContent('not-a-kpi',{snapshot}),/Паспорт KPI не найден/);

// No fabricated values / no actual trace: status does not become approved.
const missing=passport.renderContent('sla',{snapshot:{
 ...snapshot,results:{},kpiView:{cards:{}},sources:[]
}});
assert.match(missing,/Фактические компоненты отсутствуют/);
assert.match(missing,/Нет сведений в Snapshot/);
assert.match(missing,/—/);
assert.doesNotMatch(missing,/90 %/);

// Escaping all catalog/user-controlled labels, including key-value query and hashes.
const dangerous='<img src=x onerror="alert(1)">';
const malicious=passport.renderContent('sla',{snapshot:{
 ...snapshot,
 query:{
  ...snapshot.query,
  mine:{label:dangerous},
  calculator:{period:'2026-10-01',filters:{mine:dangerous}}
 },
 sources:[{id:'itsm_data',available:true,activeRevision:4,contentHash:dangerous}],
 results:{sla:{value:90,dataState:'available',components:{bad:5},formulaVersion:'1.0.0'}}
}});
assert(!malicious.includes(dangerous),'Raw HTML leaked into passport.');
assert(malicious.includes('&lt;img src=x onerror=&quot;alert(1)&quot;&gt;'));
assert(!/onerror="alert\(1\)"/.test(malicious));

// Renderer is pure: original Snapshot is unchanged and callable from future passports page.
const before=JSON.stringify(snapshot);
passport.renderContent('classification_quality',{snapshot});
assert.equal(JSON.stringify(snapshot),before);
assert.equal(catalog.get('sla').definition.id,'sla');
console.log('KPI Passport View Step 5: 18 identities, full source/operations, draft, placeholders and safe escaping OK');
