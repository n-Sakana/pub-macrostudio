# Oracle check for a generated workbook (V3/V4/V7/V8/V9/V10).
# Uses its own hidden Excel instance and closes only that one.
param(
  [Parameter(Mandatory)][string]$Original,
  [Parameter(Mandatory)][string]$Modified,
  [string]$EntryMacro = '',
  [string]$CheckSheet = '',
  [string]$CheckCell  = '',
  [string]$Expected   = '',
  [string[]]$MustContain = @(),
  [string[]]$MustNotContain = @()
)

$ErrorActionPreference = 'Stop'

function Get-Modules($xl, $path) {
  $wb = $xl.Workbooks.Open($path, $false, $true)   # no update links, read-only
  $map = @{}
  foreach ($c in $wb.VBProject.VBComponents) {
    $cm = $c.CodeModule
    $text = ''
    if ($cm.CountOfLines -gt 0) { $text = $cm.Lines(1, $cm.CountOfLines) }
    $map[$c.Name] = @{ Type = [int]$c.Type; Code = $text }
  }
  $sheets = @($wb.Worksheets | ForEach-Object { $_.Name })
  $wb.Close($false)
  return @{ Modules = $map; Sheets = $sheets }
}

$xl = New-Object -ComObject Excel.Application
$xl.Visible = $false
$xl.DisplayAlerts = $false
$xl.EnableEvents = $false
$fail = @()
try {
  $orig = Get-Modules $xl $Original
  $mod  = Get-Modules $xl $Modified

  # V8 structure: same module set, same types, same sheets
  $on = ($orig.Modules.Keys | Sort-Object) -join ','
  $mn = ($mod.Modules.Keys  | Sort-Object) -join ','
  if ($on -ne $mn) { $fail += "MODULE SET differs: [$on] vs [$mn]" }
  else { "OK  module set preserved ($mn)" }

  $os = ($orig.Sheets | Sort-Object) -join ','
  $ms = ($mod.Sheets  | Sort-Object) -join ','
  if ($os -ne $ms) { $fail += "SHEETS differ: [$os] vs [$ms]" } else { "OK  sheets preserved ($ms)" }

  foreach ($k in $orig.Modules.Keys) {
    if ($mod.Modules.ContainsKey($k) -and $orig.Modules[$k].Type -ne $mod.Modules[$k].Type) {
      $fail += "MODULE TYPE differs for ${k}"
    }
  }

  # V3 mustFix / V4 mustPreserve on the whole VBA text
  $allMod = ($mod.Modules.Keys | Sort-Object | ForEach-Object { $mod.Modules[$_].Code }) -join "`n"
  foreach ($s in $MustContain) {
    if ($allMod -like "*$s*") { "OK  present: $s" } else { $fail += "MISSING (mustFix): $s" }
  }
  foreach ($s in $MustNotContain) {
    if ($allMod -like "*$s*") { $fail += "STILL PRESENT (must be gone): $s" } else { "OK  absent: $s" }
  }

  # V4: every module that was not supposed to change is byte-identical
  foreach ($k in $orig.Modules.Keys) {
    if (-not $mod.Modules.ContainsKey($k)) { continue }
    $a = $orig.Modules[$k].Code
    $b = $mod.Modules[$k].Code
    if ($a -ne $b) { "CHANGED module: $k" } else { "OK  unchanged module: $k" }
  }

  # V9 compile + V10 run
  if ($EntryMacro) {
    $wb = $xl.Workbooks.Open($Modified, $false, $false)
    try {
      $xl.Run("$($wb.Name)!$EntryMacro") | Out-Null
      "OK  entry macro ran: $EntryMacro"
      if ($CheckSheet -and $CheckCell) {
        $actual = [string]$wb.Worksheets($CheckSheet).Range($CheckCell).Value2
        if ($actual -eq $Expected) { "OK  $CheckSheet!$CheckCell = '$actual'" }
        else { $fail += "CELL MISMATCH $CheckSheet!$CheckCell expected='$Expected' actual='$actual'" }
      }
    } catch {
      $fail += "ENTRY MACRO FAILED: $($_.Exception.Message)"
    } finally {
      $wb.Close($false)
    }
  }
} finally {
  $xl.Quit()
  [void][Runtime.InteropServices.Marshal]::ReleaseComObject($xl)
}

if ($fail.Count -gt 0) {
  "--- FAILURES ($($fail.Count)) ---"
  $fail | ForEach-Object { "  $_" }
  exit 1
}
"ALL ORACLE CHECKS PASSED"
