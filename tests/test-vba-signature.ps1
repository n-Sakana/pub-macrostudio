param(
    [string]$BookPath,
    [string]$SignedBookPath
)

# A code signature signs the VBA project. A build rewrites the VBA
# project. So a signature that rides along into the output is guaranteed
# not to match what it is attached to - and "this file is signed" is
# exactly the claim someone uses to decide it is safe to run. Recorded as
# SIG-01.
#
# The output used to be a copy of the source with only vbaProject.bin
# swapped, which is right for every other part and wrong for this one.
#
# Three things are checked here, and the third is the one that bites:
#
#   the signature part is gone
#   the relationship and the content-type override that named it are gone
#     too - a relationship pointing at a part that does not exist is a
#     malformed package, so removing only the .bin would trade a broken
#     signature for a workbook Excel refuses to open
#   the package still opens and still reads, and every part that has
#     nothing to do with the signature is byte-for-byte what it was
#
# An unsigned workbook must come through completely unchanged: this whole
# path is invisible unless there was something to remove.
#
# -SignedBookPath points the same checks at a workbook signed by a real
# certificate, when one is available. Without it the signature parts are
# assembled here exactly as Office writes them (part, relationship,
# content-type override), which is what the removal code reads.

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

function Get-EngineSource {
    $names = @(
        '05_Ole2.cs',
        '06_VbaCompression.cs',
        '07_VbaProject.cs',
        '08_BookIO.cs',
        '09_BookInventory.cs'
    )
    $combined = ($names | ForEach-Object {
        $path = Join-Path (Join-Path $PSScriptRoot '..\src') $_
        [IO.File]::ReadAllText(
            (Resolve-Path -LiteralPath $path),
            [Text.Encoding]::UTF8)
    }) -join "`n"

    $usingPattern = '(?m)^\s*using\s+[\w][\w.]*\s*;'
    $usings = [regex]::Matches($combined, $usingPattern) |
        ForEach-Object { $_.Value.Trim() } |
        Sort-Object -Unique
    $body = $combined -replace $usingPattern, ''
    return ($usings -join "`n") + "`n`n" + $body
}

if ([string]::IsNullOrEmpty($BookPath)) {
    $BookPath = Join-Path $PSScriptRoot '..\testdata\test_large.xlsm'
}
if (-not (Test-Path -LiteralPath $BookPath -PathType Leaf)) {
    throw "Workbook fixture was not found: $BookPath. " +
        'Run tests\make-testdata.ps1 first.'
}
$BookPath = (Resolve-Path -LiteralPath $BookPath).Path

$testdataRoot = (Resolve-Path (
    Join-Path $PSScriptRoot '..\testdata')).Path
$suffix = [Guid]::NewGuid().ToString('N').Substring(0, 8)

