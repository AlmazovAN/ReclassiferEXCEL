from __future__ import annotations

import os
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DIST = ROOT / "dist"

requested = os.environ.get("RECLASSIFIER_RELEASE_HTML")
files = [Path(requested)] if requested else (
    sorted(DIST.glob("Reclassifier_v*_CORE.html"))
)
if len(files) != 1:
    raise SystemExit(f"Expected exactly one standalone FULL or CORE Reclassifier_v*.html, found {len(files)}")

path = files[0]
html = path.read_text(encoding="utf-8")

required = (
    "Отчёт по надёжности СДГР",
    'data-route="reliability_dashboard"',
    "ReclassifierReliabilityDashboardData",
    "ReclassifierReliabilityReportService",
    "ReclassifierReliabilityPdfRenderer",
    "ReclassifierReportSnapshot",
    "reliability-data-quality",
    "reliability-technical",
    "reliability-organizational",
    "reliability-labor",
    "reliability-problems",
    "reliabilityPeriodFilter",
    "reliabilityMineFilter",
    "reliabilityEquipmentFilter",
    "reliability-sla-compact",
    "sla-dynamics",
    'data-chart-id="labor-structure"',
    'data-chart-id="prb-linkage"',
    "reliabilityPdfExportButton",
    "reliabilityPdfExportStatus",
    "reliabilityRefreshKpiButton",
    "Формирование PDF",
    "PDF скачан:",
    "application/pdf",
    "%PDF-1.4",
    "Рассчитано KPI:",
    "Паспорт KPI",
    "ReclassifierKpiPassportView",
    "ReclassifierKpiPassportMath",
    'xmlns="http://www.w3.org/1998/Math/MathML"',
    "Машинная запись и версия формулы",
    "ReclassifierKpiExecutionTrace",
    "Показать расчёт",
    'data-kpi-passport-open=',
    "renderKpiPassportsPage",
    "kpiPassportsCatalogList",
    "kpiPassportsDetail",
    "kpiPassportsGoReport",
    "reliabilityKpiPassportDialog",
    "reliabilityKpiChartDialog",
    "data-kpi-chart-open",
    "ReclassifierKpiChartViewModel",
    "data-kpi-chart-mine",
    "data-kpi-chart-class",
    "data-kpi-chart-range",
    "Скользящий тренд",
    "Состав расчёта",
    "reliabilityKpiFormulaSeries",
    "reliabilityKpiFormulaMonth",
    "reliability-formula-fraction",
    "ТО план (допущение)",
    "ДФРВ",
    "Доступна статистика с",
    "reliabilityKpiPassportClose",
    "data-kpi-passport-open",
    "Источники и колонки",
    "Расчётная цепочка",
    "Агрегирование и арифметика",
    "Текущий результат и происхождение",
    "Как рассчитывается показатель",
    "Техническая документация:",
    "Показать колонки и реквизиты источника",
    "Дата выполнения обращения",
    "Фактические трудозатраты",
    "1М",
    "3М",
    "1Г",
    "Все",
)


missing = [token for token in required if token not in html]
if missing:
    raise SystemExit("Reliability dashboard release markers are missing: " + ", ".join(missing))

if any(token in html for token in (
    "KPI · demo",
    "График · demo",
    "volumeFactor",
    "qualityOffset",
    "technicalOffset",
    "serviceOffset",
    "problemShareOffset",
    "Демонстрационные данные",
    "будет подключён следующим шагом",
)):
    raise SystemExit("Reliability dashboard release still contains legacy demo calculation markers")

if "https://cdn." in html or '<script src="http' in html or '<link href="http' in html:
    raise SystemExit("Monolithic release unexpectedly contains external runtime dependencies")

size_mb = path.stat().st_size / (1024 * 1024)
print(f"Reliability dashboard monolithic release: OK ({path.name}, {size_mb:.1f} MiB)")
