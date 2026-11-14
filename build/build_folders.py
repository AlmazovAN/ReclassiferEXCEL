"""Build the standalone Folders application from its isolated source files."""
import json
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "src" / "folders"
UI_ASSETS = {
    "STYLE": ("folders.css", "rca-master.css"),
    "SCRIPT": (
        "journal/journal.js", "workspace/selection.js", "rca-master/config.js",
        "rca-master/attachment-store.js", "rca-master/attachment-gallery.js", "rca-master/validation.js", "rca-master/registry.js", "rca-master/registry-source.js", "rca-master/repository-json.js",
        "rca-master/state.js", "rca-master/tree-model.js", "rca-master/ui.js",
        "rca-master/passport.js", "rca-master/reference-adapter.js", "rca-master/evidence.js", "rca-master/actions.js",
        "rca-master/dictionaries.js", "rca-master/archive-json.js", "rca-master/archive-zip.js", "rca-master/dictionaries-modal.js",
        "rca-master/tree-view.js", "rca-master/report.js", "rca-master/analytics/index-contract.js",
        "rca-master/analytics/query.js", "rca-master/plans/schedule.js", "rca-master/plans/plan-view.js", "folders.js",
    ),
}
WORKER_PREFIX = ("src/folders/storage.js", "src/folders/limits.js", "vendor/js-sha256-0.11.1.js")
WORKER_SUFFIX = ("src/folders/workflows/run-reclassification.js",
                 "src/folders/rca-master/analytics/index-contract.js",
                 "src/folders/rca-master/analytics/source-reader.js",
                 "src/folders/rca-master/analytics/aggregators.js",
                 "src/folders/rca-master/plans/template-reader.js", "src/folders/worker.js")


def worker_paths():
    manifest = json.loads((SOURCE / "engine-files.json").read_text(encoding="utf-8"))
    return (*WORKER_PREFIX, *manifest, *WORKER_SUFFIX)


def main() -> Path:
    html = (SOURCE / "index.html").read_text(encoding="utf-8-sig")
    for marker, assets in UI_ASSETS.items():
        token = f"/*__FOLDERS_{marker}__*/"
        if html.count(token) != 1:
            raise ValueError(f"Expected exactly one marker {token}")
        script = "\n".join((SOURCE / asset).read_text(encoding="utf-8-sig") for asset in assets)
        html = html.replace(token, script)

    for name in ("folder", "references", "export"):
        html = html.replace(f"<!--__{name.upper()}_ART__-->", (SOURCE / f"{name}-art.html").read_text(encoding="utf-8-sig"))

    parts = [ROOT / path for path in worker_paths()]
    worker = "\n;\n".join(path.read_text(encoding="utf-8-sig") for path in parts)
    license_text = (ROOT / "vendor/js-sha256-LICENSE.txt").read_text(encoding="utf-8")
    worker = "/* js-sha256 0.11.1 · MIT\n" + license_text + "\n*/\n" + worker
    html = html.replace("/*__FOLDERS_WORKER__*/", json.dumps(worker, ensure_ascii=True).replace("<", "\\u003c"))

    output = ROOT / "dist" / "ReclassifierEXCEL.html"
    output.parent.mkdir(exist_ok=True)
    output.write_text(html, encoding="utf-8")
    for filename in ("Start_Reclassifier.cmd", "serve_folders.py"):
        shutil.copyfile(Path(__file__).with_name(filename), output.parent / filename)
    output.with_name("Reclassifier_Folders.html").unlink(missing_ok=True)
    print(output)
    return output


if __name__ == "__main__":
    main()
