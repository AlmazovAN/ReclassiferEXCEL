// FILE CONTRACT: optional Report Snapshot persistence adapter.
// Read/write SQLite only through Database Repository, never KPI formulas.
// A missing/busy database disables persistence without changing calculation.
(() => {
  'use strict';
  function repository() {
    const db = globalThis.ReclassifierDatabaseRepository;
    const runtime = globalThis.ReclassifierRuntimeDataRepository;
    if (!db?.hasOpenDatabase?.() || !runtime?.isSqliteAuthoritative?.() ||
        db.getOperationState?.().busy) return null;
    return db;
  }
  function identity() {
    const db = repository();
    if (!db) return null;
    const info = db.getDatabaseInfo();
    return info?.valid && info.databaseUuid ? String(info.databaseUuid) : null;
  }
  function read(input) {
    const db = repository();
    return db?.getKpiSnapshot?.(input) || null;
  }
  function write(input,snapshot) {
    const db = repository();
    return db?.putKpiSnapshot?.(input,snapshot) ||
      Object.freeze({stored:false,reason:'not-connected'});
  }
  globalThis.ReclassifierKpiSnapshotStore = Object.freeze({
    version:'1.0.0',identity,read,write
  });
  if (typeof module !== 'undefined' && module.exports)
    module.exports=globalThis.ReclassifierKpiSnapshotStore;
})();
