from __future__ import annotations

import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


class ReliabilityDashboardSectionTests(unittest.TestCase):
    def setUp(self):
        self.dashboard = (ROOT / "src" / "js" / "app" / "reliability_dashboard.js").read_text(encoding="utf-8")
        self.style = (ROOT / "src" / "ui" / "style" / "05_reliability_dashboard.css").read_text(encoding="utf-8")

    def test_fixed_management_report_contains_all_five_sections(self):
        expected = (
            ("reliability-data-quality", "Данные и качество"),
            ("reliability-technical", "Техническая надёжность"),
            ("reliability-organizational", "Организационная готовность"),
            ("reliability-labor", "Трудозатраты"),
            ("reliability-problems", "Управление проблемами"),
        )
        for section_id, title in expected:
            with self.subTest(section=section_id):
                self.assertIn(section_id, self.dashboard)
                self.assertIn(title, self.dashboard)

    def test_report_uses_snapshot_charts_and_explicit_fallback_notes(self):
        for title in (
            "Динамика SLA",
            "Структура трудозатрат",
            "Связь задач МБ с ИТ-проблемами",
        ):
            self.assertIn(title, self.dashboard)

        self.assertNotIn("const vbrChart = renderReliabilityLineChart(", self.dashboard)
        self.assertNotIn("const qualityChart = renderReliabilityQualityComparisonChart(", self.dashboard)
        self.assertIn("showValues: true", self.dashboard)
        self.assertIn(
            "недостаточно месячных точек SLA",
            self.dashboard,
        )

    def test_dashboard_keeps_calculation_and_storage_outside_renderer(self):
        self.assertIn("renderReliabilityKpiCard", self.dashboard)
        self.assertIn("Паспорт KPI", self.dashboard)
        self.assertIn("reliabilitySectionIcon(id)", self.dashboard)
        self.assertIn("График", self.dashboard)
        self.assertNotIn("KPI · demo", self.dashboard)
        self.assertNotIn("canvas", self.dashboard.lower())
        self.assertNotIn("ReclassifierRuntimeDataRepository", self.dashboard)
        self.assertNotIn("ReclassifierDatabaseRepository", self.dashboard)

    def test_report_layout_has_responsive_section_styles(self):
        for selector in (
            ".reliability-report-head",
            ".reliability-section-nav",
            ".reliability-dashboard-sections",
            ".reliability-kpi-grid",
            ".reliability-chart",
        ):
            with self.subTest(selector=selector):
                self.assertIn(selector, self.style)

        self.assertIn("@media (max-width: 720px)", self.style)


if __name__ == "__main__":
    unittest.main()
