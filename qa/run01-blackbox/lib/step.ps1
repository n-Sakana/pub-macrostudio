# step.ps1 - one or more tap/type/key steps followed by a capture.
#
# Reusable so that exploring a screen does not need a new disposable script per
# click. Steps are given as a single string so that powershell.exe -File can
# carry them (trap 20: -File flattens arrays into one string).
#
#   -Do "tap:1810,970|wait:1500|shot:N_010_screen1"
#
# verbs:
#   tap:X,Y            click at window coordinates (scale is 1.0 here)
#   dbl:X,Y            double click
#   type:TEXT          send real keystrokes to the app
#   key:NAME[+MOD]     send one key, e.g. key:ENTER or key:a+CTRL
#   wheel:X,Y,N        wheel N notches at X,Y (negative scrolls down)
#   wait:MS            sleep
#   shot:NAME          capture the window to shots\NAME.png
#   clip               print the real clipboard
#   setclip:TEXT       put TEXT on the real clipboard
param([Parameter(Mandatory = $true)][string]$Do)

$RUN = Split-Path -Parent $PSScriptRoot
. "$RUN\lib\act.ps1"

foreach ($raw in ($Do -split '\|')) {
  $s = $raw.Trim()
  if (-not $s) { continue }
  $verb = ($s -split ':', 2)[0]
  $arg  = if ($s -like '*:*') { ($s -split ':', 2)[1] } else { '' }

  switch ($verb) {
    'tap' {
      $p = $arg -split ','
      Tap ([double]$p[0]) ([double]$p[1]) "tap($arg)" | Out-Null
      Write-Output "TAP $arg"
    }
    'dbl' {
      $p = $arg -split ','
      Tap ([double]$p[0]) ([double]$p[1]) "dbl($arg)" -Count 2 | Out-Null
      Write-Output "DBL $arg"
    }
    'type'    { TypeText $arg | Out-Null; Write-Output "TYPE len=$($arg.Length)" }
    'key'     {
      $parts = $arg -split '\+'
      $k = $parts[0]
      $mods = @()
      if ($parts.Count -gt 1) { $mods = $parts[1..($parts.Count - 1)] }
      PressKey -K $k -Mod $mods | Out-Null
      Write-Output "KEY $arg"
    }
    'wheel'   {
      $p = $arg -split ','
      Wheel ([double]$p[0]) ([double]$p[1]) ([int]$p[2]) | Out-Null
      Write-Output "WHEEL $arg"
    }
    'wait'    { Start-Sleep -Milliseconds ([int]$arg) }
    'shot'    { Shot $arg | Out-Null; Write-Output "SHOT $arg" }
    'clip'    { Write-Output ("CLIP >>>" + (Clip) + "<<<") }
    'setclip' { SetClip $arg; Write-Output "SETCLIP len=$($arg.Length)" }
    default   { throw "unknown step verb: $verb (in '$s')" }
  }
}
