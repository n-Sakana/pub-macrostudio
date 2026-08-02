# inject-corpus-note.ps1 - the run01 corpus injection, adapted for this machine
# and with the gate HANDOFF-3 section 0 asks for.
#
# Two things differ from lib\inject-corpus.ps1, which is left untouched so the
# desktop record stays reproducible:
#
#  1. Coordinates. This screen is 1920x1080 at 125%, so the window is 1920x1020
#     and every coordinate in HANDOFF-2 section 1 is wrong here (FINDINGS
#     ENV-02). Nothing is guessed; these were read off captures.
#
#  2. A stop condition. The original ran to the end no matter what, which is how
#     the third session clicked through thirty books after the layout had
#     already broken (PROD-13). Here, two consecutive failures stop the batch,
#     capture the screen, and say so. One failure is noise; two in a row means
#     the screen is not what this script thinks it is.
#
# Output goes to note-* names so the run01 logs are not overwritten.
#
#   powershell -NoProfile -ExecutionPolicy Bypass -STA -File inject-corpus-note.ps1 -Only G01,G02
param([string[]]$Only, [int]$WaitSec = 30, [int]$StopAfterConsecutiveFails = 2)

$RUN  = Split-Path -Parent $PSScriptRoot
$REPO = Split-Path -Parent (Split-Path -Parent $RUN)
. "$RUN\lib\act.ps1"

$EXPORTS = (Join-Path $REPO 'exports')
$BOOKS   = Join-Path $RUN 'corpus\books'
$ORA     = Join-Path $RUN 'corpus\oracles'
$log     = Join-Path $RUN 'logs\note-inject-corpus.log'
$outJson = Join-Path $RUN 'corpus\note-inject-results.json'

# Books HANDOFF-3 section 3.1 lists as not yet put through the real GUI.
$ORDER = @(
  'G01','G02','G03','G09','F06','B02','B04','B06','C01','C02','C03','C04',
  'C06','C08','D02','D03','D04','D05','D06','D07','D09','D10',
  'E01','E02','E03','E04','F01','F02','F03','F04','F05','H03',
  'A03','A05','A06','A07','B01','B03','G04','G05','G07'
)

# Refusal is the correct outcome for these: no run folder is expected.
$EXPECT_REFUSAL = @('G04','G05','G07','G08','G09')

$fileById = @{}
foreach ($f in Get-ChildItem -LiteralPath $BOOKS -File) {
  $id = ($f.Name -split '_')[0]
  if (-not $fileById.ContainsKey($id)) { $fileById[$id] = $f }
}
$b05dir = Join-Path $BOOKS 'b05'
if (Test-Path $b05dir) {
  $b = Get-ChildItem -LiteralPath $b05dir -File -Filter '*.xlsm' | Select-Object -First 1
  if ($b) { $fileById['B05'] = $b }
}

# powershell.exe -File flattens an array argument into one string (trap 20).
$ids = if ($Only) {
  @($Only) -split ',' | ForEach-Object { $_.Trim() } | Where-Object { $_ }
} else { $ORDER }

$NEXT = @(1810, 970)
$BACK = @(1657, 970)

function Attach-Book([string]$path) {
  # Everything here must be piped to Out-Null: Tap and Answer-Dialog write
  # progress with Write-Output, which in PowerShell joins the return value, so
  # a failed attach would come back as a non-empty (truthy) array.
  #
  # Four candidates, because a refusal banner stays on screen 0 and pushes the
  # card down. Measured on this window, not carried over from the desktop.
  #   1434,397  [選び直す], no banner
  #   1434,546  [選び直す], E-ATTACH banner above the card (measured on
  #             shots\N_INJ_STOP_B02: a refused book leaves the previous card
  #             in place and adds the banner above it, moving the button down
  #             by about 150px - not the 180 the desktop saw)
  #    960,397  empty drop zone, no banner
  #    960,546  empty drop zone, banner present
  #   1434,577  a taller banner (two-line message)
  foreach ($pt in @(@(1434, 397), @(1434, 546), @(960, 397), @(960, 546),
                    @(1434, 577), @(960, 620))) {
    try {
      Tap $pt[0] $pt[1] 'attach' | Out-Null
      Start-Sleep -Milliseconds 1800
      if (@(Get-DialogForPid -ProcessId $APPPID).Count -gt 0) {
        Answer-Dialog $path | Out-Null
        return $true
      }
    } catch { }
  }
  return $false
}

