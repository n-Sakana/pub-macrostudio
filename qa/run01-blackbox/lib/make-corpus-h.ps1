# make-corpus-h.ps1 - two samples the run01 matrix did not have.
#
#   D11  the same fixed path in THREE standard modules. Nothing in the existing
#        corpus puts a replaceable literal in more than one module, so screen 6's
#        module-list switch and [reflect the fix] could never be exercised.
#   F06  an ACE/Jet connection string with a workbook path buried inside a long
#        literal. HANDOFF-2 4.4 proposes this as the shape most common in real
#        work: a fixed path inside a longer string, not standing on its own.
#
# Same discipline as the other generators: writes only into run01\corpus\,
# never overwrites an existing file, uses its own hidden Excel and quits only
# that instance.
#
#   powershell -NoProfile -ExecutionPolicy Bypass -STA -File make-corpus-h.ps1

$ErrorActionPreference = 'Stop'
# Portable bundle: this file lives in <repo>\qa\run01-blackbox\lib, so the run
# root is the folder above it and the product repo is two levels above that.
$RUN  = Split-Path -Parent $PSScriptRoot
$REPO = Split-Path -Parent (Split-Path -Parent $RUN)
$OUT = Join-Path $RUN 'corpus\books'
$ORA = Join-Path $RUN 'corpus\oracles'
$VBEXT_STD = 1
$made = @(); $skipped = @(); $failed = @()

function Save-Oracle($o) {
  $json = $o | ConvertTo-Json -Depth 6
  [System.IO.File]::WriteAllText((Join-Path $ORA ($o.id + '.json')), $json,
    (New-Object System.Text.UTF8Encoding($true)))
}

function New-Book($sheets) {
  $wb = $script:xl.Workbooks.Add()
  while ($wb.Worksheets.Count -gt $sheets.Count) { $wb.Worksheets($wb.Worksheets.Count).Delete() }
  while ($wb.Worksheets.Count -lt $sheets.Count) { $wb.Worksheets.Add() | Out-Null }
  for ($i = 0; $i -lt $sheets.Count; $i++) { $wb.Worksheets($i + 1).Name = $sheets[$i] }
  $wb
}

function Add-Mod($wb, [string]$name, [int]$type, [string]$code) {
  $c = $wb.VBProject.VBComponents.Add($type)
  $c.Name = $name
  if ($code) { $c.CodeModule.AddFromString($code) }
  $c
}

$xl = New-Object -ComObject Excel.Application
$xl.Visible = $false; $xl.DisplayAlerts = $false; $xl.EnableEvents = $false
$script:xl = $xl

