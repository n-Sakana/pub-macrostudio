# Bring the MacroStudio window (by PID) to the foreground reliably.
param([int]$AppPid = 6084)

Add-Type @"
using System;
using System.Runtime.InteropServices;
public class FgUtil {
    [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
    [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint a, uint b, bool attach);
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
    [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr h);
    [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int cmd);
    [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
}
"@

$proc = Get-Process -Id $AppPid -ErrorAction Stop
$h = $proc.MainWindowHandle
if ($h -eq [IntPtr]::Zero) { throw "no main window for PID $AppPid" }

$fg = [FgUtil]::GetForegroundWindow()
$fgPid = 0
$fgThread = [FgUtil]::GetWindowThreadProcessId($fg, [ref]$fgPid)
$myThread = [FgUtil]::GetCurrentThreadId()
$targetThread = [FgUtil]::GetWindowThreadProcessId($h, [ref]([uint32]0))

[FgUtil]::AttachThreadInput($myThread, $fgThread, $true) | Out-Null
[FgUtil]::AttachThreadInput($myThread, $targetThread, $true) | Out-Null
[FgUtil]::ShowWindow($h, 9) | Out-Null   # SW_RESTORE
[FgUtil]::BringWindowToTop($h) | Out-Null
[FgUtil]::SetForegroundWindow($h) | Out-Null
[FgUtil]::AttachThreadInput($myThread, $fgThread, $false) | Out-Null
[FgUtil]::AttachThreadInput($myThread, $targetThread, $false) | Out-Null
Start-Sleep -Milliseconds 300
$now = [FgUtil]::GetForegroundWindow()
Write-Output ("foreground=" + ($now -eq $h))
