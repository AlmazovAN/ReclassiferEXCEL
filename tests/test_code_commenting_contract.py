from __future__ import annotations

import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

DOCUMENTED_FILES = (
    "src/js/app/dataset_catalog.js",
    "src/js/app/database_core.js",
    "src/js/app/database_ui_state.js",
    "src/js/app/database_intake_ui.js",
    "src/js/app/database_connection_ui.js",
    "src/js/app/database_integration_ui.js",
    "src/js/app/database_audit_ui.js",
    "src/js/app/database_view_renderers.js",
    "src/js/app/database_ui.js",
    "src/js/app/data_repository.js",
    "src/js/app/database_integration.js",
    "src/js/app/runtime.js",
    "src/js/references/reference_manager.js",
    "src/js/references/reference_normalizers.js",
    "src/js/references/reference_ui_common.js",
    "src/js/references/reference_probe_ui.js",
    "src/js/references/reference_preview_ui.js",
    "src/js/references/reference_detail_ui.js",
    "src/js/references/reference_ui.js",
    "src/js/modules/itsm/ui.js",
    "src/js/modules/mobile_brigade/ui.js",
)

LARGE_NAVIGATION_FILES = (
    "src/js/app/database_core.js",
    "src/js/references/reference_manager.js",
    "src/js/references/reference_normalizers.js",
)


class CodeCommentingContractTests(unittest.TestCase):
    def test_key_files_have_machine_readable_file_contracts(self):
        required_labels = (
            "// FILE CONTRACT:",
            "// Purpose:",
            "// Owns:",
            "// Reads:",
            "// Writes:",
            "// Public API:",
            "// Must not:",
            "// Related tests:",
        )

        for relative_path in DOCUMENTED_FILES:
            path = ROOT / relative_path
            source = path.read_text(encoding="utf-8")
            header = "\n".join(source.splitlines()[:16])
            with self.subTest(path=relative_path):
                for label in required_labels:
                    self.assertIn(
                        label,
                        header,
                        f"{relative_path} is missing file-contract label {label}",
                    )

    def test_large_files_keep_navigation_sections(self):
        for relative_path in LARGE_NAVIGATION_FILES:
            source = (ROOT / relative_path).read_text(encoding="utf-8")
            section_count = source.count(
                "// ============================================================================"
            )
            with self.subTest(path=relative_path):
                self.assertGreaterEqual(
                    section_count,
                    8,
                    f"{relative_path} needs enough section markers to remain navigable",
                )


if __name__ == "__main__":
    unittest.main()
