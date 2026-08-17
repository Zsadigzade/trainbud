# Capture the Connect IQ simulator window to a PNG.
#
# Two jobs: it is the only way to see what the watch is actually showing while
# debugging (a screenshot settled in one glance what a day of inference could
# not), and it produces the Connect IQ Store screenshots, which must come from
# a real render rather than a drawing.
#
# The simulator is started minimized by scripts/sim.ps1, so this restores and
# raises the window before grabbing pixels — a minimized window captures as
# whatever happens to be behind it.
#
# Usage:
#   .\scripts\capture-sim.ps1                        # -> ciq/store/screenshots/sim.png
#   .\scripts\capture-sim.ps1 -Out shots\pairing.png
#   .\scripts\capture-sim.ps1 -WatchOnly             # crop to the round watch face

param(
    [string]$Out = "",
    [switch]$WatchOnly
)

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Windows.Forms

$RepoRoot = Split-Path -Parent $PSScriptRoot
if (-not $Out) { $Out = Join-Path $RepoRoot "ciq\store\screenshots\sim.png" }
if (-not [System.IO.Path]::IsPathRooted($Out)) { $Out = Join-Path $RepoRoot $Out }
$OutDir = Split-Path -Parent $Out
if (-not (Test-Path $OutDir)) { New-Item -ItemType Directory -Force -Path $OutDir | Out-Null }

$sig = @'
using System;
using System.Runtime.InteropServices;
public class Win {
    [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);
    [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr hWnd, IntPtr hdcBlt, uint nFlags);
    [StructLayout(LayoutKind.Sequential)]
    public struct RECT { public int Left, Top, Right, Bottom; }
}
'@
if (-not ("Win" -as [type])) { Add-Type -TypeDefinition $sig }

$proc = Get-Process -Name simulator -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
if (-not $proc) { throw "Simulator window not found. Start it with .\scripts\sim.ps1 first." }

$hwnd = $proc.MainWindowHandle

# A minimized window has no client area to render, so it must be restored --
# but never raised. CopyFromScreen was the first approach and it grabbed
# whatever happened to be in front of the simulator, i.e. the user's desktop.
# PrintWindow asks the window to paint itself into our bitmap instead: no focus
# stealing, nothing else on screen can leak into the image.
if ([Win]::IsIconic($hwnd)) {
    [Win]::ShowWindow($hwnd, 4) | Out-Null   # SW_SHOWNOACTIVATE
    Start-Sleep -Milliseconds 700
}

$rect = New-Object Win+RECT
[Win]::GetWindowRect($hwnd, [ref]$rect) | Out-Null
$width  = $rect.Right - $rect.Left
$height = $rect.Bottom - $rect.Top
if ($width -le 0 -or $height -le 0) { throw "Simulator window has no size (w=$width h=$height)." }

$bmp = New-Object System.Drawing.Bitmap $width, $height
$gfx = [System.Drawing.Graphics]::FromImage($bmp)
$hdc = $gfx.GetHdc()
# 2 = PW_RENDERFULLCONTENT, required for the simulator's hardware-composited
# device canvas; without it the watch face comes back black.
$ok = [Win]::PrintWindow($hwnd, $hdc, 2)
$gfx.ReleaseHdc($hdc)
$gfx.Dispose()
if (-not $ok) { throw "PrintWindow failed for the simulator window." }

if ($WatchOnly) {
    # The device render sits inside the simulator chrome. Trimming to the
    # largest centred square drops the toolbar and menu without hunting for the
    # bezel, which moves between device shapes.
    $side = [Math]::Min($width, $height) - 60
    if ($side -gt 0) {
        $cropX = [int](($width - $side) / 2)
        $cropY = [int](($height - $side) / 2) + 20
        $crop = New-Object System.Drawing.Rectangle $cropX, $cropY, $side, $side
        $cropped = $bmp.Clone($crop, $bmp.PixelFormat)
        $bmp.Dispose()
        $bmp = $cropped
    }
}

$bmp.Save($Out, [System.Drawing.Imaging.ImageFormat]::Png)
$bmp.Dispose()
Write-Host "Saved: $Out ($($width)x$($height))"
