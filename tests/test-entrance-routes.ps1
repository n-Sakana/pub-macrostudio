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
    'entrance-cache-' + [Guid]::NewGuid().ToString('N'))
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
$smokeSources = @((Join-Path $PSScriptRoot 'EntranceRoutesSmoke.cs'))
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
        $rawResult = [MacroStudio.Tests.EntranceRoutesSmoke]::Run(
            $repoRoot,
            $resolvedBookPath,
            $cacheDir)
    } catch {
        throw $_.Exception.ToString()
    }

    $result = $rawResult | ConvertFrom-Json
    # Windows PowerShell hands a JSON array back as one object, so it is
    # taken without @() around it - that would wrap it, not unroll it.
    $entrances = [object[]](ConvertFrom-Json ([string]$result.entrances))
    $refactor = $result.refactor | ConvertFrom-Json
    $free = $result.free | ConvertFrom-Json

    # ---- the first screen ----
    # Three cards, each usable, each saying for itself whether a run of
    # its kind is diagnosed. Nothing here is written in the app.
    Assert-True ($entrances.Count -eq 3) (
        'The first screen must offer three entrances: ' + $entrances.Count)
    foreach ($entrance in $entrances) {
        Assert-True (-not $entrance.disabled) (
            'A shipped entrance is not usable: ' + $entrance.folder)
        Assert-True (
            -not [string]::IsNullOrEmpty([string]$entrance.title)) (
            'An entrance card has no name: ' + $entrance.folder)
        Assert-True (
            -not [string]::IsNullOrEmpty([string]$entrance.note)) (
            'An entrance card does not say whether it diagnoses: ' +
                $entrance.folder)
    }
    Assert-True (
        @($entrances | Where-Object { $_.note -ceq $entrances[0].note }
        ).Count -eq 2) (
        'Two of the three entrances diagnose, and one does not.')

    # ---- the refactor ----
    $refactorEntrance = $refactor.entrance | ConvertFrom-Json
    $refactorRequest = $refactor.request | ConvertFrom-Json
    $refactorResult = $refactor.result | ConvertFrom-Json
    $refactorInput = $refactor.repairInput | ConvertFrom-Json

    Assert-True (
        $refactorEntrance.hasDiagnosis -and
        -not $refactorEntrance.choosesTemplate -and
        $refactorEntrance.repairTemplates -eq 1) (
        'The refactor entrance diagnoses and holds one repair template.')
    # The criteria the grade is given against are the repair template's
    # own instruction, injected into the request. Keeping them in one
    # file is what stops the two stages drifting apart.
    Assert-True (
        $refactorRequest.gradingBasis -and
        $refactorRequest.asksForGrade) (
        'The refactor request must carry the grading basis and ask for ' +
        'one grade.')
    Assert-True (
        ($refactorResult.shape -ceq 'grade') -and
        ($refactorResult.grade -ceq 'D') -and
        ($refactorResult.badge -ceq 'D') -and
        $refactorResult.reason -and
        $refactorResult.judgement -eq 1) (
        'The graded result must show the letter, the reasoning and that ' +
        'it is a judgement.')
    # The other shape's furniture must not appear: there are no findings
    # here to count or to list.
    Assert-True (
        $refactorResult.gradeTiles -eq 0 -and
        $refactorResult.findingRows -eq 0) (
        'A graded result must not draw the finding-shape strip or rows.')
    # One template means there is nothing to choose between, so the page
    # that would have asked is skipped and the template is already in.
    Assert-True (
        $refactorInput.chosen -eq 1 -and
        -not [string]::IsNullOrEmpty([string]$refactorInput.preset) -and
        $refactorInput.findingChecks -eq 0) (
        'The single repair template must arrive already chosen, with no ' +
        'findings to send.')

    # ---- the free request ----
    $freeEntrance = $free.entrance | ConvertFrom-Json
    $freeInput = $free.repairInput | ConvertFrom-Json
    $freeRequest = $free.request | ConvertFrom-Json

    Assert-True (
        (-not $freeEntrance.hasDiagnosis) -and
        $freeEntrance.skipped -and
        $freeEntrance.repairTemplates -eq 1) (
        'The free request entrance holds no diagnosis and one template.')
    # Nothing was diagnosed, so there is nothing to tick. The template
    # that exists for the reader to write the work themselves names the
    # field, so it is on the screen under that name rather than folded
    # away behind the word "optional".
    Assert-True (
        ($null -eq $freeInput.diagnosis) -and
        $freeInput.findingChecks -eq 0 -and
        $freeInput.writeIn -eq 1 -and
        $freeInput.folded -eq 0 -and
        -not $freeInput.nextReady) (
        'With no diagnosis the request screen offers only the write-in ' +
        'box, and waits until something is written: ' + $free.repairInput)
    Assert-True (
        $freeRequest.carriesWhatWasWritten -and
        $freeRequest.noDiagnosisQuoted) (
        'What the reader wrote is the whole request, and no diagnosis is ' +
        'quoted into it.')

    Write-Output 'test-entrance-routes: PASS'
    Write-Output (
        'entrances=3, refactor=grade ' + $refactorResult.grade +
        ' with one template pre-chosen, free request=no diagnosis and ' +
        'the written request reaches the chat')
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
