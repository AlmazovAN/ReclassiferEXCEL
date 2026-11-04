'use strict';
// PR4 OOM regression: committed intake cleanup and safe manual SQLite Runtime sync.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const integrationUi = fs.readFileSync('src/js/app/database_integration_ui.js','utf8');
const intakeUi = fs.readFileSync('src/js/app/database_intake_ui.js','utf8');
const stateSource = fs.readFileSync('src/js/app/database_ui_state.js','utf8');
const routeUi = fs.readFileSync('src/js/app/database_ui.js','utf8');
const snapshot = fs.readFileSync('src/js/app/html_snapshot.js','utf8');

const releaseStart = intakeUi.indexOf('  function databaseReleaseCommittedQueueItems(items) {');
const releaseEnd = intakeUi.indexOf('  function databaseRemoveIntakeItem(', releaseStart);
assert(releaseStart >= 0 && releaseEnd > releaseStart,
  'Missing committed queue release function');
const releaseSource = intakeUi.slice(releaseStart,releaseEnd);

function createRelease(state) {
  return new Function('databaseWorkspaceState', releaseSource +
    '\nreturn databaseReleaseCommittedQueueItems;')(state);
}

// Files are released and successfully committed items disappear from the
// active intake queue. Unconfirmed candidates never disappear.
const committed = {
  name:'MB-2026.xlsx',integrationStatus:'committed',
  file:{size:26_934_184},inspectedFile:{name:'MB-2026.xlsx'},
  pendingPlan:{records:Array(5).fill({})},
  integrationResult:{rowsAfter:72_283}
};
const next = {
  name:'MB-2025.xlsx',integrationStatus:'prepared',
  file:{size:22_589_517},pendingPlan:{records:[{id:1}]}
};
const state = {intake:[committed,next]};
const release=createRelease(state);
assert.equal(release([committed]),1);
assert.deepEqual(state.intake,[next]);
assert.equal('file' in committed,false);
assert.equal('inspectedFile' in committed,false);
assert.equal('pendingPlan' in committed,false);
assert.deepEqual(next.pendingPlan.records,[{id:1}]);

// A DB COMMIT can succeed while the subsequent Runtime synchronization fails.
// Keep the lightweight status/warning visible; still release raw Excel.
const warning = {
  name:'MB-warning.xlsx',integrationStatus:'committed',
  file:{},inspectedFile:{},
  synchronizationError:'Runtime unavailable'
};
state.intake=[warning,next];
assert.equal(release([warning]),0);
assert.equal(state.intake[0],warning);
assert.equal('file' in warning,false);
assert.equal('inspectedFile' in warning,false);
assert.match(warning.synchronizationError,/Runtime unavailable/);

// A failed/noncommitted or cancelled import is not cleared.
const error = {integrationStatus:'error',file:{size:1},pendingPlan:{}};
state.intake=[error,next];
assert.equal(release([error,next]),0);
assert.equal(state.intake[0],error);
assert.equal(error.file.size,1);

