# launch-app.ps1 - start MacroStudio at a sane size and record the window so
# act.ps1 can drive it.
#
# Everything else in this bundle that touches the GUI reads logs\app-state.json,
# so this has to run first on a fresh machine. 1600x1050: the minimum width is
# clamped to 1350, and staying at or below 2000 keeps act.ps1's CurrentScale at
# 1.0, which means a coordinate read off a capture is a window coordinate with
# no conversion.
$RUN  = Split-Path -Parent $PSScriptRoot
$REPO = Split-Path -Parent (Split-Path -Parent $RUN)
. "$RUN\lib\gui.ps1"

$existing = @(Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" |
              Where-Object { $_.CommandLine -like '*macrostudio.ps1*' })
if ($existing.Count -gt 0) {
  Write-Output "already running: pid $(($existing | ForEach-Object { $_.ProcessId }) -join ', ')"
  Write-Output 'Stop it yourself if you want a clean one - this script will not kill a window it did not open.'
}

$app = Start-MacroStudio -AppDir $REPO
Set-WindowRect -Handle ([IntPtr]$app.Handle) -X 120 -Y 80 -W 1600 -H 1040
Start-Sleep -Seconds 3
$r = Get-Rect ([IntPtr]$app.Handle)

foreach ($d in @("$RUN\logs", "$RUN\shots")) {
  if (-not (Test-Path $d)) { New-Item -ItemType Directory -Force $d | Out-Null }
}
[ordered]@{
  ProcessId = $app.ProcessId; Handle = [int64]$app.Handle
  Title = $app.Title; Class = $app.Class
  Left = $r.Left; Top = $r.Top; Width = $r.Width; Height = $r.Height
} | ConvertTo-Json | Set-Content "$RUN\logs\app-state.json" -Encoding UTF8

"pid=$($app.ProcessId) rect=$($r.Left),$($r.Top) $($r.Width)x$($r.Height)"
"app-state.json written - act.ps1 is ready"
