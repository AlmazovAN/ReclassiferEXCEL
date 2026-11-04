from __future__ import annotations

import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


class ReliabilityDashboardChartTests(unittest.TestCase):
    def setUp(self):
        self.dashboard = (ROOT / "src" / "js" / "app" / "reliability_dashboard.js").read_text(encoding="utf-8")
        self.style = (ROOT / "src" / "ui" / "style" / "05_reliability_dashboard.css").read_text(encoding="utf-8")

    def test_snapshot_charts_have_stable_ids(self):
        for chart_id in (
            "sla-dynamics",
            "sla-dynamics",
            "labor-structure",
            "prb-linkage",
        ):
            with self.subTest(chart_id=chart_id):
                self.assertIn(chart_id, self.dashboard)

    def test_line_charts_are_inline_svg_without_external_library(self):
        self.assertIn("renderReliabilityLineChart", self.dashboard)
        self.assertIn("<svg viewBox=", self.dashboard)
        self.assertIn("reliabilityLineChartPoints", self.dashboard)
        self.assertIn("reliabilityLinePath", self.dashboard)
        self.assertNotIn("new Chart(", self.dashboard)
        self.assertNotIn("Chart.js", self.dashboard)
        self.assertNotIn("d3.", self.dashboard)
        self.assertNotIn("canvas", self.dashboard.lower())
        self.assertNotIn("http://", self.dashboard)
        self.assertNotIn("https://", self.dashboard)

    def test_labor_chart_uses_snapshot_breakdown_and_reactive_share(self):
        self.assertIn("renderReliabilityLaborChart", self.dashboard)
        self.assertIn("labor.structure", self.dashboard)
        self.assertIn("labor.reactiveShare.value", self.dashboard)
        self.assertIn("Фактическая трудоёмкость МБ", self.dashboard)

    def test_problem_chart_uses_prb_linkage_counts(self):
        self.assertIn("renderReliabilityProblemChart", self.dashboard)
        self.assertIn("problemManagement.portfolio", self.dashboard)
        self.assertIn("prb-linkage", self.dashboard)
        self.assertIn("Связь задач МБ с ИТ-проблемами", self.dashboard)

    def test_chart_styles_cover_line_labor_and_prb_visualizations(self):
        for selector in (
            ".reliability-chart",
            ".reliability-chart-svg-wrap",
            ".reliability-chart-line",
            ".reliability-chart-point",
            ".reliability-labor-stack",
            ".reliability-labor-segment",
            ".reliability-prb-bars",
            ".reliability-prb-bar",
        ):
            with self.subTest(selector=selector):
                self.assertIn(selector, self.style)


if __name__ == "__main__":
    unittest.main()
