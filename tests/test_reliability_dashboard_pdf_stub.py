from __future__ import annotations

import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


class ReliabilityDashboardPdfExportTests(unittest.TestCase):
    def setUp(self):
        self.dashboard = (ROOT / "src" / "js" / "app" / "reliability_dashboard.js").read_text(encoding="utf-8")
        self.renderer = (ROOT / "src" / "js" / "app" / "reliability_pdf.js").read_text(encoding="utf-8")
        self.style = (ROOT / "src" / "ui" / "style" / "05_reliability_dashboard.css").read_text(encoding="utf-8")

    def test_pdf_entrypoint_is_visible_and_bound(self):
        for token in (
            "reliabilityPdfExportButton",
            "Скачать PDF",
            "bindReliabilityPdfExport",
            "reliabilityPdfExportMessage",
            "ReclassifierReliabilityPdfRenderer",
        ):
            with self.subTest(token=token):
                self.assertIn(token, self.dashboard)

    def test_dashboard_passes_exact_active_snapshot_to_renderer(self):
        self.assertIn("renderer.download(dashboard.snapshot, {", self.dashboard)
        self.assertIn("onProgress: update =>", self.dashboard)
        self.assertIn("Формирование PDF", self.dashboard)
        self.assertIn("PDF скачан:", self.dashboard)
        self.assertIn("result.pageCount", self.dashboard)
        self.assertIn("result.pageCount", self.dashboard)
        self.assertIn("reliabilityQueryLabel(dashboard.snapshot)", self.dashboard)
        self.assertNotIn("будет подключён следующим шагом", self.dashboard)

    def test_renderer_is_real_offline_pdf_generator(self):
        for token in (
            "application/pdf",
            "buildPdfBytes",
            "canvas.getContext('2d'",
            "image/jpeg",
            "/Filter /DCTDecode",
            "%PDF-1.4",
            "URL.createObjectURL",
            "anchor.download",
            "snapshotFingerprint",
        ):
            with self.subTest(token=token):
                self.assertIn(token, self.renderer)

        for forbidden in (
            "jsPDF",
            "html2canvas",
            "pdfmake",
            "https://",
            "http://",
            "window.print",
        ):
            with self.subTest(forbidden=forbidden):
                self.assertNotIn(forbidden, self.renderer)

    def test_pdf_button_has_responsive_styles(self):
        for selector in (
            ".reliability-report-side",
            ".reliability-report-actions",
            ".reliability-pdf-button",
            ".reliability-pdf-status",
        ):
            with self.subTest(selector=selector):
                self.assertIn(selector, self.style)
        self.assertIn("@media (max-width: 720px)", self.style)


if __name__ == "__main__":
    unittest.main()
