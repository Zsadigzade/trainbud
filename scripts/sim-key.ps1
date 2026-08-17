# Send a button press to the Connect IQ simulator without taking over the screen.
#
# The simulator maps watch buttons to keyboard keys, and Qt processes posted
# WM_KEYDOWN/WM_KEYUP on the top-level window, so this drives the app while the
# window stays where it is. SetForegroundWindow was avoided on purpose: raising
# the simulator hijacks whatever the user is doing, and the earlier screen-grab
# approach that needed it captured the desktop instead of the watch.
#
# Usage:
#   .\scripts\sim-key.ps1 Enter      # ENTER / START -- opens the widget from its glance
#   .\scripts\sim-key.ps1 Esc        # BACK
#   .\scripts\sim-key.ps1 Down       # scroll / next card

param(
    [Parameter(Mandatory = $true)]
    [ValidateSet("Enter", "Esc", "Up", "Down", "Left", "Right")]
    [string]$Key,

    [int]$Repeat = 1,

    # Qt ignores posted key messages unless the window really has focus, so the
    # quiet path above does nothing for the simulator. This raises it, types,
    # and hands focus back. It interrupts whatever is on screen, which is why it
    # is not the default.
    [switch]$Force
)

$ErrorActionPreference = "Stop"

$sig = @'
using System;
using System.Runtime.InteropServices;
public class SimKey {
    [DllImport("user32.dll")] public static extern IntPtr PostMessage(IntPtr hWnd, uint Msg, IntPtr wParam, IntPtr lParam);
    [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
    [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, IntPtr ProcessId);
    [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint idAttach, uint idAttachTo, bool fAttach);
    [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();

    // Windows refuses SetForegroundWindow from a process that does not own the
    // foreground. Attaching our input queue to the current foreground thread
    // lifts that restriction for the duration of the call.
    public static bool ForceForeground(IntPtr hWnd) {
        IntPtr fg = GetForegroundWindow();
        uint fgThread = GetWindowThreadProcessId(fg, IntPtr.Zero);
        uint us = GetCurrentThreadId();
        AttachThreadInput(us, fgThread, true);
        bool ok = SetForegroundWindow(hWnd);
        AttachThreadInput(us, fgThread, false);
        return ok;
    }
}
'@
if (-not ("SimKey" -as [type])) { Add-Type -TypeDefinition $sig }

$VK = @{ Enter = 0x0D; Esc = 0x1B; Up = 0x26; Down = 0x28; Left = 0x25; Right = 0x27 }
$WM_KEYDOWN = 0x0100
$WM_KEYUP   = 0x0101

$proc = Get-Process -Name simulator -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
if (-not $proc) { throw "Simulator window not found. Start it with .\scripts\sim.ps1 first." }
$hwnd = $proc.MainWindowHandle

# A minimized window drops posted input on the floor. Restore without activating.
if ([SimKey]::IsIconic($hwnd)) {
    [SimKey]::ShowWindow($hwnd, 4) | Out-Null   # SW_SHOWNOACTIVATE
    Start-Sleep -Milliseconds 500
}

$code = $VK[$Key]
$sendKeys = @{ Enter = "{ENTER}"; Esc = "{ESC}"; Up = "{UP}"; Down = "{DOWN}"; Left = "{LEFT}"; Right = "{RIGHT}" }

if ($Force) {
    Add-Type -AssemblyName System.Windows.Forms
    $previous = [SimKey]::GetForegroundWindow()
    [SimKey]::ForceForeground($hwnd) | Out-Null
    Start-Sleep -Milliseconds 400
    for ($i = 0; $i -lt $Repeat; $i++) {
        [System.Windows.Forms.SendKeys]::SendWait($sendKeys[$Key])
        Start-Sleep -Milliseconds 300
    }
    # Give the foreground back to whatever had it.
    if ($previous -ne [IntPtr]::Zero) { [SimKey]::ForceForeground($previous) | Out-Null }
} else {
    for ($i = 0; $i -lt $Repeat; $i++) {
        [SimKey]::PostMessage($hwnd, $WM_KEYDOWN, [IntPtr]$code, [IntPtr]0) | Out-Null
        Start-Sleep -Milliseconds 60
        [SimKey]::PostMessage($hwnd, $WM_KEYUP, [IntPtr]$code, [IntPtr]0) | Out-Null
        Start-Sleep -Milliseconds 250
    }
}

Write-Host "Sent $Key x$Repeat to simulator (pid $($proc.Id))"
