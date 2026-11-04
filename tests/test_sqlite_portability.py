from __future__ import annotations

import re
import shutil
import sqlite3
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CONTRACT = ROOT / "src" / "js" / "app" / "database_contract.js"
CATALOG = ROOT / "src" / "js" / "app" / "dataset_catalog.js"


def dataset_catalog_contracts() -> dict[str, dict[str, object]]:
    source = CATALOG.read_text(encoding="utf-8")
    blocks = re.findall(
        r"^\s{4}([a-z_]+): defineDataset\('([^']+)', \{(?P<body>.*?)^\s{4}\}\),?",
        source,
        flags=re.M | re.S,
    )
    contracts: dict[str, dict[str, object]] = {}
    for property_id, dataset_id, body in blocks:
        if property_id != dataset_id:
            raise AssertionError(f"Dataset Catalog key/id mismatch: {property_id} != {dataset_id}")

        def required(pattern: str) -> str:
            match = re.search(pattern, body)
            if not match:
                raise AssertionError(f"Catalog field missing for {dataset_id}: {pattern}")
            return match.group(1)

        key_match = re.search(r"keyField:\s*'([^']+)'", body)
        contracts[dataset_id] = {
            "title": required(r"databaseTitle:\s*'([^']+)'"),
            "kind": required(r"kind:\s*'([^']+)'"),
            "schema_version": required(r"schemaVersion:\s*'([^']+)'"),
            "strategy": required(r"strategy:\s*STRATEGY\.([A-Z]+)"),
            "key_field": key_match.group(1) if key_match else None,
            "allow_empty": bool(re.search(r"allowEmpty:\s*true", body)),
            "persisted": not bool(re.search(r"persisted:\s*false", body)),
        }
    if not contracts:
        raise AssertionError("Unable to parse Dataset Catalog contracts.")
    return contracts


def schema_sql() -> str:
    source = CONTRACT.read_text(encoding="utf-8")
    application_match = re.search(r"const APPLICATION_ID = (0x[0-9A-Fa-f]+);", source)
    schema_match = re.search(
        r"const SCHEMA_V1_SQL = `(?P<sql>.*?)`\.trim\(\);",
        source,
        flags=re.S,
    )
    full_match = re.search(
        r"const FULL_DATASET_STORAGE_SQL = `(?P<sql>.*?)`\.trim\(\);",
        source,
        flags=re.S,
    )
    if not application_match or not schema_match or not full_match:
        raise AssertionError("Unable to extract SQLite schema contract.")
    application_id = int(application_match.group(1), 16)
    schema_v1 = schema_match.group("sql").replace("${APPLICATION_ID}", str(application_id))
    return schema_v1 + "\n" + full_match.group("sql") + "\nPRAGMA user_version = 2;\n"


