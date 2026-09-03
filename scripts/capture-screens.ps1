# Walk the screen tour and photograph every state.
#
# Pairs with `build.ps1 -Screens`. Loads the tour build into the simulator and
# steps through all of its states, saving one PNG per state named after the
# state, so a full visual pass over the app is one command per device.
#
# This exists because "have you actually looked at it" had no cheap answer.
# 1.3.0 shipped to the Connect IQ store having never been drawn once; the first
# simulator run found six layout bugs the same afternoon, five of them from
# measuring a round screen in characters. The AI screens then shipped undrawn a
# version later, because reaching them needed a live HTTPS server, an API key
# and a failure arriving on cue.
#
# Usage:
#   .\scripts\capture-screens.ps1 -Device fenix847mm
#   .\scripts\capture-screens.ps1 -Device fr55 -Out shots\fr55
#
# The simulator is genuinely unreliable when driven from a script -- monkeydo
# often reports nothing and loads nothing -- so this checks that the pixels
# changed between states and tells you when they did not, rather than leaving
# you with twenty-three identical images and a false sense of coverage.

param(
    [string]$Device = "fenix847mm",
    [string]$Prg = "",
    [string]$Out = "",
    [int]$Count = 0,
    [int]$SettleMs = 900,
    [switch]$NoRestart
)

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Windows.Forms

$RepoRoot = Split-Path -Parent $PSScriptRoot
$CiqRoot  = Join-Path $RepoRoot "ciq"
if (-not $Prg) { $Prg = Join-Path $CiqRoot "bin\TrainBud-screens.prg" }
if (-not [System.IO.Path]::IsPathRooted($Prg)) { $Prg = Join-Path $RepoRoot $Prg }
if (-not $Out) { $Out = Join-Path $RepoRoot "ciq\screens\$Device" }
if (-not [System.IO.Path]::IsPathRooted($Out)) { $Out = Join-Path $RepoRoot $Out }

if (-not (Test-Path $Prg)) {
    throw "Screen tour build not found: $Prg`nBuild it first: .\ciq\build.ps1 -Device $Device -Screens"
}

# Keep in step with ScreenTour.label(). Named here as well so the files are
# readable without opening the Monkey C, and so a mismatch in length is caught.
$StateNames = @(
    "setup", "pairing", "pair-unreachable", "pair-not-server",
    "pair-refused", "fetch-not-server", "fetch-unauthorised",
    "fetch-no-phone", "today", "ask-menu", "ask-no-key",
    "ask-thinking", "ask-answer", "ask-job-error", "ask-transport",
    "ask-timeout", "insight", "insight-no-key", "overview",
    "recovery", "sleep", "activity", "stress", "today-cold-start",
    "week", "week-cold-start", "week-race-week"
)
if ($Count -le 0) { $Count = $StateNames.Count }

New-Item -ItemType Directory -Force -Path $Out | Out-Null

$sig = @'
using System;
using System.Runtime.InteropServices;
public class ShotWin {
    [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);
    [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr hWnd, IntPtr hdcBlt, uint nFlags);
    [StructLayout(LayoutKind.Sequential)]
    public struct RECT { public int Left, Top, Right, Bottom; }
}
'@
if (-not ("ShotWin" -as [type])) { Add-Type -TypeDefinition $sig }

