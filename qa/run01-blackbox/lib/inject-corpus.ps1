# inject-corpus.ps1 - put corpus books through the REAL GUI attach path and
# check the result as text instead of as screenshots.
#
# Every attach makes the product create exports\<stem>_<timestamp>\ containing
# run-manifest.json, whose bookSnapshot.modules is the module inventory the
# product actually read. That is a far better oracle than a picture of the
# screen, and it costs no reading context. Screens are still captured so a
# human can look, but nothing here depends on looking.
#
# Books the product is supposed to refuse (G04/G05/G07/G08/G09) produce no run
# folder; the timeout is the signal, and the shot shows the refusal card.
#
#   powershell -NoProfile -ExecutionPolicy Bypass -STA -File inject-corpus.ps1 [-Only A01,A02]
param([string[]]$Only, [int]$WaitSec = 40)

# Portable bundle: this file lives in <repo>\qa\run01-blackbox\lib, so the run
# root is the folder above it and the product repo is two levels above that.
$RUN  = Split-Path -Parent $PSScriptRoot
$REPO = Split-Path -Parent (Split-Path -Parent $RUN)
. "$RUN\lib\act.ps1"

$EXPORTS = (Join-Path $REPO 'exports')
$BOOKS   = Join-Path $RUN 'corpus\books'
$ORA     = Join-Path $RUN 'corpus\oracles'
$log     = Join-Path $RUN 'logs\inject-corpus.log'
$outJson = Join-Path $RUN 'corpus\inject-results.json'

# id -> file, in the priority order HANDOFF-2 4.2 asks for
$ORDER = @(
  'A04','D08','C05','C07','A08','H01','H02','H04','B05','G01','G02','G03','G07','G09',
  'F06','B02','B04','B06','C01','C02','C03','C04','C06','C08',
  'D02','D03','D04','D05','D06','D07','D09','D10',
  'E01','E02','E03','E04','F01','F02','F03','F04','F05','H03',
  'A01','A02','A03','A06','A07','B01','B03','G04','G05'
)

$fileById = @{}
foreach ($f in Get-ChildItem -LiteralPath $BOOKS -File) {
  $id = ($f.Name -split '_')[0]
  if (-not $fileById.ContainsKey($id)) { $fileById[$id] = $f }
}
# B05 lives in its own subfolder because of its length
$b05dir = Join-Path $BOOKS 'b05'
if (Test-Path $b05dir) {
  $b = Get-ChildItem -LiteralPath $b05dir -File -Filter '*.xlsm' | Select-Object -First 1
  if ($b) { $fileById['B05'] = $b }
}

# powershell.exe -File hands every argument over as a string, so -Only A01,A02
# arrives as the single string "A01,A02" rather than an array. Split it back.
$ids = if ($Only) { @($Only) -split ',' | ForEach-Object { $_.Trim() } | Where-Object { $_ } } else { $ORDER }

function Attach-Book([string]$path) {
  # After a successful attach the control is [choose again] at the top right of
  # the card; with nothing loaded, or after a refusal, it is the drop zone.
  #
  # Everything in here must be piped to Out-Null. Tap and Answer-Dialog write
  # progress with Write-Output, and in PowerShell that lands in the function's
  # return value: the caller then sees a non-empty array, which is always
  # truthy, so a failed attach reported success and the next book was checked
  # against whatever was still loaded.
  # Four candidate positions, because a refusal banner (E-ATTACH-*) stays on
  # screen 0 and pushes the card down by roughly 180px. Guessing one coordinate
  # is how the batch silently attached nothing.
  #   1368,476  [choose again], no banner
  #   1356,654  [choose again], banner present
  #    800,470  empty drop zone, no banner
  #    800,650  empty drop zone, banner present
  foreach ($pt in @(@(1368,476), @(1356,654), @(800,470), @(800,650))) {
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

# ConvertFrom-Json objects differ in shape between the manifest and the corpus
# oracles - some oracles have no "modules" key at all - and asking for a key
# that is not there is not uniformly safe across these object types. Ask the
# property bag instead of the object.
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
      Start-Sleep -Milliseconds 800   # let the writer finish
      return $d
    }
    Start-Sleep -Milliseconds 700
  }
  return $null
}

