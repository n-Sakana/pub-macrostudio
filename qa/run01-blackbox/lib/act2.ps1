# act.ps1 - convenience layer over gui.ps1 for one MacroStudio session.
#
# Coordinates: I read PNG captures that are downscaled from the 2880x1920 window
# capture to 2000x1333 for viewing. SCALE converts a coordinate I read off the
# displayed image back to window pixels; ORIGIN adds the window's screen origin.

# Portable bundle: this file lives in <repo>\qa\run01-blackbox\lib, so the run
# root is the folder above it and the product repo is two levels above that.
$RUN  = Split-Path -Parent $PSScriptRoot
$REPO = Split-Path -Parent (Split-Path -Parent $RUN)
. "$RUN\lib\gui.ps1"

$script:ST = Get-Content "$RUN\logs\app-state-2.json" -Raw | ConvertFrom-Json
$H = [IntPtr]$script:ST.Handle
$APPPID = [int]$script:ST.ProcessId
$SCALE = 1.44

function Sync-Rect {
  $r = Get-Rect $H
  $script:ST.Left = $r.Left; $script:ST.Top = $r.Top
  $script:ST.Width = $r.Width; $script:ST.Height = $r.Height
  $r
}

# displayed-image coords -> absolute screen coords.
# The viewer downscales captures wider than 2000px, so the factor depends on the
# current window width. A fixed 1.44 was only right for a 2880-wide window and
# sent every click to the wrong place once the window was resized.
function CurrentScale {
  $w = [double]$script:ST.Width
  if ($w -le 2000) { return 1.0 }
  return $w / 2000.0
}

function P {
  param([double]$dx, [double]$dy)
  $s = CurrentScale
  [pscustomobject]@{
    X = [int]([Math]::Round($dx * $s)) + [int]$script:ST.Left
    Y = [int]([Math]::Round($dy * $s)) + [int]$script:ST.Top
  }
}

function Focus { $ok = Set-Foreground -Handle $H; if (-not $ok) { throw 'could not bring MacroStudio to foreground' }; Assert-Foreground -Handle $H -What 'focus' }

function Shot {
  param([string]$Name, [switch]$Full)
  $p = Join-Path "$RUN\shots" ($Name + '.png')
  if ($Full) { Save-Shot -Path $p -FullScreen | Out-Null } else { Sync-Rect | Out-Null; Save-Shot -Path $p -Window $H | Out-Null }
  Write-Output "SHOT $Name"
}

# Click at displayed-image coordinates.
# Re-reads the window rect first: WPF moves the window itself when it crosses a
# DPI boundary, and a cached origin then sends clicks to empty desktop.
function Tap {
  param([double]$dx, [double]$dy, [string]$Label = '', [int]$Count = 1)
  Focus
  Sync-Rect | Out-Null
  $pt = P $dx $dy
  $vs = [System.Windows.Forms.SystemInformation]::VirtualScreen
  if ($pt.X -lt $vs.X -or $pt.Y -lt $vs.Y -or
      $pt.X -ge ($vs.X + $vs.Width) -or $pt.Y -ge ($vs.Y + $vs.Height)) {
    throw ("click point ($($pt.X),$($pt.Y)) is off the virtual screen " +
           "$($vs.X),$($vs.Y) $($vs.Width)x$($vs.Height) -- NO INPUT SENT")
  }
  # Same guard as act.ps1: a shrunken window makes a cached coordinate land
  # outside it while still on screen and still foreground, so the click goes
  # to whatever is behind. Refuse instead of clicking blind.
  if ($pt.X -lt $script:ST.Left -or $pt.Y -lt $script:ST.Top -or
      $pt.X -ge ($script:ST.Left + $script:ST.Width) -or
      $pt.Y -ge ($script:ST.Top + $script:ST.Height)) {
    throw ("click point ($($pt.X),$($pt.Y)) is outside the MacroStudio window " +
           "$($script:ST.Left),$($script:ST.Top) " +
           "$($script:ST.Width)x$($script:ST.Height) -- the window resized, " +
           "so this coordinate is stale. Re-capture first. NO INPUT SENT")
  }
  Invoke-RealClick -Window $H -X $pt.X -Y $pt.Y -Count $Count
  Write-Output ("TAP {0} -> screen({1},{2})" -f $Label, $pt.X, $pt.Y)
}

