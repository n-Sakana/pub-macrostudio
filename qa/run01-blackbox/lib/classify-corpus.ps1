# classify-corpus.ps1 - apply the SHIPPED preset rules to the string literals of
# every corpus book, and compare against each oracle's mustFix / mustPreserve.
#
# Text-only: no screenshots. Reads the real preset file and the real VBA.

$ErrorActionPreference = 'Stop'
# Portable bundle: this file lives in <repo>\qa\run01-blackbox\lib, so the run
# root is the folder above it and the product repo is two levels above that.
$RUN  = Split-Path -Parent $PSScriptRoot
$REPO = Split-Path -Parent (Split-Path -Parent $RUN)
$PRESET = (Join-Path $REPO 'presets\02_改修\02_固定パスを新環境へ置き換える.md')

# --- read the rules exactly as the product parses them -----------------------
$rules = @()
$inSection = $false
foreach ($line in [System.IO.File]::ReadAllLines($PRESET)) {
  if ($line -match '^##\s') { $inSection = ($line -match '置換の候補'); continue }
  if (-not $inSection) { continue }
  if ($line -notmatch '^\s*-\s+') { continue }
  $body = ($line -replace '^\s*-\s+', '')
  # column separator is an UNescaped pipe; "\|" is a literal pipe
  $parts = [regex]::Split($body, '(?<!\\)\|') | ForEach-Object { ($_ -replace '\\\|', '|').Trim() }
  if ($parts.Count -ge 2 -and $parts[0] -and $parts[1]) {
    $rules += [pscustomobject]@{
      Label = $parts[0]
      Pattern = $parts[1]
      Default = ($parts.Count -gt 2 -and $parts[2] -ne '')
    }
  }
}
"rules loaded: $($rules.Count)"
$rules | ForEach-Object { "  $($_.Label)  default=$($_.Default)" }

function Classify([string]$value) {
  foreach ($r in $rules) {
    if ([regex]::IsMatch($value, $r.Pattern)) { return $r }
  }
  return $null
}

# --- pull string literals out of every corpus book ---------------------------
$xl = New-Object -ComObject Excel.Application
$xl.Visible = $false; $xl.DisplayAlerts = $false; $xl.EnableEvents = $false
$xl.AutomationSecurity = 1
$report = @()
try {
  foreach ($o in Get-ChildItem (Join-Path $RUN 'corpus\oracles\*.json')) {
    $or = Get-Content $o.FullName -Raw | ConvertFrom-Json
    $book = Join-Path $RUN ('corpus\books\' + $or.file)
    if (-not (Test-Path $book)) { continue }
    # unreadable/reject samples are not classified here
    if ($or.expect -eq 'boundary') { continue }
    $literals = @()
    try {
      $wb = $xl.Workbooks.Open($book, $false, $true)
      foreach ($c in $wb.VBProject.VBComponents) {
        $cm = $c.CodeModule
        if ($cm.CountOfLines -le 0) { continue }
        foreach ($line in ($cm.Lines(1, $cm.CountOfLines) -split "`r?`n")) {
          if ($line -match "^\s*'") { continue }          # comment line
          foreach ($m in [regex]::Matches($line, '"([^"]*)"')) {
            if ($m.Groups[1].Value -ne '') { $literals += $m.Groups[1].Value }
          }
        }
      }
      $wb.Close($false)
    } catch { $report += "$($or.id): READ FAIL $($_.Exception.Message)"; continue }

    $literals = $literals | Sort-Object -Unique
    $cands = @()
    foreach ($lit in $literals) {
      $r = Classify $lit
      if ($r) { $cands += [pscustomobject]@{ Value = $lit; Label = $r.Label; Default = $r.Default } }
    }

    $problems = @()
    foreach ($need in @($or.mustFix)) {
      if ($need -and -not ($cands | Where-Object { $_.Value -eq $need })) {
        $problems += "mustFix NOT offered: '$need'"
      }
    }
    foreach ($keep in @($or.mustPreserve)) {
      if ($keep -and ($cands | Where-Object { $_.Value -eq $keep })) {
        $problems += "mustPreserve OFFERED as a location: '$keep'"
      }
    }
    $shown = ($cands | ForEach-Object { "$($_.Value)[$($_.Label)$(if($_.Default){'*'})]" }) -join ' | '
    $report += "$($or.id) $($or.file)"
    $report += "   candidates($($cands.Count)): $shown"
    if ($problems.Count) { $problems | ForEach-Object { $report += "   !! $_" } }
    else { $report += "   OK" }
  }
} finally { $xl.Quit(); [void][Runtime.InteropServices.Marshal]::ReleaseComObject($xl) }

''
$report | ForEach-Object { $_ }
''
$bad = @($report | Where-Object { $_ -match '!!' })
"PROBLEMS: $($bad.Count)"