$SdkRoot = (Get-Content "$env:APPDATA\Garmin\ConnectIQ\current-sdk.cfg" -Raw).TrimEnd("`r", "`n", "\")
$SdkBin = Join-Path $SdkRoot "bin"
if (-not (Test-Path $SdkBin)) { throw "Connect IQ SDK not found at $SdkBin." }

if (-not $NoRestart) {
    $running = Get-Process -Name simulator -ErrorAction SilentlyContinue
    if ($running) {
        Write-Host "Stopping running simulator..." -ForegroundColor DarkGray
        $running | Stop-Process -Force
        Start-Sleep -Seconds 3
    }
    Write-Host "Starting simulator..." -ForegroundColor DarkGray
    Start-Process -FilePath (Join-Path $SdkBin "connectiq.bat")
    Start-Sleep -Seconds 20
}

Write-Host "Loading $Prg on $Device..." -ForegroundColor Cyan
Start-Process -FilePath (Join-Path $SdkBin "monkeydo.bat") -ArgumentList @($Prg, $Device) -WindowStyle Minimized
Start-Sleep -Seconds 12

# Re-acquired every frame rather than cached once.
#
# A handle captured at the start went stale mid-run: the window was resized
# under the capture and PrintWindow happily returned a 150x150 corner of the
# simulator chrome, which was saved as "recovery" and looked, at a glance, like
# a rendering bug in the app. A screenshot that is not of the thing you think it
# is, is worse than no screenshot.
function Get-SimHandle {
    $p = Get-Process -Name simulator -ErrorAction SilentlyContinue |
        Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
    if (-not $p) { throw "Simulator window not found." }
    return $p.MainWindowHandle
}
$hwnd = Get-SimHandle

function Get-SimBitmap {
    $script:hwnd = Get-SimHandle
    $hwnd = $script:hwnd
    if ([ShotWin]::IsIconic($hwnd)) {
        [ShotWin]::ShowWindow($hwnd, 4) | Out-Null   # SW_SHOWNOACTIVATE
        Start-Sleep -Milliseconds 500
    }
    $rect = New-Object ShotWin+RECT
    [ShotWin]::GetWindowRect($hwnd, [ref]$rect) | Out-Null
    $w = $rect.Right - $rect.Left
    $h = $rect.Bottom - $rect.Top
    # A real simulator window is several hundred pixels on both sides. Anything
    # smaller is a window mid-resize or the wrong window, and photographing it
    # produces a file that looks like app output and is not.
    if ($w -lt 300 -or $h -lt 300) {
        throw "Simulator window is ${w}x${h} -- too small to be the device view."
    }
    $bmp = New-Object System.Drawing.Bitmap $w, $h
    $gfx = [System.Drawing.Graphics]::FromImage($bmp)
    $hdc = $gfx.GetHdc()
    # PW_RENDERFULLCONTENT: without it the hardware-composited device canvas
    # comes back black.
    $ok = [ShotWin]::PrintWindow($hwnd, $hdc, 2)
    $gfx.ReleaseHdc($hdc)
    $gfx.Dispose()
    if (-not $ok) { $bmp.Dispose(); throw "PrintWindow failed." }

    # Crop to the device face before anything looks at these pixels.
    #
    # The simulator window carries a status bar with a live byte counter
    # ("34.1/763.6kB"), and it ticks on its own. Fingerprinting the whole window
    # therefore reported "the screen changed" for a keypress that never landed,
    # the retry below was satisfied by it, and the run drifted one state behind
    # without a single warning -- every screenshot real, every filename wrong.
    # Nothing outside the watch face is evidence about the app.
    $side = [Math]::Min($w, $h) - 60
    if ($side -gt 0) {
        $cropX = [int](($w - $side) / 2)
        $cropY = [int](($h - $side) / 2) + 20
        $rectCrop = New-Object System.Drawing.Rectangle $cropX, $cropY, $side, $side
        $cropped = $bmp.Clone($rectCrop, $bmp.PixelFormat)
        $bmp.Dispose()
        return $cropped
    }
    return $bmp
}

# A cheap perceptual fingerprint. Comparing whole bitmaps is slow and comparing
# file sizes is meaningless for PNG; a coarse grid of sampled pixels is enough
# to answer "did this screen change at all", which is the only question that
# matters when the risk is a keypress that never landed.
function Get-Fingerprint([System.Drawing.Bitmap]$bmp) {
    $sb = New-Object System.Text.StringBuilder
    for ($y = 0; $y -lt $bmp.Height; $y += [Math]::Max(1, [int]($bmp.Height / 24))) {
        for ($x = 0; $x -lt $bmp.Width; $x += [Math]::Max(1, [int]($bmp.Width / 24))) {
            $p = $bmp.GetPixel($x, $y)
            [void]$sb.Append(([int]($p.R / 32)).ToString())
            [void]$sb.Append(([int]($p.G / 32)).ToString())
            [void]$sb.Append(([int]($p.B / 32)).ToString())
        }
    }
    return $sb.ToString()
}

$prints = @{}
$repeats = @()

for ($i = 0; $i -lt $Count; $i++) {
    Start-Sleep -Milliseconds $SettleMs

    $bmp = Get-SimBitmap
    $name = if ($i -lt $StateNames.Count) { $StateNames[$i] } else { "state-$i" }
    $file = Join-Path $Out ("{0:d2}-{1}.png" -f $i, $name)
    $bmp.Save($file, [System.Drawing.Imaging.ImageFormat]::Png)

    $print = Get-Fingerprint $bmp
    if ($prints.ContainsKey($print)) {
        $repeats += "$name (identical to $($prints[$print]))"
        Write-Host ("  {0:d2} {1,-20} SAME AS {2}" -f $i, $name, $prints[$print]) -ForegroundColor Yellow
    } else {
        $prints[$print] = $name
        Write-Host ("  {0:d2} {1,-20} captured" -f $i, $name) -ForegroundColor Green
    }
    $bmp.Dispose()

    if ($i -eq $Count - 1) { break }

    # Advance the tour, and confirm it advanced.
    #
    # DOWN is onNextPage on every device, including the button-only ones, and
    # the tour treats any key as "next screen". A keypress sent while the app is
    # still starting is swallowed silently, and the first run of this script lost
    # exactly one that way: every screenshot after it was a real screen saved
    # under the name of the state before it. A mislabelled set of screenshots is
    # worse than a failed run, because it is evidence that says the wrong thing.
    #
    # So: press, look, press again if nothing moved. The on-screen "n/23" from
    # ScreenTour is the independent check that this did not overshoot.
    $before = $print
    $landed = $false
    for ($try = 0; $try -lt 4 -and -not $landed; $try++) {
        [ShotWin]::SetForegroundWindow($hwnd) | Out-Null
        Start-Sleep -Milliseconds 200
        [System.Windows.Forms.SendKeys]::SendWait("{DOWN}")
        Start-Sleep -Milliseconds $SettleMs

        $check = Get-SimBitmap
        $after = Get-Fingerprint $check
        $check.Dispose()
        if ($after -ne $before) { $landed = $true }
        elseif ($try -eq 3) {
            Write-Host "     keypress did not register after 4 tries" -ForegroundColor Red
        }
    }
}

Write-Host ""
Write-Host "Saved $Count screens to $Out" -ForegroundColor Cyan
if ($repeats.Count -gt 0) {
    Write-Host ""
    Write-Host "WARNING: $($repeats.Count) screens were pixel-identical to an earlier one." -ForegroundColor Yellow
    Write-Host "Either the keypress did not reach the simulator, or two states genuinely draw the same." -ForegroundColor Yellow
    $repeats | ForEach-Object { Write-Host "  - $_" -ForegroundColor Yellow }
    exit 2
}
