from __future__ import annotations

import argparse
import base64
import hashlib
import json
import io
import os
import re
import sys
import zipfile
from datetime import datetime, timezone
from pathlib import Path
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "src"
DIST = ROOT / "dist"
sys.path.insert(0, str(Path(__file__).resolve().parent))

SHEETJS_VERSION = "0.20.3"
SHEETJS_URL = f"https://cdn.sheetjs.com/xlsx-{SHEETJS_VERSION}/package/dist/xlsx.full.min.js"
SHEETJS_SHA256 = "cc015130aa8521e7f088f88898eba949ccdcbfb38df0bd129b44b7273c3a6f41"

SQLITE_WASM_VERSION = "3.53.4"
SQLITE_WASM_RELEASE = "3530400"
SQLITE_WASM_ARCHIVE_NAME = f"sqlite-wasm-{SQLITE_WASM_RELEASE}.zip"
SQLITE_WASM_URL = f"https://www.sqlite.org/2026/{SQLITE_WASM_ARCHIVE_NAME}"
SQLITE_WASM_ZIP_SHA3_256 = "e4fa7e1750b42f6954115d8e69ffff7dc08da7e9fee6e28a2a0ea6bf228a49f2"

APP_JS_FILES = (
    "app/core.js",
    "app/performance_profiler.js",
    "app/diagnostic_journal.js",
    "app/dataset_catalog.js",
    "app/field_registry.js",
    "app/dataset_pipeline.js",
    "app/dataset_lifecycle.js",
    "app/database_contract.js",
    "app/database_core.js",
    "app/database_recovery_store.js",
    "app/database_bootstrap.js",
    "app/data_repository.js",
    "app/recalculation_core.js",
    "app/recalculation_materializer.js",
    "app/recalculation_commit.js",
    "app/recalculation_workspace.js",
    "app/dataset_db_state_model.js",
    "app/html_snapshot.js",
    "references/reference_config.js",
    "app/dataset_classifier.js",
    "references/reference_normalizers.js",
    "references/reference_manager.js",
    "references/reference_ui_common.js",
    "references/reference_probe_ui.js",
    "references/reference_preview_ui.js",
    "references/reference_kpi_source_ui.js",
    "references/reference_detail_ui.js",
    "references/reference_ui.js",
    "app/database_recognizer.js",
    "app/database_integration.js",
    "app/heavy_operation_gate.js",
    "app/diagnostic_scope_v18.js",
    "app/diagnostic_v2.js",
    "app/diagnostic_history.js",
    "app/database_ui_state.js",
    "app/database_intake_ui.js",
    "app/database_connection_ui.js",
    "app/database_recovery_ui.js",
    "app/database_integration_ui.js",
    "app/database_audit_ui.js",
    "app/database_view_renderers.js",
    "app/database_recalculation_ui.js",
    "app/database_ui.js",
    "app/home.js",
    "app/reliability_dashboard_data.js",
    "app/reliability_report_presentation.js",
    "app/reliability_pdf.js",
    "app/reliability_dashboard.js",
    "app/reliability_kpi_chart.js",
    "app/kpi_passports.js",
    "app/module_workspace.js",
    "app/xlsx_export_diagnostics.js",
    "app/dataset_excel_export.js",
    "app/mobile_brigade_staging.js",
    "modules/reclassification/rules.js",
    "modules/reclassification/classifier_index_v4.js",
    "modules/reclassification/facts_v4.js",
    "modules/reclassification/event_v4.js",
    "modules/reclassification/objects_v4.js",
    "modules/reclassification/elements_v4.js",
    "modules/reclassification/failure_v4.js",
    "modules/reclassification/cause_v4.js",
    "modules/reclassification/path_review_v4.js",
    "modules/reclassification/review_policy_v4.js",
    "modules/reclassification/diagnostics_v4.js",
    "modules/reclassification/rules_v4.js",
    "modules/reclassification/engine_registry.js",
    "modules/reclassification/runtime_source.js",
    "modules/reclassification/config.js",
    "modules/reclassification/ui.js",
    "modules/itsm/mb_presence.js",
    "modules/itsm/dataset_schema.js",
    "kpi/source_facts.js",
    "kpi/operational_series.js",
    "kpi/preparation/common.js",
    "kpi/preparation/failures.js",
    "kpi/preparation/equipment.js",
    "kpi/preparation/labor.js",
    "kpi/preparation/sla.js",
    "kpi/preparation/classification.js",
    "kpi/preparation/prb.js",
    "kpi/preparation/ktg.js",
    "kpi/preparation/index.js",
    "kpi/calculator/common.js",
    "kpi/calculator/declarative.js",
    "kpi/calculator/definitions.js",
    "kpi/calculator/vbr/calculate.js",
    "kpi/calculator/ktg/calculate.js",
    "kpi/calculator/sla/calculate.js",
    "kpi/calculator/classification_quality/calculate.js",
    "kpi/calculator/classification_quality_cgps/calculate.js",
    "kpi/calculator/labor/calculate.js",
    "kpi/calculator/problem_management/calculate.js",
    "kpi/calculator/index.js",
    "kpi/catalog/contracts.js",
    "kpi/catalog/index.js",
    "kpi/execution_trace.js",
    "kpi/forecast_engine.js",
    "kpi/classification_lag_forecast.js",
    "kpi/passport_math.js",
    "kpi/passport_view.js",
    "kpi/report_view_model.js",
    "kpi/problem_management_analytics.js",
    "kpi/chart_view_model.js",
    "kpi/report_snapshot.js",
    "app/reporting_coverage_manager.js",
    "modules/itsm/kpi_source.js",
    "modules/itsm/rules.js",
    "modules/itsm/recalculation.js",
    "modules/itsm/config.js",
    "modules/itsm/ui.js",
    "modules/mobile_brigade/rules.js",
    "modules/mobile_brigade/recalculation.js",
    "modules/mobile_brigade/config.js",
    "modules/mobile_brigade/upsert.js",
    "modules/mobile_brigade/dataset.js",
    "modules/mobile_brigade/ui.js",
    "modules/equipment/equipment_config.js",
    "modules/equipment/equipment_partitions.js",
    "modules/equipment/equipment_history.js",
    "modules/equipment/equipment_population.js",
    "modules/equipment/equipment_logic.js",
    "app/kpi_computation_service.js",
    "app/kpi_snapshot_store.js",
    "app/reliability_report_service.js",
    "modules/equipment/equipment_manager.js",
    "modules/equipment/equipment_ui.js",
    "modules/failure_classifier/config.js",
    "modules/failure_classifier/normalizer.js",
    "modules/failure_classifier/manager.js",
    "modules/failure_classifier/ui.js",
    "app/system.js",
    "app/worker_client.js",
    "app/kpi_task_scheduler.js",
    "app/kpi_background_jobs.js",
    "app/kpi_auto_refresh.js",
    "app/runtime.js",
)

