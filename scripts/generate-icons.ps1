# Generates TrainBud icon assets (Windows, System.Drawing).
#
# The previous asset set was a large letter "G" on teal, which reads as a vendor
# monogram and is a trademark risk on the Connect IQ store. This mark is
# letter-free: three ascending bars (training progress) over a dark disc.
#
# Usage: .\scripts\generate-icons.ps1

param(
    [switch]$Force
)

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Drawing

$RepoRoot = Split-Path $PSScriptRoot -Parent

$Background = [System.Drawing.Color]::FromArgb(255, 16, 33, 51)   # deep slate
$BarDim     = [System.Drawing.Color]::FromArgb(255, 148, 178, 204) # muted steel
$BarMid     = [System.Drawing.Color]::FromArgb(255, 208, 227, 240) # near white
$BarBright  = [System.Drawing.Color]::FromArgb(255, 61, 220, 132)  # accent green

# Windows PowerShell's -Encoding utf8 writes a BOM, and the Monkey C jungle
# parser fails on it ("mismatched input '=' expecting NEWLINE" on line 1).
function Write-TextNoBom {
    param(
        [string]$Path,
        [string]$Content
    )
    $noBom = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllText($Path, $Content, $noBom)
}

function New-Icon {
    param(
        [int]$Size,
        [string]$Path,
        [bool]$Transparent = $true
    )

    $bitmap = New-Object System.Drawing.Bitmap($Size, $Size)
    $g = [System.Drawing.Graphics]::FromImage($bitmap)
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic

    if ($Transparent) {
        $g.Clear([System.Drawing.Color]::Transparent)
    } else {
        $g.Clear($Background)
    }

    # Disc
    $discBrush = New-Object System.Drawing.SolidBrush($Background)
    $inset = [Math]::Max(1, [int]($Size * 0.02))
    $g.FillEllipse($discBrush, $inset, $inset, $Size - (2 * $inset), $Size - (2 * $inset))

    # Three ascending bars, baseline aligned, rounded ends.
    $barWidth   = $Size * 0.15
    $gap        = $Size * 0.075
    $totalWidth = (3 * $barWidth) + (2 * $gap)
    $left       = ($Size - $totalWidth) / 2.0
    $baseline   = $Size * 0.71
    $heights    = @(($Size * 0.18), ($Size * 0.29), ($Size * 0.41))
    $colors     = @($BarDim, $BarMid, $BarBright)

    for ($i = 0; $i -lt 3; $i++) {
        $x = $left + ($i * ($barWidth + $gap))
        $h = $heights[$i]
        $y = $baseline - $h
        $brush = New-Object System.Drawing.SolidBrush($colors[$i])
        $radius = [Math]::Min($barWidth / 2.0, $h / 2.0)

        $pathObj = New-Object System.Drawing.Drawing2D.GraphicsPath
        $d = $radius * 2.0
        $pathObj.AddArc($x, $y, $d, $d, 180, 90)
        $pathObj.AddArc($x + $barWidth - $d, $y, $d, $d, 270, 90)
        $pathObj.AddArc($x + $barWidth - $d, $baseline - $d, $d, $d, 0, 90)
        $pathObj.AddArc($x, $baseline - $d, $d, $d, 90, 90)
        $pathObj.CloseFigure()

        $g.FillPath($brush, $pathObj)
        $pathObj.Dispose()
        $brush.Dispose()
    }

    # Rising trend line above the bars.
    $penWidth = [Math]::Max(1.0, $Size * 0.045)
    $pen = New-Object System.Drawing.Pen($BarBright, $penWidth)
    $pen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
    $pen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
    $pen.LineJoin = [System.Drawing.Drawing2D.LineJoin]::Round
    $points = @(
        (New-Object System.Drawing.PointF([single]($Size * 0.26), [single]($Size * 0.38))),
        (New-Object System.Drawing.PointF([single]($Size * 0.44), [single]($Size * 0.29))),
        (New-Object System.Drawing.PointF([single]($Size * 0.74), [single]($Size * 0.20)))
    )
    $g.DrawLines($pen, $points)
    $pen.Dispose()

    $g.Dispose()
    $discBrush.Dispose()

    $dir = Split-Path $Path -Parent
    if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
    $bitmap.Save($Path, [System.Drawing.Imaging.ImageFormat]::Png)
    $bitmap.Dispose()

    Write-Host "  $Path ($Size x $Size)"
}

