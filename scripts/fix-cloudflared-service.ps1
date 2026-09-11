# Make the Cloudflared Windows service actually run the tunnel.
#
#     Right-click PowerShell -> Run as administrator, then:
#     .\scripts\fix-cloudflared-service.ps1
#
# WHY THIS EXISTS
#
# `cloudflared service install` (no token) registers the service with NO
# arguments:
#
#     PathName  : ...\cloudflared.exe
#     StartName : LocalSystem
#
# It then looks for a config in LOCALSYSTEM's profile -- not the user's -- finds
# nothing, and sits there reporting "Running" while tunnelling nothing at all.
# Cloudflare answers the hostname with **Error 1033, no active connector**,
# which reads like a DNS fault or a bad tunnel and is neither. `cloudflared
# tunnel info <name>` saying "does not have any active connection" while the
# service says Running is the signature of exactly this.
#
# Two things are therefore made explicit rather than left to discovery:
#   1. the config lives where the service account looks, with the credentials
#      file beside it and referenced by an absolute path;
#   2. the service command line NAMES the tunnel and the config, so there is no
#      search path to get wrong.
#
# Idempotent. Safe to re-run.

[CmdletBinding()]
param(
    [string]$TunnelName = "trainbud",
    [string]$TunnelId   = "5900e268-f7ee-4b41-909f-327fe55b7327",
    [string]$Hostname   = "api.trainbud.site",
    [int]$Port          = 3847
)

$ErrorActionPreference = "Stop"

$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
if (-not ([Security.Principal.WindowsPrincipal]$identity).IsInRole(
        [Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Write-Host "This needs an elevated prompt." -ForegroundColor Red
    Write-Host "  Start -> type powershell -> right-click -> Run as administrator"
    exit 1
}

$userDir = Join-Path $env:USERPROFILE ".cloudflared"
$sysDir  = "C:\Windows\System32\config\systemprofile\.cloudflared"
$exe     = (Get-Command cloudflared -ErrorAction Stop).Source
# Resolve the shim to the real binary: a service must not depend on a shim that
# a package manager can rewrite underneath it.
if ($exe -like "*\shims\*") {
    $real = Join-Path (Split-Path (Split-Path $exe)) "apps\cloudflared\current\cloudflared.exe"
    if (Test-Path $real) { $exe = $real }
}
Write-Host "cloudflared: $exe"

# --- 1. stop whatever is there, including a stuck StopPending --------------

$svc = Get-Service -Name "Cloudflared" -ErrorAction SilentlyContinue
if ($svc) {
    Write-Host "Stopping the service (currently $($svc.Status))..."
    try { Stop-Service -Name "Cloudflared" -Force -ErrorAction SilentlyContinue } catch {}

    $deadline = (Get-Date).AddSeconds(20)
    while ((Get-Date) -lt $deadline -and
           (Get-Service -Name "Cloudflared").Status -ne "Stopped") {
        Start-Sleep -Milliseconds 500
    }

    if ((Get-Service -Name "Cloudflared").Status -ne "Stopped") {
        # StopPending that never completes. The service host is waiting on a
        # process that is not going to exit on its own.
        Write-Host "  still not stopped; killing the process"
        Get-Process cloudflared -ErrorAction SilentlyContinue | Stop-Process -Force
        Start-Sleep -Seconds 3
    }
}

# --- 2. put the config where the service account will find it --------------

New-Item -ItemType Directory -Force -Path $sysDir | Out-Null

$srcCreds = Join-Path $userDir "$TunnelId.json"
$dstCreds = Join-Path $sysDir  "$TunnelId.json"
if (-not (Test-Path $srcCreds)) { throw "Credentials file missing: $srcCreds" }
Copy-Item -LiteralPath $srcCreds -Destination $dstCreds -Force
Write-Host "Credentials: $dstCreds"

$configPath = Join-Path $sysDir "config.yml"
$config = @"
# TrainBud - Cloudflare named tunnel. THIS is the copy the Windows service reads.
# The one under the user profile is for running the tunnel by hand; keep them in
# step or they will disagree about what is served.
#
# The apex trainbud.site is deliberately NOT routed here - it stays free for a
# landing page. Only $Hostname reaches this machine.
#
# The final rule has no hostname and is REQUIRED: cloudflared refuses to start
# without a catch-all.
tunnel: $TunnelId
credentials-file: $dstCreds

# 127.0.0.1, not 0.0.0.0: the server binds loopback only, and the security
# posture is that nothing reaches it except through this tunnel.
ingress:
  - hostname: $Hostname
    service: http://127.0.0.1:$Port
  - service: http_status:404
"@
[System.IO.File]::WriteAllText($configPath, $config, (New-Object System.Text.UTF8Encoding $false))
Write-Host "Config:      $configPath"

# --- 3. name the tunnel and the config on the command line -----------------

$binPath = '"{0}" --config "{1}" tunnel run {2}' -f $exe, $configPath, $TunnelName

if (Get-Service -Name "Cloudflared" -ErrorAction SilentlyContinue) {
    # sc.exe, not Set-Service: Set-Service cannot change a binary path on
    # Windows PowerShell 5.1. The space after binPath= is required by sc.exe.
    & sc.exe config Cloudflared binPath= $binPath start= auto | Out-Null
    Write-Host "Service command line set."
} else {
    & sc.exe create Cloudflared binPath= $binPath start= auto DisplayName= "Cloudflared" | Out-Null
    Write-Host "Service created."
}
Write-Host "  $binPath"

# --- 4. start it and prove it connected ------------------------------------

Write-Host ""
Write-Host "Starting..."
Start-Service -Name "Cloudflared"
Start-Sleep -Seconds 15

Get-Service Cloudflared | Select-Object Name, Status, StartType | Format-Table -AutoSize

Write-Host "Active connections -- this is the only check that matters:"
& cloudflared tunnel info $TunnelName 2>&1 |
    Select-String -NotMatch "outdated|WRN" | Select-Object -First 10

Write-Host ""
Write-Host "If that lists connectors, the tunnel is live. You can close this window."
