param([Parameter(Mandatory)][string]$Book, [string]$Only = '')

$xl = New-Object -ComObject Excel.Application
$xl.Visible = $false; $xl.DisplayAlerts = $false; $xl.EnableEvents = $false
$xl.AutomationSecurity = 1
try {
  $wb = $xl.Workbooks.Open($Book, $false, $true)
  foreach ($c in $wb.VBProject.VBComponents) {
    if ($Only -and $c.Name -ne $Only) { continue }
    $cm = $c.CodeModule
    if ($cm.CountOfLines -le 0) { continue }
    $text = $cm.Lines(1, $cm.CountOfLines)
    if (-not $Only -and $text -notmatch 'Declare|kernel32') { continue }
    "===== $($c.Name) ($($cm.CountOfLines) lines) ====="
    $text
    ''
  }
  $wb.Close($false)
}
finally { $xl.Quit(); [void][Runtime.InteropServices.Marshal]::ReleaseComObject($xl) }