# Cross-file initialization dependencies that must hold even if the reviewed
# bundle order is edited. Function-body references are intentionally excluded:
# those are called after the complete bundle has loaded and are not load-order
# constraints. Keep this graph focused on module initialization/API registration.
APP_JS_DEPENDENCIES = {
    "app/performance_profiler.js": ("app/core.js",),
    "app/diagnostic_journal.js": ("app/core.js",),
    "app/field_registry.js": ("app/dataset_catalog.js",),
    "app/dataset_lifecycle.js": ("app/dataset_pipeline.js", "app/dataset_catalog.js"),
    "app/database_contract.js": ("app/dataset_catalog.js",),
    "app/database_core.js": ("app/database_contract.js",),
    "app/database_bootstrap.js": ("app/database_core.js", "app/database_contract.js"),
    "app/data_repository.js": ("app/database_core.js", "app/dataset_lifecycle.js"),
    "app/recalculation_materializer.js": ("app/recalculation_core.js",),
    "app/recalculation_commit.js": ("app/recalculation_materializer.js",),
    "app/recalculation_workspace.js": ("app/recalculation_commit.js",),
    "references/reference_normalizers.js": ("references/reference_config.js",),
    "references/reference_manager.js": ("references/reference_normalizers.js",),
    "references/reference_probe_ui.js": ("references/reference_ui_common.js",),
    "references/reference_preview_ui.js": ("references/reference_ui_common.js",),
    "references/reference_detail_ui.js": ("references/reference_ui_common.js",),
    "references/reference_ui.js": ("references/reference_detail_ui.js", "references/reference_probe_ui.js"),
    "app/database_recognizer.js": ("app/dataset_classifier.js", "app/data_repository.js"),
    "app/database_integration.js": ("app/database_recognizer.js", "app/data_repository.js"),
    "app/diagnostic_v2.js": ("app/diagnostic_scope_v18.js",),
    "app/diagnostic_history.js": ("app/diagnostic_v2.js",),
    "app/database_ui_state.js": ("app/data_repository.js", "app/diagnostic_history.js"),
    "app/database_ui.js": ("app/database_view_renderers.js", "app/database_integration_ui.js"),
    "kpi/preparation/failures.js": ("kpi/preparation/common.js",),
    "kpi/preparation/equipment.js": ("kpi/preparation/common.js",),
    "kpi/preparation/labor.js": ("kpi/preparation/common.js",),
    "kpi/preparation/sla.js": ("kpi/preparation/common.js",),
    "kpi/preparation/classification.js": ("kpi/preparation/common.js",),
    "kpi/preparation/prb.js": ("kpi/preparation/common.js",),
    "kpi/preparation/ktg.js": ("kpi/preparation/common.js",),
    "kpi/preparation/index.js": (
        "kpi/preparation/failures.js", "kpi/preparation/equipment.js",
        "kpi/preparation/labor.js", "kpi/preparation/sla.js",
        "kpi/preparation/classification.js", "kpi/preparation/prb.js",
        "kpi/preparation/ktg.js",
    ),
    "kpi/calculator/declarative.js": ("kpi/calculator/common.js",),
    "kpi/calculator/definitions.js": ("kpi/calculator/declarative.js",),
    "kpi/calculator/index.js": (
        "kpi/calculator/definitions.js", "kpi/calculator/vbr/calculate.js",
        "kpi/calculator/ktg/calculate.js", "kpi/calculator/sla/calculate.js",
        "kpi/calculator/classification_quality/calculate.js",
        "kpi/calculator/classification_quality_cgps/calculate.js",
        "kpi/calculator/labor/calculate.js",
        "kpi/calculator/problem_management/calculate.js",
    ),
    "kpi/catalog/index.js": ("kpi/catalog/contracts.js",),
    "app/kpi_computation_service.js": ("kpi/preparation/index.js", "kpi/calculator/index.js"),
    "app/reliability_report_service.js": ("app/kpi_computation_service.js", "kpi/report_snapshot.js"),
    "app/kpi_task_scheduler.js": ("app/worker_client.js",),
    "app/kpi_background_jobs.js": ("app/kpi_task_scheduler.js",),
    "app/kpi_auto_refresh.js": ("app/kpi_background_jobs.js",),
    "app/runtime.js": ("app/kpi_auto_refresh.js", "app/kpi_background_jobs.js"),
}


