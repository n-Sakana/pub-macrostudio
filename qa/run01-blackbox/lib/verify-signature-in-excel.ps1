param(
    [string]$Repo,
    [string]$OutDir
)

# SIG-01, measured in the real Excel rather than in the product's own
# readers.
#
# The product now removes the VBA signature parts from a build's output,
# because the build rewrote the thing the signature signed. Removing a
# part also means removing the relationship that pointed at it and the
# content-type override that declared it - get that wrong and the result
# is not "an unsigned workbook", it is a package Excel refuses to open.
#
# The product checking its own output proves the product agrees with
# itself. This opens the file in Excel instead, which is the only thing
# whose opinion decides whether the workbook is usable.
#
# Nothing here needs a certificate: the question is whether the OUTPUT is
# a sound workbook, and the output is unsigned by design.
#
# If you DO reach for a certificate to extend this, know two things that
# cost this session time:
#
#  1. There is no object model for signing a VBA project. VBProject has
#     no signing member, Workbook.Signatures is document signatures and
#     not this, and the VBE "Digital Signature" command is a modal dialog
#     with no CommandBars entry until the VBE window has been shown. A
#     genuinely signed fixture has to be made by hand, once, and kept.
#  2. New-SelfSignedCertificate puts a self-signed certificate in TWO
#     stores: Cert:\CurrentUser\My AND Cert:\CurrentUser\CA, because a
#     self-signed certificate is its own issuer. Cleaning up only \My
#     leaves the other copy behind. Remove by thumbprint from both, then
#     verify by counting every store against what you recorded first.
#
#   powershell.exe -NoProfile -ExecutionPolicy Bypass `
#       -File qa\run01-blackbox\lib\verify-signature-in-excel.ps1

$ErrorActionPreference = 'Stop'

if ([string]::IsNullOrEmpty($Repo)) {
    $Repo = (Resolve-Path -LiteralPath (
        Join-Path $PSScriptRoot '..\..\..')).Path
}
if ([string]::IsNullOrEmpty($OutDir)) {
    $OutDir = Join-Path $Repo 'testdata'
}
if (-not [IO.Directory]::Exists($OutDir)) {
    [void][IO.Directory]::CreateDirectory($OutDir)
}
$OutDir = (Resolve-Path -LiteralPath $OutDir).Path

function Assert-True {
    param([bool]$Condition, [string]$Message)
    if (-not $Condition) { throw $Message }
}

function Get-EngineSource {
    $names = @('05_Ole2.cs', '06_VbaCompression.cs', '07_VbaProject.cs',
        '08_BookIO.cs', '09_BookInventory.cs')
    $combined = ($names | ForEach-Object {
        [IO.File]::ReadAllText(
            (Resolve-Path -LiteralPath (Join-Path (Join-Path $Repo 'src') $_)),
            [Text.Encoding]::UTF8)
    }) -join "`n"
    $pattern = '(?m)^\s*using\s+[\w][\w.]*\s*;'
    $usings = [regex]::Matches($combined, $pattern) |
        ForEach-Object { $_.Value.Trim() } | Sort-Object -Unique
    return ($usings -join "`n") + "`n`n" + ($combined -replace $pattern, '')
}