function New-ScratchPath {
    param([string]$Name)

    $path = Join-Path $testdataRoot $Name
    Assert-True (
        $path.StartsWith(
            $testdataRoot + [IO.Path]::DirectorySeparatorChar,
            [StringComparison]::OrdinalIgnoreCase)) `
        'Temporary test path is outside testdata.'
    return $path
}

Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
Add-Type -TypeDefinition (Get-EngineSource) `
    -ReferencedAssemblies @(
        'System.IO.Compression',
        'System.IO.Compression.FileSystem') `
    -Language CSharp

# ------------------------------------------------------------------
# Package helpers
# ------------------------------------------------------------------
function Get-PartNames {
    param([string]$Path)

    $names = New-Object System.Collections.ArrayList
    $archive = [IO.Compression.ZipFile]::OpenRead($Path)
    try {
        foreach ($entry in $archive.Entries) {
            [void]$names.Add($entry.FullName.Replace('\', '/'))
        }
    } finally {
        $archive.Dispose()
    }
    return @($names)
}

function Get-PartBytes {
    param(
        [string]$Path,
        [string]$Name
    )

    $archive = [IO.Compression.ZipFile]::OpenRead($Path)
    try {
        foreach ($entry in $archive.Entries) {
            if ($entry.FullName.Replace('\', '/') -eq $Name) {
                $buffer = New-Object System.IO.MemoryStream
                $stream = $entry.Open()
                try {
                    $stream.CopyTo($buffer)
                } finally {
                    $stream.Dispose()
                }
                return $buffer.ToArray()
            }
        }
    } finally {
        $archive.Dispose()
    }
    return $null
}

function Get-PartText {
    param(
        [string]$Path,
        [string]$Name
    )

    $bytes = Get-PartBytes $Path $Name
    if ($null -eq $bytes) {
        return $null
    }
    return [Text.Encoding]::UTF8.GetString($bytes)
}

function Get-Sha256 {
    param([byte[]]$Bytes)

    $sha = [Security.Cryptography.SHA256]::Create()
    try {
        return ([BitConverter]::ToString($sha.ComputeHash($Bytes))).Replace(
            '-', '').ToLowerInvariant()
    } finally {
        $sha.Dispose()
    }
}

# The three signature parts Office can write, with the relationship type
# and content type that belong to each. All three are recognised by the
# same marker in the part name, which is what BookIO matches on.
$signatureKinds = @(
    @{
        Part = 'xl/vbaProjectSignature.bin'
        RelType = 'http://schemas.microsoft.com/office/2006/relationships/vbaProjectSignature'
        ContentType = 'application/vnd.ms-office.vbaProjectSignature'
    },
    @{
        Part = 'xl/vbaProjectSignatureAgile.bin'
        RelType = 'http://schemas.microsoft.com/office/2014/relationships/vbaProjectSignatureAgile'
        ContentType = 'application/vnd.ms-office.vbaProjectSignatureAgile'
    },
    @{
        Part = 'xl/vbaProjectSignatureV3.bin'
        RelType = 'http://schemas.microsoft.com/office/2020/relationships/vbaProjectSignatureV3'
        ContentType = 'application/vnd.ms-office.vbaProjectSignatureV3'
    }
)

function New-SignedCopy {
    param(
        [string]$Source,
        [string]$Target
    )

    [IO.File]::Copy($Source, $Target, $true)

    $relsXml =
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' + "`r`n" +
        '<Relationships xmlns="http://schemas.openxmlformats.org/' +
        'package/2006/relationships">'
    $index = 0
    foreach ($kind in $signatureKinds) {
        $index++
        $relsXml += '<Relationship Id="rId' + $index + '" Type="' +
            $kind.RelType + '" Target="' +
            [IO.Path]::GetFileName($kind.Part) + '"/>'
    }
    $relsXml += '</Relationships>'

    $file = [IO.File]::Open(
        $Target, [IO.FileMode]::Open, [IO.FileAccess]::ReadWrite)
    try {
        $archive = New-Object IO.Compression.ZipArchive(
            $file, [IO.Compression.ZipArchiveMode]::Update, $false)
        try {
            foreach ($kind in $signatureKinds) {
                $entry = $archive.CreateEntry($kind.Part)
                $stream = $entry.Open()
                try {
                    # A signature blob is opaque to this tool; what
                    # matters is that a part is there under that name.
                    $blob = [Text.Encoding]::ASCII.GetBytes(
                        'SIGNATURE-BLOB-' + $kind.ContentType)
                    $stream.Write($blob, 0, $blob.Length)
                } finally {
                    $stream.Dispose()
                }
            }

            $entry = $archive.CreateEntry('xl/_rels/vbaProject.bin.rels')
            $writer = New-Object IO.StreamWriter(
                $entry.Open(), (New-Object Text.UTF8Encoding($false)))
            try {
                $writer.Write($relsXml)
            } finally {
                $writer.Dispose()
            }

            $types = $null
            foreach ($candidate in $archive.Entries) {
                if ($candidate.FullName -eq '[Content_Types].xml') {
                    $types = $candidate
                    break
                }
            }
            Assert-True ($null -ne $types) 'The package has no content types.'
            $reader = New-Object IO.StreamReader($types.Open())
            try {
                $xml = $reader.ReadToEnd()
            } finally {
                $reader.Dispose()
            }
            $overrides = ''
            foreach ($kind in $signatureKinds) {
                $overrides += '<Override PartName="/' + $kind.Part +
                    '" ContentType="' + $kind.ContentType + '"/>'
            }
            $xml = $xml.Replace('</Types>', $overrides + '</Types>')
            $stream = $types.Open()
            try {
                $stream.SetLength(0)
                $bytes = (New-Object Text.UTF8Encoding($false)).GetBytes($xml)
                $stream.Write($bytes, 0, $bytes.Length)
            } finally {
                $stream.Dispose()
            }
        } finally {
            $archive.Dispose()
        }
    } finally {
        $file.Dispose()
    }
}

# ------------------------------------------------------------------
# 1. A signed workbook comes out unsigned, and still opens
# ------------------------------------------------------------------
$signedPath = New-ScratchPath ("sig-signed-$suffix.xlsm")
$signedOutput = New-ScratchPath ("sig-signed-out-$suffix.xlsm")
$plainOutput = New-ScratchPath ("sig-plain-out-$suffix.xlsm")
$created = @($signedPath, $signedOutput, $plainOutput)

try {
    if ([string]::IsNullOrEmpty($SignedBookPath)) {
        New-SignedCopy $BookPath $signedPath
        $signedOrigin = 'assembled from the parts Office writes'
    } else {
        [IO.File]::Copy(
            (Resolve-Path -LiteralPath $SignedBookPath).Path,
            $signedPath,
            $true)
        $signedOrigin = 'a workbook signed by a real certificate'
    }

    $before = Get-PartNames $signedPath
    Assert-True (
        @($before | Where-Object { $_ -like '*vbaProjectSignature*' }).Count `
            -gt 0) `
        'The fixture carries no signature part, so nothing would be proven.'

    # The product must see it, or it could never warn about it.
    $bytes = [IO.File]::ReadAllBytes($signedPath)
    $project = [MacroStudio.BookIO]::ReadProject($signedPath)
    $inventory = [MacroStudio.BookInventoryReader]::Read(
        $signedPath, $bytes, $project)
    Assert-True $inventory.HasVbaSignature `
        'A signed workbook must be reported as signed.'

    $moduleName = $project.Modules[$project.Modules.Count - 1].Name
    $changes = New-Object 'System.Collections.Generic.Dictionary[string,string]'
    $changes.Add($moduleName, "Option Explicit`r`nPublic Sub Signed()`r`nEnd Sub`r`n")
    $additions = New-Object `
        'System.Collections.Generic.List[MacroStudio.VbaModuleAddition]'

    # The 4-argument overload is the one that does not compare against a
    # recorded source signature; passing $null for it from PowerShell
    # binds as an empty string and trips E-BUILD-04.
    $build = [MacroStudio.BookIO]::BuildCopy(
        $signedPath, $signedOutput, $changes, $additions)
    Assert-True $build.Success ('The build failed: ' + $build.Message)
    Assert-True $build.SignatureRemoved `
        'The build must report that it removed a signature.'

    # -- the part is gone --
    $after = Get-PartNames $signedOutput
    Assert-True (
        @($after | Where-Object { $_ -like '*vbaProjectSignature*' }).Count `
            -eq 0) `
        ('A signature part survived into the output: ' +
         (@($after | Where-Object { $_ -like '*vbaProjectSignature*' }) -join ', '))

    # -- so is everything that named it --
    $rels = Get-PartText $signedOutput 'xl/_rels/vbaProject.bin.rels'
    Assert-True (
        $null -eq $rels -or
        $rels.IndexOf('vbaProjectSignature',
            [StringComparison]::OrdinalIgnoreCase) -lt 0) `
        'A relationship still points at a signature part that is gone.'
    $types = Get-PartText $signedOutput '[Content_Types].xml'
    Assert-True ($null -ne $types) 'The output has no content types.'
    Assert-True (
        $types.IndexOf('vbaProjectSignature',
            [StringComparison]::OrdinalIgnoreCase) -lt 0) `
        'A content-type override still names a signature part.'
    # Removing elements must not have damaged the rest of the document.
    Assert-True ($types.IndexOf('</Types>') -gt 0) `
        'The content types are no longer a well-formed document.'
    Assert-True (
        $types.IndexOf('/xl/workbook.xml') -gt 0) `
        'An unrelated content-type override was removed as well.'

    # -- and the package still reads --
    $outputProject = [MacroStudio.BookIO]::ReadProject($signedOutput)
    Assert-True (
        $outputProject.Modules.Count -eq $project.Modules.Count) `
        'The output no longer reads as the same set of modules.'
    $outputBytes = [IO.File]::ReadAllBytes($signedOutput)
    $outputInventory = [MacroStudio.BookInventoryReader]::Read(
        $signedOutput, $outputBytes, $outputProject)
    Assert-True (-not $outputInventory.HasVbaSignature) `
        'The output still claims to be signed.'
    Assert-True $outputInventory.Complete `
        'The output package could not be read completely.'

    # -- parts with nothing to do with the signature are untouched --
    $shared = @($before | Where-Object {
        $_ -notlike '*vbaProjectSignature*' -and
        $_ -ne 'xl/vbaProject.bin' -and
        $_ -ne '[Content_Types].xml' -and
        $_ -ne 'xl/_rels/vbaProject.bin.rels'
    })
    Assert-True ($shared.Count -gt 0) 'There is nothing left to compare.'
    foreach ($name in $shared) {
        $sourceHash = Get-Sha256 (Get-PartBytes $signedPath $name)
        $outputPart = Get-PartBytes $signedOutput $name
        Assert-True ($null -ne $outputPart) `
            ('A part disappeared from the output: ' + $name)
        Assert-True ($sourceHash -ceq (Get-Sha256 $outputPart)) `
            ('A part unrelated to the signature changed: ' + $name)
    }

    # ------------------------------------------------------------------
    # 2. An unsigned workbook is not touched by any of this
    # ------------------------------------------------------------------
    $plainProject = [MacroStudio.BookIO]::ReadProject($BookPath)
    $plainName = $plainProject.Modules[$plainProject.Modules.Count - 1].Name
    $plainChanges = New-Object `
        'System.Collections.Generic.Dictionary[string,string]'
    $plainChanges.Add(
        $plainName, "Option Explicit`r`nPublic Sub Plain()`r`nEnd Sub`r`n")
    $plainBuild = [MacroStudio.BookIO]::BuildCopy(
        $BookPath, $plainOutput, $plainChanges, $additions)
    Assert-True $plainBuild.Success `
        ('The unsigned build failed: ' + $plainBuild.Message)
    Assert-True (-not $plainBuild.SignatureRemoved) `
        'An unsigned workbook must not report a removed signature.'

    $plainTypesBefore = Get-PartText $BookPath '[Content_Types].xml'
    $plainTypesAfter = Get-PartText $plainOutput '[Content_Types].xml'
    Assert-True ($plainTypesBefore -ceq $plainTypesAfter) `
        'The content types of an unsigned workbook were rewritten.'
    foreach ($name in (Get-PartNames $BookPath)) {
        if ($name -eq 'xl/vbaProject.bin') {
            continue
        }
        $sourceHash = Get-Sha256 (Get-PartBytes $BookPath $name)
        $outputPart = Get-PartBytes $plainOutput $name
        Assert-True ($null -ne $outputPart) `
            ('A part disappeared from the unsigned output: ' + $name)
        Assert-True ($sourceHash -ceq (Get-Sha256 $outputPart)) `
            ('An unsigned workbook had a part changed: ' + $name)
    }

    Write-Output 'test-vba-signature: PASS'
    Write-Output ('signed fixture: ' + $signedOrigin)
    Write-Output (
        'removed={0}, parts before={1}, after={2}, untouched compared={3}' -f `
        $build.SignatureRemoved,
        $before.Count,
        $after.Count,
        $shared.Count)
} finally {
    foreach ($path in $created) {
        if ([IO.File]::Exists($path)) {
            [IO.File]::Delete($path)
        }
    }
}