def validate_app_js_dependencies(
    files: tuple[str, ...] | list[str],
    dependencies: dict[str, tuple[str, ...]] | None = None,
) -> None:
    """Validate declared initialization dependencies against the reviewed order."""
    dependencies = APP_JS_DEPENDENCIES if dependencies is None else dependencies
    positions = {name: index for index, name in enumerate(files)}
    if len(positions) != len(files):
        raise RuntimeError("Duplicate application JS fragment in APP_JS_FILES")

    # Check cycles before sequence constraints so contradictory declarations
    # receive the more useful cycle diagnostic.
    visiting: set[str] = set()
    visited: set[str] = set()

    def visit(node: str) -> None:
        if node in visiting:
            raise RuntimeError(f"Cycle in application JS dependency graph at {node}")
        if node in visited:
            return
        visiting.add(node)
        for prerequisite in dependencies.get(node, ()):
            visit(prerequisite)
        visiting.remove(node)
        visited.add(node)

    for node in dependencies:
        visit(node)

    for consumer, prerequisites in dependencies.items():
        if consumer not in positions:
            raise RuntimeError(f"Dependency graph references unregistered fragment: {consumer}")
        for prerequisite in prerequisites:
            if prerequisite not in positions:
                raise RuntimeError(
                    f"Dependency graph references unregistered fragment: {prerequisite} "
                    f"(required by {consumer})"
                )
            if positions[prerequisite] >= positions[consumer]:
                raise RuntimeError(
                    f"Application JS load order violation: {consumer} must load after "
                    f"{prerequisite}"
                )