"=== inject-corpus started $(Get-Date -Format 'HH:mm:ss') ===" |
  Out-File -FilePath $log -Encoding utf8

# Spend the activation click on empty space. The first click after the window
# gains foreground never reaches WebView2 (HANDOFF section 6, trap 1), so
# without this the first book of every batch silently fails to attach and the
# flow is left on the wrong screen for all the books after it.
try { Tap 800 200 'warm-up' | Out-Null } catch {}
Start-Sleep -Milliseconds 800
# and make sure we start from screen 0
for ($k = 0; $k -lt 4; $k++) {
  try { Tap 1285 990 'back to screen0' | Out-Null } catch {}
  Start-Sleep -Milliseconds 900
}

$results = @()
$n = 0
foreach ($id in $ids) {
  $n++
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
      $results += $rec; continue
    }
    $rec.attached = $true
    Start-Sleep -Seconds 2
    try { Shot ("R3_INJ_{0}_{1}" -f $id, $stem) | Out-Null } catch {}

    # The run folder and its manifest are written when the flow reaches screen 1
    # ("diagnosis request prepared"), not on attach. A refused book leaves [next]
    # disabled, so this tap simply does nothing and the wait below times out.
    Tap 1467 990 'next -> screen1 (writes the manifest)'
    Start-Sleep -Seconds 2

    $d = Wait-RunFolder $stem $t0 $WaitSec
    if (-not $d) {
      $rec.verdict = 'NO-RUN-FOLDER'
      "REFUSED?  $id  no run folder within ${WaitSec}s (expected for G04/G05/G07/G08/G09)" |
        Tee-Object -FilePath $log -Append
      # still on screen 0 if refused; if it did advance, step back
      try { Tap 1285 990 'back -> screen0' } catch {}
      Start-Sleep -Seconds 2
      $results += $rec; continue
    }

    $rec.runFolder = $d.Name
    $mf = Get-Content (Join-Path $d.FullName 'run-manifest.json') -Raw -Encoding UTF8 | ConvertFrom-Json
    $rec.totalLines = [int](Get-Prop (Get-Prop $mf 'book') 'totalLines')
    $snap = Get-Prop $mf 'bookSnapshot'
    if ($snap -is [string]) { $snap = $snap | ConvertFrom-Json }
    $rec.modules = @(@(Get-Prop $snap 'modules') | ForEach-Object { Get-Prop $_ 'name' } | Where-Object { $_ })

    # Compare with the corpus oracle where it names modules. Kept in its own
    # try so that a problem in the comparison cannot throw away the inventory
    # we just captured - that data is the point of the run.
    try {
      $oraPath = Join-Path $ORA ($id + '.json')
      if (Test-Path $oraPath) {
        $o = Get-Content $oraPath -Raw -Encoding UTF8 | ConvertFrom-Json
        # @() around every pipeline result: in PS 5.1 an empty pipeline yields
        # $null, and $null.Count throws rather than returning 0.
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

    "{0,-20} {1,-5} lines={2,-6} modules={3}" -f
      $rec.verdict, $id, $rec.totalLines, ($rec.modules -join ',') |
      Tee-Object -FilePath $log -Append

  }
  catch {
    $rec.verdict = 'ERROR'; $rec.note = $_.Exception.Message
    "ERROR $id  $($_.Exception.Message)" | Tee-Object -FilePath $log -Append
  }

  # Always come back to screen 0, including after an error. Leaving the flow on
  # screen 1 has no attach control on it, so every later book in the batch
  # failed with "could not open the file dialog".
  for ($k = 0; $k -lt 2; $k++) {
    try { Tap 1285 990 'back -> screen0' | Out-Null } catch {}
    Start-Sleep -Milliseconds 1200
  }
  $results += $rec
}

$results | ConvertTo-Json -Depth 5 |
  Out-File -FilePath $outJson -Encoding utf8

"" | Out-File -FilePath $log -Append -Encoding utf8
$byVerdict = $results | Group-Object verdict | Sort-Object Count -Descending
foreach ($g in $byVerdict) { "$($g.Name): $($g.Count)" | Tee-Object -FilePath $log -Append }
"=== done $(Get-Date -Format 'HH:mm:ss'), $($results.Count) books ===" | Tee-Object -FilePath $log -Append
