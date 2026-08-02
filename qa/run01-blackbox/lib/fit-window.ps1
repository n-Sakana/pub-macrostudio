# fit-window.ps1 - size the app to this machine's working area and rewrite
# logs\app-state.json.
#
# Why this exists: HANDOFF-2 fixed the window at 1600x1050 and recorded a
# coordinate table against it. That table cannot be used on this machine. The
# note screen is 1536x864 with an 816px working area, so a 1600x1050 window
# hangs off the bottom and the footer - [戻る] and [次へ] - sits behind the
# taskbar where no click can reach it.
#
# Width stays at or below 2000 so act.ps1's CurrentScale remains 1.0 and a
# coordinate read off a capture is a window coordinate with no conversion.
# SPEC 6.4 clamps the layout at 1350 wide, and 1536 is above that.
param([int]$Margin = 0)

$RUN  = Split-Path -Parent $PSScriptRoot
$REPO = Split-Path -Parent (Split-Path -Parent $RUN)
. "$RUN\lib\gui.ps1"

$st = Get-Content "$RUN\logs\app-state.json" -Raw | ConvertFrom-Json
$h  = [IntPtr]$st.Handle

Add-Type -AssemblyName System.Windows.Forms
$wa = [System.Windows.Forms.Screen]::PrimaryScreen.WorkingArea

$x = $wa.X + $Margin
$y = $wa.Y + $Margin
$w = $wa.Width  - ($Margin * 2)
$h2 = $wa.Height - ($Margin * 2)

Set-WindowRect -Handle $h -X $x -Y $y -W $w -H $h2
Start-Sleep -Seconds 2
$r = Get-Rect $h

[ordered]@{
  ProcessId = $st.ProcessId; Handle = [int64]$st.Handle
  Title = $st.Title; Class = $st.Class
  Left = $r.Left; Top = $r.Top; Width = $r.Width; Height = $r.Height
} | ConvertTo-Json | Set-Content "$RUN\logs\app-state.json" -Encoding UTF8

"working area = $($wa.Width)x$($wa.Height) at $($wa.X),$($wa.Y)"
"window now   = $($r.Width)x$($r.Height) at $($r.Left),$($r.Top)"
if ($r.Width -gt 2000) { "WARNING: width over 2000, act.ps1 will rescale coordinates" }
