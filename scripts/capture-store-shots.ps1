# Capture the Connect IQ Store screenshots: the app's own pixels, nothing else.
#
# Store assets have been wrong twice, in opposite directions. Before 1.2.0 they
# were DRAWN by generate-store-screenshots.ps1, which never runs the app. On
# 2026-09-04 they were nearly replaced by crops of a screen-tour capture, which
# does run the app but paints a debug state counter over it -- five 390x390
# images went into the tree with "9/28" above the title before the crop was
# noticed, and the crop itself was off-centre because it was measured inwards
# from the window edge instead of from the device geometry.
#
# So this script makes both mistakes impossible rather than warning about them:
#
#   * it refuses any build but `-Screens -NoLabel`, where the counter is absent
#     at compile time and cannot come back through a keypress that did not land;
#   * it crops with capture-sim.ps1 -Display, which finds the device artwork in
#     the window and adds the display rectangle the SDK publishes for it;
#   * it checks each saved image for the counter's colour anyway, because a
#     guarantee that is never tested is a guarantee that quietly stops holding;
#   * it stops the run if a keypress did not land, because the tour is stepped
#     blind once the counter is off and a dropped press mislabels every file
#     after it.
#
# Usage:
#   .\ciq\build.ps1 -Device fr70 -Screens -NoLabel
#   .\scripts\capture-store-shots.ps1 -Device fr70
#   .\scripts\capture-store-shots.ps1 -CheckOnly ciq\store\screenshots\store\0-today.png
#
# The order is the listing's: Today, Week and Recovery are what Garmin Connect
# cannot draw, so they lead; Overview and Ask follow. See ciq/STORE-LISTING.md.

param(
    [string]$Device = "fr70",
    [string]$Prg = "",
    [string]$Out = "",
    [int]$SettleMs = 900,
    [switch]$NoRestart,

    # Audit an image that already exists instead of capturing: does this PNG
    # carry the tour's state counter? Takes a file or a directory. Nothing is
    # launched and nothing is written.
    [string]$CheckOnly = ""
)

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Windows.Forms

$RepoRoot = Split-Path -Parent $PSScriptRoot
$CiqRoot  = Join-Path $RepoRoot "ciq"

# The counter is drawn in Graphics.COLOR_BLUE at the top centre, and on this SDK
# COLOR_BLUE is 0x00AAFF -- it renders (0,170,255), not pure blue. The first
# version of this check looked for pure blue, found nothing in a capture that
# had "1/28" written across the top of it, and would have passed a labelled set
# straight through. Measure the colour, do not assume it.
#
# The band is the top eighth of the display. The app's own light blue there is
# the "1 more" hint at about (127,168,255), which this leaves alone: the red
# channel separates them.
function Test-NoTourLabel([string]$Path) {
    $bmp = New-Object System.Drawing.Bitmap $Path
    try {
        $band = [int]($bmp.Height / 8)
        for ($y = 0; $y -lt $band; $y++) {
            for ($x = 0; $x -lt $bmp.Width; $x++) {
                $p = $bmp.GetPixel($x, $y)
                if ($p.R -lt 64 -and $p.G -ge 120 -and $p.B -ge 200) { return $false }
            }
        }
        return $true
    } finally { $bmp.Dispose() }
}

if ($CheckOnly) {
    if (-not [System.IO.Path]::IsPathRooted($CheckOnly)) { $CheckOnly = Join-Path $RepoRoot $CheckOnly }
    if (-not (Test-Path $CheckOnly)) { throw "No such file or directory: $CheckOnly" }
    $files = @()
    if ((Get-Item $CheckOnly).PSIsContainer) {
        $files = Get-ChildItem -Path $CheckOnly -Filter *.png | ForEach-Object { $_.FullName }
    } else {
        $files = @($CheckOnly)
    }
    if ($files.Count -eq 0) { throw "No PNGs to check in $CheckOnly." }
    $bad = @()
    foreach ($f in $files) {
        if (Test-NoTourLabel $f) {
            Write-Host ("  clean    " + [System.IO.Path]::GetFileName($f)) -ForegroundColor Green
        } else {
            Write-Host ("  COUNTER  " + [System.IO.Path]::GetFileName($f)) -ForegroundColor Red
            $bad += $f
        }
    }
    if ($bad.Count -gt 0) {
        throw ("$($bad.Count) of $($files.Count) images carry the tour's state counter. " +
               "Recapture from a -Screens -NoLabel build.")
    }
    Write-Host "All $($files.Count) images are free of the tour's state counter." -ForegroundColor Cyan
    return
}

