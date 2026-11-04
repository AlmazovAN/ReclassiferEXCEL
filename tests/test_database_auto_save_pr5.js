// PR-5 user-controlled autosave: no timer write without consent or wrong handle.
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

let dirty = true;
let busy = false;
let saves = 0;
let succeed = true;
let granted = true;
let intervalCallback;
let timer = 0;
let permissionRequests = 0;
let closedTimers = 0;
const alerts = [];
const logs = [];
const linked = {
  databaseUuid: 'db-1',
  handle: {
    async requestPermission() { permissionRequests++; return granted ? 'granted' : 'denied'; },
    async queryPermission() { return granted ? 'granted' : 'denied'; }
  }
};
const workspace = { fileConnection: linked, busy: false, recoveryStatus: null };
const ctx = {
  console, setTimeout, clearTimeout, Promise, Date, Number,
  databaseWorkspaceState: workspace,
  state: { route: 'none' },
  alert: msg => alerts.push(msg),
  log: msg => logs.push(msg),
  renderDatabaseWorkspace: () => {},
  getDatabaseRepository() { return { getOperationState: () => ({ busy }) }; },
  databaseCurrentInfo() { return { databaseUuid: 'db-1', dirty }; },
  async databaseSaveConnected(automatic) {
    assert.equal(automatic, true, 'timer must select silent save path');
    saves++;
    if (succeed) dirty = false;
    return succeed;
  },
  setInterval(fn, ms) { assert.equal(ms, 12000); intervalCallback = fn; return ++timer; },
  clearInterval() { closedTimers++; },
  globalThis: null
};
ctx.globalThis = ctx;
vm.createContext(ctx);
const source = fs.readFileSync('src/js/app/database_recovery_ui.js', 'utf8');
vm.runInContext(source + '\nthis.api = { toggle: databaseToggleAutoSave, ' +
  'tick: databaseAutoSaveTick, stop: databaseAutoSaveStop, session: databaseAutoSaveSession };', ctx);
const api = ctx.api;

(async () => {
  assert.equal(api.session.enabled, false, 'default must be off');
  await api.tick();
  assert.equal(saves, 0, 'default must never write');
  granted = false;
  await api.toggle();
  assert.equal(api.session.enabled, false, 'permission failure must keep autosave off');
  assert.equal(saves, 0);
  granted = true;
  await api.toggle();
  assert.equal(permissionRequests, 2);
  assert.equal(api.session.enabled, true);
  assert.equal(saves, 1, 'existing unsaved changes saved after explicit opt-in');
  await api.tick();
  assert.equal(saves, 1, 'unchanged revision must not be saved again');
  dirty = true; busy = true;
  await api.tick();
  assert.equal(saves, 1, 'busy Repository must not be interrupted');
  busy = false; workspace.busy = true;
  await api.tick();
  assert.equal(saves, 1, 'busy workspace must defer autosave');
  workspace.busy = false;
  succeed = false;
  await api.tick();
  assert.equal(saves, 2);
  assert.equal(api.session.enabled, false, 'failed background save disables autosave');
  assert.equal(closedTimers, 1);
  assert.equal(dirty, true);
  assert.equal(typeof intervalCallback, 'function');

  succeed = true;
  await api.toggle();
  assert.equal(api.session.enabled, true);
  workspace.fileConnection = { ...linked, databaseUuid: 'other-db' };
  dirty = true;
  await api.tick();
  assert.equal(api.session.enabled, false, 'different handle must stop autosave');
  assert.equal(saves, 3, 'no write into unrelated handle');
  assert(alerts.some(x => x.includes('разрешения') || x.includes('разрешение')));
  assert(source.includes('databaseConfirmReplaceCurrent()'));
  const connection = fs.readFileSync('src/js/app/database_connection_ui.js', 'utf8');
  assert(connection.includes('if (!automatic && typeof linked.handle.requestPermission'),
    'timer saves must not open browser permission dialogs');
  assert(connection.includes('if (automatic && typeof linked.handle.queryPermission'),
    'timer save must honor revoked permissions');
  for (const required of ['databaseAutoSaveStop();', 'databaseWorkspaceState.fileConnection = null']) {
    assert(connection.includes(required), required);
  }
  const ui = fs.readFileSync('src/js/app/database_ui.js', 'utf8');
  for (const id of ['databaseAutoSaveToggle', 'databaseCreateRecovery',
    'databaseInspectRecovery', 'databaseRestoreRecovery', 'databaseDeleteRecovery']) {
    assert(ui.includes('id="' + id + '"'), 'missing recovery control: ' + id);
  }
  console.log('PASS PR5 opt-in auto-save, quiet failure, operation guard and session reset');
})().catch(e => { console.error(e); process.exitCode = 1; });
