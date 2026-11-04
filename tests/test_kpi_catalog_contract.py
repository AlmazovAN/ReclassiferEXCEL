"""Validate all runtime KPI Catalog entries against the Step 1 design-time schema."""
from __future__ import annotations

import json
import shutil
import subprocess
import unittest
from pathlib import Path

from test_kpi_target_model import _verify

ROOT = Path(__file__).resolve().parents[1]
SCHEMA = ROOT / "docs/contracts/kpi_target_model.schema.json"
CATALOG_TEST = ROOT / "tests/test_kpi_catalog.js"
BUILD = ROOT / "build/build.py"


class KpiCatalogContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.schema = json.loads(SCHEMA.read_text(encoding="utf-8"))

    def test_fragment_order_and_stable_api(self):
        build = BUILD.read_text(encoding="utf-8")
        before = build.index('"kpi/calculator/index.js"')
        contracts = build.index('"kpi/catalog/contracts.js"')
        catalog = build.index('"kpi/catalog/index.js"')
        after = build.index('"kpi/report_snapshot.js"')
        self.assertLess(before, contracts)
        self.assertLess(contracts, catalog)
        self.assertLess(catalog, after)
        source = (ROOT / "src/js/kpi/catalog/index.js").read_text(encoding="utf-8")
        self.assertIn("ReclassifierKpiCatalog", source)
        self.assertIn("assertCalculation", source)
        self.assertNotIn("eval(", source)
        self.assertNotIn("new Function(", source)
        self.assertNotIn("ReclassifierDatabaseRepository", source)

    def test_all_catalog_records_match_target_model_schema(self):
        if not shutil.which("node"):
            self.skipTest("Node.js is unavailable for runtime contract extraction")
        result = subprocess.run(
            ["node", str(CATALOG_TEST), "--dump"],
            cwd=ROOT,
            capture_output=True,
            text=True,
            check=False,
            timeout=30,
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        entries = json.loads(result.stdout)
        self.assertEqual(len(entries), 22)
        self.assertEqual(len({entry["id"] for entry in entries}), 22)

        self.assertEqual(sum(entry["calculation"] is not None for entry in entries), 16)
        self.assertEqual(sum(entry["calculation"] is None for entry in entries), 6)
        self.assertEqual(sum(entry["visibleInReport"] for entry in entries), 21)

        for entry in entries:
            with self.subTest(kpi=entry["id"]):
                _verify(entry["definition"], self.schema["$defs"]["definition"], self.schema)
                self.assertEqual(entry["definition"]["id"], entry["id"])
                if entry["calculation"] is None:
                    self.assertEqual(entry["calculationState"], "not-implemented")
                    continue
                _verify(entry["calculation"], self.schema["$defs"]["calculation"], self.schema)
                self.assertEqual(entry["calculation"]["kpiId"], entry["id"])
                self.assertEqual(entry["calculation"]["status"], "draft")
                self.assertEqual(entry["calculation"]["temporal"]["forecast"]["status"], "not-defined")
                self.assertIsNone(entry["definition"]["target"])


if __name__ == "__main__":
    unittest.main()
