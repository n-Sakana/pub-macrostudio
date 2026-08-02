# smoke-corpus.ps1 - open every corpus book, run its entryMacro, check postRun.
#
# This is the "doubt your own oracle" pass: a generated book that does not
# actually compile and run is a harness defect, not a product finding.
# Only entryMacro is ever called. Anything an oracle lists under extra.doNotRun
# is never touched.
#
#   powershell -NoProfile -ExecutionPolicy Bypass -STA -File smoke-corpus.ps1 [ID ...]

param([string[]]$Only)

$ErrorActionPreference = 'Stop'
# Portable bundle: this file lives in <repo>\qa\run01-blackbox\lib, so the run
# root is the folder above it and the product repo is two levels above that.
$RUN  = Split-Path -Parent $PSScriptRoot
$REPO = Split-Path -Parent (Split-Path -Parent $RUN)
$OUT = Join-Path $RUN 'corpus\books'
$ORA = Join-Path $RUN 'corpus\oracles'

$xl = New-Object -ComObject Excel.Application
$xl.Visible = $false; $xl.DisplayAlerts = $false; $xl.EnableEvents = $true
$xl.AutomationSecurity = 1     # this instance only - never the Trust Center

$pass = @(); $fail = @(); $skip = @()
try {
  foreach ($of in (Get-ChildItem (Join-Path $ORA '*.json') | Sort-Object Name)) {
    $or = Get-Content $of.FullName -Raw | ConvertFrom-Json
    if ($Only -and ($Only -notcontains $or.id)) { continue }
    if (-not $or.entryMacro) { $skip += "$($or.id) (入口マクロ無し・受理拒否試料)"; continue }

    $book = Join-Path $OUT $or.file
    $openPath = if ($book.Length -ge 250) { '\\?\' + $book } else { $book }
    if (-not [System.IO.File]::Exists('\\?\' + $book)) { $fail += "$($or.id): 現物が無い"; continue }

    $wb = $null
    try {
      $wb = $xl.Workbooks.Open($openPath, 0, $false)   # UpdateLinks=0, ReadOnly=false
      $target = "'" + $wb.Name + "'!" + $or.entryMacro
      $xl.Run($target) | Out-Null
      $ok = $true; $detail = @()
      foreach ($p in @($or.postRun)) {
        if (-not $p.cell) { continue }
        $got = $wb.Worksheets($p.sheet).Range($p.cell).Text
        if ("$got" -ne "$($p.equals)") { $ok = $false; $detail += "$($p.sheet)!$($p.cell)='$got' expected '$($p.equals)'" }
      }
      $modCount = $wb.VBProject.VBComponents.Count
      $wb.Close($false); $wb = $null
      if ($ok) { $pass += "$($or.id)  entry=$($or.entryMacro)  components=$modCount" }
      else { $fail += "$($or.id): $($detail -join '; ')" }
    } catch {
      $fail += "$($or.id): $($_.Exception.Message)"
      if ($wb) { try { $wb.Close($false) } catch {} }
    }
  }
} finally {
  try { $xl.Quit() } catch {}
  [void][Runtime.InteropServices.Marshal]::ReleaseComObject($xl)
}

"PASS ($($pass.Count)):"; $pass | ForEach-Object { "  $_" }
''
"SKIP ($($skip.Count)):"; $skip | ForEach-Object { "  $_" }
''
"FAIL ($($fail.Count)):"; $fail | ForEach-Object { "  $_" }
