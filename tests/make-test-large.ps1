param(
    [string]$OutPath,
    [switch]$SkipVerify
)

# Builds testdata\test_large.xlsm: the small macro-enabled workbook that
# the non-UI PowerShell suite reads.
#
# WHY THIS FILE EXISTS
#
# testdata\ is .gitignore'd (docs\DEVELOPMENT.md section 4), so a fresh
# clone has no workbook to read and the suite went 2 PASS / 12 FAIL with
# nothing wrong with the product. Worse, several tests had memorised this
# particular fixture - its vbaProject.bin length, its total line count -
# so no replacement workbook could ever satisfy them. Recorded as ENV-01.
#
# The module text was never actually lost. tests\fixtures\lexer\
# test-large-modules.json is committed and holds the exact UTF-8 bytes of
# every module, with a SHA-256 per module. That file is the source of
# truth; this script only puts those bytes back into a container Excel
# made, so the workbook a fresh clone reads is built the same way the
# original was.
#
# WHAT THE TESTS MAY ASSERT ABOUT THE RESULT
#
# The module SET and each module's TEXT - both come from the committed
# fixture and are reproducible anywhere. Not the byte length of
# vbaProject.bin and not the count of anything Excel decides: those are
# properties of one machine's Excel on one day, not of the product.
#
# Usage:
#   powershell.exe -NoProfile -ExecutionPolicy Bypass `
#       -File tests\make-test-large.ps1
#
# Requires Excel with "Trust access to the VBA project object model"
# enabled (HKCU:\Software\Microsoft\Office\16.0\Excel\Security\AccessVBOM = 1).

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

$fixturePath = Join-Path $PSScriptRoot 'fixtures\lexer\test-large-modules.json'
Assert-True ([IO.File]::Exists($fixturePath)) `
    ('Missing module fixture: ' + $fixturePath)

$testdataRoot = Join-Path $PSScriptRoot '..\testdata'
if (-not [IO.Directory]::Exists($testdataRoot)) {
    [void][IO.Directory]::CreateDirectory($testdataRoot)
}
$testdataRoot = (Resolve-Path -LiteralPath $testdataRoot).Path

if ([string]::IsNullOrEmpty($OutPath)) {
    $OutPath = Join-Path $testdataRoot 'test_large.xlsm'
}

$fixture = [IO.File]::ReadAllText(
    $fixturePath,
    [Text.UTF8Encoding]::new($false, $true)) | ConvertFrom-Json
Assert-True ($fixture.schemaVersion -eq 1) `
    'The module fixture schema is unknown.'

# Document modules (Sheet1, ThisWorkbook) are the ones Excel creates for
# the sheet and the workbook. They carry no code in this fixture, so the
# only thing to put back is the standard modules.
$standard = @($fixture.modules | Where-Object { $_.kind -eq 'Standard' })
$documents = @($fixture.modules | Where-Object { $_.kind -eq 'Document' })
Assert-True ($standard.Count -gt 0) `
    'The module fixture declares no standard modules.'

foreach ($module in $documents) {
    $bytes = [Convert]::FromBase64String([string]$module.codeBase64)
    Assert-True ($bytes.Length -eq 0) `
        ('A document module carries code, which this script cannot ' +
         'reproduce: ' + $module.name)
}

$sha256 = [Security.Cryptography.SHA256]::Create()

function Get-Sha256Hex {
    param([byte[]]$Bytes)

    return ([BitConverter]::ToString($sha256.ComputeHash($Bytes))).Replace(
        '-', '').ToLowerInvariant()
}

$existingIds = @{}
foreach ($process in @(Get-Process -Name EXCEL -ErrorAction SilentlyContinue)) {
    $existingIds[$process.Id] = $true
}