class SqlitePortabilityTests(unittest.TestCase):
    def build_sample_database(self, path: Path) -> None:
        connection = sqlite3.connect(path)
        try:
            connection.executescript(schema_sql())
            journal_mode = connection.execute("PRAGMA journal_mode=DELETE").fetchone()[0]
            self.assertEqual(str(journal_mode).lower(), "delete")
            connection.execute("PRAGMA synchronous=FULL")
            connection.execute("PRAGMA foreign_keys=ON")

            timestamp = "2026-09-30T08:00:00.000Z"
            connection.execute(
                """
                INSERT INTO app_metadata (
                  singleton, database_uuid, database_type, schema_version,
                  created_at, updated_at, created_by_app_version, last_written_by_app_version
                ) VALUES (1, ?, ?, 2, ?, ?, ?, ?)
                """,
                ("roundtrip-db", "reclassifier-sqlite", timestamp, timestamp, "test", "test"),
            )
            # Seed the entire current DB registry, as browser createDatabase() does.
            # Otherwise a sample that passes SQLite quick_check can still fail
            # Reclassifier's own mandatory Dataset registry check.
            catalog_contracts = dataset_catalog_contracts()
            self.assertIn("mobile_brigade_data", catalog_contracts)
            for dataset_id, definition in catalog_contracts.items():
                if not definition["persisted"]:
                    continue
                connection.execute(
                    """
                    INSERT INTO dataset_registry (
                      dataset_id, title, kind, dataset_schema_version,
                      integration_strategy, key_field, allow_empty,
                      persisted, active_revision, record_count, updated_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?)
                    """,
                    (
                        dataset_id,
                        definition["title"],
                        definition["kind"],
                        definition["schema_version"],
                        definition["strategy"],
                        definition["key_field"],
                        int(definition["allow_empty"]),
                        int(definition["persisted"]),
                        timestamp,
                    ),
                )
            connection.execute(
                """
                UPDATE dataset_registry SET
                  active_revision = 1,
                  record_count = 2,
                  freshness_from = ?,
                  freshness_to = ?,
                  source_file_name = ?,
                  content_hash = ?
                WHERE dataset_id = 'mobile_brigade_data'
                """,
                ("2026-09-01", "2026-09-29", "MobileBrigade.xlsx", "sha256:test"),
            )
            rows = [
                ("north|task-1", 0, '{"recordKey":"north|task-1","request":"INC-1"}'),
                ("north|task-2", 1, '{"recordKey":"north|task-2","request":"INC-2"}'),
            ]
            connection.executemany(
                "INSERT INTO dataset_records(dataset_id, record_key, ordinal, record_json) VALUES ('mobile_brigade_data', ?, ?, ?)",
                rows,
            )
            connection.execute(
                "INSERT INTO dataset_state(dataset_id, state_json, updated_at) VALUES (?, ?, ?)",
                (
                    "mobile_brigade_data",
                    '{"schemaVersion":"1.4.0","fullDataset":{'
                    '"schemaVersion":"1.0.0","package":"mobile-brigade-full-dataset",'
                    '"aggregation":"per-task-row","fieldCount":2,'
                    '"columns":["Номер задачи","TEST_UNKNOWN_COLUMN"],'
                    '"rowCount":2,"datasetRowCount":2,"coverage":"complete"}}',
                    timestamp,
                ),
            )
            connection.executemany(
                "INSERT INTO dataset_full_records(dataset_id, record_key, ordinal, row_json) "
                "VALUES ('mobile_brigade_data', ?, ?, ?)",
                [
                    ("north|task-1", 0, '["TASK-1","alpha"]'),
                    ("north|task-2", 1, '["TASK-2","beta"]'),
                ],
            )
            connection.execute(
                """
                INSERT INTO import_history (
                  import_id, dataset_id, started_at, finished_at, source_file_name,
                  source_fingerprint, integration_strategy, status,
                  rows_before, rows_incoming, rows_inserted, rows_updated,
                  rows_unchanged, rows_deleted, rows_after,
                  app_version, db_schema_version, dataset_schema_version, message, details_json
                ) VALUES (?, ?, ?, ?, ?, ?, 'UPSERT', 'COMMITTED',
                          0, 2, 2, 0, 0, 0, 2, 'test', 2, '1.4.0', ?, ?)
                """,
                (
                    "import-1",
                    "mobile_brigade_data",
                    timestamp,
                    timestamp,
                    "MobileBrigade.xlsx",
                    "sha256:test",
                    "round-trip",
                    '{"test":true}',
                ),
            )
            connection.commit()
        finally:
            connection.close()

    def assert_portable_database(self, path: Path) -> None:
        connection = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
        try:
            self.assertEqual(connection.execute("PRAGMA quick_check").fetchone()[0], "ok")
            self.assertEqual(connection.execute("PRAGMA foreign_key_check").fetchall(), [])
            self.assertEqual(connection.execute("PRAGMA application_id").fetchone()[0], 0x52434C46)
            self.assertEqual(connection.execute("PRAGMA user_version").fetchone()[0], 2)
            self.assertEqual(
                connection.execute(
                    "SELECT database_type FROM app_metadata WHERE singleton = 1"
                ).fetchone()[0],
                "reclassifier-sqlite",
            )
            self.assertEqual(
                connection.execute(
                    "SELECT COUNT(*) FROM dataset_records WHERE dataset_id = 'mobile_brigade_data'"
                ).fetchone()[0],
                2,
            )
            self.assertEqual(
                connection.execute(
                    "SELECT COUNT(*) FROM dataset_full_records WHERE dataset_id = 'mobile_brigade_data'"
                ).fetchone()[0],
                2,
            )
            self.assertEqual(
                connection.execute(
                    "SELECT row_json FROM dataset_full_records "
                    "WHERE dataset_id = 'mobile_brigade_data' AND record_key = 'north|task-2'"
                ).fetchone()[0],
                '["TASK-2","beta"]',
            )
            self.assertEqual(
                connection.execute(
                    """
                    SELECT COUNT(*) FROM dataset_registry r
                    WHERE r.record_count <> (
                        SELECT COUNT(*) FROM dataset_records d
                        WHERE d.dataset_id = r.dataset_id
                    )
                    """
                ).fetchone()[0],
                0,
            )
            self.assertEqual(
                connection.execute(
                    "SELECT status FROM import_history WHERE import_id = 'import-1'"
                ).fetchone()[0],
                "COMMITTED",
            )
        finally:
            connection.close()

    def test_file_round_trip_survives_copy_and_reopen(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            original = root / "Reclassifier.db"
            copied = root / "Reclassifier-copy.db"
            self.build_sample_database(original)

            raw = original.read_bytes()
            self.assertGreater(len(raw), 100)
            self.assertEqual(raw[:16], b"SQLite format 3\x00")
            self.assertFalse((root / "Reclassifier.db-wal").exists())

            shutil.copyfile(original, copied)
            self.assert_portable_database(copied)
            self.assertEqual(original.read_bytes(), copied.read_bytes())

    def test_failed_sqlite_transaction_preserves_active_dataset(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "Reclassifier.db"
            self.build_sample_database(path)

            connection = sqlite3.connect(path)
            try:
                connection.execute("PRAGMA foreign_keys=ON")
                before = connection.execute(
                    "SELECT record_key, record_json FROM dataset_records "
                    "WHERE dataset_id = 'mobile_brigade_data' ORDER BY ordinal"
                ).fetchall()
                revision = connection.execute(
                    "SELECT active_revision, record_count FROM dataset_registry "
                    "WHERE dataset_id = 'mobile_brigade_data'"
                ).fetchone()

                with self.assertRaises(sqlite3.IntegrityError):
                    with connection:
                        connection.execute(
                            "UPDATE dataset_registry SET active_revision = 2, record_count = 3 "
                            "WHERE dataset_id = 'mobile_brigade_data'"
                        )
                        connection.execute(
                            "INSERT INTO dataset_records "
                            "(dataset_id, record_key, ordinal, record_json) VALUES (?, ?, ?, ?)",
                            ("mobile_brigade_data", "north|task-3", 2, '{"recordKey":"north|task-3"}'),
                        )
                        # A duplicate primary key forces a rollback of the entire transaction.
                        connection.execute(
                            "INSERT INTO dataset_records "
                            "(dataset_id, record_key, ordinal, record_json) VALUES (?, ?, ?, ?)",
                            ("mobile_brigade_data", "north|task-1", 3, '{"recordKey":"north|task-1"}'),
                        )

                after = connection.execute(
                    "SELECT record_key, record_json FROM dataset_records "
                    "WHERE dataset_id = 'mobile_brigade_data' ORDER BY ordinal"
                ).fetchall()
                current_revision = connection.execute(
                    "SELECT active_revision, record_count FROM dataset_registry "
                    "WHERE dataset_id = 'mobile_brigade_data'"
                ).fetchone()
                self.assertEqual(after, before)
                self.assertEqual(current_revision, revision)
                self.assertEqual(connection.execute("PRAGMA quick_check").fetchone()[0], "ok")
            finally:
                connection.close()
            self.assert_portable_database(path)

    def test_corrupted_file_is_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "broken.db"
            self.build_sample_database(path)
            payload = bytearray(path.read_bytes())
            payload[:16] = b"Not a SQLite db!"
            path.write_bytes(payload)

            with self.assertRaises(sqlite3.DatabaseError):
                connection = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
                try:
                    connection.execute("PRAGMA quick_check").fetchall()
                finally:
                    connection.close()


if __name__ == "__main__":
    unittest.main()
