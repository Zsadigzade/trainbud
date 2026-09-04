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
# -Display is the mode store assets come from: it crops to the device's own
# display and nothing else, at native resolution, using the geometry the SDK
# already publishes. -WatchOnly is the eyeballing mode -- a centred square that
# keeps the case, guessed rather than measured.
#
# Usage:
#   .\scripts\capture-sim.ps1                        # -> ciq/store/screenshots/sim.png
#   .\scripts\capture-sim.ps1 -Out shots\pairing.png
#   .\scripts\capture-sim.ps1 -WatchOnly             # crop to the round watch face
#   .\scripts\capture-sim.ps1 -Display -Device fr70  # exactly the 390x390 display

param(
    [string]$Out = "",
    [switch]$WatchOnly,
    [switch]$Display,
    [string]$Device = "",

    # For callers that capture in a loop -- capture-store-shots.ps1 takes one
    # shot per keypress, and thirty lines of "Saved:" bury the run's own report.
    [switch]$Quiet
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

# Finding the display in the window, rather than guessing where it is.
#
# The simulator draws the device's own artwork at 1:1 and composites the app's
# pixels into it, and the SDK ships both halves of what that means: the artwork
# (Devices/<device>/<image>) and the rectangle the display occupies inside it
# (simulator.json display.location). So the display can be located by finding
# where the artwork sits in the captured window and adding that rectangle --
# never by measuring inwards from the window edge, which is what produced a set
# of off-centre store crops on 2026-09-04.
#
# The match is over artwork pixels OUTSIDE the display box, since the pixels
# inside it are the app and change every frame. If the best match is not
# near-exact, the artwork is not at 1:1 -- the window has been resized and the
# simulator has scaled it -- and this refuses rather than cropping something
# plausible and wrong.
$cropSig = @'
using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;

public class SimCrop {

    private static byte[] Bytes(Bitmap src, out int stride) {
        Bitmap b = src;
        bool temp = false;
        if (src.PixelFormat != PixelFormat.Format32bppArgb) {
            b = src.Clone(new Rectangle(0, 0, src.Width, src.Height), PixelFormat.Format32bppArgb);
            temp = true;
        }
        BitmapData d = b.LockBits(new Rectangle(0, 0, b.Width, b.Height),
                                  ImageLockMode.ReadOnly, PixelFormat.Format32bppArgb);
        stride = d.Stride;
        byte[] buf = new byte[d.Stride * b.Height];
        Marshal.Copy(d.Scan0, buf, 0, buf.Length);
        b.UnlockBits(d);
        if (temp) { b.Dispose(); }
        return buf;
    }

    // { meanAbsErrorPerChannel, offsetX, offsetY }
    public static double[] Locate(Bitmap window, Bitmap art, Rectangle display) {
        if (art.Width > window.Width || art.Height > window.Height) {
            throw new Exception("device artwork (" + art.Width + "x" + art.Height +
                ") does not fit in the simulator window (" + window.Width + "x" + window.Height +
                "). Enlarge the simulator window: the artwork must be visible whole and unscaled.");
        }

        int ws, as_;
        byte[] win = Bytes(window, out ws);
        byte[] arr = Bytes(art, out as_);

        // Opaque artwork pixels, clear of the display box and its antialiased
        // edge, on a coarse grid. A few thousand is plenty and keeps the scan
        // over every candidate offset cheap.
        int pad = 6;
        List<int> sx = new List<int>(), sy = new List<int>();
        List<byte> sb = new List<byte>(), sg = new List<byte>(), sr = new List<byte>();
        for (int y = 0; y < art.Height; y += 5) {
            for (int x = 0; x < art.Width; x += 5) {
                if (x >= display.X - pad && x < display.Right + pad &&
                    y >= display.Y - pad && y < display.Bottom + pad) { continue; }
                int i = y * as_ + x * 4;
                if (arr[i + 3] != 255) { continue; }
                sx.Add(x); sy.Add(y); sb.Add(arr[i]); sg.Add(arr[i + 1]); sr.Add(arr[i + 2]);
            }
        }
        if (sx.Count < 200) { throw new Exception("too little opaque device artwork to match against."); }

        long best = long.MaxValue;
        int bestX = -1, bestY = -1;
        int n = sx.Count;
        for (int oy = 0; oy <= window.Height - art.Height; oy++) {
            for (int ox = 0; ox <= window.Width - art.Width; ox++) {
                long sum = 0;
                for (int k = 0; k < n; k++) {
                    int i = (oy + sy[k]) * ws + (ox + sx[k]) * 4;
                    sum += Math.Abs(win[i] - sb[k]) + Math.Abs(win[i + 1] - sg[k]) + Math.Abs(win[i + 2] - sr[k]);
                    if (sum >= best) { break; }
                }
                if (sum < best) { best = sum; bestX = ox; bestY = oy; }
            }
        }
        return new double[] { (double)best / (n * 3.0), bestX, bestY };
    }

    // Black out the corners a round display does not have.
    //
    // Those pixels are the bezel from the device artwork, not app output: the
    // app's drawing context is square and the hardware clips it to the circle.
    // Leaving them in puts the case -- and the vendor's name printed on it --
    // into an image that is meant to be the screen.
    public static void MaskRound(Bitmap bmp) {
        int w = bmp.Width, h = bmp.Height;
        double cx = (w - 1) / 2.0, cy = (h - 1) / 2.0;
        double r = Math.Min(w, h) / 2.0;
        double rr = r * r;
        BitmapData d = bmp.LockBits(new Rectangle(0, 0, w, h), ImageLockMode.ReadWrite, PixelFormat.Format32bppArgb);
        byte[] buf = new byte[d.Stride * h];
        Marshal.Copy(d.Scan0, buf, 0, buf.Length);
        for (int y = 0; y < h; y++) {
            for (int x = 0; x < w; x++) {
                double dx = x - cx, dy = y - cy;
                if (dx * dx + dy * dy <= rr) { continue; }
                int i = y * d.Stride + x * 4;
                buf[i] = 0; buf[i + 1] = 0; buf[i + 2] = 0; buf[i + 3] = 255;
            }
        }
        Marshal.Copy(buf, 0, d.Scan0, buf.Length);
        bmp.UnlockBits(d);
    }
}
'@
if (-not ("SimCrop" -as [type])) { Add-Type -TypeDefinition $cropSig -ReferencedAssemblies System.Drawing }

if ($Display) {
    if ($WatchOnly) { throw "-Display and -WatchOnly are different crops. Pick one." }
    if (-not $Device) { throw "-Display needs -Device (the simulated device id, e.g. fr70)." }
    $DeviceDir = Join-Path $env:APPDATA "Garmin\ConnectIQ\Devices\$Device"
    if (-not (Test-Path $DeviceDir)) { throw "No SDK device folder for '$Device' at $DeviceDir." }
}

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

if ($Display) {
    $sim = Get-Content (Join-Path $DeviceDir "simulator.json") -Raw | ConvertFrom-Json
    $loc = $sim.display.location
    $artPath = Join-Path $DeviceDir $sim.image
    if (-not (Test-Path $artPath)) { throw "Device artwork missing: $artPath" }
    $art = New-Object System.Drawing.Bitmap $artPath
    $box = New-Object System.Drawing.Rectangle ([int]$loc.x), ([int]$loc.y), ([int]$loc.width), ([int]$loc.height)

    $found = [SimCrop]::Locate($bmp, $art, $box)
    $art.Dispose()
    $err = $found[0]
    $ox = [int]$found[1]
    $oy = [int]$found[2]
    # The true offset scores well under 1.0 out of 255; the runners-up score in
    # the tens. Above this the artwork is not sitting at 1:1.
    if ($err -gt 4.0) {
        $bmp.Dispose()
        throw ("Could not locate the $Device artwork at 1:1 in the simulator window " +
               "(best mean error $([math]::Round($err,2))/255 at $ox,$oy). The window is " +
               "probably scaled -- resize it until the whole watch is visible, then retry.")
    }

    $crop = New-Object System.Drawing.Rectangle ($ox + $box.X), ($oy + $box.Y), $box.Width, $box.Height
    $displayBmp = $bmp.Clone($crop, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $bmp.Dispose()
    $bmp = $displayBmp
    if ($sim.display.shape -eq "round") { [SimCrop]::MaskRound($bmp) }

    # 24-bit, no alpha channel. A screenshot has nothing to be transparent, the
    # accepted 1.3.x store set was 24-bit, and an alpha channel that is 255
    # everywhere is a third of the file for nothing.
    $flatRect = New-Object System.Drawing.Rectangle 0, 0, $bmp.Width, $bmp.Height
    $flat = $bmp.Clone($flatRect, [System.Drawing.Imaging.PixelFormat]::Format24bppRgb)
    $bmp.Dispose()
    $bmp = $flat

    $width = $bmp.Width
    $height = $bmp.Height
    if (-not $Quiet) {
        Write-Host ("Display found at $($ox + $box.X),$($oy + $box.Y) -- artwork match error " +
                    "$([math]::Round($err,3))/255") -ForegroundColor DarkGray
    }
}
elseif ($WatchOnly) {
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
if (-not $Quiet) { Write-Host "Saved: $Out ($($width)x$($height))" }
