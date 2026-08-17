# Generate Connect IQ Store screenshots from live /api/watch data.
# Usage: .\scripts\generate-store-screenshots.ps1

$ErrorActionPreference = "Stop"
$RepoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $RepoRoot

Add-Type -AssemblyName System.Drawing

function Get-WatchSummary {
    $setup = Get-Content ".trainbud\watch-setup.json" | ConvertFrom-Json
    $apiKeyLine = Get-Content ".env" | Where-Object { $_ -match "^TRAINBUD_API_KEY=" }
    $apiKey = $apiKeyLine -replace "^TRAINBUD_API_KEY=", ""

    if (-not $setup.serverUrl) {
        throw "Missing serverUrl in .trainbud/watch-setup.json. Run .\scripts\start-watch-stack.ps1 first."
    }

    return Invoke-RestMethod -Uri "$($setup.serverUrl)/api/watch" -Headers @{
        Authorization = "Bearer $apiKey"
    }
}

function Save-PngUnderSize([System.Drawing.Bitmap]$bitmap, [string]$path, [int]$maxBytes) {
    $dir = Split-Path $path -Parent
    if (-not (Test-Path $dir)) {
        New-Item -ItemType Directory -Force -Path $dir | Out-Null
    }

    $encoders = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() |
        Where-Object { $_.MimeType -eq "image/png" }
    $encoderParams = New-Object System.Drawing.Imaging.EncoderParameters(1)
    $encoderParams.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter(
        [System.Drawing.Imaging.Encoder]::Compression,
        1
    )

    $bitmap.Save($path, $encoders[0], $encoderParams)

    if ((Get-Item $path).Length -le $maxBytes) {
        return
    }

    $jpgPath = [System.IO.Path]::ChangeExtension($path, ".jpg")
    $jpegCodec = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() |
        Where-Object { $_.MimeType -eq "image/jpeg" }
    foreach ($quality in @(90, 80, 70, 60)) {
        $encoderParams.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter(
            [System.Drawing.Imaging.Encoder]::Quality,
            [long]$quality
        )
        $bitmap.Save($jpgPath, $jpegCodec[0], $encoderParams)
        if ((Get-Item $jpgPath).Length -le $maxBytes) {
            Move-Item -Force $jpgPath $path
            return
        }
    }

    Move-Item -Force $jpgPath $path
}

function New-RoundWatchBitmap([int]$size) {
    $bmp = New-Object System.Drawing.Bitmap $size, $size
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.Clear([System.Drawing.Color]::Black)
    return @{ Bitmap = $bmp; Graphics = $g }
}

function Draw-CenteredText($g, $text, $font, $brush, $x, $y, $width) {
    $format = New-Object System.Drawing.StringFormat
    $format.Alignment = [System.Drawing.StringAlignment]::Center
    $format.LineAlignment = [System.Drawing.StringAlignment]::Center
    $rect = New-Object System.Drawing.RectangleF($x, $y, $width, 40)
    $g.DrawString($text, $font, $brush, $rect, $format)
}

function Draw-OverviewScreen($summary) {
    $ctx = New-RoundWatchBitmap 390
    $g = $ctx.Graphics
    $white = [System.Drawing.Brushes]::White
    $gray = [System.Drawing.Brushes]::LightGray
    $green = [System.Drawing.Brushes]::LimeGreen
    $titleFont = New-Object System.Drawing.Font("Segoe UI", 14, [System.Drawing.FontStyle]::Regular)
    $valueFont = New-Object System.Drawing.Font("Segoe UI", 18, [System.Drawing.FontStyle]::Bold)
    $labelFont = New-Object System.Drawing.Font("Segoe UI", 9, [System.Drawing.FontStyle]::Regular)

    Draw-CenteredText $g "Overview" $titleFont $white 0 24 390

    $overview = $summary.daily_overview
    $cells = @(
        @{ Label = "Rec"; Value = if ($overview.recovery) { "$($overview.recovery)" } else { "--" }; X = 95; Y = 150; Brush = $green },
        @{ Label = "Sleep"; Value = if ($overview.sleep_h) { "$($overview.sleep_h)h" } else { "--" }; X = 295; Y = 150; Brush = $white },
        @{ Label = "Stress"; Value = if ($overview.stress) { "$($overview.stress)" } else { "--" }; X = 95; Y = 250; Brush = $white },
        @{ Label = "VO2"; Value = if ($overview.vo2max) { "$($overview.vo2max)" } else { "--" }; X = 295; Y = 250; Brush = $white }
    )

    foreach ($cell in $cells) {
        Draw-CenteredText $g $cell.Label $labelFont $gray ($cell.X - 50) ($cell.Y - 30) 100
        Draw-CenteredText $g $cell.Value $valueFont $cell.Brush ($cell.X - 50) ($cell.Y - 5) 100
    }

    Draw-CenteredText $g "Tap or swipe to switch" $labelFont $gray 0 350 390
    return $ctx.Bitmap
}

