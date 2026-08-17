# Start Connect IQ simulator and load TrainBud on fr70.
# Usage: .\scripts\launch-simulator.ps1

$ErrorActionPreference = "Stop"
$RepoRoot = Split-Path -Parent $PSScriptRoot
$CiqRoot = Join-Path $RepoRoot "ciq"
$PrgPath = Join-Path $CiqRoot "bin\TrainBud.prg"
$Device = "fr70"

$SdkRoot = (Get-Content "$env:APPDATA\Garmin\ConnectIQ\current-sdk.cfg" -Raw).TrimEnd('\')
$SdkBin = Join-Path $SdkRoot "bin"
$SimulatorExe = Join-Path $SdkBin "simulator.exe"
$MonkeyDo = Join-Path $SdkBin "monkeydo.bat"

if (-not (Test-Path $PrgPath)) {
    Push-Location $CiqRoot
    & (Join-Path $CiqRoot "build.ps1") -Device $Device
    Pop-Location
}

$sim = Get-Process -Name "simulator" -ErrorAction SilentlyContinue
if (-not $sim) {
    Write-Host "Starting Connect IQ simulator..."
    Start-Process -FilePath $SimulatorExe -WorkingDirectory $SdkBin | Out-Null

    $ready = $false
    for ($i = 0; $i -lt 45; $i++) {
        Start-Sleep -Seconds 1
        if (Get-Process -Name "simulator" -ErrorAction SilentlyContinue) {
            $ready = $true
            break
        }
    }

    if (-not $ready) {
        throw "Simulator did not start. Open Connect IQ SDK Manager and start the simulator manually."
    }

    Start-Sleep -Seconds 5
} else {
    Write-Host "Simulator already running (PID $($sim.Id))."
}

Write-Host "Loading TrainBud on $Device..."
Push-Location $CiqRoot

$monkeyJob = Start-Job -ScriptBlock {
    param($MonkeyDo, $PrgPath, $DeviceId)
    & $MonkeyDo $PrgPath $DeviceId 2>&1
} -ArgumentList $MonkeyDo, $PrgPath, $Device

Wait-Job $monkeyJob -Timeout 25 | Out-Null
$output = Receive-Job $monkeyJob
Pop-Location

if ($monkeyJob.State -eq "Running") {
    Stop-Job $monkeyJob
    Remove-Job $monkeyJob
    Write-Host ""
    Write-Host "monkeydo timed out. In the simulator window, pick device '$Device' (File -> Select Device), then run:"
    Write-Host "  .\scripts\launch-simulator.ps1"
    exit 1
}

Remove-Job $monkeyJob
if ($output) {
    $output | ForEach-Object { Write-Host $_ }
}

Write-Host ""
Write-Host "Widget loaded. Configure settings in the simulator:"
Write-Host "  Simulation -> App Settings -> TrainBud"
$setup = Get-Content (Join-Path $RepoRoot ".trainbud\watch-setup.json") | ConvertFrom-Json
Write-Host "  Server URL: $($setup.serverUrl)"
Write-Host "  API Key:    TRAINBUD_API_KEY from .env"