$excel = New-Object -ComObject Excel.Application
$wb = $null
try {
    $excel.Visible = $false
    $excel.DisplayAlerts = $false
    $excel.EnableEvents = $false
    $excel.AutomationSecurity = 1
    $excel.ScreenUpdating = $false

    $wb = $excel.Workbooks.Add()
    while ($wb.Worksheets.Count -gt 1) {
        $wb.Worksheets.Item($wb.Worksheets.Count).Delete()
    }
    # The sheet's code module is named after the sheet, and the fixture
    # records that name, so it is not decoration.
    $sheetModule = @($documents | Where-Object { $_.name -ne 'ThisWorkbook' })
    Assert-True ($sheetModule.Count -eq 1) `
        'The module fixture does not name exactly one sheet module.'
    $wb.Worksheets.Item(1).Name = [string]$sheetModule[0].name

    $vbProject = $wb.VBProject
    Assert-True ($null -ne $vbProject) `
        'Excel did not expose the VBA project. Enable AccessVBOM.'

    # vbext_ct_StdModule = 1.
    foreach ($module in $standard) {
        $code = [Text.Encoding]::UTF8.GetString(
            [Convert]::FromBase64String([string]$module.codeBase64))
        # AddFromString terminates the last line itself. Handing it text
        # that already ends in a newline leaves a blank line behind, and
        # the module would read back one CRLF longer than the fixture.
        while ($code.EndsWith("`n") -or $code.EndsWith("`r")) {
            $code = $code.Substring(0, $code.Length - 1)
        }
        $component = $vbProject.VBComponents.Add(1)
        $component.Name = [string]$module.name
        $component.CodeModule.AddFromString($code)
        Assert-True ($component.Type -eq 1) `
            ('Component type mismatch for ' + $module.name + ': ' +
             $component.Type)
    }

    $expected = $fixture.modules.Count
    Assert-True ($vbProject.VBComponents.Count -eq $expected) `
        ('Unexpected component count: ' + $vbProject.VBComponents.Count +
         ', expected ' + $expected)

    # The workbook is read on other machines, so it carries nothing about
    # whoever generated it.
    foreach ($property in @(
        'Author', 'Last author', 'Company', 'Manager',
        'Comments', 'Keywords', 'Category')) {
        try {
            $wb.BuiltinDocumentProperties($property).Value = ''
        } catch {
        }
    }
    $wb.RemoveDocumentInformation(99)

    if ([IO.File]::Exists($OutPath)) {
        [IO.File]::Delete($OutPath)
    }
    # xlOpenXMLWorkbookMacroEnabled = 52.
    $wb.SaveAs($OutPath, 52)
} finally {
    if ($null -ne $wb) {
        try { $wb.Close($false) } catch { }
        [void][Runtime.InteropServices.Marshal]::ReleaseComObject($wb)
        $wb = $null
    }
    if ($null -ne $excel) {
        try { $excel.Quit() } catch { }
        [void][Runtime.InteropServices.Marshal]::ReleaseComObject($excel)
        $excel = $null
    }
    [GC]::Collect()
    [GC]::WaitForPendingFinalizers()
    [GC]::Collect()

    foreach ($process in @(Get-Process -Name EXCEL -ErrorAction SilentlyContinue)) {
        if (-not $existingIds.ContainsKey($process.Id)) {
            try {
                Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
            } catch { }
        }
    }
}

Assert-True ([IO.File]::Exists($OutPath)) `
    ('The workbook was not written: ' + $OutPath)

# Read the result back with the product's own reader. A workbook Excel
# saved but MacroStudio cannot read is not a fixture, and finding that
# out here beats finding it out inside six other tests.
if (-not $SkipVerify) {
    # Same hoisting the other PowerShell tests do: the engine is four
    # files, and a plain concatenation would leave `using` lines sitting
    # after the first namespace.
    $combined = (@(
        '05_Ole2.cs',
        '06_VbaCompression.cs',
        '07_VbaProject.cs',
        '08_BookIO.cs'
    ) | ForEach-Object {
        $path = Join-Path (Join-Path $PSScriptRoot '..\src') $_
        [IO.File]::ReadAllText(
            (Resolve-Path -LiteralPath $path),
            [Text.Encoding]::UTF8)
    }) -join "`n"
    $usingPattern = '(?m)^\s*using\s+[\w][\w.]*\s*;'
    $usings = [regex]::Matches($combined, $usingPattern) |
        ForEach-Object { $_.Value.Trim() } |
        Sort-Object -Unique
    $engineSource = ($usings -join "`n") + "`n`n" +
        ($combined -replace $usingPattern, '')
    Add-Type -TypeDefinition $engineSource `
        -ReferencedAssemblies @(
            'System', 'System.Core', 'System.IO.Compression',
            'System.IO.Compression.FileSystem')

    $project = [MacroStudio.BookIO]::ReadProject($OutPath)
    $actualNames = @($project.Modules | ForEach-Object { $_.Name } |
        Sort-Object)
    $expectedNames = @($fixture.modules | ForEach-Object { $_.name } |
        Sort-Object)
    Assert-True (
        ($actualNames -join '|') -ceq ($expectedNames -join '|')) `
        ('Module set does not match the fixture. read=' +
         ($actualNames -join ',') + ' expected=' +
         ($expectedNames -join ','))

    foreach ($module in $fixture.modules) {
        $actual = $project.Modules | Where-Object {
            $_.Name -ceq [string]$module.name
        } | Select-Object -First 1
        Assert-True ($null -ne $actual) `
            ('Module missing after readback: ' + $module.name)
        [byte[]]$actualBytes = [Text.Encoding]::UTF8.GetBytes($actual.Code)
        $actualHash = Get-Sha256Hex $actualBytes
        Assert-True ($actualHash -ceq [string]$module.sha256) `
            ('Module text does not match the fixture: ' + $module.name +
             ' read=' + $actualHash + ' expected=' + $module.sha256)
    }

    Write-Output ('modules=' + $project.Modules.Count +
        ', codePage=' + $project.CodePage +
        ', vbaProjectBytes=' + $project.VbaProjectBytes.Length)
}

Write-Output 'make-test-large: OK'
Write-Output ('book=' + $OutPath)