Write-Host "Generating TrainBud icons..."
# Launcher icons are device-specific (35x35 through 70x70). Shipping one source
# icon made the compiler rescale it for every product and warn once per device.
# Instead, emit one exact-size icon per distinct launcher size into its own
# resource directory; monkey.jungle points each product at the right one.
#
# Sizes are read from the SDK's own device definitions, so adding a product to
# the manifest and re-running this script keeps the set correct.
$DeviceDir = "$env:APPDATA\Garmin\ConnectIQ\Devices"
$ManifestPath = Join-Path $RepoRoot "ciq\manifest.xml"
$manifestText = Get-Content $ManifestPath -Raw
$productIds = [regex]::Matches($manifestText, '<iq:product id="([^"]+)"') | ForEach-Object { $_.Groups[1].Value }

$sizeToDevices = @{}
foreach ($id in $productIds) {
    $compilerJson = Join-Path $DeviceDir "$id\compiler.json"
    if (-not (Test-Path $compilerJson)) {
        Write-Warning "No SDK definition for '$id' - skipping launcher icon mapping."
        continue
    }
    $definition = Get-Content $compilerJson -Raw | ConvertFrom-Json
    $iconSize = $definition.launcherIcon.width
    if ($null -eq $iconSize) {
        Write-Warning "Device '$id' declares no launcher icon size - skipping."
        continue
    }
    $key = [string]$iconSize
    if (-not $sizeToDevices.ContainsKey($key)) { $sizeToDevices[$key] = @() }
    $sizeToDevices[$key] += $id
}

# Remove stale per-size directories so a shrinking device list does not leave
# orphaned resources behind that the compiler would still pick up.
Get-ChildItem -Path (Join-Path $RepoRoot "ciq") -Directory -Filter "resources-launcher-*" -ErrorAction SilentlyContinue |
    Remove-Item -Recurse -Force

foreach ($key in ($sizeToDevices.Keys | Sort-Object { [int]$_ })) {
    $dir = Join-Path $RepoRoot "ciq\resources-launcher-$key\drawables"
    New-Item -ItemType Directory -Force -Path $dir | Out-Null
    New-Icon -Size ([int]$key) -Path (Join-Path $dir "launcher_icon.png")
    $drawablesXml = @"
<drawables>
    <bitmap id="LauncherIcon" filename="launcher_icon.png"/>
</drawables>
"@
    Write-TextNoBom -Path (Join-Path $dir "drawables.xml") -Content $drawablesXml
}

# Emit the jungle fragment mapping each product to its launcher resource dir.
$jungleLines = @(
    "project.manifest = manifest.xml"
    ""
    "# Launcher icons are exact-size per device. Generated by"
    "# scripts/generate-icons.ps1 - re-run it after changing the product list."
    "# The base resources directory deliberately declares no LauncherIcon, so"
    "# there is exactly one definition per build and no duplicate resource id."
)
foreach ($key in ($sizeToDevices.Keys | Sort-Object { [int]$_ })) {
    foreach ($id in ($sizeToDevices[$key] | Sort-Object)) {
        $jungleLines += "$id.resourcePath = " + '$(' + "$id.resourcePath);resources-launcher-$key"
    }
}
Write-TextNoBom -Path (Join-Path $RepoRoot "ciq\monkey.jungle") -Content (($jungleLines -join "`n") + "`n")
Write-Host "  ciq\monkey.jungle (launcher resource mapping for $($productIds.Count) products)"
New-Icon -Size 130 -Path (Join-Path $RepoRoot "ciq\store\store_icon.png")
New-Icon -Size 500 -Path (Join-Path $RepoRoot "ciq\store\cover_500.png") -Transparent $false
Write-Host ""
Write-Host "Done. No lettering is used, so the mark carries no vendor initial."
