"""Test the optional unique filename label for repeated CORE builds."""
from __future__ import annotations

import importlib.util
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location(
    "reclassifier_test_build", ROOT / "build" / "build.py"
)
assert SPEC is not None and SPEC.loader is not None
BUILD = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(BUILD)


class BuildTestLabelTests(unittest.TestCase):
    def test_normal_release_filename_unchanged(self):
        self.assertEqual(
            BUILD.build_html_filename("0.37.0", "_CORE"),
            "Reclassifier_v0.37.0_CORE.html",
        )

    def test_named_test_build_can_coexist_with_default(self):
        self.assertEqual(
            BUILD.build_html_filename("0.37.0", "_CORE", "TEST_04_PR320"),
            "Reclassifier_v0.37.0_CORE_TEST_04_PR320.html",
        )
        self.assertNotEqual(
            BUILD.build_html_filename("0.37.0", "_CORE", "TEST_04_PR320"),
            BUILD.build_html_filename("0.37.0", "_CORE", "TEST_05_PR321"),
        )

    def test_reject_unsafe_test_labels(self):
        for label in ["", "space here", "../outside", "test.html", "-leading", "x"*49]:
            with self.subTest(label=label):
                with self.assertRaises(ValueError):
                    BUILD.build_html_filename("0.37.0", "_CORE", label)

    def test_cli_accepts_label(self):
        with patch.object(sys, "argv", ["build.py", "--test-label", "TEST_04_PR320"]):
            args = BUILD.parse_args()
        self.assertEqual(args.test_label, "TEST_04_PR320")


if __name__ == "__main__":
    unittest.main()
