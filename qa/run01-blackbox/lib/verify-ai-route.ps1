param([Parameter(Mandatory)][string]$Book)

$xl = New-Object -ComObject Excel.Application
$xl.Visible = $false; $xl.DisplayAlerts = $false; $xl.EnableEvents = $false
$xl.AutomationSecurity = 1
$fail = @()
try {
  $wb = $xl.Workbooks.Open($Book, $false, $false)
  'OK  first open, no repair prompt'
  $names = @($wb.VBProject.VBComponents | ForEach-Object { $_.Name })
  "modules: " + ($names -join ', ')

  # ORACLE FIX: the first version matched raw text and hit the AI's own comments
  # ("Win32 API (kernel32 の Sleep) を使わずに…"). A comment saying the API is not
  # used is not a use of the API. Strip full-line comments before judging.
  $code = ''
  $comments = ''
  foreach ($c in $wb.VBProject.VBComponents) {
    $cm = $c.CodeModule
    if ($cm.CountOfLines -le 0) { continue }
    foreach ($line in ($cm.Lines(1, $cm.CountOfLines) -split "`r?`n")) {
      if ($line -match "^\s*'") { $comments += $line + "`n" } else { $code += $line + "`n" }
    }
  }

  # oracle: the Win32 preset was asked to remove the Declare/Sleep dependence
  if ($code -match 'Declare\s+(PtrSafe\s+)?(Sub|Function)\s+Sleep') { $fail += 'STILL HAS: Declare Sleep (executable code)' }
  else { 'OK  no Declare Sleep in executable code' }
  if ($code -match 'kernel32') { $fail += 'STILL HAS: kernel32 (executable code)' }
  else { 'OK  no kernel32 in executable code' }
  if ($code -match '(?m)^\s*Declare\s') { $fail += 'STILL HAS: some Declare statement' }
  else { 'OK  no Declare statement anywhere' }
  if ($comments -match 'kernel32|Declare') { '  (note: kernel32/Declare appear only in comments - not a use)' }

  # entry macro must still run
  $macro = "'" + $wb.Name + "'!AppController.RunApplicationReview"
  try { $xl.Run($macro) | Out-Null; 'OK  entry macro RunApplicationReview executed' }
  catch { $fail += "entry macro failed: $($_.Exception.Message)" }
  $wb.Close($false)

  # reopen and confirm it stuck
  $wb2 = $xl.Workbooks.Open($Book, $false, $true)
  $t2 = ''
  $cm2 = $wb2.VBProject.VBComponents('TimerUtils').CodeModule
  if ($cm2.CountOfLines -gt 0) { $t2 = $cm2.Lines(1, $cm2.CountOfLines) }
  if ($t2 -match 'Declare') { $fail += 'after reopen: Declare still present in TimerUtils' }
  else { 'OK  after reopen, TimerUtils has no Declare' }
  $wb2.Close($false)
}
catch { $fail += "ERR: $($_.Exception.Message)" }
finally { $xl.Quit(); [void][Runtime.InteropServices.Marshal]::ReleaseComObject($xl) }

if ($fail.Count) { '--- FAILURES ---'; $fail | ForEach-Object { "  $_" }; exit 1 }
'ALL AI-ROUTE ORACLE CHECKS PASSED'
