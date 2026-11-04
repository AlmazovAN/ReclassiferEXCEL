'use strict';
// User-facing algorithm text keeps rules versions and processing locality,
// without exposing source paths or internal function names.
const fs = require('node:fs');
const assert = require('node:assert/strict');
const read = path => fs.readFileSync(path, 'utf8');
const itsm = read('src/js/modules/itsm/ui.js');
const mobile = read('src/js/modules/mobile_brigade/ui.js');
const workspace = read('src/js/app/module_workspace.js');
const itsmWorker = read('src/js/workers/itsm_processor.js');
const mobileWorker = read('src/js/workers/mobile_brigade_processor.js');
for (const [label, source, version] of [
  ['ITSM', itsm, 'ITSM_RULES_VERSION'],
  ['MB', mobile, 'MOBILE_BRIGADE_RULES_VERSION']
]) {
  assert.ok(source.includes('<summary>Описание алгоритма обработки</summary>'), label);
  assert.ok(source.includes('Как это работает'), label);
  assert.ok(source.includes('Версия правил:'), label);
  assert.ok(source.includes(version), label);
  assert.ok(source.includes('Обработка выполняется локально в фоновом потоке браузера.'), label);
  assert.ok(!source.includes('src/js/workers/'), label);
  assert.ok(!source.includes('Функция в коде:'), label);
  assert.ok(!source.includes('Версия обработчика'), label);
  assert.ok(!source.includes('compactCard("Версия"'), label);
  assert.ok(!source.includes("compactCard('Версия'"), label);
}
assert.match(itsmWorker, /ReclassifierItsmWorkerProcessor\s*=\s*Object\.freeze\(\{\s*process\s*,/);
assert.match(mobileWorker, /ReclassifierMobileBrigadeWorkerProcessor\s*=\s*Object\.freeze\(\{\s*process\s*,/);
assert.ok(workspace.includes('module-reference-date'));
assert.ok(workspace.includes('<strong class='));
console.log('PR10 module UI regression passed');
