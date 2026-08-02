# route-to-screen7.ps1 - drive a book through the table-replacement route as
# far as screen 7 (output name), which is the shortest way to reach the build
# stage without waiting on a blind AI reply.
#
#   0 attach -> 1 skip diagnosis -> 3 preset 02 -> 4 replace -> 6 diff -> 7
#
# Coordinates are for the 1920x1020 window this machine uses; see
# lib\fit-window.ps1. They were read off captures, not guessed.
param(
  [string]$Book = '',
  [string]$Value = 'E:\eigyo\shinsei\',
  [string]$Prefix = 'N_route'
)
$RUN = Split-Path -Parent $PSScriptRoot
. "$RUN\lib\act.ps1"

if (-not $Book) { $Book = Join-Path $RUN 'samples\S01_fixed_drive.xlsm' }

$NEXT   = @(1810, 970)
$DROP   = @(960, 397)
$SKIP   = @(295, 755)
$PRESET = @(295, 367)   # 02 固定パスを新環境へ置き換える
$VALUE  = @(920, 495)

# The first click after the window takes focus is eaten as the activation
# click and never reaches WebView2 (HANDOFF section 6, trap 1).
try { Tap 960 200 'warm-up' | Out-Null } catch {}
Start-Sleep -Milliseconds 700

Open-FileDialog $DROP[0] $DROP[1] 'drop zone'
Answer-Dialog $Book
Start-Sleep -Seconds 3
Shot "${Prefix}_00_attached"

Tap $NEXT[0] $NEXT[1] 'to screen 1' | Out-Null
Start-Sleep -Seconds 3
Tap $SKIP[0] $SKIP[1] 'skip diagnosis' | Out-Null
Start-Sleep -Seconds 2
Tap $NEXT[0] $NEXT[1] 'to screen 3' | Out-Null
Start-Sleep -Seconds 3
Tap $PRESET[0] $PRESET[1] 'preset 02' | Out-Null
Start-Sleep -Seconds 2
Tap $NEXT[0] $NEXT[1] 'to screen 4' | Out-Null
Start-Sleep -Seconds 3
Shot "${Prefix}_01_screen4"

# One click here is not reliable. A click that only re-activates the WebView
# leaves the input unfocused, TypeText goes nowhere, [次へ] stays disabled, and
# every later step in this script then operates on screen 4 while the log still
# reads as if it advanced. Click the field twice, with a pause, before typing.
Tap $VALUE[0] $VALUE[1] 'replacement value (focus)' | Out-Null
Start-Sleep -Milliseconds 800
Tap $VALUE[0] $VALUE[1] 'replacement value (caret)' | Out-Null
Start-Sleep -Milliseconds 600
PressKey -K 'a' -Mod @('CTRL') | Out-Null
Start-Sleep -Milliseconds 250
TypeText $Value | Out-Null
Start-Sleep -Seconds 2
Shot "${Prefix}_01b_value_typed"

Tap $NEXT[0] $NEXT[1] 'to screen 6' | Out-Null
Start-Sleep -Seconds 4
Shot "${Prefix}_02_screen6"

Tap $NEXT[0] $NEXT[1] 'to screen 7' | Out-Null
Start-Sleep -Seconds 3
Shot "${Prefix}_03_screen7"
"reached screen 7"
