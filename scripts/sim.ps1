# Restart the Connect IQ simulator and load a build into it.
#
# Driving this from an automated shell proved unreliable: monkeydo often exits
# silently without loading anything, and the simulator gives no feedback either
# way. Run it yourself from a terminal and you get monkeydo's output live.
#
# Usage:
#   .\scripts\sim.ps1                       # restart sim, load bin\TrainBud-sim.prg on fr70
#   .\scripts\sim.ps1 -Device fenix847mm    # a different device
#   .\scripts\sim.ps1 -NoRestart            # keep the running sim, just reload the app
#
# The window stays attached to monkeydo. Ctrl+C to stop, then re-run to reload.

param(
    [string]$Prg = "bin\TrainBud-sim.prg",
    [string]$Device = "fr70",
    [switch]$NoRestart
)

$ErrorActionPreference = "Stop"

$SdkRoot = (Get-Content "$env:APPDATA\Garmin\ConnectIQ\current-sdk.cfg" -Raw).TrimEnd("`r", "`n", "\")
$SdkBin = Join-Path $SdkRoot "bin"
if (-not (Test-Path $SdkBin)) {
    throw "Connect IQ SDK not found at $SdkBin. Open SDK Manager and set an active SDK."
}

$CiqRoot = Join-Path (Split-Path $PSScriptRoot -Parent) "ciq"
Set-Location $CiqRoot

if (-not (Test-Path $Prg)) {
    throw "Build not found: $(Join-Path $CiqRoot $Prg). Build it first, e.g. .\build.ps1 -Device $Device"
}

$built = (Get-Item $Prg).LastWriteTime
Write-Host "Loading : $Prg" -ForegroundColor Cyan
Write-Host "Built   : $built" -ForegroundColor Cyan
Write-Host "Device  : $Device" -ForegroundColor Cyan
Write-Host ""

if (-not $NoRestart) {
    $running = Get-Process -Name simulator -ErrorAction SilentlyContinue
    if ($running) {
        Write-Host "Stopping running simulator..." -ForegroundColor DarkGray
        $running | Stop-Process -Force
        Start-Sleep -Seconds 3
    }

    Write-Host "Starting simulator..." -ForegroundColor DarkGray
    Start-Process -FilePath (Join-Path $SdkBin "connectiq.bat") -WindowStyle Minimized

    # The simulator needs to be listening before monkeydo will connect; there is
    # no ready signal to wait on, so this is a plain settle time.
    Start-Sleep -Seconds 20
}

Write-Host "Loading app (Ctrl+C to stop)..." -ForegroundColor Green
Write-Host ""
& (Join-Path $SdkBin "monkeydo.bat") $Prg $Device
