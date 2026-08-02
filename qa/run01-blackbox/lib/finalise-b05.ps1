# finalise-b05.ps1 - narrow the real path limit and leave B05 at a length the
# product can actually be tested against.
#
# Measured so far: 240 chars OPEN, 256 chars FAIL. This narrows the gap and
# then places the B05 artifact at the longest Japanese file name that opens
# from the evidence root.
#
#   powershell -NoProfile -ExecutionPolicy Bypass -STA -File finalise-b05.ps1

$ErrorActionPreference = 'Stop'
# Portable bundle: this file lives in <repo>\qa\run01-blackbox\lib, so the run
# root is the folder above it and the product repo is two levels above that.
$RUN  = Split-Path -Parent $PSScriptRoot
$REPO = Split-Path -Parent (Split-Path -Parent $RUN)
$OUT = Join-Path $RUN 'corpus\books'
$ORA = Join-Path $RUN 'corpus\oracles'
$DIR = Join-Path $OUT 'b05'
$SRC = Join-Path $DIR (('長いファイル名の境界試験' * 16) + '.xlsm')

$xl = New-Object -ComObject Excel.Application
$xl.Visible = $false; $xl.DisplayAlerts = $false; $xl.EnableEvents = $false
$xl.AutomationSecurity = 1

$probe = @()
function Try-Open([string]$p) {
  try {
    $wb = $xl.Workbooks.Open($p, 0, $false)
    $ran = $false
    try { $xl.Run("'" + $wb.Name + "'!RunLongName") | Out-Null; $ran = ($wb.Worksheets(1).Range('B2').Text -eq '長名済み') } catch {}
    $wb.Close($false)
    return @{ ok = $true; ran = $ran }
  } catch { return @{ ok = $false; ran = $false; msg = ($_.Exception.Message -replace "`r?`n", ' ') } }
}

$lastOk = 240; $firstNg = 256
try {
  foreach ($t in 244, 248, 250, 252, 254) {
    $stem = 'x' * ($t - $DIR.Length - 1 - 5)
    $p = Join-Path $DIR ($stem + '.xlsm')
    if (-not [System.IO.File]::Exists('\\?\' + $p)) { [System.IO.File]::Copy('\\?\' + $SRC, '\\?\' + $p, $true) }
    $r = Try-Open $p
    $probe += "$($p.Length) chars : $(if($r.ok){'OPEN'}else{'FAIL'})"
    if ($r.ok) { if ($p.Length -gt $lastOk) { $lastOk = $p.Length } }
    else { if ($p.Length -lt $firstNg) { $firstNg = $p.Length } }
    try { [System.IO.File]::Delete('\\?\' + $p) } catch {}
  }

  # place the artifact: longest Japanese name that stays at or under $lastOk
  $tok = '長いファイル名の境界試験'
  $n = 1
  while ((($DIR.Length + 1 + ($tok.Length * ($n + 1)) + 5)) -le $lastOk) { $n++ }
  $name = ($tok * $n) + '.xlsm'
  $final = Join-Path $DIR $name
  if (-not [System.IO.File]::Exists('\\?\' + $final)) { [System.IO.File]::Copy('\\?\' + $SRC, '\\?\' + $final, $true) }
  $r = Try-Open $final
  $probe += "FINAL $($final.Length) chars / ファイル名 $($name.Length) 文字 : $(if($r.ok){'OPEN'}else{'FAIL'}) macro=$($r.ran)"

  # drop the 257-char intermediate that neither Excel nor the product can use
  $mid = Join-Path $DIR (($tok * 15) + '.xlsm')
  if ($mid -ne $final -and [System.IO.File]::Exists('\\?\' + $mid)) { [System.IO.File]::Delete('\\?\' + $mid) }

  $op = Join-Path $ORA 'B05.json'
  $o = Get-Content $op -Raw | ConvertFrom-Json
  $o.file = "b05\$name"
  $o | Add-Member -NotePropertyName fullPathLength -NotePropertyValue $final.Length -Force
  $o | Add-Member -NotePropertyName fileNameLength -NotePropertyValue $name.Length -Force
  $o | Add-Member -NotePropertyName environmentLimits -NotePropertyValue @{
    excelLongestOpened = $lastOk
    excelShortestRefused = $firstNg
    maxPathOverVariant = @{ file = 'b05\' + (($tok * 16) + '.xlsm'); fullPathLength = $SRC.Length; usable = $false }
    note = 'Excel は実測 ' + $lastOk + ' 文字まで開き ' + $firstNg + ' 文字で失敗。218文字という通説とは一致しない'
  } -Force
  $o | Add-Member -NotePropertyName why -NotePropertyValue (
    "深いパス＋長いファイル名の境界。証跡ルートが 71 文字あるため、MATRIX の「200文字級のファイル名」は " +
    "Excel が開ける全長に収まらない。現物は開ける最長（全長 $($final.Length) / ファイル名 $($name.Length) 文字）に置き、" +
    "200文字級のファイル名そのものは画面7の出力ファイル名（長大）で検査する。" +
    "全長 $($SRC.Length) 文字の変種も b05\ に残してあるが Excel も .NET も開けない（MAX_PATH 超）") -Force
  [System.IO.File]::WriteAllText($op, ($o | ConvertTo-Json -Depth 8), (New-Object System.Text.UTF8Encoding($true)))
}
finally {
  try { $xl.Quit() } catch {}
  [void][Runtime.InteropServices.Marshal]::ReleaseComObject($xl)
}

$probe | ForEach-Object { $_ }
''
"境界: 開けた最長 = $lastOk / 開けなかった最短 = $firstNg"
'b05 の現物:'
Get-ChildItem $DIR | ForEach-Object { "  $($_.Name.Length) 文字: $($_.Name.Substring(0,[Math]::Min(30,$_.Name.Length)))..." }
