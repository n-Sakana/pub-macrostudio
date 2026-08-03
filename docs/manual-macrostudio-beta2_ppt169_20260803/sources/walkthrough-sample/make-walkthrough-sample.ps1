param(
    [string]$OutPath,
    [switch]$SkipRunCheck
)

# Builds the one workbook the manual's end-to-end example uses: a billing
# macro that carries BOTH a Win32 Declare and hard coded paths, so a single
# run through the app can show the replacement table and the chat repair
# together.
#
# No shipped sample has both. sample-book\sample_win32_sleep.xlsm carries
# the Declare and no path at all - the product records that measurement
# itself in presets\02_改修\02_固定パスを新環境へ置き換える.md - and
# testdata\input_monthly_report.xlsm carries neither a Declare nor a path
# literal. So the manual builds its own, from sources kept beside this
# script.
#
# The workbook is self contained. Running the entry macro touches only
# sheets: every procedure that would reach a file, a share or the network
# is left out of the entry path on purpose, because a diagnosis has to
# find those by reading the code rather than by running it.
#
# This script writes nothing outside its -OutPath. It does not modify the
# product, tests\, or testdata\.
#
# Usage:
#   powershell.exe -NoProfile -ExecutionPolicy Bypass `
#       -File make-walkthrough-sample.ps1
#
# Requires Excel with "Trust access to the VBA project object model"
# enabled (HKCU:\Software\Microsoft\Office\16.0\Excel\Security\AccessVBOM = 1).
#
# Japanese text lives in sample.json and the .bas files, so this script
# stays ASCII and needs no BOM to survive Windows PowerShell 5.1.

$ErrorActionPreference = 'Stop'

function Assert-True {
    param([bool]$Condition, [string]$Message)
    if (-not $Condition) { throw $Message }
}

function Get-NormalizedCode {
    param([string]$Text)
    $value = $Text -replace "`r`n", "`n"
    $value = $value -replace "`r", "`n"
    return ($value -replace "\n+$", '')
}

