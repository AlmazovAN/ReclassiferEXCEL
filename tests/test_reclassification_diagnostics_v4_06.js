'use strict';
const assert=require('node:assert/strict');
require('../src/js/modules/reclassification/facts_v4.js');
require('../src/js/modules/reclassification/event_v4.js');
require('../src/js/modules/reclassification/diagnostics_v4.js');
const event=globalThis.ReclassifierEventAssessmentV4;
const report=globalThis.ReclassifierTechnicalDiagnosticsV4;
const a=event.analyze({number:'RITM-1',description:'Нет изображения камеры',closureNote:'Обнаружен обрыв кабеля. Кабель заменён, связь восстановлена. Возможно перегрев. Дефект БП не подтверждён.'});
const cells=report.cells(a,{version:'3.3.0',decision:'Штатная ветка сохранена',included:false});
const get=label=>cells[report.columns.indexOf(label)];
assert.equal(new Set(report.columns).size,report.columns.length);
assert.equal(get('V4: аналитический тип'),'INC');
assert.match(get('Симптомы'),/сообщено.*Нет изображения/);
assert.match(get('Диагностика'),/Обнаружен обрыв/);
assert.match(get('Действия'),/Кабель заменён/);
assert.match(get('Результаты'),/связь восстановлена/);
assert.match(get('Предположения'),/Возможно перегрев/);
assert.match(get('Отрицания'),/не подтверждён/);
assert.match(get('Последовательность внутри полей'),/Порядок между разными полями не установлен/);
assert.equal(get('Включено в Reclassification'),'Нет','V4 gate must not create legacy application');
const long=event.analyze({description:'Нет изображения '+ 'камеры '.repeat(7000)});
assert(report.cells(long).every(cell=>cell==null||cell.length<=32767));
assert(report.cells(long).some(cell=>cell&&cell.includes('Сокращено до лимита Excel')));
assert.equal(report.columns.length,54);
assert.deepEqual(report.columns.slice(-20),[
  'V4: элемент по диагностике','V4: статус выбора элемента',
  'V4: основание выбора элемента','V4: ограничения выбора элемента',
  'V4: неисправность по диагностике','V4: статус выбора неисправности',
  'V4: основание выбора неисправности','V4: ограничения выбора неисправности',
  'V4: причина по диагностике','V4: статус выбора причины',
  'V4: основание выбора причины','V4: ограничения выбора причины',
  'V4: полный путь классификации','V4: статус проверки пути',
  'V4: след доказательств по пути','V4: ограничения проверки пути',
  'V4: статус инженерной проверки','V4: маршрут разбора',
  'V4: ограничения допуска','V4: действия инженера'
]);
console.log('V4-06 diagnostic projection: role columns, assertions, source spans, version separation, Excel limits PASS');
