from __future__ import annotations

import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


class ReliabilityDashboardFilterTests(unittest.TestCase):
    def setUp(self):
        self.dashboard = (ROOT / "src" / "js" / "app" / "reliability_dashboard.js").read_text(encoding="utf-8")
        self.data = (ROOT / "src" / "js" / "app" / "reliability_dashboard_data.js").read_text(encoding="utf-8")
        self.service = (ROOT / "src" / "js" / "app" / "reliability_report_service.js").read_text(encoding="utf-8")
        self.style = (ROOT / "src" / "ui" / "style" / "05_reliability_dashboard.css").read_text(encoding="utf-8")

    def test_three_filter_dimensions_are_present(self):
        for token in (
            "reliabilityPeriodFilter",
            "reliabilityMineFilter",
            "reliabilityEquipmentFilter",
            "reliabilityFilterReset",
            "reliabilityRefreshKpiButton",
            "reliability-toolbar-row",
        ):
            with self.subTest(token=token):
                self.assertIn(token, self.dashboard)

        for label in ("Период", "Рудник", "Класс оборудования"):
            self.assertIn(label, self.dashboard)

    def test_filter_catalog_comes_from_snapshot_not_demo_profiles(self):
        self.assertIn("mode: 'report-snapshot'", self.data)
        self.assertIn("filterCatalog(prepared)", self.service)
        self.assertIn("equipmentClasses", self.service)
        self.assertIn("periodIds(prepared)", self.service)
        for forbidden in (
            "demo-profiles",
            "volumeFactor",
            "qualityOffset",
            "technicalOffset",
            "serviceOffset",
            "problemShareOffset",
        ):
            self.assertNotIn(forbidden, self.data)
            self.assertNotIn(forbidden, self.dashboard)

    def test_snapshot_view_updates_all_report_domains(self):
        for token in (
            "buildReliabilityDashboardView",
            "dataQuality",
            "technicalReliability",
            "organizationalReadiness",
            "snapshot.breakdowns?.labor",
            "snapshot.breakdowns?.problemManagement",
            "snapshot.series?.monthly",
        ):
            with self.subTest(token=token):
                self.assertIn(token, self.dashboard)

    def test_equipment_filter_is_semantic_equipment_class(self):
        self.assertIn("equipmentClass", self.dashboard)
        self.assertIn("equipmentClassOption", self.service)
        self.assertIn("mounted", self.service)
        self.assertIn("stationary", self.service)
        self.assertIn("focusedFilterId", self.dashboard)
        self.assertIn("restoreReliabilityDashboardFocus", self.dashboard)

    def test_filters_do_not_read_sqlite_directly(self):
        self.assertNotIn("ReclassifierRuntimeDataRepository", self.dashboard)
        self.assertNotIn("ReclassifierDatabaseRepository", self.dashboard)
        self.assertIn("ReclassifierReliabilityReportService", self.dashboard)

    def test_filter_styles_are_responsive(self):
        for selector in (
            ".reliability-filters",
            ".reliability-filters select",
            ".reliability-filter-reset",
            ".reliability-filter-note",
        ):
            with self.subTest(selector=selector):
                self.assertIn(selector, self.style)
        self.assertIn("@media (max-width: 720px)", self.style)


if __name__ == "__main__":
    unittest.main()
