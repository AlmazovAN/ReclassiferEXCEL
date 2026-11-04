[CmdletBinding()]
param(
  [Parameter(Mandatory = $true, Position = 0)]
  [ValidateSet('fast', 'test', 'build', 'verify', 'release-dry-run')]
  [string] $Mode,
  [switch] $IncludeBrowser
)

$ErrorActionPreference = 'Stop'
$script:FailedSteps = @()
$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
Set-Location $root

function Invoke-Step([string] $Title, [string] $File, [string[]] $Arguments) {
  Write-Host "`n>>> $Title" -ForegroundColor Cyan
  try {
    & $File @Arguments
    if ($LASTEXITCODE -ne 0) {
      $script:FailedSteps += [pscustomobject]@{ Title = $Title; ExitCode = $LASTEXITCODE }
      Write-Host "FAIL ($LASTEXITCODE): $Title" -ForegroundColor Red
      return
    }
    Write-Host "PASS: $Title" -ForegroundColor Green
  } catch {
    $script:FailedSteps += [pscustomobject]@{ Title = $Title; ExitCode = 1 }
    Write-Host "FAIL: $Title`n$_" -ForegroundColor Red
  }
}

function Invoke-Python([string[]] $Arguments) {
  $cache = Join-Path ([IO.Path]::GetTempPath()) 'reclassifier-pycache'
  $old = $env:PYTHONPYCACHEPREFIX
  $env:PYTHONPYCACHEPREFIX = $cache
  try { Invoke-Step ($Arguments -join ' ') 'python' $Arguments }
  finally {
    if ($null -eq $old) { Remove-Item Env:PYTHONPYCACHEPREFIX -ErrorAction SilentlyContinue }
    else { $env:PYTHONPYCACHEPREFIX = $old }
  }
}

