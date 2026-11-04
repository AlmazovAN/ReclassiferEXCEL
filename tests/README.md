# Test pipeline

The fast pull request gate is defined in [../.github/workflows/test-fast.yml](../.github/workflows/test-fast.yml). It pins Python 3.12 and Node.js 22 and runs the `fast` suite from [ci_suites.json](ci_suites.json). The local runner uses the same manifest for its `fast` mode. Full acceptance is defined in [../.github/workflows/build.yml](../.github/workflows/build.yml); it runs on `main` and manually, discovers every `test_*.py` through `unittest`, and performs build, browser and SQLite acceptance checks. Publishing is isolated in [../.github/workflows/release.yml](../.github/workflows/release.yml), which is manual, requires an explicit confirmation, and checks for successful full acceptance on the same commit.

## Run locally

Use the Windows runner as the canonical local entry point. It reads JavaScript
test commands and syntax checks from the same workflow file, then applies the
local fixture and browser rules:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File tools/local-ci.ps1 fast
powershell -NoProfile -ExecutionPolicy Bypass -File tools/local-ci.ps1 test
powershell -NoProfile -ExecutionPolicy Bypass -File tools/local-ci.ps1 build
powershell -NoProfile -ExecutionPolicy Bypass -File tools/local-ci.ps1 verify
powershell -NoProfile -ExecutionPolicy Bypass -File tools/local-ci.ps1 release-dry-run
```

`fast` runs the shared fast suite used by pull requests. `test` runs Python
compilation, all discovered Python tests, the full workflow JavaScript
regressions and syntax checks. `build` creates standalone CORE HTML.
`verify` builds the data-free CORE artifact, validates it, then runs browser and SQLite acceptance with anonymous fixtures. Browser checks run when Chrome,
Chromium or Edge is found; use `-IncludeBrowser` to make a missing browser an
error. Business datasets are never used by tests or builds.
See [../tools/LOCAL-CI.md](../tools/LOCAL-CI.md) for details.

`release-dry-run` computes the next patch version from local Git tags, builds
and validates the same data-free CORE package, and never creates a tag
or publishes a GitHub Release. The manual GitHub release workflow also has a
`validate` mode that requires successful full acceptance for the same commit.

Browser acceptance opens local `file://` HTML with network access disabled and synthetic test data only.

## Inventory and current gaps

`ci_test_inventory.json` records JavaScript test files not directly invoked by the current workflow, plus a one-time local probe result. The inventory contract test fails if a test file becomes unclassified or if the workflow and inventory drift. Local probe results were collected on Node 24.22.0 / Python 3.15 with no `RECLASSIFIER_HTML_DIR`; the CI runtime is Node 22 / Python 3.12, so local failures need reproduction on the pinned CI versions before being treated as product regressions. A timeout is recorded separately from a failure.

The Windows runner discovers JavaScript checks from the manually triggered acceptance workflow. Temporary Node/Python files are placed under ignored `dist/acceptance/local-temp`.

The full acceptance workflow promotes seven previously deferred regressions covering SQL projections, runtime KPI projection, XLSX text and transport contracts, classification causes, bounded Mobile Brigade SQLite batches, and diagnostic archive retention. They were re-run locally on the current Windows runner before promotion; GitHub Actions remains the final check on its pinned runtime.

A local pass means a candidate for the next CI layering step, not automatic approval to add every test to the current serial job. Stress, browser, and artifact-dependent tests need an explicit runner layer and runtime budget.

Subject-matter golden and architecture tests protect classification behavior, data boundaries, SQLite parity, offline operation, and report formulas. Changes to UI or runtime must not silently fall back to an HTML baseline when an open SQLite source fails.
