[CmdletBinding()]
param(
  [ValidateSet('verify', 'build', 'test', 'fast')]
  [string] $Mode = 'verify'
)

$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
Set-Location $root

function Invoke-Checked([string] $Name, [string] $Exe, [string[]] $Arguments) {
  Write-Host ("[LOCAL] " + $Name)
  & $Exe @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "$Name failed (exit code $LASTEXITCODE)."
  }
}

$folderTests = @(Get-ChildItem -LiteralPath 'tests' -Filter 'test_folders*.cjs' -File |
    Sort-Object Name | ForEach-Object { $_.FullName })

$v4Tests = @(
  'tests/test_reclassification_v4_03_corpus.js',
  'tests/test_reclassification_engines_v4_02.js',
  'tests/test_reclassification_classifier_index_v4_04.js',
  'tests/test_reclassification_facts_v4_05.js',
  'tests/test_reclassification_event_v4_06.js',
  'tests/test_reclassification_diagnostics_v4_06.js',
  'tests/test_reclassification_objects_v4_07.js',
  'tests/test_reclassification_elements_v4_08.js',
  'tests/test_reclassification_failure_v4_09.js',
  'tests/test_reclassification_cause_v4_10.js',
  'tests/test_reclassification_path_review_v4_11.js',
  'tests/test_reclassification_review_policy_v4_12.js'
)

if ($Mode -in @('verify', 'build')) {
  Invoke-Checked 'Контроль структуры и зависимостей' 'python' @('tests/check_active_tree.py')
  $manifest = Get-Content 'src/folders/engine-files.json' -Raw -Encoding UTF8 | ConvertFrom-Json
  foreach ($relativePath in $manifest) {
    if (-not (Test-Path -LiteralPath $relativePath -PathType Leaf)) {
      throw "Отсутствует зависимость Worker: $relativePath"
    }
    if ($relativePath -like '*.js' -and $relativePath -notlike 'vendor/*') {
      Invoke-Checked "Синтаксис $relativePath" 'node' @('--check', $relativePath)
    }
  }
  Invoke-Checked 'Сборка ReclassifierEXCEL.html' 'python' @('build/build_folders.py')
}

if ($Mode -in @('verify', 'test', 'fast')) {
  if (-not (Test-Path -LiteralPath 'dist/ReclassifierEXCEL.html')) {
    throw 'Нет dist/ReclassifierEXCEL.html — сначала запустите build или verify.'
  }
  if ($folderTests.Count -eq 0) { throw 'Нет тестов folders.' }
  Invoke-Checked 'Проверки интерфейса и Excel-процессов Папки' 'node' (@('--test') + $folderTests)
}

if ($Mode -in @('verify', 'test')) {
  foreach ($path in $v4Tests) {
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
      throw "Отсутствует тест V4: $path"
    }
    Invoke-Checked "Правила реклассификации $path" 'node' @($path)
  }
}
Write-Host "[LOCAL] $Mode completed successfully."
