from __future__ import annotations

import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


class ModuleArchitectureTests(unittest.TestCase):
    def test_common_app_files_do_not_own_module_specific_logic(self):
        app_dir = ROOT / "src" / "js" / "app"
        common = "\n".join(
            (app_dir / name).read_text(encoding="utf-8")
            for name in ("core.js", "home.js", "module_workspace.js", "system.js", "runtime.js")
        )

        self.assertNotIn("EQUIPMENT_RULES_VERSION", common)
        self.assertNotIn("ITSM_RULES_VERSION", common)
        self.assertNotIn("normalizeEquipmentWorkbook", common)
        self.assertNotIn("processItsmFile", common)
        self.assertNotIn("mobileBrigadeModuleConfig", common)
        self.assertNotIn("reclassificationModuleConfig", common)

    def test_reclassification_component_separates_rules_ui_and_worker(self):
        directory = ROOT / "src" / "js" / "modules" / "reclassification"
        rules = (directory / "rules.js").read_text(encoding="utf-8")
        config = (directory / "config.js").read_text(encoding="utf-8")
        ui = (directory / "ui.js").read_text(encoding="utf-8")
        processor = (ROOT / "src" / "js" / "workers" / "reclassification_processor.js").read_text(encoding="utf-8")

        self.assertIn("function evaluateRow(", rules)
        self.assertNotIn("document.", rules)
        self.assertIn("reclassificationModuleConfig", config)
        self.assertIn("processReclassificationFile", ui)
        self.assertIn("workerRequest('PROCESS_RECLASSIFICATION'", ui)
        self.assertIn("renderReclassificationModule", ui)
        self.assertIn("registerModule(", ui)
        self.assertNotIn("XLSX.read(", ui)
        self.assertIn("XLSX.read(", processor)
        self.assertIn("parseItsmWorkbook", processor)
        self.assertIn("aoa_to_sheet", processor)
        self.assertIn("XLSX.write(", processor)
        self.assertIn("rules.evaluateRow(", processor)
        self.assertNotIn("buildIndexes(", rules)
        self.assertNotIn("mobileBrigade", rules)
        self.assertNotIn("problemGrade", rules)
        self.assertNotIn("exceptions", rules)
        self.assertIn("references: []", config)
        self.assertNotIn("datasetStore.", ui)
        self.assertIn("prepareReclassificationUpsert(", ui)
        self.assertIn("Сейчас в RE-CLASS", ui)
        self.assertIn("Будет обновлено по номеру", ui)
        self.assertIn("Итоговый размер RE-CLASS", ui)
        self.assertIn("applyReplacement(", ui)
        self.assertIn("Применить реклассификацию", ui)
        self.assertNotIn("datasetPipeline.setActive", ui)

    def test_mobile_brigade_component_separates_rules_config_and_ui(self):
        directory = ROOT / "src" / "js" / "modules" / "mobile_brigade"
        rules = (directory / "rules.js").read_text(encoding="utf-8")
        config = (directory / "config.js").read_text(encoding="utf-8")
        dataset = (directory / "dataset.js").read_text(encoding="utf-8")
        ui = (directory / "ui.js").read_text(encoding="utf-8")
        self.assertIn("function classifyTask(", rules)
        self.assertNotIn("document.", rules)
        self.assertIn("mobileBrigadeModuleConfig", config)
        self.assertIn("prepareMobileBrigadeDataset", dataset)
        self.assertIn("ReclassifierMobileBrigadeDataset", dataset)
        self.assertIn("ReclassifierDatasetLifecycleManager", dataset)
        self.assertNotIn("ReclassifierReferenceManager", dataset)
        self.assertIn("processMobileBrigadeFiles", ui)
        self.assertIn("renderMobileBrigadeModule", ui)
        self.assertIn("registerModule('mobile_brigade'", ui)
        self.assertNotIn("datasetPipeline.", ui)
        self.assertNotIn("ReclassifierReferenceManager", ui)

    def test_itsm_component_separates_rules_config_and_ui(self):
        directory = ROOT / "src" / "js" / "modules" / "itsm"
        rules = (directory / "rules.js").read_text(encoding="utf-8")
        config = (directory / "config.js").read_text(encoding="utf-8")
        ui = (directory / "ui.js").read_text(encoding="utf-8")

        self.assertIn("function evaluateRow(", rules)
        self.assertNotIn("document.", rules)
        self.assertIn("itsmModuleConfig", config)
        self.assertIn("processItsmFile", ui)
        self.assertIn("renderItsmModule", ui)
        self.assertIn("registerModule('itsm'", ui)

    def test_equipment_component_is_four_layers(self):
        directory = ROOT / "src" / "js" / "modules" / "equipment"
        config = (directory / "equipment_config.js").read_text(encoding="utf-8")
        logic = (directory / "equipment_logic.js").read_text(encoding="utf-8")
        manager = (directory / "equipment_manager.js").read_text(encoding="utf-8")
        ui = (directory / "equipment_ui.js").read_text(encoding="utf-8")

        self.assertIn("const equipmentConfig =", config)
        self.assertIn("normalizeEquipmentWorkbook", logic)
        self.assertIn("buildEquipmentCombinedFromCatalogs", logic)
        self.assertIn("processEquipmentStaging", manager)
        self.assertIn("function renderEquipmentCatalogSection()", ui)
        self.assertIn("function renderEquipmentDetail(", ui)

        self.assertNotIn("function renderEquipment()", logic)
        self.assertNotIn("normalizeEquipmentWorkbook", ui)


    def test_failure_classifier_component_is_four_layers(self):
        directory = ROOT / "src" / "js" / "modules" / "failure_classifier"
        config = (directory / "config.js").read_text(encoding="utf-8")
        normalizer = (directory / "normalizer.js").read_text(encoding="utf-8")
        manager = (directory / "manager.js").read_text(encoding="utf-8")
        ui = (directory / "ui.js").read_text(encoding="utf-8")

        self.assertIn("FAILURE_CLASSIFIER_SCHEMA_VERSION", config)
        self.assertIn("normalizeFailureClassifierWorkbook", normalizer)
        self.assertIn("loadFailureClassifierFile", manager)
        self.assertIn("function renderFailureClassifier()", ui)

        self.assertNotIn("document.", normalizer)
        self.assertNotIn("window.XLSX.read", ui)


if __name__ == "__main__":
    unittest.main()
