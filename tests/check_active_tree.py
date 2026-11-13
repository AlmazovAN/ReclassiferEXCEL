"""Fail fast if active Folders source depends on removed application branches."""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "build"))
from build_folders import SOURCE, UI_ASSETS, worker_paths

manifest_path = ROOT / "src/folders/engine-files.json"
paths = json.loads(manifest_path.read_text(encoding="utf-8"))
worker = worker_paths()
if len(worker) != len(set(worker)):
    raise SystemExit("Duplicate active Worker paths")

ui = [str((SOURCE / asset).relative_to(ROOT).as_posix()) for assets in UI_ASSETS.values() for asset in assets]
if len(ui) != len(set(ui)) or set(ui).intersection(worker) != {"src/folders/rca-master/analytics/index-contract.js"}:
    raise SystemExit("Duplicate UI assets or overlap between UI and Worker")
if UI_ASSETS["SCRIPT"][-1] != "folders.js" or worker[-1] != "src/folders/worker.js":
    raise SystemExit("Entrypoints must follow their dependencies")
if any(rel.startswith("src/folders/rca-master/") and not rel.startswith("src/folders/rca-master/analytics/")
       and rel != "src/folders/rca-master/plans/template-reader.js" for rel in worker):
    raise SystemExit("RCA UI modules must stay outside the Excel Worker")

# Filesystem mutation primitives belong to the existing storage and writer boundaries.
mutation_owners = {
    "src/folders/storage.js", "src/folders/engine/app/safe_excel_writer.js",
    "src/folders/worker.js", "src/folders/rca-master/repository-json.js",
}
for rel in (*worker, *ui):
    src = ROOT / rel
    if not src.is_file():
        raise SystemExit(f"Missing Worker dependency: {rel}")
    if rel.endswith(".js") and not rel.startswith("vendor/"):
        content = src.read_text(encoding="utf-8-sig")
        if rel not in mutation_owners and re.search(r"\b(?:createWritable|removeEntry)\s*\(", content):
            raise SystemExit(f"Filesystem mutation outside storage boundary: {rel}")
        for obsolete in ("ReclassifierRuntimeDataRepository", "streamToSqlite", "replaceSqliteMirror"):
            if obsolete in content:
                raise SystemExit(f"Obsolete database branch remains in {rel}: {obsolete}")

# The Folders builder consumes these files directly, outside engine-files.json.
# Check both worker support files and HTML/UI assets before invoking the build.
for rel in (
    "vendor/js-sha256-0.11.1.js",
    "vendor/js-sha256-LICENSE.txt",
    "src/folders/storage.js",
    "src/folders/limits.js",
    "src/folders/workflows/run-reclassification.js",
    "src/folders/worker.js",
    "src/folders/journal/journal.js",
    "src/folders/workspace/selection.js",
    "src/folders/folder-art.html",
    "src/folders/references-art.html",
    "src/folders/export-art.html",
    "build/Start_Reclassifier.cmd",
    "build/serve_folders.py",
):
    if not (ROOT / rel).is_file():
        raise SystemExit(f"Missing direct Folders build input: {rel}")

for rel in (
    "src/folders/index.html",
    "src/folders/folders.js",
    "src/folders/folders.css",
    "build/build_folders.py",
    "tests/test_folders_reclassification.cjs",
):
    if not (ROOT / rel).is_file():
        raise SystemExit(f"Missing active source: {rel}")

for removed in ("build/build.py", "src/ui/index.html", "DATABASE_ARCHITECTURE.md"):
    if (ROOT / removed).exists():
        raise SystemExit(f"Obsolete application branch found: {removed}")

print(f"Active Folders tree OK: {len(paths)} Worker dependencies.")
