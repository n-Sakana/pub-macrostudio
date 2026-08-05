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
    $BookPath = Join-Path $PSScriptRoot '..\testdata\test_large.xlsm'
}
if ([string]::IsNullOrEmpty($ProductRoot)) {
    $ProductRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
}

$repoRoot = (Resolve-Path -LiteralPath $ProductRoot).Path
$testdataRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\testdata')).Path
$resolvedBookPath = (Resolve-Path -LiteralPath $BookPath).Path
$libDir = Join-Path $repoRoot 'lib'
$cacheDir = Join-Path $testdataRoot (
    'change-scope-cache-' + [Guid]::NewGuid().ToString('N'))
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
$smokeSources = @((Join-Path $PSScriptRoot 'ChangeScopeSmoke.cs'))
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

try {
    try {
        $rawResult = [MacroStudio.Tests.ChangeScopeSmoke]::Run(
            $repoRoot,
            $resolvedBookPath,
            $cacheDir)
    } catch {
        throw $_.Exception.ToString()
    }

    $result = $rawResult | ConvertFrom-Json
    $start = $result.start | ConvertFrom-Json
    $categories = $result.categories | ConvertFrom-Json
    $scopeScreen = $result.scopeScreen | ConvertFrom-Json
    $strictRequest = $result.strictRequest | ConvertFrom-Json
    $refused = $result.refused | ConvertFrom-Json
    $accepted = $result.accepted | ConvertFrom-Json

    # ---- one road in ----
    Assert-True (
        $start.isBook -and
        $start.entranceCards -eq 0 -and
        $start.screens -eq 10) (
        'The window must open on the workbook, with no entrance to get ' +
        'past: ' + $result.start)
    # The default is in force before anyone has chosen anything, and it
    # is the one that forbids structural change.
    Assert-True (
        ($start.structure -ceq 'forbidden') -and
        -not [string]::IsNullOrEmpty([string]$start.scope)) (
        'The default change scope must be applied and named: ' +
        $result.start)

    # ---- the operations, grouped ----
    # The headings are the declared ones, in the declared order. At least
    # one holds more than one operation - that is the whole point of the
    # grouping - and those are still separate cards with separate files
    # behind them, so nothing was merged to make the screen shorter.
    Assert-True (
        (($categories.headings -join '|') -ceq
            ($categories.declared -join '|')) -and
        $categories.headings.Count -ge 2) (
        'The headings must be the declared ones in order: ' +
        $result.categories)
    Assert-True (
        @($categories.sizes | Where-Object { $_ -ge 2 }).Count -ge 1) (
        'At least one heading must hold more than one operation: ' +
        $result.categories)
    $allFiles = @($categories.files | ForEach-Object { $_ })
    Assert-True (
        (@($allFiles | Sort-Object -Unique).Count -eq
            @($allFiles).Count)) (
        'Two operations under one heading must stay two files: ' +
        $result.categories)

    # ---- one setting, one control, two named states ----
    # It used to be a card for the default and a 詳細オプション row for the
    # other answer: the same yes/no twice, and the reader had to open the
    # second to learn what the first refused.
    Assert-True (
        $scopeScreen.switches -eq 1 -and
        $scopeScreen.options -eq 2 -and
        $scopeScreen.radios -and
        $scopeScreen.checked -eq 1 -and
        -not $scopeScreen.detail) (
        'How far the code may change must be one control with exactly ' +
        'two states and no duplicate detail row: ' + $result.scopeScreen)
    # Which one is in force has to be legible without seeing the colour.
    Assert-True ($scopeScreen.statedInWords) (
        'The state in force must say so in words, not only by ' +
        'highlighting: ' + $result.scopeScreen)
    Assert-True (
        $scopeScreen.checks -eq 4 -and
        $scopeScreen.limit) (
        'The screen must list what is checked and say what is not: ' +
        $result.scopeScreen)

    # ---- the request carries the scope, and the guard holds ----
    Assert-True (
        $strictRequest.heading -and
        $strictRequest.carriesScopeText) (
        'The repair request must carry the change scope in the file''s ' +
        'own words: ' + $result.strictRequest)
    Assert-True (
        $refused.imported -eq 0 -and
        -not [string]::IsNullOrEmpty([string]$refused.reason) -and
        $refused.onScreen) (
        'A reply adding a module must be refused, nothing imported, and ' +
        'the module named on screen: ' + $result.refused)

    # ---- and only then does the same reply go in ----
    Assert-True (
        $accepted.imported -eq 2 -and
        $accepted.added -eq 1 -and
        ($null -eq $accepted.reason)) (
        'With structural change allowed the same reply must be taken in: ' +
        $result.accepted)

    Write-Output 'test-change-scope-webview: PASS'
    Write-Output (
        'one road in, ' + $categories.headings.Count +
        ' declared headings, 4 named checks with their limit stated, the ' +
        'scope in the request, a module-adding reply refused by default ' +
        'and taken in only after it was allowed')
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
