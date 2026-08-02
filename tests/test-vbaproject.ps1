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

function Assert-Bytes {
    param(
        [byte[]]$Actual,
        [byte[]]$Expected,
        [string]$Message
    )

    Assert-True ($Actual.Length -eq $Expected.Length) `
        ($Message + ' Length mismatch.')
    for ($index = 0; $index -lt $Expected.Length; $index++) {
        Assert-True ($Actual[$index] -eq $Expected[$index]) `
            ($Message + " Byte mismatch at $index.")
    }
}

function Assert-InvalidData {
    param(
        [ScriptBlock]$Action,
        [string]$Message
    )

    $threw = $false
    try {
        & $Action
    } catch [IO.InvalidDataException] {
        $threw = $true
    }
    Assert-True $threw $Message
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

function Find-PatternOffsets {
    param(
        [byte[]]$Data,
        [byte[]]$Pattern
    )

    $result = New-Object System.Collections.ArrayList
    for ($offset = 0;
        $offset -le $Data.Length - $Pattern.Length;
        $offset++) {
        $match = $true
        for ($index = 0; $index -lt $Pattern.Length; $index++) {
            if ($Data[$offset + $index] -ne $Pattern[$index]) {
                $match = $false
                break
            }
        }
        if ($match) {
            [void]$result.Add($offset)
        }
    }
    return ,$result
}

function Set-UInt16 {
    param(
        [byte[]]$Data,
        [int]$Offset,
        [UInt16]$Value
    )

    [byte[]]$bytes = [BitConverter]::GetBytes($Value)
    [Buffer]::BlockCopy($bytes, 0, $Data, $Offset, 2)
}

function Set-UInt32 {
    param(
        [byte[]]$Data,
        [int]$Offset,
        [UInt32]$Value
    )

    [byte[]]$bytes = [BitConverter]::GetBytes($Value)
    [Buffer]::BlockCopy($bytes, 0, $Data, $Offset, 4)
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

$project = [MacroStudio.BookIO]::ReadProject(
    (Resolve-Path -LiteralPath $BookPath))
Assert-True ($project.CodePage -eq 932) 'Code page mismatch.'

# The module set comes from the committed fixture, not from a list typed
# out a second time here, so a rebuilt testdata\test_large.xlsm is judged
# against the same source of truth that built it (ENV-01). What is NOT
# asserted is where inside its stream each module's source begins: that
# offset is decided by the Attribute block Excel wrote, so recording it
# pinned the test to one machine's workbook. The structural claim that
# offset actually makes - it points at the start of a compressed
# container - is checked below and holds for any workbook.
$moduleFixturePath = Join-Path `
    $PSScriptRoot `
    'fixtures\lexer\test-large-modules.json'
Assert-True (Test-Path -LiteralPath $moduleFixturePath -PathType Leaf) `
    'The real-book module fixture is missing.'
$moduleFixture = [IO.File]::ReadAllText(
    (Resolve-Path -LiteralPath $moduleFixturePath),
    [Text.UTF8Encoding]::new($false, $true)) | ConvertFrom-Json
Assert-True ($moduleFixture.schemaVersion -eq 1) `
    'The real-book module fixture schema is unknown.'

$expected = @($moduleFixture.modules | ForEach-Object {
    ,@(
        [string]$_.name,
        [string]$_.kind,
        $(if ([string]$_.kind -eq 'Document') { 'cls' } else { 'bas' })
    )
})
Assert-True ($project.Modules.Count -eq $expected.Count) `
    ('Module count mismatch: read ' + $project.Modules.Count +
     ', fixture ' + $expected.Count)

for ($index = 0; $index -lt $expected.Count; $index++) {
    $module = $project.Modules[$index]
    Assert-True ($module.Name -eq $expected[$index][0]) `
        "Module order mismatch at $index."
    Assert-True ($module.StreamName -eq $expected[$index][0]) `
        "Module stream mismatch at $index."
    Assert-True ($module.Kind.ToString() -eq $expected[$index][1]) `
        "Module kind mismatch at $index."
    Assert-True ($module.Extension -eq $expected[$index][2]) `
        "Module extension mismatch at $index."
    Assert-True (
        $module.SourceOffset -gt 0 -and
        $module.SourceOffset -lt $module.StreamData.Length) `
        "MODULEOFFSET is outside the module stream at $index."
    Assert-True (
        $module.StreamData[$module.SourceOffset] -eq 0x01) `
        "Compressed container signature mismatch at $index."
    Assert-True (
        $module.FullCode.StartsWith(
            'Attribute VB_',
            [StringComparison]::OrdinalIgnoreCase)) `
        "Full source has no leading Attribute block at $index."
    Assert-True (
        -not $module.Code.StartsWith(
            'Attribute VB_',
            [StringComparison]::OrdinalIgnoreCase)) `
        "Visible code still has a leading Attribute block at $index."
}

if ([IO.Path]::GetFileName($BookPath) -ieq 'test_large.xlsm') {
    $lexerFixturePath = Join-Path `
        $PSScriptRoot `
        'fixtures\lexer\test-large-modules.json'
    Assert-True (Test-Path -LiteralPath $lexerFixturePath -PathType Leaf) `
        'The real-book lexer fixture is missing.'
    $lexerFixture = [IO.File]::ReadAllText(
        (Resolve-Path -LiteralPath $lexerFixturePath),
        [Text.UTF8Encoding]::new($false, $true)) | ConvertFrom-Json
    Assert-True ($lexerFixture.schemaVersion -eq 1) `
        'The real-book lexer fixture schema is unknown.'
    Assert-True ($lexerFixture.modules.Count -eq $project.Modules.Count) `
        'The real-book lexer fixture module count changed.'
    $sha256 = [Security.Cryptography.SHA256]::Create()
    try {
        foreach ($fixtureModule in $lexerFixture.modules) {
            $actualModule = $project.Modules | Where-Object {
                $_.Name -ceq $fixtureModule.name
            } | Select-Object -First 1
            Assert-True ($null -ne $actualModule) `
                ('Lexer fixture module is missing: ' + $fixtureModule.name)
            [byte[]]$actualBytes = [Text.Encoding]::UTF8.GetBytes(
                $actualModule.Code)
            $actualBase64 = [Convert]::ToBase64String($actualBytes)
            $actualHash = ([BitConverter]::ToString(
                $sha256.ComputeHash($actualBytes))).Replace(
                    '-', '').ToLowerInvariant()
            Assert-True ($actualBase64 -ceq $fixtureModule.codeBase64) `
                ('Lexer fixture text changed: ' + $fixtureModule.name)
            Assert-True ($actualHash -ceq $fixtureModule.sha256) `
                ('Lexer fixture hash changed: ' + $fixtureModule.name)
        }
    } finally {
        $sha256.Dispose()
    }
}

$codePage = 0
$dirModules = [MacroStudio.VbaProjectReader]::ReadDirModules(
    $project.DirDecompressed,
    [ref]$codePage)
Assert-True ($codePage -eq 932) 'dir code page mismatch.'
Assert-True ($dirModules.Count -eq 6) 'dir module count mismatch.'

[byte[]]$projectModulesHeader = 0x0F, 0x00, 0x02, 0x00, 0x00, 0x00
$projectModulesOffsets = Find-PatternOffsets `
    $project.DirDecompressed `
    $projectModulesHeader
Assert-True ($projectModulesOffsets.Count -eq 1) `
    'PROJECTMODULES test fixture offset was not unique.'
$projectModulesOffset = [int]$projectModulesOffsets[0]
Assert-True ($projectModulesOffset -ge 24) `
    'PROJECTMODULES test fixture has no injection space.'

[byte[]]$duplicateModulesDir = $project.DirDecompressed.Clone()
$falseModulesOffset = $projectModulesOffset - 24
Assert-True (
    [Text.Encoding]::ASCII.GetString(
        $duplicateModulesDir,
        $falseModulesOffset,
        16) -eq '6.0 Object Libra') `
    'PROJECTMODULES candidate was not injected into string data.'
Set-UInt16 $duplicateModulesDir $falseModulesOffset 0x000F
Set-UInt32 $duplicateModulesDir ($falseModulesOffset + 2) 2
Set-UInt16 $duplicateModulesDir ($falseModulesOffset + 6) 0x7FFF
Set-UInt16 $duplicateModulesDir ($falseModulesOffset + 8) 0x0013
Set-UInt32 $duplicateModulesDir ($falseModulesOffset + 10) 2
Set-UInt16 $duplicateModulesDir ($falseModulesOffset + 14) 0
$duplicateModulesCodePage = 0
$duplicateModules = [MacroStudio.VbaProjectReader]::ReadDirModules(
    $duplicateModulesDir,
    [ref]$duplicateModulesCodePage)
Assert-True ($duplicateModulesCodePage -eq 932) `
    'False PROJECTMODULES candidate changed the code page.'
Assert-True ($duplicateModules.Count -eq 6) `
    'False PROJECTMODULES candidate rejected a valid dir stream.'

[byte[]]$duplicateCodePageDir = $project.DirDecompressed.Clone()
$falseCodePageOffset = $projectModulesOffset - 32
Assert-True (
    [Text.Encoding]::ASCII.GetString(
        $duplicateCodePageDir,
        $falseCodePageOffset,
        8) -eq 'Office 1') `
    'PROJECTCODEPAGE candidate was not injected into string data.'
Set-UInt16 $duplicateCodePageDir $falseCodePageOffset 0x0003
Set-UInt32 $duplicateCodePageDir ($falseCodePageOffset + 2) 2
Set-UInt16 $duplicateCodePageDir ($falseCodePageOffset + 6) 0xFFFF
$duplicateCodePage = 0
$duplicateCodePageModules =
    [MacroStudio.VbaProjectReader]::ReadDirModules(
        $duplicateCodePageDir,
        [ref]$duplicateCodePage)
Assert-True ($duplicateCodePage -eq 932) `
    'False PROJECTCODEPAGE candidate changed the code page.'
Assert-True ($duplicateCodePageModules.Count -eq 6) `
    'False PROJECTCODEPAGE candidate rejected a valid dir stream.'

[byte[]]$ambiguousCodePageDir = $project.DirDecompressed.Clone()
Set-UInt16 $ambiguousCodePageDir $falseCodePageOffset 0x0003
Set-UInt32 $ambiguousCodePageDir ($falseCodePageOffset + 2) 2
Set-UInt16 $ambiguousCodePageDir ($falseCodePageOffset + 6) 932
$ambiguousCodePage = 0
Assert-InvalidData {
    [MacroStudio.VbaProjectReader]::ReadDirModules(
        $ambiguousCodePageDir,
        [ref]$ambiguousCodePage)
} 'Ambiguous valid PROJECTCODEPAGE candidates were accepted.'

[byte[]]$mutatedDir = $project.DirDecompressed.Clone()
$encoding = [Text.Encoding]::GetEncoding(932)
[byte[]]$oldAnsi = $encoding.GetBytes('AppController')
[byte[]]$newAnsi = $encoding.GetBytes('PhysicalMod01')
[byte[]]$oldUnicode = [Text.Encoding]::Unicode.GetBytes('AppController')
[byte[]]$newUnicode = [Text.Encoding]::Unicode.GetBytes('PhysicalMod01')
Assert-True ($oldAnsi.Length -eq $newAnsi.Length) `
    'Rename test MBCS lengths differ.'
Assert-True ($oldUnicode.Length -eq $newUnicode.Length) `
    'Rename test Unicode lengths differ.'

$ansiOffsets = Find-PatternOffsets $mutatedDir $oldAnsi
$unicodeOffsets = Find-PatternOffsets $mutatedDir $oldUnicode
Assert-True ($ansiOffsets.Count -eq 2) `
    'Rename test did not find both MBCS names.'
Assert-True ($unicodeOffsets.Count -eq 2) `
    'Rename test did not find both Unicode names.'
[Buffer]::BlockCopy(
    $newAnsi,
    0,
    $mutatedDir,
    $ansiOffsets[1],
    $newAnsi.Length)
[Buffer]::BlockCopy(
    $newUnicode,
    0,
    $mutatedDir,
    $unicodeOffsets[1],
    $newUnicode.Length)

$mutatedCodePage = 0
$mutatedModules = [MacroStudio.VbaProjectReader]::ReadDirModules(
    $mutatedDir,
    [ref]$mutatedCodePage)
$renamed = $mutatedModules |
    Where-Object { $_.Name -eq 'AppController' } |
    Select-Object -First 1
Assert-True ($null -ne $renamed) 'Renamed logical module was not found.'
Assert-True ($renamed.StreamName -eq 'PhysicalMod01') `
    'MODULESTREAMNAME was not kept separate from MODULENAME.'

$headerInput = (
    "Attribute VB_Name = `"Demo`"`r`n" +
    "Attribute VB_Description = `"Header`"`r`n" +
    "Option Explicit`r`n" +
    "Sub Test()`r`n" +
    "Attribute Test.VB_UserMemId = 0`r`n" +
    "End Sub`r`n")
$attributeHeader = ''
$visibleCode = ''
[MacroStudio.VbaProjectReader]::SplitAttributeHeader(
    $headerInput,
    [ref]$attributeHeader,
    [ref]$visibleCode)
$expectedHeader = (
    "Attribute VB_Name = `"Demo`"`r`n" +
    "Attribute VB_Description = `"Header`"`r`n")
Assert-True ($attributeHeader -eq $expectedHeader) `
    'Leading Attribute block split mismatch.'
Assert-True (
    $visibleCode.Contains('Attribute Test.VB_UserMemId = 0')) `
    'Procedure Attribute line was removed.'

$writeModule = $project.Modules |
    Where-Object { $_.Name -eq 'AppController' } |
    Select-Object -First 1
$newFullCode = [regex]::Replace(
    $writeModule.FullCode,
    '(\r\n|\r|\n)+$',
    '') + "`r`n' T2.3 stream replacement`r`n"
$writeChanges = New-Object `
    'System.Collections.Generic.Dictionary[string,string]'
$writeChanges.Add($writeModule.Name, $newFullCode)

$originalStreamName = $writeModule.StreamName
$writeModule.StreamName = 'PhysicalMod01'
$streamChanges = [MacroStudio.VbaProjectWriter]::CreateStreamChanges(
    $project,
    $writeChanges)
$writeModule.StreamName = $originalStreamName
Assert-True ($streamChanges.Count -eq 1) `
    'Module stream change count mismatch.'
Assert-True ($streamChanges.ContainsKey($writeModule.StreamEntry.Id)) `
    'Module change did not target the physical stream entry.'

# A rewritten module keeps no PerformanceCache. The prefix is the old
# code compiled, and Excel runs it in preference to the source, so a
# module stream that still carried it showed the code we replaced.
$newStream = $streamChanges[$writeModule.StreamEntry.Id]
$newSourceBytes = [MacroStudio.VbaCompression]::Decompress(
    $newStream,
    0)
$expectedSourceBytes = $project.Encoding.GetBytes($newFullCode)
Assert-Bytes $newSourceBytes $expectedSourceBytes `
    'Rebuilt module source'
$expectedCompressed = [MacroStudio.VbaCompression]::Compress(
    $expectedSourceBytes)
Assert-True (
    $newStream.Length -eq $expectedCompressed.Length) `
    'Rebuilt module stream is not source alone.'

$rebuiltProjectBytes = [MacroStudio.VbaProjectWriter]::RebuildProject(
    $project,
    $writeChanges)
$rebuiltProject = [MacroStudio.VbaProjectReader]::Read(
    $rebuiltProjectBytes)
$rebuiltModule = $rebuiltProject.Modules |
    Where-Object { $_.Name -eq $writeModule.Name } |
    Select-Object -First 1
Assert-True ($null -ne $rebuiltModule) `
    'Rebuilt logical module was not found.'
Assert-True ($rebuiltModule.StreamName -eq $originalStreamName) `
    'Rebuilt physical stream name changed.'
Assert-True ($rebuiltModule.FullCode -ceq $newFullCode) `
    'Rebuilt module code mismatch.'

# Excel believes a VBA project's compiled state whenever _VBA_PROJECT's
# version matches its engine, and that state lives in three places at
# once. Leaving any one of them behind meant the workbook still showed
# and ran the code we had replaced, while reading the source back said
# the change had landed. Clearing only some of the three does not
# degrade gracefully: it produces a workbook Excel refuses to open, so
# all three are asserted together.
foreach ($rebuilt in $rebuiltProject.Modules) {
    Assert-True ($rebuilt.SourceOffset -eq 0) `
        ("Rebuilt module kept a PerformanceCache: " + $rebuilt.Name)
}

$rebuiltOle2 = [MacroStudio.Ole2File]::Parse($rebuiltProjectBytes)
$rebuiltVbaStorage = $null
foreach ($entry in $rebuiltOle2.Entries) {
    if ($entry.ObjectType -eq 1 -and $entry.Name -eq 'VBA') {
        $rebuiltVbaStorage = $entry
    }
}
Assert-True ($null -ne $rebuiltVbaStorage) `
    'Rebuilt VBA storage was not found.'

$sawVbaProjectStamp = $false
foreach ($childId in $rebuiltVbaStorage.Children) {
    $child = $rebuiltOle2.Entries[$childId]
    if ($child.ObjectType -ne 2) {
        continue
    }
    if ($child.Name.StartsWith('__SRP_')) {
        Assert-True ($child.Size -eq 0) `
            ("Rebuilt project kept a compiled cache: " + $child.Name)
    }
    elseif ($child.Name -eq '_VBA_PROJECT') {
        $stamp = $rebuiltOle2.ReadStream($child)
        Assert-True (
            $stamp[2] -eq 0xFF -and $stamp[3] -eq 0xFF) `
            'Rebuilt _VBA_PROJECT still claims a compiled version.'
        $sawVbaProjectStamp = $true
    }
}
Assert-True $sawVbaProjectStamp `
    'Rebuilt _VBA_PROJECT stream was not found.'

$additionCode = (
    "Option Explicit`r`n`r`n" +
    "Public Sub AddedByMacroStudio()`r`n" +
    "    Debug.Print `"added`"`r`n" +
    "End Sub`r`n")
$emptyChanges = New-Object `
    'System.Collections.Generic.Dictionary[string,string]'
$additions = New-Object `
    'System.Collections.Generic.List[MacroStudio.VbaModuleAddition]'
$additions.Add(
    (New-Object MacroStudio.VbaModuleAddition(
        'CommonHelpers',
        $additionCode)))
$addedBytes = [MacroStudio.VbaProjectWriter]::RebuildProject(
    $project,
    $emptyChanges,
    $additions)
$addedProject = [MacroStudio.VbaProjectReader]::Read($addedBytes)
$addedModule = $addedProject.Modules |
    Where-Object { $_.Name -eq 'CommonHelpers' } |
    Select-Object -First 1
Assert-True ($addedProject.Modules.Count -eq 7) `
    'New module count mismatch.'
Assert-True ($null -ne $addedModule) `
    'New standard module was not found.'
Assert-True ($addedModule.Kind.ToString() -eq 'Standard') `
    'New module kind mismatch.'
Assert-True ($addedModule.SourceOffset -eq 0) `
    'New module must have an empty PerformanceCache.'
Assert-True ($addedModule.StreamData[0] -eq 0x01) `
    'New module compressed source signature mismatch.'
Assert-True (
    $addedModule.AttributeHeader -ceq
        "Attribute VB_Name = `"CommonHelpers`"`r`n") `
    'New module Attribute header mismatch.'
Assert-True ($addedModule.Code -ceq $additionCode) `
    'New module visible code mismatch.'
Assert-True (
    $addedProject.ProjectText.Contains(
        "Module=CommonHelpers`r`n")) `
    'PROJECT did not contain the new module.'
Assert-True ($addedProject.ProjectWmNames.Count -eq 7) `
    'PROJECTwm module count mismatch.'
Assert-True (
    $addedProject.ProjectWmNames[6] -ceq 'CommonHelpers') `
    'PROJECTwm did not append the new module in dir order.'
$addedStream = $addedProject.Ole2.FindChild(
    $addedProject.VbaStorage,
    'CommonHelpers',
    2)
Assert-True ($null -ne $addedStream) `
    'OLE2 new module stream was not created.'

Assert-InvalidData {
    [MacroStudio.VbaProjectWriter]::ValidateNewModuleName('1BadName')
} 'Invalid VBA identifier was accepted.'

$duplicateAdditions = New-Object `
    'System.Collections.Generic.List[MacroStudio.VbaModuleAddition]'
$duplicateAdditions.Add(
    (New-Object MacroStudio.VbaModuleAddition(
        'AppController',
        $additionCode)))
Assert-InvalidData {
    [MacroStudio.VbaProjectWriter]::RebuildProject(
        $project,
        $emptyChanges,
        $duplicateAdditions)
} 'Duplicate new module name was accepted.'

$unknownChanges = New-Object `
    'System.Collections.Generic.Dictionary[string,string]'
$unknownChanges.Add('NotAModule', "Option Explicit`r`n")
Assert-InvalidData {
    [MacroStudio.VbaProjectWriter]::CreateStreamChanges(
        $project,
        $unknownChanges)
} 'Unknown module change was accepted.'

Write-Output 'test-vbaproject: PASS'
foreach ($module in $project.Modules) {
    Write-Output (
        '{0}: kind={1}, stream={2}, offset={3}, code={4}' -f `
        $module.Name,
        $module.Kind,
        $module.StreamName,
        $module.SourceOffset,
        $module.Code.Length)
}
Write-Output (
    'rename: logical={0}, stream={1}' -f `
    $renamed.Name,
    $renamed.StreamName)
Write-Output (
    'write: logical={0}, stream={1}, old={2}, new={3}' -f `
    $writeModule.Name,
    $writeModule.StreamName,
    $writeModule.StreamData.Length,
    $newStream.Length)
Write-Output (
    'add: logical={0}, kind={1}, offset={2}, stream={3}' -f `
    $addedModule.Name,
    $addedModule.Kind,
    $addedModule.SourceOffset,
    $addedModule.StreamData.Length)
