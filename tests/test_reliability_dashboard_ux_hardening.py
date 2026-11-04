from __future__ import annotations

import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


class ReliabilityDashboardUxHardeningTests(unittest.TestCase):
    def setUp(self):
        self.dashboard = (ROOT / "src" / "js" / "app" / "reliability_dashboard.js").read_text(encoding="utf-8")
        self.data = (ROOT / "src" / "js" / "app" / "reliability_dashboard_data.js").read_text(encoding="utf-8")
        self.style = (ROOT / "src" / "ui" / "style" / "05_reliability_dashboard.css").read_text(encoding="utf-8")

    def test_native_passport_dialog_has_focus_and_close_controls(self):
        for token in (
            "bindReliabilityPassportDialog",
            'id="reliabilityKpiPassportDialog"',
            'aria-labelledby="reliabilityKpiPassportTitle"',
            'aria-modal="true"',
            'id="reliabilityKpiPassportClose"',
            'aria-label="Закрыть паспорт KPI"',
            "showModal()",
            "dialog.close()",
            "addEventListener('close'",
            "opener.focus",
            "view.renderContent(item.id",
        ):
            with self.subTest(token=token):
                self.assertIn(token, self.dashboard)
        self.assertNotIn("openMethodologies", self.dashboard)
        self.assertNotIn("reliabilityMethodology_", self.dashboard)

    def test_data_states_have_explicit_ui_contract(self):
        for state in ("available", "no-data", "unavailable", "insufficient", "not-applicable", "error"):
            with self.subTest(state=state):
                self.assertIn(state, self.dashboard)
        for label in ("Нет данных", "Расчёт недоступен", "Недостаточно данных", "Не рассчитывается", "Ошибка расчёта"):
            self.assertIn(label, self.dashboard)

    def test_snapshot_status_is_visibly_marked_without_demo_fallback(self):
        self.assertIn("Расчёт по Dataset", self.dashboard)
        self.assertIn("Частичный расчёт", self.dashboard)
        self.assertIn("Нет источников", self.dashboard)
        self.assertNotIn("demo ·", self.dashboard)
        self.assertNotIn("Демонстрационные данные", self.dashboard)

    def test_labor_unit_is_period_neutral(self):
        self.assertIn("displayHoursUnit", self.dashboard)
        self.assertIn("'чел.-ч'", self.data)
        self.assertNotIn("чел.-ч/год", self.data)
        self.assertNotIn("чел.-ч за выбранный период", self.dashboard)

    def test_line_chart_has_responsive_svg_container(self):
        self.assertIn("reliability-chart-svg-wrap", self.dashboard)
        self.assertIn(".reliability-chart-svg-wrap", self.style)

    def test_report_has_compact_live_coverage_line(self):
        self.assertIn("reliability-evidence-line", self.dashboard)
        self.assertIn("Рассчитано KPI:", self.dashboard)
        self.assertIn("Доступно источников:", self.dashboard)
        self.assertIn("Наполнение:", self.dashboard)
        self.assertIn(".reliability-evidence-line", self.style)


if __name__ == "__main__":
    unittest.main()
