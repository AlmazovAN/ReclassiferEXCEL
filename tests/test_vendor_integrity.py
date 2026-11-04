import importlib.util
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
BUILD_PATH = ROOT / "build" / "build.py"


def load_build_module():
    spec = importlib.util.spec_from_file_location("reclassifier_build_vendor_test", BUILD_PATH)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


class VendorIntegrityContractTest(unittest.TestCase):
    def test_reviewed_sheetjs_vendor_matches_pinned_sha256(self):
        module = load_build_module()
        vendor = ROOT / "vendor" / "xlsx.full.min.js"
        self.assertTrue(vendor.exists())
        actual = module.hashlib.sha256(vendor.read_bytes()).hexdigest()
        self.assertEqual(module.SHEETJS_SHA256, actual)
        source, source_kind = module.load_sheetjs()
        self.assertEqual("vendor-verified", source_kind)
        self.assertIn('0.20.3', source)

    def test_tampered_sheetjs_is_rejected_even_when_version_string_survives(self):
        module = load_build_module()
        original_root = module.ROOT
        try:
            with tempfile.TemporaryDirectory() as temp:
                temp_root = Path(temp)
                vendor_dir = temp_root / "vendor"
                vendor_dir.mkdir(parents=True)
                raw = bytearray((ROOT / "vendor" / "xlsx.full.min.js").read_bytes())
                raw[-32] ^= 0x01
                (vendor_dir / "xlsx.full.min.js").write_bytes(raw)
                module.ROOT = temp_root
                with self.assertRaisesRegex(RuntimeError, "SheetJS browser build checksum mismatch"):
                    module.load_sheetjs()
        finally:
            module.ROOT = original_root

    def test_unverified_loose_sqlite_vendor_pair_is_rejected(self):
        module = load_build_module()
        original_root = module.ROOT
        try:
            with tempfile.TemporaryDirectory() as temp:
                temp_root = Path(temp)
                vendor_dir = temp_root / "vendor" / "sqlite"
                vendor_dir.mkdir(parents=True)
                (vendor_dir / "sqlite3.js").write_text("sqlite3InitModule", encoding="utf-8")
                (vendor_dir / "sqlite3.wasm").write_bytes(b"\x00asm" + b"x" * 32)
                module.ROOT = temp_root
                with self.assertRaisesRegex(RuntimeError, "Unverified SQLite vendor pair"):
                    module.load_sqlite_wasm()
        finally:
            module.ROOT = original_root

    def test_wrong_local_sqlite_release_archive_fails_before_extraction(self):
        module = load_build_module()
        original_root = module.ROOT
        try:
            with tempfile.TemporaryDirectory() as temp:
                temp_root = Path(temp)
                vendor_dir = temp_root / "vendor" / "sqlite"
                vendor_dir.mkdir(parents=True)
                (vendor_dir / module.SQLITE_WASM_ARCHIVE_NAME).write_bytes(b"not-the-pinned-release")
                module.ROOT = temp_root
                with self.assertRaisesRegex(RuntimeError, "SQLite WASM release archive checksum mismatch"):
                    module.load_sqlite_wasm()
        finally:
            module.ROOT = original_root

    def test_build_metadata_exposes_vendor_integrity_pins(self):
        source = BUILD_PATH.read_text(encoding="utf-8")
        self.assertIn('"excelParserSha256": SHEETJS_SHA256', source)
        self.assertIn('"sqliteWasmReleaseSha3_256": SQLITE_WASM_ZIP_SHA3_256', source)
        self.assertIn("hashlib.sha256(source_bytes)", source)
        self.assertIn("hashlib.sha3_256(archive_bytes)", source)


if __name__ == "__main__":
    unittest.main()