function Get-Prop($o, [string]$name) {
  if ($null -eq $o) { return $null }
  $p = $o.PSObject.Properties[$name]
  if ($p) { return $p.Value }
  return $null
}

function Wait-RunFolder([string]$stem, [datetime]$after, [int]$sec) {
  $deadline = (Get-Date).AddSeconds($sec)
  while ((Get-Date) -lt $deadline) {
    $d = Get-ChildItem -LiteralPath $EXPORTS -Directory -ErrorAction SilentlyContinue |
         Where-Object { $_.Name -like ($stem + '_*') -and $_.CreationTime -gt $after } |
         Sort-Object CreationTime -Descending | Select-Object -First 1
    if ($d -and (Test-Path (Join-Path $d.FullName 'run-manifest.json'))) {
      Start-Sleep -Milliseconds 800
      return $d
    }
    Start-Sleep -Milliseconds 700
  }
  return $null
}

"=== inject-corpus-note started $(Get-Date -Format 'HH:mm:ss') ===" |
  Out-File -FilePath $log -Encoding utf8
"ids: $($ids -join ',')" | Out-File -FilePath $log -Append -Encoding utf8

# Spend the activation click on empty space (trap 1), then make sure we are on
# screen 0 before the first book.
try { Tap 960 200 'warm-up' | Out-Null } catch {}
Start-Sleep -Milliseconds 800
for ($k = 0; $k -lt 5; $k++) {
  try { Tap $BACK[0] $BACK[1] 'back to screen0' | Out-Null } catch {}
  Start-Sleep -Milliseconds 900
}
Shot 'N_INJ_000_start' | Out-Null

$results = @()
$consecutiveFails = 0
$stopped = ''