function Get-WorkflowTests {
  $workflow = Get-Content '.github/workflows/build.yml' -Raw
  $matches = [regex]::Matches($workflow,
    '(?m)^\s*(?:run:\s*)?(?:TZ=\S+\s+)?node\s+(?:--max-old-space-size=\d+\s+)?(tests/[A-Za-z0-9_./-]+\.js)')
  $seen = [System.Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
  foreach ($match in $matches) {
    $test = $match.Groups[1].Value
    if ($seen.Add($test)) { $test }
  }
}

function Get-WorkflowSyntaxChecks {
  $workflow = Get-Content '.github/workflows/build.yml' -Raw
  $matches = [regex]::Matches($workflow,
    '(?m)^\s*node\s+--check\s+((?:src|tests)/[A-Za-z0-9_./-]+\.js)')
  $seen = [System.Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
  foreach ($match in $matches) {
    $file = $match.Groups[1].Value
    if ($seen.Add($file)) { $file }
  }
}

function Find-Chromium {
  if ($env:CHROMIUM_PATH -and (Test-Path -LiteralPath $env:CHROMIUM_PATH)) {
    return (Resolve-Path -LiteralPath $env:CHROMIUM_PATH).Path
  }
  $candidates = @(
    "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
    "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
    "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe",
    "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe",
    "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe"
  )
  foreach ($candidate in $candidates) {
    if ($candidate -and (Test-Path -LiteralPath $candidate)) { return $candidate }
  }
  foreach ($name in @('chrome.exe', 'msedge.exe', 'chromium.exe')) {
    $command = Get-Command $name -ErrorAction SilentlyContinue
    if ($command) { return $command.Source }
  }
  return $null
}

function Reset-AcceptanceDirectory([string] $Name) {
  if ($Name -notmatch '\A[A-Za-z0-9_-]+\z') {
    throw "Invalid generated acceptance directory name: $Name"
  }
  $acceptancePath = Join-Path $root 'dist/acceptance'
  New-Item -ItemType Directory -Path $acceptancePath -Force | Out-Null
  $acceptanceRoot = (Resolve-Path -LiteralPath $acceptancePath).Path.TrimEnd([IO.Path]::DirectorySeparatorChar)
  $targetPath = Join-Path $acceptanceRoot $Name
  if (Test-Path -LiteralPath $targetPath) {
    $resolvedTarget = (Resolve-Path -LiteralPath $targetPath).Path
    if (-not [string]::Equals($resolvedTarget, $targetPath, [StringComparison]::OrdinalIgnoreCase)) {
      throw "Refusing to clean acceptance directory outside its expected path: $resolvedTarget"
    }
    Remove-Item -LiteralPath $resolvedTarget -Recurse -Force
  }
  New-Item -ItemType Directory -Path $targetPath -Force | Out-Null
  return "dist/acceptance/$Name"
}

function Invoke-Tests([bool] $WithBuild) {
  $oldTemp = $env:TEMP
  $oldTmp = $env:TMP
  $localTemp = Join-Path $root 'dist/acceptance/local-temp'
  New-Item -ItemType Directory -Path $localTemp -Force | Out-Null
  $env:TEMP = $localTemp
  $env:TMP = $localTemp
  try {
  Invoke-Python @('-m', 'compileall', '-q', 'src/python')
  Invoke-Python @('-m', 'unittest', 'discover', '-s', 'tests', '-p', 'test_*.py')

  $tmpBundle = Join-Path ([IO.Path]::GetTempPath()) 'reclassifier-app-check.js'
  $tmpScript = Join-Path ([IO.Path]::GetTempPath()) 'reclassifier-app-check.py'
  $extract = @'
import importlib.util
import os
from pathlib import Path
spec = importlib.util.spec_from_file_location("reclassifier_build", Path("build/build.py"))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
Path(os.environ["RECLASSIFIER_CHECK_BUNDLE"]).write_text(module.load_app_js(), encoding="utf-8")
'@
  Set-Content -LiteralPath $tmpScript -Value $extract -Encoding UTF8
  $env:RECLASSIFIER_CHECK_BUNDLE = $tmpBundle
  try { Invoke-Python @($tmpScript) }
  finally { Remove-Item Env:RECLASSIFIER_CHECK_BUNDLE -ErrorAction SilentlyContinue }
  Invoke-Step 'Check assembled JavaScript syntax' 'node' @('--check', $tmpBundle)
  Remove-Item -LiteralPath $tmpBundle -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $tmpScript -Force -ErrorAction SilentlyContinue
  foreach ($file in Get-WorkflowSyntaxChecks) {
    Invoke-Step "JavaScript syntax: $file" 'node' @('--check', $file)
  }

  $browser = Find-Chromium
  if ($IncludeBrowser -and -not $browser) {
    throw 'Browser acceptance requested, but Chromium/Chrome/Edge was not found. Install Chrome/Edge or set CHROMIUM_PATH.'
  }
  if ($browser) { $env:CHROMIUM_PATH = $browser; $env:CHROME_PATH = $browser }

  $buildTests = @(
    'tests/test_database_wasmfs_lifecycle.js', 'tests/test_legacy_sqlite_parity.js',
    'tests/test_mb_sqlite_staging.js', 'tests/test_reclassification_v4_02_build.js',
    'tests/test_reclassification_v4_04_build.js', 'tests/test_reclassification_v4_05_build.js',
    'tests/test_reclassification_v4_06_build.js', 'tests/test_reclassification_v4_07_build.js',
    'tests/test_sqlite_full_dataset_roundtrip.js', 'tests/test_sqlite_registry_compatibility.js',
    'tests/test_sqlite_wasm_large_upsert.js', 'tests/test_step9_bootstrap_rollback.js'
  )
  foreach ($test in Get-WorkflowTests) {
    if (-not $WithBuild -and ($test -match '_build\.js$' -or $test -match '_browser_offline\.js$' -or $test -in $buildTests)) {
      Write-Host "SKIP (requires current local build): $test" -ForegroundColor Yellow
      continue
    }
    if ($test -eq 'tests/test_core_browser_offline.js') {
      if (-not $browser) { Write-Host "SKIP (no Chromium): $test" -ForegroundColor Yellow; continue }
    }
    $oldTz = $env:TZ
    $env:TZ = 'UTC'
    try { Invoke-Step $test 'node' @($test) }
    finally { if ($null -eq $oldTz) { Remove-Item Env:TZ -ErrorAction SilentlyContinue } else { $env:TZ = $oldTz } }
  }
  }
  finally {
    if ($null -eq $oldTemp) { Remove-Item Env:TEMP -ErrorAction SilentlyContinue }
    else { $env:TEMP = $oldTemp }
    if ($null -eq $oldTmp) { Remove-Item Env:TMP -ErrorAction SilentlyContinue }
    else { $env:TMP = $oldTmp }
  }
}

switch ($Mode) {
  'fast' { Invoke-Python @('tests/run_ci_manifest.py', 'fast') }
  'test' { Invoke-Tests $false }
  'build' { Invoke-Python @('build/build.py') }
  'release-dry-run' { Invoke-Python @('tools/release_dry_run.py') }
  'verify' {
    $coreBrowserDir = Reset-AcceptanceDirectory 'local-ci-core'
    Invoke-Python @('build/build.py', '--output-dir', $coreBrowserDir)
    $version = (Get-Content 'VERSION' -Raw).Trim()
    $coreArtifact = Join-Path $coreBrowserDir "Reclassifier_v$($version)_CORE.html"
    $env:RECLASSIFIER_CORE_HTML_DIR = $coreBrowserDir
    $env:RECLASSIFIER_HTML_DIR = $coreBrowserDir
    $env:RECLASSIFIER_RELEASE_HTML = $coreArtifact
    Invoke-Python @('tests/check_reliability_dashboard_release.py')
    Invoke-Tests $true
    Invoke-Python @('tests/check_core_html.py')
    Remove-Item Env:RECLASSIFIER_CORE_HTML_DIR -ErrorAction SilentlyContinue
    Remove-Item Env:RECLASSIFIER_HTML_DIR -ErrorAction SilentlyContinue
    Remove-Item Env:RECLASSIFIER_RELEASE_HTML -ErrorAction SilentlyContinue
  }
}

if ($script:FailedSteps.Count) {
  Write-Host "`nLocal CI failed: $($script:FailedSteps.Count) step(s)." -ForegroundColor Red
  $script:FailedSteps | ForEach-Object { Write-Host " - $($_.Title) (exit $($_.ExitCode))" -ForegroundColor Red }
  exit 1
}
Write-Host "`nLocal CI passed: $Mode" -ForegroundColor Green
