// Application-level facade for TEMP SQLite staging of Mobile Brigade output.
// Subject module UI never accesses the low-level DatabaseRepository directly.
(() => {
  'use strict';
  function repository() {
    const db = globalThis.ReclassifierDatabaseRepository;
    if (!db) throw new Error('SQLite Repository недоступен.');
    return db;
  }
  function sqliteReady() {
    return globalThis.ReclassifierRuntimeDataRepository?.mode?.() === 'sqlite' &&
      repository().hasOpenDatabase();
  }
  const api = Object.freeze({
    sqliteReady,
    begin: (batchSize = 5000) => repository().beginMobileBrigadeStage(batchSize),
    append: (id, sequence, rows) => repository().appendMobileBrigadeStage(id, sequence, rows),
    finalize: (id, summary) => repository().finalizeMobileBrigadeStage(id, summary),
    preview: id => repository().previewMobileBrigadeStage(id),
    commit: (id, progress) => repository().commitMobileBrigadeStage(id, progress),
    discard: id => repository().discardMobileBrigadeStage(id),
    exportRows: id => repository().getMobileBrigadeStageRows(id),
    itsmLinks: () => repository().getMobileBrigadeItsmLinks(),
    // Read only the ITSM registry count; never materialize its Dataset.
    itsmRowCount: () => sqliteReady()
      ? Number(repository().getDatasetRegistry('itsm_data')?.record_count || 0)
      : 0
  });
  globalThis.ReclassifierMobileBrigadeStaging = api;
})();
