param(
    [string]$BookPath,
    [string]$ProductRoot
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
    $BookPath = Join-Path $PSScriptRoot '..\testdata\guide-samples\S01_fixed_drive.xlsm'
}
if ([string]::IsNullOrEmpty($ProductRoot)) {
    $ProductRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
}

$repoRoot = (Resolve-Path -LiteralPath $ProductRoot).Path
$testdataRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\testdata')).Path
$resolvedBookPath = (Resolve-Path -LiteralPath $BookPath).Path
$libDir = Join-Path $repoRoot 'lib'
$cacheDir = Join-Path $testdataRoot (
    'both-route-cache-' + [Guid]::NewGuid().ToString('N'))
Assert-InsideDirectory $cacheDir $testdataRoot

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
$smokeSources = @((Join-Path $PSScriptRoot 'BothRouteSmoke.cs'))
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

$sourceHash = (Get-FileHash -LiteralPath $resolvedBookPath -Algorithm SHA256).Hash
try {
    try {
        $rawResult = [MacroStudio.Tests.BothRouteSmoke]::Run(
            $repoRoot,
            $resolvedBookPath,
            $cacheDir)
    } catch {
        throw $_.Exception.ToString()
    }

    $result = $rawResult | ConvertFrom-Json
    $shared = $result.sharedHeading | ConvertFrom-Json
    $chosen = $result.chosen | ConvertFrom-Json
    $tableFirst = $result.tableFirst | ConvertFrom-Json
    $replaced = $result.replaced | ConvertFrom-Json
    $request = $result.request | ConvertFrom-Json
    $review = $result.review | ConvertFrom-Json
    $done = $result.done | ConvertFrom-Json

    # The walk runs under the shipped default, not under a scope the
    # test picked to make itself pass.
    Assert-True (($result.scope | ConvertFrom-Json) -ceq 'forbidden') (
        'The both route must go through under the default change scope.')

    # ---- one heading, two operations, still two files ----
    Assert-True (
        $shared.headings -ge 2 -and
        $shared.sharedHeadings -ge 1 -and
        $shared.allFilesDistinct) (
        'At least one heading must hold more than one operation, and ' +
        'every operation must stay its own file: ' + $result.sharedHeading)

    # ---- both operations chosen as one case ----
    Assert-True (
        $chosen.count -eq 2 -and
        ($chosen.engine -ceq 'AI') -and
        $chosen.hasReplacementStage) (
        'The table operation and a chat operation must be choosable ' +
        'together: ' + $result.chosen)

    # ---- the replacement runs first, and nothing is applied yet ----
    Assert-True (
        $tableFirst.rows -ge 1 -and
        $tableFirst.allUnapplied -and
        $tableFirst.replacementPending -and
        -not $tableFirst.nextReady) (
        'The replacement must come first, start unapplied and wait: ' +
        $result.tableFirst)
    Assert-True (
        $replaced.modulesReplaced -ge 1 -and
        $replaced.codeChanged -and
        $replaced.findingChecks -ge 1) (
        'Carrying out the replacement must stay on the same screen and ' +
        'then ask what the chat should repair: ' + $result.replaced)

    # ---- one request, both operations, each under its own name ----
    Assert-True (
        $request.chosen -eq 2 -and
        $request.speaking -ge 1 -and
        $request.instructionsInRequest -eq $request.speaking -and
        $request.changeScope -and
        $request.replacedNote -and
        $request.keepsNewValue -and
        $request.aiFileReplaced) (
        'One request must carry every speaking operation in its own ' +
        'words, the change scope, and the contract not to undo the ' +
        'replacement: ' + $result.request)

    # ---- the diff is original -> final ----
    Assert-True (
        $review.changed -ge 1 -and
        $review.carriesReplacement -and
        $review.carriesChatChange -and
        $review.sourceStillOriginal) (
        'The diff must carry what the table did and what the chat did, ' +
        'with the workbook as it was read left alone: ' + $result.review)

    # ---- and it builds ----
    Assert-True (
        $done.success -and
        -not [string]::IsNullOrEmpty([string]$done.outputPath)) (
        'The run must reach a verified rebuilt workbook: ' + $result.done)
    $finalHash = (Get-FileHash -LiteralPath $resolvedBookPath `
        -Algorithm SHA256).Hash
    Assert-True ($finalHash -ceq $sourceHash) `
        'The source workbook was modified.'

    Write-Output 'test-both-route-webview: PASS'
    Write-Output (
        'path replacement + Win32 repair as one case: replacement first, ' +
        'one request carrying every speaking operation in its own words ' +
        'under the default change scope, diff original->final, verified ' +
        'rebuild, source unchanged')
} finally {
    # The WebView2 runtime holds its user-data folder until it has
    # finished shutting down, so this waits rather than failing the run
    # over a lockfile.
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
