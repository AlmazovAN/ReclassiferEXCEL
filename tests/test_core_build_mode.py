"""Build artifacts must never read or embed business datasets."""
import importlib.util
import json
import re
import tempfile
import unittest
from pathlib import Path
from unittest import mock

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("core_build_under_test", ROOT / "build" / "build.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class CoreBuildModeTests(unittest.TestCase):
    def test_build_has_no_business_data_input_paths(self):
        source = (ROOT / "build" / "build.py").read_text(encoding="utf-8")
        for forbidden in ("local_data", "ROOT / \"data\"", "--starter", "build_starter_baseline"):
            self.assertNotIn(forbidden, source)

    def test_build_artifact_has_no_embedded_dataset_globals(self):
        with tempfile.TemporaryDirectory() as temp, \
             mock.patch.object(module, "DIST", Path(temp)), \
             mock.patch.object(module, "load_sheetjs", return_value=("/* vendor */", "test")), \
             mock.patch.object(module, "load_sqlite_wasm", return_value=("/* sqlite */", "d2FzbQ==", "test")), \
             mock.patch.object(module, "load_home_artwork", return_value={}), \
             mock.patch.object(module, "parse_args", return_value=module.argparse.Namespace(output_dir=None, test_label=None)):
            artifact = module.main()
            html = artifact.read_text(encoding="utf-8")
            self.assertTrue(artifact.name.endswith("_CORE.html"))
            meta = json.loads(re.search(r"window\.RECLASSIFIER_BUILD = (\{[^\n]+\});", html).group(1))
            self.assertEqual(meta["dataMode"], "core-no-data")
            self.assertFalse(meta["privateDataBuild"])
            self.assertNotIn("RECLASSIFIER_EMBEDDED_", html)
            self.assertNotIn("StarterPack", html)


if __name__ == "__main__":
    unittest.main()
