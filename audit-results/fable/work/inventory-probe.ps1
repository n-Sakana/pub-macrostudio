# Read every guide sample with the product's own engine, headless, and
# report what MacroStudio can see for each: modules, read level, and the
# non-code inventory the handover memo depends on.
$ErrorActionPreference = 'Stop'
$base = 'C:\repos\pub\macrostudio'
$src = Join-Path $base 'src'

Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
Add-Type -AssemblyName System.Web.Extensions

# The engine files only (05-09): no WPF/WebView2 dependency.
$files = Get-ChildItem -LiteralPath $src -Filter '*.cs' |
    Where-Object { $_.Name -match '^(05|06|07|08|09)_' } |
    Sort-Object Name
$combined = ($files | ForEach-Object {
    [System.IO.File]::ReadAllText($_.FullName, [System.Text.Encoding]::UTF8)
}) -join "`n"
$usingPattern = '(?m)^\s*using\s+[\w][\w.]*\s*;'
$usings = [regex]::Matches($combined, $usingPattern) |
    ForEach-Object { $_.Value.Trim() } | Sort-Object -Unique
$body = $combined -replace $usingPattern, ''
$source = ($usings -join "`n") + "`n`n" + $body
Add-Type -TypeDefinition $source -ReferencedAssemblies @(
    'System.IO.Compression', 'System.IO.Compression.FileSystem') -Language CSharp

$books = Get-ChildItem 'C:\repos\pub\macrostudio\audit-results\fable\work\books' -Filter 'S*.xlsm' |
    Sort-Object Name
$rows = @()
foreach ($b in $books) {
    $project = [MacroStudio.BookIO]::ReadProject($b.FullName)
    $bytes = [System.IO.File]::ReadAllBytes($b.FullName)
    $inv = [MacroStudio.BookInventoryReader]::Read($b.FullName, $bytes, $project)
    $doubt = $project.HasSourceDoubt()
    $level = if (-not $project.HasReadWarnings) { 'clean' }
             elseif ($doubt) { 'sourceDoubt' } else { 'structureOnly' }
    $rows += [pscustomobject]@{
        Book        = $b.Name
        Modules     = $project.Modules.Count
        Lines       = ($project.Modules | ForEach-Object {
                          ($_.Code -split "`r`n").Count } | Measure-Object -Sum).Sum
        ReadLevel   = $level
        References  = ($inv.References -join ',')
        PowerQuery  = $inv.HasPowerQuery
        ExtLinks    = $inv.ExternalLinkCount
        ActiveX     = $inv.ActiveXCount
        Barcode     = ($inv.BarcodeFonts -join ',')
        VbaSigned   = $inv.HasVbaSignature
        Complete    = $inv.Complete
    }
}
$rows | Format-Table -AutoSize | Out-String -Width 250