def load_home_artwork() -> dict[str, str]:
    assets_dir = SRC / "assets" / "home-artwork"
    result: dict[str, str] = {}
    for module_id in ("reclassification", "itsm", "mobile_brigade"):
        path = assets_dir / f"{module_id}.webp"
        raw = path.read_bytes()
        if not raw.startswith(b"RIFF") or raw[8:12] != b"WEBP":
            raise RuntimeError(f"Home artwork is not WebP: {path.name}")
        result[module_id] = base64.b64encode(raw).decode("ascii")
    return result


def read(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def read_fragments(directory: Path, pattern: str) -> str:
    paths = sorted(directory.glob(pattern))
    if not paths:
        raise RuntimeError(f"No source fragments found in {directory}")
    return "".join(read(path) for path in paths)


def load_app_js() -> str:
    """Load application fragments in an explicit, reviewed order."""
    js_dir = SRC / "js"
    validate_app_js_dependencies(APP_JS_FILES)
    missing = [name for name in APP_JS_FILES if not (js_dir / name).exists()]
    if missing:
        raise RuntimeError("Missing application JS fragments: " + ", ".join(missing))

    registered = set(APP_JS_FILES)
    candidates = [
        path for path in (js_dir / "app").glob("*.js")
    ] + [
        path for path in (js_dir / "references").glob("*.js")
    ] + [
        path for path in (js_dir / "kpi").rglob("*.js")
    ] + [
        path for path in (js_dir / "modules").rglob("*.js")
    ]
    unexpected = sorted(
        path.relative_to(js_dir).as_posix()
        for path in candidates
        if path.relative_to(js_dir).as_posix() not in registered
    )
    if unexpected:
        raise RuntimeError(
            "Unregistered application JS fragments found. Add them to APP_JS_FILES explicitly: "
            + ", ".join(unexpected)
        )

    return "".join(read(js_dir / name) for name in APP_JS_FILES)


def assert_digest(actual: str, expected: str, label: str) -> None:
    if actual.lower() != expected.lower():
        raise RuntimeError(
            f"{label} checksum mismatch: expected {expected}, got {actual}"
        )


def load_sheetjs() -> tuple[str, str]:
    """Load exactly the reviewed SheetJS 0.20.3 bytes, locally or from the pinned CDN URL."""
    local_vendor = ROOT / "vendor" / "xlsx.full.min.js"
    if local_vendor.exists():
        source_bytes = local_vendor.read_bytes()
        source_kind = "vendor-verified"
    else:
        request = Request(SHEETJS_URL, headers={"User-Agent": "Reclassifier-build"})
        with urlopen(request, timeout=60) as response:
            source_bytes = response.read()
        source_kind = "cdn-fallback-verified"

    assert_digest(
        hashlib.sha256(source_bytes).hexdigest(),
        SHEETJS_SHA256,
        "SheetJS browser build",
    )
    source = source_bytes.decode("utf-8")
    if "XLSX" not in source or len(source) < 100_000:
        raise RuntimeError("SheetJS vendor asset is invalid or incomplete")
    if 'version="0.20.3"' not in source and "version='0.20.3'" not in source:
        raise RuntimeError("SheetJS vendor asset is not the pinned 0.20.3 build")
    return source, source_kind


def load_sqlite_wasm() -> tuple[str, str, str]:
    """Load the pinned official SQLite release archive and verify it before extraction."""
    vendor_dir = ROOT / "vendor" / "sqlite"
    vendor_archive = vendor_dir / SQLITE_WASM_ARCHIVE_NAME
    legacy_vendor_js = vendor_dir / "sqlite3.js"
    legacy_vendor_wasm = vendor_dir / "sqlite3.wasm"

    if vendor_archive.exists():
        archive_bytes = vendor_archive.read_bytes()
        source_kind = "vendor-release-archive-verified"
    else:
        if legacy_vendor_js.exists() or legacy_vendor_wasm.exists():
            raise RuntimeError(
                "Unverified SQLite vendor pair is not accepted. "
                f"Remove sqlite3.js/sqlite3.wasm and provide {SQLITE_WASM_ARCHIVE_NAME} "
                "or allow the verified sqlite.org fallback."
            )
        request = Request(SQLITE_WASM_URL, headers={"User-Agent": "Reclassifier-build"})
        with urlopen(request, timeout=60) as response:
            archive_bytes = response.read()
        source_kind = "sqlite.org-release-verified"

    assert_digest(
        hashlib.sha3_256(archive_bytes).hexdigest(),
        SQLITE_WASM_ZIP_SHA3_256,
        "SQLite WASM release archive",
    )

    with zipfile.ZipFile(io.BytesIO(archive_bytes)) as archive:
        js_name = next(
            (name for name in archive.namelist() if name.endswith("/jswasm/sqlite3.js")),
            None,
        )
        wasm_name = next(
            (name for name in archive.namelist() if name.endswith("/jswasm/sqlite3.wasm")),
            None,
        )
        if not js_name or not wasm_name:
            raise RuntimeError("SQLite WASM archive does not contain jswasm/sqlite3.js + sqlite3.wasm")
        js_source = archive.read(js_name).decode("utf-8")
        wasm_bytes = archive.read(wasm_name)

    if "sqlite3InitModule" not in js_source or len(js_source) < 100_000:
        raise RuntimeError("SQLite JS loader is invalid or incomplete")
    if "wasmBinary" not in js_source:
        raise RuntimeError("SQLite JS loader does not expose embedded wasmBinary support")
    if not wasm_bytes.startswith(b"\x00asm") or len(wasm_bytes) < 500_000:
        raise RuntimeError("SQLite WASM binary is invalid or incomplete")

    # Prevent an accidental HTML parser terminator if upstream JS ever contains one in a comment/string.
    js_source = js_source.replace("</script", "<\\/script")
    return js_source, base64.b64encode(wasm_bytes).decode("ascii"), source_kind


def build_html_filename(version: str, suffix: str, test_label: str | None = None) -> str:
    """Return a deterministic CORE artifact name, optionally isolated for tests."""
    if test_label is not None:
        if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_-]{0,47}", test_label):
            raise ValueError("--test-label must be 1-48 ASCII letters/digits/_/- and begin with a letter or digit.")
        suffix += "_" + test_label
    return f"Reclassifier_v{version}{suffix}.html"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Build a standalone Reclassifier HTML without business datasets.")
    parser.add_argument("--output-dir", type=Path, help="Override dist/ output directory for isolated integration tests.")
    parser.add_argument("--test-label", help="Optional test-build filename suffix.")
    return parser.parse_args()


