"""Build-time validation for classic-script initialization dependencies."""
from __future__ import annotations

import importlib.util
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location(
    "reclassifier_dependency_build", ROOT / "build" / "build.py"
)
assert SPEC is not None and SPEC.loader is not None
BUILD = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(BUILD)


class AppJsDependencyTests(unittest.TestCase):
    def test_declared_dependencies_match_current_bundle_order(self):
        BUILD.validate_app_js_dependencies(BUILD.APP_JS_FILES)

    def test_rejects_prerequisite_loaded_after_consumer(self):
        with self.assertRaisesRegex(RuntimeError, "must load after"):
            BUILD.validate_app_js_dependencies(
                ["consumer.js", "provider.js"],
                {"consumer.js": ("provider.js",)},
            )

    def test_rejects_dependency_on_unregistered_fragment(self):
        with self.assertRaisesRegex(RuntimeError, "unregistered fragment"):
            BUILD.validate_app_js_dependencies(
                ["consumer.js"],
                {"consumer.js": ("missing.js",)},
            )

    def test_rejects_dependency_cycles(self):
        with self.assertRaisesRegex(RuntimeError, "Cycle in application JS dependency graph"):
            BUILD.validate_app_js_dependencies(
                ["first.js", "second.js"],
                {"first.js": ("second.js",), "second.js": ("first.js",)},
            )


if __name__ == "__main__":
    unittest.main()
