from __future__ import annotations

import sqlite3
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


class SqliteSchemaV1Tests(unittest.TestCase):
    def test_schema_v1_executes_in_real_sqlite(self):
        source = (ROOT / "src" / "js" / "app" / "database_contract.js").read_text(encoding="utf-8")
        start_marker = "const SCHEMA_V1_SQL = `"
        end_marker = "`.trim();"
        self.assertIn(start_marker, source)
        start = source.index(start_marker) + len(start_marker)
        end = source.index(end_marker, start)
        sql = source[start:end].replace("$" + "{APPLICATION_ID}", str(0x52434C46))

        db = sqlite3.connect(":memory:")
        try:
            db.executescript(sql)
            application_id = db.execute("PRAGMA application_id").fetchone()[0]
            user_version = db.execute("PRAGMA user_version").fetchone()[0]
            self.assertEqual(0x52434C46, application_id)
            self.assertEqual(1, user_version)

            tables = {
                row[0]
                for row in db.execute(
                    "SELECT name FROM sqlite_master WHERE type='table'"
                )
            }
            self.assertTrue({
                "app_metadata",
                "dataset_registry",
                "dataset_records",
                "dataset_state",
                "import_history",
                "schema_migrations",
            }.issubset(tables))

            self.assertEqual(1, db.execute("SELECT json_valid('{}')").fetchone()[0])
        finally:
            db.close()


if __name__ == "__main__":
    unittest.main()
