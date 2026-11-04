from __future__ import annotations

import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


class ReclassificationArchitectureTests(unittest.TestCase):
    def test_worker_uses_hardened_itsm_header_discovery(self):
        processor = (ROOT / "src" / "js" / "workers" / "reclassification_processor.js").read_text(encoding="utf-8")

        self.assertIn("const HEADER_SEARCH_LIMIT = 100", processor)
        self.assertIn("const REQUIRED_FIELDS = Object.freeze([", processor)
        self.assertIn("function headerKey(", processor)
        self.assertIn("function findInputTable(", processor)
        self.assertIn("bestCandidate", processor)
        self.assertIn("exactOrSuffix", processor)
        self.assertIn("['Территории MES', 'Территория MES']", processor)
        self.assertIn("Примечания к разрешению / Примечание к закрытию", processor)

    def test_active_runtime_route_requires_complete_full_dataset(self):
        root = ROOT / "src" / "js"
        loader = (ROOT / "build" / "build.py").read_text(encoding="utf-8")
        helper = (root / "modules" / "reclassification" / "runtime_source.js").read_text(encoding="utf-8")
        processor = (root / "workers" / "reclassification_processor.js").read_text(encoding="utf-8")
        ui = (root / "modules" / "reclassification" / "ui.js").read_text(encoding="utf-8")
        self.assertIn('"modules/reclassification/runtime_source.js"', loader)
        self.assertIn("runtimeSource:source", ui)
        self.assertIn("processReclassificationRuntime(", ui)
        self.assertIn("assertReclassificationRuntimeCurrent(", ui)
        self.assertIn("runtime.get('itsm_data')", ui)
        self.assertIn("full.rows.length!==compact.length", helper)
        self.assertIn("runtimeInputWorkbook(", processor)
        self.assertIn("runtimeWorkbook", (root / "workers" / "itsm_processor.js").read_text(encoding="utf-8"))

    def test_report_download_and_grounded_coverage(self):
        ui = (ROOT / "src" / "js" / "modules" / "reclassification" / "ui.js").read_text(encoding="utf-8")
        source = (ROOT / "src" / "js" / "modules" / "reclassification" / "runtime_source.js").read_text(encoding="utf-8")
        self.assertIn("reclassificationLastReportFile = {bytes:result.bytes,name:result.outputName};", ui)
        self.assertIn("downloadProcessedReclassificationButton", ui)
        self.assertIn("downloadReclassificationResult(reclassificationLastReportFile.bytes,reclassificationLastReportFile.name)", ui)
        self.assertNotIn("downloadReclassificationResult(result.bytes,result.outputName)", ui)
        self.assertIn("ReclassifierDatasetExcelExport?.period?.('itsm_data',activeItsm)", ui)
        self.assertIn("ReclassifierReclassificationRuntimeSource?.reclassFreshness?.(activeReclass)", ui)
        self.assertIn("Дата создания Вызова", ui)
        self.assertIn("а не дата проверки специалистом", ui)
        self.assertIn("Готовых машинных решений", (ROOT / "src" / "js" / "workers" / "reclassification_processor.js").read_text(encoding="utf-8"))
        self.assertNotIn("<h3>Версия</h3>", ui)
        self.assertIn("function reclassFreshness(instance)", source)

    def test_ui_guards_reclassification_worker_lifecycle(self):
        ui = (ROOT / "src" / "js" / "modules" / "reclassification" / "ui.js").read_text(encoding="utf-8")

        self.assertIn("function assertReclassificationOperationCurrent(", ui)
        self.assertIn("state.processingModuleId = 'reclassification'", ui)
        self.assertIn("state.processingOperationId = operationId", ui)
        self.assertIn("const sourceFile = state.sourceFile", ui)
        self.assertIn("processReclassificationFile({ sourceFile, operationId, onProgress:", ui)
        self.assertIn("state.sourceFile !== sourceFile", ui)
        self.assertIn("selectReclassificationSourceButton", ui)
        self.assertIn("clearReclassificationSourceButton", ui)
        self.assertIn("Загрузка стартовых данных ещё не завершена", ui)


if __name__ == "__main__":
    unittest.main()
