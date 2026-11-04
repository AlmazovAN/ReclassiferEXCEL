// FILE CONTRACT: SQLite database engine and repository implementation.
// Purpose: own low-level SQLite/WASM lifecycle, schema validation, Dataset persistence,
//          transactional writes, audit history, integrity checks and portable export.
// Owns: SQLite handle, repository operation mutex, DB metadata, Dataset Registry/records/state, import_history.
// Reads: ReclassifierDatabaseContract and embedded SQLite WASM assets.
// Writes: Reclassifier.db only through explicit repository operations.
// Public API: globalThis.ReclassifierDatabaseRepository.
// Must not: render application UI or contain subject-specific classification rules.
// Related tests: test_database_core.js, test_database_integration.js,
//                test_sqlite_*.py/js, test_step9_*.js, test_architecture_guardrails.py.
// Dependencies: ReclassifierDatabaseContract (loaded before this file), SQLite WASM
//               assets exposed to the build/runtime, and browser primitives used by
//               file save/download operations. Dataset definitions come from the contract.
// API groups:
//   lifecycle/health: initialize, openDatabase, createDatabase, bootstrapDatasets,
//     validateDatabase, runHealthCheck, getCompatibility, migrateDatabase, closeDatabase
//   Dataset reads: listDatasets, getDatasetRegistry, getDatasetState, getDataset,
//     getKpiDataset, getDatasetFullRows, previewDatasetChange
//   Dataset writes: replaceDataset, replaceDatasetBatch, upsertDataset,
//     upsertDatasetAsync, applyRecalculationBatch, setReportingCoverage
//   audit/export: getImportOverview, getImportHistory, exportDatabase,
//     saveDatabaseToFile, downloadDatabase
//   Mobile Brigade staging/projections and KPI snapshot cache: see API object below.
// Operation map:
//   open/create -> initialize SQLite -> validate/migrate -> publish active handle
//   bootstrap/write -> validate input -> transaction(s) -> Registry/state/history
//     updates -> COMMIT -> advance session revision -> notify runtime readers
//   staged Mobile Brigade -> stage batches in temp tables -> preview -> transactional
//     UPSERT -> COMMIT -> advance revision/notify -> discard stage
//   save/export -> integrity check -> serialize DB -> optional file-handle write and
//     readback verification. Browser download only records a download request.

  // 1. Runtime state, operation serialization, and SQLite primitives
  const databaseContract = globalThis.ReclassifierDatabaseContract;
  if (!databaseContract) throw new Error('SQLite Database Contract is not loaded.');

  const databaseRuntime = {
    sqlitePromise: null,
    sqlite: null,
    db: null,
    internalFileName: null,
    sourceFileName: null,
    openInputBytes: null, // diagnostic: size of file opened, not live SQLite memory
    readOnly: false,
    dirty: false,
    // Session-local revisions only: never persisted into SQLite schema.
    workingRevision: 0,
    verifiedFileRevision: null,
    verifiedFileAt: null,
    downloadRequestedRevision: null,
    downloadRequestedAt: null,
    sequence: 0
  };


  // Increment only after a successful SQL commit (including committed import
  // audit entries). Failed/rolled-back writes do not publish a new revision.
  function markDatabaseCommittedChange() {
    databaseRuntime.workingRevision += 1;
    databaseRuntime.dirty = true;
  }

  function databaseStorageState() {
    return Object.freeze({
      // A session counter, not dataset_registry.active_revision.
      workingRevision: databaseRuntime.workingRevision,
      // Only a completed write + byte-for-byte readback advances this marker.
      confirmedFileRevision: databaseRuntime.verifiedFileRevision,
      confirmedFileAt: databaseRuntime.verifiedFileAt,
      // Browser download is merely requested; OS persistence is unverified.
      downloadRequestedRevision: databaseRuntime.downloadRequestedRevision,
      downloadRequestedAt: databaseRuntime.downloadRequestedAt,
      diskCurrent: !databaseRuntime.dirty &&
        databaseRuntime.verifiedFileRevision !== null &&
        databaseRuntime.verifiedFileRevision === databaseRuntime.workingRevision
    });
  }

  const databaseOperationMutex = {
    active: null,
    sequence: 0
  };

  function databaseOperationState() {
    const active = databaseOperationMutex.active;
    return Object.freeze({
      busy: Boolean(active),
      name: active?.name || null,
      startedAt: active?.startedAt || null,
      sequence: active?.sequence || null
    });
  }

  function databaseBusyError(requestedOperation) {
    const active = databaseOperationMutex.active;
    const error = new Error(
      'SQLite Repository занят операцией «' + (active?.name || 'unknown') +
      '». Операция «' + requestedOperation +
      '» заблокирована до завершения текущей операции.'
    );
    error.name = 'DatabaseBusyError';
    error.code = 'RECLASSIFIER_DATABASE_BUSY';
    error.activeOperation = active?.name || null;
    error.requestedOperation = requestedOperation;
    return error;
  }

  function beginDatabaseOperation(name) {
    if (databaseOperationMutex.active) throw databaseBusyError(name);
    const token = Object.freeze({
      sequence: ++databaseOperationMutex.sequence,
      name,
      startedAt: nowIso()
    });
    databaseOperationMutex.active = token;
    return token;
  }

  function endDatabaseOperation(token) {
    if (databaseOperationMutex.active === token) {
      databaseOperationMutex.active = null;
    }
  }

  async function runDatabaseAsyncOperation(name, operation) {
    const token = beginDatabaseOperation(name);
    try {
      return await operation();
    } finally {
      endDatabaseOperation(token);
    }
  }

  function runDatabaseSyncOperation(name, operation) {
    const token = beginDatabaseOperation(name);
    try {
      return operation();
    } finally {
      endDatabaseOperation(token);
    }
  }

  const databaseAsyncOperation = (name, operation) => (...args) =>
    runDatabaseAsyncOperation(name, () => operation(...args));

  const databaseSyncOperation = (name, operation) => (...args) =>
    runDatabaseSyncOperation(name, () => operation(...args));

// ============================================================================
// INPUT BYTES AND GENERIC HELPERS
// ============================================================================
  function bytesFromBase64(encoded) {
    const text = String(encoded || '').replace(/\s+/g, '');
    if (!text) throw new Error('SQLite WASM не встроен в сборку.');
    const binary = atob(text);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }

  const MAX_SQLITE_OPEN_BYTES = 1024 * 1024 * 1024;

  // Validate the first SQLite page header and file size BEFORE loading a
  // potentially hundreds-of-megabytes DB into the browser or starting WASM.
  async function databaseInputHeader(input) {
    const length = input?.size ?? input?.byteLength ?? input?.length;
    if (!Number.isSafeInteger(length) || length < 100) {
      throw new Error('Файл SQLite отсутствует или меньше минимального заголовка (100 байт).');
    }
    if (length > MAX_SQLITE_OPEN_BYTES) {
      throw new Error(
        'Файл SQLite больше 1 ГиБ. Открытие в браузере может исчерпать память; ' +
        'разделите или оптимизируйте данные до импорта.'
      );
    }
    let header;
    if (typeof Blob !== 'undefined' && input instanceof Blob) {
      header = new Uint8Array(await input.slice(0, 100).arrayBuffer());
    } else if (input instanceof ArrayBuffer) {
      header = new Uint8Array(input, 0, 100);
    } else if (ArrayBuffer.isView(input)) {
      header = new Uint8Array(input.buffer, input.byteOffset, 100);
    } else {
      throw new Error('Ожидается SQLite-файл, ArrayBuffer или Uint8Array.');
    }
    assertSqliteHeader(header);
    return length;
  }

  async function normalizeDatabaseBytes(input) {
    if (input instanceof Uint8Array) return input;
    if (input instanceof ArrayBuffer) return new Uint8Array(input);
    if (ArrayBuffer.isView(input)) {
      return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
    }
    if (typeof Blob !== 'undefined' && input instanceof Blob) {
      return new Uint8Array(await input.arrayBuffer());
    }
    throw new Error('Ожидается SQLite-файл, ArrayBuffer или Uint8Array.');
  }

  function assertSqliteHeader(bytes) {
    if (!(bytes instanceof Uint8Array) || bytes.byteLength < 100) {
      throw new Error('Файл слишком мал и не похож на SQLite database.');
    }
    const expected = 'SQLite format 3\u0000';
    let actual = '';
    for (let i = 0; i < expected.length; i += 1) actual += String.fromCharCode(bytes[i]);
    if (actual !== expected) throw new Error('Файл не является SQLite database.');
    if (bytes[18] === 2 || bytes[19] === 2) {
      throw new Error(
        'SQLite-файл использует WAL-режим. Перед переносом выполните checkpoint и переведите базу в journal_mode=DELETE.'
      );
    }
  }

  function randomId(prefix) {
    const uuid = globalThis.crypto?.randomUUID?.();
    if (uuid) return prefix + uuid;
    return prefix + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2);
  }

  function nowIso() {
    return new Date().toISOString();
  }

// ============================================================================
// SQLITE/WASM INITIALIZATION AND OPEN-HANDLE ACCESS
// ============================================================================
  async function initializeSqlite() {
    if (databaseRuntime.sqlite) return databaseRuntime.sqlite;
    if (databaseRuntime.sqlitePromise) return databaseRuntime.sqlitePromise;
    if (typeof globalThis.sqlite3InitModule !== 'function') {
      throw new Error('SQLite WASM loader отсутствует в сборке.');
    }

    databaseRuntime.sqlitePromise = (async () => {
      const wasmBinary = bytesFromBase64(assets.sqliteWasmBase64);
      globalThis.sqlite3ApiConfig = {
        ...(globalThis.sqlite3ApiConfig || {}),
        disable: {
          ...((globalThis.sqlite3ApiConfig || {}).disable || {}),
          vfs: {
            ...(((globalThis.sqlite3ApiConfig || {}).disable || {}).vfs || {}),
            kvvfs: true,
            opfs: true,
            'opfs-sahpool': true,
            'opfs-wl': true
          }
        }
      };

      let rejectInstantiation;
      let timeoutId = null;
      const instantiateFailure = new Promise((_, reject) => {
        rejectInstantiation = reject;
      });
      const initTimeoutMs = 30000;
      const timeout = new Promise((_, reject) => {
        timeoutId = setTimeout(() => {
          reject(new Error(
            'SQLite WASM не инициализировался за ' + Math.round(initTimeoutMs / 1000) +
            ' секунд. Проверьте сборку и поддержку WebAssembly в браузере.'
          ));
        }, initTimeoutMs);
      });

      log('SQLite WASM: запуск встроенного модуля без сетевых обращений.');
      let sqlite;
      try {
        const initPromise = globalThis.sqlite3InitModule({
          // Bundled sqlite3.js may otherwise try to fetch sqlite3.wasm.
          // The application is offline-only, so instantiate the bytes already embedded in HTML.
          instantiateWasm(imports, onSuccess) {
            WebAssembly.instantiate(wasmBinary, imports).then(result => {
              onSuccess(result.instance, result.module);
            }).catch(error => {
              rejectInstantiation(error instanceof Error
                ? error
                : new Error(String(error)));
            });
            return {};
          },
          onAbort(reason) {
            rejectInstantiation(new Error('SQLite WASM abort: ' + String(reason || 'unknown error')));
          },
          print: () => {},
          printErr: message => log('SQLite WASM: ' + message, 'WARN')
        });
        sqlite = await Promise.race([initPromise, instantiateFailure, timeout]);
      } finally {
        if (timeoutId !== null) clearTimeout(timeoutId);
      }

      if (!sqlite?.oo1?.DB ||
          typeof sqlite.capi?.sqlite3_js_posix_create_file !== 'function' ||
          typeof sqlite.capi?.sqlite3_js_db_export !== 'function') {
        throw new Error('SQLite WASM загружен без обязательных API импорта/экспорта.');
      }
      databaseRuntime.sqlite = sqlite;
      log('SQLite WASM готов: ' + (sqlite.version?.libVersion || build.sqliteVersion || 'version unknown') + '.');
      return sqlite;
    })();

    try {
      return await databaseRuntime.sqlitePromise;
    } catch (error) {
      databaseRuntime.sqlitePromise = null;
      throw error;
    }
  }

  function requireOpenDatabase() {
    if (!databaseRuntime.db) throw new Error('База данных не открыта.');
    return databaseRuntime.db;
  }

  function notifyRuntimeDataChanged() {
    globalThis.ReclassifierRuntimeDataRepository?.invalidate?.();
  }

  function queryRows(db, sql, bind = undefined, rowMode = 'object') {
    const resultRows = [];
    db.exec({ sql, bind, rowMode, resultRows });
    return resultRows;
  }

  function scalar(db, sql, bind = undefined) {
    const rows = queryRows(db, sql, bind, 0);
    return rows.length ? rows[0] : undefined;
  }

  function databaseHandleVfs(db, sqlite = databaseRuntime.sqlite) {
    if (!db?.pointer || typeof sqlite?.capi?.sqlite3_js_db_vfs !== 'function') return 0;
    try {
      return sqlite.capi.sqlite3_js_db_vfs(db.pointer, 0) || 0;
    } catch (_) {
      return 0;
    }
  }

  function unlinkInternalDatabaseFile(
    filename,
    sqlite = databaseRuntime.sqlite,
    pVfs = 0
  ) {
    if (!filename || !sqlite) return false;

    const rawUnlink = sqlite.wasm?.exports?.sqlite3__wasm_vfs_unlink;
    const allocCString = sqlite.wasm?.allocCString;
    const dealloc = sqlite.wasm?.dealloc;
    if (
      typeof rawUnlink === 'function' &&
      typeof allocCString === 'function' &&
      typeof dealloc === 'function'
    ) {
      let pFilename = 0;
      try {
        pFilename = allocCString(filename);
        const rc = Number(rawUnlink(pVfs || 0, pFilename));
        if (rc === 0) return true;
        log(
          'SQLite VFS не удалил внутренний файл ' + filename + '; rc=' + rc + '.',
          'WARN'
        );
      } catch (error) {
        log(
          'Ошибка SQLite VFS cleanup для ' + filename + ': ' +
          (error?.message || String(error)),
          'WARN'
        );
      } finally {
        if (pFilename) {
          try { dealloc(pFilename); } catch (_) {}
        }
      }
      return false;
    }

    // Compatibility fallback for a non-canonical SQLite WASMFS build.
    const wasmfsUnlink = sqlite.capi?.sqlite3_wasmfs_unlink;
    if (typeof wasmfsUnlink === 'function') {
      try {
        wasmfsUnlink(filename);
        return true;
      } catch (_) {}
    }

    log(
      'SQLite VFS cleanup API недоступен; внутренний файл не удалён: ' + filename,
      'WARN'
    );
    return false;
  }

  function closeHandle(options = {}) {
    const db = databaseRuntime.db;
    const filename = databaseRuntime.internalFileName;
    const pVfs = databaseHandleVfs(db);
    if (db) {
      try { db.close(); } catch (_) {}
    }
    databaseRuntime.db = null;
    databaseRuntime.internalFileName = null;
    databaseRuntime.sourceFileName = null;
    databaseRuntime.openInputBytes = null;
    databaseRuntime.readOnly = false;
    databaseRuntime.dirty = false;
    databaseRuntime.workingRevision = 0;
    databaseRuntime.verifiedFileRevision = null;
    databaseRuntime.verifiedFileAt = null;
    databaseRuntime.downloadRequestedRevision = null;
    databaseRuntime.downloadRequestedAt = null;
    if (options.removeFile === true) {
      unlinkInternalDatabaseFile(filename, databaseRuntime.sqlite, pVfs);
    }
    return Object.freeze({ filename, pVfs });
  }

  function publishHandle(db, filename, sourceFileName, dirty) {
    const previous = closeHandle();
    databaseRuntime.db = db;
    databaseRuntime.internalFileName = filename;
    databaseRuntime.sourceFileName = sourceFileName || 'Reclassifier.db';
    databaseRuntime.readOnly = false;
    databaseRuntime.dirty = dirty === true;
    // A freshly opened unchanged file is the baseline (rev 0), not a
    // confirmed save operation. A new/migrated DB starts unsaved (rev 1).
    databaseRuntime.workingRevision = dirty === true ? 1 : 0;
    if (previous.filename && previous.filename !== filename) {
      unlinkInternalDatabaseFile(
        previous.filename,
        databaseRuntime.sqlite,
        previous.pVfs
      );
    }
  }

  function internalFileName() {
    databaseRuntime.sequence += 1;
    return '/reclassifier-' + databaseRuntime.sequence + '.db';
  }

  // 2. Schema contract, migration, and database integrity checks
  function persistedDefinitions() {
    return Object.entries(databaseContract.datasets)
      .filter(([, definition]) => definition.persisted !== false);
  }

  function requiredTableNames(db) {
    return new Set(queryRows(
      db,
      "SELECT name FROM sqlite_master WHERE type='table'",
      undefined,
      0
    ));
  }

  const DATASET_REGISTRY_CONTRACT_FIELDS = Object.freeze([
    Object.freeze({ column: 'kind', definition: 'kind', type: 'text' }),
    Object.freeze({ column: 'dataset_schema_version', definition: 'schemaVersion', type: 'text' }),
    Object.freeze({ column: 'integration_strategy', definition: 'strategy', type: 'text' }),
    Object.freeze({ column: 'key_field', definition: 'keyField', type: 'nullable-text' }),
    Object.freeze({ column: 'allow_empty', definition: 'allowEmpty', type: 'boolean' }),
    Object.freeze({ column: 'persisted', definition: 'persisted', type: 'boolean' })
  ]);

  function registryContractValue(value, type) {
    if (type === 'boolean') return value === true || Number(value) === 1;
    if (type === 'nullable-text') {
      if (value === null || value === undefined || value === '') return null;
      return String(value);
    }
    return String(value ?? '');
  }

  function databaseRegistryContractCheck(db) {
    const schemaVersion = Number(scalar(db, 'PRAGMA user_version'));
    const expected = new Map(persistedDefinitions());
    if (schemaVersion < 3) expected.delete('kpi_source');
    const rows = queryRows(
      db,
      'SELECT dataset_id, kind, dataset_schema_version, integration_strategy, ' +
      'key_field, allow_empty, persisted FROM dataset_registry ORDER BY dataset_id'
    );
    const missing = [];
    const unexpected = [];
    const mismatches = [];

    for (const row of rows) {
      const id = String(row.dataset_id || '');
      const definition = expected.get(id);
      if (!definition) {
        unexpected.push(id || '(empty dataset_id)');
        continue;
      }
      expected.delete(id);

      for (const field of DATASET_REGISTRY_CONTRACT_FIELDS) {
        const actual = registryContractValue(row[field.column], field.type);
        const expectedValue = registryContractValue(
          schemaVersion < 4 && id === 'itsm_data' && field.column === 'dataset_schema_version'
            ? '1.1.0' : definition[field.definition], field.type
        );
        if (actual !== expectedValue) {
          mismatches.push(Object.freeze({
            datasetId: id,
            field: field.column,
            expected: expectedValue,
            actual
          }));
        }
      }
    }

    for (const id of expected.keys()) missing.push(id);

    return Object.freeze({
      compatible: missing.length === 0 && unexpected.length === 0 && mismatches.length === 0,
      missing: Object.freeze(missing),
      unexpected: Object.freeze(unexpected),
      mismatches: Object.freeze(mismatches)
    });
  }

  function registryContractMismatchMessage(check) {
    const parts = [];
    if (check.missing.length) {
      parts.push('отсутствуют Dataset: ' + check.missing.join(', '));
    }
    if (check.unexpected.length) {
      parts.push('неизвестные Dataset: ' + check.unexpected.join(', '));
    }
    if (check.mismatches.length) {
      parts.push('расхождения: ' + check.mismatches.map(item =>
        item.datasetId + '.' + item.field + ' = «' +
        String(item.actual) + '», ожидается «' + String(item.expected) + '»'
      ).join('; '));
    }
    return parts.join('. ');
  }

