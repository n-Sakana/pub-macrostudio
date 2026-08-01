param(
    [string]$SamplesDir,
    [string]$ProductRoot,
    [string]$EvidenceDir,
    [string[]]$Only
)

# Every guide sample driven through the real host, end to end.
#
# Not a browser and not a stub: the same WPF window, the same WebView2,
# the same MessageRouter and HostServices the product ships with. Each
# sample is attached, diagnosed, categorised, selected, repaired, taken
# back in, rebuilt and read back, and the run folder is inspected.
#
# The diagnosis names the constraint the sample was built around, so the
# walk goes through the category that sample belongs to rather than
# through "no constraint named".
#
# Screenshots of the diagnosis screen land in the evidence directory,
# one per sample, at the shipped 4:3 window size.
#
# Build the books first:
#   powershell.exe -NoProfile -ExecutionPolicy Bypass `
#       -File tests\make-guide-samples.ps1

$ErrorActionPreference = 'Stop'

function Assert-True {
    param([bool]$Condition, [string]$Message)
    if (-not $Condition) { throw $Message }
}

if ([string]::IsNullOrEmpty($ProductRoot)) {
    $ProductRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
}
$repoRoot = (Resolve-Path -LiteralPath $ProductRoot).Path

if ([string]::IsNullOrEmpty($SamplesDir)) {
    $SamplesDir = Join-Path $repoRoot 'testdata\guide-samples'
}
Assert-True ([IO.Directory]::Exists($SamplesDir)) `
    ('Build the samples first with tests\make-guide-samples.ps1. Missing: ' +
     $SamplesDir)
$SamplesDir = (Resolve-Path -LiteralPath $SamplesDir).Path

# The flow runner only writes screenshots inside testdata, so they are
# taken there and copied out afterwards.
$shotDir = Join-Path $repoRoot 'testdata\guide-sample-shots'
if (-not [IO.Directory]::Exists($shotDir)) {
    [void][IO.Directory]::CreateDirectory($shotDir)
}
if (-not [string]::IsNullOrEmpty($EvidenceDir) -and
    -not [IO.Directory]::Exists($EvidenceDir)) {
    [void][IO.Directory]::CreateDirectory($EvidenceDir)
}

$manifest = [IO.File]::ReadAllText(
    (Join-Path $repoRoot 'tests\fixtures\guide-samples\samples.json'),
    [Text.Encoding]::UTF8) | ConvertFrom-Json

# -File hands every argument over as one string.
$selected = @()
foreach ($item in @($Only)) {
    foreach ($part in ([string]$item).Split(',')) {
        if ($part.Trim() -ne '') { $selected += $part.Trim() }
    }
}
$wanted = @($manifest.samples)
if ($selected.Count -gt 0) {
    $wanted = @($wanted | Where-Object { $selected -contains $_.id })
    Assert-True ($wanted.Count -gt 0) ('No sample matched -Only ' +
        ($selected -join ','))
}

$runner = Join-Path $repoRoot 'tests\test-flow-webview.ps1'
$rows = @()
$failures = @()
$first = $true

foreach ($sample in $wanted) {
    $id = [string]$sample.id

    # The walk takes the machine clipboard and gives it back. Ten walks
    # in a row can meet the previous WebView still holding it, which
    # shows up as a copy that never completes. A short settle between
    # samples is cheaper than a retry, and it is a real wait on a real
    # shared resource, not a guess at timing.
    if (-not $first) { Start-Sleep -Milliseconds 1500 }
    $first = $false
    $bookPath = Join-Path $SamplesDir ([string]$sample.book)
    Assert-True ([IO.File]::Exists($bookPath)) ('Missing sample: ' + $bookPath)

    # The first key the sample declares. A sample that names none goes
    # through the "no constraint named" route, which is also a category.
    $key = '-'
    foreach ($candidate in @($sample.expectedKeys)) {
        if ([string]$candidate -ne '') { $key = [string]$candidate; break }
    }

    $light = Join-Path $shotDir ($id + '-light.png')
    $dark = Join-Path $shotDir ($id + '-dark.png')

    # A bare "-" reads as the start of a parameter name, so a sample that
    # names no constraint is run without the switch at all.
    if ($key -eq '-') {
        $output = & powershell.exe -NoProfile -ExecutionPolicy Bypass `
            -File $runner `
            -BookPath $bookPath `
            -LightScreenshotPath $light `
            -DarkScreenshotPath $dark 2>&1
    } else {
        $output = & powershell.exe -NoProfile -ExecutionPolicy Bypass `
            -File $runner `
            -BookPath $bookPath `
            -LightScreenshotPath $light `
            -DarkScreenshotPath $dark `
            -EnvironmentKey $key 2>&1
    }
    $code = $LASTEXITCODE
    $summary = ''
    foreach ($line in @($output)) {
        $text = [string]$line
        if ($text -match '^screens=') { $summary = $text }
    }

    if ($code -ne 0) {
        $failures += ($id + ': the real host could not complete the walk')
        $rows += ('  ' + $id + ' key=' + $key + ' FAIL')
        foreach ($line in @($output | Select-Object -Last 6)) {
            Write-Output ('    ' + [string]$line)
        }
        continue
    }
    Assert-True ($summary -ne '') `
        ($id + ': the walk reported no summary line.')
    Assert-True ([IO.File]::Exists($light)) `
        ($id + ': the walk produced no screenshot.')

    if (-not [string]::IsNullOrEmpty($EvidenceDir)) {
        [IO.File]::Copy($light,
            (Join-Path $EvidenceDir ($id + '-diagnose.png')), $true)
    }
    $rows += ('  ' + $id + ' key=' + $key + ' ' + $summary)
}

Assert-True ($failures.Count -eq 0) `
    ('Samples that did not complete the real walk: ' +
     ($failures -join '; '))

Write-Output 'test-guide-sample-flow: PASS'
Write-Output ('samples=' + $wanted.Count +
    ', each attached, diagnosed, categorised, repaired, rebuilt and ' +
    'read back through the real WebView2 host')
foreach ($row in $rows) { Write-Output $row }
