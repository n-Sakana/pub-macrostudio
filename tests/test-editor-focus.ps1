param(
    [string]$BookPath,
    [string]$ProductRoot,
    [string]$DumpPath
)

# Every box the flow offers, typed into in the real runtime.
#
# The check is not "did the characters arrive" - they always did. It is
# "was the box still there afterwards": the same element, still focused,
# with the caret where the person left it. A screen that is rebuilt on
# each keystroke passes the first check and fails this one, which is
# exactly what someone typing feels.

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

# One box, every step of it. Nothing may have replaced the element and
# nothing may have taken the focus away from it.
function Assert-BoxSurvived {
    param(
        $Report,
        [string]$Label
    )

    Assert-True (-not $Report.missing) `
        "$Label : the box was not on the screen at all."
    Assert-True ([bool]$Report.focusTaken) `
        ("$Label : the box could not take the focus to begin with (" +
            ($Report.why | ConvertTo-Json -Compress) + ').')

    $groups = @(
        @('typed', $Report.typed),
        @('composed', $Report.composed),
        @('imeEnter', $Report.imeEnter),
        @('pasted', $Report.pasted),
        @('replaced', $Report.replaced))

    foreach ($group in $groups) {
        $name = $group[0]
        foreach ($step in $group[1]) {
            Assert-True ([bool]$step.survived) `
                ("$Label / $name / " + $step.step +
                    ' : the box was replaced by another element.')
            Assert-True ([bool]$step.focused) `
                ("$Label / $name / " + $step.step +
                    ' : the focus left the box (it went to ' +
                    [string]$step.active + ').')
        }
    }

    # Typing one character at a time must move the caret one place at a
    # time. A caret that snaps back to 0 is a rebuilt box.
    $index = 0
    foreach ($step in $Report.typed) {
        $index += 1
        Assert-True ($step.caret -eq $index) `
            ("$Label : after " + $index + ' characters the caret was at ' +
                [string]$step.caret + '.')
    }
    foreach ($step in $Report.imeEnter) {
        Assert-True ([bool]$step.screenUnchanged) `
            "$Label : IME Enter advanced the workflow."
    }
}

function Assert-ToggleSurvived {
    param(
        $Report,
        [string]$Label
    )

    Assert-True (-not $Report.missing) `
        "$Label : the option was not on the screen."
    Assert-True ([bool]$Report.focusTaken) `
        "$Label : the option could not take the focus."
    foreach ($step in $Report.steps) {
        Assert-True ([bool]$step.survived) `
            ("$Label / " + $step.step +
                ' : the option was replaced by another element.')
        Assert-True ([bool]$step.focused) `
            ("$Label / " + $step.step +
                ' : the focus left the option (it went to ' +
                [string]$step.active + ').')
    }
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
    'focus-cache-' + [Guid]::NewGuid().ToString('N'))
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
$smokeSource = Join-Path $PSScriptRoot 'EditorFocusSmoke.cs'
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
$mappingBook = (Resolve-Path (
    Join-Path $PSScriptRoot `
        '..\testdata\input_monthly_report.xlsm')).Path
$mappingHash = (Get-FileHash -LiteralPath $mappingBook `
    -Algorithm SHA256).Hash
try {
    try {
        $rawResult = [MacroStudio.Tests.EditorFocusSmoke]::Run(
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
    $ai = $result.ai | ConvertFrom-Json
    $mapping = $result.mapping | ConvertFrom-Json

    foreach ($phase in @($ai, $mapping)) {
        if ($phase.runFolder) {
            $runFolders += [string]$phase.runFolder
        }
    }

    # 'Xabc' followed by the settled word and the pasted one: what is
    # left after typing, composing, pasting and replacing a selection.
    $expected = 'Xabc' + (-join @(
        [char]0x6F22, [char]0x5B57, [char]0x8CBC, [char]0x4ED8))

    $boxes = @(
        @('extra-request', ($ai.extra |
            ConvertFrom-Json)),
        @('path-map-to', ($mapping.value |
            ConvertFrom-Json)))

    foreach ($box in $boxes) {
        Assert-BoxSurvived $box[1] $box[0]
        Assert-True (([string]$box[1].finalValue) -eq $expected) `
            ($box[0] + ' : the text ended up as "' +
                [string]$box[1].finalValue + '" instead of "' +
                $expected + '".')
    }

    $aiState = $ai.state | ConvertFrom-Json
    $mapState = $mapping.state | ConvertFrom-Json
    Assert-True (
        ([string]$aiState.extra) -eq $expected -and
        $aiState.nextReady
    ) 'The extra request did not reach product state.'
    Assert-True (
        $mapState.applied -eq 1 -and
        ([string]$mapState.value) -eq $expected -and
        $mapState.nextReady
    ) 'The edited mapping value did not reach the branded path map.'

    foreach ($shellValue in @($ai.shell, $mapping.shell)) {
        $shell = $shellValue | ConvertFrom-Json
        Assert-True (-not $shell.vertical -and -not $shell.horizontal) `
            'Screen 4 scrolled at 1366x768 while editing.'
        Assert-True ($shell.footer) `
            'The screen-4 footer left the 1366x768 viewport.'
    }

    $afterSourceHash = (Get-FileHash -LiteralPath $resolvedBookPath `
        -Algorithm SHA256).Hash
    $afterMappingHash = (Get-FileHash -LiteralPath $mappingBook `
        -Algorithm SHA256).Hash
    Assert-True (
        $afterSourceHash -ceq $sourceHash -and
        $afterMappingHash -ceq $mappingHash
    ) 'The focus test modified an attached source workbook.'

    Write-Output 'test-editor-focus: PASS'
    Write-Output (
        'extra/mapping kept element, focus and caret through ' +
        'typing, IME Enter/composition, paste and selection replacement')
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