// Both normal and atomic Equipment COMMIT paths must invoke cleanup only
// inside their successful-commit branch, followed by queue re-preparation.
assert.match(integrationUi,
  /if \(committed\) \{\s*const released = databaseReleaseCommittedQueueItems\(entries\.map\(entry => entry\.item\)\)/);
assert.match(integrationUi,
  /if \(item\.integrationStatus === 'committed'\) \{\s*const released = databaseReleaseCommittedQueueItems\(\[item\]\)/);
assert.match(integrationUi,/databaseReprepareQueueCandidates\('post-commit'\)/);
assert.match(integrationUi,/databaseReprepareQueueCandidates\('post-equipment-batch'\)/);

// The visible button performs only cache invalidation + registry checks;
// it must never reconstruct a full SQLite -> HTML mirror.
const buttonStart=routeUi.indexOf("document.getElementById('syncSqliteHtmlButton')?.addEventListener");
const buttonEnd=routeUi.indexOf("document.getElementById('downloadUpdatedHtmlButton')?.addEventListener",buttonStart);
assert(buttonStart>=0 && buttonEnd>buttonStart,'Missing manual Runtime refresh handler');
const manual=routeUi.slice(buttonStart,buttonEnd);
assert.match(manual,/databaseSynchronizeWorkspace\('manual',\s*\{/);
assert.match(manual,/refreshDerived:false/);
assert(!manual.includes('synchronizeSqliteToHtml('),
  'Heavy SQLite -> HTML mirror must not run in normal Runtime refresh');
assert(!manual.includes('buildDatasetPack('),'Button must not serialize all Dataset');
assert.match(routeUi,/Обновить Runtime из SQLite/);
assert.match(routeUi,/Сохранить HTML с данными/);
assert.match(stateSource,/options\.refreshDerived !== false/);
assert.match(stateSource,/runtime\?\.invalidate\?\.\(/);

// Exercise the actual manual barrier with a lightweight fake SQLite
// registry. A manual refresh must NOT rebuild derived datasets or read
// complete source records, even if those handlers exist.
// Guard the function contract, not its indentation: TEST_18 reformats the
// Workspace state to satisfy the existing 30k-character architecture limit.
const syncStart=stateSource.search(/^[ \t]*function databaseSynchronizeWorkspace\(reason = /m);
const syncTail=syncStart>=0?stateSource.slice(syncStart):'';
const syncEndOffset=syncTail.search(/^[ \t]*function databaseSynchronizationText\(\)/m);
const syncEnd=syncEndOffset>=0?syncStart+syncEndOffset:-1;
assert(syncStart>=0 && syncEnd>syncStart,'Missing Workspace sync function');
const syncFunction=stateSource.slice(syncStart,syncEnd);
let invalidated=0;
const workspace={
  intake:[],
  health:null,
  lastError:null,
  synchronization:{status:'idle'}
};
const runtime={
  invalidate() { invalidated++; },
  refreshDerived() { throw new Error('Eager derived materialization forbidden'); }
};
const stateModel={
  snapshot() {
    return {
      database:{databaseUuid:'db-test'},
      datasets:[{id:'mobile_brigade_data',
        active:{sqliteDb:true,activeRuntime:true,runtimeSource:'sqlite'}}]
    };
  }
};
const makeSync=new Function('workspace','runtime','stateModel',
  'const databaseWorkspaceState=workspace;'+
  'const globalThis={ReclassifierRuntimeDataRepository:runtime,'+
  'ReclassifierDatasetDbStateModel:stateModel};'+
  'const databaseCurrentInfo=()=>({databaseUuid:"db-test"});'+
  'const databaseRunHealthCheck=()=>({ok:true});'+
  'const state={route:"home"};'+
  'const renderDatabaseWorkspace=()=>{};'+
  'const log=()=>{};'+syncFunction+'\nreturn databaseSynchronizeWorkspace;');
const synchronize=makeSync(workspace,runtime,stateModel);
const refreshed=synchronize('manual',{checkHealth:true,render:false,refreshDerived:false});
assert.equal(refreshed.ok,true,'Manual Runtime refresh should succeed');
assert.equal(invalidated,1,'Manual refresh should invalidate stale cache references');
assert.equal(workspace.synchronization.status,'ready');
assert.equal(workspace.synchronization.sqliteDatasets,1);
assert.equal(workspace.synchronization.runtimeDatasets,1);

// Explicit standalone HTML snapshot/export is preserved.
assert.match(snapshot,/async function synchronizeSqliteToHtml\(\)/);
assert.match(snapshot,/async function downloadUpdatedHtml\(\)/);
assert.match(snapshot,/const pack = await buildDatasetPack\(\)/);
assert.match(routeUi,/downloadUpdatedHtmlButton/);

console.log('Post-COMMIT memory cleanup and lightweight SQLite Runtime refresh: OK');
