# Windows PowerShell 5.1, 64-bit, STA. No Excel or VBA execution.
# This harness was supplied but NOT executed in the Linux audit environment.
# Run from the package root:
# powershell.exe -NoProfile -STA -File .\tests\Test-Windows.ps1
$ErrorActionPreference = 'Stop'
if ($env:OS -ne 'Windows_NT' -or $PSVersionTable.PSEdition -ne 'Desktop') {
    throw 'Use Windows PowerShell 5.1 (not PowerShell 7).'
}
if (-not [Environment]::Is64BitProcess) { throw 'Use 64-bit Windows PowerShell.' }
try {
    $baseDir = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
    $libDir = Join-Path $baseDir 'lib'
    $srcDir = Join-Path $baseDir 'src'

    Add-Type -AssemblyName PresentationFramework
    Add-Type -AssemblyName PresentationCore
    Add-Type -AssemblyName WindowsBase
    Add-Type -AssemblyName System.Xaml
    Add-Type -AssemblyName System.Drawing
    Add-Type -AssemblyName System.Web.Extensions
    Add-Type -AssemblyName System.IO.Compression
    Add-Type -AssemblyName System.IO.Compression.FileSystem

    $env:Path = $libDir + [System.IO.Path]::PathSeparator + $env:Path

    $webViewAssemblies = @(
        (Join-Path $libDir 'Microsoft.Web.WebView2.Core.dll')
        (Join-Path $libDir 'Microsoft.Web.WebView2.Wpf.dll')
    )

    foreach ($assemblyPath in $webViewAssemblies) {
        if (-not (Test-Path -LiteralPath $assemblyPath -PathType Leaf)) {
            throw "Required WebView2 assembly is missing: $assemblyPath"
        }

        # A copy that arrived as a zip download carries a Mark of the Web
        # (a Zone.Identifier stream), and Assembly::LoadFrom refuses such a
        # file with HRESULT 0x80131515. Handing the bytes to Assembly::Load
        # loads the same assembly without touching that stream.
        [System.Reflection.Assembly]::Load(
            [System.IO.File]::ReadAllBytes($assemblyPath)) | Out-Null
    }

    $csFiles = Get-ChildItem -LiteralPath $srcDir -Filter '*.cs' |
        Sort-Object -Property Name

    if (@($csFiles).Count -eq 0) {
        throw "No C# source files were found in: $srcDir"
    }

    $combined = ($csFiles | ForEach-Object {
        [System.IO.File]::ReadAllText($_.FullName, [System.Text.Encoding]::UTF8)
    }) -join "`n"

    $combined += "`n" + [System.IO.File]::ReadAllText(
        (Join-Path $PSScriptRoot 'CoreRegression.cs'), [System.Text.Encoding]::UTF8)

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
        'System.IO.Compression'
        'System.IO.Compression.FileSystem'
        (Join-Path $libDir 'Microsoft.Web.WebView2.Core.dll')
        (Join-Path $libDir 'Microsoft.Web.WebView2.Wpf.dll')
    )

    Add-Type -TypeDefinition $source -ReferencedAssemblies $references -Language CSharp

    [MacroStudio.CoreRegression]::Run($baseDir)
    exit 0
}
catch {
    [Console]::Error.WriteLine($_.Exception.ToString())
    exit 1
}
