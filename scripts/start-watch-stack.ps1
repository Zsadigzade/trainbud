# Starts trainbud serve + ngrok tunnel for the Connect IQ watch widget.
# Run from repo root: .\scripts\start-watch-stack.ps1
#
# SETUP: set TRAINBUD_NGROK_DOMAIN in your environment, or pass it as an argument:
#   $env:TRAINBUD_NGROK_DOMAIN = "your-domain.ngrok-free.app"
#   .\scripts\start-watch-stack.ps1 -NgrokDomain your-domain.ngrok-free.app
#
# Get a free static domain at: https://dashboard.ngrok.com/domains
# Alternatively use Cloudflare Tunnel (see README).
#
# THIS IS THE DEVELOPMENT PATH. For a stack that survives a reboot and a closed
# terminal, use `.\scripts\install-always-on.ps1` -- see docs/ALWAYS-ON.md.
#
# Until 2026-09-11 both halves were started with Start-Job, and a PowerShell job
# is owned by the session that created it. Every time this terminal closed, the
# server and the tunnel went with it -- and the failure was the quiet kind: the
# tunnel host kept answering, with its own HTML error page, at 200. From outside
# the domain looked alive while the product was gone. They are detached
# processes now, so closing this window leaves them running; `-Stop` is how you
# take them down on purpose.

param(
    # The static domain the sideloaded Connect IQ app is pointed at. A sideload has
    # no settings screen, so the domain baked into ciq/resources-dev is the only
    # address that watch will ever call: passing a different one here means the app
    # is talking to somewhere the server is not.
    #
    # This defaulted to the maintainer's own domain until 2026-09-06, which meant
    # anyone who cloned the repo and ran the script published a tunnel pointed at
    # someone else's address. It comes from the environment now, and the script
    # says what to set rather than guessing.
    [string]$NgrokDomain = $env:TRAINBUD_NGROK_DOMAIN,

    # Stop the detached server and tunnel this script started. Without it there
    # is no way to take them down short of hunting PIDs, which is the price of
    # them no longer dying with the shell.
    [switch]$Stop
)

$ErrorActionPreference = "Stop"
$RepoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $RepoRoot

$ServerPort = 3847

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

if ($Stop) {
    Stop-PortListener -Port $ServerPort
    Get-Process ngrok -ErrorAction SilentlyContinue | Stop-Process -Force
    Write-Host "Stopped the server on port $ServerPort and any ngrok process."
    exit 0
}

if (-not $NgrokDomain) {
    Write-Host "ERROR: no ngrok domain. This script will not guess one." -ForegroundColor Red
    Write-Host ""
    Write-Host "Set it once, in .env or your shell profile:"
    Write-Host '    $env:TRAINBUD_NGROK_DOMAIN = "your-domain.ngrok-free.app"'
    Write-Host "Or pass it per run:"
    Write-Host "    .\scripts\start-watch-stack.ps1 -NgrokDomain your-domain.ngrok-free.app"
    Write-Host ""
    Write-Host "Free static domain: https://dashboard.ngrok.com/domains"
    Write-Host "Or use Cloudflare Tunnel: cloudflared tunnel --url http://127.0.0.1:$ServerPort"
    exit 1
}

Write-Host "TrainBud watch stack startup"
Write-Host ""

# Free port if a stale server is running
Stop-PortListener -Port $ServerPort
Start-Sleep -Seconds 1

$DistEntry = Join-Path $RepoRoot "dist\index.js"
if (-not (Test-Path $DistEntry)) {
    Write-Host "ERROR: dist/index.js is missing. Run 'npm install && npm run build' first." -ForegroundColor Red
    exit 1
}

# Start HTTP server
Write-Host "Starting trainbud serve..."
# `node dist/index.js`, not `npx trainbud serve`: this script exists to run the
# working tree you just built, and npx would fetch the published release instead
# -- which is the opposite of what you want while developing. Same entry point
# the bin field points at, with no resolution step in between.
#
# Start-Process, not Start-Job: a job dies with the session that owns it, and
# that is how this stack kept going down between sessions. A detached process
# outlives this window. Output goes to files rather than to a job buffer,
# because a job buffer is unreadable once the job's owner is gone.
$LogDir = Join-Path $RepoRoot ".trainbud\logs"
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
$ServerOut = Join-Path $LogDir "server.out.log"
$ServerErr = Join-Path $LogDir "server.err.log"

$serveProcess = Start-Process -FilePath "node" `
    -ArgumentList "dist/index.js", "serve" `
    -WorkingDirectory $RepoRoot `
    -WindowStyle Hidden `
    -PassThru `
    -RedirectStandardOutput $ServerOut `
    -RedirectStandardError $ServerErr

Start-Sleep -Seconds 3

try {
    $health = Invoke-RestMethod -Uri "http://127.0.0.1:$ServerPort/health" -TimeoutSec 10
    Write-Host "Server OK: $($health.status)  (PID $($serveProcess.Id))"
} catch {
    Write-Host "Server failed to start. Last lines of $ServerErr :"
    if (Test-Path $ServerErr) { Get-Content -LiteralPath $ServerErr -Tail 20 }
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
$TunnelOut = Join-Path $LogDir "tunnel.out.log"
$TunnelErr = Join-Path $LogDir "tunnel.err.log"
$tunnelProcess = Start-Process -FilePath "ngrok" `
    -ArgumentList "http", "--url=$NgrokDomain", "$ServerPort" `
    -WorkingDirectory $RepoRoot `
    -WindowStyle Hidden `
    -PassThru `
    -RedirectStandardOutput $TunnelOut `
    -RedirectStandardError $TunnelErr

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
Write-Host "Server (PID $($serveProcess.Id)) and tunnel (PID $($tunnelProcess.Id)) are detached."
Write-Host "They KEEP RUNNING when you close this window. That is the point."
Write-Host ""
Write-Host "Stop them:   .\scripts\start-watch-stack.ps1 -Stop"
Write-Host "Logs:        $LogDir"
Write-Host "Check:       trainbud doctor"
Write-Host ""
Write-Host "For a stack that comes back by itself after a reboot, install it once:"
Write-Host "    .\scripts\install-always-on.ps1 -Hostname $NgrokDomain"
Write-Host "    (docs/ALWAYS-ON.md)"

# No babysitting loop. There used to be one here, whose only job was to hold the
# session open so the jobs it owned stayed alive; with detached processes there
# is nothing to hold open. Restart-on-failure belongs to scripts/watchdog.ps1,
# which runs on a schedule and therefore still works when nobody is logged into
# a terminal -- which was always when this was needed.
exit 0
