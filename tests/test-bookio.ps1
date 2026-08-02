param(
    [string]$BookPath
)

$ErrorActionPreference = 'Stop'

if ([string]::IsNullOrEmpty($BookPath)) {
    $BookPath = Join-Path $PSScriptRoot '..\testdata\test_large.xlsm'
}

function Assert-True {
    param(
        [bool]$Condition,
        [string]$Message
    )

    if (-not $Condition) {
        throw $Message
    }
}

function Assert-ErrorCode {
    param(
        [ScriptBlock]$Action,
        [string]$ExpectedCode
    )

    $actualCode = ''
    try {
        & $Action
    } catch [MacroStudio.MacroStudioException] {
        $actualCode = $_.Exception.ErrorCode
    }

    Assert-True ($actualCode -eq $ExpectedCode) `
        "Expected $ExpectedCode, got $actualCode."
}

function Get-EngineSource {
    $names = @(
        '05_Ole2.cs',
        '06_VbaCompression.cs',
        '07_VbaProject.cs',
        '08_BookIO.cs'
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

function New-ZipWithEntry {
    param(
        [string]$Path,
        [string]$EntryName,
        [byte[]]$Content
    )

    $archive = [IO.Compression.ZipFile]::Open(
        $Path,
        [IO.Compression.ZipArchiveMode]::Create)
    try {
        $entry = $archive.CreateEntry($EntryName)
        $stream = $entry.Open()
        try {
            $stream.Write($Content, 0, $Content.Length)
        } finally {
            $stream.Dispose()
        }
    } finally {
        $archive.Dispose()
    }
}

Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
$references = @(
    'System.IO.Compression',
    'System.IO.Compression.FileSystem'
)
Add-Type -TypeDefinition (Get-EngineSource) `
    -ReferencedAssemblies $references `
    -Language CSharp

$resolvedBookPath = (Resolve-Path -LiteralPath $BookPath).Path
$content = [MacroStudio.BookIO]::ReadVbaProjectBytes($resolvedBookPath)
Assert-True $content.IsZip 'Workbook was not marked as ZIP.'
Assert-True ($content.Extension -eq '.xlsm') 'Workbook extension mismatch.'

# What the reader owes is the part itself, not a particular size. This
# used to assert 17,920 bytes, which is a property of the one workbook
# that happened to be on one machine - and since testdata\ is not in the
# repository, no rebuilt fixture could ever satisfy it (ENV-01). Reading
# the entry straight out of the package says the same thing without
# memorising anything: hand back exactly what the file holds.
$expectedProjectBytes = $null
$readArchive = [IO.Compression.ZipFile]::OpenRead($resolvedBookPath)
try {
    foreach ($entry in $readArchive.Entries) {
        if ($entry.Name -ieq 'vbaProject.bin') {
            $stream = $entry.Open()
            try {
                $buffer = New-Object System.IO.MemoryStream
                $stream.CopyTo($buffer)
                $expectedProjectBytes = $buffer.ToArray()
                $buffer.Dispose()
            } finally {
                $stream.Dispose()
            }
            break
        }
    }
} finally {
    $readArchive.Dispose()
}
Assert-True ($null -ne $expectedProjectBytes) `
    'The package holds no vbaProject.bin.'
Assert-True ($content.VbaProjectBytes.Length -eq $expectedProjectBytes.Length) `
    ('vbaProject.bin length differs from the package: reader ' +
     $content.VbaProjectBytes.Length + ', package ' +
     $expectedProjectBytes.Length)
$sameBytes = $true
for ($index = 0; $index -lt $expectedProjectBytes.Length; $index++) {
    if ($content.VbaProjectBytes[$index] -ne $expectedProjectBytes[$index]) {
        $sameBytes = $false
        break
    }
}
Assert-True $sameBytes 'vbaProject.bin bytes differ from the package.'

$project = [MacroStudio.BookIO]::ReadProject($resolvedBookPath)
Assert-True ($project.Modules.Count -gt 0) `
    'The project has no modules.'
Assert-True ($project.FilePath -eq $resolvedBookPath) `
    'Project file path mismatch.'

$exclusive = [IO.File]::Open(
    $resolvedBookPath,
    [IO.FileMode]::Open,
    [IO.FileAccess]::Read,
    [IO.FileShare]::None)
$exclusive.Dispose()

$testdataPath = (Resolve-Path (
    Join-Path $PSScriptRoot '..\testdata')).Path
$suffix = [Guid]::NewGuid().ToString('N')
$nestedPath = Join-Path $testdataPath ("bookio-nested-$suffix.xlam")
$emptyPath = Join-Path $testdataPath ("bookio-empty-$suffix.xlsm")
$invalidXlsbPath = Join-Path $testdataPath ("bookio-invalid-$suffix.xlsb")
$missingPath = Join-Path $testdataPath ("bookio-missing-$suffix.xlsm")
$caseNamePath = Join-Path $testdataPath ("bookio-case-$suffix.xlsm")
$unknownExtPath = Join-Path $testdataPath ("bookio-ext-$suffix.dat")
$brokenDirectoryPath = Join-Path $testdataPath (
    "bookio-broken-dir-$suffix.xlsm")
$blindDirectoryPath = Join-Path $testdataPath (
    "bookio-blind-dir-$suffix.xlsm")
$olePath = Join-Path $testdataPath ("bookio-ole-$suffix.xls")
$zeroBytePath = Join-Path $testdataPath ("bookio-zero-$suffix.xlsm")
$spoofedPath = Join-Path $testdataPath ("bookio-spoofed-$suffix.xlsm")

foreach ($path in @(
    $nestedPath,
    $emptyPath,
    $invalidXlsbPath,
    $missingPath,
    $caseNamePath,
    $unknownExtPath,
    $brokenDirectoryPath,
    $blindDirectoryPath,
    $olePath)) {
    $fullPath = [IO.Path]::GetFullPath($path)
    Assert-True (
        $fullPath.StartsWith(
            $testdataPath + [IO.Path]::DirectorySeparatorChar,
            [StringComparison]::OrdinalIgnoreCase)) `
        'Temporary test path is outside testdata.'
}

