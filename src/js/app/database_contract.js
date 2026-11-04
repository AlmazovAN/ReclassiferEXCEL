(() => {
  'use strict';

  const APPLICATION_ID = 0x52434c46; // "RCLF"
  const DATABASE_TYPE = 'reclassifier-sqlite';
  const CURRENT_SCHEMA_VERSION = 5;
  const MIN_SUPPORTED_SCHEMA_VERSION = 1;

  const datasetCatalog = globalThis.ReclassifierDatasetCatalog;
  if (!datasetCatalog?.list || !datasetCatalog?.strategy) {
    throw new Error('Dataset Catalog is not loaded before Database Contract.');
  }

  const STRATEGY = datasetCatalog.strategy;
  const DATASETS = Object.freeze(Object.fromEntries(
    datasetCatalog.list().map(definition => [
      definition.id,
      Object.freeze({
        title: definition.databaseTitle,
        kind: definition.kind,
        schemaVersion: definition.schemaVersion,
        strategy: definition.strategy,
        persisted: definition.persisted,
        allowEmpty: definition.allowEmpty,
        keyField: definition.keyField,
        partitionField: definition.partitionField,
        dependencies: definition.dependencies
      })
    ])
  ));

  const SYSTEM_TABLES_V1 = Object.freeze([
    'app_metadata',
    'dataset_registry',
    'dataset_records',
    'dataset_state',
    'import_history',
    'schema_migrations'
  ]);

  const SYSTEM_TABLES_V4 = Object.freeze([
    ...SYSTEM_TABLES_V1,
    'dataset_full_records'
  ]);
  const SYSTEM_TABLES = Object.freeze([
    ...SYSTEM_TABLES_V4,
    'kpi_snapshots'
  ]);

  const SCHEMA_V1_SQL = `
PRAGMA foreign_keys = ON;
PRAGMA application_id = ${APPLICATION_ID};
PRAGMA user_version = 1;

CREATE TABLE IF NOT EXISTS app_metadata (
  singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
  database_uuid TEXT NOT NULL UNIQUE,
  database_type TEXT NOT NULL,
  schema_version INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  created_by_app_version TEXT NOT NULL,
  last_written_by_app_version TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS dataset_registry (
  dataset_id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  kind TEXT NOT NULL,
  dataset_schema_version TEXT NOT NULL,
  integration_strategy TEXT NOT NULL CHECK (integration_strategy IN ('UPSERT', 'REPLACE', 'DERIVED')),
  key_field TEXT,
  allow_empty INTEGER NOT NULL DEFAULT 0 CHECK (allow_empty IN (0, 1)),
  persisted INTEGER NOT NULL DEFAULT 1 CHECK (persisted IN (0, 1)),
  active_revision INTEGER NOT NULL DEFAULT 0,
  record_count INTEGER NOT NULL DEFAULT 0,
  freshness_from TEXT,
  freshness_to TEXT,
  source_file_name TEXT,
  content_hash TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS dataset_records (
  dataset_id TEXT NOT NULL,
  record_key TEXT NOT NULL,
  ordinal INTEGER NOT NULL,
  record_json TEXT NOT NULL CHECK (json_valid(record_json)),
  PRIMARY KEY (dataset_id, record_key),
  FOREIGN KEY (dataset_id) REFERENCES dataset_registry(dataset_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_dataset_records_order
  ON dataset_records(dataset_id, ordinal);

CREATE TABLE IF NOT EXISTS dataset_state (
  dataset_id TEXT PRIMARY KEY,
  state_json TEXT NOT NULL CHECK (json_valid(state_json)),
  updated_at TEXT NOT NULL,
  FOREIGN KEY (dataset_id) REFERENCES dataset_registry(dataset_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS import_history (
  import_id TEXT PRIMARY KEY,
  dataset_id TEXT NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  source_file_name TEXT,
  source_fingerprint TEXT,
  integration_strategy TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('STARTED', 'COMMITTED', 'ROLLED_BACK', 'FAILED')),
  rows_before INTEGER,
  rows_incoming INTEGER,
  rows_inserted INTEGER,
  rows_updated INTEGER,
  rows_unchanged INTEGER,
  rows_deleted INTEGER,
  rows_after INTEGER,
  app_version TEXT NOT NULL,
  db_schema_version INTEGER NOT NULL,
  dataset_schema_version TEXT NOT NULL,
  message TEXT,
  details_json TEXT CHECK (details_json IS NULL OR json_valid(details_json)),
  FOREIGN KEY (dataset_id) REFERENCES dataset_registry(dataset_id)
);

CREATE INDEX IF NOT EXISTS idx_import_history_dataset
  ON import_history(dataset_id, started_at DESC);

CREATE TABLE IF NOT EXISTS schema_migrations (
  migration_id TEXT PRIMARY KEY,
  from_version INTEGER NOT NULL,
  to_version INTEGER NOT NULL,
  applied_at TEXT NOT NULL,
  app_version TEXT NOT NULL,
  checksum TEXT
);
`.trim();

  const FULL_DATASET_STORAGE_SQL = `
CREATE TABLE IF NOT EXISTS dataset_full_records (
  dataset_id TEXT NOT NULL,
  record_key TEXT NOT NULL,
  ordinal INTEGER NOT NULL,
  row_json TEXT NOT NULL CHECK (json_valid(row_json)),
  PRIMARY KEY (dataset_id, record_key),
  FOREIGN KEY (dataset_id) REFERENCES dataset_registry(dataset_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_dataset_full_records_order
  ON dataset_full_records(dataset_id, ordinal);
`.trim();

  const SCHEMA_V2_SQL = (
    SCHEMA_V1_SQL +
    '\n\n' + FULL_DATASET_STORAGE_SQL +
    '\n\nPRAGMA user_version = 2;'
  ).trim();

  const MIGRATION_1_TO_2_SQL = (
    FULL_DATASET_STORAGE_SQL +
    '\n\nPRAGMA user_version = 2;'
  ).trim();

  const SCHEMA_V3_SQL = (
    SCHEMA_V2_SQL +
    '\n\nPRAGMA user_version = 3;'
  ).trim();

  const SCHEMA_V4_SQL = (SCHEMA_V3_SQL + '\n\nPRAGMA user_version = 4;').trim();
  const MIGRATION_3_TO_4_SQL = 'PRAGMA user_version = 4;';

  // PR5: bounded, versioned materialized Report Snapshots (never Dataset facts).
  // A cache entry is replaceable; no FK to Dataset or audit records.
  const KPI_SNAPSHOT_STORAGE_SQL = `
CREATE TABLE IF NOT EXISTS kpi_snapshots (
  cache_key TEXT PRIMARY KEY,
  source_signature TEXT NOT NULL,
  source_revisions_json TEXT NOT NULL CHECK (json_valid(source_revisions_json)),
  methodology_version TEXT NOT NULL,
  snapshot_schema_version TEXT NOT NULL,
  payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
  payload_checksum TEXT NOT NULL,
  calculated_at TEXT NOT NULL,
  stored_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_kpi_snapshots_stored
  ON kpi_snapshots(stored_at DESC);
`.trim();
  const SCHEMA_V5_SQL = (SCHEMA_V4_SQL + '\n\n' +
    KPI_SNAPSHOT_STORAGE_SQL + '\n\nPRAGMA user_version = 5;').trim();
  const MIGRATION_4_TO_5_SQL = (KPI_SNAPSHOT_STORAGE_SQL +
    '\n\nPRAGMA user_version = 5;').trim();

  // Dataset Registry v3 adds KPI Source as a persisted Dataset. The registry
  // row itself is inserted by database_core during migration because its
  // values come from the live Dataset Catalog contract.
  const MIGRATION_2_TO_3_SQL = 'PRAGMA user_version = 3;';

  function compatibility(schemaVersion) {
    const value = Number(schemaVersion);
    if (!Number.isInteger(value) || value < 0) {
      return Object.freeze({ status: 'invalid', writable: false, migrationRequired: false });
    }
    if (value > CURRENT_SCHEMA_VERSION) {
      return Object.freeze({ status: 'newer-than-app', writable: false, migrationRequired: false });
    }
    if (value < MIN_SUPPORTED_SCHEMA_VERSION) {
      return Object.freeze({ status: 'too-old', writable: false, migrationRequired: false });
    }
    if (value < CURRENT_SCHEMA_VERSION) {
      return Object.freeze({ status: 'migration-required', writable: false, migrationRequired: true });
    }
    return Object.freeze({ status: 'current', writable: true, migrationRequired: false });
  }

  const REPOSITORY_API = Object.freeze([
    'openDatabase',
    'createDatabase',
    'bootstrapDatasets',
    'validateDatabase',
    'runHealthCheck',
    'getCompatibility',
    'migrateDatabase',
    'getDatabaseInfo',
    'hasOpenDatabase',
    'getOperationState',
    'listDatasets',
    'getDatasetRegistry',
    'getDatasetState',
    'setReportingCoverage',
    'getMobileBrigadeRowsForRequests',
    'getMobileBrigadeExportInfo',
    'getMobileBrigadeExportPage',
    'getItsmMobileBrigadeLinkRows',
    'getDataset',
    'getKpiDataset',
    'getDatasetFullRows',
    'getKpiSnapshot',
    'putKpiSnapshot',
    'getKpiSnapshotStats',
    'previewDatasetChange',
    'replaceDataset',
    'replaceDatasetBatch',
    'upsertDataset',
    'upsertDatasetAsync',
    'getImportOverview',
    'getImportHistory',
    'exportDatabase',
    'closeDatabase'
  ]);

  globalThis.ReclassifierDatabaseContract = Object.freeze({
    applicationId: APPLICATION_ID,
    databaseType: DATABASE_TYPE,
    currentSchemaVersion: CURRENT_SCHEMA_VERSION,
    minSupportedSchemaVersion: MIN_SUPPORTED_SCHEMA_VERSION,
    strategy: STRATEGY,
    datasets: DATASETS,
    systemTables: SYSTEM_TABLES,
    systemTablesV1: SYSTEM_TABLES_V1,
    systemTablesV4: SYSTEM_TABLES_V4,
    schemaV1Sql: SCHEMA_V1_SQL,
    schemaV2Sql: SCHEMA_V2_SQL,
    schemaV3Sql: SCHEMA_V3_SQL,
    schemaV4Sql: SCHEMA_V4_SQL,
    schemaV5Sql: SCHEMA_V5_SQL,
    migration1To2Sql: MIGRATION_1_TO_2_SQL,
    migration2To3Sql: MIGRATION_2_TO_3_SQL,
    migration3To4Sql: MIGRATION_3_TO_4_SQL,
    migration4To5Sql: MIGRATION_4_TO_5_SQL,
    repositoryApi: REPOSITORY_API,
    compatibility
  });
})();