function Draw-RecoveryScreen($summary) {
    $ctx = New-RoundWatchBitmap 390
    $g = $ctx.Graphics
    $white = [System.Drawing.Brushes]::White
    $gray = [System.Drawing.Brushes]::LightGray
    $green = [System.Drawing.Brushes]::LimeGreen
    $titleFont = New-Object System.Drawing.Font("Segoe UI", 14, [System.Drawing.FontStyle]::Regular)
    $scoreFont = New-Object System.Drawing.Font("Segoe UI", 36, [System.Drawing.FontStyle]::Bold)
    $labelFont = New-Object System.Drawing.Font("Segoe UI", 10, [System.Drawing.FontStyle]::Regular)

    Draw-CenteredText $g "Recovery" $titleFont $white 0 24 390

    $score = if ($summary.recovery) { [int]$summary.recovery.score } else { 0 }
    $label = if ($summary.recovery) { $summary.recovery.label } else { "No data" }

    $pen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(60, 60, 60), 10)
    $g.DrawEllipse($pen, 95, 95, 200, 200)
    $arcPen = New-Object System.Drawing.Pen([System.Drawing.Color]::LimeGreen, 10)
    $g.DrawArc($arcPen, 95, 95, 200, 200, 90, -([single]($score * 3.6)))
    Draw-CenteredText $g "$score" $scoreFont $green 0 175 390
    Draw-CenteredText $g $label $labelFont $gray 0 230 390
    Draw-CenteredText $g "Tap or swipe to switch" $labelFont $gray 0 350 390
    return $ctx.Bitmap
}

function Draw-SleepScreen($summary) {
    $ctx = New-RoundWatchBitmap 390
    $g = $ctx.Graphics
    $white = [System.Drawing.Brushes]::White
    $gray = [System.Drawing.Brushes]::LightGray
    $yellow = [System.Drawing.Brushes]::Gold
    $titleFont = New-Object System.Drawing.Font("Segoe UI", 14, [System.Drawing.FontStyle]::Regular)
    $valueFont = New-Object System.Drawing.Font("Segoe UI", 36, [System.Drawing.FontStyle]::Bold)
    $labelFont = New-Object System.Drawing.Font("Segoe UI", 10, [System.Drawing.FontStyle]::Regular)

    Draw-CenteredText $g "Sleep" $titleFont $white 0 24 390

    $hours = if ($summary.sleep) { "$($summary.sleep.hours)h" } else { "No data" }
    $subtitle = if ($summary.sleep -and $summary.sleep.score) {
        "Score $($summary.sleep.score)"
    } elseif ($summary.sleep) {
        $summary.sleep.label
    } else {
        ""
    }

    Draw-CenteredText $g $hours $valueFont $yellow 0 175 390
    if ($subtitle) {
        Draw-CenteredText $g $subtitle $labelFont $gray 0 230 390
    }
    Draw-CenteredText $g "Tap or swipe to switch" $labelFont $gray 0 350 390
    return $ctx.Bitmap
}

function Draw-CoverImage {
    $src = Join-Path $RepoRoot "ciq\store\store_icon.png"
    if (-not (Test-Path $src)) {
        $src = Join-Path $RepoRoot "ciq\resources\drawables\launcher_icon.png"
    }

    $img = [System.Drawing.Image]::FromFile($src)
    $bmp = New-Object System.Drawing.Bitmap 500, 500
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.Clear([System.Drawing.Color]::Black)
    $g.DrawImage($img, 0, 0, 500, 500)
    $g.Dispose()
    $img.Dispose()
    return $bmp
}

Write-Host "Fetching watch summary..."
$summary = Get-WatchSummary

$outDir = Join-Path $RepoRoot "ciq\store\screenshots"
New-Item -ItemType Directory -Force -Path $outDir | Out-Null

$screens = @(
    @{ Name = "01-overview.png"; Factory = { Draw-OverviewScreen $summary } },
    @{ Name = "02-recovery.png"; Factory = { Draw-RecoveryScreen $summary } },
    @{ Name = "03-sleep.png"; Factory = { Draw-SleepScreen $summary } }
)

foreach ($screen in $screens) {
    $bmp = & $screen.Factory
    $path = Join-Path $outDir $screen.Name
    Save-PngUnderSize $bmp $path 150000
    $bmp.Dispose()
    $sizeKb = [math]::Round((Get-Item $path).Length / 1KB, 1)
    Write-Host "Wrote $path ($sizeKb KB)"
}

$coverPath = Join-Path $RepoRoot "ciq\store\cover_500.png"
$cover = Draw-CoverImage
Save-PngUnderSize $cover $coverPath 300000
$cover.Dispose()
Write-Host "Wrote $coverPath"

Write-Host ""
Write-Host "Store assets ready in ciq\store\"