// ============================================================================
// DATABASE CONTRACT VALIDATION AND COMPATIBILITY
// ============================================================================
  function validateHandle(db) {
    const applicationId = Number(scalar(db, 'PRAGMA application_id'));
    const schemaVersion = Number(scalar(db, 'PRAGMA user_version'));
    const compatibility = databaseContract.compatibility(schemaVersion);
    const tables = requiredTableNames(db);
    const requiredTables = schemaVersion >= 5 ? databaseContract.systemTables
      : schemaVersion >= 2 ? (databaseContract.systemTablesV4 || databaseContract.systemTables)
      : (databaseContract.systemTablesV1 || databaseContract.systemTables);
    const missingTables = requiredTables.filter(name => !tables.has(name));

    let metadata = null;
    if (tables.has('app_metadata')) {
      metadata = queryRows(db, 'SELECT * FROM app_metadata WHERE singleton = 1')[0] || null;
    }

    let registryContract = Object.freeze({
      compatible: false,
      missing: Object.freeze([]),
      unexpected: Object.freeze([]),
      mismatches: Object.freeze([])
    });

    const errors = [];
    if (applicationId !== databaseContract.applicationId) {
      errors.push('application_id не соответствует Reclassifier.');
    }
    if (missingTables.length) {
      errors.push('Не найдены системные таблицы: ' + missingTables.join(', ') + '.');
    }
    if (!metadata) {
      errors.push('Не найден паспорт app_metadata.');
    } else {
      if (metadata.database_type !== databaseContract.databaseType) {
        errors.push('database_type не соответствует Reclassifier.');
      }
      if (Number(metadata.schema_version) !== schemaVersion) {
        errors.push('Версия app_metadata не совпадает с PRAGMA user_version.');
      }
    }

    if (tables.has('dataset_registry')) {
      try {
        registryContract = databaseRegistryContractCheck(db);
        if (!registryContract.compatible) {
          errors.push(
            'Dataset Registry несовместим с текущим Dataset Catalog: ' +
            registryContractMismatchMessage(registryContract) + '.'
          );
        }
      } catch (error) {
        errors.push(
          'Dataset Registry не удалось проверить по текущему Dataset Catalog: ' +
          (error?.message || String(error)) + '.'
        );
      }
    }

    return Object.freeze({
      valid: errors.length === 0,
      errors: Object.freeze(errors),
      applicationId,
      schemaVersion,
      compatibility,
      metadata,
      missingTables: Object.freeze(missingTables),
      registryContract
    });
  }

  function assertWritableValidation(validation) {
    if (!validation.valid) throw new Error(validation.errors.join(' '));
    if (validation.compatibility.status === 'newer-than-app') {
      throw new Error(
        'База имеет более новую схему ' + validation.schemaVersion +
        '; приложение поддерживает до ' + databaseContract.currentSchemaVersion + '. Запись запрещена.'
      );
    }
    if (validation.compatibility.status === 'migration-required') {
      throw new Error('Для базы требуется миграция схемы перед записью.');
    }
    if (!validation.compatibility.writable) {
      throw new Error('Схема базы не поддерживается этой версией приложения.');
    }
  }

  function assertReadableValidation(validation) {
    if (!validation.valid) throw new Error(validation.errors.join(' '));
    if (validation.compatibility.status === 'newer-than-app') {
      throw new Error(
        'База имеет более новую схему ' + validation.schemaVersion +
        '; приложение поддерживает до ' + databaseContract.currentSchemaVersion + '.'
      );
    }
    if (validation.compatibility.status === 'too-old' ||
        validation.compatibility.status === 'invalid') {
      throw new Error('Схема базы не поддерживается этой версией приложения.');
    }
  }

  function migrateHandleToCurrent(db) {
    let version = Number(scalar(db, 'PRAGMA user_version'));
    if (version === databaseContract.currentSchemaVersion) return false;

    const before = validateHandle(db);
    assertReadableValidation(before);
    let migrated = false;

    if (version === 1) {
      const timestamp = nowIso();
      db.transaction('IMMEDIATE', () => {
        db.exec(databaseContract.migration1To2Sql);
        db.exec({
          sql: 'UPDATE app_metadata SET schema_version = 2, updated_at = ?, ' +
            'last_written_by_app_version = ? WHERE singleton = 1',
          bind: [timestamp, String(build.version || 'dev')]
        });
        db.exec({
          sql: 'INSERT OR REPLACE INTO schema_migrations(' +
            'migration_id, from_version, to_version, applied_at, app_version, checksum' +
            ') VALUES (?, ?, ?, ?, ?, ?)',
          bind: [
            'schema-1-to-2-full-dataset',
            1,
            2,
            timestamp,
            String(build.version || 'dev'),
            'dataset_full_records-v1'
          ]
        });
      });
      version = 2;
      migrated = true;
    }

    if (version === 2 && databaseContract.currentSchemaVersion >= 3) {
      const timestamp = nowIso();
      const definition = databaseContract.datasets.kpi_source;
      if (!definition || definition.persisted === false) {
        throw new Error('DB Schema 3 требует persisted Dataset kpi_source.');
      }
      db.transaction('IMMEDIATE', () => {
        db.exec({
          sql: 'INSERT OR IGNORE INTO dataset_registry (' +
            'dataset_id, title, kind, dataset_schema_version, integration_strategy, key_field, ' +
            'allow_empty, persisted, active_revision, record_count, updated_at' +
            ') VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?)',
          bind: [
            'kpi_source',
            definition.title,
            definition.kind,
            definition.schemaVersion,
            definition.strategy,
            definition.keyField,
            definition.allowEmpty ? 1 : 0,
            1,
            timestamp
          ]
        });
        db.exec(databaseContract.migration2To3Sql);
        db.exec({
          sql: 'UPDATE app_metadata SET schema_version = 3, updated_at = ?, ' +
            'last_written_by_app_version = ? WHERE singleton = 1',
          bind: [timestamp, String(build.version || 'dev')]
        });
        db.exec({
          sql: 'INSERT OR REPLACE INTO schema_migrations(' +
            'migration_id, from_version, to_version, applied_at, app_version, checksum' +
            ') VALUES (?, ?, ?, ?, ?, ?)',
          bind: [
            'schema-2-to-3-kpi-source',
            2,
            3,
            timestamp,
            String(build.version || 'dev'),
            'dataset_registry-kpi_source-v1'
          ]
        });
      });
      version = 3;
      migrated = true;
    }

    if (version === 3 && databaseContract.currentSchemaVersion >= 4) {
      const timestamp = nowIso();
      db.transaction('IMMEDIATE', () => {
        const definition = databaseContract.datasets.itsm_data;
        const stateRow = queryRows(db,
          "SELECT state_json FROM dataset_state WHERE dataset_id = 'itsm_data'", undefined, 0)[0];
        const state = stateRow ? JSON.parse(stateRow) : {};
        const oldFields = Array.isArray(state.fields) ? state.fields : [];
        const storedCount = Number(scalar(db,
          "SELECT COUNT(*) FROM dataset_records WHERE dataset_id = 'itsm_data'") || 0);
        if (storedCount && (oldFields.length !== 51 ||
            oldFields[0] !== 'createdAt' || oldFields[50] !== 'completedLast14Days')) {
          throw new Error('Нестандартная схема старого ITSM Dataset; миграция остановлена.');
        }
        if (oldFields.length === 51) {
          state.fields = oldFields.concat('mbPresence');
          state.columns = Array.isArray(state.columns) && state.columns.length === 51
            ? state.columns.concat('Наличие заявки в МБ')
            : null;
          state.fieldCount = 52;
        }
        state.schemaVersion = definition.schemaVersion;
        db.exec({
          sql: "UPDATE dataset_records SET record_json = json_insert(record_json, '$[#]', ?) " +
            "WHERE dataset_id = 'itsm_data' AND json_type(record_json) = 'array' " +
            "AND json_array_length(record_json) = 51",
          bind: ['Нет данных МБ']
        });
        writeState(db, 'itsm_data', state, timestamp);
        db.exec({
          sql: "UPDATE dataset_registry SET dataset_schema_version = ? WHERE dataset_id = 'itsm_data'",
          bind: [definition.schemaVersion]
        });
        db.exec(databaseContract.migration3To4Sql);
        db.exec({
          sql: 'UPDATE app_metadata SET schema_version = 4, updated_at = ?, ' +
            'last_written_by_app_version = ? WHERE singleton = 1',
          bind: [timestamp, String(build.version || 'dev')]
        });
        db.exec({
          sql: 'INSERT OR REPLACE INTO schema_migrations(' +
            'migration_id, from_version, to_version, applied_at, app_version, checksum' +
            ') VALUES (?, ?, ?, ?, ?, ?)',
          bind: ['schema-3-to-4-itsm-mb-presence', 3, 4, timestamp,
            String(build.version || 'dev'), 'itsm-presence-extension-v1']
        });
      });
      version = 4;
      migrated = true;
    }

    if (version === 4 && databaseContract.currentSchemaVersion >= 5) {
      const timestamp = nowIso();
      db.transaction('IMMEDIATE', () => {
        db.exec(databaseContract.migration4To5Sql);
        db.exec({
          sql: 'UPDATE app_metadata SET schema_version = 5, updated_at = ?, ' +
            'last_written_by_app_version = ? WHERE singleton = 1',
          bind: [timestamp, String(build.version || 'dev')]
        });
        db.exec({
          sql: 'INSERT OR REPLACE INTO schema_migrations(' +
            'migration_id, from_version, to_version, applied_at, app_version, checksum' +
            ') VALUES (?, ?, ?, ?, ?, ?)',
          bind: ['schema-4-to-5-kpi-snapshots', 4, 5, timestamp,
            String(build.version || 'dev'), 'kpi_snapshots-v1']
        });
      });
      version = 5;
      migrated = true;
    }

    if (version !== databaseContract.currentSchemaVersion) {
      throw new Error(
        'Не определена миграция DB Schema ' + version + ' → ' +
        databaseContract.currentSchemaVersion + '.'
      );
    }
    const after = validateHandle(db);
    assertWritableValidation(after);
    return migrated;
  }

  function databaseQuickCheck(db) {
    const values = queryRows(db, 'PRAGMA quick_check', undefined, 0)
      .map(value => String(value ?? '').trim())
      .filter(Boolean);
    return {
      ok: values.length === 1 && values[0].toLowerCase() === 'ok',
      messages: values
    };
  }

  function databaseForeignKeyViolations(db) {
    return queryRows(db, 'PRAGMA foreign_key_check');
  }

  function databaseRegistryMismatches(db) {
    return queryRows(
      db,
      'SELECT r.dataset_id, r.record_count AS registry_count, COUNT(d.record_key) AS actual_count ' +
      'FROM dataset_registry r LEFT JOIN dataset_records d ON d.dataset_id = r.dataset_id ' +
      'WHERE r.persisted = 1 GROUP BY r.dataset_id, r.record_count ' +
      'HAVING r.record_count <> COUNT(d.record_key) ORDER BY r.dataset_id'
    );
  }

  function databaseFullDatasetMismatches(db) {
    const mismatches = [];
    const states = queryRows(db, 'SELECT dataset_id, state_json FROM dataset_state');
    for (const item of states) {
      let state;
      try {
        state = JSON.parse(item.state_json);
      } catch (_) {
        continue;
      }
      const meta = state?.fullDataset;
      if (!meta) continue;
      const fullCount = Number(scalar(
        db,
        'SELECT COUNT(*) FROM dataset_full_records WHERE dataset_id = ?',
        [item.dataset_id]
      ) || 0);
      const datasetCount = Number(scalar(
        db,
        'SELECT record_count FROM dataset_registry WHERE dataset_id = ?',
        [item.dataset_id]
      ) || 0);
      if (fullCount > datasetCount ||
          (meta.coverage === 'complete' && fullCount !== datasetCount)) {
        mismatches.push({
          dataset_id: item.dataset_id,
          full_count: fullCount,
          dataset_count: datasetCount,
          coverage: meta.coverage || null
        });
      }
    }
    return mismatches;
  }

  function assertHandleIntegrity(db) {
    const quick = databaseQuickCheck(db);
    if (!quick.ok) {
      throw new Error(
        'SQLite quick_check не пройден: ' +
        (quick.messages.join('; ') || 'неизвестная ошибка целостности') + '.'
      );
    }
    const foreignKeyViolations = databaseForeignKeyViolations(db);
    if (foreignKeyViolations.length) {
      throw new Error(
        'SQLite foreign_key_check обнаружил нарушений: ' +
        foreignKeyViolations.length + '.'
      );
    }
    const registryMismatches = databaseRegistryMismatches(db);
    if (registryMismatches.length) {
      throw new Error(
        'Dataset Registry не соответствует фактическому количеству записей: ' +
        registryMismatches.length + ' Dataset.'
      );
    }
    const fullDatasetMismatches = databaseFullDatasetMismatches(db);
    if (fullDatasetMismatches.length) {
      throw new Error(
        'Full Dataset storage не соответствует Dataset Registry: ' +
        fullDatasetMismatches.length + ' Dataset.'
      );
    }
  }

// ============================================================================
// INTEGRITY / PORTABILITY HEALTH CHECKS
// ============================================================================
  function runHealthCheck() {
    const startedAt = Date.now();
    const db = requireOpenDatabase();
    const validation = validateHandle(db);
    const quick = databaseQuickCheck(db);
    const foreignKeyViolations = validation.valid ? databaseForeignKeyViolations(db) : [];
    const registryMismatches = validation.valid ? databaseRegistryMismatches(db) : [];
    const fullDatasetMismatches = validation.valid ? databaseFullDatasetMismatches(db) : [];
    const registryContractMismatches = validation.registryContract?.mismatches || [];
    const missingRegistryDatasets = validation.registryContract?.missing || [];
    const unexpectedRegistryDatasets = validation.registryContract?.unexpected || [];
    const pageCount = Number(scalar(db, 'PRAGMA page_count') || 0);
    const pageSize = Number(scalar(db, 'PRAGMA page_size') || 0);
    const journalMode = String(scalar(db, 'PRAGMA journal_mode') || '').toLowerCase();
    const estimatedBytes = pageCount * pageSize;
    // Size attribution is a streaming SQLite aggregate, not a JS copy
    // of every JSON record. Disk pages and indexes explain the remainder.
    const datasetStorage = validation.valid ? queryRows(
      db,
      'SELECT r.dataset_id, COUNT(r.record_key) AS rows, ' +
        'SUM(LENGTH(CAST(r.record_json AS BLOB))) AS json_bytes, ' +
        'COALESCE(f.full_rows, 0) AS full_rows, ' +
        'COALESCE(f.full_json_bytes, 0) AS full_json_bytes ' +
      'FROM dataset_records r LEFT JOIN (' +
        'SELECT dataset_id, COUNT(*) AS full_rows, ' +
          'SUM(LENGTH(CAST(row_json AS BLOB))) AS full_json_bytes ' +
        'FROM dataset_full_records GROUP BY dataset_id' +
      ') f ON f.dataset_id = r.dataset_id ' +
      'GROUP BY r.dataset_id ORDER BY (json_bytes + full_json_bytes) DESC'
    ) : [];
    const errors = Array.from(validation.errors || []);
    const warnings = [];

    if (!quick.ok) {
      errors.push(
        'SQLite quick_check: ' +
        (quick.messages.join('; ') || 'неизвестная ошибка') + '.'
      );
    }
    if (foreignKeyViolations.length) {
      errors.push('Нарушений foreign key: ' + foreignKeyViolations.length + '.');
    }
    if (registryMismatches.length) {
      errors.push('Dataset Registry не совпадает с dataset_records: ' + registryMismatches.length + ' Dataset.');
    }
    if (fullDatasetMismatches.length) {
      errors.push('Full Dataset storage повреждён: ' + fullDatasetMismatches.length + ' Dataset.');
    }
    const partialFullDatasets = validation.valid ? queryRows(
      db,
      'SELECT dataset_id, state_json FROM dataset_state'
    ).map(item => {
      try {
        const meta = JSON.parse(item.state_json)?.fullDataset;
        return meta?.coverage === 'partial' ? item.dataset_id : null;
      } catch (_) {
        return null;
      }
    }).filter(Boolean) : [];
    if (partialFullDatasets.length) {
      warnings.push(
        'Full Dataset сохранён частично для: ' + partialFullDatasets.join(', ') +
        '. Исторические строки без Full Dataset не синтезировались.'
      );
    }
    if (journalMode !== 'delete') {
      errors.push('Для переносимого файла требуется journal_mode=DELETE; сейчас: ' + (journalMode || '—') + '.');
    }
    if (validation.compatibility?.status !== 'current') {
      warnings.push('DB Schema status: ' + (validation.compatibility?.status || 'unknown') + '.');
    }

    return Object.freeze({
      ok: errors.length === 0,
      checkedAt: nowIso(),
      durationMs: Math.max(0, Date.now() - startedAt),
      validation,
      quickCheck: Object.freeze(quick),
      foreignKeyViolations: Object.freeze(foreignKeyViolations),
      registryMismatches: Object.freeze(registryMismatches),
      fullDatasetMismatches: Object.freeze(fullDatasetMismatches),
      partialFullDatasets: Object.freeze(partialFullDatasets),
      registryContractMismatches: Object.freeze(Array.from(registryContractMismatches)),
      missingRegistryDatasets: Object.freeze(Array.from(missingRegistryDatasets)),
      unexpectedRegistryDatasets: Object.freeze(Array.from(unexpectedRegistryDatasets)),
      journalMode,
      pageCount,
      pageSize,
      estimatedBytes,
      datasetStorage: Object.freeze(datasetStorage),
      errors: Object.freeze(errors),
      warnings: Object.freeze(warnings)
    });
  }

  function insertRegistryBaseline(db, timestamp) {
    const statement = db.prepare(
      'INSERT INTO dataset_registry (' +
      'dataset_id, title, kind, dataset_schema_version, integration_strategy, key_field, ' +
      'allow_empty, persisted, active_revision, record_count, updated_at' +
      ') VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?)'
    );
    try {
      for (const [id, definition] of persistedDefinitions()) {
        statement.bind([
          id,
          definition.title,
          definition.kind,
          definition.schemaVersion,
          definition.strategy,
          definition.keyField,
          definition.allowEmpty ? 1 : 0,
          definition.persisted === false ? 0 : 1,
          timestamp
        ]).stepReset();
      }
    } finally {
      statement.finalize();
    }
  }