$source = Join-Path $OutDir 'test_large.xlsm'
Assert-True ([IO.File]::Exists($source)) `
    ('Run tests\make-testdata.ps1 first. Missing: ' + $source)

$signed = Join-Path $OutDir 'sig-excel-signed.xlsm'
$output = Join-Path $OutDir 'sig-excel-output.xlsm'
$plainOutput = Join-Path $OutDir 'sig-excel-plain.xlsm'

Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
Add-Type -TypeDefinition (Get-EngineSource) `
    -ReferencedAssemblies @(
        'System.IO.Compression', 'System.IO.Compression.FileSystem') `
    -Language CSharp

# ------------------------------------------------------------------
# Build a workbook carrying the three signature parts Office can write,
# each with its relationship and content-type override.
# ------------------------------------------------------------------
$kinds = @(
    @{ Part = 'xl/vbaProjectSignature.bin'
       Rel = 'http://schemas.microsoft.com/office/2006/relationships/vbaProjectSignature'
       Type = 'application/vnd.ms-office.vbaProjectSignature' },
    @{ Part = 'xl/vbaProjectSignatureAgile.bin'
       Rel = 'http://schemas.microsoft.com/office/2014/relationships/vbaProjectSignatureAgile'
       Type = 'application/vnd.ms-office.vbaProjectSignatureAgile' },
    @{ Part = 'xl/vbaProjectSignatureV3.bin'
       Rel = 'http://schemas.microsoft.com/office/2020/relationships/vbaProjectSignatureV3'
       Type = 'application/vnd.ms-office.vbaProjectSignatureV3' }
)

[IO.File]::Copy($source, $signed, $true)
$file = [IO.File]::Open($signed, [IO.FileMode]::Open, [IO.FileAccess]::ReadWrite)
try {
    $zip = New-Object IO.Compression.ZipArchive(
        $file, [IO.Compression.ZipArchiveMode]::Update, $false)
    try {
        $rels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
            '<Relationships xmlns="http://schemas.openxmlformats.org/' +
            'package/2006/relationships">'
        $n = 0
        foreach ($k in $kinds) {
            $n++
            $rels += '<Relationship Id="rId' + $n + '" Type="' + $k.Rel +
                '" Target="' + [IO.Path]::GetFileName($k.Part) + '"/>'
            $entry = $zip.CreateEntry($k.Part)
            $s = $entry.Open()
            try {
                $blob = [Text.Encoding]::ASCII.GetBytes('SIG-' + $k.Type)
                $s.Write($blob, 0, $blob.Length)
            } finally { $s.Dispose() }
        }
        $rels += '</Relationships>'
        $entry = $zip.CreateEntry('xl/_rels/vbaProject.bin.rels')
        $w = New-Object IO.StreamWriter(
            $entry.Open(), (New-Object Text.UTF8Encoding($false)))
        try { $w.Write($rels) } finally { $w.Dispose() }

        $types = $zip.Entries | Where-Object {
            $_.FullName -eq '[Content_Types].xml' } | Select-Object -First 1
        $r = New-Object IO.StreamReader($types.Open())
        try { $xml = $r.ReadToEnd() } finally { $r.Dispose() }
        $add = ''
        foreach ($k in $kinds) {
            $add += '<Override PartName="/' + $k.Part + '" ContentType="' +
                $k.Type + '"/>'
        }
        $xml = $xml.Replace('</Types>', $add + '</Types>')
        $s = $types.Open()
        try {
            $s.SetLength(0)
            $b = (New-Object Text.UTF8Encoding($false)).GetBytes($xml)
            $s.Write($b, 0, $b.Length)
        } finally { $s.Dispose() }
    } finally { $zip.Dispose() }
} finally { $file.Dispose() }

$project = [MacroStudio.BookIO]::ReadProject($signed)
$inventory = [MacroStudio.BookInventoryReader]::Read(
    $signed, [IO.File]::ReadAllBytes($signed), $project)
Assert-True $inventory.HasVbaSignature 'The fixture is not seen as signed.'

$target = 'AppController'
$changes = New-Object 'System.Collections.Generic.Dictionary[string,string]'
$changes.Add($target,
    "Option Explicit`r`nPublic Sub SigCheck()`r`n" +
    "  Debug.Print 1`r`nEnd Sub`r`n")
$additions = New-Object `
    'System.Collections.Generic.List[MacroStudio.VbaModuleAddition]'

if ([IO.File]::Exists($output)) { [IO.File]::Delete($output) }
$build = [MacroStudio.BookIO]::BuildCopy($signed, $output, $changes, $additions)
Assert-True $build.Success ('Build failed: ' + $build.Message)
Assert-True $build.SignatureRemoved 'The build did not report a removal.'

if ([IO.File]::Exists($plainOutput)) { [IO.File]::Delete($plainOutput) }
$plain = [MacroStudio.BookIO]::BuildCopy(
    $source, $plainOutput, $changes, $additions)
