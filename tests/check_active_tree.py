"""Fail fast if active Folders source depends on removed application branches."""
from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
manifest_path = ROOT / "src/folders/engine-files.json"
paths = json.loads(manifest_path.read_text(encoding="utf-8"))
if len(paths) != len(set(paths)):
    raise SystemExit("Duplicate active Worker paths")

for rel in paths:
    src = ROOT / rel
    if not src.is_file():
        raise SystemExit(f"Missing Worker dependency: {rel}")
    if rel.endswith(".js") and not rel.startswith("vendor/"):
        content = src.read_text(encoding="utf-8-sig")
        for obsolete in ("ReclassifierRuntimeDataRepository", "streamToSqlite", "replaceSqliteMirror"):
            if obsolete in content:
                raise SystemExit(f"Obsolete database branch remains in {rel}: {obsolete}")

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