// ============================================================================
// DATABASE LIFECYCLE: CREATE, BOOTSTRAP, OPEN, MIGRATE
// ============================================================================
  // 3. Database lifecycle: create, bootstrap, open, validate, and inspect
  async function createDatabase(options = {}) {
    const sqlite = await initializeSqlite();
    const filename = internalFileName();
    const db = new sqlite.oo1.DB(filename, 'c');
    try {
      db.exec('PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON;');
      db.exec(databaseContract.schemaV5Sql || databaseContract.schemaV4Sql || databaseContract.schemaV3Sql || databaseContract.schemaV2Sql || databaseContract.schemaV1Sql);
      const timestamp = nowIso();
      const databaseUuid = options.databaseUuid || randomId('');
      const appVersion = String(options.appVersion || build.version || 'dev');
      db.transaction('IMMEDIATE', () => {
        db.exec({
          sql: 'INSERT INTO app_metadata (' +
            'singleton, database_uuid, database_type, schema_version, created_at, updated_at, ' +
            'created_by_app_version, last_written_by_app_version' +
            ') VALUES (1, ?, ?, ?, ?, ?, ?, ?)',
          bind: [
            databaseUuid,
            databaseContract.databaseType,
            databaseContract.currentSchemaVersion,
            timestamp,
            timestamp,
            appVersion,
            appVersion
          ]
        });
        insertRegistryBaseline(db, timestamp);
      });
      const validation = validateHandle(db);
      assertWritableValidation(validation);
      publishHandle(
        db,
        filename,
        options.fileName || 'Reclassifier.db',
        true
      );
      notifyRuntimeDataChanged();
      return getDatabaseInfo();
    } catch (error) {
      const pVfs = databaseHandleVfs(db, sqlite);
      try { db.close(); } catch (_) {}
      unlinkInternalDatabaseFile(filename, sqlite, pVfs);
      throw error;
    }
  }

  // Seed an entirely new DB atomically from the active HTML Dataset Store.
  // Chunked inserts yield to the browser between batches without publishing
  // a partially populated database as a successful bootstrap.
  async function bootstrapDatasets(seeds, onProgress = () => {}) {
    const db = requireOpenDatabase();
    if (!Array.isArray(seeds) || !seeds.length) {
      throw new Error('Отсутствуют подготовленные стартовые Dataset.');
    }
    if (typeof onProgress !== 'function') {
      throw new Error('Некорректный обработчик прогресса развёртывания.');
    }
    const currentRows = Number(scalar(db,
      'SELECT COUNT(*) FROM dataset_registry WHERE active_revision > 0') || 0);
    if (currentRows !== 0) {
      throw new Error('Развёртывание встроенных Dataset разрешено только в новую пустую БД.');
    }

    const batchSize = 1000;
    const totalRows = seeds.reduce((sum, seed) => sum + seed.records.length, 0);
    let copiedRows = 0;
    let completedDatasets = 0;
    const seenDatasets = new Set();
    const startedAt = Date.now();

    db.exec('BEGIN IMMEDIATE');
    try {
      for (const seed of seeds) {
        if (!seed || seenDatasets.has(seed.id)) {
          throw new Error('Повторный или некорректный Dataset при развёртывании.');
        }
        seenDatasets.add(seed.id);
        const definition = datasetDefinition(seed.id);
        validateDatasetRecords(seed.id, seed.records, definition);
        const options = seed.options || {};
        const meta = datasetWriteMeta(options);
        const state = meta.state || {};
        const fullPlan = prepareFullDatasetWrite(seed.id, seed.records, options, {});
        const seenKeys = new Set();
        const timestamp = nowIso();

        onProgress({
          phase: 'dataset',
          datasetId: seed.id,
          title: definition.title,
          completedDatasets,
          totalDatasets: seeds.length,
          copiedRows,
          totalRows,
          datasetRows: 0,
          datasetTotalRows: seed.records.length
        });
        await new Promise(resolve => setTimeout(resolve, 0));

        for (let start = 0; start < seed.records.length; start += batchSize) {
          const stop = Math.min(seed.records.length, start + batchSize);
          const stmt = db.prepare(
            'INSERT INTO dataset_records(dataset_id, record_key, ordinal, record_json) VALUES (?, ?, ?, ?)'
          );
          const fullStmt = fullPlan ? db.prepare(
            'INSERT INTO dataset_full_records(dataset_id, record_key, ordinal, row_json) VALUES (?, ?, ?, ?)'
          ) : null;
          try {
            for (let index = start; index < stop; index += 1) {
              const record = seed.records[index];
              let key;
              if (definition.strategy === databaseContract.strategy.UPSERT) {
                key = normalizedKey(stateFieldValue(record, definition.keyField, state));
                if (!key) {
                  throw new Error(
                    'В стартовом Dataset ' + seed.id + ' пустой ключ ' +
                    definition.keyField + ' в строке ' + (index + 1) + '.'
                  );
                }
                if (seenKeys.has(key)) {
                  throw new Error(
                    'В стартовом Dataset ' + seed.id + ' повторяется ключ «' + key + '».'
                  );
                }
                seenKeys.add(key);
              } else {
                key = 'row:' + String(index).padStart(12, '0');
              }
              stmt.bind([seed.id, key, index, JSON.stringify(record)]).stepReset();
              if (fullStmt && fullPlan.rows[index] !== null) {
                fullStmt.bind([
                  seed.id,
                  key,
                  index,
                  JSON.stringify(fullPlan.rows[index])
                ]).stepReset();
              }
            }
          } finally {
            stmt.finalize();
            fullStmt?.finalize();
          }
          copiedRows += stop - start;
          onProgress({
            phase: 'records',
            datasetId: seed.id,
            title: definition.title,
            completedDatasets,
            totalDatasets: seeds.length,
            copiedRows,
            totalRows,
            datasetRows: stop,
            datasetTotalRows: seed.records.length
          });
          await new Promise(resolve => setTimeout(resolve, 0));
        }

        writeState(
          db,
          seed.id,
          datasetStateForWrite(
            db, seed.id, state, {}, fullPlan, seed.records.length, true
          ),
          timestamp
        );
        updateRegistry(db, seed.id, definition, seed.records.length, meta, timestamp);
        insertImportHistory(db, [
          randomId('bootstrap-'),
          seed.id,
          timestamp,
          nowIso(),
          meta.sourceFileName,
          options.sourceFingerprint || meta.contentHash || null,
          definition.strategy,
          'COMMITTED',
          0,
          seed.records.length,
          seed.records.length,
          0,
          0,
          0,
          seed.records.length,
          String(build.version || 'dev'),
          databaseContract.currentSchemaVersion,
          definition.schemaVersion,
          'Первичное развёртывание из встроенных Dataset HTML.',
          JSON.stringify(options.details || { bootstrap: 'embedded-html' })
        ]);
        completedDatasets += 1;
        onProgress({
          phase: 'completed-dataset',
          datasetId: seed.id,
          title: definition.title,
          completedDatasets,
          totalDatasets: seeds.length,
          copiedRows,
          totalRows,
          datasetRows: seed.records.length,
          datasetTotalRows: seed.records.length
        });
        await new Promise(resolve => setTimeout(resolve, 0));
      }

      touchMetadata(db, nowIso());
      db.exec('COMMIT');
    } catch (error) {
      try { db.exec('ROLLBACK'); } catch (_) {}
      throw error;
    }

    markDatabaseCommittedChange();
    notifyRuntimeDataChanged();
    return Object.freeze({
      completedDatasets,
      totalRows: copiedRows,
      durationMs: Math.max(0, Date.now() - startedAt)
    });
  }

  async function openDatabase(input, options = {}) {
    const test12=['TEST_12_PR322','TEST_13_PR322','TEST_14_PR322','TEST_15_PR324','TEST_16_PR326','TEST_17_PR332','TEST_18_PR335'].includes(globalThis.RECLASSIFIER_BUILD?.testLabel);
    const diag=globalThis.ReclassifierDatabaseMemoryDiagnostics;
    const inputBytes=Number(input?.size ?? input?.byteLength ?? input?.length)||0;
    if(test12)diag?.mark?.('sqlite-open','start',{inputBytes});
    await databaseInputHeader(input);
    const sqlite = await initializeSqlite();
    let bytes = await normalizeDatabaseBytes(input);
    globalThis.ReclassifierDiagnosticV2?.checkpoint?.('sqlite-buffer-ready',
      {inputBufferBytes:bytes.byteLength},'start');
    const filename = internalFileName();
    let db = null;
    try {
      if(test12)diag?.mark?.('sqlite-vfs-create','start',{inputBytes});
      globalThis.ReclassifierDiagnosticV2?.checkpoint?.('sqlite-vfs-copy',
        {sqliteVfsInputBytes:bytes.byteLength},'start');
      sqlite.capi.sqlite3_js_posix_create_file(filename, bytes);
      globalThis.ReclassifierDiagnosticV2?.checkpoint?.('sqlite-vfs-copy',
        {sqliteVfsInputBytes:bytes.byteLength,
          wasmCapacityBytes:sqlite.wasm?.memory?.buffer?.byteLength||0},'end');
      if(test12)diag?.mark?.('sqlite-vfs-create','end',{inputBytes});
      bytes = null;
      globalThis.ReclassifierDiagnosticV2?.checkpoint?.('sqlite-buffer-reference-released',
        {inputBufferBytes:0},'end'); // release the large imported ArrayBuffer before DB checks
      if(test12)diag?.mark?.('sqlite-validation','start');
      db = new sqlite.oo1.DB(filename, 'r');
      const initialValidation = validateHandle(db);
      assertReadableValidation(initialValidation);
      db.close();
      db = new sqlite.oo1.DB(filename, 'w');
      db.exec('PRAGMA foreign_keys=ON; PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL;');
      const migrated = initialValidation.compatibility.migrationRequired
        ? migrateHandleToCurrent(db)
        : false;
      const validation = validateHandle(db);
      assertWritableValidation(validation);
      assertHandleIntegrity(db);
      if(test12)diag?.mark?.('sqlite-validation','end');
      publishHandle(
        db,
        filename,
        options.fileName || input?.name || 'Reclassifier.db',
        migrated || options.recovered === true
      );
      databaseRuntime.openInputBytes = Number(input?.size ?? input?.byteLength ?? input?.length) || null;
      notifyRuntimeDataChanged();
      if(test12)diag?.mark?.('sqlite-open','end',{inputBytes});
      return getDatabaseInfo();
    } catch (error) {
      globalThis.ReclassifierDiagnosticV2?.checkpoint?.('sqlite-open',
        {inputBufferBytes:bytes?.byteLength||0},'error');
      if(test12)diag?.mark?.('sqlite-open','error',{inputBytes});
      const pVfs = databaseHandleVfs(db, sqlite);
      try { db?.close(); } catch (_) {}
      // An invalid replacement must leave the previously active DB untouched.
      // Drop the rejected candidate from the SQLite virtual filesystem immediately.
      unlinkInternalDatabaseFile(filename, sqlite, pVfs);
      throw error;
    }
  }

  function validateDatabase() {
    return validateHandle(requireOpenDatabase());
  }

  function getCompatibility(schemaVersion = null) {
    if (schemaVersion === null || schemaVersion === undefined) {
      schemaVersion = Number(scalar(requireOpenDatabase(), 'PRAGMA user_version'));
    }
    return databaseContract.compatibility(schemaVersion);
  }

  function migrateDatabase() {
    const db = requireOpenDatabase();
    const validation = validateHandle(db);
    assertReadableValidation(validation);
    if (validation.compatibility.status === 'current') return getDatabaseInfo();
    const migrated = migrateHandleToCurrent(db);
    if (migrated) {
      markDatabaseCommittedChange();
      notifyRuntimeDataChanged();
    }
    return getDatabaseInfo();
  }

  // Explicit handle state distinguishes intentionally closed HTML mode from
  // an OPEN SQLite handle whose metadata has become unreadable/corrupt.
  function hasOpenDatabase() {
    return Boolean(databaseRuntime.db);
  }

  // TEST_12: only in-memory counters. No SQL, no file copying, no persistence.
  function getDiagnosticMemorySnapshot() {
    const memory=databaseRuntime.sqlite?.wasm?.memory;
    const bytes=memory?.buffer?.byteLength;
    return Object.freeze({
      databaseOpen:Boolean(databaseRuntime.db),
      databaseInputMiB:Number.isFinite(databaseRuntime.openInputBytes)
        ? Math.round(databaseRuntime.openInputBytes/1048576*100)/100 : null,
      sqliteWasmCapacityMiB:Number.isFinite(bytes)
        ? Math.round(bytes/1048576*100)/100 : null
    });
  }

  function getDatabaseInfo() {
    const db = requireOpenDatabase();
    const validation = validateHandle(db);
    const metadata = validation.metadata || {};
    return Object.freeze({
      fileName: databaseRuntime.sourceFileName || 'Reclassifier.db',
      internalFileName: databaseRuntime.internalFileName,
      databaseUuid: metadata.database_uuid || null,
      databaseType: metadata.database_type || null,
      schemaVersion: validation.schemaVersion,
      compatibility: validation.compatibility,
      applicationId: validation.applicationId,
      sqliteVersion: databaseRuntime.sqlite?.version?.libVersion || build.sqliteVersion || null,
      readOnly: databaseRuntime.readOnly,
      dirty: databaseRuntime.dirty,
      storage: databaseStorageState(),
      valid: validation.valid,
      errors: validation.errors,
      updatedAt: metadata.updated_at || null,
      lastWrittenByAppVersion: metadata.last_written_by_app_version || null
    });
  }

