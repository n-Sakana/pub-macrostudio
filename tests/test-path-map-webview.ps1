param(
    [string]$BookPath,
    [string]$ProductRoot,
    [string]$LightScreenshotPath,
    [string]$DarkScreenshotPath
)

$ErrorActionPreference = 'Stop'

function Assert-True {
    param([bool]$Condition, [string]$Message)
    if (-not $Condition) { throw $Message }
}

function Assert-InsideDirectory {
    param([string]$Path, [string]$Directory)
    $fullPath = [IO.Path]::GetFullPath($Path)
    $fullDirectory = [IO.Path]::GetFullPath($Directory).TrimEnd(
        [IO.Path]::DirectorySeparatorChar,
        [IO.Path]::AltDirectorySeparatorChar)
    $prefix = $fullDirectory + [IO.Path]::DirectorySeparatorChar
    Assert-True $fullPath.StartsWith(
        $prefix,
        [StringComparison]::OrdinalIgnoreCase) `
        "Test path is outside the expected directory: $fullPath"
}

if ([string]::IsNullOrEmpty($BookPath)) {
    $BookPath = Join-Path $PSScriptRoot `
        '..\testdata\input_monthly_report.xlsm'
}
if ([string]::IsNullOrEmpty($ProductRoot)) {
    $ProductRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
}

$repoRoot = (Resolve-Path -LiteralPath $ProductRoot).Path
$testdataRoot = (Resolve-Path (
    Join-Path $PSScriptRoot '..\testdata')).Path
$resolvedBookPath = (Resolve-Path -LiteralPath $BookPath).Path
$libDir = Join-Path $repoRoot 'lib'
$cacheDir = Join-Path $testdataRoot (
    'path-map-cache-' + [Guid]::NewGuid().ToString('N'))
$preserveScreenshots =
    -not [string]::IsNullOrEmpty($LightScreenshotPath) -and
    -not [string]::IsNullOrEmpty($DarkScreenshotPath)
if ([string]::IsNullOrEmpty($LightScreenshotPath)) {
    $LightScreenshotPath = Join-Path $testdataRoot (
        'path-map-light-' + [Guid]::NewGuid().ToString('N') + '.png')
}
if ([string]::IsNullOrEmpty($DarkScreenshotPath)) {
    $DarkScreenshotPath = Join-Path $testdataRoot (
        'path-map-dark-' + [Guid]::NewGuid().ToString('N') + '.png')
}
$lightScreenshot = [IO.Path]::GetFullPath($LightScreenshotPath)
$darkScreenshot = [IO.Path]::GetFullPath($DarkScreenshotPath)
Assert-InsideDirectory $cacheDir $testdataRoot
Assert-InsideDirectory $lightScreenshot $testdataRoot
Assert-InsideDirectory $darkScreenshot $testdataRoot

Add-Type -AssemblyName PresentationFramework
Add-Type -AssemblyName PresentationCore
Add-Type -AssemblyName WindowsBase
Add-Type -AssemblyName System.Xaml
Add-Type -AssemblyName System.Web.Extensions
Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
$env:Path = $libDir + [IO.Path]::PathSeparator + $env:Path
$corePath = Join-Path $libDir 'Microsoft.Web.WebView2.Core.dll'
$wpfPath = Join-Path $libDir 'Microsoft.Web.WebView2.Wpf.dll'
[Reflection.Assembly]::LoadFrom($corePath) | Out-Null
[Reflection.Assembly]::LoadFrom($wpfPath) | Out-Null

$sourceFiles = Get-ChildItem -LiteralPath (
    Join-Path $repoRoot 'src') -Filter '*.cs' |
    Sort-Object -Property Name
$smokeFiles = @(
    (Join-Path $PSScriptRoot 'P10FlowSmoke.cs'),
    (Join-Path $PSScriptRoot 'PathMapSmoke.cs'))
$combined = (@($sourceFiles.FullName) + $smokeFiles |
    ForEach-Object {
        [IO.File]::ReadAllText($_, [Text.Encoding]::UTF8)
    }) -join "`n"