foreach ($id in $ids) {
  if (-not $fileById.ContainsKey($id)) {
    "SKIP  $id  (no file)" | Tee-Object -FilePath $log -Append
    continue
  }
  $file = $fileById[$id]
  $stem = [IO.Path]::GetFileNameWithoutExtension($file.Name)
  $t0 = Get-Date
  $rec = [ordered]@{ id = $id; file = $file.Name; attached = $false; runFolder = ''
                     modules = @(); totalLines = 0; verdict = ''; note = '' }

  try {
    if (-not (Attach-Book $file.FullName)) {
      $rec.verdict = 'DIALOG-FAILED'
      "FAIL  $id  could not open the file dialog" | Tee-Object -FilePath $log -Append
      $results += $rec
      $consecutiveFails++
      if ($consecutiveFails -ge $StopAfterConsecutiveFails) {
        Shot ("N_INJ_STOP_{0}" -f $id) | Out-Null
        $stopped = $id
        "STOPPED after $consecutiveFails consecutive failures at $id - screen captured as N_INJ_STOP_$id" |
          Tee-Object -FilePath $log -Append
        break
      }
      continue
    }
    $rec.attached = $true
    Start-Sleep -Seconds 2
    try { Shot ("N_INJ_{0}_{1}" -f $id, $stem) | Out-Null } catch {}

    Tap $NEXT[0] $NEXT[1] 'next -> screen1 (writes the manifest)' | Out-Null
    Start-Sleep -Seconds 2

    $d = Wait-RunFolder $stem $t0 $WaitSec
    if (-not $d) {
      if ($EXPECT_REFUSAL -contains $id) {
        $rec.verdict = 'REFUSED-AS-EXPECTED'
        "OK-REFUSED  $id  no run folder within ${WaitSec}s (correct for this book)" |
          Tee-Object -FilePath $log -Append
        $consecutiveFails = 0
      } else {
        $rec.verdict = 'NO-RUN-FOLDER'
        "FAIL  $id  no run folder within ${WaitSec}s (this book should have been accepted)" |
          Tee-Object -FilePath $log -Append
        $consecutiveFails++
      }
      try { Tap $BACK[0] $BACK[1] 'back -> screen0' | Out-Null } catch {}
      Start-Sleep -Seconds 2
      $results += $rec
      if ($consecutiveFails -ge $StopAfterConsecutiveFails) {
        Shot ("N_INJ_STOP_{0}" -f $id) | Out-Null
        $stopped = $id
        "STOPPED after $consecutiveFails consecutive failures at $id - screen captured as N_INJ_STOP_$id" |
          Tee-Object -FilePath $log -Append
        break
      }
      continue
    }

    $rec.runFolder = $d.Name
    $mf = Get-Content (Join-Path $d.FullName 'run-manifest.json') -Raw -Encoding UTF8 | ConvertFrom-Json
    $rec.totalLines = [int](Get-Prop (Get-Prop $mf 'book') 'totalLines')
    $snap = Get-Prop $mf 'bookSnapshot'
    if ($snap -is [string]) { $snap = $snap | ConvertFrom-Json }
    $rec.modules = @(@(Get-Prop $snap 'modules') | ForEach-Object { Get-Prop $_ 'name' } | Where-Object { $_ })

    try {
      $oraPath = Join-Path $ORA ($id + '.json')
      if (Test-Path $oraPath) {
        $o = Get-Content $oraPath -Raw -Encoding UTF8 | ConvertFrom-Json
        $want = @(@(Get-Prop $o 'modules') | ForEach-Object { Get-Prop $_ 'name' } | Where-Object { $_ })
        if (@($want).Count -gt 0) {
          $missing = @($want | Where-Object { @($rec.modules) -notcontains $_ })
          if (@($missing).Count -eq 0) { $rec.verdict = 'OK' }
          else { $rec.verdict = 'MISSING-MODULES'; $rec.note = "missing: $($missing -join ',')" }
        } else { $rec.verdict = 'OK-NO-MODULE-ORACLE' }
      } else { $rec.verdict = 'OK-NO-ORACLE' }
    } catch {
      $rec.verdict = 'READ-OK-COMPARE-FAILED'; $rec.note = $_.Exception.Message
    }

    if ($rec.verdict -like 'OK*') { $consecutiveFails = 0 } else { $consecutiveFails++ }

    "{0,-22} {1,-5} lines={2,-6} modules={3}" -f
      $rec.verdict, $id, $rec.totalLines, ($rec.modules -join ',') |
      Tee-Object -FilePath $log -Append
  }
  catch {
    $rec.verdict = 'ERROR'; $rec.note = $_.Exception.Message
    "ERROR $id  $($_.Exception.Message)" | Tee-Object -FilePath $log -Append
    $consecutiveFails++
  }

  # Always return to screen 0, including after an error: leaving the flow on
  # screen 1 means every later book fails to find an attach control.
  for ($k = 0; $k -lt 2; $k++) {
    try { Tap $BACK[0] $BACK[1] 'back -> screen0' | Out-Null } catch {}
    Start-Sleep -Milliseconds 1200
  }
  $results += $rec

  if ($consecutiveFails -ge $StopAfterConsecutiveFails) {
    Shot ("N_INJ_STOP_{0}" -f $id) | Out-Null
    $stopped = $id
    "STOPPED after $consecutiveFails consecutive failures at $id - screen captured as N_INJ_STOP_$id" |
      Tee-Object -FilePath $log -Append
    break
  }
}

$results | ConvertTo-Json -Depth 5 | Out-File -FilePath $outJson -Encoding utf8

"" | Out-File -FilePath $log -Append -Encoding utf8
foreach ($g in ($results | Group-Object verdict | Sort-Object Count -Descending)) {
  "$($g.Name): $($g.Count)" | Tee-Object -FilePath $log -Append
}
if ($stopped) { "BATCH STOPPED AT: $stopped" | Tee-Object -FilePath $log -Append }
"=== done $(Get-Date -Format 'HH:mm:ss'), $($results.Count) books ===" |
  Tee-Object -FilePath $log -Append