Assert-True $plain.Success ('Unsigned build failed: ' + $plain.Message)
Assert-True (-not $plain.SignatureRemoved) `
    'An unsigned workbook reported a removal.'

Write-Output ('built from signed  : ' + $output)
Write-Output ('built from unsigned: ' + $plainOutput)

# ------------------------------------------------------------------
# Now ask Excel.
# ------------------------------------------------------------------
$existing = @{}
foreach ($p in @(Get-Process -Name EXCEL -ErrorAction SilentlyContinue)) {
    $existing[$p.Id] = $true
}

$excel = New-Object -ComObject Excel.Application
$results = @()
try {
    $excel.Visible = $false
    $excel.DisplayAlerts = $false
    $excel.EnableEvents = $false
    $excel.AutomationSecurity = 1
    $excel.ScreenUpdating = $false

    foreach ($path in @($output, $plainOutput, $signed)) {
        $wb = $null
        $row = @{ Path = [IO.Path]::GetFileName($path) }
        try {
            $wb = $excel.Workbooks.Open($path, 0, $false)
            $row.Opened = $true
            $row.Sheets = $wb.Worksheets.Count
            try {
                $row.Components = $wb.VBProject.VBComponents.Count
                $names = @()
                foreach ($c in $wb.VBProject.VBComponents) { $names += $c.Name }
                $row.Names = ($names | Sort-Object) -join ','
                $module = $wb.VBProject.VBComponents.Item($target)
                $row.Code = $module.CodeModule.Lines(
                    1, $module.CodeModule.CountOfLines).Trim()
            } catch {
                $row.Components = -1
                $row.Names = 'VBProject unavailable: ' + $_.Exception.Message
            }
            # VBASigned is Excel's own answer to "is this signed".
            try { $row.VbaSigned = $wb.VBASigned } catch { $row.VbaSigned = 'n/a' }
        } catch {
            $row.Opened = $false
            $row.Error = $_.Exception.Message
        } finally {
            if ($null -ne $wb) {
                try { $wb.Close($false) } catch { }
                [void][Runtime.InteropServices.Marshal]::ReleaseComObject($wb)
            }
        }
        $results += New-Object psobject -Property $row
    }
} finally {
    if ($null -ne $excel) {
        try { $excel.Quit() } catch { }
        [void][Runtime.InteropServices.Marshal]::ReleaseComObject($excel)
    }
    [GC]::Collect(); [GC]::WaitForPendingFinalizers(); [GC]::Collect()
    foreach ($p in @(Get-Process -Name EXCEL -ErrorAction SilentlyContinue)) {
        if (-not $existing.ContainsKey($p.Id)) {
            try { Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue } catch { }
        }
    }
}

Write-Output ''
Write-Output '=== Excel opened these files ==='
foreach ($r in $results) {
    Write-Output ('{0,-26} opened={1} sheets={2} components={3} vbaSigned={4}' -f `
        $r.Path, $r.Opened, $r.Sheets, $r.Components, $r.VbaSigned)
    if ($r.Names) { Write-Output ('    modules: ' + $r.Names) }
    if ($r.Code) { Write-Output ('    code   : ' + ($r.Code -replace "`r`n", ' / ')) }
    if ($r.Error) { Write-Output ('    error  : ' + $r.Error) }
}

$built = $results | Where-Object { $_.Path -eq 'sig-excel-output.xlsm' }
Assert-True $built.Opened `
    ('Excel could not open the workbook built from a signed source: ' +
     $built.Error)
Assert-True ($built.Components -gt 0) `
    'Excel opened the built workbook but could not read its VBA project.'
Assert-True ($built.VbaSigned -eq $false) `
    ('Excel still reports the built workbook as signed: ' + $built.VbaSigned)
Assert-True ($built.Code -like '*SigCheck*') `
    'The change this build made is not in the workbook Excel opened.'

Write-Output ''
Write-Output 'verify-signature-in-excel: OK'
