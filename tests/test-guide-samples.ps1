param(
    [string]$SamplesDir,
    [string]$ProductRoot
)

# The ten workbooks built from the improvement guide's section 3, read
# back with the product's own readers.
#
# Two different things are checked, and they are not interchangeable:
#
#   the code    - the constructs a static search (guide Step 2) has to
#                 find, asserted against the module text MacroStudio
#                 actually extracts, not against the .bas on disk
#   the book    - the facts that live outside the code (references,
#                 queries, external links, ActiveX, barcode fonts, a
#                 signature), asserted against BookInventoryReader
#
# A sample whose part this terminal refused to create is reported as
# unbuilt rather than quietly passing. Nothing here runs a macro, opens
# Excel, or touches the network.
#
# Build the books first:
#   powershell.exe -NoProfile -ExecutionPolicy Bypass `
#       -File tests\make-guide-samples.ps1

$ErrorActionPreference = 'Stop'

function Assert-True {
    param([bool]$Condition, [string]$Message)
    if (-not $Condition) { throw $Message }
}

function Get-Property {
    param($Object, [string]$Name)
    if ($null -eq $Object) { return $null }
    $member = $Object.PSObject.Properties[$Name]
    if ($null -eq $member) { return $null }
    return $member.Value
}

if ([string]::IsNullOrEmpty($ProductRoot)) {
    $ProductRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
}
$repoRoot = (Resolve-Path -LiteralPath $ProductRoot).Path
$srcDir = Join-Path $repoRoot 'src'
$fixtureDir = Join-Path $repoRoot 'tests\fixtures\guide-samples'

if ([string]::IsNullOrEmpty($SamplesDir)) {
    $SamplesDir = Join-Path $repoRoot 'testdata\guide-samples'
}
Assert-True ([IO.Directory]::Exists($SamplesDir)) `
    ('Build the samples first with tests\make-guide-samples.ps1. Missing: ' +
     $SamplesDir)
$SamplesDir = (Resolve-Path -LiteralPath $SamplesDir).Path

$manifest = [IO.File]::ReadAllText(
    (Join-Path $fixtureDir 'samples.json'), [Text.Encoding]::UTF8) |
    ConvertFrom-Json
$buildResultPath = Join-Path $SamplesDir 'build-result.json'
$buildResult = $null
if ([IO.File]::Exists($buildResultPath)) {
    $buildResult = [IO.File]::ReadAllText(
        $buildResultPath, [Text.Encoding]::UTF8) | ConvertFrom-Json
}

Add-Type -AssemblyName PresentationFramework
Add-Type -AssemblyName PresentationCore
Add-Type -AssemblyName WindowsBase
Add-Type -AssemblyName System.Xaml
Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Web.Extensions
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

$libDir = Join-Path $repoRoot 'lib'
$corePath = Join-Path $libDir 'Microsoft.Web.WebView2.Core.dll'
$wpfPath = Join-Path $libDir 'Microsoft.Web.WebView2.Wpf.dll'
[Reflection.Assembly]::LoadFrom($corePath) | Out-Null
[Reflection.Assembly]::LoadFrom($wpfPath) | Out-Null

$sourceFiles = Get-ChildItem -LiteralPath $srcDir -Filter '*.cs' |
    Sort-Object -Property Name
$combined = ($sourceFiles | ForEach-Object {
    [IO.File]::ReadAllText($_.FullName, [Text.Encoding]::UTF8)
}) -join "`n"
$usingPattern = '(?m)^\s*using\s+[\w][\w.]*\s*;'
$usings = [regex]::Matches($combined, $usingPattern) |
    ForEach-Object { $_.Value.Trim() } |
    Sort-Object -Unique
$source = ($usings -join "`n") + "`n`n" + ($combined -replace $usingPattern, '')

$references = @(
    [System.Windows.Window].Assembly.Location
    [System.Windows.UIElement].Assembly.Location
    [System.Windows.DependencyObject].Assembly.Location
    [System.Xaml.XamlReader].Assembly.Location
    'Microsoft.CSharp'
    'System.Drawing'
    'System.Web.Extensions'
    'System.IO.Compression',
    'System.IO.Compression.FileSystem'
    $corePath
    $wpfPath
)
Add-Type -TypeDefinition $source `
    -ReferencedAssemblies $references `
    -Language CSharp

$lines = @()
$unbuilt = @()
$checked = 0

