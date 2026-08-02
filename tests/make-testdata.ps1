param(
    [switch]$SkipExcel
)

# Rebuilds everything the non-UI PowerShell suite (run-tests -Set psA)
# reads out of testdata\, starting from a fresh clone.
#
# testdata\ is .gitignore'd, so a clone has none of it and the suite used
# to open 2 PASS / 12 FAIL with nothing wrong with the product. Recorded
# as ENV-01. Everything below is rebuilt from files that ARE in the
# repository, so this works on any machine with Excel:
#
#   test_large.xlsm        tests\make-test-large.ps1, from the committed
#                          module fixture
#   guide-samples\         tests\make-guide-samples.ps1
#   input_win32_sleep.xlsm the shipping sample under sample-book\
#   input_monthly_report.xlsm  tests\make-input-monthly-report.ps1
#
# -SkipExcel does only the parts that need no copy of Excel, which is
# enough for the tests that build their own containers.
#
# Usage:
#   powershell.exe -NoProfile -ExecutionPolicy Bypass `
#       -File tests\make-testdata.ps1

$ErrorActionPreference = 'Stop'

$repoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$testdataRoot = Join-Path $repoRoot 'testdata'

# Several tests write their own scratch containers here and only need the
# directory to exist. That alone is two of the twelve failures.
if (-not [IO.Directory]::Exists($testdataRoot)) {
    [void][IO.Directory]::CreateDirectory($testdataRoot)
}
Write-Output ('testdata=' + $testdataRoot)

function Copy-Committed {
    param(
        [string]$From,
        [string]$ToName
    )

    $source = Join-Path $repoRoot $From
    if (-not [IO.File]::Exists($source)) {
        throw ('Missing committed source: ' + $source)
    }
    $target = Join-Path $testdataRoot $ToName
    [IO.File]::Copy($source, $target, $true)
    Write-Output ('copied ' + $ToName + ' <- ' + $From)
}

# A real workbook that is in the repository already; no Excel needed.
Copy-Committed 'sample-book\sample_win32_sleep.xlsm' 'input_win32_sleep.xlsm'

if ($SkipExcel) {
    Write-Output 'make-testdata: OK (skipped the Excel-built fixtures)'
    return
}

$scripts = @(
    'make-test-large.ps1',
    'make-guide-samples.ps1',
    'make-input-monthly-report.ps1'
)
foreach ($name in $scripts) {
    $path = Join-Path $PSScriptRoot $name
    if (-not [IO.File]::Exists($path)) {
        throw ('Missing generator: ' + $path)
    }
    Write-Output ('--- ' + $name + ' ---')
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $path
    if ($LASTEXITCODE -ne 0) {
        throw ($name + ' failed with exit code ' + $LASTEXITCODE)
    }
}

Write-Output 'make-testdata: OK'
