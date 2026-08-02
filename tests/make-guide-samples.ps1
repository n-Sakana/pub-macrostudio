param(
    [string]$OutDir,
    [string[]]$Only,
    [switch]$SkipRunCheck
)

# Builds the ten workbooks the improvement guide's section 3 describes,
# one per environment difference, into testdata\guide-samples\.
#
# Every sample is self contained. None of them reads or writes a file, a
# share, a network location or the registry when its entry macro runs:
# the constructs that would do so are in procedures the entry never
# calls, which is the point - a diagnosis has to find them by reading the
# code, not by running it.
#
# What each sample is for, which guide section it comes from, what a
# diagnosis is expected to name, and whether the fix is the tool's work
# or a person's, all live in
# tests\fixtures\guide-samples\samples.json. Japanese text lives in
# samples.json and sheet-data.json, because every tests\*.ps1 in this
# repo is ASCII-only.
#
# Usage:
#   powershell.exe -NoProfile -ExecutionPolicy Bypass `
#       -File tests\make-guide-samples.ps1
#   ... -Only S04,S07        build a subset
#   ... -SkipRunCheck        build without running the entry macro
#
# Requires Excel with "Trust access to the VBA project object model"
# enabled (HKCU:\Software\Microsoft\Office\16.0\Excel\Security\AccessVBOM = 1).

$ErrorActionPreference = 'Stop'

$fixtureDir = Join-Path $PSScriptRoot 'fixtures\guide-samples'

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
#
# The editor does not always store what it was given: a Declare written
# across a line continuation makes it append a fragment of its own after
# the last line (an empty line and "()" for S04\WindowUtils). That is the
# editor's doing, not the sample's, so it is removed and the result is
# compared again. If the two still differ the build fails rather than
# shipping a workbook whose code is not the source.
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
        ($Label + ': the module stored in the workbook is not the ' +
         'fixture source.')
}

function Read-Json {
    param([string]$Path)
    Assert-True ([IO.File]::Exists($Path)) ('Missing data file: ' + $Path)
    return ([IO.File]::ReadAllText($Path, [Text.Encoding]::UTF8) |
        ConvertFrom-Json)
}

function Get-Property {
    param($Object, [string]$Name)
    if ($null -eq $Object) { return $null }
    $member = $Object.PSObject.Properties[$Name]
    if ($null -eq $member) { return $null }
    return $member.Value
}

$manifest = Read-Json (Join-Path $fixtureDir 'samples.json')
$sheetData = Read-Json (Join-Path $fixtureDir 'sheet-data.json')

if ([string]::IsNullOrEmpty($OutDir)) {
    $OutDir = Join-Path $PSScriptRoot '..\testdata\guide-samples'
}
if (-not [IO.Directory]::Exists($OutDir)) {
    [void][IO.Directory]::CreateDirectory($OutDir)
}
$OutDir = (Resolve-Path -LiteralPath $OutDir).Path

$wanted = @($manifest.samples)
# -File hands every argument over as one string, so "S01,S04" arrives
# whole rather than as two elements.
$selected = @()
foreach ($item in @($Only)) {
    foreach ($part in ([string]$item).Split(',')) {
        if ($part.Trim() -ne '') { $selected += $part.Trim() }
    }
}
if ($selected.Count -gt 0) {
    $wanted = @($wanted | Where-Object { $selected -contains $_.id })
    Assert-True ($wanted.Count -gt 0) ('No sample matched -Only ' +
        ($selected -join ','))
}

# ------------------------------------------------------------------
# Helpers that write a sheet from the data file.
# ------------------------------------------------------------------
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

# ------------------------------------------------------------------
# Excel
# ------------------------------------------------------------------
$excel = New-Object -ComObject Excel.Application
$results = @()
$built = 0

