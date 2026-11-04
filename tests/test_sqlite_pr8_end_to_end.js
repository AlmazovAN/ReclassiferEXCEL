// PR-8: multi-session end-to-end acceptance with actual bundled CORE SQLite WASM.
// File System Access and IndexedDB are deterministic local doubles. No corporate
// exports, network access, filesystem writes or privileged browser permissions.
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const version = process.env.RECLASSIFIER_VERSION ||
  fs.readFileSync(path.join(root, 'VERSION'), 'utf8').trim();
const html = fs.readFileSync(path.join(root, 'dist',
  'Reclassifier_v' + version + '_CORE.html'), 'utf8');
const vendor = html.match(/<script id="sqliteVendorSource">([\s\S]*?)<\/script>/);
const wasm = html.match(/"sqliteWasmBase64": "([A-Za-z0-9+/=]+)"/);
assert(vendor && wasm, 'Published CORE must embed SQLite WASM');
vm.runInThisContext(vendor[1], {filename: 'sqlite-vendor.js'});
for (const name of ['src/js/app/dataset_catalog.js', 'src/js/app/database_contract.js']) {
  vm.runInThisContext(fs.readFileSync(path.join(root, name), 'utf8'), {filename:name});
}
new Function('assets','build','log',
  fs.readFileSync(path.join(root, 'src/js/app/database_core.js'), 'utf8')
)({sqliteWasmBase64:wasm[1]}, {version,sqliteVersion:'3.53.4'}, ()=>{});
const db = globalThis.ReclassifierDatabaseRepository;
const DATASET = 'mobile_brigade_data';
const STATE = {schemaVersion:'1.4.0'};
const records = (start, count, hours = 1) =>
  Array.from({length:count}, (_,i)=>{
    const number = start + i;
    return {
      recordKey:'mine|task-' + String(number).padStart(5, '0'),
      request:'INC-' + String(number).padStart(6, '0'),
      factDate:'2026-10-15', laborHours:hours,
      notes:'SYNTHETIC_ACCEPTANCE_' + String(number).padStart(8,'0')
    };
  });

function fileHandle(name, initial) {
  let contents = Uint8Array.from(initial);
  let modifiedAt = 1700000000000;
  let conflict = false;
  let failAtChunk = false;
  let writeOpen = false;
  let writes = 0;
  let readChunks = 0;
  const handle = {
    name,
    get disk() { return Uint8Array.from(contents); },
    get modifiedAt() { return modifiedAt; },
    get writes() { return writes; },
    get readChunks() { return readChunks; },
    externallyTouch() { modifiedAt += 1000; conflict = true; },
    failNextWrite() { failAtChunk = true; },
    async getFile() {
      const blob = new Blob([contents]);
      Object.defineProperty(blob, 'name', {value:name});
      Object.defineProperty(blob, 'lastModified', {value:modifiedAt});
      return {
        name, size:blob.size, lastModified:modifiedAt,
        slice(start,end) { readChunks++; return blob.slice(start,end); }
      };
    },
    async createWritable({mode}) {
      assert.equal(mode,'exclusive');
      assert.equal(writeOpen,false);
      writeOpen = true;
      const parts = [];
      return {
        async write(part) {
          assert.throws(()=>db.getDatabaseInfo(),
            e=>e.code==='RECLASSIFIER_DATABASE_BUSY');
          if (failAtChunk) {
            failAtChunk = false;
            throw Error('SYNTHETIC_WRITE_ERROR');
          }
          assert(part.length <= 4*1024*1024);
          parts.push(Uint8Array.from(part));
          writes++;
        },
        async close() {
          const length = parts.reduce((n,v)=>n+v.length,0);
          const next = new Uint8Array(length);
          let index = 0;
          for (const part of parts) { next.set(part,index); index += part.length; }
          contents = next;
          modifiedAt += 2000;
          writeOpen = false;
          conflict = false;
        },
        async abort() { writeOpen = false; }
      };
    }
  };
  return handle;
}

