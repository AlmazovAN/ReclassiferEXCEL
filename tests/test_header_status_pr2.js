const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const read = path => fs.readFileSync(path, 'utf8');
const core = read('src/js/app/core.js');
const begin = core.indexOf('  const headerKpiState =');
const end = core.indexOf('  function setHeader(eyebrow, title, description)', begin);
assert(begin > 0 && end > begin, 'global header status has its own narrow helpers');
const markup = read('src/ui/index.html');
for (const id of ['globalKpiIndicator','globalKpiText','globalDatabaseIndicator',
                  'globalDatabaseFile','globalDatabaseSave']) {
  assert(markup.includes('id="' + id + '"'), 'missing header DOM id ' + id);
}
assert(markup.indexOf('id="globalKpiIndicator"') < markup.indexOf('class="pill header-version"'));
assert(markup.indexOf('class="pill header-version"') < markup.indexOf('id="globalDatabaseIndicator"'));

let currentInfo = null;
const nodes = {};
function node(id) { return nodes[id] ||= {textContent:'',className:'',title:''}; }
const context = vm.createContext({
  document: { getElementById: node },
  window: {},
  databaseCurrentInfo: () => currentInfo,
  databaseWorkspaceState: { busy: false, fileConnection: null, lastError: null, saveProgress: null },
});
vm.runInContext(core.slice(begin,end), context);
const ui = context.ReclassifierHeaderIndicators;
assert(ui && typeof ui.refresh === 'function');

ui.refresh();
assert.equal(node('globalDatabaseFile').textContent, 'SQLite не подключена');
assert.equal(node('globalDatabaseSave').textContent, 'Данные HTML');
assert.equal(node('globalKpiText').textContent, 'KPI не рассчитаны');

currentInfo = {valid:true,fileName:'field&mine.db',dirty:false,databaseUuid:'uuid-1',
  storage:{diskCurrent:false}};
context.databaseWorkspaceState.fileConnection={databaseUuid:'uuid-1'};
ui.refreshDatabase();
assert.equal(node('globalDatabaseFile').textContent, 'field&mine.db',
  'untrusted file name goes via textContent');
assert.equal(node('globalDatabaseSave').textContent,'Нет новых изменений',
  'newly opened file is not misrepresented as verified write');
assert(!node('globalDatabaseIndicator').className.includes('is-saved'));

currentInfo.dirty=true;
ui.refreshDatabase();
assert.equal(node('globalDatabaseSave').textContent,'Есть несохранённые изменения');
assert(node('globalDatabaseIndicator').className.includes('is-pending'));

context.databaseWorkspaceState.fileConnection={databaseUuid:'different-db'};
ui.refreshDatabase();
assert.equal(node('globalDatabaseSave').textContent,'Требуется скачать БД',
  'file picked without matching write handle cannot be synchronized');

context.databaseWorkspaceState.fileConnection={databaseUuid:'uuid-1'};
currentInfo.dirty=false;
currentInfo.storage.diskCurrent=true;
ui.refreshDatabase();
assert.equal(node('globalDatabaseSave').textContent,'Все изменения сохранены');
assert(node('globalDatabaseIndicator').className.includes('is-saved'));

context.databaseWorkspaceState.saveProgress={phase:'writing'};
context.databaseWorkspaceState.busy=true;
ui.refreshDatabase();
assert.equal(node('globalDatabaseSave').textContent,'Синхронизация с файлом…',
  'save progress must suppress misleading saved badge');
assert(!node('globalDatabaseIndicator').className.includes('is-saved'));
context.databaseWorkspaceState.saveProgress=null;
context.databaseWorkspaceState.busy=false;

currentInfo.dirty=true;
currentInfo.valid=false;
ui.refreshDatabase();
assert.equal(node('globalDatabaseSave').textContent,'Ошибка базы данных');
currentInfo=null;
context.databaseWorkspaceState.fileConnection=null;
context.databaseWorkspaceState.lastError='bad database';
ui.refreshDatabase();
assert.equal(node('globalDatabaseSave').textContent,'Ошибка подключения БД');

ui.setKpi('calculating',45);
assert.equal(node('globalKpiText').textContent,'Расчёт KPI · 45%…');
ui.invalidateKpi();
assert.equal(node('globalKpiText').textContent,'Расчёт KPI · 45%…',
  'initial cache invalidation must not hide current Worker progress');
ui.setKpi('ready');
assert.equal(node('globalKpiText').textContent,'KPI актуальны');
ui.invalidateKpi();
assert.equal(node('globalKpiText').textContent,'Требуется пересчёт KPI');
ui.setKpi('calculating',140);
assert.equal(node('globalKpiText').textContent,'Расчёт KPI · 100%…');
ui.setKpi('error');
assert.equal(node('globalKpiText').textContent,'Ошибка расчёта KPI');

const databaseUi = read('src/js/app/database_ui.js');
assert(databaseUi.includes('<h2>База данных</h2>'));
assert(databaseUi.includes('Синхронизировать подключённую БД'));
assert(!databaseUi.includes('Порядок работы: откройте SQLite'));
assert(databaseUi.indexOf('database-state-panel') <
       databaseUi.indexOf('Дополнительные действия и проверка целостности'));
assert(databaseUi.indexOf('database-state-panel') <
       databaseUi.indexOf('Автосохранение и восстановление после сбоя'));
assert(databaseUi.indexOf('database-state-panel') <
       databaseUi.indexOf('Создать новую БД из стартовых данных HTML'));
for (const id of ['saveConnectedDatabaseButton','openDatabaseButton','exportDatabaseButton',
  'checkDatabaseButton','databaseAutoSaveToggle','databaseCreateRecovery',
  'databaseRestoreRecovery','createDatabaseButton']) {
  assert.equal(databaseUi.split('id="' + id + '"').length - 1, 1,
    'preserve a single active action for ' + id);
}
console.log('PASS PR2: global status semantics, compact header and SQLite page layout');