def main() -> Path:
    args = parse_args()
    version = os.environ.get("RECLASSIFIER_VERSION", "").strip() or read(ROOT / "VERSION").strip()
    if not re.fullmatch(r"\d+\.\d+\.\d+", version):
        raise RuntimeError(f"Invalid application version: {version!r}")
    built_at = datetime.now(timezone.utc).replace(microsecond=0).isoformat()
    template = read(SRC / "ui" / "index.html")
    css = read_fragments(SRC / "ui" / "style", "*.css")
    app_js = load_app_js()
    security_js = read(SRC / "js" / "security" / "network_guard.js")
    vendor_js, vendor_source = load_sheetjs()
    sqlite_vendor_js, sqlite_wasm_base64, sqlite_source = load_sqlite_wasm()
    reclassification_rules_js = read(SRC / "js" / "modules" / "reclassification" / "rules.js")
    reclassification_index_v4_js = read(SRC / "js" / "modules" / "reclassification" / "classifier_index_v4.js")
    reclassification_facts_v4_js = read(SRC / "js" / "modules" / "reclassification" / "facts_v4.js")
    reclassification_event_v4_js = read(SRC / "js" / "modules" / "reclassification" / "event_v4.js")
    reclassification_objects_v4_js = read(SRC / "js" / "modules" / "reclassification" / "objects_v4.js")
    reclassification_elements_v4_js = read(SRC / "js" / "modules" / "reclassification" / "elements_v4.js")
    reclassification_failure_v4_js = read(SRC / "js" / "modules" / "reclassification" / "failure_v4.js")
    reclassification_cause_v4_js = read(SRC / "js" / "modules" / "reclassification" / "cause_v4.js")
    reclassification_path_review_v4_js = read(SRC / "js" / "modules" / "reclassification" / "path_review_v4.js")
    reclassification_review_policy_v4_js = read(SRC / "js" / "modules" / "reclassification" / "review_policy_v4.js")
    reclassification_diagnostics_v4_js = read(SRC / "js" / "modules" / "reclassification" / "diagnostics_v4.js")
    reclassification_v4_js = read(SRC / "js" / "modules" / "reclassification" / "rules_v4.js")
    reclassification_registry_js = read(SRC / "js" / "modules" / "reclassification" / "engine_registry.js")
    reclassification_worker_processor_js = read(SRC / "js" / "workers" / "reclassification_processor.js")
    reclassification_xlsx_format_js = read(SRC / "js" / "workers" / "reclassification_xlsx_format.js")
    dataset_catalog_js = read(SRC / "js" / "app" / "dataset_catalog.js")
    field_registry_js = read(SRC / "js" / "app" / "field_registry.js")
    itsm_mb_presence_js = read(SRC / "js" / "modules" / "itsm" / "mb_presence.js")
    itsm_dataset_schema_js = read(SRC / "js" / "modules" / "itsm" / "dataset_schema.js")
    kpi_source_facts_js = read(SRC / "js" / "kpi" / "source_facts.js")
    itsm_kpi_source_js = read(SRC / "js" / "modules" / "itsm" / "kpi_source.js")
    itsm_rules_js = read(SRC / "js" / "modules" / "itsm" / "rules.js")
    itsm_worker_processor_js = read(SRC / "js" / "workers" / "itsm_processor.js")
    mobile_brigade_rules_js = read(SRC / "js" / "modules" / "mobile_brigade" / "rules.js")
    mobile_brigade_worker_processor_js = read(SRC / "js" / "workers" / "mobile_brigade_processor.js")
    dataset_export_worker_processor_js = read(SRC / "js" / "workers" / "dataset_export_processor.js")
    worker_dispatcher_js = read(SRC / "js" / "worker.js")
    # KPI calculation uses a separate, lazy Worker: never load SheetJS/Excel
    # into its JS runtime and never clone SQLite Datasets at application startup.
    KPI_WORKER_JS_FILES = (
        "app/dataset_catalog.js",
        "app/field_registry.js",
        "app/reliability_dashboard_data.js",
        "modules/itsm/mb_presence.js",
        "modules/itsm/dataset_schema.js",
        "kpi/source_facts.js",
        "kpi/preparation/common.js",
        "kpi/preparation/failures.js",
        "kpi/preparation/equipment.js",
        "kpi/preparation/labor.js",
        "kpi/preparation/sla.js",
        "kpi/preparation/classification.js",
        "kpi/preparation/prb.js",
        "kpi/preparation/ktg.js",
        "kpi/preparation/index.js",
        "kpi/calculator/common.js",
        "kpi/calculator/declarative.js",
    "kpi/calculator/definitions.js",
        "kpi/calculator/vbr/calculate.js",
        "kpi/calculator/ktg/calculate.js",
        "kpi/calculator/sla/calculate.js",
        "kpi/calculator/classification_quality/calculate.js",
        "kpi/calculator/classification_quality_cgps/calculate.js",
        "kpi/calculator/labor/calculate.js",
        "kpi/calculator/problem_management/calculate.js",
        "kpi/calculator/index.js",
        "kpi/catalog/contracts.js",
        "kpi/catalog/index.js",
        "kpi/execution_trace.js",
        "kpi/forecast_engine.js",
    "kpi/classification_lag_forecast.js",
        "kpi/report_view_model.js",
        "kpi/report_snapshot.js",
        "app/kpi_computation_service.js",
        "app/reliability_report_service.js",
    )
    # This adapter is only visible inside the dedicated KPI Worker. No SQLite
    # access occurs in the worker: the in-memory revision was explicitly sent by
    # the main thread. This keeps the existing Report Service and its formulas.
    kpi_worker_preamble = (
        "globalThis.ReclassifierRuntimeDataRepository = "
        "{get:(id)=>globalThis.__kpiWorkerSourcePack?.instances?.[id]||null};\n"
    )
    kpi_worker_js = kpi_worker_preamble + "\n".join(
        read(SRC / "js" / path) for path in KPI_WORKER_JS_FILES
    ) + "\n" + read(SRC / "js" / "workers" / "kpi_worker.js")
    worker_js = "\n".join((
        reclassification_rules_js,
        reclassification_index_v4_js,
        reclassification_facts_v4_js,
        reclassification_event_v4_js,
        reclassification_objects_v4_js,
        reclassification_elements_v4_js,
        reclassification_failure_v4_js,
        reclassification_cause_v4_js,
        reclassification_path_review_v4_js,
        reclassification_review_policy_v4_js,
        reclassification_diagnostics_v4_js,
        reclassification_v4_js,
        reclassification_registry_js,
        reclassification_xlsx_format_js,
        reclassification_worker_processor_js,
        dataset_catalog_js,
        field_registry_js,
        itsm_mb_presence_js,
        itsm_dataset_schema_js,
        kpi_source_facts_js,
        itsm_kpi_source_js,
        itsm_rules_js,
        itsm_worker_processor_js,
        mobile_brigade_rules_js,
        mobile_brigade_worker_processor_js,
        dataset_export_worker_processor_js,
        worker_dispatcher_js,
    ))

    # Production artifacts are intentionally data-free. User data is loaded from SQLite at runtime.
    home_artwork = load_home_artwork()

    python_assets: dict[str, str] = {}
    for path in sorted((SRC / "python").rglob("*.py")):
        key = path.relative_to(SRC / "python").as_posix()
        python_assets[key] = read(path)

    assets = {
        "worker": worker_js,
        "kpiWorker": kpi_worker_js,
        "python": python_assets,
        "sqliteWasmBase64": sqlite_wasm_base64,
        "homeArtwork": home_artwork,
    }
    build_meta = {
        "version": version,
        "testLabel": getattr(args, "test_label", None),
        "builtAt": built_at,
        "format": "single-html-core",
        "coreBuild": True,
        "dataMode": "core-no-data",
        "privateDataBuild": False,
        "embeddedReferenceFiles": 0,
        "embeddedEquipmentFiles": 0,
        "equipmentSourceCatalogs": 5,
        "homeArtworkCount": len(home_artwork),
        "excelParser": f"SheetJS CE {SHEETJS_VERSION}",
        "excelParserSource": vendor_source,
        "excelParserSha256": SHEETJS_SHA256,
        "sqliteVersion": SQLITE_WASM_VERSION,
        "sqliteWasmSource": sqlite_source,
        "sqliteWasmReleaseSha3_256": SQLITE_WASM_ZIP_SHA3_256,
    }

    html = template
    html = html.replace("/*__STYLE__*/", css)
    html = html.replace("/*__SECURITY__*/", security_js)
    html = html.replace("/*__VENDOR__*/", vendor_js)
    html = html.replace("/*__SQLITE_VENDOR__*/", sqlite_vendor_js)
    html = html.replace("/*__APP__*/", app_js)
    html = html.replace("/*__BUILD_META__*/", json.dumps(build_meta, ensure_ascii=False))
    html = html.replace("/*__EMBEDDED_ASSETS__*/", json.dumps(assets, ensure_ascii=False))

    unresolved = [marker for marker in (
        "/*__STYLE__*/", "/*__SECURITY__*/", "/*__VENDOR__*/",
        "/*__SQLITE_VENDOR__*/", "/*__APP__*/", "/*__BUILD_META__*/",
        "/*__EMBEDDED_ASSETS__*/",
    ) if marker in html]
    if unresolved:
        raise RuntimeError(f"Unresolved build markers: {unresolved}")

    output_dir = Path(getattr(args, "output_dir", None) or DIST)
    output_dir.mkdir(parents=True, exist_ok=True)
    suffix = "_CORE"
    output = output_dir / build_html_filename(version, suffix, getattr(args, "test_label", None))
    output.write_text(html, encoding="utf-8")
    print(output)
    return output


if __name__ == "__main__":
    main()
