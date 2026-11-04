from __future__ import annotations

import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


class ItsmArchitectureTests(unittest.TestCase):
    def test_mobile_brigade_dataset_is_optional_for_itsm_processing(self):
        config = (ROOT / "src" / "js" / "modules" / "itsm" / "config.js").read_text(encoding="utf-8")
        adapter = (ROOT / "src" / "js" / "modules" / "itsm" / "ui.js").read_text(encoding="utf-8")

        self.assertNotIn("mobile_brigade_data'", config)
        self.assertIn("mobile_brigade_data: mobileBrigade", adapter)
        self.assertIn("? datasetStore.records('mobile_brigade_data')", adapter)
        self.assertIn(": null", adapter)
        self.assertIn("Дополнительный источник", adapter)

    def test_business_rules_are_isolated_from_excel_adapter(self):
        rules = (ROOT / "src" / "js" / "modules" / "itsm" / "rules.js").read_text(encoding="utf-8")
        adapter = (ROOT / "src" / "js" / "modules" / "itsm" / "ui.js").read_text(encoding="utf-8")

        self.assertIn("function evaluateRow(", rules)
        self.assertIn("function buildLookups(", rules)
        self.assertIn("const NORTH_EXCEPTION_RULES", rules)
        self.assertIn("function classificationQuality(", rules)
        self.assertIn("function driverSummary(", rules)

        self.assertIn("const itsmRules = globalThis.ReclassifierItsmRules", adapter)
        self.assertIn("workerRequest('PROCESS_ITSM'", adapter)
        self.assertIn("async function processItsmFile(operation = {})", adapter)
        self.assertIn("function assertItsmOperationCurrent(", adapter)

        self.assertNotIn("const NORTH_EXCEPTION_RULES", adapter)
        self.assertNotIn("function classificationQuality(", adapter)
        self.assertNotIn("function driverSummary(", adapter)

    def test_excel_processing_lives_in_worker_processor(self):
        adapter = (ROOT / "src" / "js" / "modules" / "itsm" / "ui.js").read_text(encoding="utf-8")
        processor = (ROOT / "src" / "js" / "workers" / "itsm_processor.js").read_text(encoding="utf-8")
        schema = (ROOT / "src" / "js" / "modules" / "itsm" / "dataset_schema.js").read_text(encoding="utf-8")

        self.assertIn("workerRequest('PROCESS_ITSM'", adapter)
        self.assertNotIn("XLSX.read(", adapter)
        self.assertNotIn("XLSX.write", adapter)

        self.assertIn("XLSX.read(", processor)
        self.assertIn("XLSX.write(", processor)
        self.assertIn("rules.evaluateRow(", processor)
        self.assertIn("itsmData:", processor)
        self.assertIn("ReclassifierItsmDatasetSchema", schema)
        self.assertIn("sourceFieldCount: 17", schema)
        self.assertIn("outputFieldCount: 34", schema)

    def test_dataset_lifecycle_is_explicit(self):
        adapter = (ROOT / "src" / "js" / "modules" / "itsm" / "ui.js").read_text(encoding="utf-8")
        runtime = (ROOT / "src" / "js" / "app" / "runtime.js").read_text(encoding="utf-8")

        self.assertIn("ReclassifierDatasetLifecycleManager", adapter)
        self.assertIn("itsmDatasetLifecycle.prepare(itsmDatasetSchema.id", adapter)
        self.assertIn("itsmDatasetLifecycle.activateBatch([", adapter)
        self.assertNotIn("itsmDatasetLifecycle.commit(itsmDatasetSchema.id)", adapter)
        self.assertNotIn("datasetPipeline.", adapter)
        self.assertIn("window.ReclassifierItsmDataset", adapter)



if __name__ == "__main__":
    unittest.main()