function Wheel {
  param([double]$dx, [double]$dy, [int]$Notches = -3)
  Focus
  $pt = P $dx $dy
  Invoke-RealWheel -Window $H -X $pt.X -Y $pt.Y -Notches $Notches
  Write-Output ("WHEEL {0} at ({1},{2})" -f $Notches, $pt.X, $pt.Y)
}

# NOTE: do not name this "Type" - that is a built-in alias for Get-Content and
# aliases win name resolution, so the call silently became a file read.
function TypeText { param([string]$Text) Focus; Send-RealText -Window $H -Text $Text; Write-Output "TYPE len=$($Text.Length)" }
function PressKey { param([string]$K, [string[]]$Mod = @()) Focus; Send-RealKey -Window $H -Key $K -Modifiers $Mod; Write-Output "KEY $($Mod -join '+')+$K" }

# --- OS file dialog: find it, verify it is foreground, then type. ---
function Wait-Dialog {
  param([int]$TimeoutSec = 20)
  $deadline = (Get-Date).AddSeconds($TimeoutSec)
  while ((Get-Date) -lt $deadline) {
    $d = @(Get-DialogForPid -ProcessId $APPPID)
    if ($d.Count -gt 0) { return $d[0] }
    Start-Sleep -Milliseconds 300
  }
  throw "no #32770 dialog appeared for pid $APPPID within ${TimeoutSec}s"
}

# Opening the OS file dialog needs the click to reach WebView2 content. The
# first click after the window gains foreground is eaten as the activation
# click, so the dialog never opens. Click, look, click again - never blind.
function Open-FileDialog {
  param([double]$dx, [double]$dy, [string]$Label = 'file select', [int]$Attempts = 3)
  for ($i = 1; $i -le $Attempts; $i++) {
    Tap $dx $dy "$Label (attempt $i)"
    Start-Sleep -Milliseconds 1600
    if (@(Get-DialogForPid -ProcessId $APPPID).Count -gt 0) {
      Write-Output "DIALOG opened on attempt $i"
      return
    }
  }
  throw "file dialog did not open after $Attempts clicks at ($dx,$dy)"
}

function Answer-Dialog {
  param([string]$Path, [switch]$Cancel, [int]$TimeoutSec = 20)
  $d = Wait-Dialog -TimeoutSec $TimeoutSec
  $dh = [IntPtr]$d.Handle
  if (-not (Set-Foreground -Handle $dh)) { throw "dialog $dh would not come to the foreground - NOT typing" }
  Assert-Foreground -Handle $dh -What 'file-dialog'
  Start-Sleep -Milliseconds 250
  Save-Shot -Path (Join-Path "$RUN\shots" ("dialog_" + (Get-Date -Format 'HHmmss') + ".png")) -FullScreen | Out-Null
  if ($Cancel) {
    Send-RealKey -Window $dh -Key 'ESC'
    Write-Output "DIALOG cancelled"
  } else {
    Send-RealText -Window $dh -Text $Path -DelayMs 6
    Start-Sleep -Milliseconds 250
    Assert-Foreground -Handle $dh -What 'file-dialog-enter'
    Send-RealKey -Window $dh -Key 'ENTER'
    Write-Output "DIALOG accepted '$Path'"
  }
  Start-Sleep -Milliseconds 900
}

function Clip { Get-RealClipboard }
function SetClip { param([string]$T) Set-RealClipboard -Text $T }

function Save-Text {
  param([string]$Name, [string]$Text)
  $p = Join-Path "$RUN\ai-sessions" $Name
  $d = Split-Path -Parent $p
  if (-not (Test-Path $d)) { New-Item -ItemType Directory -Force $d | Out-Null }
  [System.IO.File]::WriteAllText($p, $Text, (New-Object System.Text.UTF8Encoding($false)))
  $sha = (Get-FileHash -LiteralPath $p -Algorithm SHA256).Hash
  Write-Output "SAVED $Name sha256=$sha len=$($Text.Length)"
}