try {
  # ---- D11 : one literal, three modules ------------------------------------
  $path = Join-Path $OUT 'D11_path_in_3_modules.xlsm'
  if (Test-Path $path) { $skipped += 'D11' } else {
    $wb = $null
    try {
      $wb = New-Book @('作業')

      $m1 = @'
Option Explicit

Private Const EXPORT_ROOT As String = "S:\eigyo\shinsei\"

Public Sub RunThree()
    ThisWorkbook.Worksheets(1).Range("B2").Value = "三箇所済み"
End Sub

Public Function ExportFolder() As String
    ExportFolder = EXPORT_ROOT
End Function
'@

      $m2 = @'
Option Explicit

Public Function ArchiveFolder() As String
    ArchiveFolder = "S:\eigyo\shinsei\" & "archive\"
End Function

Public Function ArchiveName(ByVal ym As String) As String
    ArchiveName = ArchiveFolder() & ym & ".xlsx"
End Function
'@

      $m3 = @'
Option Explicit

Public Function ReportFolder() As String
    ReportFolder = "S:\eigyo\shinsei\"
End Function

Public Function ReportPath() As String
    ReportPath = ReportFolder() & "report.xlsx"
End Function
'@

      Add-Mod $wb 'PathA' $VBEXT_STD $m1 | Out-Null
      Add-Mod $wb 'PathB' $VBEXT_STD $m2 | Out-Null
      Add-Mod $wb 'PathC' $VBEXT_STD $m3 | Out-Null
      $wb.SaveAs($path, 52); $wb.Close($false); $wb = $null

      Save-Oracle ([ordered]@{
        id = 'D11'; file = 'D11_path_in_3_modules.xlsm'; format = 'xlsm'
        expect = 'normal'
        why = '同一の固定パスが3モジュールに散る。画面6のモジュール一覧切替と［修正を反映］を実操作するための試料'
        entryMacro = 'RunThree'
        postRun = @(@{ sheet = '作業'; cell = 'B2'; equals = '三箇所済み' })
        mustFix = @('S:\eigyo\shinsei\')
        mustPreserve = @()
        route = @('path')
        modules = @(
          @{ name = 'PathA'; type = 1 }
          @{ name = 'PathB'; type = 1 }
          @{ name = 'PathC'; type = 1 })
        occurrences = 3
        modulesChanged = 3
      })
      $made += 'D11'
    } catch { $failed += "D11: $($_.Exception.Message)"; if ($wb) { try { $wb.Close($false) } catch {} } }
  }

  # ---- F06 : ACE/Jet connection string with a path inside -------------------
  $path = Join-Path $OUT 'F06_ace_connection_path.xlsm'
  if (Test-Path $path) { $skipped += 'F06' } else {
    $wb = $null
    try {
      $wb = New-Book @('作業')

      # F02 holds a SQL Server connection string, which legitimately has no path
      # in it. This one is the ACE/Jet shape: Data Source= is a real file path
      # sitting inside a much longer literal.
      $m = @'
Option Explicit

Private Const CONN As String = "Provider=Microsoft.ACE.OLEDB.12.0;Data Source=S:\eigyo\shinsei\master.accdb;Persist Security Info=False;"

Public Sub RunAce()
    ThisWorkbook.Worksheets(1).Range("B2").Value = "接続文字列済み"
End Sub

Public Function ConnectionString() As String
    ConnectionString = CONN
End Function

Public Function ExcelSource() As String
    ExcelSource = "Provider=Microsoft.ACE.OLEDB.12.0;Data Source=S:\eigyo\shinsei\rate.xlsx;Extended Properties=""Excel 12.0 Xml;HDR=YES"";"
End Function
'@

      Add-Mod $wb 'AceConn' $VBEXT_STD $m | Out-Null
      $wb.SaveAs($path, 52); $wb.Close($false); $wb = $null

      Save-Oracle ([ordered]@{
        id = 'F06'; file = 'F06_ace_connection_path.xlsm'; format = 'xlsm'
        expect = 'normal'
        why = 'ACE/Jet 接続文字列の Data Source= に固定パスが埋まる。長いリテラルの内側にある固定パスを拾えるかの検査（HANDOFF-2 4.4 の提案）'
        entryMacro = 'RunAce'
        postRun = @(@{ sheet = '作業'; cell = 'B2'; equals = '接続文字列済み' })
        mustFix = @('S:\eigyo\shinsei\')
        mustPreserve = @('Provider=Microsoft.ACE.OLEDB.12.0', 'Persist Security Info=False', 'HDR=YES')
        route = @('path')
        modules = @(@{ name = 'AceConn'; type = 1 })
        note = '候補として S:\eigyo\shinsei\ が2か所出るのが期待。接続文字列全体を1リテラルとして扱って取りこぼすなら所見'
      })
      $made += 'F06'
    } catch { $failed += "F06: $($_.Exception.Message)"; if ($wb) { try { $wb.Close($false) } catch {} } }
  }
}
finally {
  try { $xl.Quit() } catch {}
  [void][Runtime.InteropServices.Marshal]::ReleaseComObject($xl)
}

"MADE:    $($made -join ', ')"
"SKIPPED: $($skipped -join ', ')"
"FAILED:  $($failed -join ', ')"