$usingPattern = '(?m)^\s*using\s+[\w][\w.]*\s*;'
$usings = [regex]::Matches($combined, $usingPattern) |
    ForEach-Object { $_.Value.Trim() } |
    Sort-Object -Unique
$body = $combined -replace $usingPattern, ''
$source = ($usings -join "`n") + "`n`n" + $body
$references = @(
    'System.Collections'
    [System.Windows.Window].Assembly.Location
    [System.Windows.UIElement].Assembly.Location
    [System.Windows.DependencyObject].Assembly.Location
    [System.Xaml.XamlReader].Assembly.Location
    'Microsoft.CSharp'
    'System.Drawing'
    'System.Web.Extensions'
    'System.IO.Compression'
    'System.IO.Compression.FileSystem'
    $corePath
    $wpfPath
)
Add-Type -TypeDefinition $source `
    -ReferencedAssemblies $references `
    -Language CSharp

$runFolder = ''
$sourceHash = (Get-FileHash -LiteralPath $resolvedBookPath `
    -Algorithm SHA256).Hash
try {
    try {
        $rawResult = [MacroStudio.Tests.PathMapSmoke]::Run(
            $repoRoot,
            $resolvedBookPath,
            $cacheDir,
            $lightScreenshot,
            $darkScreenshot)
    } catch {
        throw $_.Exception.ToString()
    }

    $result = $rawResult | ConvertFrom-Json
    $initial = $result.initial | ConvertFrom-Json
    $startShell = $result.startShell | ConvertFrom-Json
    $book = $result.book | ConvertFrom-Json
    $diagnoseRequest = $result.diagnoseRequest | ConvertFrom-Json
    $diagnosis = $result.diagnosis | ConvertFrom-Json
    $findings = $result.findings | ConvertFrom-Json
    $nextStep = $result.nextStep | ConvertFrom-Json
    $preset = $result.preset | ConvertFrom-Json
    $pathMapInitial = $result.pathMapInitial | ConvertFrom-Json
    $pathMapReady = $result.pathMapReady | ConvertFrom-Json
    $pathApplied = $result.pathApplied | ConvertFrom-Json
    $review = $result.review | ConvertFrom-Json
    $diff = $result.diff | ConvertFrom-Json
    $output = $result.output | ConvertFrom-Json
    $done = $result.done | ConvertFrom-Json
    $finalShell = $result.finalShell | ConvertFrom-Json
    $pathBuild = $result.pathBuildContract | ConvertFrom-Json
    $report = $result.report | ConvertFrom-Json
    $runFolder = [string]$result.runFolder
    $outputName = [string]$result.outputName

    foreach ($shell in @($startShell, $finalShell)) {
        Assert-True (-not $shell.documentScrollX) `
            'The product page scrolled horizontally at 1366x768.'
        Assert-True (-not $shell.documentScrollY) `
            'The product page scrolled vertically at 1366x768.'
        Assert-True $shell.footerVisible `
            'The fixed footer left the 1366x768 viewport.'
        Assert-True ($shell.buttons -eq 2 -and $shell.sameWidth) `
            'The footer must keep two same-width navigation buttons.'
        Assert-True ($shell.progressSlots -eq 4) `
            'The one entrance must keep four major progress columns.'
    }

    Assert-True (
        $initial.screen -eq 0 -and
        -not $initial.book -and
        $initial.visibleEntries -eq 0 -and
        $book.modules -gt 0 -and
        $book.nextReady
    ) 'The path route must begin at the single workbook entrance.'
    Assert-True (
        $diagnoseRequest.screen -eq 1 -and
        $diagnoseRequest.environment -eq 1 -and
        $diagnoseRequest.requestFile
    ) 'The path route must use the same factual first-AI diagnosis.'
    Assert-True ($result.diagnosisPromptReady) `
        'The diagnosis prompt must carry the request id and source file.'
    Assert-True (
        $diagnosis.screen -eq 1 -and
        $diagnosis.findings -eq 0 -and
        $diagnosis.recorded -and
        $diagnosis.nextReady
    ) 'A scoped zero-finding diagnosis must remain a valid fact result.'
    Assert-True (
        $findings.screen -eq 2 -and
        $findings.findingRows -eq 0 -and
        $findings.presetCards -eq 0 -and
        $findings.oldEntries -eq 0
    ) 'The diagnosis page must carry the facts and no template.'
    Assert-True (
        $nextStep.screen -eq 3 -and
        $nextStep.presetCards -eq 4 -and
        $preset.selected -eq 1 -and
        $preset.engine -cne 'AI' -and
        $preset.nextReady
    ) 'The fixed template must be selected on the choice page without restoring old entries.'

    Assert-True (
        $pathMapInitial.screen -eq 4 -and
        $pathMapInitial.rows -ge 1 -and
        $pathMapInitial.occurrences -ge 1 -and
        $pathMapInitial.allUnapplied -and
        $pathMapInitial.includeChecks -ge 1 -and
        -not $pathMapInitial.nextReady
    ) 'Every detected mapping row must begin unapplied and explicit.'
    Assert-True (
        $pathMapReady.applied -eq 1 -and
        $pathMapReady.target -ceq 'mapped/' -and
        $pathMapReady.valid -and
        $pathMapReady.nextReady
    ) 'A UI-entered, class-safe mapping must enable deterministic apply.'
    Assert-True (
        $pathApplied.screen -eq 6 -and
        $pathApplied.mappingRows -eq 1 -and
        $null -eq $pathApplied.repairRequest -and
        $pathApplied.changed -ge 1
    ) 'Fixed replacement must jump directly to review without AI repair.'
    Assert-True (
        $review.screen -eq 6 -and
        $review.accepted -ge 1 -and
        $review.nextReady -and
        $review.closed -ceq 'true' -and
        $diff.markers -gt 0 -and
        $diff.rows -gt 0 -and
        $diff.twoColumn -eq 0
    ) 'The deterministic result must use the production inline diff.'

    $expectedArtifacts = @(
        'diagnose-request.md',
        'source-code.md',
        'diagnosis.md',
        $outputName,
        [IO.Path]::GetFileName([string]$done.diffPath),
        'result.md')
    Assert-True (
        $output.screen -eq 7 -and
        $output.nextReady -and
        @($output.files).Count -eq 6 -and
        -not (@($output.files) -contains 'repair-request.md')
    ) 'The deterministic artifact contract must contain six files.'
    foreach ($name in $expectedArtifacts) {
        Assert-True (@($output.files) -contains $name) `
            "The output contract is missing: $name"
    }

    Assert-True (-not [string]::IsNullOrEmpty($runFolder)) `
        'The first request did not create a run folder.'
    Assert-InsideDirectory $runFolder (Join-Path $repoRoot 'exports')
    Assert-True (
        $done.screen -eq 9 -and
        $done.status -ceq 'success' -and
        $done.openButtons -eq 1 -and
        @($done.rows).Count -eq 6
    ) 'The path build must finish with the six-file result contract.'
    foreach ($name in $expectedArtifacts) {
        Assert-True (@($done.rows) -contains $name) `
            "The done screen is missing: $name"
        Assert-True ([IO.File]::Exists((Join-Path $runFolder $name))) `
            "The run folder is missing: $name"
    }
    Assert-InsideDirectory ([string]$done.outputPath) $runFolder
    Assert-InsideDirectory ([string]$done.diffPath) $runFolder
    Assert-InsideDirectory ([string]$done.resultPath) $runFolder
    Assert-True (
        $pathBuild.mappingRows -eq 1 -and
        $pathBuild.targetMapped -and
        $pathBuild.count -eq $pathBuild.locations -and
        -not $pathBuild.repairRequestCreated -and
        -not $pathBuild.repairRequestFile -and
        -not $pathBuild.engineIsAi
    ) 'The built state must retain one exact mapping and no repair request.'

    # "## 置換の対応表". The heading names the mechanism, not a subject:
    # what is being replaced is the template's business, not the app's.
    $resultText = [IO.File]::ReadAllText([string]$done.resultPath)
    Assert-True ($resultText.Contains('## ' +
        ([char]0x7F6E) + ([char]0x63DB)) -and
        $resultText.Contains('mapped/')) `
        'result.md must include the reviewed replacement table.'
    Assert-True (-not $resultText.Contains('repair-request.md')) `
        'A deterministic run must not advertise a second-AI artifact.'

    $rebuilt = [MacroStudio.BookIO]::ReadProject(
        [string]$done.outputPath)
    $mappedOccurrences = 0
    foreach ($module in @($rebuilt.Modules)) {
        $offset = 0
        while (($offset = $module.Code.IndexOf(
            'mapped/',
            $offset,
            [StringComparison]::Ordinal)) -ge 0) {
            $mappedOccurrences += 1
            $offset += 'mapped/'.Length
        }
    }
    Assert-True ($mappedOccurrences -eq $pathBuild.count) `
        'Read-back did not preserve exactly the reviewed replacements.'
    Assert-True (
        $report.modules -ge 1 -and
        $report.markers -gt 0 -and
        $report.editable -eq 0 -and
        $report.external -eq 0
    ) 'The self-contained diff report must remain read-only.'

    foreach ($path in @($lightScreenshot, $darkScreenshot)) {
        Assert-True ([IO.File]::Exists($path)) `
            "Path-map screenshot was not created: $path"
        $signature = New-Object byte[] 4
        $stream = [IO.File]::OpenRead($path)
        try { [void]$stream.Read($signature, 0, 4) }
        finally { $stream.Dispose() }
        Assert-True (
            $signature[0] -eq 0x89 -and $signature[1] -eq 0x50
        ) "Path-map screenshot is not a PNG: $path"
    }
    $afterHash = (Get-FileHash -LiteralPath $resolvedBookPath `
        -Algorithm SHA256).Hash
    Assert-True ($afterHash -ceq $sourceHash) `
        'The path-map route modified the source workbook.'
    Assert-True ($result.clipboardRetries -ge 0) `
        'Clipboard retry count was not reported.'

    Write-Output 'test-path-map-webview: PASS'
    Write-Output (
        'screens=0-9, mappings=1, replacements=' +
        $pathBuild.count + ', artifacts=6, source=unchanged, ' +
        'readback=verified, clipboardRetries=' +
        $result.clipboardRetries)
} finally {
    if (-not [string]::IsNullOrEmpty($runFolder) -and
        [IO.Directory]::Exists($runFolder)) {
        Assert-InsideDirectory $runFolder (Join-Path $repoRoot 'exports')
        [IO.Directory]::Delete($runFolder, $true)
        $macroRoot = [IO.Path]::GetDirectoryName($runFolder)
        if ([IO.Directory]::Exists($macroRoot) -and
            @([IO.Directory]::GetFileSystemEntries(
                $macroRoot)).Count -eq 0) {
            [IO.Directory]::Delete($macroRoot)
        }
    }
    if (-not $preserveScreenshots) {
        foreach ($path in @($lightScreenshot, $darkScreenshot)) {
            if ([IO.File]::Exists($path)) {
                Assert-InsideDirectory $path $testdataRoot
                [IO.File]::Delete($path)
            }
        }
    }
    [GC]::Collect()
    [GC]::WaitForPendingFinalizers()
    [GC]::Collect()
    for ($attempt = 0; $attempt -lt 50; $attempt++) {
        if (-not [IO.Directory]::Exists($cacheDir)) { break }
        try {
            Assert-InsideDirectory $cacheDir $testdataRoot
            [IO.Directory]::Delete($cacheDir, $true)
        } catch {
            Start-Sleep -Milliseconds 100
        }
    }
}
