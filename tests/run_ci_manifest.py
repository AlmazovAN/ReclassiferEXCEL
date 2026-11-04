"""Run the shared, explicitly selected CI suite from tests/ci_suites.json."""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
MANIFEST = ROOT / "tests" / "ci_suites.json"


def main() -> int:
    if len(sys.argv) != 2:
        print("Usage: python tests/run_ci_manifest.py <suite>", file=sys.stderr)
        return 2

    manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
    suite_name = sys.argv[1]
    suite = manifest.get("suites", {}).get(suite_name)
    if suite is None:
        print(f"Unknown CI suite: {suite_name}", file=sys.stderr)
        return 2

    commands = [([sys.executable, *args], "Python") for args in suite.get("python", [])]
    commands.extend((["node", test], "JavaScript") for test in suite.get("javascript", []))
    for command, runtime in commands:
        print(f"\n>>> {' '.join(command)}", flush=True)
        result = subprocess.run(command, cwd=ROOT, check=False)
        if result.returncode:
            print(f"FAIL ({result.returncode}): {runtime} command", file=sys.stderr)
            return result.returncode
    print(f"\nCI suite passed: {suite_name}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
