# Build TrainBud Connect IQ widget (Windows)
#
# Usage:
#   .\ciq\build.ps1                        # store build, one device
#   .\ciq\build.ps1 -Device fr55
#   .\ciq\build.ps1 -Device fr55 -Dev      # bake a Server URL in, for sideloading
#   .\ciq\build.ps1 -Device fr55 -NoGlance # force the widget, not the glance, in the simulator
#   .\ciq\build.ps1 -Package               # the .iq store package, every device

param(
    [string]$Device = "fenix847mm",

    # Layers resources-dev over the shipped properties so the build carries a
    # Server URL. Sideloaded apps get no settings screen, so this is the only
    # way to point one at a server. The store build ships an EMPTY default on
    # purpose -- it shipped a personal ngrok tunnel from 1.2.0 to 1.3.0 and no
    # store user could pair. Never use this switch for a submission.
    [switch]$Dev,

    # The simulator renders the glance for any app that has one and gives no way
    # to step from the glance into the widget, so a normal build can only be
    # watched sitting in the glance list.
    [switch]$NoGlance,

    # Build the screen tour: every screen the app can draw, stepped with one key
    # and no server at all. See ciq/source-screens/ScreenTour.mc.
    #
    # This exists because 1.3.0 shipped to the store having never been drawn once
    # and the first simulator run found six layout bugs, and because the AI
    # screens then shipped undrawn a version later -- reaching them needed a live
    # HTTPS server, an API key and a failure on cue, and those three were never
    # available at the same moment. Implies -NoGlance, since the tour lives in
    # the widget view.
    [switch]$Screens,

    # Build the tour with its state counter off, which is the only build a
    # Connect IQ Store screenshot may come from. The counter is drawn over the
    # app's own pixels, so a labelled capture cropped to the display carries
    # "9/28" into the store. Pairs with scripts/capture-store-shots.ps1.
    [switch]$NoLabel,

    # Export every device in the manifest as ciq/bin/TrainBud.iq.
    [switch]$Package
)

$ErrorActionPreference = "Stop"
$CiqRoot = $PSScriptRoot
$SdkRoot = Get-Content "$env:APPDATA\Garmin\ConnectIQ\current-sdk.cfg" -Raw
$SdkBin = Join-Path $SdkRoot.TrimEnd('\') "bin"
$KeyPath = Join-Path $CiqRoot "developer_key.der"

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

New-Item -ItemType Directory -Force -Path (Join-Path $CiqRoot "bin") | Out-Null

$Jungles = @("monkey.jungle")
if ($Dev) {
    $DevProps = Join-Path $CiqRoot "resources-dev\settings\properties.xml"
    if (-not (Test-Path $DevProps)) {
        throw "-Dev needs resources-dev\settings\properties.xml. Copy properties.xml.example to it and set your tunnel URL."
    }
    $Jungles += "monkey-dev.jungle"
}
# -Screens excludes `glance` itself rather than chaining monkey-noglance.jungle.
# A jungle setting is assigned, not appended: listing both files left only the
# last base.excludeAnnotations standing, the glance view came back, and the
# simulator sat in the glance list while a capture run photographed it 23 times.
if ($NoGlance -and -not $Screens) { $Jungles += "monkey-noglance.jungle" }
# Exactly one of the two screen-tour jungles, never both: they differ only in
# which half of the labelVisible() pair they exclude, and listing both would
# leave whichever came last.
if ($Screens) {
    if ($NoLabel) { $Jungles += "monkey-screens-nolabel.jungle" }
    else          { $Jungles += "monkey-screens.jungle" }
}
if ($NoLabel -and -not $Screens) { throw "-NoLabel only means anything with -Screens: it turns off the screen tour's own state counter." }
$JungleArg = $Jungles -join ";"

Push-Location $CiqRoot
if ($Package) {
    if ($Dev) { Pop-Location; throw "Refusing to package with -Dev: that bakes a personal Server URL into the store build." }
    if ($Screens) { Pop-Location; throw "Refusing to package with -Screens: that ships a debug screen tour instead of the app." }
    $OutPath = Join-Path $CiqRoot "bin\TrainBud.iq"
    & (Join-Path $SdkBin "monkeyc.bat") -e -f $JungleArg -o $OutPath -y $KeyPath -w -r
} else {
    $Suffix = ""
    if ($Dev) { $Suffix += "-dev" }
    if ($Screens) {
        if ($NoLabel) { $Suffix += "-screens-nolabel" } else { $Suffix += "-screens" }
    }
    elseif ($NoGlance) { $Suffix += "-noglance" }
    $OutPath = Join-Path $CiqRoot "bin\TrainBud$Suffix.prg"
    & (Join-Path $SdkBin "monkeyc.bat") -f $JungleArg -o $OutPath -y $KeyPath -d $Device -w
}
Pop-Location

if ($LASTEXITCODE -ne 0) { throw "monkeyc failed with exit code $LASTEXITCODE" }

Write-Host ""
Write-Host "Built: $OutPath  (jungles: $JungleArg)"
if (-not $Package) {
    Write-Host "Simulator: monkeydo $OutPath $Device"
    Write-Host "Sideload:  copy to watch via Garmin Express or CIQ app loader"
}