if (-not $Prg) { $Prg = Join-Path $CiqRoot "bin\TrainBud-screens-nolabel.prg" }
if (-not [System.IO.Path]::IsPathRooted($Prg)) { $Prg = Join-Path $RepoRoot $Prg }
if (-not $Out) { $Out = Join-Path $CiqRoot "store\screenshots\store" }
if (-not [System.IO.Path]::IsPathRooted($Out)) { $Out = Join-Path $RepoRoot $Out }

# The one build these may come from. Named, not sniffed: a .prg carries no flag
# saying which jungle made it, and the point of the check is that nobody has to
# remember which window the simulator has open.
if ([System.IO.Path]::GetFileName($Prg) -ne "TrainBud-screens-nolabel.prg") {
    throw ("Store screenshots may only be captured from the label-free tour build.`n" +
           "Build it with: .\ciq\build.ps1 -Device $Device -Screens -NoLabel")
}
if (-not (Test-Path $Prg)) {
    throw "Not built: $Prg`nRun: .\ciq\build.ps1 -Device $Device -Screens -NoLabel"
}

# Tour state index -> the name it is filed under. Indices are ScreenTour's own
# constants; they are append-only there precisely so this list stays valid.
$Cards = @(
    @{ Index =  8; Name = "0-today" },
    @{ Index = 24; Name = "1-week" },
    @{ Index = 19; Name = "2-recovery" },
    @{ Index = 18; Name = "3-overview" },
    @{ Index =  9; Name = "4-ask" }
)

