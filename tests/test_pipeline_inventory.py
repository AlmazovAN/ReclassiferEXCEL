import json
import re
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
TESTS = ROOT / "tests"
WORKFLOW = ROOT / ".github" / "workflows" / "build.yml"
INVENTORY = TESTS / "ci_test_inventory.json"
MANIFEST = TESTS / "ci_suites.json"
FAST_WORKFLOW = ROOT / ".github" / "workflows" / "test-fast.yml"
LOCAL_RUNNER = ROOT / "tools" / "local-ci.ps1"
RELEASE_WORKFLOW = ROOT / ".github" / "workflows" / "release.yml"


class PipelineInventoryTests(unittest.TestCase):
    def test_fast_suite_is_shared_by_cloud_and_local_runners(self):
        manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
        fast = manifest["suites"]["fast"]
        javascript = fast["javascript"]
        cloud = FAST_WORKFLOW.read_text(encoding="utf-8")
        local = LOCAL_RUNNER.read_text(encoding="utf-8")

        self.assertEqual(len(javascript), len(set(javascript)))
        for relative_path in javascript:
            self.assertTrue((ROOT / relative_path).is_file(), relative_path)
        self.assertIn("tests/run_ci_manifest.py fast", cloud)
        self.assertIn("tests/run_ci_manifest.py', 'fast", local)

    def test_local_runner_discovers_inline_workflow_node_commands(self):
        workflow = WORKFLOW.read_text(encoding="utf-8")
        local = LOCAL_RUNNER.read_text(encoding="utf-8")

        inline_commands = re.findall(
            r"(?m)^\s*run:\s*(?:TZ=\S+\s+)?node\s+"
            r"(?:--max-old-space-size=\d+\s+)?(tests/[A-Za-z0-9_./-]+\.js)",
            workflow,
        )
        self.assertTrue(inline_commands, "expected inline Node steps in full acceptance")
        self.assertIn("(?:run:\\s*)?", local)

    def test_full_acceptance_workflow_does_not_run_for_pull_requests(self):
        workflow = WORKFLOW.read_text(encoding="utf-8")
        self.assertNotIn("pull_request:", workflow)

    def test_release_is_separate_manual_and_gated(self):
        workflow = WORKFLOW.read_text(encoding="utf-8")
        release = RELEASE_WORKFLOW.read_text(encoding="utf-8")
        self.assertIn("contents: read", workflow)
        self.assertNotIn("contents: write", workflow)
        self.assertNotIn("gh release", workflow)
        self.assertIn("workflow_dispatch:", release)
        self.assertIn("inputs.mode == 'publish'", release)
        self.assertIn("inputs.mode == 'validate'", release)
        self.assertIn("github.ref == 'refs/heads/main'", release)
        self.assertEqual(release.count("if: inputs.mode == 'publish'"), 2)
        self.assertIn("concurrency:", release)
        self.assertIn("gh run list", release)
        self.assertIn("--commit \"$GITHUB_SHA\"", release)
        self.assertIn("Summarize independent workflow groups", workflow)
        self.assertIn("Summarize fast checks", FAST_WORKFLOW.read_text(encoding="utf-8"))
        self.assertIn("no tag or GitHub Release created", (ROOT / "tools" / "release_dry_run.py").read_text(encoding="utf-8"))

    def test_python_tests_use_unittest_discovery(self):
        workflow = WORKFLOW.read_text(encoding="utf-8")
        self.assertIn(
            "python -m unittest discover -s tests -p 'test_*.py'", workflow
        )

    def test_every_javascript_test_is_in_ci_or_inventory(self):
        workflow = WORKFLOW.read_text(encoding="utf-8")
        inventory = json.loads(INVENTORY.read_text(encoding="utf-8"))
        deferred = {
            entry["file"]: entry
            for entry in inventory["deferred_javascript_tests"]
        }
        javascript_tests = {path.name for path in TESTS.glob("test_*.js")}
        workflow_tests = {
            name
            for name in javascript_tests
            if f"tests/{name}" in workflow
        }

        self.assertEqual(len(deferred), len(inventory["deferred_javascript_tests"]))
        self.assertEqual(javascript_tests, workflow_tests | set(deferred))
        self.assertFalse(workflow_tests & set(deferred))
        for entry in deferred.values():
            self.assertTrue(entry["reason"].strip(), entry["file"])
            self.assertIn(
                entry["status"],
                {
                    "local-pass-candidate-for-ci",
                    "local-failure-needs-triage",
                    "local-timeout-needs-triage",
                },
                entry["file"],
            )


if __name__ == "__main__":
    unittest.main()
