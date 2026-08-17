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
# Launcher icons vary per device (40x40 up to 70x70). A single 80x80 source is
# downscaled by the compiler for every target, which is sharper than upscaling a
# 40x40 asset — that upscale was the source of the fr70 build warning.
New-Icon -Size 80  -Path (Join-Path $RepoRoot "ciq\resources\drawables\launcher_icon.png")
New-Icon -Size 130 -Path (Join-Path $RepoRoot "ciq\store\store_icon.png")
New-Icon -Size 500 -Path (Join-Path $RepoRoot "ciq\store\cover_500.png") -Transparent $false
Write-Host ""
Write-Host "Done. No lettering is used, so the mark carries no vendor initial."
