from __future__ import annotations

import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
JS_ROOT = ROOT / "src" / "js"


def read(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def relative(path: Path) -> str:
    return path.relative_to(ROOT).as_posix()


class ArchitectureGuardrailTests(unittest.TestCase):
    """Protect layer boundaries that keep changes local and predictable.

    These tests intentionally check architecture, not business results.
    If one of them fails, first ask whether responsibility is moving to the
    wrong layer. Update an allow-list only when the architecture itself has
    deliberately changed.
    """

    def assert_forbidden_absent(
        self,
        path: Path,
        forbidden: tuple[str, ...],
        *,
        reason: str,
    ) -> None:
        source = read(path)
        hits = [token for token in forbidden if token in source]
        self.assertFalse(
            hits,
            f"{relative(path)} violates architecture guardrail ({reason}): "
            + ", ".join(repr(item) for item in hits),
        )

    def test_business_rule_files_are_pure_of_ui_storage_and_excel_io(self):
        rule_files = sorted((JS_ROOT / "modules").glob("*/rules.js"))
        self.assertGreaterEqual(len(rule_files), 3)

        forbidden = (
            "document.",
            "alert(",
            "confirm(",
            "XLSX.read(",
            "XLSX.write(",
            "ReclassifierDatabaseRepository",
            "ReclassifierLegacyDatasetStore",
            "datasetPipeline",
            "localStorage",
            "sessionStorage",
            "indexedDB",
        )
        for path in rule_files:
            with self.subTest(path=relative(path)):
                self.assert_forbidden_absent(
                    path,
                    forbidden,
                    reason="business rules must stay independent from UI, persistence and Excel adapters",
                )

    def test_kpi_source_facts_are_pure_of_ui_storage_and_excel_io(self):
        path = JS_ROOT / "kpi" / "source_facts.js"
        self.assert_forbidden_absent(
            path,
            (
                "document.",
                "window.",
                "alert(",
                "confirm(",
                "XLSX.",
                "ReclassifierDatabaseRepository",
                "ReclassifierRuntimeDataRepository",
                "ReclassifierLegacyDatasetStore",
                "databaseRuntime.db",
                "datasetPipeline",
                "localStorage",
                "sessionStorage",
                "indexedDB",
                "oo1.DB",
            ),
            reason="KPI source-fact projection must stay pure and storage agnostic",
        )
        source = read(path)
        self.assertIn("officialEquipmentPopulation: false", source)
        self.assertIn("supportsHistoricalPeriods: false", source)
        self.assertIn("linkMobileBrigadeToProblems", source)

    def test_kpi_preparation_is_pure_subject_specific_and_not_a_mega_table(self):
        preparation_root = JS_ROOT / "kpi" / "preparation"
        preparation_files = sorted(preparation_root.glob("*.js"))
        self.assertGreaterEqual(len(preparation_files), 7)

        forbidden = (
            "document.",
            "window.",
            "alert(",
            "confirm(",
            "XLSX.",
            "ReclassifierDatabaseRepository",
            "ReclassifierRuntimeDataRepository",
            "ReclassifierLegacyDatasetStore",
            "databaseRuntime.db",
            "datasetPipeline",
            "localStorage",
            "sessionStorage",
            "indexedDB",
            "oo1.DB",
            "reliabilityDashboard",
        )
        for prep_path in preparation_files:
            with self.subTest(path=relative(prep_path)):
                self.assert_forbidden_absent(
                    prep_path,
                    forbidden,
                    reason="KPI preparation must stay pure and independent from UI/storage",
                )

        combined = "\n".join(read(path) for path in preparation_files)
        self.assertNotIn("driversByMine", combined)
        self.assertNotIn("globalThis.ReclassifierKpiSource.", combined)

        index_source = read(preparation_root / "index.js")
        self.assertIn("architecture: 'subject-component-tables'", index_source)
        self.assertIn("families: Object.freeze({", index_source)
        for family in ("failures", "equipment", "labor", "sla", "classification", "prb"):
            self.assertIn(f"{family}:", index_source)

    def test_kpi_source_core_is_pure_of_ui_storage_and_excel_io(self):
        path = JS_ROOT / "modules" / "itsm" / "kpi_source.js"
        self.assert_forbidden_absent(
            path,
            (
                "document.",
                "alert(",
                "confirm(",
                "XLSX.",
                "ReclassifierDatabaseRepository",
                "ReclassifierLegacyDatasetStore",
                "datasetPipeline",
                "localStorage",
                "sessionStorage",
                "indexedDB",
            ),
            reason="KPI Source aggregation must stay independent from UI, storage and Excel I/O",
        )

    def test_normalizers_do_not_own_ui_or_persistence(self):
        normalizers = (
            JS_ROOT / "references" / "reference_normalizers.js",
            JS_ROOT / "modules" / "failure_classifier" / "normalizer.js",
        )
        forbidden = (
            "document.",
            "alert(",
            "confirm(",
            "ReclassifierDatabaseRepository",
            "ReclassifierLegacyDatasetStore",
            "datasetPipeline",
            "databaseRuntime.db",
            "oo1.DB",
            "localStorage",
            "sessionStorage",
            "indexedDB",
        )
        for path in normalizers:
            with self.subTest(path=relative(path)):
                self.assert_forbidden_absent(
                    path,
                    forbidden,
                    reason="normalizers may transform data but must not render UI or persist datasets",
                )

    def test_worker_processors_are_headless_and_storage_agnostic(self):
        worker_files = sorted((JS_ROOT / "workers").glob("*.js")) + [JS_ROOT / "worker.js"]
        self.assertGreaterEqual(len(worker_files), 4)

        forbidden = (
            "document.",
            "window.",
            "alert(",
            "confirm(",
            "ReclassifierDatabaseRepository",
            "ReclassifierLegacyDatasetStore",
            "datasetPipeline",
            "databaseRuntime.db",
            "localStorage",
            "sessionStorage",
            "indexedDB",
        )
        for path in worker_files:
            with self.subTest(path=relative(path)):
                self.assert_forbidden_absent(
                    path,
                    forbidden,
                    reason="WebWorker code must remain headless and must not own application storage",
                )

    def test_module_ui_does_not_parse_or_write_excel_directly(self):
        ui_files = sorted((JS_ROOT / "modules").glob("*/ui.js"))
        self.assertGreaterEqual(len(ui_files), 4)

        for path in ui_files:
            with self.subTest(path=relative(path)):
                self.assert_forbidden_absent(
                    path,
                    ("XLSX.read(", "XLSX.write("),
                    reason="module UI must delegate workbook I/O to worker/manager adapters",
                )


    def test_dataset_classifier_is_headless_and_shared(self):
        classifier = JS_ROOT / "app" / "dataset_classifier.js"
        self.assert_forbidden_absent(
            classifier,
            (
                "document.",
                "alert(",
                "confirm(",
                "datasetPipeline",
                "ReclassifierDatabaseRepository",
                "ReclassifierLegacyDatasetStore",
                "databaseWorkspaceState",
                "localStorage",
                "sessionStorage",
                "indexedDB",
            ),
            reason="shared Dataset classification must stay independent from UI and persistence",
        )

        reference_probe_ui = read(JS_ROOT / "references" / "reference_probe_ui.js")
        recognizer = read(JS_ROOT / "app" / "database_recognizer.js")
        self.assertNotIn("function classifyWorkbookByStructure(", reference_probe_ui)
        self.assertIn("ReclassifierDatasetClassifier.classifyWorkbook", reference_probe_ui)
        self.assertIn("ReclassifierDatasetClassifier", recognizer)
        self.assertNotIn("typeof classifyWorkbookByStructure", recognizer)


    def test_dataset_catalog_owns_builtin_registration_and_stable_metadata(self):
        catalog = JS_ROOT / "app" / "dataset_catalog.js"
        self.assert_forbidden_absent(
            catalog,
            (
                "document.",
                "alert(",
                "confirm(",
                "XLSX.",
                "ReclassifierDatabaseRepository",
                "ReclassifierLegacyDatasetStore",
                "databaseRuntime.db",
                "localStorage",
                "sessionStorage",
                "indexedDB",
            ),
            reason="Dataset Catalog must remain declarative and independent from UI, parsing and storage engines",
        )

        registration_offenders: list[str] = []
        for path in sorted(JS_ROOT.rglob("*.js")):
            rel = relative(path)
            if rel == "src/js/app/dataset_pipeline.js":
                continue
            if "datasetPipeline.register(" in read(path):
                registration_offenders.append(rel)

        self.assertEqual(
            [],
            registration_offenders,
            "Built-in Dataset registration must be owned by dataset_pipeline.js from Dataset Catalog: "
            + ", ".join(registration_offenders),
        )

        database_contract = read(JS_ROOT / "app" / "database_contract.js")
        self.assertIn("datasetCatalog.list()", database_contract)

        for relative_path in (
            "references/reference_config.js",
            "modules/equipment/equipment_config.js",
            "modules/failure_classifier/config.js",
            "modules/itsm/dataset_schema.js",
        ):
            source = read(JS_ROOT / relative_path)
            self.assertIn(
                "ReclassifierDatasetCatalog",
                source,
                relative_path + " must source stable Dataset metadata from Dataset Catalog",
            )



    def test_html_snapshot_restore_uses_atomic_dataset_batch_commit(self):
        snapshot = read(JS_ROOT / "app" / "html_snapshot.js")
        pipeline = read(JS_ROOT / "app" / "dataset_pipeline.js")

        self.assertIn("async function prepareDatasetPackRestore(pack, restoreMode = 'snapshot')", snapshot)
        self.assertIn("await prepareSnapshotEntry(entry, known, seen, formatVersion, restoreMode)", snapshot)
        self.assertIn("ReclassifierDatasetLifecycleManager.activateBatch(prepared)", snapshot)
        self.assertIn("datasetPipeline.replaceSqliteMirror(prepared)", snapshot)
        self.assertIn("datasetPipeline.replaceSqliteMirror", snapshot)
        self.assertIn("function replaceSqliteMirror(instances)", pipeline)

        self.assertIn("function setActiveBatch(instances)", pipeline)
        self.assertIn("Resolve mutable entries only after the complete batch passed validation.", pipeline)
        self.assertIn("snapshot.current.active = snapshot.active", pipeline)
        self.assertIn("snapshot.current.revision = snapshot.revision", pipeline)

    def test_dataset_lifecycle_manager_is_the_mutation_boundary(self):
        lifecycle = read(JS_ROOT / "app" / "dataset_lifecycle.js")
        reference_manager = read(JS_ROOT / "references" / "reference_manager.js")
        mobile_dataset = read(JS_ROOT / "modules" / "mobile_brigade" / "dataset.js")

        self.assertIn("globalThis.ReclassifierDatasetLifecycleManager", lifecycle)
        self.assertNotIn("referenceConfig", lifecycle)
        self.assertNotIn("mobile_brigade_data", lifecycle)
        self.assertNotIn("itsm_data", lifecycle)

        allowed = {
            "src/js/app/dataset_pipeline.js",
            "src/js/app/dataset_lifecycle.js",
        }
        direct_mutation_tokens = (
            "datasetPipeline.prepare(",
            "datasetPipeline.commit(",
            "datasetPipeline.setActive(",
            "datasetPipeline.setActiveBatch(",
            "datasetPipeline.discard(",
        )
        offenders: list[str] = []
        for path in sorted(JS_ROOT.rglob("*.js")):
            rel = relative(path)
            if rel in allowed:
                continue
            source = read(path)
            hits = [token for token in direct_mutation_tokens if token in source]
            if hits:
                offenders.append(rel + ": " + ", ".join(hits))

        self.assertEqual(
            [],
            offenders,
            "Dataset lifecycle mutation bypasses DatasetLifecycleManager: " + "; ".join(offenders),
        )
        self.assertNotIn("prepareGeneratedReference", reference_manager)
        self.assertNotIn("hydrateEmbeddedMobileBrigadeData", reference_manager)
        self.assertIn("ReclassifierDatasetLifecycleManager", reference_manager)
        self.assertIn("ReclassifierDatasetLifecycleManager", mobile_dataset)
        self.assertNotIn("ReclassifierReferenceManager", mobile_dataset)

    def test_subject_modules_do_not_reference_removed_worker_instance(self):
        for relative_path in (
            "modules/reclassification/ui.js",
            "modules/itsm/ui.js",
            "modules/mobile_brigade/ui.js",
        ):
            source = read(JS_ROOT / relative_path)
            self.assertNotIn("if (!worker)", source)
            self.assertIn("workerRequest(", source)

    def test_worker_client_owns_pending_request_and_fatal_cleanup(self):
        client = read(JS_ROOT / "app" / "worker_client.js")
        runtime = read(JS_ROOT / "app" / "runtime.js")

        for token in (
            "pendingRequests = new Map()",
            "function rejectAllPending(error)",
            "addEventListener('error'",
            "addEventListener('messageerror'",
            "RECLASSIFIER_WORKER_FATAL",
            "worker.terminate",
            "clearTimer(request.timeout)",
        ):
            self.assertIn(token, client)

        self.assertIn("createWorkerClient({", runtime)
        self.assertIn("workerClient.request(", runtime)
        self.assertIn("workerClient.post(", runtime)
        self.assertNotIn("workerRequests = new Map()", runtime)
        self.assertNotIn("settleWorkerRequest(", runtime)

    def test_database_ui_does_not_reach_raw_sqlite(self):
        database_ui_files = (
            "database_ui_state.js",
            "database_intake_ui.js",
            "database_connection_ui.js",
            "database_integration_ui.js",
            "database_audit_ui.js",
            "database_view_renderers.js",
            "database_ui.js",
        )
        for name in database_ui_files:
            path = JS_ROOT / "app" / name
            with self.subTest(path=relative(path)):
                self.assert_forbidden_absent(
                    path,
                    (
                        "databaseRuntime.db",
                        "oo1.DB",
                        "sqlite3InitModule",
                        "sqlite3.capi",
                        "sqlite3.wasm",
                    ),
                    reason="Database Workspace UI must use Repository/Integration APIs instead of raw SQLite",
                )

    def test_large_workspace_ui_remains_split_into_narrow_components(self):
        reference_dir = JS_ROOT / "references"
        app_dir = JS_ROOT / "app"

        reference_files = (
            "reference_ui_common.js",
            "reference_probe_ui.js",
            "reference_preview_ui.js",
            "reference_detail_ui.js",
            "reference_ui.js",
        )
        database_files = (
            "database_ui_state.js",
            "database_intake_ui.js",
            "database_connection_ui.js",
            "database_integration_ui.js",
            "database_audit_ui.js",
            "database_view_renderers.js",
            "database_ui.js",
        )

        for directory, names in ((reference_dir, reference_files), (app_dir, database_files)):
            for name in names:
                source = read(directory / name)
                with self.subTest(path=name):
                    self.assertLess(
                        len(source),
                        30000,
                        name + " must remain a narrow UI component instead of regrowing a monolith",
                    )

        reference_route = read(reference_dir / "reference_ui.js")
        reference_detail = read(reference_dir / "reference_detail_ui.js")
        self.assertNotIn("function classifyProbeFile(", reference_route)
        self.assertNotIn("function renderReferenceValidation(", reference_route)
        self.assertNotIn("function renderReferenceDetail(", reference_route)
        self.assertIn("function renderReferenceDetail(", reference_detail)

        database_route = read(app_dir / "database_ui.js")
        self.assertNotIn("const databaseWorkspaceState", database_route)
        self.assertNotIn("function databaseAcceptExcelFiles(", database_route)
        self.assertNotIn("function databaseCreateNew(", database_route)
        self.assertNotIn("function databaseCommitIntegration(", database_route)
        self.assertNotIn("function databaseAuditSnapshot(", database_route)



    def test_legacy_sqlite_parity_regression_uses_real_runtime_layers(self):
        parity = (ROOT / "tests" / "test_legacy_sqlite_parity.js").read_text(encoding="utf-8")

        for token in (
            "database_bootstrap.js",
            "data_repository.js",
            "database_core.js",
            "equipment_logic.js",
            "bootstrap.collectSeeds()",
            "database.bootstrapDatasets(seeds)",
            "runtime.invalidate()",
            "assertPersistedParity",
            "semanticCombined",
            "database.exportDatabase()",
            "database.openDatabase(exported",
        ):
            self.assertIn(token, parity)

        self.assertIn("test_legacy_sqlite_parity.js", read(ROOT / ".github" / "workflows" / "build.yml"))


    def test_sqlite_wasmfs_lifecycle_is_explicit_and_regressed(self):
        core = read(JS_ROOT / "app" / "database_core.js")
        lifecycle_test = (ROOT / "tests" / "test_database_wasmfs_lifecycle.js").read_text(
            encoding="utf-8"
        )
        workflow = read(ROOT / ".github" / "workflows" / "build.yml")

        for token in (
            "function databaseHandleVfs(",
            "function unlinkInternalDatabaseFile(",
            "sqlite.capi.sqlite3_js_db_vfs",
            "sqlite.wasm?.exports?.sqlite3__wasm_vfs_unlink",
            "sqlite.wasm?.allocCString",
            "sqlite.wasm?.dealloc",
            "function publishHandle(",
            "previous.filename",
            "previous.pVfs",
            "unlinkInternalDatabaseFile(filename, sqlite, pVfs)",
            "closeHandle({ removeFile: true })",
        ):
            self.assertIn(token, core)

        for token in (
            "Successful openDatabase leaked the previous SQLite VFS file.",
            "Successful createDatabase leaked the previous SQLite VFS file.",
            "Rejected replacement candidate leaked a SQLite VFS file.",
            "closeDatabase leaked the final SQLite VFS file.",
        ):
            self.assertIn(token, lifecycle_test)

        self.assertIn("test_database_wasmfs_lifecycle.js", workflow)

    def test_vendor_dependencies_are_cryptographically_pinned(self):
        build_source = read(ROOT / "build" / "build.py")
        vendor_test = (ROOT / "tests" / "test_vendor_integrity.py").read_text(encoding="utf-8")

        for token in (
            'SHEETJS_SHA256 = "',
            'SQLITE_WASM_ZIP_SHA3_256 = "',
            "hashlib.sha256(source_bytes).hexdigest()",
            "hashlib.sha3_256(archive_bytes).hexdigest()",
            "assert_digest(",
            "Unverified SQLite vendor pair is not accepted.",
            '"excelParserSha256": SHEETJS_SHA256',
            '"sqliteWasmReleaseSha3_256": SQLITE_WASM_ZIP_SHA3_256',
        ):
            self.assertIn(token, build_source)

        self.assertIn("test_tampered_sheetjs_is_rejected", vendor_test)
        self.assertIn("test_unverified_loose_sqlite_vendor_pair_is_rejected", vendor_test)
        self.assertIn("test_wrong_local_sqlite_release_archive_fails_before_extraction", vendor_test)


    def test_database_registry_contract_is_validated_against_catalog(self):
        core = read(JS_ROOT / "app" / "database_core.js")
        self.assertIn("function databaseRegistryContractCheck(db)", core)
        self.assertIn("dataset_schema_version", core)
        self.assertIn("integration_strategy", core)
        self.assertIn("key_field", core)
        self.assertIn("allow_empty", core)
        self.assertIn("persisted", core)
        self.assertIn("Dataset Registry несовместим с текущим Dataset Catalog", core)
        self.assertIn("registryContractMismatches", core)
        self.assertIn("unexpectedRegistryDatasets", core)

    def test_database_repository_public_boundary_owns_operation_mutex(self):
        core = read(JS_ROOT / "app" / "database_core.js")
        self.assertIn("RECLASSIFIER_DATABASE_BUSY", core)
        self.assertIn("getOperationState: databaseOperationState", core)

        for operation in (
            "openDatabase",
            "createDatabase",
            "bootstrapDatasets",
            "upsertDatasetAsync",
        ):
            self.assertIn(
                f"databaseAsyncOperation('{operation}'",
                core,
                operation + " must hold the Repository mutex across async yields",
            )

        for operation in (
            "getDatabaseInfo",
            "getDatasetRegistry",
            "replaceDataset",
            "upsertDataset",
            "exportDatabase",
            "closeDatabase",
        ):
            self.assertIn(
                f"databaseSyncOperation('{operation}'",
                core,
                operation + " must fail fast while another Repository operation owns the mutex",
            )

    def test_raw_sqlite_handle_is_confined_to_database_core(self):
        allowed = {
            "src/js/app/database_core.js",
        }
        low_level_tokens = (
            "databaseRuntime.db",
            "oo1.DB",
            "sqlite3InitModule",
        )

        offenders: list[str] = []
        for path in sorted(JS_ROOT.rglob("*.js")):
            rel = relative(path)
            if rel in allowed:
                continue
            source = read(path)
            hits = [token for token in low_level_tokens if token in source]
            if hits:
                offenders.append(rel + ": " + ", ".join(hits))

        self.assertEqual(
            [],
            offenders,
            "Raw SQLite handle/initialization escaped database_core.js: " + "; ".join(offenders),
        )

    def test_legacy_dataset_store_access_is_confined_to_compatibility_bridge(self):
        allowed = {
            "src/js/app/data_repository.js",
            "src/js/app/database_bootstrap.js",
            "src/js/app/dataset_pipeline.js",
        }

        offenders: list[str] = []
        for path in sorted(JS_ROOT.rglob("*.js")):
            rel = relative(path)
            if "ReclassifierLegacyDatasetStore" in read(path) and rel not in allowed:
                offenders.append(rel)

        self.assertEqual(
            [],
            offenders,
            "Direct Legacy Dataset Store access must stay inside compatibility bridge files: "
            + ", ".join(offenders),
        )

    def test_subject_modules_do_not_bypass_runtime_repository_with_database_core(self):
        forbidden = (
            "ReclassifierDatabaseRepository",
            "ReclassifierLegacyDatasetStore",
            "databaseRuntime.db",
            "oo1.DB",
        )
        module_files = sorted((JS_ROOT / "modules").rglob("*.js"))
        self.assertGreater(len(module_files), 10)

        for path in module_files:
            with self.subTest(path=relative(path)):
                self.assert_forbidden_absent(
                    path,
                    forbidden,
                    reason="subject modules must use runtime repository/lifecycle contracts, not database internals",
                )


    def test_kpi_report_architecture_separates_sources_calculation_and_rendering(self):
        contract_path = ROOT / "docs" / "architecture" / "kpi_calculation_contract.md"
        self.assertTrue(contract_path.exists(), "KPI architecture contract must stay in the repository")
        contract = read(contract_path)
        normalized_contract = " ".join(contract.split())

        for token in (
            "The wide processed ITSM and Mobile Brigade Datasets remain the analytical fact base.",
            "They must not be replaced by one universal physical KPI aggregate table.",
            "WEB and PDF must render the same Report Snapshot.",
            "Its current role is auxiliary and ITSM-specific.",
            "Preparation logic is expected to change more often than the mathematical formula.",
        ):
            self.assertIn(" ".join(token.split()), normalized_contract)

        dashboard = JS_ROOT / "app" / "reliability_dashboard.js"
        self.assert_forbidden_absent(
            dashboard,
            (
                "ReclassifierDatabaseRepository",
                "ReclassifierRuntimeDataRepository",
                "ReclassifierKpiSource",
                "databaseRuntime.db",
                "datasetPipeline",
                "oo1.DB",
                "XLSX.",
            ),
            reason="reliability Dashboard must render a report contract instead of reading source/storage layers",
        )
        dashboard_source = read(dashboard)
        self.assertIn("Must not: calculate KPI values", dashboard_source)
        for forbidden_demo_token in (
            "volumeFactor",
            "qualityOffset",
            "technicalOffset",
            "serviceOffset",
            "problemShareOffset",
            "KPI · demo",
            "График · demo",
        ):
            self.assertNotIn(forbidden_demo_token, dashboard_source)
        self.assertIn("ReclassifierReliabilityReportService", dashboard_source)

        kpi_source = read(JS_ROOT / "modules" / "itsm" / "kpi_source.js")
        self.assertIn("processed ITSM rows", kpi_source)
        self.assertNotIn("Report Snapshot", kpi_source)
        self.assertNotIn("reliabilityDashboard", kpi_source)

    def test_report_snapshot_is_immutable_and_calculation_free(self):
        path = JS_ROOT / "kpi" / "report_snapshot.js"
        self.assert_forbidden_absent(
            path,
            (
                "document.",
                "window.",
                "XLSX.",
                "ReclassifierRuntimeDataRepository",
                "ReclassifierDatabaseRepository",
                "ReclassifierKpiPreparation",
                "ReclassifierKpiCalculator",
                "datasetPipeline",
                "localStorage",
                "sessionStorage",
                "indexedDB",
                "Date.now(",
                "new Date(",
            ),
            reason="Report Snapshot must freeze supplied report results without recalculating them",
        )
        source = read(path)
        self.assertIn("function deepFreeze(", source)
        self.assertIn("calculatedAt", source)
        self.assertIn("globalThis.ReclassifierReportSnapshot", source)

    def test_reliability_report_service_is_headless_runtime_adapter(self):
        path = JS_ROOT / "app" / "reliability_report_service.js"
        self.assert_forbidden_absent(
            path,
            (
                "document.",
                "window.",
                "XLSX.",
                "ReclassifierDatabaseRepository",
                "databaseRuntime.db",
                "oo1.DB",
                "innerHTML",
            ),
            reason="report service may orchestrate runtime data/calculators but must not render or use storage internals",
        )
        source = read(path)
        self.assertIn("ReclassifierRuntimeDataRepository", source)
        self.assertIn("ReclassifierKpiComputationService", source)
        self.assertIn("computation.prepare(", source)
        self.assertIn("computation.calculate(", source)
        self.assertNotIn("preparation.prepare(", source)
        self.assertNotIn("calculator.calculate(", source)
        self.assertIn("ReclassifierReportSnapshot", source)
        self.assertIn("sourceSignature", source)
        self.assertIn("activeRevision", source)

    def test_kpi_computation_service_is_pure_of_ui_storage_and_formulas(self):
        path = JS_ROOT / "app" / "kpi_computation_service.js"
        self.assert_forbidden_absent(
            path,
            (
                "document.",
                "window.",
                "XLSX.",
                "ReclassifierRuntimeDataRepository",
                "ReclassifierDatabaseRepository",
                "databaseRuntime.db",
                "oo1.DB",
                "datasetPipeline",
                "localStorage",
                "sessionStorage",
                "indexedDB",
                "innerHTML",
            ),
            reason="computation service must not own UI, persistence or runtime storage",
        )
        source = read(path)
        self.assertIn("ReclassifierKpiPreparation", source)
        self.assertIn("ReclassifierKpiCalculator", source)
        self.assertIn("ReclassifierKpiCatalog", source)
        self.assertIn("RECLASSIFIER_KPI_STALE_PREPARED", source)
        self.assertIn("globalThis.ReclassifierKpiComputationService = api", source)

    def test_reliability_pdf_renderer_reads_snapshot_only(self):
        path = JS_ROOT / "app" / "reliability_pdf.js"
        self.assert_forbidden_absent(
            path,
            (
                "ReclassifierRuntimeDataRepository",
                "ReclassifierDatabaseRepository",
                "ReclassifierLegacyDatasetStore",
                "ReclassifierKpiPreparation",
                "ReclassifierKpiCalculator",
                "ReclassifierReliabilityReportService",
                "datasetPipeline",
                "databaseRuntime.db",
                "oo1.DB",
                "XLSX.",
                "localStorage",
                "sessionStorage",
                "indexedDB",
            ),
            reason="PDF renderer must consume the supplied Report Snapshot only",
        )
        source = read(path)
        self.assertIn("Must not: read Dataset storage", source)
        self.assertIn("function snapshotFingerprint(", source)
        self.assertIn("function buildPdfBytes(", source)
        self.assertIn("application/pdf", source)
        self.assertIn("globalThis.ReclassifierReliabilityPdfRenderer", source)

        dashboard = read(JS_ROOT / "app" / "reliability_dashboard.js")
        self.assertIn("renderer.download(dashboard.snapshot, {", dashboard)
        self.assertIn("onProgress: update =>", dashboard)
        self.assertNotIn("будет подключён следующим шагом", dashboard)

    def test_kpi_calculator_layer_reads_only_prepared_components(self):
        calculator_root = JS_ROOT / "kpi" / "calculator"
        calculator_files = sorted(calculator_root.rglob("*.js"))
        self.assertGreaterEqual(len(calculator_files), 7)

        forbidden = (
            "document.",
            "window.",
            "XLSX.",
            "ReclassifierKpiSourceFacts",
            "ReclassifierRuntimeDataRepository",
            "ReclassifierDatabaseRepository",
            "ReclassifierLegacyDatasetStore",
            "databaseRuntime.db",
            "datasetPipeline",
            "localStorage",
            "sessionStorage",
            "indexedDB",
            "oo1.DB",
            "reliabilityDashboard",
            "Date.now(",
        )
        for calculator_path in calculator_files:
            with self.subTest(path=relative(calculator_path)):
                self.assert_forbidden_absent(
                    calculator_path,
                    forbidden,
                    reason="KPI calculator must use prepared components only and stay pure",
                )

        index_source = read(calculator_root / "index.js")
        self.assertIn("architecture: 'pure-kpi-results'", index_source)
        self.assertNotIn("calculatedAt", index_source)

        definitions = read(calculator_root / "definitions.js")
        for kpi_id in (
            "vbr",
            "sla",
            "classification_quality",
            "total_labor",
            "avr_labor",
            "avr_share",
            "maintenance_labor",
            "corrective_labor",
            "reactive_share",
            "problem_coverage_absolute",
            "problem_coverage_relative",
        ):
            self.assertIn(kpi_id, definitions)

    def test_future_kpi_formula_modules_are_pure_by_default(self):
        kpi_root = JS_ROOT / "kpi"
        formula_files = sorted(kpi_root.rglob("calculate.js")) if kpi_root.exists() else []

        forbidden = (
            "document.",
            "window.",
            "alert(",
            "confirm(",
            "XLSX.",
            "ReclassifierDatabaseRepository",
            "ReclassifierRuntimeDataRepository",
            "ReclassifierLegacyDatasetStore",
            "databaseRuntime.db",
            "datasetPipeline",
            "localStorage",
            "sessionStorage",
            "indexedDB",
            "oo1.DB",
        )
        for path in formula_files:
            with self.subTest(path=relative(path)):
                self.assert_forbidden_absent(
                    path,
                    forbidden,
                    reason="KPI formula modules must stay pure and receive prepared calculation components",
                )


if __name__ == "__main__":
    unittest.main()
