// FILE CONTRACT: aggregated Dataset / DB state model for Database Workspace UI.
// Purpose: expose one read-only snapshot for Excel intake rows and active Dataset/reference rows.
// Owns: no persistent state; derives presentation-ready state from Catalog, Legacy HTML, SQLite and Runtime.
// Reads: ReclassifierDatasetCatalog, ReclassifierDatabaseRepository, ReclassifierRuntimeDataRepository.
// Writes: nothing.
// Public API: globalThis.ReclassifierDatasetDbStateModel.
// Must not: mutate SQLite, load Excel files, commit integration plans or render HTML.

(() => {
  'use strict';

  function catalog() {
    const value = globalThis.ReclassifierDatasetCatalog;
    if (!value?.list) throw new Error('Dataset Catalog недоступен.');
    return value;
  }

  function databaseRepository() {
    return globalThis.ReclassifierDatabaseRepository || null;
  }

  function runtimeRepository() {
    return globalThis.ReclassifierRuntimeDataRepository || null;
  }

  function safeNumber(value, fallback = 0) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  }

  function nullableNumber(value) {
    if (value === null || value === undefined || value === '') return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  function queueDatasetId(item) {
    const inspection = item?.inspection || {};
    if (inspection.datasetId) return inspection.datasetId;
    const classification = inspection.classification || item?.classification || {};
    const id = classification.id || null;
    if (!id) return null;
    if (id === 'itsm') return 'itsm_data';
    if (id === 'mobile_brigade') return 'mobile_brigade_data';
    if (id === 'failure_classifier') return 'failure_classifier';
    if (String(id).startsWith('equipment:')) return String(id).slice('equipment:'.length);
    return catalog().datasets?.[id] ? id : null;
  }

  function queueStatus(item) {
    if (item?.integrationStatus) return String(item.integrationStatus).toUpperCase();
    if (item?.inspection?.ready) return 'READY';
    if (item?.inspection) return 'INVALID';
    return 'PENDING';
  }

  function normalizeChange(preview) {
    if (!preview) return null;
    return Object.freeze({
      rowsBefore: nullableNumber(preview.rowsBefore),
      rowsIncoming: nullableNumber(preview.rowsIncoming),
      rowsInserted: safeNumber(preview.rowsInserted),
      rowsUpdated: safeNumber(preview.rowsUpdated),
      rowsUnchanged: safeNumber(preview.rowsUnchanged),
      rowsDeleted: safeNumber(preview.rowsDeleted),
      rowsAfter: nullableNumber(preview.rowsAfter),
      committedAt: preview.committedAt || null,
      revision: nullableNumber(preview.revision)
    });
  }

  function queueItem(item) {
    const inspection = item?.inspection || {};
    const datasetId = queueDatasetId(item);
    const definition = datasetId ? catalog().datasets?.[datasetId] || null : null;
    const freshness = inspection.freshness || {};
    const preview = item?.integrationResult || item?.integrationPreview || null;

    return Object.freeze({
      key: item?.key || null,
      fileName: item?.name || item?.file?.name || null,
      fileSize: safeNumber(item?.size ?? item?.file?.size),
      lastModified: nullableNumber(item?.lastModified ?? item?.file?.lastModified),
      datasetId,
      datasetTitle: inspection.datasetTitle || definition?.databaseTitle || null,
      mode: inspection.strategy || definition?.strategy || null,
      schemaApp: inspection.datasetSchemaVersion || definition?.schemaVersion || null,
      sourceRows: nullableNumber(inspection.sourceRows),
      normalizedRows: nullableNumber(inspection.normalizedRows),
      freshnessFrom: freshness.from || null,
      freshnessTo: freshness.to || null,
      freshnessSource: freshness.source || null,
      confidence: nullableNumber(inspection.confidence),
      ready: inspection.ready === true,
      validationStatus: inspection.validation?.status || null,
      status: queueStatus(item),
      databaseChange: normalizeChange(preview),
      error: item?.integrationError || null
    });
  }

  function embeddedMap() {
    const runtime = runtimeRepository();
    if (!runtime?.embeddedList) return new Map();
    try {
      return new Map(
        Array.from(runtime.embeddedList() || []).map(item => [item.id, item])
      );
    } catch (_) {
      return new Map();
    }
  }

  function databaseContext() {
    const repository = databaseRepository();
    if (!repository?.hasOpenDatabase?.()) {
      return {
        open: false,
        info: null,
        registry: new Map(),
        attempts: new Map()
      };
    }

    const info = repository.getDatabaseInfo();
    const registryRows = Array.from(repository.listDatasets?.() || []);
    const overview = repository.getImportOverview?.() || {};
    const attempts = new Map(
      Array.from(overview.latestAttemptByDataset || [])
        .map(row => [row.dataset_id, row])
    );

    return {
      open: true,
      info,
      registry: new Map(registryRows.map(row => [row.dataset_id, row])),
      attempts
    };
  }

  function runtimeState(id, dbOpen, legacyEntry) {
    const runtime = runtimeRepository();
    if (!runtime) {
      return Object.freeze({
        active: false,
        source: 'missing'
      });
    }

    let source = 'missing';
    try {
      source = runtime.source?.(id) || 'missing';
    } catch (_) {
      source = 'error';
    }

    const active = source === 'sqlite' ||
      (!dbOpen && source === 'legacy' && Boolean(legacyEntry?.active));

    return Object.freeze({ active, source });
  }

  function latestAttemptState(row) {
    if (!row) return null;
    return Object.freeze({
      status: row.status || null,
      startedAt: row.started_at || null,
      finishedAt: row.finished_at || null,
      timestamp: row.finished_at || row.started_at || null,
      sourceFileName: row.source_file_name || null,
      rowsBefore: nullableNumber(row.rows_before),
      rowsIncoming: nullableNumber(row.rows_incoming),
      rowsInserted: nullableNumber(row.rows_inserted),
      rowsUpdated: nullableNumber(row.rows_updated),
      rowsUnchanged: nullableNumber(row.rows_unchanged),
      rowsDeleted: nullableNumber(row.rows_deleted),
      rowsAfter: nullableNumber(row.rows_after),
      message: row.message || null
    });
  }

  function dependencyState(definition, sqliteDb, db, memo = new Map(), visiting = new Set()) {
    const dependencies = Array.from(definition?.dependencies || []);
    if (!dependencies.length || !sqliteDb) return null;

    const id = definition.id;
    if (memo.has(id)) return memo.get(id);
    if (visiting.has(id)) {
      return Object.freeze({
        status: 'stale',
        current: false,
        mismatches: Object.freeze([id])
      });
    }

    const repository = databaseRepository();
    const state = repository?.getDatasetState?.(id) || {};
    const captured = state?.dependencyRevisions;
    if (!captured || typeof captured !== 'object') {
      const result = Object.freeze({
        status: 'untracked',
        current: false,
        mismatches: Object.freeze(dependencies.slice())
      });
      memo.set(id, result);
      return result;
    }

    const nextVisiting = new Set(visiting);
    nextVisiting.add(id);
    const mismatches = [];

    for (const dependencyId of dependencies) {
      const row = db.registry.get(dependencyId);
      const actual = safeNumber(row?.active_revision);
      const expected = safeNumber(captured[dependencyId], -1);
      if (actual !== expected) {
        mismatches.push(dependencyId);
        continue;
      }

      const dependencyDefinition = catalog().datasets?.[dependencyId] || null;
      const dependencySqlite = Boolean(row && safeNumber(row.active_revision) > 0);
      if (dependencyDefinition?.dependencies?.length && dependencySqlite) {
        const nested = dependencyState(
          dependencyDefinition,
          true,
          db,
          memo,
          nextVisiting
        );
        if (nested && !nested.current) mismatches.push(dependencyId);
      }
    }

    const result = Object.freeze({
      status: mismatches.length ? 'stale' : 'current',
      current: mismatches.length === 0,
      mismatches: Object.freeze(Array.from(new Set(mismatches)))
    });
    memo.set(id, result);
    return result;
  }

  function datasetRows() {
    const embedded = embeddedMap();
    const db = databaseContext();

    const dependencyMemo = new Map();

    return catalog().list()
      .filter(definition => definition.persisted !== false)
      .map(definition => {
        const html = embedded.get(definition.id) || null;
        const registry = db.registry.get(definition.id) || null;
        const runtime = runtimeState(definition.id, db.open, html);
        const htmlMeta = html?.active?.meta || {};

        const startHtml = Boolean(html?.active);
        const sqliteDb = Boolean(
          db.open &&
          registry &&
          safeNumber(registry.active_revision) > 0
        );

        const freshnessFrom = sqliteDb
          ? (registry.freshness_from || null)
          : (htmlMeta.earliestSourceDate || htmlMeta.freshnessFrom || null);
        const freshnessTo = sqliteDb
          ? (registry.freshness_to || null)
          : (htmlMeta.latestSourceDate || htmlMeta.latestRequestDate ||
             htmlMeta.latestChangedAt || htmlMeta.freshness || null);

        const dependency = dependencyState(definition, sqliteDb, db, dependencyMemo);

        return Object.freeze({
          id: definition.id,
          title: definition.databaseTitle,
          kind: definition.kind,
          mode: definition.strategy,
          keyField: definition.keyField || null,
          schemaApp: definition.schemaVersion,
          schemaDb: registry?.dataset_schema_version || null,
          recordCount: sqliteDb
            ? safeNumber(registry.record_count)
            : safeNumber(html?.active?.records?.length),
          sourceFileName: sqliteDb
            ? (registry.source_file_name || null)
            : (htmlMeta.fileName || null),
          freshnessFrom,
          freshnessTo,
          active: Object.freeze({
            startHtml,
            sqliteDb,
            activeRuntime: runtime.active,
            runtimeSource: runtime.source
          }),
          databaseRevision: sqliteDb ? safeNumber(registry.active_revision) : 0,
          databaseUpdatedAt: registry?.updated_at || null,
          dependency,
          latestAttempt: latestAttemptState(db.attempts.get(definition.id) || null)
        });
      });
  }

  function snapshot(intake = []) {
    const db = databaseContext();
    return Object.freeze({
      database: Object.freeze({
        open: db.open,
        fileName: db.info?.fileName || null,
        schemaVersion: db.info?.schemaVersion ?? null,
        databaseUuid: db.info?.databaseUuid || null,
        dirty: db.info?.dirty === true,
        valid: db.info?.valid === true
      }),
      queue: Object.freeze(Array.from(intake || []).map(queueItem)),
      datasets: Object.freeze(datasetRows())
    });
  }

  globalThis.ReclassifierDatasetDbStateModel = Object.freeze({
    snapshot,
    queueItem,
    datasets: datasetRows
  });
})();
