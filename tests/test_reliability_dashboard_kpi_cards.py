from __future__ import annotations

import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


class ReliabilityDashboardKpiCardTests(unittest.TestCase):
    def setUp(self):
        self.dashboard = (ROOT / "src" / "js" / "app" / "reliability_dashboard.js").read_text(encoding="utf-8")
        self.data = (ROOT / "src" / "js" / "app" / "reliability_dashboard_data.js").read_text(encoding="utf-8")
        self.style = (ROOT / "src" / "ui" / "style" / "05_reliability_dashboard.css").read_text(encoding="utf-8")
        self.passport = (ROOT / "src" / "js" / "kpi" / "passport_view.js").read_text(encoding="utf-8")

    def test_universal_card_renders_snapshot_fields(self):
        for token in (
            "formatReliabilityNumber",
            "renderReliabilityKpiCard",
            "Предыдущее",
            "Изменение",
            "Прогноз",
            "reliabilityStatusMeta",
            "KPI · рассчитан",
        ):
            with self.subTest(token=token):
                self.assertIn(token, self.dashboard)

    def test_passport_uses_shared_catalog_source_and_covers_lineage(self):
        self.assertIn('data-kpi-passport-open', self.dashboard)
        self.assertIn("aria-haspopup=\"dialog\"", self.dashboard)
        self.assertIn("ReclassifierKpiPassportView", self.dashboard)
        self.assertNotIn("renderReliabilityMethodology", self.dashboard)
        self.assertNotIn('class="reliability-kpi-methodology"', self.dashboard)
        for token in (
            "ReclassifierKpiCatalog", "renderContent(kpiId", "Формула",
            "Источники и колонки", "Связи данных", "Фильтрация и исключения",
            "Расчётная цепочка", "Агрегирование и арифметика",
            "Периоды и прогноз", "Текущий результат и происхождение",
            "Шаг", "Операция", "Семантическое поле", "Заголовок источника",
            "Пустые значения", "Кардинальность", "Дубликаты / правило",
            "Нулевой знаменатель", "Версия формулы", "методика",
        ):
            with self.subTest(token=token):
                self.assertIn(token.casefold(), self.passport.casefold())

    def test_previous_change_forecast_from_snapshot_without_fabrication(self):
        for token in (
            "snapshot?.kpiView?.cards?.[template.id]",
            "cardView.previous.value",
            "cardView?.change",
            "cardView?.changeUnit",
            "cardView?.forecast",
            "formatReliabilitySignedMetric",
            "reliabilityForecastPresentation",
            "forecast-method-not-defined",
            "Методика не задана",
            "Нет горизонта или метода",
            "reliability-kpi-meta-forecast",
            "reliability-kpi-forecast-note",
        ):
            with self.subTest(token=token):
                self.assertIn(token, self.dashboard)

        # The third slot has become forecast, but the legacy inline passport
        # retains the methodology label for targets until Step 5.
        meta = self.dashboard.split('class="reliability-kpi-meta"')[1].split(
            "class=\"reliability-kpi-actions\""
        )[0]
        self.assertIn("<span>Предыдущее</span>", meta)
        self.assertIn("<span>Изменение</span>", meta)
        self.assertIn("<span>Прогноз</span>", meta)
        self.assertNotIn("<span>Цель</span>", meta)

        for forbidden in ("previousValue:", "change:", "target:", "forecast:"):
            self.assertNotIn(forbidden, self.data)

    def test_unsupported_kpis_are_explicit_placeholders(self):
        self.assertIn("calculationState: 'not-implemented'", self.data)
        self.assertIn("result?.dataState || 'not-applicable'", self.dashboard)
        self.assertIn("KPI · не подключён", self.dashboard)

    def test_card_styles_cover_statuses_and_methodology(self):
        for selector in (
            ".reliability-kpi-card",
            ".reliability-kpi-status.good",
            ".reliability-kpi-status.warning",
            ".reliability-kpi-status.neutral",
            ".reliability-kpi-meta",
            ".reliability-kpi-meta-forecast",
            ".reliability-kpi-forecast-note",
            ".reliability-kpi-passport-dialog",
            ".reliability-kpi-passport-button",
            ".reliability-kpi-chart-button",
            ".reliability-kpi-chart-dialog",
            ".reliability-chart-modal-moving",
            ".reliability-kpi-passport-close",
            ".kpi-passport-table",
            ".kpi-passport-math-block",
            ".kpi-passport-overview-prose",
            ".kpi-passport-formula-technical",
            ".kpi-passport-section",
            ".kpi-passport-dataset",
            ".kpi-passport-execution-trace",
            ".reliability-kpi-data-state",
        ):
            with self.subTest(selector=selector):
                self.assertIn(selector, self.style)


if __name__ == "__main__":
    unittest.main()