// ============================================================================
// READ-SIDE REPOSITORY API
// ============================================================================
  function listDatasets() {
    return queryRows(
      requireOpenDatabase(),
      'SELECT * FROM dataset_registry ORDER BY kind, title, dataset_id'
    );
  }

  function getDatasetRegistry(id) {
    const row = queryRows(
      requireOpenDatabase(),
      'SELECT * FROM dataset_registry WHERE dataset_id = ?',
      [id]
    )[0];
    if (!row) throw new Error('Dataset не зарегистрирован в БД: ' + id);
    return row;
  }

  // Read only the ITSM fields required by the Mobile Brigade Worker. The former
  // getDataset('itsm_data') materialized both all 52-field analytic records and
  // the entire persisted Full Dataset; this read-only projection does neither.
  // JSON paths are built from validated integer field offsets, never user input.
  // 4. Dataset and Mobile Brigade read projections
  function getItsmMobileBrigadeLinkRows() {
    const db = requireOpenDatabase();
    const schema = globalThis.ReclassifierItsmDatasetSchema;
    const state = getDatasetState('itsm_data');
    const fields = state.fields == null ? schema?.fields : state.fields;
    if (!Array.isArray(fields) ||
        fields.indexOf('number') < 0 || fields.indexOf('createdAt') < 0 ||
        new Set(fields).size !== fields.length) {
      throw new Error('ITSM → МБ: отсутствуют поля number и createdAt в схеме ITSM.');
    }
    const numberIndex = fields.indexOf('number');
    const createdAtIndex = fields.indexOf('createdAt');
    const sql = "SELECT json_type(record_json), json_array_length(record_json), " +
      "CASE WHEN json_type(record_json) = 'array' " +
      "THEN json_extract(record_json, '$[" + numberIndex + "]') " +
      "ELSE json_extract(record_json, '$.number') END, " +
      "CASE WHEN json_type(record_json) = 'array' " +
      "THEN json_extract(record_json, '$[" + createdAtIndex + "]') " +
      "ELSE json_extract(record_json, '$.createdAt') END " +
      "FROM dataset_records WHERE dataset_id = 'itsm_data' " +
      "ORDER BY ordinal, record_key";
    const links = [];
    const stmt = db.prepare(sql);
    try {
      while (stmt.step()) {
        const kind = stmt.get(0);
        if (kind !== 'array' && kind !== 'object') {
          throw new Error('ITSM → МБ: некорректный тип записи ITSM.');
        }
        if (kind === 'array' && Number(stmt.get(1)) !== fields.length) {
          throw new Error('ITSM → МБ: ширина записи ITSM не соответствует схеме.');
        }
        links.push({
          number: stmt.get(2) ?? '',
          createdAt: stmt.get(3) ?? null
        });
      }
    } finally {
      stmt.finalize();
    }
    return links;
  }

  // Period XLSX export reads only date projections until a page is selected.
  // Never call getDataset('mobile_brigade_data') from its page: that would
  // materialize ~200k analytical records AND all full-source rows in JS.
  function mobileBrigadeExportDay(value) {
    const convert = globalThis.ReclassifierDatasetExcelExport?.recordDate;
    if (typeof convert !== 'function') {
      throw new Error('Обработчик календарных дат МБ недоступен.');
    }
    return convert('mobile_brigade_data', { factDate: value });
  }

  function getMobileBrigadeExportInfo() {
    const db = requireOpenDatabase();
    const registry = getDatasetRegistry('mobile_brigade_data');
    const stored = getDatasetState('mobile_brigade_data').fullDataset;
    let from = null, to = null, dated = 0, undated = 0;
    let fullRows = 0, missingFullRows = 0;
    const monthly = globalThis.RECLASSIFIER_BUILD?.testLabel==='TEST_12_PR322'
      ? new Map() : null;
    const infoStarted = Date.now();
    // LEFT JOIN checks each row's source presence without transferring
    // source JSON into JavaScript. Legacy analytical-only imports may have
    // no matching row in dataset_full_records.
    const stmt = db.prepare(
      "SELECT json_extract(r.record_json, '$.factDate'), f.record_key " +
      "FROM dataset_records r LEFT JOIN dataset_full_records f " +
      "ON f.dataset_id = r.dataset_id AND f.record_key = r.record_key " +
      "WHERE r.dataset_id = 'mobile_brigade_data' " +
      "ORDER BY r.ordinal, r.record_key"
    );
    try {
      while (stmt.step()) {
        if (stmt.get(1) == null) missingFullRows++;
        else fullRows++;
        const day = mobileBrigadeExportDay(stmt.get(0));
        if (!day) { undated++; continue; }
        dated++;
        if (monthly) {
          const month = day.slice(0,7);
          const bucket=monthly.get(month) || {month,dated:0,fullRows:0,analyticalRows:0};
          bucket.dated++;bucket.analyticalRows++;
          if (stmt.get(1) != null) bucket.fullRows++;
          monthly.set(month,bucket);
        }
        if (from === null || day < from) from = day;
        if (to === null || day > to) to = day;
      }
    } finally {
      stmt.finalize();
    }
    return Object.freeze({
      databaseUuid: getDatabaseInfo().databaseUuid,
      revision: Number(registry.active_revision || 0),
      rows: Number(registry.record_count || 0),
      from, to, dated, undated, fullRows, missingFullRows,
      monthlyCoverage:monthly
        ? Array.from(monthly.values()).sort((a,b)=>a.month.localeCompare(b.month)) : [],
      infoScanDurationMs:Math.max(0,Date.now()-infoStarted),
      columns: Array.isArray(stored?.columns) ? stored.columns.slice() : [],
      fullDatasetAvailable: Array.isArray(stored?.columns) &&
        stored.columns.length > 0 && fullRows > 0
    });
  }

  function getMobileBrigadeExportPage(from, to, offset = 0, pageSize = 10000, mode = 'full') {
    const validDay = globalThis.ReclassifierDatasetExcelExport?.dateKey;
    if (typeof validDay !== 'function' || validDay(from) !== from ||
        validDay(to) !== to || from > to) {
      throw new Error('Некорректный период экспорта МБ.');
    }
    if (!Number.isSafeInteger(offset) || offset < 0 ||
        !Number.isInteger(pageSize) || pageSize < 1 || pageSize > 10000) {
      throw new Error('Экспорт МБ допускает страницы от 1 до 10 000 строк.');
    }
    if (mode !== 'full' && mode !== 'analytical') {
      throw new Error('Неизвестный режим экспорта МБ.');
    }
    const db = requireOpenDatabase();
    const startInfo = getDatabaseInfo();
    const registry = getDatasetRegistry('mobile_brigade_data');
    const revision = Number(registry.active_revision || 0);
    const meta = getDatasetState('mobile_brigade_data').fullDataset;
    const fullColumns = meta?.columns;
    const analyticalSchema = mode === 'analytical'
      ? globalThis.ReclassifierDatasetExcelExport?.sqliteMobileAnalyticalSchema?.()
      : null;
    const columns = mode === 'full' ? fullColumns : analyticalSchema?.columns;
    if (!Array.isArray(columns) || !columns.length ||
        (mode === 'analytical' && !Array.isArray(analyticalSchema?.keys))) {
      throw new Error(mode === 'full'
        ? 'Исходные колонки Full Dataset МБ отсутствуют; выберите аналитический экспорт.'
        : 'Схема аналитического экспорта МБ недоступна.');
    }
    const stmt = db.prepare(
      "SELECT json_extract(r.record_json, '$.factDate'), f.record_key, " +
      "f.row_json, r.record_json " +
      "FROM dataset_records r LEFT JOIN dataset_full_records f " +
      "ON f.dataset_id = r.dataset_id AND f.record_key = r.record_key " +
      "WHERE r.dataset_id = 'mobile_brigade_data' ORDER BY r.ordinal, r.record_key"
    );
    let seen = 0, hasMore = false;
    let scannedRows = 0, matchedRows = 0, jsonChars = 0;
    const readStarted = Date.now();
    const rows = [];
    try {
      while (stmt.step()) {
        scannedRows++;
        const day = mobileBrigadeExportDay(stmt.get(0));
        if (!day || day < from || day > to) continue;
        // The presence marker is cheap; do not transfer full row_json
        // into JS when seeking a later 10k-row page.
        if (mode === 'full' && stmt.get(1) == null) continue;
        matchedRows++;
        if (seen++ < offset) continue;
        if (rows.length >= pageSize) { hasMore = true; break; }
        let row;
        if (mode === 'full') {
          const text = stmt.get(2);
          jsonChars += text.length;
          row = JSON.parse(text);
        } else {
          const text = stmt.get(3);
          jsonChars += text.length;
          const record = JSON.parse(text);
          if (!record || typeof record !== 'object' || Array.isArray(record)) {
            throw new Error('Некорректная аналитическая запись МБ.');
          }
          row = analyticalSchema.keys.map(key => record[key] ?? null);
        }
        if (!Array.isArray(row) || row.length !== columns.length) {
          throw new Error('Неверная ширина строки экспорта МБ.');
        }
        rows.push(row);
      }
    } finally {
      stmt.finalize();
    }
    const after = getDatabaseInfo();
    const latestRevision = Number(getDatasetRegistry('mobile_brigade_data').active_revision || 0);
    if (startInfo.databaseUuid !== after.databaseUuid || latestRevision !== revision) {
      throw new Error('SQLite изменилась при чтении периода МБ. Повторите экспорт.');
    }
    return {
      columns: columns.slice(), rows, hasMore, mode,
      nextOffset: offset + rows.length,
      databaseUuid: startInfo.databaseUuid, revision,
      diagnostics: {scannedRows, matchedRows, jsonChars,
        durationMs: Math.max(0, Date.now() - readStarted)}
    };
  }

  function getMobileBrigadeRowsForRequests(requestKeys) {
    if (!Array.isArray(requestKeys)) {
      throw new Error('Для поиска задач МБ требуется список номеров заявок ITSM.');
    }
    const wanted = new Set(requestKeys.map(normalizedKey).filter(Boolean));
    if (!wanted.size) return [];
    const db = requireOpenDatabase();
    const selected = [];
    // Scan through SQLite instead of materializing the full Mobile Brigade Dataset
    // in JavaScript just to enrich the incoming ITSM export.
    const stmt = db.prepare(
      "SELECT record_json FROM dataset_records WHERE dataset_id = 'mobile_brigade_data'"
    );
    try {
      while (stmt.step()) {
        const record = JSON.parse(stmt.get(0));
        if (wanted.has(normalizedKey(record?.request))) selected.push(record);
      }
    } finally {
      stmt.finalize();
    }
    return selected;
  }

  // Metadata-only transaction: preserves event rows, calculated fields and
  // Dataset revision. Updated timestamp + runtime invalidation bust caches.
  function setReportingCoverage(id,declaration=null) {
    if(!['itsm_data','mobile_brigade_data'].includes(id))
      throw new Error('Подтверждать покрытие можно только для ITSM и МБ.');
    const db=requireOpenDatabase();
    const registry=getDatasetRegistry(id);
    if(Number(registry.active_revision||0)<1)
      throw new Error('Сначала загрузите Dataset в SQLite.');
    const current=getDatasetState(id);
    const timestamp=nowIso();
    const coverage=declaration===null?null:
      globalThis.ReclassifierKpiSourceFacts?.certifyReportingCoverage(
        declaration,{datasetId:id,confirmed:true,timestamp}
      );
    if(declaration!==null&&!coverage)
      throw new Error('Контракт подтверждения покрытия недоступен.');
    const latest=globalThis.ReclassifierKpiSourceFacts?.reportingDay(
      registry.freshness_to
    );
    if(coverage && latest && latest>coverage.coverageThrough)
      throw new Error('В SQLite есть события после выбранной даты окончания: '+
        latest+'. Укажите полный подтверждённый период.');
    const next={...current};
    if(coverage)next.reportingCoverage=coverage;
    else delete next.reportingCoverage;
    db.transaction('IMMEDIATE',()=>{
      writeState(db,id,next,timestamp);
      db.exec({sql:'UPDATE dataset_registry SET updated_at = ? WHERE dataset_id = ?',
        bind:[timestamp,id]});
      touchMetadata(db,timestamp);
    });
    markDatabaseCommittedChange();
    notifyRuntimeDataChanged();
    return coverage;
  }

  function getDatasetState(id) {
    const value = queryRows(
      requireOpenDatabase(),
      'SELECT state_json FROM dataset_state WHERE dataset_id = ?',
      [id],
      0
    )[0];
    return value ? JSON.parse(value) : {};
  }

  // TEST_17: a cursor decodes one JSON record at a time. db.exec(resultRows)
  // previously retained every serialized row alongside the decoded arrays.
  function datasetJsonCursor(db, id) {
    const result=[];
    const stmt=db.prepare(
      'SELECT record_json FROM dataset_records WHERE dataset_id = ? ' +
      'ORDER BY ordinal, record_key'
    );
    try {
      stmt.bind([id]);
      while(stmt.step()) result.push(JSON.parse(stmt.get(0)));
    } finally {
      stmt.finalize();
    }
    return result;
  }

  function datasetFullCursor(db, id, metadata) {
    const rows=[], recordKeys=[];
    const stmt=db.prepare(
      'SELECT record_key, row_json FROM dataset_full_records ' +
      'WHERE dataset_id = ? ORDER BY ordinal, record_key'
    );
    try {
      stmt.bind([id]);
      while(stmt.step()) {
        recordKeys.push(stmt.get(0));
        rows.push(JSON.parse(stmt.get(1)));
      }
    } finally {
      stmt.finalize();
    }
    return Object.assign({},metadata,{
      fieldCount:metadata.columns.length,rowCount:rows.length,
      recordKeys,rows
    });
  }

  // SQL projection of the only Full Dataset field consumed by current KPI
  // preparation (SLA overdue); no Full Dataset rows are read for Mobile Brigades.
  // Keep record keys and ordering for the existing lookup + positional fallback.
  function datasetKpiSlaCursor(db, id, metadata) {
    const normalize=value=>String(value??'').replace(/\u00a0/g,' ')
      .replace(/\s+/g,' ').trim().toLocaleLowerCase('ru-RU');
    const expected=normalize('Просрочен по разрешению');
    const index=metadata.columns.findIndex(column=>{
      const name=normalize(column);
      return name===expected || name.startsWith(expected+' ') ||
        name.startsWith(expected+'(');
    });
    if(index<0)return null;
    const rows=[],recordKeys=[];
    // The index comes solely from existing column metadata; only a JSON
    // scalar is fetched, never an entire row_json or unneeded columns.
    const path='$['+index+']';
    const stmt=db.prepare(
      'SELECT record_key, json_extract(row_json, ?), json_type(row_json, ?) ' +
      'FROM dataset_full_records WHERE dataset_id = ? ORDER BY ordinal, record_key'
    );
    try {
      stmt.bind([path,path,id]);
      while(stmt.step()) {
        const type=stmt.get(2),raw=stmt.get(1);
        const value=type==='true'?true:type==='false'?false:
          (type==='array'||type==='object')?JSON.parse(raw):raw;
        recordKeys.push(stmt.get(0));
        rows.push([value]);
      }
    } finally {
      stmt.finalize();
    }
    return Object.assign({},metadata,{
      columns:[metadata.columns[index]],fieldCount:1,
      rowCount:rows.length,recordKeys,rows
    });
  }

  function readDataset(id,projection='full') {
    const db=requireOpenDatabase();
    const registry=getDatasetRegistry(id);
    globalThis.ReclassifierDiagnosticV2?.checkpoint?.('sqlite-dataset-read',{
      rows:Number(registry?.record_count)||0
    },'start');
    const records=datasetJsonCursor(db,id);
    const stateRow=queryRows(db,
      'SELECT state_json FROM dataset_state WHERE dataset_id = ?',[id],0)[0];
    const state=stateRow?JSON.parse(stateRow):{};
    const metadata=state?.fullDataset;
    let fullDataset=null;
    if(metadata&&Array.isArray(metadata.columns)) {
      if(projection==='kpi'&&id==='mobile_brigade_data') {
        // No mobile Full Dataset column is read by KPI preparation.
        fullDataset=null;
      } else if(projection==='kpi'&&id==='itsm_data') {
        fullDataset=datasetKpiSlaCursor(db,id,metadata);
      } else {
        fullDataset=datasetFullCursor(db,id,metadata);
      }
    }
    globalThis.ReclassifierDiagnosticV2?.checkpoint?.('sqlite-dataset-read',{
      rows:records.length,fullRows:fullDataset?.rows?.length||0
    },'end');
    return {id,records,state,fullDataset,registry};
  }

  function getDataset(id) {
    return readDataset(id,'full');
  }

  function getKpiDataset(id) {
    if(id!=='itsm_data'&&id!=='mobile_brigade_data')
      throw new Error('SQL-проекция KPI поддерживает только ITSM и Мобильные бригады.');
    return readDataset(id,'kpi');
  }

  function getDatasetFullRows(id) {
    // Used only when the KPI source has already materialized analytical records.
    // Avoid parsing the same 286k records for a second long-lived Runtime view.
    if(id!=='itsm_data'&&id!=='mobile_brigade_data')
      throw new Error('Раздельное чтение Full Dataset поддерживает только ITSM и МБ.');
    const db=requireOpenDatabase();
    const registry=getDatasetRegistry(id);
    const row=queryRows(db,
      'SELECT state_json FROM dataset_state WHERE dataset_id = ?',[id],0)[0];
    const state=row?JSON.parse(row):{};
    const metadata=state?.fullDataset;
    const fullDataset=metadata&&Array.isArray(metadata.columns)
      ?datasetFullCursor(db,id,metadata):null;
    return {id,state,fullDataset,registry};
  }


// ============================================================================
// KPI SNAPSHOT CACHE (DB Schema v5) — derived values, not source-of-truth rows.
// ============================================================================
  // 5. KPI snapshot cache
  const KPI_SNAPSHOT_MAX_ENTRIES = 12;
  const KPI_SNAPSHOT_MAX_CHARS = 8 * 1024 * 1024;

  // An accidental-corruption checksum, not a security signature. Structural,
  // revision and methodology validation are enforced separately on every read.
  function kpiSnapshotChecksum(json) {
    let a = 2166136261, b = 0x811c9dc5;
    for (let i = 0; i < json.length; i++) {
      const char = json.charCodeAt(i);
      a = Math.imul(a ^ char, 16777619) >>> 0;
      b = Math.imul(b ^ (char + i & 65535), 2246822519) >>> 0;
    }
    return [json.length.toString(16), a.toString(16), b.toString(16)].join(':');
  }

  function kpiSourceRevisions(db) {
    return queryRows(db,
      'SELECT dataset_id, active_revision, content_hash, updated_at FROM dataset_registry ' +
      "WHERE dataset_id IN ('itsm_data','mobile_brigade_data','drivers','combined') " +
      'ORDER BY dataset_id'
    ).map(row => [
      row.dataset_id, Number(row.active_revision || 0),
      row.content_hash || '', row.updated_at || ''
    ]);
  }

  function kpiCacheInput(input) {
    if (!input || typeof input !== 'object' || typeof input.cacheKey !== 'string' ||
        !input.cacheKey || input.cacheKey.length > 512 ||
        typeof input.sourceSignature !== 'string' || !input.sourceSignature ||
        typeof input.methodologyVersion !== 'string' || !input.methodologyVersion ||
        typeof input.snapshotSchemaVersion !== 'string' || !input.snapshotSchemaVersion) {
      throw new TypeError('KPI snapshot cache: некорректный ключ или версия расчёта.');
    }
  }

  function getKpiSnapshot(input) {
    // A corrupt optional cache row can never prevent reading Dataset records.
    if (!databaseRuntime.db) return null;
    kpiCacheInput(input);
    const db = requireOpenDatabase();
    let row;
    try {
      row = queryRows(db,
        'SELECT source_signature, source_revisions_json, methodology_version, ' +
          'snapshot_schema_version, payload_json, payload_checksum ' +
        'FROM kpi_snapshots WHERE cache_key = ?', [input.cacheKey])[0];
    } catch (_) {
      return null;
    }
    if (!row || row.source_signature !== input.sourceSignature ||
        row.methodology_version !== input.methodologyVersion ||
        row.snapshot_schema_version !== input.snapshotSchemaVersion) return null;
    try {
      const live = JSON.stringify(kpiSourceRevisions(db));
      if (row.source_revisions_json !== live ||
          row.payload_json.length > KPI_SNAPSHOT_MAX_CHARS ||
          row.payload_checksum !== kpiSnapshotChecksum(row.payload_json)) return null;
      const snapshot = JSON.parse(row.payload_json);
      if (!snapshot || snapshot.type !== 'reliability-report' ||
          snapshot.schemaVersion !== input.snapshotSchemaVersion ||
          snapshot.diagnostics?.stage !== 'full' ||
          snapshot.diagnostics?.sourceSignature !== input.sourceSignature ||
          !snapshot.calculatedAt || !Array.isArray(snapshot.sources) ||
          !snapshot.results || typeof snapshot.results !== 'object' ||
          !snapshot.query || !snapshot.filters || !snapshot.kpiView) return null;
      return snapshot;
    } catch (_) {
      return null;
    }
  }

  function putKpiSnapshot(input, snapshot) {
    if (!databaseRuntime.db) return Object.freeze({stored:false,reason:'no-db'});
    kpiCacheInput(input);
    if (!snapshot || snapshot.type !== 'reliability-report' ||
        snapshot.schemaVersion !== input.snapshotSchemaVersion ||
        snapshot.diagnostics?.stage !== 'full' ||
        snapshot.diagnostics?.sourceSignature !== input.sourceSignature ||
        !snapshot.calculatedAt || !snapshot.results || !snapshot.kpiView) {
      return Object.freeze({stored:false,reason:'incomplete'});
    }
    const db = requireOpenDatabase();
    assertWritableValidation(validateHandle(db));
    const json = JSON.stringify(snapshot);
    if (!json || json.length > KPI_SNAPSHOT_MAX_CHARS) {
      return Object.freeze({stored:false,reason:'too-large'});
    }
    const checksum = kpiSnapshotChecksum(json);
    const revisions = JSON.stringify(kpiSourceRevisions(db));
    const previous = queryRows(db,
      'SELECT source_signature, source_revisions_json, methodology_version, ' +
        'snapshot_schema_version, payload_checksum FROM kpi_snapshots WHERE cache_key = ?',
      [input.cacheKey])[0];
    if (previous?.source_signature === input.sourceSignature &&
        previous.source_revisions_json === revisions &&
        previous.methodology_version === input.methodologyVersion &&
        previous.snapshot_schema_version === input.snapshotSchemaVersion &&
        previous.payload_checksum === checksum) {
      return Object.freeze({stored:false,reason:'unchanged'});
    }
    const timestamp = nowIso();
    db.transaction('IMMEDIATE', () => {
      db.exec({
        sql:'INSERT INTO kpi_snapshots(' +
          'cache_key,source_signature,source_revisions_json,methodology_version,' +
          'snapshot_schema_version,payload_json,payload_checksum,calculated_at,stored_at)' +
          ' VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(cache_key) DO UPDATE SET ' +
          'source_signature=excluded.source_signature,' +
          'source_revisions_json=excluded.source_revisions_json,' +
          'methodology_version=excluded.methodology_version,' +
          'snapshot_schema_version=excluded.snapshot_schema_version,' +
          'payload_json=excluded.payload_json,payload_checksum=excluded.payload_checksum,' +
          'calculated_at=excluded.calculated_at,stored_at=excluded.stored_at',
        bind:[input.cacheKey,input.sourceSignature,revisions,input.methodologyVersion,
          input.snapshotSchemaVersion,json,checksum,snapshot.calculatedAt,timestamp]
      });
      // Bounded storage across all revisions and filter combinations.
      db.exec({
        sql:'DELETE FROM kpi_snapshots WHERE cache_key NOT IN (' +
          'SELECT cache_key FROM kpi_snapshots ORDER BY stored_at DESC, cache_key DESC LIMIT ?)',
        bind:[KPI_SNAPSHOT_MAX_ENTRIES]
      });
      touchMetadata(db,timestamp);
    });
    // Like Dataset imports, a new cache row is a real unsaved SQLite change.
    // No Runtime Dataset invalidation: source revisions and records are unchanged.
    markDatabaseCommittedChange();
    return Object.freeze({stored:true,reason:'written'});
  }

  function getKpiSnapshotStats() {
    if (!databaseRuntime.db) return Object.freeze({count:0,bytes:0,capacity:KPI_SNAPSHOT_MAX_ENTRIES});
    try {
      const row = queryRows(requireOpenDatabase(),
        'SELECT COUNT(*) AS count, COALESCE(SUM(LENGTH(CAST(payload_json AS BLOB))),0) AS bytes FROM kpi_snapshots')[0];
      return Object.freeze({
        count: Number(row?.count || 0), bytes: Number(row?.bytes || 0),
        capacity: KPI_SNAPSHOT_MAX_ENTRIES
      });
    } catch (_) {
      return Object.freeze({count:0,bytes:0,capacity:KPI_SNAPSHOT_MAX_ENTRIES});
    }
  }

