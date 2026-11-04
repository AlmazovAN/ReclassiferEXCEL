from __future__ import annotations

import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

DB_UI_FILES = (
    "database_ui_state.js",
    "database_intake_ui.js",
    "database_connection_ui.js",
    "database_integration_ui.js",
    "database_audit_ui.js",
    "database_view_renderers.js",
    "database_recalculation_ui.js",
    "database_ui.js",
)


def database_ui_source() -> str:
    directory = ROOT / "src" / "js" / "app"
    return "\n".join(
        (directory / name).read_text(encoding="utf-8")
        for name in DB_UI_FILES
    )


class DatabaseWorkspaceContractTests(unittest.TestCase):
    def test_pr04_central_journal_preserves_database_health_actions(self):
        ui = (ROOT / "src" / "js" / "app" / "database_ui.js").read_text(encoding="utf-8")
        mb = (ROOT / "src" / "js" / "modules" / "mobile_brigade" / "ui.js").read_text(encoding="utf-8")
        journal_ui = (ROOT / "src" / "js" / "app" / "system.js").read_text(encoding="utf-8")
        for name in ("checkDatabaseButton", "downloadApplicationHtmlButton",
                     "openDatabaseLegacyButton", "databaseHealthMarkup(info)",
                     "databaseAutoSaveToggle", "databaseCreateRecovery"):
            self.assertIn(name, ui)
        self.assertIn("id=\"databaseOpenJournalButton\"", ui)
        self.assertNotIn("Дополнительные действия и диагностика", ui)
        self.assertIn("id=\"mobileBrigadeOpenJournalButton\"", mb)
        self.assertIn("renderDatasetCandidate('mobile_brigade_data'", mb)
        self.assertIn("id=\"copyLogButton\"", journal_ui)
        self.assertIn("id=\"downloadLogJsonButton\"", journal_ui)
        self.assertIn("id=\"clearLogButton\"", journal_ui)
        self.assertIn("function copyDiagnosticJournal()", journal_ui)
        self.assertIn("function downloadDiagnosticJournalJson()", journal_ui)

    def test_database_route_and_controls_are_present(self):
        index = (ROOT / "src" / "ui" / "index.html").read_text(encoding="utf-8")
        core = (ROOT / "src" / "js" / "app" / "core.js").read_text(encoding="utf-8")
        ui = database_ui_source()

        self.assertIn('data-route="database"', index)
        self.assertIn("state.route === 'database'", core)
        for marker in (
            "Развернуть БД из HTML",
            "Открыть существующую БД",
            "Синхронизировать подключённую БД",
            "Скачать Reclassifier.db",
            "Загрузить Excel",
            "databaseExcelDropzone",
            "Действующие справочники",
            "Проверить целостность",
            "Переносимость и целостность",
        ):
            self.assertIn(marker, ui)

    def test_direct_write_never_confuses_runtime_refresh_with_disk_save(self):
        core = (ROOT / "src" / "js" / "app" / "database_core.js").read_text(encoding="utf-8")
        ui = database_ui_source()
        self.assertIn("saveDatabaseToFile: databaseAsyncOperation(", core)
        self.assertIn("databaseRuntime.dirty = false;", core)
        self.assertIn("await writable.close();", core)
        self.assertIn("saved.slice(offset, end).arrayBuffer()", core)
        self.assertIn("fileHandle.createWritable({ mode: 'exclusive' })", core)
        self.assertIn("databaseSaveConnected()", ui)
        self.assertIn("showOpenFilePicker", ui)
        self.assertNotIn('id="refreshDatabaseButton"', ui)
        self.assertIn('id="saveConnectedDatabaseButton"', ui)

    def test_pr7_recalculation_controls_and_single_explicit_commit(self):
        ui = database_ui_source()
        orchestrator = (ROOT / "src" / "js" / "app" / "recalculation_workspace.js").read_text(encoding="utf-8")
        commit = (ROOT / "src" / "js" / "app" / "recalculation_commit.js").read_text(encoding="utf-8")
        itsm = (ROOT / "src" / "js" / "modules" / "itsm" / "recalculation.js").read_text(encoding="utf-8")
        for marker in (
            "Пересчёт и актуализация данных",
            "Предварительный пересчёт",
            "Применить изменения",
            "databaseRecalculationItsm",
            "databaseRecalculationMb",
            "databaseRecalculationCancelButton",
            "databaseBindRecalculation();",
            "databaseRecalculationMarkup()",
        ):
            self.assertIn(marker, ui)
        self.assertIn("steps.push(brigades.createStep())", orchestrator)
        self.assertIn("steps.push(tickets.createStep())", orchestrator)
        self.assertIn("assertCurrent(plan)", orchestrator)
        self.assertIn("applied.add(plan)", orchestrator)
        self.assertIn("createStep,", itsm)
        self.assertIn("confirmed !== true", commit)
        self.assertNotIn("upsertDataset(", ui)
        self.assertNotIn("replaceDataset(", ui)

    def test_new_database_bootstraps_embedded_html_datasets(self):
        core = (ROOT / "src" / "js" / "app" / "database_core.js").read_text(encoding="utf-8")
        bootstrap = (ROOT / "src" / "js" / "app" / "database_bootstrap.js").read_text(encoding="utf-8")
        ui = database_ui_source()

        self.assertIn("async function bootstrapDatasets", core)
        self.assertIn("BEGIN IMMEDIATE", core)
        self.assertIn("ROLLBACK", core)
        self.assertIn("batchSize = 1000", core)
        self.assertIn("ReclassifierDatabaseBootstrap", bootstrap)
        self.assertIn("collectSeeds", bootstrap)
        self.assertIn("bootstrapDatasets(", ui)
        self.assertIn("databaseBootstrapProgress", ui)
        self.assertNotIn("id=\"closeDatabaseButton\"", ui)

    def test_step10_storage_mode_separation_and_dead_code_cleanup(self):
        runtime = (ROOT / "src" / "js" / "app" / "data_repository.js").read_text(encoding="utf-8")
        core = (ROOT / "src" / "js" / "app" / "database_core.js").read_text(encoding="utf-8")
        home = (ROOT / "src" / "js" / "app" / "home.js").read_text(encoding="utf-8")
        snapshot = (ROOT / "src" / "js" / "app" / "html_snapshot.js").read_text(encoding="utf-8")
        integration = (ROOT / "src" / "js" / "app" / "database_integration.js").read_text(encoding="utf-8")
        self.assertIn("hasOpenDatabase", core)
        self.assertIn("hasOpenDatabase", runtime)
        self.assertIn("Автоматическое переключение на HTML Dataset запрещено", runtime)
        self.assertIn("function sqliteSnapshotFingerprint()", snapshot)
        self.assertIn("async function synchronizeSqliteToHtml()", snapshot)
        self.assertNotIn("Перейти к экспорту Reclassifier.db", home)
        self.assertNotIn("const referenceCount = sqliteMode", home)
        self.assertNotIn("Состояние аналитического ядра", home)
        self.assertNotIn("Подключено справочников", home)
        self.assertNotIn("Сохранить текущие данные", home)
        self.assertNotIn("renderReferenceDirectoryProbe()", home)
        self.assertIn("Синхронизация и переносимый HTML", database_ui_source())
        self.assertNotIn("${Object.keys(state.references).length}", home)
        self.assertNotIn("function incomingKeyMap(", core)
        self.assertNotIn("function integrationCurrentDataset(", integration)

    def test_home_cards_moved_to_database_workspace(self):
        home = (ROOT / "src" / "js" / "app" / "home.js").read_text(encoding="utf-8")
        db = database_ui_source()
        index = (ROOT / "src" / "ui" / "index.html").read_text(encoding="utf-8")
        self.assertIn("Продвинутая обработка файлов Excel", home)
        self.assertIn("Файлы обрабатываются только на Вашем компьютере.", home)
        self.assertIn("Все сетевые обращения принудительно заблокированы.", home)
        self.assertIn("Локальная обработка данных", index)
        self.assertIn("assets.homeArtwork", home)
        self.assertIn("module-card-artwork", home)
        for marker in ("renderReferenceDirectoryProbe()", "testDirectoryHandleButton",
                       "testWebkitDirectoryButton", "downloadUpdatedHtmlButton",
                       "Синхронизация и переносимый HTML"):
            self.assertIn(marker, db)
            self.assertNotIn(marker, home)
        self.assertNotIn("Состояние аналитического ядра", home)
        self.assertNotIn("Подключено справочников", home)

    def test_step9_async_cancel_and_dataset_only(self):
        core = (ROOT / "src" / "js" / "app" / "database_core.js").read_text(encoding="utf-8")
        ui = database_ui_source()
        worker = (ROOT / "src" / "js" / "workers" / "itsm_processor.js").read_text(encoding="utf-8")
        integration = (ROOT / "src" / "js" / "app" / "database_integration.js").read_text(encoding="utf-8")
        self.assertIn("async function upsertDatasetAsync", core)
        self.assertIn("db.exec('ROLLBACK')", core)
        self.assertIn("status: cancelled ? 'ROLLED_BACK' : 'FAILED'", core)
        self.assertIn("database-abort-integration-button", ui)
        self.assertIn("databaseIntegrationProgressBar", ui)
        self.assertIn("datasetOnly: true", integration)
        self.assertIn("if (!datasetOnly)", worker)
        self.assertIn("databaseInputHeader", core)

    def test_itsm_field_diff_is_aggregated_without_exposing_values(self):
        core = (ROOT / "src" / "js" / "app" / "database_core.js").read_text(encoding="utf-8")
        ui = database_ui_source()
        integration = (ROOT / "src" / "js" / "app" / "database_integration.js").read_text(encoding="utf-8")
        self.assertIn("fieldCounters", core)
        self.assertIn("sourceChangedRows", core)
        self.assertIn("derivedChangedRows", core)
        self.assertIn("databaseIntegrationFieldDiffMarkup", ui)
        self.assertNotIn("sourceMatch", integration)
        self.assertNotIn("Проверка исходного файла:", ui)

    def test_excel_intake_prepares_candidates_in_background_and_confirms_commit(self):
        ui = database_ui_source()
        renderers = (ROOT / "src" / "js" / "app" / "database_view_renderers.js").read_text(encoding="utf-8")
        integration_ui = (ROOT / "src" / "js" / "app" / "database_integration_ui.js").read_text(encoding="utf-8")
        intake_ui = (ROOT / "src" / "js" / "app" / "database_intake_ui.js").read_text(encoding="utf-8")

        self.assertIn("ReclassifierDatasetRecognizer", ui)
        self.assertIn("ReclassifierDatasetDbStateModel", renderers)
        self.assertIn("bindDatasetDropzone(", ui)
        self.assertIn("Очередь", ui)
        self.assertIn("Изменения БД", renderers)
        self.assertIn("в файле:", renderers)
        self.assertIn("database-remove-intake-button", renderers)
        self.assertIn("databaseRemoveIntakeItem", intake_ui)
        self.assertIn("databaseRequestQueuePreparation('files-added')", intake_ui)
        self.assertIn("function databasePrepareIntakeQueue(", integration_ui)
        self.assertIn("function databasePrepareCandidate(", integration_ui)
        self.assertIn("databaseReprepareQueueCandidates('post-commit')", integration_ui)
        self.assertIn("Подтвердить", renderers)
        self.assertIn("формируется кандидат", renderers)
        self.assertIn("database-confirm-integration-button", renderers)
        self.assertIn("await databaseCommitIntegration(index);", integration_ui)
        self.assertIn("Прервать", renderers)
        self.assertIn("database-abort-integration-button", renderers)
        self.assertIn("saveConnectedDatabaseButton", ui)
        self.assertIn("databaseSaveConnected", ui)
        self.assertIn("runtime?.invalidate?.(", ui)
        self.assertNotIn("databaseSynchronizeWorkspace('manual-refresh'", ui)

        # Background preparation is read-only; UI mutation still goes only through commit.
        self.assertNotIn(".replaceDataset(", ui)
        self.assertNotIn(".upsertDataset(", ui)
        self.assertNotIn("database-integrate-button", renderers)



    def test_active_references_show_three_source_states(self):
        ui = database_ui_source()
        renderers = (ROOT / "src" / "js" / "app" / "database_view_renderers.js").read_text(encoding="utf-8")
        state_model = (ROOT / "src" / "js" / "app" / "dataset_db_state_model.js").read_text(encoding="utf-8")

        self.assertIn("Действующие справочники", ui)
        self.assertIn("databaseRenderActiveReferenceRows", ui)
        self.assertIn("ReclassifierDatasetDbStateModel?.datasets?.()", ui)
        self.assertIn("SchAPP", renderers)
        self.assertIn("SchDB", renderers)
        self.assertIn("start HTML", renderers)
        self.assertIn("SQLite DB", renderers)
        self.assertIn("active Runtime", renderers)
        self.assertIn("database-source-badge", renderers)
        self.assertIn("databaseActiveFreshnessMarkup", renderers)
        self.assertIn("databaseActiveAttemptMarkup", renderers)
        self.assertIn("latestAttempt", state_model)
        self.assertNotIn("databaseRenderDatasetRows", ui)


    def test_database_actions_share_synchronization_barrier(self):
        ui = database_ui_source()
        state_ui = (ROOT / "src" / "js" / "app" / "database_ui_state.js").read_text(encoding="utf-8")
        connection_ui = (ROOT / "src" / "js" / "app" / "database_connection_ui.js").read_text(encoding="utf-8")
        integration_ui = (ROOT / "src" / "js" / "app" / "database_integration_ui.js").read_text(encoding="utf-8")
        renderers = (ROOT / "src" / "js" / "app" / "database_view_renderers.js").read_text(encoding="utf-8")

        self.assertIn("function databaseSynchronizeWorkspace(", state_ui)
        self.assertIn("Runtime не синхронизирован с SQLite", state_ui)
        self.assertIn("databaseSynchronizationText", state_ui)
        self.assertIn("databaseSynchronizeWorkspace('database-created'", connection_ui)
        self.assertIn("databaseSynchronizeWorkspace('database-opened'", connection_ui)
        self.assertNotIn("databaseSynchronizeWorkspace('manual-refresh'", connection_ui)
        self.assertIn("databaseSaveConnected(automatic = false)", connection_ui)
        self.assertIn("databaseSaveConnected()", ui)
        self.assertIn("databaseSynchronizeWorkspace('integration-committed'", integration_ui)
        self.assertIn("changedDatasetIds: [plan.inspection.datasetId]", integration_ui)
        self.assertIn("function databaseCommitEquipmentBatch(", integration_ui)
        self.assertIn("engine.commitBatch(plans)", integration_ui)
        self.assertIn("equipment-batch-committed", integration_ui)
        self.assertIn("derivedCandidates: result.derivedCandidates", integration_ui)
        self.assertIn("Equipment-пакет", renderers)
        self.assertIn("Применить пакет", renderers)
        self.assertIn("runtime.refreshDerived", state_ui)
        self.assertIn("integration-rolled-back", integration_ui)
        self.assertIn("Синхронизация Runtime", ui)
        self.assertIn("item.synchronizationError", integration_ui)

    def test_database_audit_uses_full_history_overview(self):
        core = (ROOT / "src" / "js" / "app" / "database_core.js").read_text(encoding="utf-8")
        ui = database_ui_source()

        self.assertIn("function getImportOverview()", core)
        self.assertIn("ROW_NUMBER() OVER", core)
        self.assertIn("latestAttemptByDataset", core)
        self.assertIn("latestCommittedByDataset", core)
        self.assertIn("getImportOverview()", ui)
        self.assertIn("databaseRenderHistoryRows", ui)
        self.assertIn("databaseHistoryDetails", ui)
        self.assertIn("rows_inserted", ui)
        self.assertIn("rows_updated", ui)
        self.assertIn("rows_deleted", ui)

    def test_integration_engine_uses_repository_transactions(self):
        engine = (ROOT / "src" / "js" / "app" / "database_integration.js").read_text(encoding="utf-8")
        core = (ROOT / "src" / "js" / "app" / "database_core.js").read_text(encoding="utf-8")

        self.assertIn("previewDatasetChange", engine)
        self.assertIn("repository.upsertDataset", engine)
        self.assertIn("repository.getDatasetRegistry", engine)
        self.assertIn("getMobileBrigadeRowsForRequests(requestKeys)", engine)
        self.assertNotIn("const existingRows = queryRows(\n      db,\n      'SELECT record_key, ordinal, record_json", core)
        self.assertIn("repository.replaceDataset", engine)
        self.assertIn("databaseUuid !== plan.databaseUuid", engine)
        self.assertGreaterEqual(core.count("db.transaction('IMMEDIATE'"), 4)
        self.assertIn("insertImportHistory", core)

    def test_runtime_repository_makes_sqlite_authoritative(self):
        pipeline = (ROOT / "src" / "js" / "app" / "dataset_pipeline.js").read_text(encoding="utf-8")
        repository = (ROOT / "src" / "js" / "app" / "data_repository.js").read_text(encoding="utf-8")
        equipment = (ROOT / "src" / "js" / "modules" / "equipment" / "equipment_logic.js").read_text(encoding="utf-8")

        self.assertIn("ReclassifierLegacyDatasetStore", pipeline)
        self.assertIn("currentDatasetStore()", pipeline)
        self.assertIn("assertLegacyWriteAllowed", pipeline)
        self.assertIn("function runtimeSqliteInstance", repository)
        self.assertIn("active_revision", repository)
        self.assertIn("return runtimeSqliteInstance(id)", repository)
        self.assertIn("return null;", repository)
        self.assertIn("registerDerived", repository)
        self.assertIn("buildRuntimeEquipmentCombined", equipment)

    def test_database_core_preserves_current_session_until_new_db_is_valid(self):
        core = (ROOT / "src" / "js" / "app" / "database_core.js").read_text(encoding="utf-8")

        create_start = core.index("async function createDatabase")
        open_start = core.index("async function openDatabase")
        validate_start = core.index("function validateDatabase")
        create_body = core[create_start:open_start]
        open_body = core[open_start:validate_start]

        # No early close before the new handle has been built/validated.
        self.assertNotIn("closeHandle();\n    const filename", create_body)
        self.assertNotIn("assertSqliteHeader(bytes);\n    closeHandle();", open_body)

        self.assertIn("const validation = validateHandle(db);", create_body)
        self.assertIn("assertWritableValidation(validation);", create_body)
        self.assertIn("publishHandle(", create_body)

        self.assertIn("const validation = validateHandle(db);", open_body)
        self.assertIn("assertWritableValidation(validation);", open_body)
        self.assertIn("assertHandleIntegrity(db);", open_body)
        self.assertIn("publishHandle(", open_body)

        publish_start = core.index("function publishHandle")
        publish_end = core.index("function internalFileName", publish_start)
        publish_body = core[publish_start:publish_end]
        self.assertIn("const previous = closeHandle();", publish_body)
        self.assertIn("previous.filename", publish_body)
        self.assertIn("previous.pVfs", publish_body)
        self.assertIn("unlinkInternalDatabaseFile(", publish_body)

    def test_sqlite_wasm_is_instantiated_from_embedded_bytes(self):
        core = (ROOT / "src" / "js" / "app" / "database_core.js").read_text(encoding="utf-8")
        self.assertIn("instantiateWasm(imports, onSuccess)", core)
        self.assertIn("WebAssembly.instantiate(wasmBinary, imports)", core)
        self.assertIn("Promise.race([initPromise, instantiateFailure, timeout])", core)
        self.assertIn("initTimeoutMs = 30000", core)
        self.assertNotIn("const sqlite = await globalThis.sqlite3InitModule({\n        wasmBinary,", core)

    def test_portability_health_check_is_enforced(self):
        core = (ROOT / "src" / "js" / "app" / "database_core.js").read_text(encoding="utf-8")
        ui = database_ui_source()

        self.assertIn("function runHealthCheck()", core)
        self.assertIn("PRAGMA quick_check", core)
        self.assertIn("PRAGMA foreign_key_check", core)
        self.assertIn("databaseRegistryMismatches", core)
        self.assertIn("journal_mode=DELETE", core)
        self.assertIn("Экспорт заблокирован", core)
        self.assertIn("assertHandleIntegrity(db)", core)

        self.assertIn("databaseRunHealthCheck", ui)
        self.assertIn("checkDatabaseButton", ui)
        self.assertIn("Переносимость и целостность", ui)
        self.assertIn("quick_check", ui)

    def test_database_workspace_ui_is_split_by_responsibility(self):
        app_dir = ROOT / "src" / "js" / "app"
        state_ui = (app_dir / "database_ui_state.js").read_text(encoding="utf-8")
        intake_ui = (app_dir / "database_intake_ui.js").read_text(encoding="utf-8")
        connection_ui = (app_dir / "database_connection_ui.js").read_text(encoding="utf-8")
        integration_ui = (app_dir / "database_integration_ui.js").read_text(encoding="utf-8")
        audit_ui = (app_dir / "database_audit_ui.js").read_text(encoding="utf-8")
        renderers = (app_dir / "database_view_renderers.js").read_text(encoding="utf-8")
        route_ui = (app_dir / "database_ui.js").read_text(encoding="utf-8")

        self.assertIn("const databaseWorkspaceState", state_ui)
        self.assertIn("databaseRunHealthCheck", state_ui)
        self.assertIn("databaseAcceptExcelFiles", intake_ui)
        self.assertIn("databaseCreateNew", connection_ui)
        self.assertIn("databaseCommitIntegration", integration_ui)
        self.assertIn("databaseAuditSnapshot", audit_ui)
        self.assertIn("databaseRenderIntakeCards", renderers)
        self.assertIn("function renderDatabaseWorkspace()", route_ui)

        self.assertNotIn("function databaseAcceptExcelFiles(", route_ui)
        self.assertNotIn("function databaseCreateNew(", route_ui)
        self.assertNotIn("function databaseCommitIntegration(", route_ui)
        self.assertNotIn("function databaseAuditSnapshot(", route_ui)
        self.assertNotIn("const databaseWorkspaceState", route_ui)

        for name in DB_UI_FILES:
            with self.subTest(name=name):
                self.assertLess(
                    len((app_dir / name).read_text(encoding="utf-8")),
                    30000,
                    name + " should remain a narrow Database UI component",
                )

    def test_database_dirty_state_is_exposed(self):
        core = (ROOT / "src" / "js" / "app" / "database_core.js").read_text(encoding="utf-8")

        self.assertIn("dirty: false", core)
        self.assertIn("dirty: databaseRuntime.dirty", core)
        self.assertIn("databaseRuntime.dirty = true;", core)
        self.assertIn("databaseRuntime.dirty = false;", core)


if __name__ == "__main__":
    unittest.main()
