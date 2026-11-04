from __future__ import annotations

import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


class SecurityContractTests(unittest.TestCase):
    def test_html_csp_is_offline_only(self):
        html = (ROOT / "src" / "ui" / "index.html").read_text(encoding="utf-8")

        self.assertIn("Content-Security-Policy", html)
        self.assertIn("default-src 'none'", html)
        self.assertIn("connect-src 'none'", html)
        self.assertIn("worker-src blob:", html)
        self.assertIn("'wasm-unsafe-eval'", html)
        self.assertIn("object-src 'none'", html)
        self.assertIn("base-uri 'none'", html)
        self.assertIn("form-action 'none'", html)

        self.assertLess(html.index("/*__SECURITY__*/"), html.index("/*__VENDOR__*/"))

    def test_runtime_network_guard_blocks_common_network_apis(self):
        source = (ROOT / "src" / "js" / "security" / "network_guard.js").read_text(encoding="utf-8")
        for marker in ("fetch", "XMLHttpRequest", "WebSocket", "EventSource", "sendBeacon"):
            self.assertIn(marker, source)
        self.assertIn("RECLASSIFIER_NETWORK_POLICY", source)
        self.assertIn("offline-only", source)

    def test_build_embeds_security_guard(self):
        build = (ROOT / "build" / "build.py").read_text(encoding="utf-8")
        self.assertIn('security_js = read(SRC / "js" / "security" / "network_guard.js")', build)
        self.assertIn('html.replace("/*__SECURITY__*/", security_js)', build)


if __name__ == "__main__":
    unittest.main()
