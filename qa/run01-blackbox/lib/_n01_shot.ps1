# _n01_shot.ps1 - focus the app and take one capture. Disposable.
# Shot captures a screen region, so the window has to be foreground first
# (HANDOFF-3 trap 21) or we photograph whatever is in front of it.
param([string]$Name = 'N_000_start')
$RUN = Split-Path -Parent $PSScriptRoot
. "$RUN\lib\act.ps1"
Focus
Start-Sleep -Milliseconds 600
Shot $Name