// ============================================================================
// DATASET CONTRACT VALIDATION, KEYS AND DIFF PREPARATION
// ============================================================================
  // 6. Dataset write planning and metadata helpers
  function datasetDefinition(id, expectedStrategy) {
    const definition = databaseContract.datasets[id];
    if (!definition || definition.persisted === false) {
      throw new Error('Dataset не предназначен для хранения в SQLite: ' + id);
    }
    if (expectedStrategy && definition.strategy !== expectedStrategy) {
      throw new Error(
        'Для Dataset ' + id + ' требуется стратегия ' + definition.strategy +
        ', а не ' + expectedStrategy + '.'
      );
    }
    return definition;
  }

  function stateFieldValue(record, keyField, datasetState) {
    if (record && !Array.isArray(record) && typeof record === 'object') return record[keyField];
    if (Array.isArray(record)) {
      const fields = Array.isArray(datasetState?.fields) ? datasetState.fields : [];
      const index = fields.indexOf(keyField);
      if (index >= 0) return record[index];
    }
    return undefined;
  }

  function normalizedKey(value) {
    return String(value ?? '')
      .replace(/\u00a0/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .toLocaleLowerCase('ru-RU');
  }

  function validateDatasetRecords(id, records, definition) {
    if (!Array.isArray(records)) throw new Error('Dataset records должны быть массивом.');
    if (!definition.allowEmpty && records.length === 0) {
      throw new Error('Для Dataset ' + id + ' требуется хотя бы одна запись.');
    }
  }

  function datasetPartitionSelection(id, records, definition, datasetState = {}) {
    const field = definition.partitionField;
    if (!field) return null;

    const labels = new Map();
    records.forEach((record, index) => {
      const raw = stateFieldValue(record, field, datasetState);
      const key = normalizedKey(raw);
      if (!key) {
        throw new Error(
          'Пустая секция ' + field + ' в строке ' + (index + 1) + ' Dataset ' + id + '.'
        );
      }
      if (!labels.has(key)) labels.set(key, String(raw).trim());
    });
    if (!labels.size) {
      throw new Error('Не удалось определить секции ' + field + ' для Dataset ' + id + '.');
    }
    return {
      field,
      keys: new Set(labels.keys()),
      values: Array.from(labels.values())
    };
  }

  function datasetPartitionCurrentRows(db, id, selection, datasetState = {}) {
    if (!selection) return { preserved: [], removed: 0 };
    const current = queryRows(
      db,
      'SELECT record_json FROM dataset_records WHERE dataset_id = ? ORDER BY ordinal, record_key',
      [id],
      0
    ).map(value => JSON.parse(value));
    const preserved = [];
    let removed = 0;
    for (const record of current) {
      const key = normalizedKey(stateFieldValue(record, selection.field, datasetState));
      if (selection.keys.has(key)) removed += 1;
      else preserved.push(record);
    }
    return { preserved, removed };
  }

  function fullDatasetColumnKeys(columns) {
    const counts = new Map();
    return columns.map(value => {
      const label = String(value ?? '');
      const occurrence = (counts.get(label) || 0) + 1;
      counts.set(label, occurrence);
      return label + '\u0000' + occurrence;
    });
  }

  function mergeFullDatasetColumns(previousColumns, incomingColumns) {
    if (!Array.isArray(previousColumns) || !previousColumns.length) {
      return Array.from(incomingColumns || []);
    }
    const incoming = Array.from(incomingColumns || []);
    const previous = Array.from(previousColumns);
    const merged = incoming.slice();
    const incomingKeys = new Set(fullDatasetColumnKeys(incoming));
    const previousKeys = fullDatasetColumnKeys(previous);
    previous.forEach((column, index) => {
      if (!incomingKeys.has(previousKeys[index])) merged.push(column);
    });
    return merged;
  }

  function remapFullDatasetRow(row, sourceColumns, targetColumns) {
    const sourceKeys = fullDatasetColumnKeys(sourceColumns);
    const targetKeys = fullDatasetColumnKeys(targetColumns);
    const sourceIndex = new Map(sourceKeys.map((key, index) => [key, index]));
    return targetKeys.map(key => {
      const index = sourceIndex.get(key);
      return index === undefined ? null : (row[index] === undefined ? null : row[index]);
    });
  }

  function fullDatasetDateMin(left, right) {
    return [left, right].filter(Boolean).sort().at(0) || null;
  }

  function fullDatasetDateMax(left, right) {
    return [left, right].filter(Boolean).sort().at(-1) || null;
  }

  function prepareFullDatasetWrite(id, records, options, previousState = {}) {
    const source = options?.fullDataset;
    if (!source) return null;
    if (!source || typeof source !== 'object' ||
        !Array.isArray(source.columns) || !Array.isArray(source.rows)) {
      throw new Error('Full Dataset ' + id + ' должен содержать columns и rows.');
    }
    const sparse = options.allowSparseFullDataset === true;
    if (sparse && datasetDefinition(id).strategy !== databaseContract.strategy.UPSERT) {
      throw new Error('Частичный Full Dataset допустим только для накопительных Dataset.');
    }
    if (!sparse && source.rows.length !== records.length) {
      throw new Error(
        'Full Dataset ' + id + ' не совпадает по числу строк с аналитическим Dataset.'
      );
    }
    if (sparse && (!Array.isArray(source.recordKeys) ||
        source.recordKeys.length !== source.rows.length)) {
      throw new Error(
        'Частичный Full Dataset ' + id + ' требует отдельный ключ для каждой исходной строки.'
      );
    }
    if (!sparse && source.coverage === 'partial') {
      throw new Error('Частичный Full Dataset требует явного режима переноса.');
    }
    if (Number(source.fieldCount ?? source.columns.length) !== source.columns.length) {
      throw new Error('Full Dataset ' + id + ': fieldCount не совпадает с columns.');
    }
    for (let index = 0; index < source.rows.length; index += 1) {
      if (!Array.isArray(source.rows[index]) ||
          source.rows[index].length !== source.columns.length) {
        throw new Error(
          'Full Dataset ' + id + ': некорректная ширина строки ' + (index + 1) + '.'
        );
      }
    }

    const previousMeta = previousState?.fullDataset || {};
    const previousColumns = Array.isArray(previousMeta.columns)
      ? previousMeta.columns
      : [];
    const columns = mergeFullDatasetColumns(previousColumns, source.columns);
    const mappedRows = source.rows.map(row =>
      remapFullDatasetRow(row, source.columns, columns)
    );
    let incomingRows = mappedRows;
    if (sparse) {
      const definition = datasetDefinition(id, databaseContract.strategy.UPSERT);
      const keyState = options.state || previousState;
      const analyticIndex = new Map();
      records.forEach((record, index) => {
        const key = normalizedKey(stateFieldValue(record, definition.keyField, keyState));
        if (!key || analyticIndex.has(key)) {
          throw new Error(
            'Частичный Full Dataset ' + id + ': некорректные аналитические ключи.'
          );
        }
        analyticIndex.set(key, index);
      });
      incomingRows = Array(records.length).fill(null);
      const seenSourceKeys = new Set();
      source.recordKeys.forEach((rawKey, index) => {
        const key = normalizedKey(rawKey);
        const position = analyticIndex.get(key);
        if (!key || seenSourceKeys.has(key) || position === undefined) {
          throw new Error(
            'Частичный Full Dataset ' + id + ': повторный или неизвестный recordKey.'
          );
        }
        seenSourceKeys.add(key);
        incomingRows[position] = mappedRows[index];
      });
    } else if (Array.isArray(source.recordKeys)) {
      const definition = datasetDefinition(id);
      if (definition.strategy === databaseContract.strategy.UPSERT) {
        const keyState = options.state || previousState;
        if (source.recordKeys.length !== records.length ||
            source.recordKeys.some((rawKey, index) =>
              normalizedKey(rawKey) !== normalizedKey(
                stateFieldValue(records[index], definition.keyField, keyState)
              ))) {
          throw new Error(
            'Full Dataset ' + id + ': recordKeys не совпадают с порядком аналитических строк.'
          );
        }
      }
    }
    const previousKeys = fullDatasetColumnKeys(previousColumns);
    const mergedKeys = fullDatasetColumnKeys(columns);
    const schemaChanged = previousColumns.length > 0 &&
      (previousKeys.length !== mergedKeys.length ||
       previousKeys.some((key, index) => key !== mergedKeys[index]));

    return {
      previousColumns,
      columns,
      rows: incomingRows,
      schemaChanged,
      meta: {
        schemaVersion: source.schemaVersion || previousMeta.schemaVersion || '1.0.0',
        package: source.package || previousMeta.package || null,
        aggregation: source.aggregation || previousMeta.aggregation || null,
        fieldCount: columns.length,
        columns,
        sourceRows: source.sourceRows ?? source.rows.length,
        storedSourceRows: source.rows.length,
        earliestSourceDate: fullDatasetDateMin(
          previousMeta.earliestSourceDate, source.earliestSourceDate
        ),
        latestSourceDate: fullDatasetDateMax(
          previousMeta.latestSourceDate, source.latestSourceDate
        )
      }
    };
  }

  function remapStoredFullDatasetRows(db, id, previousColumns, targetColumns) {
    if (!Array.isArray(previousColumns) || !previousColumns.length) return;
    const rows = queryRows(
      db,
      'SELECT record_key, row_json FROM dataset_full_records WHERE dataset_id = ?',
      [id]
    );
    if (!rows.length) return;
    const update = db.prepare(
      'UPDATE dataset_full_records SET row_json = ? WHERE dataset_id = ? AND record_key = ?'
    );
    try {
      for (const item of rows) {
        const previous = JSON.parse(item.row_json);
        const remapped = remapFullDatasetRow(previous, previousColumns, targetColumns);
        update.bind([JSON.stringify(remapped), id, item.record_key]).stepReset();
      }
    } finally {
      update.finalize();
    }
  }

  function datasetStateForWrite(db, id, proposedState, previousState, fullPlan, datasetRows, preserveCertifiedCoverage=false) {
    const state = Object.assign({}, proposedState || {});
    // A new UPSERT changes the accumulated Dataset. Previous certification
    // is no longer proof of coverage for the revised contents.
    if(!preserveCertifiedCoverage &&
       (id==='itsm_data'||id==='mobile_brigade_data'))
      delete state.reportingCoverage;
    if (fullPlan) {
      const fullCount = Number(scalar(
        db,
        'SELECT COUNT(*) FROM dataset_full_records WHERE dataset_id = ?',
        [id]
      ) || 0);
      state.fullDataset = Object.assign({}, fullPlan.meta, {
        rowCount: fullCount,
        datasetRowCount: datasetRows,
        coverage: fullCount === datasetRows ? 'complete' : 'partial'
      });
    } else if (previousState?.fullDataset) {
      // A write without fresh source columns must never preserve an obsolete
      // "complete" certification after new analytical keys have been added.
      const knownRows = Number(scalar(
        db,
        'SELECT COUNT(*) FROM dataset_full_records WHERE dataset_id = ?',
        [id]
      ) || 0);
      state.fullDataset = Object.assign({}, previousState.fullDataset, {
        rowCount: knownRows,
        datasetRowCount: datasetRows,
        coverage: knownRows === datasetRows ? 'complete' : 'partial'
      });
    }
    return state;
  }


  // Compare one incoming record at a time without materializing the existing
  // SQLite Dataset or extra JSON copies in JavaScript.
  function previewDatasetChange(id, records, options = {}) {
    const definition = datasetDefinition(id);
    validateDatasetRecords(id, records, definition);
    const db = requireOpenDatabase();
    const before = Number(
      scalar(db, 'SELECT record_count FROM dataset_registry WHERE dataset_id = ?', [id]) || 0
    );

    if (definition.strategy === databaseContract.strategy.REPLACE) {
      const datasetState = getDatasetState(id);
      const partition = datasetPartitionSelection(id, records, definition, datasetState);
      if (partition) {
        const current = datasetPartitionCurrentRows(db, id, partition, datasetState);
        return Object.freeze({
          datasetId: id, strategy: definition.strategy,
          rowsBefore: before, rowsIncoming: records.length,
          rowsInserted: records.length, rowsUpdated: 0, rowsUnchanged: 0,
          rowsDeleted: current.removed,
          rowsAfter: before - current.removed + records.length,
          partitionField: partition.field,
          partitions: Object.freeze(partition.values.slice())
        });
      }
      return Object.freeze({
        datasetId: id, strategy: definition.strategy,
        rowsBefore: before, rowsIncoming: records.length,
        rowsInserted: records.length, rowsUpdated: 0, rowsUnchanged: 0,
        rowsDeleted: before, rowsAfter: records.length
      });
    }
    if (definition.strategy !== databaseContract.strategy.UPSERT) {
      throw new Error('Dataset ' + id + ' имеет неподдерживаемую стратегию ' + definition.strategy + '.');
    }

    const previousState = getDatasetState(id);
    const meta = datasetWriteMeta(options, { state: previousState });
    const previousFields = previousState?.fields;
    const candidateFields = meta.state?.fields;
    const inspectFields = id === 'itsm_data' && Array.isArray(previousFields) &&
      Array.isArray(candidateFields) && previousFields.length === candidateFields.length &&
      previousFields.every((field, index) => field === candidateFields[index]);
    const fieldCounters = inspectFields ? new Uint32Array(candidateFields.length) : null;
    const fieldLabels = Array.isArray(meta.state?.columns) ? meta.state.columns : [];
    let sourceChangedRows = 0;
    let derivedChangedRows = 0;
    let formatOnlyRows = 0;
    const seen = new Set();
    let inserted = 0;
    let updated = 0;
    let unchanged = 0;
    const lookup = db.prepare(
      'SELECT record_json FROM dataset_records WHERE dataset_id = ? AND record_key = ?'
    );
    try {
      records.forEach((record, index) => {
        const key = normalizedKey(stateFieldValue(record, definition.keyField, meta.state || previousState));
        if (!key || seen.has(key)) {
          throw new Error((!key ? 'Пустой' : 'Повторный') + ' ключ ' +
            definition.keyField + ' в строке ' + (index + 1) + ' Dataset ' + id + '.');
        }
        seen.add(key);
        lookup.bind([id, key]);
        const oldJson = lookup.step() ? lookup.get(0) : null;
        lookup.reset();
        if (oldJson === null) {
          inserted += 1;
        } else {
          const json = JSON.stringify(record);
          if (oldJson === json) {
            unchanged += 1;
          } else {
            updated += 1;
            if (fieldCounters) {
              const previous = JSON.parse(oldJson);
              if (Array.isArray(previous) && Array.isArray(record) &&
                  previous.length === fieldCounters.length &&
                  record.length === fieldCounters.length) {
                let sourceChanged = false;
                let derivedChanged = false;
                let anyChanged = false;
                for (let column = 0; column < fieldCounters.length; column += 1) {
                  if (JSON.stringify(previous[column]) !== JSON.stringify(record[column])) {
                    fieldCounters[column] += 1;
                    anyChanged = true;
                    if (column < 17) sourceChanged = true;
                    else derivedChanged = true;
                  }
                }
                if (sourceChanged) sourceChangedRows += 1;
                if (derivedChanged) derivedChangedRows += 1;
                if (!anyChanged) formatOnlyRows += 1;
              } else {
                formatOnlyRows += 1;
              }
            }
          }
        }
      });
    } finally {
      lookup.finalize();
    }

    return Object.freeze({
      datasetId: id, strategy: definition.strategy,
      rowsBefore: before, rowsIncoming: records.length,
      rowsInserted: inserted, rowsUpdated: updated, rowsUnchanged: unchanged,
      rowsDeleted: 0, rowsAfter: before + inserted,
      fieldDiff: fieldCounters ? Object.freeze({
        sourceChangedRows,
        derivedChangedRows,
        formatOnlyRows,
        // Aggregate only. Never retain or display request numbers, names,
        // descriptions or before/after values in the inspection panel.
        columns: Object.freeze(Array.from(fieldCounters, (count, index) => ({
          id: candidateFields[index],
          label: fieldLabels[index] || candidateFields[index],
          scope: index < 17 ? 'source' : 'derived',
          count: Number(count)
        })).filter(item => item.count > 0).sort((a, b) => b.count - a.count))
      }) : null,
      fieldDiffUnavailable: id === 'itsm_data' && !inspectFields
        ? 'Порядок или состав полей текущей БД и кандидата различается; нужен контроль схемы.'
        : null
    });
  }

  function datasetWriteMeta(options, defaults = {}) {
    return {
      freshnessFrom: options?.freshnessFrom ?? defaults.freshnessFrom ?? null,
      freshnessTo: options?.freshnessTo ?? defaults.freshnessTo ?? null,
      sourceFileName: options?.sourceFileName ?? defaults.sourceFileName ?? null,
      contentHash: options?.contentHash ?? defaults.contentHash ?? null,
      state: options?.state && typeof options.state === 'object' ? options.state : (defaults.state || {})
    };
  }

  function writeState(db, id, state, timestamp) {
    db.exec({
      sql: 'INSERT INTO dataset_state(dataset_id, state_json, updated_at) VALUES (?, ?, ?) ' +
        'ON CONFLICT(dataset_id) DO UPDATE SET state_json = excluded.state_json, updated_at = excluded.updated_at',
      bind: [id, JSON.stringify(state || {}), timestamp]
    });
  }

  function updateRegistry(db, id, definition, count, meta, timestamp) {
    db.exec({
      sql: 'UPDATE dataset_registry SET dataset_schema_version = ?, integration_strategy = ?, key_field = ?, ' +
        'active_revision = active_revision + 1, record_count = ?, freshness_from = ?, freshness_to = ?, ' +
        'source_file_name = ?, content_hash = ?, updated_at = ? WHERE dataset_id = ?',
      bind: [
        definition.schemaVersion,
        definition.strategy,
        definition.keyField,
        count,
        meta.freshnessFrom,
        meta.freshnessTo,
        meta.sourceFileName,
        meta.contentHash,
        timestamp,
        id
      ]
    });
  }

  function insertImportHistory(db, values) {
    db.exec({
      sql: 'INSERT INTO import_history (' +
        'import_id, dataset_id, started_at, finished_at, source_file_name, source_fingerprint, ' +
        'integration_strategy, status, rows_before, rows_incoming, rows_inserted, rows_updated, ' +
        'rows_unchanged, rows_deleted, rows_after, app_version, db_schema_version, dataset_schema_version, message, details_json' +
        ') VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      bind: values
    });
  }

  function touchMetadata(db, timestamp) {
    db.exec({
      sql: 'UPDATE app_metadata SET updated_at = ?, last_written_by_app_version = ? WHERE singleton = 1',
      bind: [timestamp, String(build.version || 'dev')]
    });
  }

  function recordFailedImport(db, context, error) {
    const failedAt = nowIso();
    const details = Object.assign({}, context.details || {}, {
      error: error?.message || String(error)
    });
    try {
      db.transaction('IMMEDIATE', () => {
        touchMetadata(db, failedAt);
        insertImportHistory(db, [
          context.importId,
          context.id,
          context.startedAt,
          failedAt,
          context.sourceFileName || null,
          context.sourceFingerprint || null,
          context.strategy,
          context.status || 'FAILED',
          context.rowsBefore,
          context.rowsIncoming,
          0,
          0,
          0,
          0,
          context.rowsBefore,
          String(build.version || 'dev'),
          databaseContract.currentSchemaVersion,
          context.datasetSchemaVersion,
          error?.message || String(error),
          JSON.stringify(details)
        ]);
      });
      markDatabaseCommittedChange();
    } catch (_) {
      // The original integration error must not be masked by an audit-write failure.
    }
  }

// ============================================================================
// TRANSACTIONAL DATASET WRITES: REPLACE / UPSERT
// ============================================================================
  // 7. Transactional Dataset mutations and import audit
  function replaceDatasetInTransaction(db, id, records, options = {}, context = {}) {
    const definition = datasetDefinition(id, databaseContract.strategy.REPLACE);
    validateDatasetRecords(id, records, definition);

    const before = Number(
      scalar(db, 'SELECT record_count FROM dataset_registry WHERE dataset_id = ?', [id]) || 0
    );
    const previousState = getDatasetState(id);
    const preparedFullScope = options.fullPreparedScope === true;
    if (preparedFullScope && (definition.kind !== 'equipment' ||
        !definition.partitionField || options.partitionScopeConfirmed !== true ||
        !Array.isArray(options.state?.lastReplacedPartitions) ||
        !options.state.lastReplacedPartitions.length)) {
      throw new Error('Equipment: полная реконструкция источника требует явного подтверждения секций.');
    }
    const partition = preparedFullScope ? null :
      datasetPartitionSelection(id, records, definition, previousState);
    if (partition && options.fullDataset) {
      throw new Error('Partition REPLACE пока не поддерживает Full Dataset payload.');
    }
    const current = partition
      ? datasetPartitionCurrentRows(db, id, partition, previousState)
      : { preserved: [], removed: before };
    const nextRecords = partition ? current.preserved.concat(records) : records;
    const timestamp = context.timestamp || nowIso();
    const meta = datasetWriteMeta(options, { state: previousState });
    if (definition.kind === 'equipment' && definition.persisted !== false) {
      const historyApi = globalThis.ReclassifierEquipmentHistory;
      if (!historyApi?.observe) {
        throw new Error('Equipment History: движок истории не загружен.');
      }
      const previousRows = queryRows(
        db,
        'SELECT record_json FROM dataset_records WHERE dataset_id = ? ORDER BY ordinal, record_key',
        [id],
        0
      ).map(value => JSON.parse(value));
      const scopeList = preparedFullScope
        ? options.state?.lastReplacedPartitions
        : partition?.values;
      const selected = scopeList && scopeList.length ? scopeList
        : Array.from(new Set(nextRecords.map(row =>
          String(row?.[definition.partitionField] || '').trim()).filter(Boolean)));
      const previousRegistry = getDatasetRegistry(id);
      const history = historyApi.observe({
        datasetId:id,previousRows,nextRows:nextRecords,
        previousHistory:previousState?.equipmentHistory || null,
        sections:selected,
        sourceDate:options.freshnessTo || options.state?.freshness || null,
        sourceName:options.sourceFileName || null,
        previousSourceDate:previousRegistry?.freshness_to || previousState?.freshness || null,
        previousSourceName:previousRegistry?.source_file_name || null,
        recordedAt:timestamp
      });
      meta.state = Object.assign({}, previousState,meta.state, {
        equipmentHistory:history
      });
    }
    if (partition) {
      meta.state = Object.assign({}, previousState, meta.state || {}, {
        partitionField: partition.field,
        lastReplacedPartitions: partition.values.slice()
      });
    }
    const importId = context.importId || randomId('import-');
    const details = Object.assign({}, options.details || {}, context.details || {});
    if (partition) {
      details.partitionReplace = {
        field: partition.field,
        values: partition.values.slice()
      };
    }

    db.exec({ sql: 'DELETE FROM dataset_records WHERE dataset_id = ?', bind: [id] });
    const stmt = db.prepare(
      'INSERT INTO dataset_records(dataset_id, record_key, ordinal, record_json) VALUES (?, ?, ?, ?)'
    );
    try {
      nextRecords.forEach((record, index) => {
        stmt.bind([
          id,
          'row:' + String(index).padStart(12, '0'),
          index,
          JSON.stringify(record)
        ]).stepReset();
      });
    } finally {
      stmt.finalize();
    }
    writeState(db, id, meta.state, timestamp);
    updateRegistry(db, id, definition, nextRecords.length, meta, timestamp);
    touchMetadata(db, timestamp);
    insertImportHistory(db, [
      importId, id, timestamp, timestamp, meta.sourceFileName, options.sourceFingerprint || null,
      definition.strategy, 'COMMITTED', before, records.length, records.length, 0, 0, current.removed,
      nextRecords.length, String(build.version || 'dev'), databaseContract.currentSchemaVersion,
      definition.schemaVersion, options.message || null, JSON.stringify(details)
    ]);

    return {
      datasetId: id,
      strategy: definition.strategy,
      rowsBefore: before,
      rowsIncoming: records.length,
      rowsInserted: records.length,
      rowsUpdated: 0,
      rowsUnchanged: 0,
      rowsDeleted: current.removed,
      rowsAfter: nextRecords.length,
      partitionField: partition?.field || null,
      partitions: partition ? partition.values.slice() : [],
      importId
    };
  }

  function replaceDataset(id, records, options = {}) {
    const definition = datasetDefinition(id, databaseContract.strategy.REPLACE);
    validateDatasetRecords(id, records, definition);

    const db = requireOpenDatabase();
    const before = Number(
      scalar(db, 'SELECT record_count FROM dataset_registry WHERE dataset_id = ?', [id]) || 0
    );
    const timestamp = nowIso();
    const importId = randomId('import-');
    let result;
    try {
      db.transaction('IMMEDIATE', () => {
        result = replaceDatasetInTransaction(
          db, id, records, options, { timestamp, importId }
        );
      });
    } catch (error) {
      recordFailedImport(db, {
        importId,
        id,
        startedAt: timestamp,
        sourceFileName: options.sourceFileName || null,
        sourceFingerprint: options.sourceFingerprint || null,
        strategy: definition.strategy,
        rowsBefore: before,
        rowsIncoming: records.length,
        datasetSchemaVersion: definition.schemaVersion,
        details: options.details || {}
      }, error);
      throw error;
    }
    markDatabaseCommittedChange();
    notifyRuntimeDataChanged();
    return result;
  }

  function replaceDatasetBatch(changes, options = {}) {
    if (!Array.isArray(changes) || changes.length === 0) {
      throw new Error('Пакет REPLACE должен содержать хотя бы один Dataset.');
    }

    const db = requireOpenDatabase();
    const timestamp = nowIso();
    const batchId = options.batchId || randomId('batch-');
    const contexts = [];
    const seenDatasets = new Map();

    changes.forEach((change, index) => {
      const id = change?.id;
      const records = change?.records;
      const writeOptions = change?.options || {};
      if (!id || !Array.isArray(records)) {
        throw new Error('Некорректная операция REPLACE в позиции ' + (index + 1) + '.');
      }
      const definition = datasetDefinition(id, databaseContract.strategy.REPLACE);
      validateDatasetRecords(id, records, definition);
      const before = Number(
        scalar(db, 'SELECT record_count FROM dataset_registry WHERE dataset_id = ?', [id]) || 0
      );
      const previousState = getDatasetState(id);
      const preparedFullScope = writeOptions.fullPreparedScope === true;
      if (preparedFullScope && (definition.kind !== 'equipment' ||
          !definition.partitionField || writeOptions.partitionScopeConfirmed !== true)) {
        throw new Error('Equipment: неподтверждённая полная реконструкция.');
      }
      const partition = preparedFullScope ? null :
        datasetPartitionSelection(id, records, definition, previousState);
      const previous = seenDatasets.get(id);

      if (previous && !definition.partitionField) {
        throw new Error(
          'В одном атомарном пакете Dataset «' + id +
          '» без секционирования может присутствовать только один раз.'
        );
      }
      if (partition) {
        const known = previous?.partitionKeys || new Set();
        for (const key of partition.keys) {
          if (known.has(key)) {
            throw new Error(
              'Секция «' + (partition.values.find(value => normalizedKey(value) === key) || key) +
              '» Dataset «' + id + '» повторяется в нескольких файлах одного пакета.'
            );
          }
          known.add(key);
        }
        seenDatasets.set(id, { partitionKeys: known });
      } else {
        seenDatasets.set(id, { partitionKeys: null });
      }

      contexts.push({
        id,
        records,
        options: writeOptions,
        definition,
        before,
        importId: randomId('import-'),
        index
      });
    });

    const results = [];
    try {
      db.transaction('IMMEDIATE', () => {
        contexts.forEach(context => {
          results.push(replaceDatasetInTransaction(
            db,
            context.id,
            context.records,
            context.options,
            {
              timestamp,
              importId: context.importId,
              details: {
                atomicBatchId: batchId,
                atomicBatchIndex: context.index + 1,
                atomicBatchSize: contexts.length
              }
            }
          ));
        });
      });
    } catch (error) {
      contexts.forEach(context => {
        recordFailedImport(db, {
          importId: context.importId,
          id: context.id,
          startedAt: timestamp,
          sourceFileName: context.options.sourceFileName || null,
          sourceFingerprint: context.options.sourceFingerprint || null,
          strategy: context.definition.strategy,
          status: 'ROLLED_BACK',
          rowsBefore: context.before,
          rowsIncoming: context.records.length,
          datasetSchemaVersion: context.definition.schemaVersion,
          details: Object.assign({}, context.options.details || {}, {
            atomicBatchId: batchId,
            atomicBatchIndex: context.index + 1,
            atomicBatchSize: contexts.length
          })
        }, error);
      });
      throw error;
    }

    markDatabaseCommittedChange();
    notifyRuntimeDataChanged();

    return Object.freeze({
      batchId,
      results: Object.freeze(results.map(result => Object.freeze(result))),
      changedDatasetIds: Object.freeze(Array.from(new Set(results.map(result => result.datasetId))))
    });
  }

  function upsertDataset(id, records, options = {}) {
    const definition = datasetDefinition(id, databaseContract.strategy.UPSERT);
    validateDatasetRecords(id, records, definition);

    const db = requireOpenDatabase();
    const before = Number(
      scalar(db, 'SELECT record_count FROM dataset_registry WHERE dataset_id = ?', [id]) || 0
    );
    const previousState = getDatasetState(id);
    const meta = datasetWriteMeta(options, { state: previousState });
    const keyState = meta.state || previousState;
    const fullPlan = prepareFullDatasetWrite(id, records, options, previousState);
    const timestamp = nowIso();
    const importId = randomId('import-');
    let inserted = 0;
    let updated = 0;
    let unchanged = 0;

    try {
      db.transaction('IMMEDIATE', () => {
        if (fullPlan?.schemaChanged) {
          remapStoredFullDatasetRows(
            db, id, fullPlan.previousColumns, fullPlan.columns
          );
        }

        let nextOrdinal = Number(scalar(
          db, 'SELECT COALESCE(MAX(ordinal), -1) + 1 FROM dataset_records WHERE dataset_id = ?', [id]
        ));
        const seen = new Set();
        const lookup = db.prepare(
          'SELECT ordinal, record_json FROM dataset_records WHERE dataset_id = ? AND record_key = ?'
        );
        const write = db.prepare(
          'INSERT INTO dataset_records(dataset_id, record_key, ordinal, record_json) VALUES (?, ?, ?, ?) ' +
          'ON CONFLICT(dataset_id, record_key) DO UPDATE SET record_json = excluded.record_json'
        );
        const fullWrite = fullPlan ? db.prepare(
          'INSERT INTO dataset_full_records(dataset_id, record_key, ordinal, row_json) VALUES (?, ?, ?, ?) ' +
          'ON CONFLICT(dataset_id, record_key) DO UPDATE SET ' +
          'ordinal = excluded.ordinal, row_json = excluded.row_json'
        ) : null;
        try {
          records.forEach((record, index) => {
            const key = normalizedKey(stateFieldValue(record, definition.keyField, keyState));
            if (!key || seen.has(key)) {
              throw new Error((!key ? 'Пустой' : 'Повторный') + ' ключ ' +
                definition.keyField + ' в строке ' + (index + 1) + ' Dataset ' + id + '.');
            }
            seen.add(key);
            const json = JSON.stringify(record);
            lookup.bind([id, key]);
            const exists = lookup.step();
            const oldOrdinal = exists ? Number(lookup.get(0)) : -1;
            const oldJson = exists ? lookup.get(1) : null;
            lookup.reset();

            const ordinal = exists ? oldOrdinal : nextOrdinal++;
            if (exists && oldJson === json) {
              unchanged += 1;
            } else {
              if (exists) updated += 1;
              else inserted += 1;
              write.bind([id, key, ordinal, json]).stepReset();
            }

            if (fullWrite) {
              fullWrite.bind([
                id,
                key,
                ordinal,
                JSON.stringify(fullPlan.rows[index])
              ]).stepReset();
            }
          });
        } finally {
          lookup.finalize();
          write.finalize();
          fullWrite?.finalize();
        }

        const after = before + inserted;
        writeState(
          db,
          id,
          datasetStateForWrite(
            db, id, meta.state, previousState, fullPlan, after
          ),
          timestamp
        );
        updateRegistry(db, id, definition, after, meta, timestamp);
        touchMetadata(db, timestamp);
        insertImportHistory(db, [
          importId, id, timestamp, timestamp, meta.sourceFileName, options.sourceFingerprint || null,
          definition.strategy, 'COMMITTED', before, records.length, inserted, updated, unchanged, 0,
          after, String(build.version || 'dev'), databaseContract.currentSchemaVersion,
          definition.schemaVersion, options.message || null, JSON.stringify(options.details || {})
        ]);
      });
    } catch (error) {
      recordFailedImport(db, {
        importId, id, startedAt: timestamp, sourceFileName: meta.sourceFileName,
        sourceFingerprint: options.sourceFingerprint || null, strategy: definition.strategy,
        rowsBefore: before, rowsIncoming: records.length,
        datasetSchemaVersion: definition.schemaVersion, details: options.details || {}
      }, error);
      throw error;
    }

    markDatabaseCommittedChange();
    notifyRuntimeDataChanged();
    return {
      strategy: definition.strategy,
      rowsBefore: before,
      rowsIncoming: records.length,
      rowsInserted: inserted,
      rowsUpdated: updated,
      rowsUnchanged: unchanged,
      rowsDeleted: 0,
      rowsAfter: before + inserted
    };
  }

  // Apply recalculation previews with a single SQL transaction. Unlike import
  // UPSERT, this operation may only UPDATE already-present derived fields, and
  // may also atomically replace the companion KPI Source. Source/unknown Full
  // Dataset columns and record keys are never removed.
  function applyRecalculationBatch(changes, companion = null, options = {}) {
    if (!Array.isArray(changes) || !changes.length ||
        changes.some(item => !item || !['itsm_data', 'mobile_brigade_data'].includes(item.id) ||
          !Array.isArray(item.changes) || !item.changes.length) ||
        new Set(changes.map(item => item.id)).size !== changes.length) {
      throw new Error('Recalculation: требуется непустой пакет уникальных ITSM/МБ изменений.');
    }
    const materializer = globalThis.ReclassifierRecalculationMaterializer;
    const itsmSchema = globalThis.ReclassifierItsmDatasetSchema;
    if (!materializer?.validateAndPatch || !itsmSchema?.fields) {
      throw new Error('Recalculation: контракты обновления данных не загружены.');
    }
    if (companion && (!changes.some(item => item.id === 'itsm_data') ||
        companion.id !== 'kpi_source' || !Array.isArray(companion.records))) {
      throw new Error('Recalculation: KPI Source может сопровождать только изменение ITSM.');
    }
    if (changes.some(item => item.id === 'itsm_data') && !companion) {
      throw new Error('Recalculation: ITSM нельзя применять без пересчёта KPI Source.');
    }
    const db = requireOpenDatabase();
    const timestamp = nowIso();
    const batchId = randomId('recalc-');
    const contexts = changes.map(item => {
      const definition = datasetDefinition(item.id, databaseContract.strategy.UPSERT);
      const registry = getDatasetRegistry(item.id);
      const previousState = getDatasetState(item.id);
      const sourceRows = Number(registry?.record_count || 0);
      if (!sourceRows) throw new Error('Recalculation: отсутствует накопленный Dataset ' + item.id + '.');
      const expectedRevision = Number(item.expectedRevision);
      if (!Number.isInteger(expectedRevision) ||
          expectedRevision !== Number(registry?.active_revision || 0)) {
        throw new Error('Recalculation: изменилась ревизия Dataset ' + item.id + '.');
      }
      return { ...item, definition, registry, previousState, sourceRows,
        importId: randomId('import-') };
    });
    const changedIds = new Set(contexts.map(item => item.id));
    const companionContext = companion ? {
      registry: getDatasetRegistry('kpi_source'),
      importId: randomId('import-')
    } : null;
    // Freeze dependency revisions BEFORE any transaction write. Reading the
    // registry after the first Dataset UPDATE would double-count its revision.
    const initialRevisions = new Map();
    for (const item of contexts) {
      initialRevisions.set(item.id, Number(item.registry.active_revision || 0));
      for (const dep of item.definition.dependencies || []) {
        if (!initialRevisions.has(dep)) {
          initialRevisions.set(dep, Number(getDatasetRegistry(dep)?.active_revision || 0));
        }
      }
    }
    const nextRevision = id => {
      if (!initialRevisions.has(id)) {
        initialRevisions.set(id, Number(getDatasetRegistry(id)?.active_revision || 0));
      }
      return initialRevisions.get(id) + (changedIds.has(id) ? 1 : 0);
    };
    const revisionDependencies = id => {
      const result = {};
      for (const dependency of datasetDefinition(id).dependencies || []) {
        result[dependency] = nextRevision(dependency);
      }
      return result;
    };

    const results = [];
    try {
      db.transaction('IMMEDIATE', () => {
        for (const item of contexts) {
          const fields = item.previousState.fields || itsmSchema.fields;
          const fullColumns = item.previousState.fullDataset?.columns || null;
          const lookup = db.prepare(
            'SELECT record_json FROM dataset_records WHERE dataset_id = ? AND record_key = ?'
          );
          const update = db.prepare(
            'UPDATE dataset_records SET record_json = ? WHERE dataset_id = ? AND record_key = ?'
          );
          const fullLookup = db.prepare(
            'SELECT row_json FROM dataset_full_records WHERE dataset_id = ? AND record_key = ?'
          );
          const fullUpdate = db.prepare(
            'UPDATE dataset_full_records SET row_json = ? WHERE dataset_id = ? AND record_key = ?'
          );
          const seen = new Set();
          let updated = 0;
          try {
            for (const change of item.changes) {
              const recordKey = normalizedKey(change?.key);
              if (!recordKey || seen.has(recordKey)) {
                throw new Error('Recalculation: повторный или пустой ключ ' + item.id + '.');
              }
              seen.add(recordKey);
              lookup.bind([item.id, recordKey]);
              const exists = lookup.step();
              const oldJson = exists ? lookup.get(0) : null;
              lookup.reset();
              if (oldJson === null) {
                throw new Error('Recalculation: исходная запись не найдена ' + item.id + '/' + recordKey + '.');
              }
              const oldRow = JSON.parse(oldJson);
              const patched = materializer.validateAndPatch(
                item.id, oldRow, change, fields, itsmSchema
              );
              update.bind([JSON.stringify(patched), item.id, recordKey]).stepReset();
              updated += 1;

              if (Array.isArray(fullColumns)) {
                fullLookup.bind([item.id, recordKey]);
                const foundFull = fullLookup.step();
                const rawFullJson = foundFull ? fullLookup.get(0) : null;
                fullLookup.reset();
                if (rawFullJson !== null) {
                  const sourceFull = JSON.parse(rawFullJson);
                  const nextFull = materializer.projectFullRow(
                    item.id, sourceFull, fullColumns, change.fields, itsmSchema
                  );
                  if (nextFull !== sourceFull) {
                    fullUpdate.bind([JSON.stringify(nextFull), item.id, recordKey]).stepReset();
                  }
                }
              }
            }
          } finally {
            lookup.finalize();
            update.finalize();
            fullLookup.finalize();
            fullUpdate.finalize();
          }
          const state = Object.assign({}, item.previousState, {
            lastRecalculatedAt: timestamp,
            lastRecalculationBatchId: batchId,
            dependencyRevisions: revisionDependencies(item.id),
            recalculationRulesVersion: item.rulesVersion || null
          });
          writeState(db, item.id, state, timestamp);
          const meta = {
            freshnessFrom: item.registry.freshness_from,
            freshnessTo: item.registry.freshness_to,
            sourceFileName: item.registry.source_file_name,
            contentHash: null
          };
          updateRegistry(db, item.id, item.definition, item.sourceRows, meta, timestamp);
          insertImportHistory(db, [
            item.importId, item.id, timestamp, timestamp, meta.sourceFileName, null,
            item.definition.strategy, 'COMMITTED', item.sourceRows, item.changes.length,
            0, updated, item.sourceRows - updated, 0, item.sourceRows,
            String(build.version || 'dev'), databaseContract.currentSchemaVersion,
            item.definition.schemaVersion, 'Recalculation',
            JSON.stringify({
              operation: 'recalculation', batchId, asOfDate: options.asOfDate,
              changedFieldsOnly: true, sourceDataPreserved: true
            })
          ]);
          results.push({ datasetId: item.id, rowsUpdated: updated,
            rowsBefore: item.sourceRows, rowsAfter: item.sourceRows });
        }
        if (companion) {
          const kpistate = Object.assign({}, companion.state || {}, {
            dependencyRevisions: { itsm_data: nextRevision('itsm_data') },
            lastRecalculationBatchId: batchId,
            lastRecalculatedAt: timestamp
          });
          const kpiResult = replaceDatasetInTransaction(db, 'kpi_source',
            companion.records, {
              state: kpistate,
              freshnessFrom: companion.freshnessFrom || null,
              freshnessTo: companion.freshnessTo || null,
              sourceFileName: 'KPI Source · recalculation',
              details: { operation: 'recalculation', batchId },
              message: 'Recalculation KPI Source'
            }, { timestamp, importId: companionContext.importId });
          results.push({ datasetId: 'kpi_source',
            rowsUpdated: kpiResult.rowsIncoming,
            rowsBefore: kpiResult.rowsBefore,
            rowsAfter: kpiResult.rowsAfter });
        }
        touchMetadata(db, timestamp);
      });
    } catch (error) {
      for (const item of contexts) {
        recordFailedImport(db, {
          importId: item.importId, id: item.id, startedAt: timestamp,
          sourceFileName: item.registry.source_file_name,
          strategy: item.definition.strategy, status: 'ROLLED_BACK',
          rowsBefore: item.sourceRows, rowsIncoming: item.changes.length,
          datasetSchemaVersion: item.definition.schemaVersion,
          details: { operation: 'recalculation', batchId }
        }, error);
      }
      throw error;
    }
    markDatabaseCommittedChange();
    notifyRuntimeDataChanged();
    return Object.freeze({
      batchId,
      changedDatasetIds: Object.freeze(results.map(item => item.datasetId)),
      results: Object.freeze(results.map(item => Object.freeze(item)))
    });
  }

  // Async bounded-memory UPSERT for large browser imports. Yielding between
  // batches permits UI progress/cancellation. On any failure or cancellation,
  // all row changes are rolled back before publishing a registry revision.
  // 8. Large asynchronous UPSERT, import history, and database export/save
  async function upsertDatasetAsync(
    id, records, options = {}, onProgress = () => {}, isCancelled = () => false,
    atomicReplacements = []
  ) {
    const definition = datasetDefinition(id, databaseContract.strategy.UPSERT);
    validateDatasetRecords(id, records, definition);
    const db = requireOpenDatabase();
    const before = Number(scalar(
      db, 'SELECT record_count FROM dataset_registry WHERE dataset_id = ?', [id]
    ) || 0);
    const state = getDatasetState(id);
    const meta = datasetWriteMeta(options, { state });
    const keyState = meta.state || state;
    const fullPlan = prepareFullDatasetWrite(id, records, options, state);
    const importId = randomId('import-');
    const startedAt = nowIso();
    const batchSize = 250;
    const totalRows = records.length;
    const replacements = Array.from(atomicReplacements || []);
    const replacementContexts = replacements.map((change, index) => {
      if (!change?.id || !Array.isArray(change.records)) {
        throw new Error('Некорректный атомарный REPLACE в позиции ' + (index + 1) + '.');
      }
      if (change.id === id) {
        throw new Error('Атомарный REPLACE не может повторять основной UPSERT Dataset: ' + id + '.');
      }
      const replacementDefinition = datasetDefinition(
        change.id, databaseContract.strategy.REPLACE
      );
      validateDatasetRecords(change.id, change.records, replacementDefinition);
      return {
        id: change.id,
        records: change.records,
        options: change.options || {},
        definition: replacementDefinition,
        before: Number(scalar(
          db,
          'SELECT record_count FROM dataset_registry WHERE dataset_id = ?',
          [change.id]
        ) || 0),
        importId: randomId('import-'),
        index
      };
    });
    if (new Set(replacementContexts.map(item => item.id)).size !== replacementContexts.length) {
      throw new Error('Атомарный UPSERT/REPLACE пакет содержит повторный Dataset.');
    }
    const atomicBatchId = replacementContexts.length ? randomId('batch-') : null;
    const seen = new Set();
    let inserted = 0;
    let updated = 0;
    let unchanged = 0;
    let processedRows = 0;
    let cancelled = false;
    let atomicResults = [];
    const report = () => onProgress({
      datasetId: id, processedRows, totalRows, inserted, updated, unchanged
    });

    if (isCancelled()) {
      throw new Error('Интеграция отменена до начала записи.');
    }
    db.exec('BEGIN IMMEDIATE');
    try {
      if (fullPlan?.schemaChanged) {
        remapStoredFullDatasetRows(
          db, id, fullPlan.previousColumns, fullPlan.columns
        );
      }

      let nextOrdinal = Number(scalar(
        db, 'SELECT COALESCE(MAX(ordinal), -1) + 1 FROM dataset_records WHERE dataset_id = ?', [id]
      ));
      const lookup = db.prepare(
        'SELECT ordinal, record_json FROM dataset_records WHERE dataset_id = ? AND record_key = ?'
      );
      const write = db.prepare(
        'INSERT INTO dataset_records(dataset_id, record_key, ordinal, record_json) VALUES (?, ?, ?, ?) ' +
        'ON CONFLICT(dataset_id, record_key) DO UPDATE SET record_json = excluded.record_json'
      );
      const fullWrite = fullPlan ? db.prepare(
        'INSERT INTO dataset_full_records(dataset_id, record_key, ordinal, row_json) VALUES (?, ?, ?, ?) ' +
        'ON CONFLICT(dataset_id, record_key) DO UPDATE SET ' +
        'ordinal = excluded.ordinal, row_json = excluded.row_json'
      ) : null;
      try {
        for (let index = 0; index < totalRows; index += 1) {
          const record = records[index];
          const key = normalizedKey(stateFieldValue(record, definition.keyField, keyState));
          if (!key || seen.has(key)) {
            throw new Error((!key ? 'Пустой' : 'Повторный') + ' ключ ' +
              definition.keyField + ' в строке ' + (index + 1) + ' Dataset ' + id + '.');
          }
          seen.add(key);
          const json = JSON.stringify(record);
          lookup.bind([id, key]);
          const exists = lookup.step();
          const oldOrdinal = exists ? Number(lookup.get(0)) : -1;
          const oldJson = exists ? lookup.get(1) : null;
          lookup.reset();

          const ordinal = exists ? oldOrdinal : nextOrdinal++;
          if (exists && oldJson === json) {
            unchanged += 1;
          } else {
            if (exists) updated += 1;
            else inserted += 1;
            write.bind([id, key, ordinal, json]).stepReset();
          }

          if (fullWrite) {
            fullWrite.bind([
              id,
              key,
              ordinal,
              JSON.stringify(fullPlan.rows[index])
            ]).stepReset();
          }

          processedRows = index + 1;
          if (processedRows % batchSize === 0 || processedRows === totalRows) {
            report();
            // A task yield (not only a microtask) is necessary for browser
            // painting and the explicit cancellation button to run.
            await new Promise(resolve => setTimeout(resolve, 0));
            if (isCancelled()) {
              cancelled = true;
              throw new Error('Интеграция прервана пользователем: транзакция отменена.');
            }
          }
        }
      } finally {
        lookup.finalize();
        write.finalize();
        fullWrite?.finalize();
      }
      if (isCancelled()) {
        cancelled = true;
        throw new Error('Интеграция прервана пользователем: транзакция отменена.');
      }
      const timestamp = nowIso();
      const after = before + inserted;
      writeState(
        db,
        id,
        datasetStateForWrite(
          db, id, meta.state, state, fullPlan, after
        ),
        timestamp
      );
      updateRegistry(db, id, definition, after, meta, timestamp);
      touchMetadata(db, timestamp);
      insertImportHistory(db, [
        importId, id, startedAt, timestamp, meta.sourceFileName,
        options.sourceFingerprint || null, definition.strategy, 'COMMITTED',
        before, totalRows, inserted, updated, unchanged, 0, after,
        String(build.version || 'dev'), databaseContract.currentSchemaVersion,
        definition.schemaVersion, options.message || null,
        JSON.stringify(Object.assign({}, options.details || {}, atomicBatchId
          ? { atomicBatchId, atomicRole: 'primary-upsert' }
          : {}))
      ]);

      atomicResults = [];
      for (const context of replacementContexts) {
        atomicResults.push(replaceDatasetInTransaction(
          db,
          context.id,
          context.records,
          context.options,
          {
            timestamp,
            importId: context.importId,
            details: {
              atomicBatchId,
              atomicRole: 'companion-replace',
              atomicBatchIndex: context.index + 2,
              atomicBatchSize: replacementContexts.length + 1
            }
          }
        ));
      }
      db.exec('COMMIT');
    } catch (error) {
      try { db.exec('ROLLBACK'); } catch (_) {}
      recordFailedImport(db, {
        importId, id, startedAt, sourceFileName: meta.sourceFileName,
        sourceFingerprint: options.sourceFingerprint || null,
        strategy: definition.strategy, rowsBefore: before,
        rowsIncoming: totalRows, datasetSchemaVersion: definition.schemaVersion,
        details: Object.assign({}, options.details || {}, atomicBatchId
          ? { atomicBatchId, atomicRole: 'primary-upsert' }
          : {}),
        status: cancelled ? 'ROLLED_BACK' : 'FAILED'
      }, error);
      for (const context of replacementContexts) {
        recordFailedImport(db, {
          importId: context.importId,
          id: context.id,
          startedAt,
          sourceFileName: context.options.sourceFileName || null,
          sourceFingerprint: context.options.sourceFingerprint || null,
          strategy: context.definition.strategy,
          rowsBefore: context.before,
          rowsIncoming: context.records.length,
          datasetSchemaVersion: context.definition.schemaVersion,
          details: Object.assign({}, context.options.details || {}, {
            atomicBatchId,
            atomicRole: 'companion-replace'
          }),
          status: 'ROLLED_BACK'
        }, error);
      }
      throw error;
    }

    markDatabaseCommittedChange();
    notifyRuntimeDataChanged();
    return {
      strategy: definition.strategy, rowsBefore: before, rowsIncoming: totalRows,
      rowsInserted: inserted, rowsUpdated: updated, rowsUnchanged: unchanged,
      rowsDeleted: 0, rowsAfter: before + inserted,
      atomicBatchId,
      atomicResults
    };
  }

  // ============================================================================
// IMPORT AUDIT AND OBSERVABILITY
// ============================================================================
  function getImportOverview() {
    const db = requireOpenDatabase();
    const totals = queryRows(
      db,
      "SELECT COUNT(*) AS attempts, " +
      "SUM(CASE WHEN status = 'COMMITTED' THEN 1 ELSE 0 END) AS committed, " +
      "SUM(CASE WHEN status IN ('FAILED', 'ROLLED_BACK') THEN 1 ELSE 0 END) AS failed, " +
      "MAX(CASE WHEN status = 'COMMITTED' THEN COALESCE(finished_at, started_at) END) AS latest_committed_at, " +
      "MAX(CASE WHEN status IN ('FAILED', 'ROLLED_BACK') THEN COALESCE(finished_at, started_at) END) AS latest_failed_at " +
      "FROM import_history"
    )[0] || {};

    const latestAttemptByDataset = queryRows(
      db,
      "SELECT * FROM (" +
      "SELECT h.*, ROW_NUMBER() OVER (" +
      "PARTITION BY dataset_id ORDER BY started_at DESC, import_id DESC" +
      ") AS _rank FROM import_history h" +
      ") WHERE _rank = 1 ORDER BY dataset_id"
    ).map(row => {
      delete row._rank;
      return row;
    });

    const latestCommittedByDataset = queryRows(
      db,
      "SELECT * FROM (" +
      "SELECT h.*, ROW_NUMBER() OVER (" +
      "PARTITION BY dataset_id ORDER BY started_at DESC, import_id DESC" +
      ") AS _rank FROM import_history h WHERE status = 'COMMITTED'" +
      ") WHERE _rank = 1 ORDER BY dataset_id"
    ).map(row => {
      delete row._rank;
      return row;
    });

    const latestAttempt = queryRows(
      db,
      'SELECT * FROM import_history ORDER BY started_at DESC, import_id DESC LIMIT 1'
    )[0] || null;

    return {
      attempts: Number(totals.attempts || 0),
      committed: Number(totals.committed || 0),
      failed: Number(totals.failed || 0),
      latestCommittedAt: totals.latest_committed_at || null,
      latestFailedAt: totals.latest_failed_at || null,
      latestAttempt,
      latestAttemptByDataset,
      latestCommittedByDataset
    };
  }

  function getImportHistory(id = null, limit = 100) {
    const db = requireOpenDatabase();
    const safeLimit = Math.max(1, Math.min(Number(limit) || 100, 1000));
    if (id) {
      return queryRows(
        db,
        'SELECT * FROM import_history WHERE dataset_id = ? ORDER BY started_at DESC LIMIT ?',
        [id, safeLimit]
      );
    }
    return queryRows(
      db,
      'SELECT * FROM import_history ORDER BY started_at DESC LIMIT ?',
      [safeLimit]
    );
  }

// ============================================================================
// PORTABLE EXPORT AND HANDLE SHUTDOWN
// ============================================================================
  function exportDatabase() {
    const db = requireOpenDatabase();
    const health = runHealthCheck();
    if (!health.ok) {
      throw new Error(
        'Экспорт заблокирован: проверка целостности БД не пройдена. ' +
        health.errors.join(' ')
      );
    }
    const exported = databaseRuntime.sqlite.capi.sqlite3_js_db_export(db);
    const bytes = exported instanceof Uint8Array ? exported : new Uint8Array(exported);
    assertSqliteHeader(bytes);
    return bytes;
  }

  // File System Access handles are granted by an explicit user gesture in
  // Database UI. The Repository mutex stays held for this entire operation:
  // no Dataset write, close or export can interleave with disk persistence.
  async function saveDatabaseToFile(fileHandle, expected = {}, options = {}) {
    requireOpenDatabase();
    const nowMs = () => typeof performance !== 'undefined' && performance.now
      ? performance.now() : Date.now();
    const startedMs = nowMs();
    // Progress callbacks must never influence persistence, mutex release or
    // the dirty flag. They are advisory and contain no database contents.
    const progress = (phase, completedBytes, totalBytes) => {
      if (typeof options.onProgress !== 'function') return;
      try {
        options.onProgress(Object.freeze({
          phase, completedBytes, totalBytes
        }));
      } catch (_) {}
    };
    if (!fileHandle || typeof fileHandle.getFile !== 'function' ||
        typeof fileHandle.createWritable !== 'function') {
      throw new Error('Браузер не предоставил разрешённый для записи дескриптор файла.');
    }
    if (fileHandle.name !== databaseRuntime.sourceFileName) {
      throw new Error('Имя подключённого файла изменилось. Повторно откройте нужную SQLite.');
    }
    if (!Number.isSafeInteger(expected.size) || !Number.isFinite(expected.lastModified)) {
      throw new Error('Отсутствуют исходные данные файла для проверки безопасной перезаписи.');
    }

    const assertUnchanged = async () => {
      const current = await fileHandle.getFile();
      if (current.size !== expected.size || current.lastModified !== expected.lastModified) {
        throw new Error(
          'Файл на диске изменился после подключения. Перезапись запрещена. ' +
          'Сохраните текущую SQLite через «Скачать Reclassifier.db» и проверьте другую копию.'
        );
      }
    };
    await assertUnchanged();
    progress('exporting', 0, 0);
    const exportStartMs = nowMs();
    const bytes = exportDatabase(); // integrity checked BEFORE touching the disk file
    const exportMs = nowMs() - exportStartMs;
    await assertUnchanged(); // detect changes while SQLite was being exported

    let writable = null;
    let closed = false;
    let closeAttempted = false;
    const invalidateFileConfirmation = () => {
      // After a close attempt (or a failed disk readback), the original OS
      // path may no longer contain the revision we previously verified.
      databaseRuntime.verifiedFileRevision = null;
      databaseRuntime.verifiedFileAt = null;
      databaseRuntime.dirty = true;
    };
    const writeStartMs = nowMs();
    progress('writing', 0, bytes.byteLength);
    try {
      writable = await fileHandle.createWritable({ mode: 'exclusive' });
      const chunkSize = 4 * 1024 * 1024;
      for (let offset = 0; offset < bytes.byteLength; offset += chunkSize) {
        const end = Math.min(offset + chunkSize, bytes.byteLength);
        await writable.write(bytes.subarray(offset, end));
        progress('writing', end, bytes.byteLength);
      }
      closeAttempted = true;
      await writable.close(); // File System Access normally swaps a temporary file here
      closed = true;
    } catch (error) {
      if (writable && !closed) {
        try { await writable.abort(); } catch (_) {}
      }
      if (closeAttempted) invalidateFileConfirmation();
      throw error;
    }
    const writeMs = nowMs() - writeStartMs;

    // Re-read the actual disk file in bounded chunks, without allocating a
    // second several-hundred-MB copy. A successful close alone is not proof.
    const verifyStartMs = nowMs();
    progress('verifying', 0, bytes.byteLength);
    let saved;
    let verifyMs;
    try {
      saved = await fileHandle.getFile();
      if (saved.size !== bytes.byteLength) {
        throw new Error('Размер сохранённого файла не совпадает с размером SQLite. Проверьте файл.');
      }
      const verifyChunk = 4 * 1024 * 1024;
      for (let offset = 0; offset < bytes.byteLength; offset += verifyChunk) {
        const end = Math.min(offset + verifyChunk, bytes.byteLength);
        const diskPart = new Uint8Array(await saved.slice(offset, end).arrayBuffer());
        const originalPart = bytes.subarray(offset, end);
        if (diskPart.length !== originalPart.length) {
          throw new Error('Проверка сохранённого файла не пройдена: неполный блок.');
        }
        for (let i = 0; i < originalPart.length; i += 1) {
          if (diskPart[i] !== originalPart[i]) {
            throw new Error('Проверка сохранённого файла не пройдена: обнаружено несовпадение байтов.');
          }
        }
        progress('verifying', end, bytes.byteLength);
      }
      verifyMs = nowMs() - verifyStartMs;
    } catch (error) {
      invalidateFileConfirmation();
      throw error;
    }
    // Repository operations were blocked by the mutex throughout export,
    // write and verification; the in-memory SQLite is the exact saved revision.
    databaseRuntime.verifiedFileRevision = databaseRuntime.workingRevision;
    databaseRuntime.verifiedFileAt = nowIso();
    databaseRuntime.dirty = false;
    const timing = Object.freeze({
      exportMs: Math.max(0, exportMs),
      writeMs: Math.max(0, writeMs),
      verifyMs: Math.max(0, verifyMs),
      totalMs: Math.max(0, nowMs() - startedMs)
    });
    progress('complete', saved.size, saved.size);
    return Object.freeze({
      timing,
      verifiedRevision: databaseRuntime.verifiedFileRevision,
      fileName: saved.name || fileHandle.name,
      size: saved.size,
      lastModified: saved.lastModified,
      verifiedBytes: saved.size,
      verifiedAt: databaseRuntime.verifiedFileAt
    });
  }

  function downloadDatabase(fileName = null) {
    const bytes = exportDatabase();
    const blob = new Blob([bytes], { type: 'application/x-sqlite3' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = fileName || databaseRuntime.sourceFileName || 'Reclassifier.db';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    databaseRuntime.downloadRequestedRevision = databaseRuntime.workingRevision;
    databaseRuntime.downloadRequestedAt = nowIso();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    // A browser click is NOT confirmation that the OS saved the file.
    // Keep the unsaved-changes guard until the session is closed or a
    // separately confirmed persistence mechanism exists.
    return bytes.byteLength;
  }

  function closeDatabase() {
    closeHandle({ removeFile: true });
    notifyRuntimeDataChanged();
  }

  // The public Repository boundary is the mutex boundary. Internal helpers call
  // one another directly, so nested work inside one operation does not deadlock.
  // Async operations hold the mutex across event-loop yields. Any concurrent
  // public operation fails fast with RECLASSIFIER_DATABASE_BUSY instead of
  // observing an uncommitted transaction or closing/replacing the active handle.
  // Mobile Brigade staging is TEMP-only: it never changes the authoritative
  // Dataset until the explicit "Применить данные" transaction.
  // It reduces JS allocations; the SQLite WASM heap still has finite limits.
  let mobileStage = null;

  // 9. Staged Mobile Brigade batch lifecycle
  function assertMobileStage(id, requireFinalized = false) {
    const db = requireOpenDatabase();
    if (!mobileStage || id !== mobileStage.id || mobileStage.db !== db) {
      throw new Error('Временная партия МБ устарела или база была заменена.');
    }
    if (requireFinalized && !mobileStage.finalized) {
      throw new Error('Подготовка МБ ещё не завершена.');
    }
    return db;
  }

  function discardMobileBrigadeStage(id = null) {
    if (!mobileStage) return false;
    if (id && id !== mobileStage.id) return false;
    const db = mobileStage.db;
    mobileStage = null;
    try { db.exec('DROP TABLE IF EXISTS temp.mb_processing_stage'); } catch (_) {}
    return true;
  }

  function beginMobileBrigadeStage(batchSize = 5000) {
    if (!Number.isInteger(batchSize) || batchSize < 500 || batchSize > 10000) {
      throw new Error('Размер пакета МБ должен быть от 500 до 10000 строк.');
    }
    const db = requireOpenDatabase();
    if (databaseRuntime.readOnly) throw new Error('SQLite открыта только для чтения.');
    discardMobileBrigadeStage();
    db.exec('CREATE TEMP TABLE mb_processing_stage (' +
      'seq INTEGER PRIMARY KEY, raw_key TEXT NOT NULL, record_json TEXT NOT NULL, ' +
      'row_json TEXT NOT NULL)');
    const registry = getDatasetRegistry('mobile_brigade_data');
    mobileStage = {
      id: randomId('mb-stage-'), db,
      baseRevision: Number(registry.active_revision || 0),
      count: 0, sequence: 0, batchSize, finalized: false, summary: null
    };
    return Object.freeze({ id: mobileStage.id, baseRevision: mobileStage.baseRevision, batchSize });
  }

  function appendMobileBrigadeStage(id, sequence, batch) {
    const db = assertMobileStage(id);
    if (mobileStage.finalized) throw new Error('Партия МБ уже завершена.');
    if (!Number.isInteger(sequence) || sequence !== mobileStage.sequence + 1 ||
        !Array.isArray(batch) || !batch.length || batch.length > mobileStage.batchSize) {
      throw new Error('Неверная последовательность или размер пакета МБ.');
    }
    const width = globalThis.ReclassifierMobileBrigadeRules?.outputColumns?.length || 38;
    db.transaction('IMMEDIATE', () => {
      const stmt = db.prepare(
        'INSERT INTO temp.mb_processing_stage(seq, raw_key, record_json, row_json) VALUES (?, ?, ?, ?)'
      );
      try {
        batch.forEach((item, index) => {
          if (!item?.record || !Array.isArray(item.row) || item.row.length !== width) {
            throw new Error('Некорректная строка МБ в пакете ' + sequence + '.');
          }
          const key = normalizedKey(item.record.recordKey);
          stmt.bind([mobileStage.count + index + 1, key,
            JSON.stringify(item.record), JSON.stringify(item.row)]).stepReset();
        });
      } finally { stmt.finalize(); }
    });
    mobileStage.count += batch.length;
    mobileStage.sequence = sequence;
    return Object.freeze({ rows: mobileStage.count, batches: mobileStage.sequence });
  }

  function finalizeMobileBrigadeStage(id, summary) {
    const db = assertMobileStage(id);
    if (mobileStage.finalized) throw new Error('Партия уже завершена.');
    if (!mobileStage.count || Number(summary?.stats?.rows) !== mobileStage.count) {
      throw new Error('Количество принятых строк МБ не совпадает с результатом Worker.');
    }
    const reservedKeys = new Set();
    const initial = db.prepare('SELECT raw_key FROM temp.mb_processing_stage ORDER BY seq');
    try { while (initial.step()) {
      const key = initial.get(0);
      if (key) reservedKeys.add(key);
    } } finally { initial.finalize(); }
    const usedKeys = new Set();
    const duplicateOrdinals = new Map();
    const taskNumberColumn = globalThis.ReclassifierMobileBrigadeRules.outputColumns.indexOf('Номер задачи');
    if (taskNumberColumn < 0) throw new Error('Не найдена колонка «Номер задачи».');
    let duplicates = 0, missingKeys = 0;
    db.transaction('IMMEDIATE', () => {
      const select = db.prepare(
        'SELECT seq, raw_key, record_json, row_json FROM temp.mb_processing_stage ORDER BY seq'
      );
      const update = db.prepare(
        'UPDATE temp.mb_processing_stage SET raw_key=?, record_json=?, row_json=? WHERE seq=?'
      );
      try {
        while (select.step()) {
          const seq = Number(select.get(0));
          const key = select.get(1);
          if (!key) { missingKeys++; continue; }
          if (!usedKeys.has(key)) { usedKeys.add(key); continue; }
          duplicates++;
          const record = JSON.parse(select.get(2));
          const row = JSON.parse(select.get(3));
          let ordinal = duplicateOrdinals.get(key) || 0;
          let proposal, newTask;
          do {
            ordinal++;
            newTask = String(record.taskNumber ?? '').replace(/\u00a0/g, ' ')
              .replace(/\s+/g, ' ').trim() + '-D' + ordinal;
            proposal = key + '-d' + ordinal;
          } while (reservedKeys.has(proposal) || usedKeys.has(proposal));
          duplicateOrdinals.set(key, ordinal);
          record.recordKey = proposal;
          record.taskNumber = newTask;
          row[taskNumberColumn] = newTask;
          usedKeys.add(proposal);
          update.bind([proposal, JSON.stringify(record), JSON.stringify(row), seq]).stepReset();
        }
      } finally { select.finalize(); update.finalize(); }
    });
    mobileStage.summary = summary;
    mobileStage.finalized = true;
    mobileStage.duplicateRecordKeys = duplicates;
    mobileStage.rowsWithoutRecordKey = missingKeys;
    return previewMobileBrigadeStage(id);
  }


  function getMobileBrigadeStageRows(id) {
    // This opt-in export deliberately materializes rows only when requested.
    const db = assertMobileStage(id, true);
    const stmt = db.prepare('SELECT row_json FROM temp.mb_processing_stage ORDER BY seq');
    const rows = [];
    try { while (stmt.step()) rows.push(JSON.parse(stmt.get(0))); }
    finally { stmt.finalize(); }
    return {
      columns: Array.from(globalThis.ReclassifierMobileBrigadeRules.outputColumns),
      rows
    };
  }

  function getMobileBrigadeItsmLinks() {
    const db = requireOpenDatabase();
    const registry = getDatasetRegistry('itsm_data');
    if (Number(registry.active_revision || 0) === 0) return [];
    const state = getDatasetState('itsm_data');
    const fields = Array.isArray(state.fields) ? state.fields :
      (globalThis.ReclassifierItsmDatasetSchema?.fields || []);
    const numberIndex = fields.indexOf('number');
    const createdIndex = fields.indexOf('createdAt');
    if (numberIndex < 0 || createdIndex < 0) {
      throw new Error('В SQLite ITSM не найдены поля number/createdAt.');
    }
    const stmt = db.prepare(
      "SELECT record_json FROM dataset_records WHERE dataset_id='itsm_data' ORDER BY ordinal"
    );
    const rows = [];
    try {
      while (stmt.step()) {
        const record = JSON.parse(stmt.get(0));
        const number = Array.isArray(record) ? record[numberIndex] : record?.number;
        const createdAt = Array.isArray(record) ? record[createdIndex] : record?.createdAt;
        if (number) rows.push({number,createdAt});
      }
    } finally { stmt.finalize(); }
    return rows;
  }

  function previewMobileBrigadeStage(id) {
    const db = assertMobileStage(id, true);
    const previous = getDatasetRegistry('mobile_brigade_data');
    if (Number(previous.active_revision || 0) !== mobileStage.baseRevision) {
      throw new Error('Рабочий Dataset МБ изменился после начала подготовки.');
    }
    const stats = queryRows(db,
      'SELECT COUNT(*) AS incoming, ' +
      'SUM(CASE WHEN d.record_key IS NULL THEN 1 ELSE 0 END) AS inserted, ' +
      'SUM(CASE WHEN d.record_key IS NOT NULL THEN 1 ELSE 0 END) AS existing ' +
      'FROM temp.mb_processing_stage s LEFT JOIN dataset_records d ' +
      "ON d.dataset_id = 'mobile_brigade_data' AND d.record_key = s.raw_key"
    )[0];
    return Object.freeze({
      id, rowsIncoming: Number(stats.incoming || 0),
      rowsInserted: Number(stats.inserted || 0),
      rowsMatched: Number(stats.existing || 0),
      rowsBefore: Number(previous.record_count || 0),
      rowsAfter: Number(previous.record_count || 0) + Number(stats.inserted || 0),
      duplicateRecordKeys: mobileStage.duplicateRecordKeys,
      rowsWithoutRecordKey: mobileStage.rowsWithoutRecordKey,
      rulesVersion: mobileStage.summary?.rulesVersion || null
    });
  }

  async function commitMobileBrigadeStage(id, onProgress = () => {}) {
    const db = assertMobileStage(id, true);
    const preview = previewMobileBrigadeStage(id);
    if (preview.rowsWithoutRecordKey) {
      throw new Error('В подготовленных МБ есть записи без recordKey: ' +
        preview.rowsWithoutRecordKey + '. Применение запрещено.');
    }
    const datasetId = 'mobile_brigade_data';
    const def = datasetDefinition(datasetId, databaseContract.strategy.UPSERT);
    const previousState = getDatasetState(datasetId);
    const oldFull = previousState.fullDataset || {};
    const columns = Array.from(globalThis.ReclassifierMobileBrigadeRules.outputColumns);
    const previousColumns = Array.isArray(oldFull.columns) ? oldFull.columns : [];
    // Existing aligned columns must be preserved. A cross-schema migration
    // requires a separate streaming remapper rather than a full JS load.
    if (previousColumns.length && (
        previousColumns.length !== columns.length ||
        previousColumns.some((column, i) => column !== columns[i]))) {
      throw new Error('Схема Full Dataset МБ в SQLite отличается от 38 колонок. ' +
        'Пакетное применение требует миграции схемы без загрузки истории в память.');
    }
    const summary = mobileStage.summary;
    const registry = getDatasetRegistry(datasetId);
    const from = fullDatasetDateMin(registry.freshness_from,
      summary?.freshnessMin);
    const to = fullDatasetDateMax(registry.freshness_to,
      summary?.freshnessMax);
    const state = Object.assign({}, previousState, {
      sourceFreshness: [...(previousState.sourceFreshness || []), ...(summary.sourceFreshness || [])],
      freshnessByScope: Object.assign({}, previousState.freshnessByScope || {},
        Object.fromEntries(Object.entries(summary.freshnessByScope || {}).map(([k,v]) =>
          [k, fullDatasetDateMax(previousState.freshnessByScope?.[k], v)]))),
      sourceFiles: [...new Set([...(previousState.sourceFiles || []),
        ...(summary.sourceFreshness || []).map(value => value.fileName).filter(Boolean)])],
      lastImportedRulesVersion: summary.rulesVersion,
      earliestSourceDate: from, latestSourceDate: to
    });
    const meta = datasetWriteMeta({
      state, freshnessFrom: from, freshnessTo: to,
      sourceFileName: 'Мобильные бригады · пакетная обработка'
    });
    const fullPlan = {
      meta: {
        schemaVersion:'1.0.0', package:'mobile-brigade-full-dataset',
        aggregation:'per-task-row', fieldCount: columns.length, columns,
        sourceRows: summary.stats.rows, storedSourceRows: summary.stats.rows,
        earliestSourceDate: from, latestSourceDate: to
      }
    };
    let inserted = 0, updated = 0, unchanged = 0;
    let nextOrdinal = Number(scalar(db,
      'SELECT COALESCE(MAX(ordinal), -1) + 1 FROM dataset_records WHERE dataset_id = ?',
      [datasetId]));
    const timestamp = nowIso();
    const importId = randomId('import-');
    db.exec('BEGIN IMMEDIATE');
    try {
      const select = db.prepare(
        'SELECT raw_key, record_json, row_json FROM temp.mb_processing_stage ORDER BY seq'
      );
      const lookup = db.prepare(
        'SELECT ordinal, record_json FROM dataset_records WHERE dataset_id = ? AND record_key = ?'
      );
      const write = db.prepare(
        'INSERT INTO dataset_records(dataset_id,record_key,ordinal,record_json) VALUES (?,?,?,?) ' +
        'ON CONFLICT(dataset_id,record_key) DO UPDATE SET record_json=excluded.record_json'
      );
      const fullWrite = db.prepare(
        'INSERT INTO dataset_full_records(dataset_id,record_key,ordinal,row_json) VALUES (?,?,?,?) ' +
        'ON CONFLICT(dataset_id,record_key) DO UPDATE SET ' +
        'ordinal=excluded.ordinal,row_json=excluded.row_json'
      );
      let completed = 0;
      try {
        while (select.step()) {
          const key = select.get(0), recordJson = select.get(1), rowJson = select.get(2);
          if (!key) throw new Error('Отсутствует recordKey.');
          lookup.bind([datasetId,key]);
          const exists = lookup.step();
          const oldOrdinal = exists ? Number(lookup.get(0)) : -1;
          const oldJson = exists ? lookup.get(1) : null;
          lookup.reset();
          const ordinal = exists ? oldOrdinal : nextOrdinal++;
          if (exists && oldJson === recordJson) unchanged++;
          else {
            if (exists) updated++; else inserted++;
            write.bind([datasetId,key,ordinal,recordJson]).stepReset();
          }
          fullWrite.bind([datasetId,key,ordinal,rowJson]).stepReset();
          completed++;
          if (completed % 1000 === 0) {
            onProgress({processedRows:completed,totalRows:preview.rowsIncoming});
            await new Promise(resolve => setTimeout(resolve,0));
            if (mobileStage?.id !== id) throw new Error('Партия МБ была отменена.');
          }
        }
      } finally {
        select.finalize(); lookup.finalize(); write.finalize(); fullWrite.finalize();
      }
      const after = preview.rowsBefore + inserted;
      state.sourceRows = after;
      state.normalizedRows = after;
      writeState(db, datasetId,
        datasetStateForWrite(db,datasetId,state,previousState,fullPlan,after),timestamp);
      updateRegistry(db,datasetId,def,after,meta,timestamp);
      touchMetadata(db,timestamp);
      insertImportHistory(db,[
        importId,datasetId,timestamp,timestamp,meta.sourceFileName,null,
        def.strategy,'COMMITTED',preview.rowsBefore,preview.rowsIncoming,
        inserted,updated,unchanged,0,after,String(build.version||'dev'),
        databaseContract.currentSchemaVersion,def.schemaVersion,
        'SQLite staged Mobile Brigade processing',
        JSON.stringify({batchProcessing:true,duplicates:preview.duplicateRecordKeys})
      ]);
      db.exec('COMMIT');
    } catch(error) {
      try { db.exec('ROLLBACK'); } catch (_) {}
      throw error;
    }
    markDatabaseCommittedChange();
    notifyRuntimeDataChanged();
    discardMobileBrigadeStage(id);
    return Object.freeze({
      rowsBefore:preview.rowsBefore,rowsIncoming:preview.rowsIncoming,
      rowsInserted:inserted,rowsUpdated:updated,rowsUnchanged:unchanged,
      rowsAfter:preview.rowsBefore+inserted
    });
  }

  // 10. Public Repository API and contract completeness check
  const databaseRepository = Object.freeze({
    initialize: databaseAsyncOperation('initialize', initializeSqlite),
    openDatabase: databaseAsyncOperation('openDatabase', openDatabase),
    createDatabase: databaseAsyncOperation('createDatabase', createDatabase),
    bootstrapDatasets: databaseAsyncOperation('bootstrapDatasets', bootstrapDatasets),
    validateDatabase: databaseSyncOperation('validateDatabase', validateDatabase),
    runHealthCheck: databaseSyncOperation('runHealthCheck', runHealthCheck),
    getCompatibility: databaseSyncOperation('getCompatibility', getCompatibility),
    migrateDatabase: databaseSyncOperation('migrateDatabase', migrateDatabase),
    getDatabaseInfo: databaseSyncOperation('getDatabaseInfo', getDatabaseInfo),
    getDiagnosticMemorySnapshot,
    hasOpenDatabase,
    getOperationState: databaseOperationState,
    listDatasets: databaseSyncOperation('listDatasets', listDatasets),
    getDatasetRegistry: databaseSyncOperation('getDatasetRegistry', getDatasetRegistry),
    getDatasetState: databaseSyncOperation('getDatasetState', getDatasetState),
    beginMobileBrigadeStage: databaseSyncOperation('beginMobileBrigadeStage', beginMobileBrigadeStage),
    appendMobileBrigadeStage: databaseSyncOperation('appendMobileBrigadeStage', appendMobileBrigadeStage),
    finalizeMobileBrigadeStage: databaseSyncOperation('finalizeMobileBrigadeStage', finalizeMobileBrigadeStage),
    previewMobileBrigadeStage: databaseSyncOperation('previewMobileBrigadeStage', previewMobileBrigadeStage),
    getMobileBrigadeStageRows: databaseSyncOperation('getMobileBrigadeStageRows', getMobileBrigadeStageRows),
    getMobileBrigadeItsmLinks: databaseSyncOperation('getMobileBrigadeItsmLinks', getMobileBrigadeItsmLinks),
    commitMobileBrigadeStage: databaseAsyncOperation('commitMobileBrigadeStage', commitMobileBrigadeStage),
    discardMobileBrigadeStage: databaseSyncOperation('discardMobileBrigadeStage', discardMobileBrigadeStage),
    setReportingCoverage: databaseSyncOperation('setReportingCoverage', setReportingCoverage),
    getMobileBrigadeExportInfo: databaseSyncOperation(
      'getMobileBrigadeExportInfo', getMobileBrigadeExportInfo
    ),
    getMobileBrigadeExportPage: databaseSyncOperation(
      'getMobileBrigadeExportPage', getMobileBrigadeExportPage
    ),
    getMobileBrigadeRowsForRequests: databaseSyncOperation(
      'getMobileBrigadeRowsForRequests', getMobileBrigadeRowsForRequests
    ),
    getItsmMobileBrigadeLinkRows: databaseSyncOperation(
      'getItsmMobileBrigadeLinkRows', getItsmMobileBrigadeLinkRows
    ),
    getDataset: databaseSyncOperation('getDataset', getDataset),
    getKpiDataset: databaseSyncOperation('getKpiDataset', getKpiDataset),
    getDatasetFullRows: databaseSyncOperation('getDatasetFullRows', getDatasetFullRows),
    getKpiSnapshot: databaseSyncOperation('getKpiSnapshot', getKpiSnapshot),
    putKpiSnapshot: databaseSyncOperation('putKpiSnapshot', putKpiSnapshot),
    getKpiSnapshotStats: databaseSyncOperation('getKpiSnapshotStats', getKpiSnapshotStats),
    previewDatasetChange: databaseSyncOperation('previewDatasetChange', previewDatasetChange),
    replaceDataset: databaseSyncOperation('replaceDataset', replaceDataset),
    replaceDatasetBatch: databaseSyncOperation('replaceDatasetBatch', replaceDatasetBatch),
    upsertDataset: databaseSyncOperation('upsertDataset', upsertDataset),
    applyRecalculationBatch: databaseSyncOperation('applyRecalculationBatch', applyRecalculationBatch),
    upsertDatasetAsync: databaseAsyncOperation('upsertDatasetAsync', upsertDatasetAsync),
    getImportOverview: databaseSyncOperation('getImportOverview', getImportOverview),
    getImportHistory: databaseSyncOperation('getImportHistory', getImportHistory),
    exportDatabase: databaseSyncOperation('exportDatabase', exportDatabase),
    saveDatabaseToFile: databaseAsyncOperation('saveDatabaseToFile', saveDatabaseToFile),
    downloadDatabase: databaseSyncOperation('downloadDatabase', downloadDatabase),
    closeDatabase: databaseSyncOperation('closeDatabase', closeDatabase)
  });

  for (const method of databaseContract.repositoryApi) {
    if (typeof databaseRepository[method] !== 'function') {
      throw new Error('Repository API не реализован: ' + method);
    }
  }

  globalThis.ReclassifierDatabaseRepository = databaseRepository;
