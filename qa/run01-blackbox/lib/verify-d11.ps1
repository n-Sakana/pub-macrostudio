# verify-d11.ps1 - independent check of the D11 build.
#
# D11 puts the same fixed path in three standard modules, and this run also
# used screen 6's [reflect the fix] to append a marker comment to PathA. The
# product's own re-read is not evidence (HANDOFF section 10), so: open in real
# Excel, compile, run the entry macro, close, reopen, and check again.
#   -Book <path>   check a specific build; otherwise the newest D11 export
param([string]$Book)

$ErrorActionPreference = 'Continue'
$REPO = Split-Path -Parent (Split-Path -Parent (Split-Path -Parent $PSScriptRoot))
if (-not $Book) {
  $dir = Get-ChildItem -LiteralPath (Join-Path $REPO 'exports') -Directory -ErrorAction SilentlyContinue |
         Where-Object { $_.Name -like 'D11_*' } |
         Sort-Object CreationTime -Descending | Select-Object -First 1
  if (-not $dir) { throw 'no D11 export folder found - run the D11 route through the GUI first' }
  $Book = (Get-ChildItem -LiteralPath $dir.FullName -Filter '*-Modified-*.xlsm' |
           Select-Object -First 1).FullName
}
$book = $Book
"checking $book"
$OLD  = 'S:\eigyo\shinsei\'
$NEW  = 'E:\eigyo\shinsei\'
$MARK = 'QA-REFLECT-MARK-D11'

function Inspect($wb, [string]$phase) {
  $names = @(); $withNew = @(); $withOld = @(); $withMark = @()
  foreach ($c in $wb.VBProject.VBComponents) {
    $names += $c.Name
    $cm = $c.CodeModule
    if ($cm.CountOfLines -gt 0) {
      $t = $cm.Lines(1, $cm.CountOfLines)
      if ($t -match [regex]::Escape($NEW))  { $withNew  += $c.Name }
      if ($t -match [regex]::Escape($OLD))  { $withOld  += $c.Name }
      if ($t -match [regex]::Escape($MARK)) { $withMark += $c.Name }
    }
  }
  "[$phase] components      : $($names -join ', ')"
  "[$phase] new path in     : $($withNew -join ', ')   (expect PathA, PathB, PathC)"
  "[$phase] OLD path still  : $($withOld -join ', ')   (expect empty)"
  "[$phase] reflect mark in : $($withMark -join ', ')  (expect PathA)"
}

$xl = New-Object -ComObject Excel.Application
$xl.Visible = $false; $xl.DisplayAlerts = $false; $xl.EnableEvents = $false
$xl.AutomationSecurity = 1   # msoAutomationSecurityLow, this instance only

try {
  $wb = $xl.Workbooks.Open($book, 0, $false)
  Inspect $wb 'open-1'

  # compile: VBE reports a project-wide compile through the command bar id 578
  try {
    $xl.VBE.CommandBars.FindControl($null, 578).Execute()
    "[open-1] compile command executed"
  } catch { "[open-1] compile command unavailable: $($_.Exception.Message)" }

  try {
    $xl.Run("'" + $wb.Name + "'!RunThree")
    $v = $wb.Worksheets('作業').Range('B2').Value2
    "[open-1] RunThree ran, 作業!B2 = '$v'  (expect 三箇所済み)"
  } catch { "[open-1] RunThree FAILED: $($_.Exception.Message)" }

  # the entry macro writes a cell, so save before closing, then reopen
  $wb.Save()
  $wb.Close($false)

  $wb2 = $xl.Workbooks.Open($book, 0, $false)
  Inspect $wb2 'reopen'
  $v2 = $wb2.Worksheets('作業').Range('B2').Value2
  "[reopen] 作業!B2 = '$v2'"
  $wb2.Close($false)
}
catch { "FAILED: $($_.Exception.Message)" }
finally {
  try { $xl.Quit() } catch {}
  [void][Runtime.InteropServices.Marshal]::ReleaseComObject($xl)
}
