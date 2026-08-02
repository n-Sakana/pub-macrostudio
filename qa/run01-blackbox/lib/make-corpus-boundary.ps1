# make-corpus-boundary.ps1 - format variants and must-reject samples.
#
# Writes only into run01\corpus\. Existing files are skipped, never overwritten.

$ErrorActionPreference = 'Stop'
# Portable bundle: this file lives in <repo>\qa\run01-blackbox\lib, so the run
# root is the folder above it and the product repo is two levels above that.
$RUN  = Split-Path -Parent $PSScriptRoot
$REPO = Split-Path -Parent (Split-Path -Parent $RUN)
$OUT = Join-Path $RUN 'corpus\books'
$ORA = Join-Path $RUN 'corpus\oracles'
foreach ($d in $OUT, $ORA) { if (-not (Test-Path $d)) { New-Item -ItemType Directory -Force $d | Out-Null } }

$VBEXT_STD = 1
$made = @(); $skipped = @(); $failed = @()

function Save-Oracle($id, $file, $format, $expect, $why, $entry, $cell, $equals, $mustReject) {
  $o = [ordered]@{
    id = $id; file = $file; format = $format; expect = $expect; why = $why
    entryMacro = $entry
    postRun = if ($cell) { @(@{ sheet = '作業'; cell = $cell; equals = $equals }) } else { @() }
    mustReject = $mustReject
    route = @('ai')
  }
  $o | ConvertTo-Json -Depth 6 | Set-Content (Join-Path $ORA ($id + '.json')) -Encoding UTF8
}

$BODY = @"
Option Explicit

Private Const EXPORT_ROOT As String = "S:\eigyo\shinsei\"

Public Function DefaultExportFolder() As String
    DefaultExportFolder = EXPORT_ROOT
End Function

Public Sub RunFmt()
    ThisWorkbook.Worksheets(1).Range("B2").Value = "形式済み"
End Sub
"@

# format, ext, id, why  (these SHOULD be accepted)
$FORMATS = @(
  @{ id='G01'; file='G01_addin.xlam';  fmt=55; why='.xlam アドイン形式' },
  @{ id='G02'; file='G02_binary.xlsb'; fmt=50; why='.xlsb バイナリブック' },
  @{ id='G03'; file='G03_legacy.xls';  fmt=56; why='.xls 旧形式（OLE2 直）' }
)

$xl = New-Object -ComObject Excel.Application
$xl.Visible = $false; $xl.DisplayAlerts = $false; $xl.EnableEvents = $false
try {
  foreach ($f in $FORMATS) {
    $path = Join-Path $OUT $f.file
    if (Test-Path $path) { $skipped += $f.id; continue }
    try {
      $wb = $xl.Workbooks.Add()
      while ($wb.Worksheets.Count -gt 1) { $wb.Worksheets($wb.Worksheets.Count).Delete() }
      $wb.Worksheets(1).Name = '作業'
      $c = $wb.VBProject.VBComponents.Add($VBEXT_STD)
      $c.Name = 'FmtMod'
      $c.CodeModule.AddFromString($BODY)
      $wb.SaveAs($path, $f.fmt)
      $wb.Close($false)
      Save-Oracle $f.id $f.file ($f.file -replace '.*\.', '') 'normal' $f.why 'RunFmt' 'B2' '形式済み' $null
      $made += $f.id
    } catch { $failed += "$($f.id): $($_.Exception.Message)"; try { $wb.Close($false) } catch {} }
  }

  # G04 : .xlsx with NO macro -> must be refused ("マクロがありません")
  $p = Join-Path $OUT 'G04_no_macro.xlsx'
  if (Test-Path $p) { $skipped += 'G04' } else {
    try {
      $wb = $xl.Workbooks.Add()
      while ($wb.Worksheets.Count -gt 1) { $wb.Worksheets($wb.Worksheets.Count).Delete() }
      $wb.Worksheets(1).Name = '作業'
      $wb.SaveAs($p, 51)   # xlOpenXMLWorkbook - macro free
      $wb.Close($false)
      Save-Oracle 'G04' 'G04_no_macro.xlsx' 'xlsx' 'boundary' 'マクロ無し。受理してはいけない' $null $null $null 'マクロがありません'
      $made += 'G04'
    } catch { $failed += "G04: $($_.Exception.Message)"; try { $wb.Close($false) } catch {} }
  }

  # G05 : whole workbook encrypted -> must be refused (cannot be read)
  $p = Join-Path $OUT 'G05_encrypted.xlsm'
  if (Test-Path $p) { $skipped += 'G05' } else {
    try {
      $wb = $xl.Workbooks.Add()
      while ($wb.Worksheets.Count -gt 1) { $wb.Worksheets($wb.Worksheets.Count).Delete() }
      $wb.Worksheets(1).Name = '作業'
      $c = $wb.VBProject.VBComponents.Add($VBEXT_STD)
      $c.Name = 'EncMod'
      $c.CodeModule.AddFromString($BODY)
      $wb.SaveAs($p, 52, 'MacroStudioTest!1')   # Password = file encryption
      $wb.Close($false)
      Save-Oracle 'G05' 'G05_encrypted.xlsm' 'xlsm' 'boundary' 'ブック全体が暗号化。受理してはいけない' $null $null $null 'パスワードで保護されています'
      $made += 'G05'
    } catch { $failed += "G05: $($_.Exception.Message)"; try { $wb.Close($false) } catch {} }
  }
}
finally { $xl.Quit(); [void][Runtime.InteropServices.Marshal]::ReleaseComObject($xl) }

# G07 : extension says .xlsm, content is not a workbook -> must be refused
$p = Join-Path $OUT 'G07_spoofed_extension.xlsm'
if (Test-Path $p) { $skipped += 'G07' } else {
  [System.IO.File]::WriteAllText($p, "This is plain text pretending to be a workbook.`r`n" * 40)
  Save-Oracle 'G07' 'G07_spoofed_extension.xlsm' 'xlsm' 'boundary' '拡張子だけ .xlsm の別物。受理してはいけない' $null $null $null 'ファイルを読み取れませんでした'
  $made += 'G07'
}

# G08a : 0 byte
$p = Join-Path $OUT 'G08_zero_bytes.xlsm'
if (Test-Path $p) { $skipped += 'G08' } else {
  [System.IO.File]::WriteAllBytes($p, @())
  Save-Oracle 'G08' 'G08_zero_bytes.xlsm' 'xlsm' 'boundary' '0 バイト。受理してはいけない' $null $null $null 'ファイルを読み取れませんでした'
  $made += 'G08'
}

# G09 : truncated real workbook (first 3 KB of a valid one)
$src = Join-Path $OUT 'D01_fixed_drive.xlsm'
$p = Join-Path $OUT 'G09_truncated.xlsm'
if (Test-Path $p) { $skipped += 'G09' }
elseif (Test-Path $src) {
  $bytes = [System.IO.File]::ReadAllBytes($src)
  $take = [Math]::Min(3072, $bytes.Length)
  [System.IO.File]::WriteAllBytes($p, $bytes[0..($take - 1)])
  Save-Oracle 'G09' 'G09_truncated.xlsm' 'xlsm' 'boundary' '途中で切れたファイル。受理してはいけない' $null $null $null 'ファイルを読み取れませんでした'
  $made += 'G09'
}

"MADE    ($($made.Count)): $($made -join ', ')"
"SKIPPED ($($skipped.Count)): $($skipped -join ', ')"
if ($failed.Count) { "FAILED  ($($failed.Count)):"; $failed | ForEach-Object { "  $_" } }
