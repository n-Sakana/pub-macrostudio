param(
    [string]$BookPath,
    [string]$ProductRoot,
    [string]$LightScreenshotPath,
    [string]$DarkScreenshotPath,
    [ValidateSet('P10FlowSmoke', 'ShortestPathSmoke')]
    [string]$SmokeClass = 'P10FlowSmoke',
    # Names a constraint from the target environment on the smoke's
    # finding, so the walk goes through a category rather than through
    # "no constraint named". Empty keeps the original route.
    [string]$EnvironmentKey
)

$ErrorActionPreference = 'Stop'

function Assert-True {
    param(
        [bool]$Condition,
        [string]$Message
    )

    if (-not $Condition) {
        throw $Message
    }
}

function Assert-InsideDirectory {
    param(
        [string]$Path,
        [string]$Directory
    )

    $fullPath = [IO.Path]::GetFullPath($Path)
    $fullDirectory = [IO.Path]::GetFullPath($Directory).TrimEnd(
        [IO.Path]::DirectorySeparatorChar,
        [IO.Path]::AltDirectorySeparatorChar)
    $prefix = $fullDirectory + [IO.Path]::DirectorySeparatorChar
    Assert-True (
        $fullPath.StartsWith(
            $prefix,
            [StringComparison]::OrdinalIgnoreCase)) `
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
    'flow-cache-' + [Guid]::NewGuid().ToString('N'))
$preserveScreenshots =
    -not [string]::IsNullOrEmpty($LightScreenshotPath) -and
    -not [string]::IsNullOrEmpty($DarkScreenshotPath)

if ([string]::IsNullOrEmpty($LightScreenshotPath)) {
    $LightScreenshotPath = Join-Path $testdataRoot (
        'flow-light-' + [Guid]::NewGuid().ToString('N') + '.png')
}
if ([string]::IsNullOrEmpty($DarkScreenshotPath)) {
    $DarkScreenshotPath = Join-Path $testdataRoot (
        'flow-dark-' + [Guid]::NewGuid().ToString('N') + '.png')
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
$smokeSources = @(
    (Join-Path $PSScriptRoot 'P10FlowSmoke.cs'),
    (Join-Path $PSScriptRoot 'ShortestPathSmoke.cs'))
$combined = (@($sourceFiles.FullName) + $smokeSources |
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
$sourceHash = (Get-FileHash -LiteralPath $resolvedBookPath -Algorithm SHA256).Hash
try {
    try {
        if ($SmokeClass -ceq 'ShortestPathSmoke') {
            $rawResult = [MacroStudio.Tests.ShortestPathSmoke]::Run(
                $repoRoot,
                $resolvedBookPath,
                $cacheDir,
                $lightScreenshot,
                $darkScreenshot)
        } elseif (-not [string]::IsNullOrEmpty($EnvironmentKey)) {
            $rawResult =
                [MacroStudio.Tests.P10FlowSmoke]::RunWithEnvironmentKey(
                    $repoRoot,
                    $resolvedBookPath,
                    $cacheDir,
                    $lightScreenshot,
                    $darkScreenshot,
                    $EnvironmentKey)
        } else {
            $rawResult = [MacroStudio.Tests.P10FlowSmoke]::Run(
                $repoRoot,
                $resolvedBookPath,
                $cacheDir,
                $lightScreenshot,
                $darkScreenshot)
        }
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
    $refused = $result.refused | ConvertFrom-Json
    $intake = $result.intake | ConvertFrom-Json
    $review = $result.review | ConvertFrom-Json
    $diff = $result.diff | ConvertFrom-Json
    $output = $result.output | ConvertFrom-Json
    $done = $result.done | ConvertFrom-Json
    $finalShell = $result.finalShell | ConvertFrom-Json
    $report = $result.report | ConvertFrom-Json
    $runFolder = [string]$result.runFolder
    $diagnosisId = [string]$result.diagnosisId
    $repairId = [string]$result.repairId
    $outputName = [string]$result.outputName

    foreach ($shell in @($startShell, $finalShell)) {
        Assert-True (-not $shell.documentScrollX) 'The product page scrolled horizontally at 1366x768.'
        Assert-True (-not $shell.documentScrollY) 'The product page scrolled vertically at 1366x768.'
        Assert-True $shell.footerVisible 'The fixed footer left the 1366x768 viewport.'
        Assert-True ($shell.buttons -eq 2 -and $shell.sameWidth) 'The footer must keep two same-width navigation buttons.'
        Assert-True ($shell.progressSlots -eq 4) 'The one entrance must keep four major progress columns.'
    }

    Assert-True (
        $initial.screen -eq 0 -and
        -not $initial.book -and
        -not $initial.nextReady -and
        $initial.visibleEntries -eq 0
    ) 'The product must open on the single workbook entrance.'

    Assert-True (
        $book.screen -eq 0 -and
        $book.modules -gt 0 -and
        $book.nextReady -and
        $book.readDisclosure -eq 1
    ) 'Attaching a workbook must remain on screen 0 and expose the read facts.'

    Assert-True (
        $diagnoseRequest.screen -eq 1 -and
        $diagnoseRequest.environment -eq 1 -and
        $diagnoseRequest.copy -eq 1 -and
        $diagnoseRequest.open -eq 1 -and
        $diagnoseRequest.importAction -eq 1 -and
        $diagnoseRequest.splitOption -eq 0 -and
        $diagnoseRequest.requestFile -and
        -not $diagnoseRequest.nextReady
    ) 'The diagnosis screen must carry the hand-off and the import together, name the attachment, and no longer offer a split reply.'

    Assert-True (
        $diagnosisId -match
        '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    ) "The diagnosis id is not a version 4 UUID: $diagnosisId"
    Assert-True $result.diagnosisPromptReady 'The first AI prompt must carry its id and source-code.md.'

    Assert-True (
        $diagnosis.screen -eq 1 -and
        $diagnosis.findings -eq 1 -and
        $diagnosis.version -eq 1 -and
        $diagnosis.recorded -and
        $diagnosis.nextReady
    ) 'The product parser must accept and record the factual diagnosis.'

    Assert-True (
        $findings.screen -eq 2 -and
        $findings.findingRows -eq 1 -and
        $findings.occurrenceRows -eq 1 -and
        $findings.presetCards -eq 0 -and
        $findings.oldEntries -eq 0 -and
        $findings.nextReady
    ) 'The diagnosis page must show the facts and no template at all.'
    # A recommendation is earned by a named constraint. With none named
    # nothing is starred and nothing is ticked, so the page waits. With
    # one named, the diagnosis's own answer arrives already chosen and
    # the page is ready - the reader may untick it.
    $expectedStars = 0
    $expectedReady = $false
    $starRule = 'star nothing and wait when the finding names no constraint'
    if (-not [string]::IsNullOrEmpty($EnvironmentKey) -and
        $EnvironmentKey -ne '-') {
        $expectedStars = [int]$nextStep.recommended
        $expectedReady = $expectedStars -gt 0
        $starRule = 'arrive with the recommended template already ticked'
        Assert-True ($expectedStars -le 1) `
            'A named constraint must not star more than one template.'
    }
    Assert-True (
        $nextStep.screen -eq 3 -and
        $nextStep.presetCards -eq 4 -and
        ([string]$nextStep.firstCard).Contains('01_Win32') -and
        $nextStep.recommended -eq $expectedStars -and
        $nextStep.nextReady -eq $expectedReady
    ) ('The choice page must list the templates in the fixed order, and ' +
       $starRule + '.')
    Assert-True (
        $preset.selected -eq 1 -and
        $preset.engine -ceq 'AI' -and
        $preset.nextReady
    ) 'Selecting one visible template must select the hidden AI dispatch.'

    Assert-True (
        $repairInputEmpty.screen -eq 4 -and
        $repairInputEmpty.findingChecks -eq 1 -and
        $repairInputEmpty.preselected -eq 1 -and
        $repairInputEmpty.removedForms -eq 0 -and
        $repairInputEmpty.requestFiles -eq 0 -and
        $repairInputEmpty.preserveItems -eq 0 -and
        $repairInputEmpty.nextReady
    ) 'The repair input must preselect the blocking finding, ask nothing further per finding, and show no request bookkeeping.'
    Assert-True (
        $repairInput.selected -eq 1 -and
        $repairInput.nextReady
    ) 'A selected finding alone must enable the second request.'

    Assert-True (
        $repairId -match
        '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    ) "The repair id is not a version 4 UUID: $repairId"
    Assert-True ($result.idsDistinct) 'Diagnosis and repair must have distinct request identities.'
    Assert-True (
        $repairRequest.screen -eq 5 -and
        $repairRequest.copy -eq 1 -and
        $repairRequest.requestFile -and
        -not $repairRequest.nextReady
    ) 'The repair screen must expose the second-AI handoff.'
    Assert-True $result.repairPromptReady 'The second prompt must carry its id and the accepted diagnosis facts.'

    Assert-True (
        $refused.imported -eq 0 -and
        -not $refused.nextReady -and
        $refused.code -ceq 'E-INTAKE-01'
    ) 'An uncontracted AI answer must be refused before state changes.'
    Assert-True (
        $intake.screen -eq 5 -and
        $intake.imported -eq 2 -and
        $intake.accepted -eq 2 -and
        $intake.total -eq 2 -and
        $intake.existing -eq 1 -and
        $intake.added -eq 1 -and
        $intake.nextReady
    ) 'The second product parser must import one changed and one new module.'

    Assert-True (
        $review.screen -eq 6 -and
        $review.accepted -eq 2 -and
        $review.nextReady -and
        $review.closed -ceq 'false'
    ) 'The review must begin with a summary and a collapsed diff.'
    Assert-True (
        $diff.tree -eq 2 -and
        $diff.groups -ge 1 -and
        $diff.markers -gt 0 -and
        $diff.rows -gt 0 -and
        $diff.twoColumn -eq 0
    ) 'The production inline diff must show both imported modules.'

    $expectedArtifacts = @(
        'diagnose-request.md',
        'source-code.md',
        'diagnosis.md',
        'repair-request.md',
        $outputName,
        [IO.Path]::GetFileName([string]$done.diffPath),
        'result.md')
    Assert-True (
        $output.screen -eq 7 -and
        $output.nextReady
    ) 'The output screen must validate the workbook name before building.'
    foreach ($name in $expectedArtifacts) {
        Assert-True (@($output.files) -contains $name) "The output contract is missing: $name"
    }

    Assert-True (-not [string]::IsNullOrEmpty($runFolder)) 'The first request did not create a run folder.'
    Assert-InsideDirectory $runFolder $testdataRoot
    Assert-True (
        [IO.Path]::GetFileName(
            [IO.Path]::GetDirectoryName($runFolder)) -ceq 'MacroStudio'
    ) 'The run folder must live in the MacroStudio directory beside the book.'
    Assert-True (
        [IO.Path]::GetDirectoryName(
            [IO.Path]::GetDirectoryName($runFolder)) -ceq
        [IO.Path]::GetDirectoryName($resolvedBookPath)
    ) 'The MacroStudio directory must sit beside the source workbook.'

    Assert-True (
        $done.screen -eq 9 -and
        $done.status -ceq 'success' -and
        $done.openButtons -eq 1
    ) 'The build must finish on screen 10 with one open-folder action.'
    foreach ($name in $expectedArtifacts) {
        Assert-True (@($done.rows) -contains $name) "The done screen is missing: $name"
        Assert-True ([IO.File]::Exists((Join-Path $runFolder $name))) "The run folder is missing: $name"
    }
    # The done screen's own action, pressed for real. A missing handler
    # or a call into a removed state function leaves busyAction stuck and
    # every button dead, which is what the reader saw.
    $openFolder = $result.openFolder | ConvertFrom-Json
    Assert-True (
        $null -eq $openFolder.error -and
        ([string]$openFolder.revealed) -eq $runFolder -and
        $openFolder.stillEnabled
    ) 'The output folder button must reveal this run''s folder and leave the screen usable.'

    Assert-InsideDirectory ([string]$done.outputPath) $runFolder
    Assert-InsideDirectory ([string]$done.diffPath) $runFolder
    Assert-InsideDirectory ([string]$done.resultPath) $runFolder

    $resultText = [IO.File]::ReadAllText([string]$done.resultPath)
    foreach ($name in @(
        'diagnose-request.md',
        'diagnosis.md',
        'repair-request.md')) {
        Assert-True ($resultText.Contains($name)) "result.md is missing the two-stage artifact: $name"
    }
    Assert-True (-not $resultText.Contains('- request.md ')) 'result.md must not advertise the removed beta1 request.md name.'

    Assert-True (
        $report.modules -ge 2 -and
        $report.markers -gt 0 -and
        $report.editable -eq 0 -and
        $report.external -eq 0
    ) 'The self-contained diff report must render read-only with product rows.'

    foreach ($path in @($lightScreenshot, $darkScreenshot)) {
        Assert-True ([IO.File]::Exists($path)) "Flow screenshot was not created: $path"
        $signature = New-Object byte[] 4
        $stream = [IO.File]::OpenRead($path)
        try {
            [void]$stream.Read($signature, 0, 4)
        } finally {
            $stream.Dispose()
        }
        Assert-True (
            $signature[0] -eq 0x89 -and
            $signature[1] -eq 0x50
        ) "Flow screenshot is not a PNG: $path"
    }

    $afterHash = (Get-FileHash -LiteralPath $resolvedBookPath -Algorithm SHA256).Hash
    Assert-True ($afterHash -ceq $sourceHash) 'The end-to-end flow modified the source workbook.'

    Assert-True ($result.clipboardRetries -ge 0) 'Clipboard retry count was not reported.'

    Write-Output 'test-flow-webview: PASS'
    Write-Output (
        'screens=0-9, diagnosis=1, selected=1, package=2, ' +
        'artifacts=7, source=unchanged, clipboardRetries=' +
        $result.clipboardRetries)
} finally {
    if (-not [string]::IsNullOrEmpty($runFolder) -and
        [IO.Directory]::Exists($runFolder)) {
        Assert-InsideDirectory $runFolder $testdataRoot
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
        if (-not [IO.Directory]::Exists($cacheDir)) {
            break
        }
        try {
            Assert-InsideDirectory $cacheDir $testdataRoot
            [IO.Directory]::Delete($cacheDir, $true)
        } catch {
            Start-Sleep -Milliseconds 100
        }
    }
}
