from __future__ import annotations

import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


class ReliabilityDashboardNavigationTests(unittest.TestCase):
    def test_sidebar_exposes_report_and_hides_processing_modules(self):
        html = (ROOT / "src" / "ui" / "index.html").read_text(encoding="utf-8")

        self.assertIn('data-route="home"', html)
        self.assertIn('data-route="reliability_dashboard"', html)
        self.assertNotIn('data-route="kpi_passports"', html)
        self.assertRegex(html,
                         r'<button\b(?=[^>]*data-route="database")'
                         r'(?=[^>]*data-testid="nav-database")[^>]*>'
                         r'\s*<span>База данных</span>')
        self.assertNotIn('data-route="equipment"', html)

        self.assertNotIn('<button class="nav-item" data-route="reclassification"', html)
        self.assertNotIn('<button class="nav-item" data-route="itsm"', html)
        self.assertNotIn('<button class="nav-item" data-route="mobile_brigade"', html)

    def test_equipment_catalogs_are_under_references(self):
        ui = (ROOT / 'src' / 'js' / 'references' / 'reference_ui.js').read_text(encoding='utf-8')
        equipment = (ROOT / 'src' / 'js' / 'modules' / 'equipment' / 'equipment_ui.js').read_text(encoding='utf-8')
        core = (ROOT / 'src' / 'js' / 'app' / 'core.js').read_text(encoding='utf-8')
        self.assertIn('renderEquipmentCatalogSection()', ui)
        self.assertIn('bindEquipmentCatalogSection()', ui)
        self.assertIn('if (state.activeEquipmentId) return renderEquipmentDetail(state.activeEquipmentId)', ui)
        self.assertIn("querySelectorAll('[data-reference-open]')", ui)
        self.assertIn("function renderEquipmentCatalogSection()", equipment)
        self.assertIn("EQUIPMENT_CATALOG_ORDER.map(id =>", equipment)
        self.assertIn('id="equipmentCatalogSection"', equipment)
        self.assertIn('← Справочники', equipment)
        self.assertIn('renderReferences();', equipment)
        self.assertIn("if (state.route === 'equipment') return navigate('references')", core)

    def test_processing_modules_remain_available_from_home(self):
        home = (ROOT / "src" / "js" / "app" / "home.js").read_text(encoding="utf-8")
        core = (ROOT / "src" / "js" / "app" / "core.js").read_text(encoding="utf-8")

        self.assertIn("Object.entries(moduleConfig)", home)
        self.assertIn("navigate(btn.dataset.openModule)", home)
        self.assertIn("if (moduleRenderers[state.route])", core)
        self.assertIn("if (state.route === 'kpi_passports') return renderKpiPassportsPage()", core)

    def test_dashboard_uses_report_snapshot_contract(self):
        dashboard = (ROOT / "src" / "js" / "app" / "reliability_dashboard.js").read_text(encoding="utf-8")
        dashboard_data = (ROOT / "src" / "js" / "app" / "reliability_dashboard_data.js").read_text(encoding="utf-8")
        service = (ROOT / "src" / "js" / "app" / "reliability_report_service.js").read_text(encoding="utf-8")
        core = (ROOT / "src" / "js" / "app" / "core.js").read_text(encoding="utf-8")

        self.assertIn("renderReliabilityDashboard", dashboard)
        self.assertIn('id="reliabilityOpenKpiPassportsButton"', dashboard)
        self.assertIn("navigate('kpi_passports')", dashboard)
        self.assertLess(dashboard.index('id="reliabilityOpenKpiPassportsButton"'),
                        dashboard.index('id="reliabilityRefreshKpiButton"'))
        self.assertIn("reliability_dashboard", core)
        passport = (ROOT / "src" / "js" / "kpi" / "passport_view.js").read_text(encoding="utf-8")
        self.assertIn("ReclassifierKpiPassportView", dashboard)
        self.assertIn("bindReliabilityPassportDialog", dashboard)
        self.assertIn('aria-haspopup="dialog"', dashboard)
        self.assertIn("renderContent(kpiId", passport)
        self.assertIn("Описание и назначение", passport)
        self.assertIn("Цель / порог", passport)
        self.assertIn("Связи данных", passport)
        self.assertIn("Источники и колонки", passport)
        self.assertIn("Фильтрация и исключения", passport)
        self.assertIn("Расчётная цепочка", passport)
        self.assertIn("ReclassifierReliabilityReportService", dashboard)
        self.assertIn("globalThis.ReclassifierReliabilityReportService", service)
        self.assertIn("mode: 'report-snapshot'", dashboard_data)
        self.assertNotIn("mode: 'demo'", dashboard_data)
        self.assertNotIn("prototype-only", dashboard_data)
        self.assertNotIn("ReclassifierDatabaseRepository", dashboard)
        self.assertNotIn("ReclassifierRuntimeDataRepository", dashboard)


if __name__ == "__main__":
    unittest.main()
