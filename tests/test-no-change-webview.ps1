param(
    [string]$BookPath,
    [string]$ProductRoot,
    [string]$DumpPath
)

# An answer that changes nothing, seen on the real screen.
#
# The node test settles the protocol; this one watches what a person
# would: the verdict named, the reason on the screen, [next] shut, the
# way to take another answer still open - and, afterwards, a real
# answer still reaching a rebuilt workbook. Both ways of asking for
# modules are driven, because the module-by-module run is the one that
# could sit waiting for a part that is never coming.

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
    'nochange-cache-' + [Guid]::NewGuid().ToString('N'))
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
$smokeSource = Join-Path $PSScriptRoot 'NoChangeSmoke.cs'
$combined = (@($sourceFiles.FullName) + @($smokeSource) |
    ForEach-Object {
        [IO.File]::ReadAllText($_, [Text.Encoding]::UTF8)
    }) -join "`n"

$usingPattern = '(?m)^\s*using\s+[\w][\w.]*\s*;'
$usings = [regex]::Matches($combined, $usingPattern) |
    ForEach-Object { $_.Value.Trim() } |
    Sort-Object -Unique
$source = ($usings -join "`n") + "`n`n" +
    ($combined -replace $usingPattern, '')

Add-Type -TypeDefinition $source -ReferencedAssemblies @(
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
) -Language CSharp

