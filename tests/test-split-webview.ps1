param(
    [string]$BookPath,
    [string]$ProductRoot
)

# The module-by-module option (SPEC 6.6) and the reachable way back to
# another answer (audit P2-1), driven through the real WebView2 runtime.
# The clipboard is never touched here, so this runner works where the
# full flow smoke test cannot open it.

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
    'split-cache-' + [Guid]::NewGuid().ToString('N'))
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
$smokeSource = Join-Path $PSScriptRoot 'SplitOutputSmoke.cs'
$combined = (@($sourceFiles.FullName) + @($smokeSource) |
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
        $rawResult = [MacroStudio.Tests.SplitOutputSmoke]::Run(
            $repoRoot,
            $cacheDir,
            $resolvedBookPath)
    } catch {
        throw $_.Exception.ToString()
    }

    $result = $rawResult | ConvertFrom-Json
    $runFolder = $result.runFolder
    $first = $result.afterFirstPart | ConvertFrom-Json
    $last = $result.afterLastPart | ConvertFrom-Json
    $whole = $result.afterWholeAnswer | ConvertFrom-Json
    $diagnosisTaken = $result.diagnosisTaken | ConvertFrom-Json

    # ---- both AI stages use the single beta 2 entrance ----
    Assert-True ($result.singleEntrance -eq $true) `
        'The split route restored a removed mode or purpose entrance.'
    # A diagnosis is prose about the macro and arrives in one reply, so the
    # screen no longer offers to split it. Splitting stays where the reply
    # is code.
    Assert-True ($result.diagnosisOptionGone -eq $true) `
        'The diagnosis screen must not offer a split reply any more.'
    Assert-True (
        $diagnosisTaken.findings -eq 2 -and
        $diagnosisTaken.partsUnused -and
        $diagnosisTaken.recorded
    ) 'The whole diagnosis must be taken in and recorded from one reply.'

    # ---- the option is on the request screen and starts off ----
    Assert-True ($result.presetFile.Length -gt 0) `
        'No shipped preset offered the module-by-module rules.'
    Assert-True ($result.optionOnScreen -eq $true) `
        'The option was not rendered on the request screen.'
    Assert-True ($result.optionOffByDefault -eq $true) `
        'The option must start off: the one-paste route is the default.'
    Assert-True ($result.optionChecked -eq $true) `
        'Clicking the checkbox did not turn the option on.'

    # ---- the chosen rules reach the request that goes to the chat ----
    Assert-True ($result.promptHasPartSentinel -eq $true) `
        'The written request does not ask for numbered parts.'
    Assert-True ($result.promptHasOneBlockRule -eq $true) `
        'The written request does not ask for one module per answer.'
    Assert-InsideDirectory $runFolder (Join-Path $repoRoot 'exports')
    Assert-True (
        [IO.File]::Exists((Join-Path $runFolder 'diagnose-request.md')) -and
        [IO.File]::Exists((Join-Path $runFolder 'diagnosis.md')) -and
        [IO.File]::Exists((Join-Path $runFolder 'repair-request.md')) -and
        [IO.File]::Exists((Join-Path $runFolder 'source-code.md'))) `
        'The run folder is missing a two-AI split artifact.'
    $requestText = [IO.File]::ReadAllText(
        (Join-Path $runFolder 'repair-request.md'),
        [Text.Encoding]::UTF8)
    Assert-True ($requestText.Contains(' PART ')) `
        'repair-request.md does not carry the part sentinel.'
    Assert-True ($requestText.Contains('{{') -eq $false) `
        'repair-request.md still carries a placeholder.'

    # ---- the parts arrive one at a time ----
    Assert-True ($first.parts -eq 1 -and $first.total -eq 2) `
        'The first part was not counted against the declared total.'
    Assert-True ($first.imported -eq 0) `
        'One part of two must not import anything yet.'
    Assert-True ($first.canGoNext -eq $false) `
        'An incomplete answer must hold the flow on the intake screen.'
    Assert-True ($first.rows -eq 1) `
        'The received part was not listed on the screen.'
    Assert-True ($first.missingShown -eq $true) `
        'The outstanding module was not named on the screen.'
    Assert-True ($result.conflictRefused -eq $true) `
        'A repeated number with other content was not refused.'

    Assert-True ($last.imported -eq 2 -and $last.changed -eq 2) `
        'The completed answer did not come in as one package.'
    Assert-True ($last.canGoNext -eq $true) `
        'A complete answer must let the flow reach the review.'
    Assert-True ($last.buildModules -eq 2) `
        'The merged answer did not reach the build payload.'
    Assert-True ($last.restartOnScreen -eq $true) `
        'The way to start the intake over was not on the screen.'
    Assert-True ($last.summary.Length -gt 0) `
        'The summary the first part carried was lost.'

    # ---- audit P2-1: another answer can still be taken instead ----
    Assert-True ($whole.imported -eq 2) `
        'The one-paste answer did not replace the collected parts.'
    Assert-True ($whole.addedModuleGone -eq $true) `
        'A module only the previous answer added survived.'
    Assert-True ($whole.canGoNext -eq $true) `
        'The replacement answer must let the flow continue.'
    Assert-True ($whole.reimportOnScreen -eq $true) `
        'After a package came in, the intake button must stay reachable.'
    Assert-True ($whole.horizontal -eq $false) `
        'The intake screen scrolls horizontally at 1366x768.'

    $afterHash = (Get-FileHash -LiteralPath $resolvedBookPath `
        -Algorithm SHA256).Hash
    Assert-True ($afterHash -ceq $sourceHash) `
        'The split intake flow modified the source workbook.'
} finally {
    if (-not [string]::IsNullOrEmpty($runFolder)) {
        Assert-InsideDirectory $runFolder (Join-Path $repoRoot 'exports')
        if ([IO.Directory]::Exists($runFolder)) {
            [IO.Directory]::Delete($runFolder, $true)
        }
        $macroRoot = [IO.Path]::GetDirectoryName($runFolder)
        if ([IO.Directory]::Exists($macroRoot) -and
            @([IO.Directory]::GetFileSystemEntries(
                $macroRoot)).Count -eq 0) {
            [IO.Directory]::Delete($macroRoot)
        }
    }
    # The browser process lets go of its cache a moment after the window
    # closes, so the removal is retried instead of failing the run.
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

Write-Output 'test-split-webview: PASS'
Write-Output (
    'preset={0}, parts={1}/{2}, merged={3}, rebuilt-intake=reachable' -f `
    $result.presetFile,
    $first.parts,
    $first.total,
    $last.imported)
