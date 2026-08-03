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
    $BookPath = Join-Path $PSScriptRoot '..\testdata\test_large.xlsm'
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
    'diagnose-cache-' + [Guid]::NewGuid().ToString('N'))
$preserveScreenshots =
    -not [string]::IsNullOrEmpty($LightScreenshotPath) -and
    -not [string]::IsNullOrEmpty($DarkScreenshotPath)

if ([string]::IsNullOrEmpty($LightScreenshotPath)) {
    $LightScreenshotPath = Join-Path $testdataRoot (
        'diagnose-light-' + [Guid]::NewGuid().ToString('N') + '.png')
}
if ([string]::IsNullOrEmpty($DarkScreenshotPath)) {
    $DarkScreenshotPath = Join-Path $testdataRoot (
        'diagnose-dark-' + [Guid]::NewGuid().ToString('N') + '.png')
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
    (Join-Path $PSScriptRoot 'DiagnoseFlowSmoke.cs'))
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
        $rawResult = [MacroStudio.Tests.DiagnoseFlowSmoke]::Run(
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
    $preset = $result.preset | ConvertFrom-Json
    $repairInputEmpty = $result.repairInputEmpty | ConvertFrom-Json
    $repairInput = $result.repairInput | ConvertFrom-Json
    $nextStep = $result.nextStep | ConvertFrom-Json
    $repairRequest = $result.repairRequest | ConvertFrom-Json
    $repairShell = $result.repairShell | ConvertFrom-Json
    $runFolder = [string]$result.runFolder
    $diagnosisId = [string]$result.diagnosisId
    $repairId = [string]$result.repairId

    foreach ($shell in @($startShell, $repairShell)) {
        Assert-True (-not $shell.documentScrollX) `
            'The product page scrolled horizontally at 1366x768.'
        Assert-True (-not $shell.documentScrollY) `
            'The product page scrolled vertically at 1366x768.'
        Assert-True $shell.footerVisible `
            'The fixed footer left the 1366x768 viewport.'
        Assert-True ($shell.buttons -eq 2 -and $shell.sameWidth) `
            'The footer must keep two same-width navigation buttons.'
        Assert-True ($shell.progressSlots -eq 4) `
            'Every entrance must keep four major progress columns.'
    }

    Assert-True (
        $initial.screen -eq 0 -and
        -not $initial.book -and
        -not $initial.nextReady -and
        $initial.visibleEntries -eq 0
    ) 'The product must open on the choice of work.'
    Assert-True (
        $book.screen -eq 1 -and
        $book.modules -gt 0 -and
        $book.nextReady -and
        $book.readDisclosure -eq 1
    ) 'Attaching a workbook must stay on the workbook screen and expose only observed read facts.'
    Assert-True (
        $diagnoseRequest.screen -eq 2 -and
        $diagnoseRequest.environment -eq 1 -and
        $diagnoseRequest.copy -eq 1 -and
        $diagnoseRequest.open -eq 1 -and
        $diagnoseRequest.requestFile -and
        -not $diagnoseRequest.nextReady
    ) 'Screen 1 must show the real environment and first-AI handoff.'
    Assert-True ($result.diagnosisPromptReady) `
        'The first prompt must carry its id and source-code.md.'
    Assert-True (
        $diagnosis.screen -eq 2 -and
        $diagnosis.findings -eq 1 -and
        $diagnosis.version -eq 1 -and
        $diagnosis.recorded -and
        $diagnosis.nextReady
    ) 'The product parser must accept and record a factual diagnosis.'
    Assert-True (
        $findings.screen -eq 3 -and
        $findings.findingRows -eq 1 -and
        $findings.occurrenceRows -eq 1 -and
        $findings.presetCards -eq 0 -and
        $findings.oldEntries -eq 0 -and
        $findings.nextReady
    ) 'The diagnosis page must show the facts and no template at all.'
    Assert-True (
        $nextStep.screen -eq 4 -and
        $nextStep.presetCards -eq 5 -and
        ([string]$nextStep.firstCard).Contains('01_Win32') -and
        -not $nextStep.nextReady
    ) 'The choice page must offer the templates in the fixed order.'
    Assert-True (
        $preset.selected -eq 1 -and
        $preset.engine -ceq 'AI' -and
        $preset.nextReady
    ) 'A visible repair template must select the AI dispatch.'
    Assert-True (
        $repairInputEmpty.screen -eq 5 -and
        $repairInputEmpty.findingChecks -eq 1 -and
        $repairInputEmpty.preselected -eq 1 -and
        $repairInputEmpty.removedForms -eq 0 -and
        $repairInput.selected -eq 1 -and
        $repairInput.nextReady
    ) 'The second request must carry the mandatory finding and ask nothing further about it.'
    Assert-True ($result.idsDistinct) `
        'Diagnosis and repair must have distinct request identities.'
    Assert-True (
        $diagnosisId -match '^[0-9a-f-]{36}$' -and
        $repairId -match '^[0-9a-f-]{36}$' -and
        $repairRequest.screen -eq 6 -and
        $repairRequest.copy -eq 1 -and
        $repairRequest.requestFile -and
        -not $repairRequest.nextReady
    ) 'Screen 5 must expose a distinct second-AI request.'
    Assert-True ($result.repairPromptReady) `
        'The second prompt must carry the accepted diagnosis fact.'

    Assert-True (-not [string]::IsNullOrEmpty($runFolder)) `
        'The first request did not create a run folder.'
    Assert-InsideDirectory $runFolder (Join-Path $repoRoot 'exports')
    # run-manifest.json is the run's own record of what it has confirmed.
    # The screen, the log, result.md and a resumed session all read it.
    $expectedArtifacts = @(
        'diagnose-request.md',
        'source-code.md',
        'diagnosis.md',
        'repair-request.md',
        'run-manifest.json')
    foreach ($name in $expectedArtifacts) {
        Assert-True ([IO.File]::Exists((Join-Path $runFolder $name))) `
            "The diagnosis flow is missing: $name"
    }
    Assert-True (
        @([IO.Directory]::GetFiles($runFolder)).Count -eq 5
    ) 'The diagnosis handoff must create exactly five artifacts.'

    $manifest = [IO.File]::ReadAllText(
        (Join-Path $runFolder 'run-manifest.json'),
        (New-Object Text.UTF8Encoding($false, $true))) | ConvertFrom-Json
    Assert-True (
        $manifest.schemaVersion -eq 1 -and
        $manifest.runFolder -ceq $runFolder -and
        ([string]$manifest.repair.requestId) -ceq $repairId -and
        $null -ne $manifest.diagnosis.accepted
    ) 'The run record must name this run and both stage identities.'

    foreach ($path in @($lightScreenshot, $darkScreenshot)) {
        Assert-True ([IO.File]::Exists($path)) `
            "Diagnosis screenshot was not created: $path"
        $signature = New-Object byte[] 4
        $stream = [IO.File]::OpenRead($path)
        try { [void]$stream.Read($signature, 0, 4) }
        finally { $stream.Dispose() }
        Assert-True (
            $signature[0] -eq 0x89 -and $signature[1] -eq 0x50
        ) "Diagnosis screenshot is not a PNG: $path"
    }

    $afterHash = (Get-FileHash -LiteralPath $resolvedBookPath `
        -Algorithm SHA256).Hash
    Assert-True ($afterHash -ceq $sourceHash) `
        'The diagnosis flow modified the source workbook.'
    Assert-True ($result.clipboardRetries -ge 0) `
        'Clipboard retry count was not reported.'

    Write-Output 'test-diagnose-webview: PASS'
    Write-Output (
        'screens=0-5, diagnosis=1, selected=1, artifacts=5, ' +
        'source=unchanged, clipboardRetries=' +
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
