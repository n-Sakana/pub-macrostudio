# probe-con-content.ps1 - PROD-12 follow-up. Excel refused CON.xlsm, but that
# could mean either "the bytes are broken" or "the name is unreachable". Copy
# the same bytes to an ordinary name and open that. If it opens, the build
# produced a correct workbook under a name the user cannot use.
#   -Src <path>  a CON.xlsm produced by a build. Without it, the newest one.
param([string]$Src)

$ErrorActionPreference = 'Continue'
$REPO = Split-Path -Parent (Split-Path -Parent (Split-Path -Parent $PSScriptRoot))
if (-not $Src) {
  $d = Get-ChildItem -LiteralPath (Join-Path $REPO 'exports') -Directory -ErrorAction SilentlyContinue |
       Where-Object { Get-ChildItem -LiteralPath $_.FullName -Filter 'CON.xlsm' -Force -ErrorAction SilentlyContinue } |
       Sort-Object CreationTime -Descending | Select-Object -First 1
  if (-not $d) { throw 'no export folder with a CON.xlsm - reproduce PROD-12 through the GUI first' }
  $Src = Join-Path $d.FullName 'CON.xlsm'
}
$src = $Src
$scr = Join-Path $env:TEMP 'macrostudio-qa'
if (-not (Test-Path $scr)) { New-Item -ItemType Directory -Force $scr | Out-Null }
$dst = Join-Path $scr 'con_bytes_renamed.xlsm'

$bytes = [System.IO.File]::ReadAllBytes($src)
[System.IO.File]::WriteAllBytes($dst, $bytes)
"copied $($bytes.Length) bytes -> $dst"

$xl = New-Object -ComObject Excel.Application
$xl.Visible = $false; $xl.DisplayAlerts = $false; $xl.EnableEvents = $false
$xl.AutomationSecurity = 3
try {
  $wb = $xl.Workbooks.Open($dst, 0, $true)
  "OPEN OK: $($wb.Name)  modules=$($wb.VBProject.VBComponents.Count)"
  $hit = 0; $old = 0
  foreach ($c in $wb.VBProject.VBComponents) {
    $cm = $c.CodeModule
    if ($cm.CountOfLines -gt 0) {
      $t = $cm.Lines(1, $cm.CountOfLines)
      if ($t -match [regex]::Escape('E:\eigyo\shinsei\')) { $hit++ }
      if ($t -match [regex]::Escape('S:\eigyo\shinsei\')) { $old++ }
    }
  }
  "modules containing the NEW path E:\eigyo\shinsei\ : $hit"
  "modules still containing OLD path S:\eigyo\shinsei\: $old"
  $wb.Close($false)
} catch { "OPEN FAILED: $($_.Exception.Message)" }
finally {
  try { $xl.Quit() } catch {}
  [void][Runtime.InteropServices.Marshal]::ReleaseComObject($xl)
}

"== can the user get rid of it? =="
try { Remove-Item -LiteralPath $src -ErrorAction Stop; "Remove-Item OK" }
catch { "Remove-Item FAILED: $($_.Exception.GetType().Name): $($_.Exception.Message)" }
try { Rename-Item -LiteralPath $src -NewName 'CON_renamed.xlsm' -ErrorAction Stop; "Rename-Item OK" }
catch { "Rename-Item FAILED: $($_.Exception.GetType().Name): $($_.Exception.Message)" }