// In-memory IndexedDB transaction double (actual recovery-store code executes).
function recoveryStore() {
  const records = new Map();
  let quota = 40*1024*1024;
  let closed = 0, opened = 0;
  function request(operation, transaction) {
    const result = {result:undefined,error:null};
    setImmediate(()=>{
      try {
        result.result = operation();
        result.onsuccess?.();
        setImmediate(()=>transaction?.oncomplete?.());
      } catch(error) {
        result.error = error;
        result.onerror?.();
        setImmediate(()=>transaction?.onabort?.());
      }
    });
    return result;
  }
  const indexedDB = {
    open() {
      const value = {result:null};
      value.result = {
        objectStoreNames:{contains:()=>false},
        createObjectStore:()=>{},
        close() {closed++;},
        transaction(name,mode) {
          assert.equal(name,'checkpoints');
          const tx = {
            objectStore() {
              return {
                get:key=>request(()=>records.get(key),tx),
                put:row=>{
                  assert.equal(mode,'readwrite');
                  return request(()=>{records.set(row.key,row);return row.key;},tx);
                },
                delete:key=>{
                  assert.equal(mode,'readwrite');
                  return request(()=>records.delete(key),tx);
                }
              };
            }
          };
          return tx;
        }
      };
      opened++;
      setImmediate(()=>{value.onupgradeneeded?.();value.onsuccess?.();});
      return value;
    }
  };
  const context = vm.createContext({
    Blob, Uint8Array, Number, String, Date, Promise, indexedDB,
    navigator:{storage:{estimate:async()=>({usage:0,quota})}}
  });
  context.globalThis = context;
  vm.runInContext(fs.readFileSync(path.join(root,
    'src/js/app/database_recovery_store.js'),'utf8'),context);
  return {
    store:context.ReclassifierSqliteRecoveryStore,
    setQuota:n=>{quota=n;},
    get handlesClosed() {return closed===opened;},
    get slots() {return records.size;}
  };
}
function snapshot() {
  const dataset = db.getDataset(DATASET);
  return dataset.records.slice().sort((a,b)=>a.recordKey.localeCompare(b.recordKey));
}
function checkHealth(stage,expectedCount) {
  const records = snapshot();
  assert.equal(records.length,expectedCount,stage+': accumulated records');
  assert.equal(Number(db.getDatasetRegistry(DATASET).record_count),
    expectedCount,stage+': registry and records consistent');
  const health = db.runHealthCheck();
  assert.equal(health.ok,true,stage+': '+health.errors.join('; '));
}
function statusText(info,linked) {
  const src = fs.readFileSync(path.join(root,
    'src/js/app/database_ui_state.js'),'utf8');
  const begin=src.indexOf('function databaseStorageGuidance(');
  const end=src.indexOf('function databaseWorkingStorageText(',begin);
  assert(begin>=0 && end>begin);
  const context=vm.createContext({});
  vm.runInContext(src.slice(begin,end)+'\nthis.guidance=databaseStorageGuidance;',context);
  return context.guidance(info,linked);
}
(async()=>{
  const recovery = recoveryStore();
  await db.createDatabase({fileName:'accept.db',appVersion:version});
  const uuid=db.getDatabaseInfo().databaseUuid;
  const first = records(1,550,2);
  const firstCommit=db.upsertDataset(DATASET,first,{state:STATE});
  assert.equal(firstCommit.rowsInserted,550);
  checkHealth('first import',550);
  const handle=fileHandle('accept.db',db.exportDatabase());
  let fileMetadata={size:handle.disk.length,lastModified:handle.modifiedAt};
  const originalDisk=handle.disk;

  const second=[
    ...records(500,51,4), // 51 updates
    ...records(551,480,3) // 480 new tasks
  ];
  const preview=db.previewDatasetChange(DATASET,second,{state:STATE});
  assert.equal(preview.rowsBefore,550);
  assert.equal(preview.rowsInserted,480);
  assert.equal(preview.rowsUpdated,51);
  const secondCommit=db.upsertDataset(DATASET,second,{state:STATE});
  for (const name of ['rowsBefore','rowsInserted','rowsUpdated','rowsAfter']) {
    assert.equal(secondCommit[name],preview[name],name+': preview/COMMIT parity');
  }
  checkHealth('second accumulated import',1030);
  const unsaved=db.getDatabaseInfo();
  assert.equal(unsaved.dirty,true);
  assert.equal(statusText(unsaved,{databaseUuid:uuid}).action,'save');
  assert.equal(statusText(unsaved,null).action,'download');

  const phases=[];
  const saved=await db.saveDatabaseToFile(handle,fileMetadata,{
    onProgress:progress=>phases.push(progress.phase)
  });
  assert.deepEqual(phases.filter((p,i)=>i===0||p!==phases[i-1]),
    ['exporting','writing','verifying','complete']);
  assert(saved.verifiedBytes>=originalDisk.length);
  assert(handle.readChunks>0);
  assert.equal(db.getDatabaseInfo().dirty,false);
  assert.equal(db.getDatabaseInfo().storage.diskCurrent,true);
  assert.equal(statusText(db.getDatabaseInfo(),{databaseUuid:uuid}).action,'none');
  fileMetadata={size:saved.size,lastModified:saved.lastModified};
  const savedDisk=handle.disk;
  assert.equal(db.getImportHistory(DATASET,100).filter(x=>x.status==='COMMITTED').length,2);

  const checkpointSource=db.exportDatabase();
  const checkpoint=await recovery.store.save(checkpointSource,{
    fileName:'accept.db', databaseUuid:uuid,
    workingRevision:db.getDatabaseInfo().storage.workingRevision
  });
  assert.equal(checkpoint.size,checkpointSource.length);
  assert.equal(recovery.slots,1);
  const loaded=await recovery.store.latest();
  assert.equal(loaded.databaseUuid,uuid);
  assert.deepEqual(
    new Uint8Array(await loaded.bytes.arrayBuffer()),checkpointSource
  );
  recovery.setQuota(100);
  await assert.rejects(()=>recovery.store.save(checkpointSource,{
    fileName:'accept.db',databaseUuid:uuid,workingRevision:99
  }),/недостаточно свободной квоты/);
  assert.equal((await recovery.store.latest()).revision,checkpoint.revision);
  recovery.setQuota(40*1024*1024);

  // A third COMMIT only changes WASM. Simulate a tab crash: it must not
  // change either the verified OS file or the earlier browser checkpoint.
  const third=records(1031,300,6);
  db.upsertDataset(DATASET,third,{state:STATE});
  checkHealth('unsaved third import',1330);
  assert.equal(db.getDatabaseInfo().dirty,true);
  assert.deepEqual(handle.disk,savedDisk,
    'in-browser COMMIT cannot silently update attached disk file');
  assert.equal(db.getDatabaseInfo().storage.diskCurrent,false);

  // Metadata conflict blocks a dangerous OS overwrite; RAM stays dirty.
  handle.externallyTouch();
  await assert.rejects(()=>db.saveDatabaseToFile(handle,fileMetadata),
    /изменился после подключения/);
  assert.deepEqual(handle.disk,savedDisk);
  assert.equal(db.getDatabaseInfo().dirty,true);
  db.closeDatabase(); // lost uncheckpointed changes in simulated crash

  const stored=await recovery.store.latest();
  const reopened=await db.openDatabase(stored.bytes,{
    fileName:'accept.db',recovered:true
  });
  assert.equal(reopened.databaseUuid,uuid);
  assert.equal(reopened.dirty,true,
    'recovered checkpoint must never claim a verified disk write');
  assert.equal(reopened.storage.confirmedFileRevision,null);
  assert.equal(statusText(reopened,null).action,'download');
  checkHealth('recovered checkpoint',1030);
  assert.deepEqual(handle.disk,savedDisk,
    'recovery must never modify the original OS .db');

  // A bad candidate must not replace the already-open recovered working DB.
  const corrupt=Uint8Array.from(checkpointSource);
  corrupt[0]=0;
  await assert.rejects(()=>db.openDatabase(corrupt,{fileName:'broken.db'}));
  assert.equal(db.getDatabaseInfo().databaseUuid,uuid);
  checkHealth('after rejected corrupt candidate',1030);

  const restoredFirst=await db.saveDatabaseToFile(handle,{
    size:handle.disk.length,lastModified:handle.modifiedAt
  });
  assert.equal(db.getDatabaseInfo().storage.diskCurrent,true);
  assert.equal(db.getDatabaseInfo().dirty,false);
  assert.equal(restoredFirst.verifiedBytes,handle.disk.length,
    'recovered checkpoint is verified only after an explicit disk write');

  db.upsertDataset(DATASET,third,{state:STATE});
  const beforeBadWrite=handle.disk;
  handle.failNextWrite();
  await assert.rejects(()=>db.saveDatabaseToFile(handle,{
    size:restoredFirst.size,lastModified:restoredFirst.lastModified
  }),/SYNTHETIC_WRITE_ERROR/);
  assert.deepEqual(handle.disk,beforeBadWrite,'failed write must preserve OS bytes');
  assert.equal(db.getDatabaseInfo().dirty,true);
  assert.equal(db.getDatabaseInfo().storage.diskCurrent,false);

  const finalSaved=await db.saveDatabaseToFile(handle,{
    size:restoredFirst.size,lastModified:restoredFirst.lastModified
  });
  assert.equal(db.getDatabaseInfo().storage.diskCurrent,true);
  const reopenedBytes=handle.disk;
  db.closeDatabase();
  await db.openDatabase(reopenedBytes,{fileName:'accept.db'});
  checkHealth('verified final disk reopened',1330);
  const changed=snapshot().find(x=>x.recordKey==='mine|task-00500');
  assert.equal(changed.laborHours,4,'updated historical row survives recovery and save');
  const noDuplicate=db.upsertDataset(DATASET,third,{state:STATE});
  assert.equal(noDuplicate.rowsInserted,0);
  assert.equal(noDuplicate.rowsUpdated,0);
  checkHealth('idempotent repeated third import',1330);
  assert.equal(db.getImportHistory(DATASET,100).filter(x=>x.status==='COMMITTED').length,4);
  assert.equal(finalSaved.verifiedBytes,reopenedBytes.length);
  assert.equal(recovery.handlesClosed,true);
  await recovery.store.remove();
  assert.equal(await recovery.store.latest(),null);
  db.closeDatabase();

  console.log('PASS PR8 CORE end-to-end: 3 accumulated imports, UPSERT preview/COMMIT, verified save, browser recovery, crash loss boundary, corrupt-open isolation, stale-file conflict, failed write, final reopen, audit history and no duplicates; final rows=1330, bytes='+reopenedBytes.length);
})().catch(error=>{console.error(error);process.exitCode=1;});
