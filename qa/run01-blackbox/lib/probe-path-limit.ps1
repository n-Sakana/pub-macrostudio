# probe-path-limit.ps1 - measure the longest full path Excel will actually open.
#
# B05 failed at 257 characters, which is under MAX_PATH, so MAX_PATH is not the
# blocker. Rather than quote a number from memory, this bisects the real limit
# on this machine with real files and a real Excel instance.
#
#   powershell -NoProfile -ExecutionPolicy Bypass -STA -File probe-path-limit.ps1

$ErrorActionPreference = 'Stop'
# Portable bundle: this file lives in <repo>\qa\run01-blackbox\lib, so the run
# root is the folder above it and the product repo is two levels above that.
$RUN  = Split-Path -Parent $PSScriptRoot
$REPO = Split-Path -Parent (Split-Path -Parent $RUN)
$OUT = Join-Path $RUN 'corpus\books'
$DIR = Join-Path $OUT 'b05'
$SRC = Join-Path $DIR (('長いファイル名の境界試験' * 16) + '.xlsm')

$xl = New-Object -ComObject Excel.Application
$xl.Visible = $false; $xl.DisplayAlerts = $false; $xl.EnableEvents = $false
$xl.AutomationSecurity = 1

$made = @()
function Test-Length([int]$total) {
  # name length so that DIR + '\' + name == total
  $nameLen = $total - $DIR.Length - 1
  if ($nameLen -le 6) { return $null }
  $stem = 'x' * ($nameLen - 5)
  $p = Join-Path $DIR ($stem + '.xlsm')
  if (-not [System.IO.File]::Exists('\\?\' + $p)) {
    [System.IO.File]::Copy('\\?\' + $SRC, '\\?\' + $p, $true)
  }
  $script:made += $p
  $open = $true; $msg = ''
  try {
    $wb = $xl.Workbooks.Open($p, 0, $false)
    try { $xl.Run("'" + $wb.Name + "'!RunLongName") | Out-Null } catch { $msg = 'opened but macro failed' }
    $wb.Close($false)
  } catch { $open = $false; $msg = $_.Exception.Message -replace "`r?`n", ' ' }
  [pscustomobject]@{ Total = $p.Length; Open = $open; Note = $msg }
}

$rows = @()
try {
  foreach ($t in 150, 180, 200, 210, 215, 218, 219, 220, 225, 230, 240, 256) {
    $r = Test-Length $t
    if ($r) { $rows += $r; "$($r.Total.ToString().PadLeft(3)) chars : $(if($r.Open){'OPEN '}else{'FAIL '}) $($r.Note)" }
  }
} finally {
  try { $xl.Quit() } catch {}
  [void][Runtime.InteropServices.Marshal]::ReleaseComObject($xl)
  foreach ($p in $made) { try { [System.IO.File]::Delete('\\?\' + $p) } catch {} }
}

''
$ok = @($rows | Where-Object { $_.Open })
$ng = @($rows | Where-Object { -not $_.Open })
if ($ok.Count) { "最長で開けた: $(($ok | Measure-Object Total -Maximum).Maximum) 文字" }
if ($ng.Count) { "最短で開けなかった: $(($ng | Measure-Object Total -Minimum).Minimum) 文字" }