$runFolders = @()
$sourceHash = (Get-FileHash -LiteralPath $resolvedBookPath `
    -Algorithm SHA256).Hash
try {
    try {
        $rawResult = [MacroStudio.Tests.NoChangeSmoke]::Run(
            $repoRoot,
            $cacheDir,
            $resolvedBookPath)
    } catch {
        throw $_.Exception.ToString()
    }

    if (-not [string]::IsNullOrEmpty($DumpPath)) {
        [IO.File]::WriteAllText($DumpPath, $rawResult)
    }

    $result = $rawResult | ConvertFrom-Json
    # The words the screen must use: "no change", and each verdict.
    # "cannot repair" - the screen says a refusal is a refusal
    $noChangeWord = -join @(
        [char]0x6539, [char]0x4FEE, [char]0x3067, [char]0x304D, [char]0x307E, [char]0x305B, [char]0x3093)
    $unnecessaryWord = -join @(
        [char]0x6539, [char]0x4FEE, [char]0x306F, [char]0x4E0D,
        [char]0x8981)
    $impossibleWord = -join @(
        [char]0x6539, [char]0x4FEE, [char]0x3067, [char]0x304D,
        [char]0x306A, [char]0x3044)
    # "cannot be settled" - the third verdict
    $uncertainWord = -join @(
        [char]0x6C7A, [char]0x3081, [char]0x3089, [char]0x308C)
    $reasonWord = -join @(
        [char]0x76F4, [char]0x3059, [char]0x884C)

    foreach ($name in @('whole', 'split')) {
        $phase = $result.$name | ConvertFrom-Json
        $refusals = $phase.refusals | ConvertFrom-Json
        $declared = $phase.declared | ConvertFrom-Json
        $second = $phase.second | ConvertFrom-Json
        $diagnosis = $phase.diagnosis | ConvertFrom-Json
        $questionRefused = $phase.questionRefused | ConvertFrom-Json
        $third = $phase.third | ConvertFrom-Json
        $recovered = $phase.recovered | ConvertFrom-Json
        $built = $phase.built | ConvertFrom-Json

        if ($phase.runFolder) {
            $runFolders += [string]$phase.runFolder
        }

        Assert-True ([string]$phase.singleEntrance -ceq 'true') `
            "$name : a removed mode or purpose entrance reappeared."
        $expectedDiagnosisReason = if ($name -ceq 'whole') {
            'SCOPE_CLEAR'
        } else {
            'INSUFFICIENT'
        }
        Assert-True (
            $diagnosis.reason -ceq $expectedDiagnosisReason -and
            $diagnosis.findings -eq 0 -and
            $diagnosis.recorded -and
            $diagnosis.nextReady
        ) "$name : the explicit zero-finding diagnosis was not retained."

        # ---- near misses stay refused ----
        foreach ($case in @(
                'silent', 'noReason', 'badVerdict', 'foreign', 'cutOff')) {
            $refusal = $refusals.$case | ConvertFrom-Json
            Assert-True ($refusal.sent -gt 0) `
                ("$name / $case : nothing was actually sent, so the " +
                    'refusal proves nothing: ' +
                    [string]$refusal.buildError)
            Assert-True (-not $refusal.took) `
                "$name / $case : this must not be taken in."
            Assert-True (-not $refusal.verdictShown) `
                "$name / $case : this must never become a verdict."
            Assert-True ($refusal.imported -eq 0) `
                "$name / $case : nothing may be imported by it."
            Assert-True ([bool]$refusal.reported) `
                "$name / $case : the refusal must be reported."
            Assert-True (-not $refusal.nextReady) `
                "$name / $case : the run must not move on."
        }

        # ---- a declared verdict is taken, shown, and stops the run ----
        Assert-True ($declared.verdict -eq 'UNNECESSARY') `
            "$name : the declared verdict must be kept as declared."
        Assert-True (
            ([string]$declared.reasonKept).IndexOf($reasonWord) -ge 0) `
            "$name : the reason the AI gave must be kept."
        Assert-True (
            ([string]$declared.text).IndexOf($noChangeWord) -ge 0) `
            "$name : the screen must say there is no change."
        Assert-True (
            ([string]$declared.text).IndexOf($unnecessaryWord) -ge 0) `
            "$name : the screen must name the verdict it was."
        Assert-True (
            ([string]$declared.text).IndexOf($reasonWord) -ge 0) `
            "$name : the screen must show the reason."
        Assert-True ($declared.imported -eq 0 -and
            $declared.changed -eq 0) `
            "$name : a verdict imports nothing."
        Assert-True (-not $declared.nextReady) `
            "$name : the way to the diff and the build must be shut."
        Assert-True ($declared.diffTables -eq 0) `
            "$name : no diff may be drawn for a verdict."
        Assert-True ($declared.canRetake -eq 1) `
            "$name : taking another answer must stay available."
        Assert-True ($declared.waitingForParts -eq 0) `
            ("$name : a verdict must not leave the run waiting for " +
                'a module that is never coming.')

        # ---- the other verdict reads differently ----
        Assert-True ($second.verdict -eq 'IMPOSSIBLE') `
            "$name : the second verdict must replace the first."
        Assert-True (
            ([string]$second.text).IndexOf($impossibleWord) -ge 0) `
            "$name : the screen must name the second verdict too."
        Assert-True (-not $second.nextReady) `
            "$name : the second verdict must shut the way as well."

        # ---- a reply that asks the reader something is refused ----
        # There are two answers, not three. A question is the third
        # thing, and taking it in would start an exchange this app
        # cannot hold.
        Assert-True (-not [bool]$questionRefused.accepted) `
            "$name : a reply that asks a question must be refused."
        $before = $questionRefused.before | ConvertFrom-Json
        Assert-True (
            $questionRefused.verdict -ceq $before.verdict -and
            $questionRefused.repairId -ceq $before.repairId
        ) "$name : a refused question must leave the state untouched."

        # ---- and "I cannot settle this" is a refusal like the others ----
        Assert-True (
            ([string]$third.text).IndexOf($uncertainWord) -ge 0
        ) "$name : the screen must name the third verdict too."
        Assert-True (-not $third.nextReady) `
            "$name : the third verdict must shut the way as well."

        # ---- and a real answer afterwards still finishes the job ----
        Assert-True ([bool]$recovered.verdictGone) `
            "$name : a real answer must clear the verdict."
        Assert-True ($recovered.imported -eq 2) `
            "$name : both modules must come in after a verdict."
        Assert-True ([bool]$recovered.nextReady) `
            "$name : the run must be able to go on again."
        Assert-True ([bool]$built.success) `
            "$name : the run must still reach a rebuilt workbook."
        Assert-True ([IO.File]::Exists([string]$built.outputPath)) `
            ("$name : the rebuilt workbook is missing: " +
                $built.outputPath)
    }

    $afterHash = (Get-FileHash -LiteralPath $resolvedBookPath `
        -Algorithm SHA256).Hash
    Assert-True ($afterHash -ceq $sourceHash) `
        'The no-change WebView flow modified the source workbook.'

    Write-Output 'test-no-change-webview: PASS'
    Write-Output (
        'zero=SCOPE_CLEAR/INSUFFICIENT; verdicts=' +
        'UNNECESSARY/IMPOSSIBLE/UNCLEAR; questions refused; recovery builds')
} finally {
    [GC]::Collect()
    [GC]::WaitForPendingFinalizers()
    [GC]::Collect()
    foreach ($folder in $runFolders) {
        if ($folder -and [IO.Directory]::Exists($folder)) {
            Assert-InsideDirectory $folder (
                Join-Path $repoRoot 'exports')
            [IO.Directory]::Delete($folder, $true)
        }
    }
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
