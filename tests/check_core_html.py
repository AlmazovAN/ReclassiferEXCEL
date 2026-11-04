"""Acceptance checks for an independent, offline CORE HTML artifact."""
from __future__ import annotations

import json
import os
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
version = os.environ.get("RECLASSIFIER_VERSION", "").strip() or (ROOT / "VERSION").read_text(encoding="utf-8").strip()
core_dir = Path(os.environ.get("RECLASSIFIER_CORE_HTML_DIR") or ROOT / "dist")
core = core_dir / f"Reclassifier_v{version}_CORE.html"
if not core.is_file():
    raise SystemExit(f"CORE build missing: {core}")
html = core.read_text(encoding="utf-8")
meta_match = re.search(r"window\.RECLASSIFIER_BUILD = (\{[^\n]+\});", html)
assert meta_match, "Build metadata missing"
meta = json.loads(meta_match.group(1))
assert meta["format"] == "single-html-core"
assert meta["coreBuild"] is True
assert meta["dataMode"] == "core-no-data"
assert meta["privateDataBuild"] is False
assert meta["embeddedReferenceFiles"] == 0
assert meta["embeddedEquipmentFiles"] == 0
assert "RECLASSIFIER_EMBEDDED_" not in html
assert "StarterPack" not in html
for required in (
    "sqlite3InitModule", "sqliteWasmBase64", "openDatabaseButton",
    "downloadApplicationHtmlButton", "downloadUpdatedHtmlButton",
    "function hydrateDatasetPack()", "function downloadUpdatedHtml()",
    "function synchronizeSqliteToHtml()", "ReclassifierDatabaseRepository",
    'id="reclassifierDataPack"',
):
    assert required in html, f"CORE functionality missing: {required}"
assert "<script" in html and "/*__APP__*/" not in html
print(f"CORE verified: {core.name}, {core.stat().st_size:,} bytes, no embedded datasets")