try {
    $excel.Visible = $false
    $excel.DisplayAlerts = $false
    $excel.EnableEvents = $false
    $excel.AutomationSecurity = 1
    $excel.ScreenUpdating = $false

    foreach ($sample in $wanted) {
        $id = [string]$sample.id
        $outPath = Join-Path $OutDir ([string]$sample.book)
        $wb = $null
        $note = ''

        try {
            $wb = $excel.Workbooks.Add()
            while ($wb.Worksheets.Count -gt 1) {
                $wb.Worksheets.Item($wb.Worksheets.Count).Delete()
            }
            $names = @($sample.sheets)
            $wb.Worksheets.Item(1).Name = [string]$names[0]
            for ($i = 1; $i -lt $names.Count; $i++) {
                $added = $wb.Worksheets.Add([Reflection.Missing]::Value,
                    $wb.Worksheets.Item($wb.Worksheets.Count))
                $added.Name = [string]$names[$i]
            }

            # --- sheet contents ---
            $perSample = Get-Property $sheetData.samples $id
            foreach ($name in $names) {
                $spec = Get-Property $perSample $name
                if ($null -eq $spec) { continue }
                $ws = $wb.Worksheets.Item($name)
                Set-Cells $ws (Get-Property $spec 'cells')
                [void](Set-Table $ws (Get-Property $spec 'table'))
                $ws.Columns.Item(1).ColumnWidth = 22
                $ws.Columns.Item(2).ColumnWidth = 26
            }

            # --- a barcode font the terminal may not have ---
            $barcode = Get-Property $sheetData.barcodeFont $id
            if ($null -ne $barcode) {
                $ws = $wb.Worksheets.Item([string]$barcode.sheet)
                $range = $ws.Range([string]$barcode.range)
                $range.Font.Name = [string]$barcode.fontName
                $range.Font.Size = [double]$barcode.fontSize
            }

            # --- ActiveX controls, which belong to the sheet ---
            # A terminal may refuse to insert one. That refusal is a fact
            # about this machine, not a reason to relax its settings, so
            # it is recorded and the sample is built without the control.
            $controls = Get-Property $sheetData.activeX $id
            if ($null -ne $controls) {
                $ws = $wb.Worksheets.Item([string]$names[0])
                foreach ($control in @($controls)) {
                    try {
                        $obj = $ws.OLEObjects().Add(
                            [string]$control.classType,
                            [Reflection.Missing]::Value,
                            $false, $false,
                            [Reflection.Missing]::Value,
                            [Reflection.Missing]::Value,
                            [Reflection.Missing]::Value,
                            [double]$control.left, [double]$control.top,
                            [double]$control.width, [double]$control.height)
                        $obj.Name = [string]$control.name
                    } catch {
                        $note = 'activex-not-inserted: ' +
                            $_.Exception.Message.Trim()
                    }
                }
            }

            # --- a link to a workbook that is not here ---
            # The path does not exist, so nothing is opened and nothing
            # is fetched; Excel records the link and caches no value.
            $link = Get-Property $sheetData.externalLink $id
            if ($null -ne $link) {
                $ws = $wb.Worksheets.Item([string]$link.sheet)
                $label = Get-Property $link 'label'
                if ($null -ne $label) {
                    $ws.Range([string]$label.address).Value2 =
                        [string]$label.value
                }
                try {
                    $ws.Range([string]$link.address).Formula =
                        [string]$link.formula
                } catch {
                    $note = 'external-link-not-added: ' +
                        $_.Exception.Message.Trim()
                }
            }

            # --- a query, whose source is this workbook and nothing else ---
            $query = Get-Property $sheetData.powerQuery $id
            if ($null -ne $query) {
                $ws = $wb.Worksheets.Item([string]$query.tableSheet)
                $listObject = $ws.ListObjects.Add(
                    1, $ws.Range([string]$query.tableRange), `
                    [Reflection.Missing]::Value, 1)
                $listObject.Name = [string]$query.tableName
                try {
                    [void]$wb.Queries.Add([string]$query.name,
                        [string]$query.formula)
                } catch {
                    $note = 'query-not-added: ' + $_.Exception.Message
                }
            }

            # --- VBA ---
            $vbProject = $wb.VBProject
            Assert-True ($null -ne $vbProject) `
                'Excel did not expose the VBA project. Enable AccessVBOM.'
            foreach ($module in @($sample.modules)) {
                $sourcePath = Join-Path $fixtureDir `
                    ($id + '\' + [string]$module.name + '.bas')
                Assert-True ([IO.File]::Exists($sourcePath)) `
                    ('Missing VBA source: ' + $sourcePath)
                $code = [IO.File]::ReadAllText($sourcePath,
                    [Text.Encoding]::UTF8)
                $component = $vbProject.VBComponents.Add([int]$module.kind)
                $component.Name = [string]$module.name
                $component.CodeModule.AddFromString($code)
                Set-ModuleToSource $component $code `
                    ($id + '/' + [string]$module.name)
            }
            $documents = Get-Property $sheetData.documentModules $id
            if ($null -ne $documents) {
                foreach ($property in $documents.PSObject.Properties) {
                    $component = $vbProject.VBComponents.Item($property.Name)
                    $component.CodeModule.AddFromString(
                        [string]$property.Value)
                }
            }
            # A reference the target terminal may not have. Declared in
            # the sample as an inventory expectation, so it has to be
            # a real reference and not a late bound call.
            $inventory = Get-Property $sample 'inventory'
            foreach ($needed in @(Get-Property $inventory 'referencesInclude')) {
                if ([string]$needed -eq 'Scripting') {
                    try {
                        [void]$vbProject.References.AddFromGuid(
                            '{420B2830-E718-11CF-893D-00A0C9054228}', 1, 0)
                    } catch {
                        $note = 'reference-not-added: ' +
                            $_.Exception.Message
                    }
                }
            }

            # The samples leave this machine, so they carry nothing of
            # whoever generated them.
            foreach ($property in @(
                'Author', 'Last author', 'Company', 'Manager',
                'Comments', 'Keywords', 'Category')) {
                try {
                    $wb.BuiltinDocumentProperties($property).Value = ''
                } catch {
                }
            }
            try { $wb.RemoveDocumentInformation(99) } catch { }

            if ([IO.File]::Exists($outPath)) {
                [IO.File]::Delete($outPath)
            }
            $wb.SaveAs($outPath, 52)

            # --- run the entry macro on the in-memory copy ---
            $ran = 'skipped'
            $observed = ''
            if (-not $SkipRunCheck -and $sample.runnable) {
                $qualified = ("'" + $wb.Name.Replace("'", "''") + "'!" +
                    [string]$sample.entryMacro)
                try {
                    [void]$excel.Run($qualified)
                    $cell = $sample.expectedCell
                    $observed = [string]$wb.Worksheets.Item(
                        [string]$cell.sheet).Range(
                        [string]$cell.address).Value2
                    if ($observed -eq [string]$cell.value) {
                        $ran = 'ok'
                    } else {
                        $ran = 'mismatch'
                    }
                } catch {
                    $ran = 'error'
                    $observed = $_.Exception.Message
                }
            }

            $connections = 0
            try { $connections = [int]$wb.Connections.Count } catch { }
            $oleObjects = 0
            try {
                $oleObjects = [int]$wb.Worksheets.Item(
                    [string]$names[0]).OLEObjects().Count
            } catch { }

            $results += [pscustomobject]@{
                id = $id
                book = [string]$sample.book
                path = $outPath
                run = $ran
                observed = $observed
                connections = $connections
                oleObjects = $oleObjects
                note = $note
            }
            $built++
        } finally {
            if ($null -ne $wb) {
                try { $wb.Close($false) } catch { }
                [void][Runtime.InteropServices.Marshal]::ReleaseComObject($wb)
                $wb = $null
            }
        }
    }
} finally {
    if ($null -ne $excel) {
        try { $excel.Quit() } catch { }
        [void][Runtime.InteropServices.Marshal]::ReleaseComObject($excel)
        $excel = $null
    }
    [GC]::Collect()
    [GC]::WaitForPendingFinalizers()
}

$resultPath = Join-Path $OutDir 'build-result.json'
# A partial build replaces only what it rebuilt. Dropping the other rows
# would erase the reasons recorded for parts this terminal could not make.
$merged = @()
if ([IO.File]::Exists($resultPath)) {
    $previous = [IO.File]::ReadAllText($resultPath, [Text.Encoding]::UTF8) |
        ConvertFrom-Json
    foreach ($row in @($previous.samples)) {
        if (@($results | ForEach-Object { $_.id }) -notcontains [string]$row.id) {
            $merged += $row
        }
    }
}
$merged += $results
$payload = [pscustomobject]@{
    outDir = $OutDir
    samples = @($merged | Sort-Object -Property id)
}
[IO.File]::WriteAllText($resultPath,
    ($payload | ConvertTo-Json -Depth 6), (New-Object Text.UTF8Encoding $false))

Write-Output 'make-guide-samples: OK'
Write-Output ('built=' + $built + ', outDir=' + $OutDir)
foreach ($r in $results) {
    Write-Output ('  ' + $r.id + ' run=' + $r.run +
        ' connections=' + $r.connections +
        ' oleObjects=' + $r.oleObjects +
        $(if ($r.note -ne '') { ' note=' + $r.note } else { '' }) +
        $(if ($r.run -ne 'ok') { ' observed=' + $r.observed } else { '' }))
}
