# _n02_attach.ps1 - attach one book on screen 0 and capture the result.
#
# Coordinates are for the 1920x1020 window this machine uses (see
# lib\fit-window.ps1 and the note coordinate table in HANDOFF-4). They are read
# off shots\N_001_screen0_fitted.png, not guessed.
param(
  [Parameter(Mandatory = $true)][string]$Book,
  [string]$Name = 'N_attach',
  [int]$X = 0,      # explicit attach control position; 0 means use the defaults
  [int]$Y = 0,
  [switch]$Loaded   # a book is already loaded, so the control is [選び直す]
)
$RUN = Split-Path -Parent $PSScriptRoot
. "$RUN\lib\act.ps1"

# Spend the activation click on empty space: the first click after the window
# comes to the foreground never reaches WebView2 (HANDOFF section 6, trap 1).
try { Tap 960 200 'warm-up' | Out-Null } catch {}
Start-Sleep -Milliseconds 700

if ($X -gt 0) {
  # Read off a capture for this exact screen state - a refusal banner moves the
  # card down, so there is no single right answer here.
  Open-FileDialog $X $Y 'attach (explicit)'
} elseif ($Loaded) {
  # [選び直す] at the top right of the loaded-book card, no banner above it.
  Open-FileDialog 1434 397 'choose again'
} else {
  Open-FileDialog 960 397 'drop zone'
}
Answer-Dialog $Book
Start-Sleep -Seconds 3
Shot $Name