# What ends up in the workbook has to be the .bas that was handed in.
# The editor appends a fragment of its own after a Declare written across
# a line continuation, so that surplus is removed and the result compared
# again. If they still differ the build fails rather than shipping a
# workbook whose code is not the source.
function Set-ModuleToSource {
    param($Component, [string]$Source, [string]$Label)

    $expected = Get-NormalizedCode $Source
    $expectedCount = @($expected -split "`n").Count
    $count = [int]$Component.CodeModule.CountOfLines
    $actual = ''

    if ($count -gt $expectedCount) {
        $Component.CodeModule.DeleteLines(
            $expectedCount + 1, $count - $expectedCount)
        $count = [int]$Component.CodeModule.CountOfLines
    }
    if ($count -gt 0) {
        $actual = Get-NormalizedCode $Component.CodeModule.Lines(1, $count)
    }
    Assert-True ($actual -eq $expected) `
        ($Label + ': the module stored in the workbook is not the source.')
}

function Get-Property {
    param($Object, [string]$Name)
    if ($null -eq $Object) { return $null }
    $member = $Object.PSObject.Properties[$Name]
    if ($null -eq $member) { return $null }
    return $member.Value
}

function Set-Cells {
    param($Sheet, $Cells)
    if ($null -eq $Cells) { return }
    foreach ($property in $Cells.PSObject.Properties) {
        $Sheet.Range($property.Name).Value2 = $property.Value
    }
}

function Set-Table {
    param($Sheet, $Table)
    if ($null -eq $Table) { return 0 }
    $start = $Sheet.Range([string]$Table.start)
    $headers = @($Table.headers)
    for ($c = 0; $c -lt $headers.Count; $c++) {
        $start.Offset(0, $c).Value2 = [string]$headers[$c]
    }
    $rows = @($Table.rows)
    for ($r = 0; $r -lt $rows.Count; $r++) {
        $cells = @($rows[$r])
        for ($c = 0; $c -lt $cells.Count; $c++) {
            $value = $cells[$c]
            if ($value -is [string]) {
                $start.Offset($r + 1, $c).Value2 = [string]$value
            } else {
                $start.Offset($r + 1, $c).Value2 = [double]$value
            }
        }
    }
    return $rows.Count
}

$here = $PSScriptRoot
$manifestPath = Join-Path $here 'sample.json'
Assert-True ([IO.File]::Exists($manifestPath)) `
    ('Missing data file: ' + $manifestPath)
$manifest = ([IO.File]::ReadAllText($manifestPath, [Text.Encoding]::UTF8) |
    ConvertFrom-Json)

if ([string]::IsNullOrEmpty($OutPath)) {
    $OutPath = Join-Path $here ([string]$manifest.book)
}
$outDir = Split-Path -Parent $OutPath
if (-not [IO.Directory]::Exists($outDir)) {
    [void][IO.Directory]::CreateDirectory($outDir)
}
$OutPath = Join-Path (Resolve-Path -LiteralPath $outDir).Path `
    (Split-Path -Leaf $OutPath)

$excel = New-Object -ComObject Excel.Application
$wb = $null
$ran = 'skipped'
$observed = ''

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
    $names = @($manifest.sheets)
    $wb.Worksheets.Item(1).Name = [string]$names[0]
    for ($i = 1; $i -lt $names.Count; $i++) {
        $added = $wb.Worksheets.Add([Reflection.Missing]::Value,
            $wb.Worksheets.Item($wb.Worksheets.Count))
        $added.Name = [string]$names[$i]
    }

    foreach ($name in $names) {
        $spec = Get-Property $manifest.sheetData $name
        if ($null -eq $spec) { continue }
        $ws = $wb.Worksheets.Item($name)
        Set-Cells $ws (Get-Property $spec 'cells')
        [void](Set-Table $ws (Get-Property $spec 'table'))
        $widths = Get-Property $spec 'columnWidths'
        if ($null -ne $widths) {
            foreach ($property in $widths.PSObject.Properties) {
                $ws.Columns.Item($property.Name).ColumnWidth =
                    [double]$property.Value
            }
        }
    }
    $wb.Worksheets.Item([string]$names[0]).Activate()

    $vbProject = $wb.VBProject
    Assert-True ($null -ne $vbProject) `
        'Excel did not expose the VBA project. Enable AccessVBOM.'
    foreach ($module in @($manifest.modules)) {
        $sourcePath = Join-Path $here ([string]$module.name + '.bas')
        Assert-True ([IO.File]::Exists($sourcePath)) `
            ('Missing VBA source: ' + $sourcePath)
        $code = [IO.File]::ReadAllText($sourcePath, [Text.Encoding]::UTF8)
        $component = $vbProject.VBComponents.Add([int]$module.kind)
        $component.Name = [string]$module.name
        $component.CodeModule.AddFromString($code)
        Set-ModuleToSource $component $code ([string]$module.name)
    }

    # The workbook appears in the manual's screenshots, so it carries
    # nothing of whoever generated it.
    foreach ($property in @(
        'Author', 'Last author', 'Company', 'Manager',
        'Comments', 'Keywords', 'Category')) {
        try { $wb.BuiltinDocumentProperties($property).Value = '' } catch { }
    }
    try { $wb.RemoveDocumentInformation(99) } catch { }

    if ([IO.File]::Exists($OutPath)) { [IO.File]::Delete($OutPath) }
    $wb.SaveAs($OutPath, 52)

    if (-not $SkipRunCheck) {
        $qualified = ("'" + $wb.Name.Replace("'", "''") + "'!" +
            [string]$manifest.entryMacro)
        try {
            [void]$excel.Run($qualified)
            $cell = $manifest.expectedCell
            $observed = [string]$wb.Worksheets.Item(
                [string]$cell.sheet).Range([string]$cell.address).Value2
            if ($observed -eq [string]$cell.value) {
                $ran = 'ok'
                foreach ($extra in @($manifest.expectedCells)) {
                    $got = [string]$wb.Worksheets.Item(
                        [string]$extra.sheet).Range(
                        [string]$extra.address).Value2
                    if ($got -ne [string]$extra.value) {
                        $ran = 'mismatch'
                        $observed = ([string]$extra.address + ': expected [' +
                            [string]$extra.value + '] got [' + $got + ']')
                    }
                }
            } else {
                $ran = 'mismatch'
            }
        } catch {
            $ran = 'error'
            $observed = $_.Exception.Message
        }
    }
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
}

Write-Output 'make-walkthrough-sample: OK'
Write-Output ('path=' + $OutPath)
Write-Output ('run=' + $ran + $(if ($observed -ne '') {
    ' observed=' + $observed } else { '' }))
if ($ran -eq 'mismatch' -or $ran -eq 'error') {
    throw ('The entry macro did not produce the expected result: ' + $observed)
}