New-Item -ItemType Directory -Force -Path $Out | Out-Null
$Temp = Join-Path ([System.IO.Path]::GetTempPath()) ("trainbud-store-" + [guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Force -Path $Temp | Out-Null

$sig = @'
using System;
using System.Runtime.InteropServices;
public class StoreShotWin {
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
}
'@
if (-not ("StoreShotWin" -as [type])) { Add-Type -TypeDefinition $sig }

$SdkRoot = (Get-Content "$env:APPDATA\Garmin\ConnectIQ\current-sdk.cfg" -Raw).TrimEnd("`r", "`n", "\")
$SdkBin = Join-Path $SdkRoot "bin"
if (-not (Test-Path $SdkBin)) { throw "Connect IQ SDK not found at $SdkBin." }

if (-not $NoRestart) {
    Get-Process -Name simulator -ErrorAction SilentlyContinue | Stop-Process -Force
    Start-Sleep -Seconds 3
    Write-Host "Starting simulator..." -ForegroundColor DarkGray
    Start-Process -FilePath (Join-Path $SdkBin "connectiq.bat")
    Start-Sleep -Seconds 20
}

Write-Host "Loading $([System.IO.Path]::GetFileName($Prg)) on $Device..." -ForegroundColor Cyan
Start-Process -FilePath (Join-Path $SdkBin "monkeydo.bat") -ArgumentList @($Prg, $Device) -WindowStyle Minimized
Start-Sleep -Seconds 14

function Get-SimHandle {
    $p = Get-Process -Name simulator -ErrorAction SilentlyContinue |
        Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
    if (-not $p) { throw "Simulator window not found." }
    return $p.MainWindowHandle
}

# Every capture goes through the same crop the store assets do, so the change
# detection below is over the app's pixels only. The whole-window fingerprint
# this replaces was defeated by the simulator's own status bar: its byte counter
# ticks on its own, so "the screen changed" was true for a keypress that never
# landed, and a run drifted a state behind with every file real and misnamed.
function Get-DisplayShot([string]$Path) {
    & (Join-Path $PSScriptRoot "capture-sim.ps1") -Display -Device $Device -Out $Path -Quiet | Out-Null
    return $Path
}

function Get-Fingerprint([string]$Path) {
    $bmp = New-Object System.Drawing.Bitmap $Path
    try {
        $sb = New-Object System.Text.StringBuilder
        $stepY = [Math]::Max(1, [int]($bmp.Height / 28))
        $stepX = [Math]::Max(1, [int]($bmp.Width / 28))
        for ($y = 0; $y -lt $bmp.Height; $y += $stepY) {
            for ($x = 0; $x -lt $bmp.Width; $x += $stepX) {
                $p = $bmp.GetPixel($x, $y)
                [void]$sb.Append(([int]($p.R / 32)).ToString())
                [void]$sb.Append(([int]($p.G / 32)).ToString())
                [void]$sb.Append(([int]($p.B / 32)).ToString())
            }
        }
        return $sb.ToString()
    } finally { $bmp.Dispose() }
}

$hwnd = Get-SimHandle
$maxIndex = ($Cards | ForEach-Object { $_.Index } | Measure-Object -Maximum).Maximum
$wanted = @{}
foreach ($c in $Cards) { $wanted[$c.Index] = $c.Name }

$saved = @()
$prints = @{}
$current = Join-Path $Temp "current.png"
Get-DisplayShot $current | Out-Null
$print = Get-Fingerprint $current

for ($i = 0; $i -le $maxIndex; $i++) {
    if ($wanted.ContainsKey($i)) {
        $name = $wanted[$i]
        $file = Join-Path $Out "$name.png"
        Copy-Item -Force $current $file
        if (-not (Test-NoTourLabel $file)) {
            Remove-Item -Force $file
            throw ("State $i carries the tour's state counter. That build is not " +
                   "-NoLabel; rebuild with .\ciq\build.ps1 -Device $Device -Screens -NoLabel.")
        }
        $bmp = New-Object System.Drawing.Bitmap $file
        $dims = "$($bmp.Width)x$($bmp.Height)"
        $bmp.Dispose()
        if ($prints.ContainsKey($print)) {
            throw "$name.png is pixel-identical to $($prints[$print]).png -- the tour did not move."
        }
        $prints[$print] = $name
        $saved += $file
        Write-Host ("  state {0,2}  {1,-12} {2}" -f $i, $name, $dims) -ForegroundColor Green
    }

    if ($i -eq $maxIndex) { break }

    # Step, then prove it stepped. With the counter off there is nothing on
    # screen that says which state this is, so a swallowed keypress would go
    # unnoticed and every file after it would be named for the state before it.
    $before = $print
    $landed = $false
    for ($try = 0; $try -lt 4 -and -not $landed; $try++) {
        [StoreShotWin]::SetForegroundWindow($hwnd) | Out-Null
        Start-Sleep -Milliseconds 200
        [System.Windows.Forms.SendKeys]::SendWait("{DOWN}")
        Start-Sleep -Milliseconds $SettleMs
        Get-DisplayShot $current | Out-Null
        $print = Get-Fingerprint $current
        if ($print -ne $before) { $landed = $true }
    }
    if (-not $landed) {
        throw ("The tour did not advance past state $i after four keypresses. " +
               "Nothing was saved for the states after it; rerun rather than trusting a partial set.")
    }
}

Remove-Item -Recurse -Force $Temp -ErrorAction SilentlyContinue

Write-Host ""
Write-Host "Wrote $($saved.Count) store screenshots to $Out" -ForegroundColor Cyan
Write-Host "Look at them before submitting. A capture run proves the app drew them," -ForegroundColor DarkGray
Write-Host "not that they show the app at its best." -ForegroundColor DarkGray
