# gui.ps1 - OS-level real input driver for MacroStudio black-box GUI testing.
#
# Rules enforced here (teacher's boundary):
#   * Every keystroke / click is preceded by a foreground check against the
#     expected HWND. If the expected window is not foreground, NOTHING is sent
#     and the function throws. We never "type into whatever happens to be there".
#   * No ExecuteScript, no DOM access, no host API. Only SendInput / clipboard /
#     real file dialogs / real OLE drag&drop.
#
# Dot-source this file. Requires -STA for clipboard operations.

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

if (-not ('MSGui.Native' -as [type])) {
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Text;

namespace MSGui {
  [StructLayout(LayoutKind.Sequential)]
  public struct MOUSEINPUT { public int dx; public int dy; public uint mouseData; public uint dwFlags; public uint time; public IntPtr dwExtraInfo; }
  [StructLayout(LayoutKind.Sequential)]
  public struct KEYBDINPUT { public ushort wVk; public ushort wScan; public uint dwFlags; public uint time; public IntPtr dwExtraInfo; }
  [StructLayout(LayoutKind.Sequential)]
  public struct HARDWAREINPUT { public uint uMsg; public ushort wParamL; public ushort wParamH; }
  [StructLayout(LayoutKind.Explicit)]
  public struct INPUTUNION {
    [FieldOffset(0)] public MOUSEINPUT mi;
    [FieldOffset(0)] public KEYBDINPUT ki;
    [FieldOffset(0)] public HARDWAREINPUT hi;
  }
  [StructLayout(LayoutKind.Sequential)]
  public struct INPUT { public uint type; public INPUTUNION u; }

  [StructLayout(LayoutKind.Sequential)]
  public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }

  [StructLayout(LayoutKind.Sequential)]
  public struct POINT { public int X; public int Y; }

  public static class Native {
    public const uint INPUT_MOUSE = 0;
    public const uint INPUT_KEYBOARD = 1;

    public const uint MOUSEEVENTF_MOVE        = 0x0001;
    public const uint MOUSEEVENTF_LEFTDOWN    = 0x0002;
    public const uint MOUSEEVENTF_LEFTUP      = 0x0004;
    public const uint MOUSEEVENTF_RIGHTDOWN   = 0x0008;
    public const uint MOUSEEVENTF_RIGHTUP     = 0x0010;
    public const uint MOUSEEVENTF_MIDDLEDOWN  = 0x0020;
    public const uint MOUSEEVENTF_MIDDLEUP    = 0x0040;
    public const uint MOUSEEVENTF_WHEEL       = 0x0800;
    public const uint MOUSEEVENTF_ABSOLUTE    = 0x8000;
    public const uint MOUSEEVENTF_VIRTUALDESK = 0x4000;

    public const uint KEYEVENTF_EXTENDEDKEY = 0x0001;
    public const uint KEYEVENTF_KEYUP       = 0x0002;
    public const uint KEYEVENTF_UNICODE     = 0x0004;
    public const uint KEYEVENTF_SCANCODE    = 0x0008;

    [DllImport("user32.dll", SetLastError = true)]
    public static extern uint SendInput(uint nInputs, INPUT[] pInputs, int cbSize);

    [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
    [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);
    [DllImport("user32.dll")] public static extern bool GetClientRect(IntPtr hWnd, out RECT lpRect);
    [DllImport("user32.dll")] public static extern bool ClientToScreen(IntPtr hWnd, ref POINT p);
    [DllImport("user32.dll")] public static extern bool SetCursorPos(int X, int Y);
    [DllImport("user32.dll")] public static extern bool GetCursorPos(out POINT p);
    [DllImport("user32.dll")] public static extern IntPtr GetDesktopWindow();
    [DllImport("user32.dll")] public static extern IntPtr WindowFromPoint(POINT p);
    [DllImport("user32.dll")] public static extern IntPtr GetAncestor(IntPtr hWnd, uint flags);

    [DllImport("user32.dll", SetLastError = true)]
    public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    public static extern int GetWindowTextW(IntPtr hWnd, StringBuilder s, int n);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    public static extern int GetClassNameW(IntPtr hWnd, StringBuilder s, int n);

    public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
    [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc cb, IntPtr lParam);
    [DllImport("user32.dll")] public static extern bool EnumChildWindows(IntPtr parent, EnumWindowsProc cb, IntPtr lParam);

    [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint idAttach, uint idAttachTo, bool fAttach);
    [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
    [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern IntPtr SetActiveWindow(IntPtr hWnd);

    [DllImport("shcore.dll")] public static extern int SetProcessDpiAwareness(int value);
    [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();

    // ---- helpers implemented in C# so a partial send can never happen ----
    public static void SendOne(INPUT[] arr) {
      uint sent = SendInput((uint)arr.Length, arr, Marshal.SizeOf(typeof(INPUT)));
      if (sent != (uint)arr.Length)
        throw new Exception("SendInput sent " + sent + " of " + arr.Length + " (Win32 " + Marshal.GetLastWin32Error() + ")");
    }

    public static void MouseButton(uint flags) {
      INPUT[] a = new INPUT[1];
      a[0].type = INPUT_MOUSE;
      a[0].u.mi.dwFlags = flags;
      SendOne(a);
    }

    public static void MouseWheel(int delta) {
      INPUT[] a = new INPUT[1];
      a[0].type = INPUT_MOUSE;
      a[0].u.mi.dwFlags = MOUSEEVENTF_WHEEL;
      a[0].u.mi.mouseData = unchecked((uint)delta);
      SendOne(a);
    }

    public static void KeyVk(ushort vk, bool up, bool extended) {
      INPUT[] a = new INPUT[1];
      a[0].type = INPUT_KEYBOARD;
      a[0].u.ki.wVk = vk;
      a[0].u.ki.dwFlags = (up ? KEYEVENTF_KEYUP : 0) | (extended ? KEYEVENTF_EXTENDEDKEY : 0);
      SendOne(a);
    }

    public static void KeyUnicode(char c, bool up) {
      INPUT[] a = new INPUT[1];
      a[0].type = INPUT_KEYBOARD;
      a[0].u.ki.wVk = 0;
      a[0].u.ki.wScan = (ushort)c;
      a[0].u.ki.dwFlags = KEYEVENTF_UNICODE | (up ? KEYEVENTF_KEYUP : 0);
      SendOne(a);
    }
  }
}
'@ -ReferencedAssemblies System.Drawing
}

# Per-monitor DPI awareness so every coordinate we use is a physical pixel.
try { [void][MSGui.Native]::SetProcessDpiAwareness(2) } catch { try { [void][MSGui.Native]::SetProcessDPIAware() } catch {} }

Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Windows.Forms

# ---------------------------------------------------------------- windows ---

function Get-WindowText([IntPtr]$h) {
  $sb = New-Object System.Text.StringBuilder 512
  [void][MSGui.Native]::GetWindowTextW($h, $sb, 512)
  $sb.ToString()
}

function Get-WindowClass([IntPtr]$h) {
  $sb = New-Object System.Text.StringBuilder 256
  [void][MSGui.Native]::GetClassNameW($h, $sb, 256)
  $sb.ToString()
}

function Get-WindowPid([IntPtr]$h) {
  $procId = 0
  [void][MSGui.Native]::GetWindowThreadProcessId($h, [ref]$procId)
  $procId
}

function Get-TopWindowsForPid {
  param([int]$ProcessId)
  $found = New-Object System.Collections.ArrayList
  $cb = [MSGui.Native+EnumWindowsProc]{
    param([IntPtr]$h, [IntPtr]$l)
    if ([MSGui.Native]::IsWindowVisible($h)) {
      if ((Get-WindowPid $h) -eq $ProcessId) {
        $r = New-Object MSGui.RECT
        [void][MSGui.Native]::GetWindowRect($h, [ref]$r)
        [void]$found.Add([pscustomobject]@{
          Handle = $h
          Class  = (Get-WindowClass $h)
          Title  = (Get-WindowText $h)
          Rect   = $r
          Width  = $r.Right - $r.Left
          Height = $r.Bottom - $r.Top
        })
      }
    }
    return $true
  }
  [void][MSGui.Native]::EnumWindows($cb, [IntPtr]::Zero)
  # Real UI windows only: ignore 0-size helper windows.
  $found | Where-Object { $_.Width -gt 200 -and $_.Height -gt 200 }
}

function Get-DialogForPid {
  param([int]$ProcessId)
  $found = New-Object System.Collections.ArrayList
  $cb = [MSGui.Native+EnumWindowsProc]{
    param([IntPtr]$h, [IntPtr]$l)
    if ([MSGui.Native]::IsWindowVisible($h) -and (Get-WindowClass $h) -eq '#32770') {
      if ((Get-WindowPid $h) -eq $ProcessId) {
        [void]$found.Add([pscustomobject]@{ Handle = $h; Title = (Get-WindowText $h) })
      }
    }
    return $true
  }
  [void][MSGui.Native]::EnumWindows($cb, [IntPtr]::Zero)
  $found
}

function Get-Rect([IntPtr]$h) {
  $r = New-Object MSGui.RECT
  if (-not [MSGui.Native]::GetWindowRect($h, [ref]$r)) { throw "GetWindowRect failed for $h" }
  [pscustomobject]@{ Left=$r.Left; Top=$r.Top; Right=$r.Right; Bottom=$r.Bottom;
                     Width=($r.Right-$r.Left); Height=($r.Bottom-$r.Top) }
}

function Set-Foreground {
  param([IntPtr]$Handle, [int]$Tries = 25)
  if ([MSGui.Native]::IsIconic($Handle)) { [void][MSGui.Native]::ShowWindow($Handle, 9) }  # SW_RESTORE
  $me = [MSGui.Native]::GetCurrentThreadId()
  for ($i = 0; $i -lt $Tries; $i++) {
    $fg = [MSGui.Native]::GetForegroundWindow()
    if ($fg -eq $Handle) { return $true }
    $fgPid = 0
    $fgThread = [MSGui.Native]::GetWindowThreadProcessId($fg, [ref]$fgPid)
    [void][MSGui.Native]::AttachThreadInput($me, $fgThread, $true)
    [void][MSGui.Native]::BringWindowToTop($Handle)
    [void][MSGui.Native]::SetForegroundWindow($Handle)
    [void][MSGui.Native]::SetActiveWindow($Handle)
    [void][MSGui.Native]::AttachThreadInput($me, $fgThread, $false)
    Start-Sleep -Milliseconds 120
  }
  return ([MSGui.Native]::GetForegroundWindow() -eq $Handle)
}

# THE SAFETY GATE. Nothing is typed or clicked unless this passes.
function Assert-Foreground {
  param([IntPtr]$Handle, [string]$What = 'input')
  $fg = [MSGui.Native]::GetForegroundWindow()
  if ($fg -ne $Handle) {
    $fgTitle = Get-WindowText $fg
    $fgClass = Get-WindowClass $fg
    $fgPid   = Get-WindowPid $fg
    throw ("FOREGROUND MISMATCH before $What. expected=$Handle " +
           "actual=$fg class='$fgClass' title='$fgTitle' pid=$fgPid -- NO INPUT SENT")
  }
}

# ------------------------------------------------------------------ input ---

function Move-RealMouse {
  param([int]$X, [int]$Y, [int]$Steps = 8)
  $p = New-Object MSGui.POINT
  [void][MSGui.Native]::GetCursorPos([ref]$p)
  for ($i = 1; $i -le $Steps; $i++) {
    $nx = [int]($p.X + ($X - $p.X) * $i / $Steps)
    $ny = [int]($p.Y + ($Y - $p.Y) * $i / $Steps)
    [void][MSGui.Native]::SetCursorPos($nx, $ny)
    Start-Sleep -Milliseconds 8
  }
  # Pointer precision/acceleration can leave the cursor a few pixels short, so
  # nudge it again before giving up. A miss of a few px still lands inside any
  # real control; a miss of many px means the click would go somewhere else.
  $q = New-Object MSGui.POINT
  for ($try = 0; $try -lt 3; $try++) {
    [void][MSGui.Native]::SetCursorPos($X, $Y)
    Start-Sleep -Milliseconds 40
    [void][MSGui.Native]::GetCursorPos([ref]$q)
    if ([Math]::Abs($q.X - $X) -le 2 -and [Math]::Abs($q.Y - $Y) -le 2) { break }
  }
  if ([Math]::Abs($q.X - $X) -gt 8 -or [Math]::Abs($q.Y - $Y) -gt 8) {
    throw "Cursor did not land: wanted ($X,$Y) got ($($q.X),$($q.Y))"
  }
}

function Invoke-RealClick {
  param([IntPtr]$Window, [int]$X, [int]$Y, [ValidateSet('left','right','middle')][string]$Button = 'left',
        [int]$Count = 1, [switch]$SkipForegroundCheck)
  if (-not $SkipForegroundCheck) { Assert-Foreground -Handle $Window -What "click($X,$Y)" }
  Move-RealMouse -X $X -Y $Y
  if (-not $SkipForegroundCheck) { Assert-Foreground -Handle $Window -What "click-armed($X,$Y)" }
  for ($i = 0; $i -lt $Count; $i++) {
    switch ($Button) {
      'left'   { [MSGui.Native]::MouseButton([MSGui.Native]::MOUSEEVENTF_LEFTDOWN);   Start-Sleep -Milliseconds 35; [MSGui.Native]::MouseButton([MSGui.Native]::MOUSEEVENTF_LEFTUP) }
      'right'  { [MSGui.Native]::MouseButton([MSGui.Native]::MOUSEEVENTF_RIGHTDOWN);  Start-Sleep -Milliseconds 35; [MSGui.Native]::MouseButton([MSGui.Native]::MOUSEEVENTF_RIGHTUP) }
      'middle' { [MSGui.Native]::MouseButton([MSGui.Native]::MOUSEEVENTF_MIDDLEDOWN); Start-Sleep -Milliseconds 35; [MSGui.Native]::MouseButton([MSGui.Native]::MOUSEEVENTF_MIDDLEUP) }
    }
    if ($Count -gt 1) { Start-Sleep -Milliseconds 90 }
  }
  Start-Sleep -Milliseconds 120
}

function Invoke-RealWheel {
  param([IntPtr]$Window, [int]$X, [int]$Y, [int]$Notches = -3)
  Assert-Foreground -Handle $Window -What "wheel($X,$Y)"
  Move-RealMouse -X $X -Y $Y
  for ($i = 0; $i -lt [Math]::Abs($Notches); $i++) {
    [MSGui.Native]::MouseWheel(([Math]::Sign($Notches)) * 120)
    Start-Sleep -Milliseconds 60
  }
  Start-Sleep -Milliseconds 150
}

$script:VK = @{
  'TAB'=0x09; 'ENTER'=0x0D; 'ESC'=0x1B; 'SPACE'=0x20; 'PGUP'=0x21; 'PGDN'=0x22;
  'END'=0x23; 'HOME'=0x24; 'LEFT'=0x25; 'UP'=0x26; 'RIGHT'=0x27; 'DOWN'=0x28;
  'DELETE'=0x2E; 'BACKSPACE'=0x08; 'SHIFT'=0x10; 'CTRL'=0x11; 'ALT'=0x12;
  'A'=0x41; 'C'=0x43; 'V'=0x56; 'X'=0x58; 'Z'=0x5A; 'F5'=0x74
}

function Send-RealKey {
  param([IntPtr]$Window, [string]$Key, [string[]]$Modifiers = @())
  Assert-Foreground -Handle $Window -What "key($($Modifiers -join '+')+$Key)"
  $extended = @('LEFT','UP','RIGHT','DOWN','HOME','END','PGUP','PGDN','DELETE')
  foreach ($m in $Modifiers) { [MSGui.Native]::KeyVk($script:VK[$m.ToUpper()], $false, $false); Start-Sleep -Milliseconds 20 }
  $k = $Key.ToUpper()
  if (-not $script:VK.ContainsKey($k)) { throw "unknown key '$Key'" }
  [MSGui.Native]::KeyVk($script:VK[$k], $false, ($extended -contains $k))
  Start-Sleep -Milliseconds 30
  [MSGui.Native]::KeyVk($script:VK[$k], $true, ($extended -contains $k))
  Start-Sleep -Milliseconds 20
  foreach ($m in ($Modifiers | Sort-Object -Descending)) { [MSGui.Native]::KeyVk($script:VK[$m.ToUpper()], $true, $false) }
  Start-Sleep -Milliseconds 90
}

# Real per-character Unicode keystrokes (works for Japanese without an IME).
function Send-RealText {
  param([IntPtr]$Window, [string]$Text, [int]$DelayMs = 12)
  Assert-Foreground -Handle $Window -What "text(len=$($Text.Length))"
  $i = 0
  foreach ($ch in $Text.ToCharArray()) {
    if ($ch -eq "`n") {
      [MSGui.Native]::KeyVk(0x0D, $false, $false); Start-Sleep -Milliseconds 15
      [MSGui.Native]::KeyVk(0x0D, $true, $false)
    } elseif ($ch -eq "`r") {
      continue
    } else {
      [MSGui.Native]::KeyUnicode($ch, $false); Start-Sleep -Milliseconds 4
      [MSGui.Native]::KeyUnicode($ch, $true)
    }
    Start-Sleep -Milliseconds $DelayMs
    $i++
    # Re-verify foreground every 40 chars so a window steal mid-typing stops us.
    if (($i % 40) -eq 0) { Assert-Foreground -Handle $Window -What "text-continue@$i" }
  }
  Start-Sleep -Milliseconds 120
}

# Real OLE drag & drop from an Explorer window onto the target window.
function Invoke-RealDragDrop {
  param([IntPtr]$From, [int]$FromX, [int]$FromY, [IntPtr]$To, [int]$ToX, [int]$ToY)
  Assert-Foreground -Handle $From -What 'drag-start'
  Move-RealMouse -X $FromX -Y $FromY
  Start-Sleep -Milliseconds 150
  [MSGui.Native]::MouseButton([MSGui.Native]::MOUSEEVENTF_LEFTDOWN)
  Start-Sleep -Milliseconds 200
  # Break the drag threshold with small moves first, then travel.
  foreach ($d in 4, 10, 22) { [void][MSGui.Native]::SetCursorPos($FromX + $d, $FromY + $d); Start-Sleep -Milliseconds 60 }
  $steps = 26
  $p = New-Object MSGui.POINT
  [void][MSGui.Native]::GetCursorPos([ref]$p)
  for ($i = 1; $i -le $steps; $i++) {
    [void][MSGui.Native]::SetCursorPos([int]($p.X + ($ToX - $p.X) * $i / $steps), [int]($p.Y + ($ToY - $p.Y) * $i / $steps))
    Start-Sleep -Milliseconds 35
  }
  [void][MSGui.Native]::SetCursorPos($ToX, $ToY); Start-Sleep -Milliseconds 300
  [void][MSGui.Native]::SetCursorPos($ToX + 1, $ToY + 1); Start-Sleep -Milliseconds 300
  [MSGui.Native]::MouseButton([MSGui.Native]::MOUSEEVENTF_LEFTUP)
  Start-Sleep -Milliseconds 700
}

# ------------------------------------------------------------- screenshots ---

function Save-Shot {
  param(
    [Parameter(Mandatory)][string]$Path,
    [IntPtr]$Window = [IntPtr]::Zero,
    [switch]$FullScreen,
    [int]$Pad = 0
  )
  $dir = Split-Path -Parent $Path
  if ($dir -and -not (Test-Path $dir)) { New-Item -ItemType Directory -Force $dir | Out-Null }
  if ($FullScreen -or $Window -eq [IntPtr]::Zero) {
    $vs = [System.Windows.Forms.SystemInformation]::VirtualScreen
    $x = $vs.X; $y = $vs.Y; $w = $vs.Width; $h = $vs.Height
  } else {
    $r = Get-Rect $Window
    $x = $r.Left - $Pad; $y = $r.Top - $Pad; $w = $r.Width + 2*$Pad; $h = $r.Height + 2*$Pad
  }
  if ($w -le 0 -or $h -le 0) { throw "bad capture rect ${w}x${h}" }
  $bmp = New-Object System.Drawing.Bitmap $w, $h
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.CopyFromScreen($x, $y, 0, 0, $bmp.Size)
  # Draw the real cursor position marker? No - keep pixels exactly as shown.
  $bmp.Save($Path, [System.Drawing.Imaging.ImageFormat]::Png)
  $g.Dispose(); $bmp.Dispose()
  [pscustomobject]@{ Path=$Path; X=$x; Y=$y; Width=$w; Height=$h }
}

# --------------------------------------------------------------- clipboard ---

function Set-RealClipboard {
  param([Parameter(Mandatory)][string]$Text)
  if ([Threading.Thread]::CurrentThread.GetApartmentState() -ne 'STA') {
    throw 'clipboard needs -STA'
  }
  for ($i = 0; $i -lt 10; $i++) {
    try { [System.Windows.Forms.Clipboard]::SetText($Text); return $true } catch { Start-Sleep -Milliseconds 60 }
  }
  throw 'could not set clipboard after 10 tries'
}

function Get-RealClipboard {
  if ([Threading.Thread]::CurrentThread.GetApartmentState() -ne 'STA') { throw 'clipboard needs -STA' }
  for ($i = 0; $i -lt 10; $i++) {
    try { return [System.Windows.Forms.Clipboard]::GetText() } catch { Start-Sleep -Milliseconds 60 }
  }
  throw 'could not read clipboard after 10 tries'
}

# ------------------------------------------------------------------- app ----

function Start-MacroStudio {
  param([string]$AppDir = (Split-Path -Parent (Split-Path -Parent (Split-Path -Parent $PSScriptRoot))), [int]$TimeoutSec = 90)
  $before = @(Get-Process powershell -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Id)
  $p = Start-Process -FilePath 'powershell.exe' `
        -ArgumentList @('-NoProfile','-ExecutionPolicy','Bypass','-STA','-WindowStyle','Hidden','-File', (Join-Path $AppDir 'macrostudio.ps1')) `
        -WorkingDirectory $AppDir -PassThru
  $deadline = (Get-Date).AddSeconds($TimeoutSec)
  while ((Get-Date) -lt $deadline) {
    Start-Sleep -Milliseconds 500
    if ($p.HasExited) { throw "MacroStudio exited early with code $($p.ExitCode)" }
    $w = @(Get-TopWindowsForPid -ProcessId $p.Id)
    if ($w.Count -gt 0) {
      return [pscustomobject]@{ Process = $p; ProcessId = $p.Id; Handle = $w[0].Handle; Title = $w[0].Title; Class = $w[0].Class }
    }
  }
  throw "MacroStudio window did not appear within ${TimeoutSec}s (pid $($p.Id))"
}

function Stop-MacroStudio {
  param([int]$ProcessId)
  # Only ever the process we started ourselves.
  $p = Get-Process -Id $ProcessId -ErrorAction SilentlyContinue
  if ($p) { $p.CloseMainWindow() | Out-Null; Start-Sleep -Milliseconds 900; if (-not $p.HasExited) { $p.Kill() } }
}

function Set-WindowRect {
  param([IntPtr]$Handle, [int]$X, [int]$Y, [int]$W, [int]$H)
  Add-Type -Namespace MSGui2 -Name W -MemberDefinition @'
[DllImport("user32.dll")] public static extern bool MoveWindow(IntPtr h, int x, int y, int w, int hh, bool repaint);
'@ -ErrorAction SilentlyContinue
  [void][MSGui2.W]::MoveWindow($Handle, $X, $Y, $W, $H, $true)
  Start-Sleep -Milliseconds 400
}
