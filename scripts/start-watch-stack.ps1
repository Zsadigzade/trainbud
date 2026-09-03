# Starts trainbud serve + ngrok tunnel for the Connect IQ watch widget.
# Run from repo root: .\scripts\start-watch-stack.ps1
#
# SETUP: Set your ngrok static domain below, or pass it as an argument:
#   .\scripts\start-watch-stack.ps1 -NgrokDomain your-domain.ngrok-free.app
#
# Get a free static domain at: https://dashboard.ngrok.com/domains
# Alternatively use Cloudflare Tunnel (see README).

param(
    # The static domain the Connect IQ app is built against: ciq/resources/settings/
    # properties.xml ships this as the default ServerUrl, and a sideloaded app has no
    # settings screen to change it on. Passing a different domain here means the watch
    # is talking to an address the server is no longer on.
    [string]$NgrokDomain = "backpedal-immorally-cathouse.ngrok-free.dev"
)

$ErrorActionPreference = "Stop"
$RepoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $RepoRoot

$ServerPort = 3847

if (-not $NgrokDomain) {
    Write-Host "ERROR: NgrokDomain not set." -ForegroundColor Red
    Write-Host "Usage: .\scripts\start-watch-stack.ps1 -NgrokDomain your-domain.ngrok-free.app"
    Write-Host "Or use Cloudflare Tunnel: cloudflared tunnel --url http://127.0.0.1:$ServerPort"
    exit 1
}

function Stop-PortListener([int]$Port) {
    $connections = netstat -ano | Select-String ":$Port\s"
    foreach ($line in $connections) {
        if ($line -match "\sLISTENING\s+(\d+)\s*$") {
            $processId = [int]$Matches[1]
            Write-Host "Stopping process on port $Port (PID $processId)..."
            Stop-Process -Id $processId -Force -ErrorAction SilentlyContinue
        }
    }
}

Write-Host "TrainBud watch stack startup"
Write-Host ""

# Free port if a stale server is running
Stop-PortListener -Port $ServerPort
Start-Sleep -Seconds 1

# Start HTTP server
Write-Host "Starting trainbud serve..."
$serveJob = Start-Job -ScriptBlock {
    Set-Location $using:RepoRoot
    npx trainbud serve 2>&1
}

Start-Sleep -Seconds 3

try {
    $health = Invoke-RestMethod -Uri "http://127.0.0.1:$ServerPort/health" -TimeoutSec 10
    Write-Host "Server OK: $($health.status)"
} catch {
    Write-Host "Server failed to start. Job output:"
    Receive-Job $serveJob
    throw
}

# Start ngrok tunnel with static domain
if (-not (Get-Command ngrok -ErrorAction SilentlyContinue)) {
    Write-Host ""
    Write-Host "ngrok not found. Install with: winget install ngrok"
    Write-Host "Server is running locally at http://127.0.0.1:$ServerPort"
    exit 1
}

Write-Host "Starting ngrok tunnel ($NgrokDomain)..."
$tunnelJob = Start-Job -ScriptBlock {
    ngrok http --url=$using:NgrokDomain $using:ServerPort 2>&1
}

# Static domain is known immediately — no need to parse output
Start-Sleep -Seconds 3
$tunnelUrl = "https://$NgrokDomain"

# Save for server to pick up
$setupPath = Join-Path $RepoRoot ".trainbud\watch-setup.json"
New-Item -ItemType Directory -Force -Path (Split-Path $setupPath) | Out-Null
# Set-Content -Encoding utf8 writes a BOM on Windows PowerShell 5.1, and
# JSON.parse treats a leading U+FEFF as a syntax error. This file held the
# correct tunnel URL for weeks while the server reported "No public URL is
# configured" and the watch had no address to call. Write UTF-8 with no BOM.
$setupJson = @{ serverUrl = $tunnelUrl; updatedAt = (Get-Date).ToUniversalTime().ToString("o") } |
    ConvertTo-Json
[System.IO.File]::WriteAllText($setupPath, $setupJson, (New-Object System.Text.UTF8Encoding $false))

# Read API key from .env for dashboard link
$apiKey = ""
if (Test-Path (Join-Path $RepoRoot ".env")) {
    # Both names are live: TRAINBUD_API_KEY is what setup writes now, GARMIN_MCP_API_KEY
    # is what a pre-0.3.0 .env still holds and the server still honours. Matching only the
    # new one printed a dashboard link with no token on every existing install, which 401s.
    $envLine = Get-Content (Join-Path $RepoRoot ".env") |
        Select-String "^(TRAINBUD_API_KEY|GARMIN_MCP_API_KEY)=" |
        Select-Object -First 1
    if ($envLine) { $apiKey = ($envLine -replace "^(TRAINBUD_API_KEY|GARMIN_MCP_API_KEY)=", "").Trim() }
}

Write-Host ""
Write-Host "=== Watch widget setup ==="
Write-Host "1. In Garmin Connect app -> Widget settings:"
Write-Host "   Server URL: $tunnelUrl"
Write-Host ""
Write-Host "2. Open dashboard to pair watch + set Claude key:"
if ($apiKey) {
    Write-Host "   $tunnelUrl/dashboard?token=$apiKey"
} else {
    Write-Host "   $tunnelUrl/dashboard?token=YOUR_TRAINBUD_API_KEY"
}
Write-Host ""
Write-Host "Saved to: $setupPath"
Write-Host ""
Write-Host "Server and tunnel are running in background jobs."
Write-Host "Stop with: Get-Job | Stop-Job; Get-Job | Remove-Job"
Write-Host "Or close this PowerShell session."

# Keep script alive so jobs stay attached to session
while ($true) {
    Start-Sleep -Seconds 60
    if ($serveJob.State -eq "Failed") {
        Write-Host "Server job failed:"
        Receive-Job $serveJob
        break
    }
    if ($tunnelJob.State -eq "Failed") {
        Write-Host "Tunnel job failed. Restarting..."
        $tunnelJob = Start-Job -ScriptBlock {
            ngrok http --url=$using:NgrokDomain $using:ServerPort 2>&1
        }
    }
}
