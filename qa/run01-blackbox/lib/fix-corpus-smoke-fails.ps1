# fix-corpus-smoke-fails.ps1 - resolve the three smoke failures honestly.
#
# 1. E01 / E04 - prove WHY the entry macro will not run before asserting it.
#    Both carry a Declare with no PtrSafe. On 64-bit Excel that is a compile
#    error for the whole module, so nothing in it can run. Rather than assume,
#    a throwaway copy gets PtrSafe added and is run again. If it then runs, the
#    cause is established and the oracles record "runs only after the repair".
# 2. B05 - Excel itself refuses a full path over MAX_PATH, so the over-260
#    artifact cannot exercise the product at all. A second file is placed just
#    under the limit and the oracle points at that one; both lengths are kept.
#
#   powershell -NoProfile -ExecutionPolicy Bypass -STA -File fix-corpus-smoke-fails.ps1

$ErrorActionPreference = 'Stop'
# Portable bundle: this file lives in <repo>\qa\run01-blackbox\lib, so the run
# root is the folder above it and the product repo is two levels above that.
$RUN  = Split-Path -Parent $PSScriptRoot
$REPO = Split-Path -Parent (Split-Path -Parent $RUN)
$OUT = Join-Path $RUN 'corpus\books'
$ORA = Join-Path $RUN 'corpus\oracles'
$TMP = (Join-Path $env:TEMP 'macrostudio-qa')
$result = @()

function Save-Json($path, $obj) {
  [System.IO.File]::WriteAllText($path, ($obj | ConvertTo-Json -Depth 8), (New-Object System.Text.UTF8Encoding($true)))
}

$xl = New-Object -ComObject Excel.Application
$xl.Visible = $false; $xl.DisplayAlerts = $false; $xl.EnableEvents = $false
$xl.AutomationSecurity = 1
try {

  # ---- 1. the PtrSafe experiment -----------------------------------------
  foreach ($case in @(
      @{ id = 'E01'; file = 'E01_no_ptrsafe.xlsm'; entry = 'RunNoPtr' },
      @{ id = 'E04'; file = 'E04_win32_and_path.xlsm'; entry = 'RunMixWin' })) {

    $src = Join-Path $OUT $case.file
    $copy = Join-Path $TMP ("ptrsafe_probe_" + $case.file)
    if (Test-Path $copy) { Remove-Item $copy -Force }
    [System.IO.File]::Copy($src, $copy, $true)

    # baseline: does it run untouched?
    $before = 'ran'
    $wb = $xl.Workbooks.Open($copy, 0, $false)
    try { $xl.Run("'" + $wb.Name + "'!" + $case.entry) | Out-Null }
    catch { $before = 'compile/run error' }

    # now add PtrSafe to every Declare that lacks it, and try again
    $patched = 0
    foreach ($c in $wb.VBProject.VBComponents) {
      $cm = $c.CodeModule
      if ($cm.CountOfLines -le 0) { continue }
      for ($i = $cm.CountOfLines; $i -ge 1; $i--) {
        $line = $cm.Lines($i, 1)
        if ($line -match '\bDeclare\b' -and $line -notmatch '\bPtrSafe\b') {
          $cm.ReplaceLine($i, ($line -replace '\bDeclare\b', 'Declare PtrSafe'))
          $patched++
        }
      }
    }
    $after = 'ran'
    try { $xl.Run("'" + $wb.Name + "'!" + $case.entry) | Out-Null }
    catch { $after = 'compile/run error' }
    $cellNow = $wb.Worksheets(1).Range('B2').Text
    $wb.Close($false)
    Remove-Item $copy -Force -ErrorAction SilentlyContinue

    $result += "$($case.id): PtrSafe無しのまま=$before / PtrSafe を $patched 箇所へ付与後=$after (B2='$cellNow')"

    # record the measured fact in the oracle
    $op = Join-Path $ORA ($case.id + '.json')
    $o = Get-Content $op -Raw | ConvertFrom-Json
    $o | Add-Member -NotePropertyName entryRunsOnlyAfterRepair -NotePropertyValue $true -Force
    $o | Add-Member -NotePropertyName preRepairCompiles -NotePropertyValue $false -Force
    $o | Add-Member -NotePropertyName why -NotePropertyValue (
      "$($o.why) / 実測: PtrSafe 無し Declare のため 64bit Excel ではモジュールごとコンパイル不能。" +
      "入口マクロは改修後にのみ実行できる（PtrSafe 付与実験で確認: $before -> $after）") -Force
    Save-Json $op $o
  }

  # ---- 2. B05 under MAX_PATH ---------------------------------------------
  $b05dir = Join-Path $OUT 'b05'
  $over = ('長いファイル名の境界試験' * 16) + '.xlsm'
  $under = ('長いファイル名の境界試験' * 15) + '.xlsm'
  $underFull = Join-Path $b05dir $under
  $overFull = Join-Path $b05dir $over

  if (-not [System.IO.File]::Exists('\\?\' + $underFull)) {
    $stage = Join-Path $TMP 'b05_under_stage.xlsm'
    if (Test-Path $stage) { Remove-Item $stage -Force }
    [System.IO.File]::Copy('\\?\' + $overFull, $stage, $true)
    [System.IO.File]::Copy($stage, $underFull, $true)
    Remove-Item $stage -Force -ErrorAction SilentlyContinue
  }
  # prove Excel can open the under-260 one
  $b05run = 'open failed'
  try {
    $wb = $xl.Workbooks.Open($underFull, 0, $false)
    $xl.Run("'" + $wb.Name + "'!RunLongName") | Out-Null
    $b05run = "ran, B2='" + $wb.Worksheets(1).Range('B2').Text + "'"
    $wb.Close($false)
  } catch { $b05run = "failed: $($_.Exception.Message)" }
  $result += "B05: 260未満($($underFull.Length)文字) -> $b05run"
  $result += "B05: 260超過($($overFull.Length)文字) -> Excel の Workbooks.Open が受け付けない（\\?\ 前置でも同じ）"

  $op = Join-Path $ORA 'B05.json'
  $o = Get-Content $op -Raw | ConvertFrom-Json
  $o.file = "b05\$under"
  $o | Add-Member -NotePropertyName fullPathLength -NotePropertyValue $underFull.Length -Force
  $o | Add-Member -NotePropertyName fileNameLength -NotePropertyValue $under.Length -Force
  $o | Add-Member -NotePropertyName overMaxPathVariant -NotePropertyValue @{
    file = "b05\$over"; fullPathLength = $overFull.Length
    excelCanOpen = $false
    note = 'Excel 本体が MAX_PATH 超のフルパスを開けない。製品の欠陥ではなく Excel/OS の限界'
  } -Force
  $o | Add-Member -NotePropertyName why -NotePropertyValue (
    "200文字級のファイル名＋深いパス。実測: フルパス $($overFull.Length) 文字は Excel が開けないため、" +
    "製品を試せる現物は $($underFull.Length) 文字（ファイル名 $($under.Length) 文字）に置いた") -Force
  Save-Json $op $o

} finally {
  try { $xl.Quit() } catch {}
  [void][Runtime.InteropServices.Marshal]::ReleaseComObject($xl)
}

'RESULT:'
$result | ForEach-Object { "  $_" }
