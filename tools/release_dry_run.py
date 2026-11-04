"""Build and validate the next release package locally without publishing it."""

from __future__ import annotations

import os
import re
import subprocess
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def next_version() -> str:
    base = (ROOT / "VERSION").read_text(encoding="utf-8").strip()
    match = re.fullmatch(r"(\d+)\.(\d+)\.(\d+)", base)
    if not match:
        raise SystemExit(f"Invalid VERSION: {base!r}")
    major, minor, base_patch = map(int, match.groups())
    prefix = f"v{major}.{minor}."
    tags = subprocess.check_output(
        ["git", "tag", "--list", f"{prefix}*"], cwd=ROOT, text=True
    ).splitlines()
    patches = []
    for tag in tags:
        found = re.fullmatch(rf"{re.escape(prefix)}(\d+)", tag.strip())
        if found:
            patches.append(int(found.group(1)))
    patch = max(patches) + 1 if patches else base_patch
    return f"{major}.{minor}.{patch}"


def run(args: list[str], env: dict[str, str]) -> None:
    print(f"\n>>> {' '.join(args)}", flush=True)
    result = subprocess.run(args, cwd=ROOT, env=env, check=False)
    if result.returncode:
        raise SystemExit(result.returncode)


def main() -> int:
    version = next_version()
    env = os.environ.copy()
    env["RECLASSIFIER_VERSION"] = version
    python = sys.executable
    run([python, "build/build.py"], env)
    run([python, "tests/check_core_html.py"], env)

    core = ROOT / "dist" / f"Reclassifier_v{version}_CORE.html"
    print(f"\nRelease dry-run passed: v{version}; no tag or GitHub Release created.")
    print(f"Validated CORE package: {core}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
