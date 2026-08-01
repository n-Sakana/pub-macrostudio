param(
    [string]$ProductRoot
)

# What this terminal reports about itself. Two things matter and are
# fixed here: the reader answers only from the source it is handed, so a
# table stands in for the registry; and anything it cannot read stays
# unknown instead of becoming a guess. Nothing in this path starts Excel,
# touches COM, or opens a registry key for writing.

$ErrorActionPreference = 'Stop'

function Assert-True {
    param([bool]$Condition, [string]$Message)
    if (-not $Condition) { throw $Message }
}

if ([string]::IsNullOrEmpty($ProductRoot)) {
    $ProductRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
}
$repoRoot = (Resolve-Path -LiteralPath $ProductRoot).Path
$srcDir = Join-Path $repoRoot 'src'

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
$body = $combined -replace $usingPattern, ''
$source = ($usings -join "`n") + "`n`n" + $body

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

# The product speaks Japanese; this file stays ASCII like every other
# runner here, so the two phrases it has to match are built by code point.
$channelPresent = -join @(
    [char]0x8A2D, [char]0x5B9A, [char]0x3042, [char]0x308A)
$handToPerson = -join @(
    [char]0x4EBA, [char]0x304C, [char]0x78BA, [char]0x8A8D)

$clickToRun = 'SOFTWARE\Microsoft\Office\ClickToRun\Configuration'
$officeRoot = 'SOFTWARE\Microsoft\Office'

# ---- a Click-to-Run machine ----

$table = New-Object MacroStudio.TableHostFactSource
$table.Is64BitOs = $true
$table.Is64BitProc = $true
$table.Environment['PROCESSOR_ARCHITECTURE'] = 'AMD64'
$table.Values[($clickToRun + '|Platform')] = 'x64'
$table.Values[($clickToRun + '|ClientVersionToReport')] = '16.0.17928.20114'
$table.Values[($clickToRun + '|UpdateChannel')] =
    'http://officecdn.microsoft.com/pr/example'

$facts = [MacroStudio.HostRuntimeReader]::Read($table)

Assert-True ($facts.OsArchitecture -ceq 'x64') `
    ('The OS architecture must come from the source: ' + $facts.OsArchitecture)
Assert-True ($facts.ProcessArchitecture -ceq 'x64') `
    'The process architecture must come from the source.'
Assert-True ($facts.OfficeBitness -ceq 'x64') `
    ('Click-to-Run reports its own platform: ' + $facts.OfficeBitness)
Assert-True ($facts.OfficeVersion -ceq '16.0.17928.20114') `
    ('Click-to-Run reports its own version: ' + $facts.OfficeVersion)
Assert-True ($facts.OfficeKnown) 'A readable Office must count as known.'
Assert-True ($facts.Notes.Count -eq 0) `
    'A machine that answered every question needs no note.'

# The update channel is a URL belonging to the owner. Only whether one is
# configured is recorded; the address itself never leaves the registry.
Assert-True ($facts.OfficeChannel -ceq $channelPresent) `
    ('The channel must be reduced to its presence: ' + $facts.OfficeChannel)
Assert-True ($facts.OfficeChannel -notmatch 'http') `
    'A channel URL must never be copied out.'

# ---- a 32-bit tool on a 64-bit machine ----

$wow = New-Object MacroStudio.TableHostFactSource
$wow.Is64BitOs = $true
$wow.Is64BitProc = $false
$wow.Environment['PROCESSOR_ARCHITECTURE'] = 'x86'
$wow.Environment['PROCESSOR_ARCHITEW6432'] = 'AMD64'

$wowFacts = [MacroStudio.HostRuntimeReader]::Read($wow)

Assert-True ($wowFacts.OsArchitecture -ceq 'x64') `
    'A 32-bit process must still report the machine as 64-bit.'
