"""Build the standalone Folders application from its isolated source files."""
import json
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "src" / "folders"


def main() -> Path:
    html = (SOURCE / "index.html").read_text(encoding="utf-8-sig")
    for marker, assets in (
        ("STYLE", ("folders.css", "rca-master.css")),
        ("SCRIPT", (
            "journal/journal.js", "workspace/selection.js", "rca-master/config.js",
            "rca-master/validation.js", "rca-master/registry.js", "rca-master/repository-json.js",
            "rca-master/state.js", "rca-master/tree-model.js", "rca-master/ui.js",
            "rca-master/passport.js", "rca-master/evidence.js", "rca-master/actions.js",
            "rca-master/dictionaries.js", "rca-master/archive-json.js", "rca-master/dictionaries-modal.js",
            "rca-master/tree-view.js", "rca-master/report.js", "folders.js",
        )),
    ):
        token = f"/*__FOLDERS_{marker}__*/"
        if html.count(token) != 1:
            raise ValueError(f"Expected exactly one marker {token}")
        script = "\n".join((SOURCE / asset).read_text(encoding="utf-8-sig") for asset in assets)
        html = html.replace(token, script)

    for name in ("folder", "references", "export"):
        html = html.replace(f"<!--__{name.upper()}_ART__-->", (SOURCE / f"{name}-art.html").read_text(encoding="utf-8-sig"))

    module_paths = json.loads((SOURCE / "engine-files.json").read_text(encoding="utf-8"))
    parts = [SOURCE / "storage.js", SOURCE / "limits.js", ROOT / "vendor/js-sha256-0.11.1.js", *(ROOT / path for path in module_paths),
             SOURCE / "workflows/run-reclassification.js", SOURCE / "worker.js"]
    worker = "\n;\n".join(path.read_text(encoding="utf-8-sig") for path in parts)
    license_text = (ROOT / "vendor/js-sha256-LICENSE.txt").read_text(encoding="utf-8")
    worker = "/* js-sha256 0.11.1 · MIT\n" + license_text + "\n*/\n" + worker
    html = html.replace("/*__FOLDERS_WORKER__*/", json.dumps(worker, ensure_ascii=True).replace("<", "\\u003c"))

    output = ROOT / "dist" / "Reclassifier_Folders.html"
    output.parent.mkdir(exist_ok=True)
    output.write_text(html, encoding="utf-8")
    (output.parent / "ReclassifierEXCEL.html").write_text(html, encoding="utf-8")
    for filename in ("Start_Reclassifier.cmd", "serve_folders.py"):
        shutil.copyfile(Path(__file__).with_name(filename), output.parent / filename)
    print(output)
    return output


if __name__ == "__main__":
    main()
