from __future__ import annotations

import ast
import json
import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def python_assignment(path: Path, name: str):
    tree = ast.parse(path.read_text(encoding="utf-8"))
    for node in tree.body:
        if isinstance(node, ast.Assign):
            for target in node.targets:
                if isinstance(target, ast.Name) and target.id == name:
                    return ast.literal_eval(node.value)
    raise AssertionError(f"{name} not found in {path}")


def js_reference_list(path: Path) -> tuple[str, ...]:
    source = path.read_text(encoding="utf-8")
    match = re.search(r"references:\s*\[([^\]]*)\]", source, re.S)
    if not match:
        raise AssertionError(f"references array not found in {path}")
    return tuple(re.findall(r"'([^']+)'", match.group(1)))


def js_dataset_catalog_versions() -> dict[str, str]:
    source = (ROOT / "src" / "js" / "app" / "dataset_catalog.js").read_text(encoding="utf-8")
    return dict(
        re.findall(
            r"^\s{4}([a-z_]+): defineDataset\('[^']+', \{[\s\S]*?schemaVersion: '([^']+)'",
            source,
            re.M,
        )
    )


class DocumentationContractTests(unittest.TestCase):
    def test_root_readme_matches_application_version(self):
        version = (ROOT / "VERSION").read_text(encoding="utf-8").strip()
        readme = (ROOT / "README.md").read_text(encoding="utf-8")
        self.assertIn(f"Текущая версия приложения: **{version}**.", readme)
        self.assertRegex(version, r"^\d+\.\d+\.\d+$")

    def test_build_supports_ci_release_version_override(self):
        build = (ROOT / "build" / "build.py").read_text(encoding="utf-8")
        workflow = (ROOT / ".github" / "workflows" / "build.yml").read_text(encoding="utf-8")
        release = (ROOT / ".github" / "workflows" / "release.yml").read_text(encoding="utf-8")
        self.assertIn("RECLASSIFIER_VERSION", build)
        self.assertIn("Resolve release version", release)
        self.assertIn("Create version tag", release)
        self.assertNotIn("Tag successful main release", workflow)
        self.assertIn("fetch-depth: 0", release)


    def test_reference_schema_versions_match_python_contract(self):
        catalog_versions = js_dataset_catalog_versions()
        py_versions = python_assignment(
            ROOT / "src" / "python" / "references" / "reference_manager.py",
            "REFERENCE_SCHEMA_VERSIONS",
        )
        js_versions = {dataset_id: catalog_versions[dataset_id] for dataset_id in py_versions}
        self.assertEqual(py_versions, js_versions)

    def test_browser_and_python_module_dependencies_match(self):
        cases = {
            "itsm": ROOT / "src" / "js" / "modules" / "itsm" / "config.js",
            "reclassification": ROOT / "src" / "js" / "modules" / "reclassification" / "config.js",
            "mobile_brigade": ROOT / "src" / "js" / "modules" / "mobile_brigade" / "config.js",
        }
        for module_id, js_path in cases.items():
            python_path = ROOT / "src" / "python" / "modules" / module_id / "module.py"
            with self.subTest(module=module_id):
                self.assertEqual(
                    python_assignment(python_path, "REQUIRED_REFERENCES"),
                    js_reference_list(js_path),
                )

    def test_primary_docs_do_not_describe_retired_architecture(self):
        readme = (ROOT / "README.md").read_text(encoding="utf-8")
        architecture = (ROOT / "ARCHITECTURE.md").read_text(encoding="utf-8")
        combined = readme + "\n" + architecture

        retired_phrases = (
            "Версия `0.2.x`",
            "пять исходных Equipment-каталогов пока являются пустыми заглушками",
            "массовая загрузка пяти исходных Equipment Excel временно отключена",
            "Equipment Merge Rules 1.0.0",
            "GitHub Actions собирает рабочую оболочку без корпоративных файлов",
            "стартовый сокращённый baseline",
            "9 полей всего",
        )
        for phrase in retired_phrases:
            self.assertNotIn(phrase, combined)

    def test_user_facing_descriptions_exist(self):
        about = (ROOT / "src" / "js" / "app" / "system.js").read_text(encoding="utf-8")
        references_dir = ROOT / "src" / "js" / "references"
        references = "\n".join(
            (references_dir / name).read_text(encoding="utf-8")
            for name in (
                "reference_ui_common.js",
                "reference_probe_ui.js",
                "reference_preview_ui.js",
                "reference_detail_ui.js",
                "reference_ui.js",
            )
        )
        equipment = (ROOT / "src" / "js" / "modules" / "equipment" / "equipment_ui.js").read_text(encoding="utf-8")
        itsm = (ROOT / "src" / "js" / "modules" / "itsm" / "ui.js").read_text(encoding="utf-8")
        failure_classifier = (ROOT / "src" / "js" / "modules" / "failure_classifier" / "ui.js").read_text(encoding="utf-8")
        app_dir = ROOT / "src" / "js" / "app"
        database_ui = "\n".join(
            (app_dir / name).read_text(encoding="utf-8")
            for name in (
                "database_ui_state.js",
                "database_intake_ui.js",
                "database_connection_ui.js",
                "database_integration_ui.js",
                "database_audit_ui.js",
                "database_view_renderers.js",
                "database_ui.js",
            )
        )

        self.assertIn("<h3>Справочники</h3>", about)
        self.assertIn("<h3>Оборудование</h3>", about)
        self.assertIn("<h3>ITSM</h3>", about)
        self.assertIn("<h3>Классификатор отказов</h3>", about)
        self.assertIn("У классификатора свой загрузчик", failure_classifier)
        self.assertIn("У каждого справочника есть свой загрузчик", references)
        self.assertIn("История ведётся отдельно по каждому исходному каталогу", equipment)
        self.assertIn("Описание алгоритма обработки", itsm)
        self.assertIn("ITSM Rules", itsm)
        self.assertIn("Обработка выполняется локально в фоновом потоке браузера.", itsm)
        self.assertNotIn("ReclassifierItsmWorkerProcessor.process", itsm)
        self.assertNotIn("src/js/workers/itsm_processor.js", itsm)
        self.assertIn("34 расчётных поля", itsm)
        self.assertIn("Сейчас загружены Mobile Brigade Data", references)
        self.assertIn("Диапазон данных", references)
        self.assertIn("Готов с предупреждениями", references)
        self.assertIn("Сейчас загружены ITSM Sirius Data", references)
        self.assertIn("Новая ITSM-выгрузка обновляет совпавшие номера заявок", references)
        self.assertIn("upsert_by_number", itsm)
        self.assertIn("<h2>База данных</h2>", database_ui)
        self.assertIn("Технические режимы", database_ui)
        self.assertIn("UPSERT", database_ui)
        self.assertIn("REPLACE", database_ui)
        self.assertIn("транзакционно в SQLite", database_ui)
        self.assertIn("автоматически обрабатывается в фоне", database_ui)
        self.assertIn("Подтвердить", database_ui)
        self.assertNotIn("<h2>Контроль интеграций</h2>", database_ui)
        self.assertNotIn("databaseAuditDatasetFilter", database_ui)
        self.assertNotIn("databaseAuditStatusFilter", database_ui)
        self.assertIn("Техническая информация", database_ui)
        self.assertIn("Режим хранения", database_ui)
        self.assertIn("Проверить целостность", database_ui)
        self.assertIn("Переносимость и целостность", database_ui)
        self.assertIn("Размер несжатых данных по Dataset", database_ui)
        self.assertIn("Применить изменения", database_ui)
        self.assertIn("Развернуть БД из HTML", database_ui)
        self.assertIn("Скачать Reclassifier.db", database_ui)

        data_repository = (ROOT / "src" / "js" / "app" / "data_repository.js").read_text(encoding="utf-8")
        self.assertIn("ReclassifierRuntimeDataRepository", data_repository)
        self.assertIn("assertLegacyWriteAllowed", data_repository)


if __name__ == "__main__":
    unittest.main()
