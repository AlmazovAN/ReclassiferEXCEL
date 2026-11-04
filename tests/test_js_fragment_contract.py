from __future__ import annotations

import importlib.util
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def load_build_module():
    spec = importlib.util.spec_from_file_location("reclassifier_build", ROOT / "build" / "build.py")
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


class JavaScriptFragmentContractTests(unittest.TestCase):
    def test_app_fragment_order_is_explicit(self):
        build = load_build_module()
        self.assertEqual(
            (
                "app/core.js",
                "app/performance_profiler.js",
                "app/diagnostic_journal.js",
                "app/dataset_catalog.js",
                "app/field_registry.js",
                "app/dataset_pipeline.js",
                "app/dataset_lifecycle.js",
                "app/database_contract.js",
                "app/database_core.js",
                "app/database_recovery_store.js",
                "app/database_bootstrap.js",
                "app/data_repository.js",
                "app/recalculation_core.js",
                "app/recalculation_materializer.js",
                "app/recalculation_commit.js",
                "app/recalculation_workspace.js",
                "app/dataset_db_state_model.js",
                "app/html_snapshot.js",
                "references/reference_config.js",
                "app/dataset_classifier.js",
                "references/reference_normalizers.js",
                "references/reference_manager.js",
                "references/reference_ui_common.js",
                "references/reference_probe_ui.js",
                "references/reference_preview_ui.js",
                "references/reference_kpi_source_ui.js",
                "references/reference_detail_ui.js",
                "references/reference_ui.js",
                "app/database_recognizer.js",
                "app/database_integration.js",
                "app/heavy_operation_gate.js",
    "app/diagnostic_scope_v18.js",
    "app/diagnostic_v2.js",
    "app/diagnostic_history.js",
                "app/database_ui_state.js",
                "app/database_intake_ui.js",
                "app/database_connection_ui.js",
                "app/database_recovery_ui.js",
                "app/database_integration_ui.js",
                "app/database_audit_ui.js",
                "app/database_view_renderers.js",
                "app/database_recalculation_ui.js",
                "app/database_ui.js",
                "app/home.js",
                "app/reliability_dashboard_data.js",
                "app/reliability_report_presentation.js",
                "app/reliability_pdf.js",
                "app/reliability_dashboard.js",
                "app/reliability_kpi_chart.js",
                "app/kpi_passports.js",
                "app/module_workspace.js",
                "app/xlsx_export_diagnostics.js",
                "app/dataset_excel_export.js",
                "app/mobile_brigade_staging.js",
                "modules/reclassification/rules.js",
                "modules/reclassification/classifier_index_v4.js",
                "modules/reclassification/facts_v4.js",
                "modules/reclassification/event_v4.js",
                "modules/reclassification/objects_v4.js",
                "modules/reclassification/elements_v4.js",
                "modules/reclassification/failure_v4.js",
                "modules/reclassification/cause_v4.js",
                "modules/reclassification/path_review_v4.js",
                "modules/reclassification/review_policy_v4.js",
                "modules/reclassification/diagnostics_v4.js",
                "modules/reclassification/rules_v4.js",
                "modules/reclassification/engine_registry.js",
                "modules/reclassification/runtime_source.js",
                "modules/reclassification/config.js",
                "modules/reclassification/ui.js",
                "modules/itsm/mb_presence.js",
                "modules/itsm/dataset_schema.js",
                "kpi/source_facts.js",
                "kpi/operational_series.js",
                "kpi/preparation/common.js",
                "kpi/preparation/failures.js",
                "kpi/preparation/equipment.js",
                "kpi/preparation/labor.js",
                "kpi/preparation/sla.js",
                "kpi/preparation/classification.js",
                "kpi/preparation/prb.js",
                "kpi/preparation/ktg.js",
                "kpi/preparation/index.js",
                "kpi/calculator/common.js",
                "kpi/calculator/declarative.js",
                "kpi/calculator/definitions.js",
                "kpi/calculator/vbr/calculate.js",
                "kpi/calculator/ktg/calculate.js",
                "kpi/calculator/sla/calculate.js",
                "kpi/calculator/classification_quality/calculate.js",
                "kpi/calculator/classification_quality_cgps/calculate.js",
                "kpi/calculator/labor/calculate.js",
                "kpi/calculator/problem_management/calculate.js",
                "kpi/calculator/index.js",
                "kpi/catalog/contracts.js",
                "kpi/catalog/index.js",
                "kpi/execution_trace.js",
                "kpi/forecast_engine.js",
                "kpi/classification_lag_forecast.js",
                "kpi/passport_math.js",
                "kpi/passport_view.js",
                "kpi/report_view_model.js",
                "kpi/problem_management_analytics.js",
                "kpi/chart_view_model.js",
                "kpi/report_snapshot.js",
                "app/reporting_coverage_manager.js",
                "modules/itsm/kpi_source.js",
                "modules/itsm/rules.js",
                "modules/itsm/recalculation.js",
                "modules/itsm/config.js",
                "modules/itsm/ui.js",
                "modules/mobile_brigade/rules.js",
                "modules/mobile_brigade/recalculation.js",
                "modules/mobile_brigade/config.js",
                "modules/mobile_brigade/upsert.js",
                "modules/mobile_brigade/dataset.js",
                "modules/mobile_brigade/ui.js",
                "modules/equipment/equipment_config.js",
                "modules/equipment/equipment_partitions.js",
                "modules/equipment/equipment_history.js",
                "modules/equipment/equipment_population.js",
                "modules/equipment/equipment_logic.js",
                "app/kpi_computation_service.js",
                "app/kpi_snapshot_store.js",
                "app/reliability_report_service.js",
                "modules/equipment/equipment_manager.js",
                "modules/equipment/equipment_ui.js",
                "modules/failure_classifier/config.js",
                "modules/failure_classifier/normalizer.js",
                "modules/failure_classifier/manager.js",
                "modules/failure_classifier/ui.js",
                "app/system.js",
                "app/worker_client.js",
                "app/kpi_task_scheduler.js",
                "app/kpi_background_jobs.js",
                "app/kpi_auto_refresh.js",
                "app/runtime.js",
            ),
            build.APP_JS_FILES,
        )

    def test_application_functions_are_not_split_between_files(self):
        app_dir = ROOT / "src" / "js" / "app"
        core = (app_dir / "core.js").read_text(encoding="utf-8")
        home = (app_dir / "home.js").read_text(encoding="utf-8")
        reliability_dashboard_data = (app_dir / "reliability_dashboard_data.js").read_text(encoding="utf-8")
        reliability_pdf = (app_dir / "reliability_pdf.js").read_text(encoding="utf-8")
        reliability_dashboard = (app_dir / "reliability_dashboard.js").read_text(encoding="utf-8")
        reliability_report_service = (app_dir / "reliability_report_service.js").read_text(encoding="utf-8")
        workspace = (app_dir / "module_workspace.js").read_text(encoding="utf-8")
        dataset_catalog = (app_dir / "dataset_catalog.js").read_text(encoding="utf-8")
        dataset_lifecycle = (app_dir / "dataset_lifecycle.js").read_text(encoding="utf-8")
        database_bootstrap = (app_dir / "database_bootstrap.js").read_text(encoding="utf-8")
        data_repository = (app_dir / "data_repository.js").read_text(encoding="utf-8")
        recalculation_core = (app_dir / "recalculation_core.js").read_text(encoding="utf-8")
        dataset_classifier = (app_dir / "dataset_classifier.js").read_text(encoding="utf-8")
        database_recognizer = (app_dir / "database_recognizer.js").read_text(encoding="utf-8")
        database_integration = (app_dir / "database_integration.js").read_text(encoding="utf-8")
        database_ui_state = (app_dir / "database_ui_state.js").read_text(encoding="utf-8")
        database_integration_ui = (app_dir / "database_integration_ui.js").read_text(encoding="utf-8")
        database_ui = (app_dir / "database_ui.js").read_text(encoding="utf-8")
        system = (app_dir / "system.js").read_text(encoding="utf-8")
        worker_client = (app_dir / "worker_client.js").read_text(encoding="utf-8")
        runtime = (app_dir / "runtime.js").read_text(encoding="utf-8")

        self.assertTrue(core.lstrip().startswith("(() => {"))
        self.assertIn("function render()", core)
        self.assertIn("function renderHome()", home)
        self.assertIn("const reliabilityDashboardData", reliability_dashboard_data)
        self.assertIn("globalThis.ReclassifierReliabilityDashboardData", reliability_dashboard_data)
        self.assertIn("globalThis.ReclassifierReliabilityPdfRenderer", reliability_pdf)
        self.assertIn("function renderReliabilityDashboard(options = {})", reliability_dashboard)
        self.assertIn("Паспорт KPI", reliability_dashboard)
        self.assertIn("ReclassifierReliabilityReportService", reliability_dashboard)
        self.assertIn("globalThis.ReclassifierReliabilityReportService", reliability_report_service)
        self.assertIn("function renderModuleWorkspace(", workspace)
        self.assertIn("globalThis.ReclassifierDatasetCatalog", dataset_catalog)
        self.assertIn("globalThis.ReclassifierDatasetLifecycleManager", dataset_lifecycle)
        self.assertIn("globalThis.ReclassifierDatabaseBootstrap", database_bootstrap)
        self.assertIn("globalThis.ReclassifierRuntimeDataRepository", data_repository)
        self.assertIn("globalThis.ReclassifierRecalculationCore", recalculation_core)
        self.assertIn("globalThis.ReclassifierDatasetClassifier", dataset_classifier)
        self.assertIn("globalThis.ReclassifierDatasetRecognizer", database_recognizer)
        self.assertIn("globalThis.ReclassifierDatabaseIntegration", database_integration)
        self.assertIn("const databaseWorkspaceState", database_ui_state)
        self.assertIn("databaseCommitIntegration", database_integration_ui)
        self.assertIn("function renderDatabaseWorkspace()", database_ui)
        self.assertIn("function renderAbout()", system)
        self.assertIn("function createWorkerClient(", worker_client)
        self.assertTrue(runtime.rstrip().endswith("})();"))

        self.assertNotIn("function renderHome()", core)
        self.assertNotIn("function renderAbout()", workspace)
        self.assertNotIn("function createWorker()", system)
        self.assertNotIn("function renderDatabaseWorkspace()", core)

    def test_module_components_are_executable_in_reviewed_order(self):
        build = load_build_module()
        app_js = build.load_app_js()

        core_pos = app_js.index("const moduleConfig = {}")
        dataset_catalog_pos = app_js.index("globalThis.ReclassifierDatasetCatalog")
        dataset_pipeline_pos = app_js.index("function createDatasetPipeline")
        dataset_lifecycle_pos = app_js.index("globalThis.ReclassifierDatasetLifecycleManager")
        database_bootstrap_pos = app_js.index("function bootstrapLegacyStore")
        data_repository_pos = app_js.index("const runtimeDerivedResolvers")
        reference_pos = app_js.index("const RECLASSIFICATION_SCHEMA")
        dataset_classifier_pos = app_js.index("globalThis.ReclassifierDatasetClassifier")
        reclass_rules_pos = app_js.index("globalThis.ReclassifierReclassificationRules")
        reclass_pos = app_js.index("const reclassificationModuleConfig")
        itsm_schema_pos = app_js.index("globalThis.ReclassifierItsmDatasetSchema = Object.freeze")
        source_facts_pos = app_js.index("globalThis.ReclassifierKpiSourceFacts = api")
        preparation_common_pos = app_js.index("globalThis.ReclassifierKpiPreparationCommon = api")
        preparation_pos = app_js.index("globalThis.ReclassifierKpiPreparation = api")
        calculator_common_pos = app_js.index("globalThis.ReclassifierKpiCalculatorCommon = api")
        calculator_pos = app_js.index("globalThis.ReclassifierKpiCalculator = api")
        report_snapshot_pos = app_js.index("globalThis.ReclassifierReportSnapshot = api")
        kpi_source_pos = app_js.index("globalThis.ReclassifierKpiSource = Object.freeze")
        itsm_rules_pos = app_js.index("const RULES_VERSION = '1.2.1'")
        itsm_adapter_pos = app_js.index("const itsmRules = globalThis.ReclassifierItsmRules")
        mobile_rules_pos = app_js.index("globalThis.ReclassifierMobileBrigadeRules = api")
        mobile_pos = app_js.index("const mobileBrigadeModuleConfig")
        mobile_dataset_pos = app_js.index("globalThis.ReclassifierMobileBrigadeDataset")
        reference_common_pos = app_js.index("function referenceStatusMarkup")
        reference_probe_pos = app_js.index("async function collectDirectoryFiles")
        reference_preview_pos = app_js.index("function renderReferenceValidation")
        reference_detail_pos = app_js.index("function renderReferenceDetail(")
        reference_ui_pos = app_js.index("function renderReferences()")
        database_recognizer_pos = app_js.index("function recognizerNormalizeHeader")
        database_integration_pos = app_js.index("function integrationRepository")
        database_state_pos = app_js.index("const databaseWorkspaceState")
        database_intake_pos = app_js.index("function databaseQueueDatasetId")
        database_connection_pos = app_js.index("async function databaseCreateNew")
        database_integration_ui_pos = app_js.index("function databaseIntegrationPreviewText")
        database_audit_pos = app_js.index("function databaseAuditSnapshot")
        database_renderers_pos = app_js.index("function databaseRenderHistoryRows")
        database_ui_pos = app_js.index("function renderDatabaseWorkspace()")
        dashboard_data_pos = app_js.index("const reliabilityDashboardData")
        dashboard_pdf_pos = app_js.index("globalThis.ReclassifierReliabilityPdfRenderer = api")
        dashboard_view_pos = app_js.index("function renderReliabilityDashboard(options = {})")
        equipment_pos = app_js.index("const EQUIPMENT_RULES_VERSION")
        report_service_pos = app_js.index("globalThis.ReclassifierReliabilityReportService = api")
        worker_client_pos = app_js.index("function createWorkerClient(")
        runtime_pos = app_js.index("function createWorker()")

        self.assertLess(core_pos, dataset_catalog_pos)
        self.assertLess(dataset_catalog_pos, dataset_pipeline_pos)
        self.assertLess(dataset_pipeline_pos, dataset_lifecycle_pos)
        self.assertLess(dataset_lifecycle_pos, database_bootstrap_pos)
        self.assertLess(database_bootstrap_pos, data_repository_pos)
        self.assertLess(data_repository_pos, reference_pos)
        self.assertLess(reference_pos, dataset_classifier_pos)
        self.assertLess(dataset_classifier_pos, reference_common_pos)
        self.assertLess(reference_common_pos, reference_probe_pos)
        self.assertLess(reference_probe_pos, reference_preview_pos)
        self.assertLess(reference_preview_pos, reference_detail_pos)
        self.assertLess(reference_detail_pos, reference_ui_pos)
        self.assertLess(reference_ui_pos, database_recognizer_pos)
        self.assertLess(database_recognizer_pos, database_integration_pos)
        self.assertLess(database_integration_pos, database_state_pos)
        self.assertLess(database_state_pos, database_intake_pos)
        self.assertLess(database_intake_pos, database_connection_pos)
        self.assertLess(database_connection_pos, database_integration_ui_pos)
        self.assertLess(database_integration_ui_pos, database_audit_pos)
        self.assertLess(database_audit_pos, database_renderers_pos)
        self.assertLess(database_renderers_pos, database_ui_pos)
        self.assertLess(database_ui_pos, dashboard_data_pos)
        self.assertLess(dashboard_data_pos, dashboard_pdf_pos)
        self.assertLess(dashboard_pdf_pos, dashboard_view_pos)
        self.assertLess(dashboard_view_pos, reclass_rules_pos)
        self.assertLess(reclass_rules_pos, reclass_pos)
        self.assertLess(reclass_pos, itsm_schema_pos)
        self.assertLess(itsm_schema_pos, source_facts_pos)
        self.assertLess(source_facts_pos, preparation_common_pos)
        self.assertLess(preparation_common_pos, preparation_pos)
        self.assertLess(preparation_pos, calculator_common_pos)
        self.assertLess(calculator_common_pos, calculator_pos)
        self.assertLess(calculator_pos, report_snapshot_pos)
        self.assertLess(report_snapshot_pos, kpi_source_pos)
        self.assertLess(kpi_source_pos, itsm_rules_pos)
        self.assertLess(itsm_rules_pos, itsm_adapter_pos)
        self.assertLess(itsm_adapter_pos, mobile_rules_pos)
        self.assertLess(mobile_rules_pos, mobile_pos)
        self.assertLess(mobile_pos, mobile_dataset_pos)
        self.assertLess(mobile_dataset_pos, equipment_pos)
        self.assertLess(equipment_pos, report_service_pos)
        self.assertLess(report_service_pos, worker_client_pos)
        self.assertLess(worker_client_pos, runtime_pos)

        self.assertIn("function renderEquipmentCatalogSection()", app_js)
        self.assertIn("function bindEquipmentCatalogSection()", app_js)
        self.assertIn("function renderEquipmentDetail(id)", app_js)
        self.assertIn("function renderFailureClassifier()", app_js)
        self.assertIn("globalThis.ReclassifierDatabaseBootstrap", app_js)
        self.assertIn("globalThis.ReclassifierRuntimeDataRepository", app_js)
        self.assertIn("globalThis.ReclassifierDatasetRecognizer", app_js)
        self.assertIn("globalThis.ReclassifierDatabaseIntegration", app_js)
        self.assertIn("function renderDatabaseWorkspace()", app_js)
        self.assertIn("function normalizeFailureClassifierWorkbook(", app_js)
        self.assertIn("async function loadFailureClassifierFile(", app_js)
        self.assertIn("window.ReclassifierItsmDataset", app_js)
        self.assertIn("function renderItsmModule()", app_js)
        self.assertIn("function renderMobileBrigadeModule()", app_js)
        self.assertIn("function renderReliabilityDashboard(options = {})", app_js)
        self.assertIn("globalThis.ReclassifierReportSnapshot", app_js)
        self.assertIn("globalThis.ReclassifierReliabilityPdfRenderer", app_js)
        self.assertIn("globalThis.ReclassifierReliabilityReportService", app_js)
        self.assertIn("function processReclassificationFile(operation = {})", app_js)
        self.assertIn("function renderReclassificationModule()", app_js)


if __name__ == "__main__":
    unittest.main()