try {
    New-ZipWithEntry `
        $nestedPath `
        'custom/location/vbaProject.bin' `
        $content.VbaProjectBytes
    $nested = [MacroStudio.BookIO]::ReadVbaProjectBytes($nestedPath)
    Assert-True (
        $nested.VbaProjectBytes.Length -eq
        $content.VbaProjectBytes.Length) `
        'Name-only ZIP lookup returned the wrong data.'
    $nestedProject = [MacroStudio.BookIO]::ReadProject($nestedPath)
    Assert-True ($nestedProject.Modules.Count -eq 6) `
        '.xlam project extraction failed.'

    [byte[]]$dummy = 0x41
    New-ZipWithEntry $emptyPath 'custom/location/dummy.txt' $dummy
    Assert-ErrorCode {
        [MacroStudio.BookIO]::ReadVbaProjectBytes($emptyPath)
    } 'E-ATTACH-03'

    # The case above is a container that WAS read and holds no VBA, which is
    # what SPEC 13.4 reserves E-ATTACH-03 for. A file that never read as a
    # container must not borrow that code: a zero-byte file and a renamed
    # text file are not workbooks we opened and found empty, and calling
    # them "a workbook with no macros" asserts something never established.
    [IO.File]::WriteAllBytes($zeroBytePath, (New-Object 'byte[]' 0))
    Assert-ErrorCode {
        [MacroStudio.BookIO]::ReadVbaProjectBytes($zeroBytePath)
    } 'E-ATTACH-02'

    [IO.File]::WriteAllText(
        $spoofedPath,
        'This is plain text pretending to be a workbook.')
    Assert-ErrorCode {
        [MacroStudio.BookIO]::ReadVbaProjectBytes($spoofedPath)
    } 'E-ATTACH-02'

    # Unreadable VBA data is a warning, not a blocked attach.
    New-ZipWithEntry `
        $invalidXlsbPath `
        'custom/location/vbaProject.bin' `
        $dummy
    $invalidXlsb = [MacroStudio.BookIO]::ReadProject($invalidXlsbPath)
    Assert-True $invalidXlsb.HasReadWarnings `
        'Invalid xlsb VBA data did not produce a read warning.'
    Assert-True ($invalidXlsb.Modules.Count -eq 0) `
        'Invalid xlsb VBA data returned an invented module.'

    # A ZIP entry whose name differs only in case must still be found.
    New-ZipWithEntry `
        $caseNamePath `
        'xl/VBAPROJECT.BIN' `
        $content.VbaProjectBytes
    $caseProject = [MacroStudio.BookIO]::ReadProject($caseNamePath)
    Assert-True ($caseProject.Modules.Count -eq $project.Modules.Count) `
        'A case-variant vbaProject.bin name lost modules.'
    Assert-True ($caseProject.VbaEntryName.Length -gt 0) `
        'The ZIP entry name was not recorded.'

    # The extension does not decide the container kind.
    New-ZipWithEntry `
        $unknownExtPath `
        'xl/vbaProject.bin' `
        $content.VbaProjectBytes
    $unknownExtProject = [MacroStudio.BookIO]::ReadProject($unknownExtPath)
    Assert-True (
        $unknownExtProject.Modules.Count -eq $project.Modules.Count) `
        'An unfamiliar extension blocked a readable workbook.'

    # A destroyed central directory must not lose the VBA project.
    [byte[]]$brokenBytes = [IO.File]::ReadAllBytes($resolvedBookPath)
    for ($index = 0; $index -lt $brokenBytes.Length - 3; $index++) {
        if ($brokenBytes[$index] -eq 0x50 -and
            $brokenBytes[$index + 1] -eq 0x4B -and
            $brokenBytes[$index + 2] -eq 0x05 -and
            $brokenBytes[$index + 3] -eq 0x06) {
            $brokenBytes[$index + 2] = 0x00
            $brokenBytes[$index + 3] = 0x00
        }
    }
    [IO.File]::WriteAllBytes($brokenDirectoryPath, $brokenBytes)
    $brokenProject = [MacroStudio.BookIO]::ReadProject($brokenDirectoryPath)
    Assert-True $brokenProject.HasReadWarnings `
        'A broken ZIP directory did not produce a read warning.'
    Assert-True (
        $brokenProject.Modules.Count -eq $project.Modules.Count) `
        'A broken ZIP directory lost readable modules.'
    for ($index = 0; $index -lt $project.Modules.Count; $index++) {
        Assert-True (
            $brokenProject.Modules[$index].FullCode -ceq
            $project.Modules[$index].FullCode) `
            "Broken-directory VBA source changed at $index."
    }

    # An OLE2 container whose directory cannot be read at all still
    # yields its VBA source through the raw salvage scan.
    [byte[]]$blindBytes = New-Object byte[] (
        $content.VbaProjectBytes.Length)
    [Buffer]::BlockCopy(
        $content.VbaProjectBytes,
        0,
        $blindBytes,
        0,
        $blindBytes.Length)
    [Buffer]::BlockCopy(
        [BitConverter]::GetBytes([int](-1)),
        0,
        $blindBytes,
        48,
        4)
    New-ZipWithEntry $blindDirectoryPath 'xl/vbaProject.bin' $blindBytes
    $blindProject = [MacroStudio.BookIO]::ReadProject($blindDirectoryPath)
    Assert-True $blindProject.HasReadWarnings `
        'An unreadable OLE2 directory did not produce a warning.'
    Assert-True ($blindProject.Modules.Count -eq $project.Modules.Count) `
        'An unreadable OLE2 directory lost every module.'
    foreach ($sourceModule in $project.Modules) {
        $recovered = $blindProject.Modules |
            Where-Object { $_.Name -eq $sourceModule.Name } |
            Select-Object -First 1
        Assert-True (
            $null -ne $recovered -and
            $recovered.FullCode -ceq $sourceModule.FullCode) `
            ("Salvaged VBA source changed: " + $sourceModule.Name)
    }

    # An OLE2 file is its own VBA container.
    [IO.File]::WriteAllBytes($olePath, $content.VbaProjectBytes)
    $oleProject = [MacroStudio.BookIO]::ReadProject($olePath)
    Assert-True (-not $oleProject.IsZip) `
        'An OLE2 workbook was treated as a ZIP.'
    Assert-True ($oleProject.Modules.Count -eq $project.Modules.Count) `
        'An OLE2 container lost readable modules.'

    Assert-ErrorCode {
        [MacroStudio.BookIO]::ReadVbaProjectBytes($missingPath)
    } 'E-ATTACH-02'
} finally {
    foreach ($path in @(
        $nestedPath,
        $emptyPath,
        $invalidXlsbPath,
        $caseNamePath,
        $unknownExtPath,
        $brokenDirectoryPath,
        $blindDirectoryPath,
        $olePath,
        $zeroBytePath,
        $spoofedPath)) {
        if ([IO.File]::Exists($path)) {
            [IO.File]::Delete($path)
        }
    }
}

Write-Output 'test-bookio: PASS'
Write-Output (
    'book={0}, vbaProject={1}, modules={2}, exclusiveReopen=ok' -f `
    (Get-Item -LiteralPath $resolvedBookPath).Length,
    $content.VbaProjectBytes.Length,
    $project.Modules.Count)