foreach ($sample in @($manifest.samples)) {
    $id = [string]$sample.id
    $bookPath = Join-Path $SamplesDir ([string]$sample.book)

    Assert-True ([IO.File]::Exists($bookPath)) `
        ('Missing sample: ' + $bookPath)

    $project = [MacroStudio.BookIO]::ReadProject($bookPath)
    Assert-True ($null -ne $project) ($id + ': the VBA project must read.')
    $bytes = [IO.File]::ReadAllBytes($bookPath)
    $inventory = [MacroStudio.BookInventoryReader]::Read(
        $bookPath, $bytes, $project)

    Assert-True ($inventory.Complete) `
        ($id + ': the package and the project must both read.')

    # ---- the code a static search has to find ----
    $moduleNames = @()
    $codeParts = @()
    foreach ($module in $project.Modules) {
        $moduleNames += [string]$module.Name
        $codeParts += [string]$module.Code
    }
    $code = $codeParts -join "`n"

    foreach ($expected in @($sample.modules)) {
        Assert-True ($moduleNames -contains [string]$expected.name) `
            ($id + ': the sample must carry the module ' +
             [string]$expected.name + ', found ' + ($moduleNames -join '/'))
    }
    foreach ($marker in @($sample.codeMarkers)) {
        Assert-True ($code.IndexOf([string]$marker) -ge 0) `
            ($id + ': a static search must find ' + [string]$marker)
    }
    # The entry macro has to exist under the name the sample publishes,
    # or nobody can reproduce the run it claims.
    $entry = [string]$sample.entryMacro
    $entryProc = $entry.Substring($entry.IndexOf('.') + 1)
    Assert-True ($code.IndexOf('Sub ' + $entryProc) -ge 0) `
        ($id + ': the published entry macro must exist: ' + $entry)

    # ---- what lives outside the code ----
    $expectations = Get-Property $sample 'inventory'
    $missed = @()

    $wanted = Get-Property $expectations 'referencesInclude'
    if ($null -ne $wanted) {
        foreach ($name in @($wanted)) {
            if (@($inventory.References) -contains [string]$name) {
                $checked++
            } else {
                $missed += ('reference:' + [string]$name)
            }
        }
    }
    $wanted = Get-Property $expectations 'hasPowerQuery'
    if ($null -ne $wanted) {
        if ($inventory.HasPowerQuery -eq [bool]$wanted) {
            $checked++
        } else {
            $missed += 'powerQuery'
        }
    }
    $wanted = Get-Property $expectations 'externalLinksAtLeast'
    if ($null -ne $wanted) {
        if ($inventory.ExternalLinkCount -ge [int]$wanted) {
            $checked++
        } else {
            $missed += 'externalLink'
        }
    }
    $wanted = Get-Property $expectations 'activeXAtLeast'
    if ($null -ne $wanted) {
        if ($inventory.ActiveXCount -ge [int]$wanted) {
            $checked++
        } else {
            $missed += 'activeX'
        }
    }
    $wanted = Get-Property $expectations 'barcodeFontsAtLeast'
    if ($null -ne $wanted) {
        if ($inventory.BarcodeFonts.Count -ge [int]$wanted) {
            $checked++
        } else {
            $missed += 'barcodeFont'
        }
    }
    $wanted = Get-Property $expectations 'connectionsAtLeast'
    if ($null -ne $wanted) {
        if ($inventory.Connections.Count -ge [int]$wanted) {
            $checked++
        } else {
            $missed += 'connection'
        }
    }
    $wanted = Get-Property $expectations 'hasVbaSignature'
    if ($null -ne $wanted) {
        Assert-True ($inventory.HasVbaSignature -eq [bool]$wanted) `
            ($id + ': the signature state must match the sample.')
        $checked++
    }

    # A part this terminal refused to create is reported, never passed
    # over in silence and never asserted as if it were there.
    if ($missed.Count -gt 0) {
        $note = ''
        if ($null -ne $buildResult) {
            foreach ($row in @($buildResult.samples)) {
                if ([string]$row.id -eq $id) { $note = [string]$row.note }
            }
        }
        Assert-True ($note -ne '') `
            ($id + ': ' + ($missed -join ',') +
             ' is absent and the build reported no reason. Either the ' +
             'sample or the expectation is wrong.')
        $unbuilt += ($id + ': ' + ($missed -join ',') + ' (' + $note + ')')
    }

    # ---- nothing that belongs to a person is carried out ----
    foreach ($name in @($inventory.Connections)) {
        Assert-True (
            $name -notmatch 'Provider=|Password=|User ID=|https?://'
        ) ($id + ': a connection string must never reach the inventory.')
    }

    $lines += ('  ' + $id + ' modules=' + $project.Modules.Count +
        ' refs=' + $inventory.References.Count +
        ' pq=' + $inventory.HasPowerQuery +
        ' extLink=' + $inventory.ExternalLinkCount +
        ' activeX=' + $inventory.ActiveXCount +
        ' barcodeFonts=' + $inventory.BarcodeFonts.Count +
        ' signed=' + $inventory.HasVbaSignature)
}

Assert-True (@($manifest.samples).Count -eq 10) `
    ('The guide sample set is ten workbooks, found ' +
     @($manifest.samples).Count)

Write-Output 'test-guide-samples: PASS'
Write-Output ('samples=' + @($manifest.samples).Count +
    ', outside-code facts confirmed=' + $checked +
    ', not reproducible on this terminal=' + $unbuilt.Count)
foreach ($line in $lines) { Write-Output $line }
foreach ($line in $unbuilt) { Write-Output ('  UNBUILT ' + $line) }
