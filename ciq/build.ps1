# Build TrainBud Connect IQ widget (Windows)
# Usage: .\ciq\build.ps1 [-Device fenix847mm]

param(
    [string]$Device = "fenix847mm"
)

$ErrorActionPreference = "Stop"
$CiqRoot = $PSScriptRoot
$SdkRoot = Get-Content "$env:APPDATA\Garmin\ConnectIQ\current-sdk.cfg" -Raw
$SdkBin = Join-Path $SdkRoot.TrimEnd('\') "bin"
$KeyPath = Join-Path $CiqRoot "developer_key.der"
$OutPath = Join-Path $CiqRoot "bin\TrainBud.prg"

if (-not (Test-Path $SdkBin)) {
    throw "Connect IQ SDK not found. Install SDK Manager and set active SDK."
}

if (-not (Test-Path $KeyPath)) {
    Write-Host "Generating developer_key.der..."
    Push-Location $CiqRoot
    openssl genrsa -out developer_key.pem 4096
    openssl pkcs8 -topk8 -inform PEM -outform DER -in developer_key.pem -out developer_key.der -nocrypt
    Pop-Location
}

New-Item -ItemType Directory -Force -Path (Split-Path $OutPath) | Out-Null

Push-Location $CiqRoot
& (Join-Path $SdkBin "monkeyc.bat") -f monkey.jungle -o $OutPath -y $KeyPath -d $Device -w
Pop-Location

Write-Host ""
Write-Host "Built: $OutPath"
Write-Host "Simulator: monkeydo $OutPath $Device"
Write-Host "Sideload:  copy to watch via Garmin Express or CIQ app loader"