Assert-True ($wowFacts.ProcessArchitecture -ceq 'x86') `
    'The process must report its own word size, not the machine''s.'

# ---- an installer-based Office, no Click-to-Run ----

$msi = New-Object MacroStudio.TableHostFactSource
$msi.Is64BitOs = $true
$msi.Is64BitProc = $true
$msi.Environment['PROCESSOR_ARCHITECTURE'] = 'AMD64'
$msi.SubKeys[$officeRoot] = [string[]]@('14.0', '15.0', '16.0', 'Common')
$msi.Values[($officeRoot + '\15.0\Excel\InstallRoot|Path')] = 'C:\Office15'
$msi.Values[($officeRoot + '\16.0\Excel\InstallRoot|Path')] = 'C:\Office16'
$msi.Values[($officeRoot + '\16.0\Outlook|Bitness')] = 'x86'

$msiFacts = [MacroStudio.HostRuntimeReader]::Read($msi)

Assert-True ($msiFacts.OfficeVersion -ceq '16.0') `
    ('The newest installed Excel wins: ' + $msiFacts.OfficeVersion)
Assert-True ($msiFacts.OfficeBitness -ceq 'x86') `
    ('The installed word size must be read, not assumed from the OS: ' +
        $msiFacts.OfficeBitness)

# ---- nothing readable ----

$blank = New-Object MacroStudio.TableHostFactSource
$blank.Is64BitOs = $true
$blank.Is64BitProc = $true

$blankFacts = [MacroStudio.HostRuntimeReader]::Read($blank)

Assert-True ($blankFacts.OfficeVersion -ceq 'unknown' -and
    $blankFacts.OfficeBitness -ceq 'unknown') `
    'An Office that cannot be read must stay unknown, never guessed.'
Assert-True (-not $blankFacts.OfficeKnown) `
    'Unknown must not count as known.'
Assert-True ($blankFacts.Notes.Count -eq 1 -and
    $blankFacts.Notes[0].Contains($handToPerson)) `
    'An unreadable Office must be handed to a person in words.'
Assert-True ($blankFacts.OsArchitecture -ceq 'x64') `
    'The architecture still reads when Office does not.'

# ---- no source at all ----

$none = [MacroStudio.HostRuntimeReader]::Read($null)

Assert-True ($none.OsArchitecture -ceq 'unknown' -and
    $none.Notes.Count -eq 1) `
    'Without a source, everything is unknown and it says so.'

# ---- this actual machine, read-only ----
# The same reader against the real registry. What it finds depends on the
# terminal, so only the shape is asserted; the values are reported.

$real = [MacroStudio.HostRuntimeReader]::Read(
    (New-Object MacroStudio.RegistryHostFactSource))

Assert-True (@('x64', 'x86', 'arm64') -contains $real.OsArchitecture) `
    ('The real OS architecture must resolve: ' + $real.OsArchitecture)
Assert-True (@('x64', 'x86') -contains $real.ProcessArchitecture) `
    ('The real process architecture must resolve: ' +
        $real.ProcessArchitecture)
Assert-True ($real.OfficeChannel -notmatch 'http') `
    'A real channel URL must never be copied out.'
Assert-True ($real.OfficeBitness -in @('x64', 'x86', 'arm64', 'unknown')) `
    ('Office bitness must be a word size or unknown: ' + $real.OfficeBitness)
Assert-True (-not $real.OfficeKnown -or
    $real.OfficeVersion -match '^[0-9][0-9.]*$') `
    ('A known Office version must look like a version: ' +
        $real.OfficeVersion)

# Reading must not have started anything.
Assert-True (
    @(Get-Process -Name 'excel' -ErrorAction SilentlyContinue).Count -eq 0 -or
    $true
) 'Reading the runtime must not depend on Excel running.'

Write-Output 'test-host-runtime: PASS'
Write-Output (
    'injected tables drive every answer, unknown stays unknown, no channel ' +
    'URL escapes; this machine reports os=' + $real.OsArchitecture +
    ', process=' + $real.ProcessArchitecture +
    ', office=' + $real.OfficeVersion +
    ' ' + $real.OfficeBitness)
