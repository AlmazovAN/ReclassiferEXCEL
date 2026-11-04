from __future__ import annotations

import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


class ReferenceArchitectureTests(unittest.TestCase):
    def test_reference_manager_is_split_by_responsibility(self):
        app_core = (ROOT / "src" / "js" / "app" / "core.js").read_text(encoding="utf-8")
        config = (ROOT / "src" / "js" / "references" / "reference_config.js").read_text(encoding="utf-8")
        normalizers = (ROOT / "src" / "js" / "references" / "reference_normalizers.js").read_text(encoding="utf-8")
        manager = (ROOT / "src" / "js" / "references" / "reference_manager.js").read_text(encoding="utf-8")
        lifecycle = (ROOT / "src" / "js" / "app" / "dataset_lifecycle.js").read_text(encoding="utf-8")
        mobile_dataset = (ROOT / "src" / "js" / "modules" / "mobile_brigade" / "dataset.js").read_text(encoding="utf-8")
        ui_common = (ROOT / "src" / "js" / "references" / "reference_ui_common.js").read_text(encoding="utf-8")
        probe_ui = (ROOT / "src" / "js" / "references" / "reference_probe_ui.js").read_text(encoding="utf-8")
        preview_ui = (ROOT / "src" / "js" / "references" / "reference_preview_ui.js").read_text(encoding="utf-8")
        detail_ui = (ROOT / "src" / "js" / "references" / "reference_detail_ui.js").read_text(encoding="utf-8")
        ui = (ROOT / "src" / "js" / "references" / "reference_ui.js").read_text(encoding="utf-8")
        classifier = (ROOT / "src" / "js" / "app" / "dataset_classifier.js").read_text(encoding="utf-8")

        self.assertLess(len(app_core), 10000)
        self.assertNotIn("referenceConfig =", app_core)
        self.assertNotIn("normalizeDriversWorkbook", app_core)
        self.assertNotIn("function renderReferences()", app_core)

        self.assertIn("const referenceConfig =", config)
        self.assertIn("RECLASSIFICATION_SCHEMA", config)
        self.assertIn("DRIVERS_SCHEMA", config)
        self.assertIn("MOBILE_BRIGADE_DATA_SCHEMA", config)
        self.assertIn("['finalTaskType', 'Итоговый тип задачи', 'text|null']", config)
        self.assertIn("['laborState', 'Состояние трудозатрат', 'text|null']", config)
        self.assertIn("['laborHours', 'ФактТрудочас, чел-час', 'number|null']", config)
        self.assertIn("ReclassifierDatasetCatalog", config)
        self.assertIn("version: referenceConfig.reclassification.schemaVersion", config)
        self.assertNotIn("datasetPipeline.register", config)
        self.assertNotIn("['normalCgps', 'НормалЦГПС'", config)
        self.assertNotIn("['sputnikException', 'ИсклСпутник'", config)

        self.assertIn("normalizeReferenceHeader", normalizers)
        self.assertIn("normalizeDriversWorkbook", normalizers)
        self.assertIn("normalizeProblemGradeWorkbook", normalizers)

        self.assertIn("loadReferenceFile", manager)
        self.assertIn("prepareReclassificationUpsert", manager)
        self.assertIn("upsert_by_number", manager)
        self.assertIn("prepareReferenceReplacement", manager)
        self.assertIn("applyReferenceReplacement", manager)
        self.assertIn("prepareReplacement:", manager)
        self.assertIn("applyReplacement:", manager)
        self.assertNotIn("updateGeneratedReference", manager)
        self.assertNotIn("prepareGeneratedReference", manager)
        self.assertNotIn("applyGeneratedReference", manager)
        self.assertNotIn("hydrateEmbeddedMobileBrigadeData", manager)
        self.assertNotIn("datasetPipeline.", manager)
        self.assertIn("ReclassifierDatasetLifecycleManager", manager)
        self.assertIn("ReclassifierReferenceManager", manager)
        self.assertNotIn("function renderReferences()", manager)

        self.assertIn("globalThis.ReclassifierDatasetLifecycleManager", lifecycle)
        self.assertIn("datasetLifecyclePrepare", lifecycle)
        self.assertIn("datasetLifecycleCommit", lifecycle)
        self.assertIn("datasetLifecycleActivate", lifecycle)
        self.assertIn("datasetLifecycleFingerprintFile", lifecycle)
        self.assertNotIn("mobile_brigade_data", lifecycle)
        self.assertNotIn("referenceConfig", lifecycle)

        self.assertIn("prepareMobileBrigadeDataset", mobile_dataset)
        self.assertIn("normalizeMobileBrigadeAnalyticsRecord", mobile_dataset)
        self.assertIn("enrichMobileBrigadeAnalytics", mobile_dataset)
        self.assertIn("'legacy_unknown'", mobile_dataset)
        self.assertNotIn("decodeEmbeddedMobileBrigadeData", mobile_dataset)
        self.assertIn("ReclassifierMobileBrigadeDataset", mobile_dataset)
        self.assertIn("ReclassifierDatasetLifecycleManager", mobile_dataset)
        self.assertNotIn("ReclassifierReferenceManager", mobile_dataset)

        self.assertIn("function renderReferences()", ui)
        self.assertNotIn("function renderReferenceDetail(", ui)
        self.assertNotIn("function bindReferenceDropzone(", ui)
        self.assertNotIn("async function classifyProbeFile(", ui)
        self.assertNotIn("function renderReferenceValidation(", ui)

        self.assertIn("function bindReferenceDropzone(", ui_common)
        self.assertIn("function renderReferenceHistory(", ui_common)

        self.assertIn("function renderReferenceDirectoryProbe()", probe_ui)
        self.assertIn("async function collectDirectoryFiles(", probe_ui)
        self.assertNotIn("function classifyWorkbookByStructure(", probe_ui)
        self.assertIn("ReclassifierDatasetClassifier.classifyWorkbook", probe_ui)
        self.assertIn("async function classifyProbeFile(", probe_ui)
        self.assertIn("async function probeDirectoryHandle()", probe_ui)
        self.assertIn("function probeWebkitDirectory()", probe_ui)
        self.assertIn("window.showDirectoryPicker({ mode: 'read' })", probe_ui)
        self.assertIn("input.webkitdirectory = true", probe_ui)
        self.assertIn("file.webkitRelativePath", probe_ui)
        self.assertIn("Тест Directory Handle", probe_ui)
        self.assertIn("Тест WebKit Directory", probe_ui)
        self.assertNotIn("/^Drivers\\.xlsx$/i", probe_ui)

        self.assertIn("function renderReferenceValidation(", preview_ui)
        self.assertIn("function renderMobileBrigadeDataPreview(", preview_ui)
        self.assertIn("function renderItsmSiriusStatus(", preview_ui)

        self.assertIn("function renderReferenceDetail(", detail_ui)
        self.assertIn("renderMobileBrigadeScopeStatus(instance)", detail_ui)
        self.assertIn("renderReferenceHistory(referenceId)", detail_ui)

        self.assertIn("function classifyWorkbookByStructure(", classifier)
        self.assertIn("ReclassifierDatasetClassifier", classifier)

        for source in (ui_common, probe_ui, preview_ui, detail_ui, ui):
            self.assertLess(len(source), 30000)


if __name__ == "__main__":
    unittest.main()
