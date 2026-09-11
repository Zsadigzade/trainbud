# Makes TrainBud survive a reboot, a logoff, and every closed terminal.
#
#     .\scripts\install-always-on.ps1 -Hostname trainbud.example.com
#
# Run it once. After that the server starts with Windows, the tunnel runs as a
# Windows service, and a watchdog puts back whichever half falls over.
#
# WHAT THIS REPLACES, AND WHY IT IS A DIFFERENT SHAPE
#
# scripts/start-watch-stack.ps1 starts both halves with Start-Job. A PowerShell
# job is owned by the session that created it and dies with it -- the script
# says so itself, in its own closing line: "Or close this PowerShell session."
# That is the entire cause of the stack being down every time somebody went
# looking for it. Jobs are the wrong primitive for something that must outlive
# the person who started it.
#
# So: a Scheduled Task for the server, a Windows service for the tunnel, and a
# second Scheduled Task that checks both. Nothing here is owned by a terminal.
#
# UNINSTALL
#
#     .\scripts\install-always-on.ps1 -Uninstall
#
# which removes the tasks. The tunnel service is left alone -- it was installed
# by cloudflared or ngrok and it is theirs to remove:
#     cloudflared service uninstall
#     ngrok service uninstall

[CmdletBinding()]
param(
    # The public hostname the watch and your MCP clients will call, e.g.
    # trainbud.example.com. Required unless -SkipTunnel or -Uninstall.
    [string]$Hostname,

    # Register the tasks but do not touch the tunnel. Use when the tunnel is
    # already installed as a service, or deliberately run by hand.
    [switch]$SkipTunnel,

    # Minutes between watchdog runs.
    [int]$WatchdogMinutes = 5,

    [switch]$Uninstall
)

$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "lib\trainbud-env.ps1")

$RepoRoot = Get-TrainBudRoot
$ServerTaskName = "TrainBud Server"
$WatchdogTaskName = "TrainBud Watchdog"

function Assert-TaskRegistered([string]$Name) {
    <#
        Register-ScheduledTask surfaces a rejected task XML as a non-terminating
        CimException, so the script carries on and the next line congratulates
        itself on a task that does not exist. Ask the scheduler instead of
        trusting the call.
    #>
    if (-not (Get-ScheduledTask -TaskName $Name -ErrorAction SilentlyContinue)) {
        throw "Scheduled task '$Name' was not registered. The error above is the reason."
    }
}

function Test-Elevated {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    return ([Security.Principal.WindowsPrincipal]$identity).IsInRole(
        [Security.Principal.WindowsBuiltInRole]::Administrator)
}

# --- uninstall -------------------------------------------------------------

if ($Uninstall) {
    foreach ($name in @($ServerTaskName, $WatchdogTaskName)) {
        if (Get-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue) {
            Stop-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue
            Unregister-ScheduledTask -TaskName $name -Confirm:$false
            Write-Host "Removed scheduled task: $name"
        } else {
            Write-Host "Not present: $name"
        }
    }
    Write-Host ""
    Write-Host "The tunnel service, if any, was left running. Remove it with its own tool:"
    Write-Host "    cloudflared service uninstall"
    Write-Host "    ngrok service uninstall"
    exit 0
}

# --- preflight -------------------------------------------------------------

Write-Host "TrainBud always-on installer"
Write-Host "Repository: $RepoRoot"
Write-Host ""

$distEntry = Join-Path $RepoRoot "dist\index.js"
if (-not (Test-Path $distEntry)) {
    Write-Host "dist/index.js is missing. Build first:" -ForegroundColor Red
    Write-Host "    npm install; npm run build"
    exit 1
}

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Host "node is not on PATH." -ForegroundColor Red
    exit 1
}

$port = Get-TrainBudPort -Root $RepoRoot
Write-Host "Server port: $port"

# S4U registration needs elevation -- it grants a batch-logon right, and the
# scheduler refuses it from a limited token with a bare "Access is denied" that
# says nothing about which part was denied. Check it here, where the message can
# explain itself, rather than letting Register-ScheduledTask fail opaquely.
if (-not (Test-Elevated)) {
    Write-Host ""
    Write-Host "This needs an elevated prompt." -ForegroundColor Red
    Write-Host ""
    Write-Host "The server task runs under S4U ("whether user is logged on or not"), which is"
    Write-Host "what keeps it out of your desktop session and therefore off your screen. An"
    Write-Host "Interactive task allocates a console, and on Windows 11 that console is a blank"
    Write-Host "tab in Windows Terminal -- one that closing kills the server."
    Write-Host ""
    Write-Host "Registering an S4U task requires administrator rights. It does NOT require a"
    Write-Host "stored password; this script never asks for one."
    Write-Host ""
    Write-Host "  Start -> type powershell -> right-click -> Run as administrator, then:"
    Write-Host "      cd $RepoRoot"
    if ($Hostname) {
        Write-Host "      .\scripts\install-always-on.ps1 -Hostname $Hostname"
    } else {
        Write-Host "      .\scripts\install-always-on.ps1 -SkipTunnel"
    }
    exit 1
}

if (-not $SkipTunnel -and -not $Hostname) {
    Write-Host ""
    Write-Host "No -Hostname given, and this script will not guess one." -ForegroundColor Red
    Write-Host ""
    Write-Host "A stable hostname is the whole point: a quick tunnel hands out a new"
    Write-Host "random URL on every restart, which means the watch has to be"
    Write-Host "reconfigured every time the machine reboots. That is the problem this"
    Write-Host "script exists to end."
    Write-Host ""
    Write-Host "Set one up first -- docs/ALWAYS-ON.md has both paths:"
    Write-Host "    Cloudflare (needs a domain):  cloudflared tunnel create trainbud"
    Write-Host "    ngrok (free static domain):   https://dashboard.ngrok.com/domains"
    Write-Host ""
    Write-Host "Then re-run:"
    Write-Host "    .\scripts\install-always-on.ps1 -Hostname trainbud.example.com"
    Write-Host ""
    Write-Host "Or register the tasks alone, if the tunnel is already a service:"
    Write-Host "    .\scripts\install-always-on.ps1 -SkipTunnel"
    exit 1
}

# --- the server task -------------------------------------------------------
#
# Triggers at logon. The honest promise is "up whenever you are logged in", not
# "up 24/7" -- the machine this was written for is a laptop that is switched off
# at night, and a script that promises the second while delivering the first is
# worse than one that says so.
#
# The task runs under S4U so it has no desktop and therefore no window; see the
# principal below, which is the part that actually makes it invisible.

$action = New-ScheduledTaskAction `
    -Execute "powershell.exe" `
    -Argument "-NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$(Join-Path $RepoRoot 'scripts\run-server.ps1')`"" `
    -WorkingDirectory $RepoRoot

# At logon still, not at startup: the machine is a laptop that is switched off at
# night, so "up whenever you are logged in" is the honest promise either way.
# S4U changes where the task runs, not when.
$logonTrigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME

$settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -StartWhenAvailable `
    -RestartCount 5 `
    -RestartInterval (New-TimeSpan -Minutes 1) `
    -ExecutionTimeLimit ([TimeSpan]::Zero) `
    -MultipleInstances IgnoreNew

# ExecutionTimeLimit of zero means "no limit". The default is three days, after
# which Task Scheduler kills a perfectly healthy server and the watchdog has to
# notice. A long-running service should not have a deadline.

# S4U, not Interactive. This is the whole reason the server runs invisibly.
#
# An Interactive task runs inside the logged-on desktop session, so any console
# it allocates gets a window -- and on Windows 11, where Windows Terminal is the
# default console host, that window is a TAB in the terminal the user already
# has open. `-WindowStyle Hidden` and CreateNoWindow are both advisory and lose
# to the terminal host: they hid the process's own window while the host still
# showed a blank tab, which somebody then closed, taking the server with it.
#
# S4U ("run whether user is logged on or not") runs in a session with no desktop,
# so there is nothing for a console to attach to and no window can appear at all.
# Unlike the Password logon type it needs NO stored credential, which matters:
# this script will not ask for a Windows password.
#
# The trade is that an S4U task has no network credentials for REMOTE resources.
# TrainBud reads local files and makes outbound HTTPS calls, neither of which
# needs them.
$principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType S4U -RunLevel Limited

if (Get-ScheduledTask -TaskName $ServerTaskName -ErrorAction SilentlyContinue) {
    Unregister-ScheduledTask -TaskName $ServerTaskName -Confirm:$false
}
Register-ScheduledTask `
    -TaskName $ServerTaskName `
    -Description "Runs trainbud serve so the Connect IQ watch widget and remote MCP clients have a server to call." `
    -Action $action `
    -Trigger $logonTrigger `
    -Settings $settings `
    -Principal $principal | Out-Null

Assert-TaskRegistered $ServerTaskName
Write-Host "Registered scheduled task: $ServerTaskName (at logon)"

# --- the watchdog task -----------------------------------------------------

$watchdogAction = New-ScheduledTaskAction `
    -Execute "powershell.exe" `
    -Argument "-NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$(Join-Path $RepoRoot 'scripts\watchdog.ps1')`"" `
    -WorkingDirectory $RepoRoot

# -RepetitionDuration is deliberately omitted, which means "indefinitely".
#
# The obvious spelling, [TimeSpan]::MaxValue, is what the documentation implies
# and Task Scheduler rejects it outright:
#     The task XML contains a value which is incorrectly formatted or out of
#     range. (10,42):Duration:P99999999DT23H59M59S
# A finite duration is not an acceptable substitute -- the watchdog would
# quietly stop watching when it elapsed, which is the exact class of silent
# expiry it exists to catch.
$watchdogTrigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(2) `
    -RepetitionInterval (New-TimeSpan -Minutes $WatchdogMinutes)

$watchdogSettings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -StartWhenAvailable `
    -ExecutionTimeLimit (New-TimeSpan -Minutes 5) `
    -MultipleInstances IgnoreNew

if (Get-ScheduledTask -TaskName $WatchdogTaskName -ErrorAction SilentlyContinue) {
    Unregister-ScheduledTask -TaskName $WatchdogTaskName -Confirm:$false
}
Register-ScheduledTask `
    -TaskName $WatchdogTaskName `
    -Description "Every few minutes, checks that the TrainBud server answers locally and that the tunnel returns TrainBud's JSON rather than its own error page. Restarts whichever half is down." `
    -Action $watchdogAction `
    -Trigger $watchdogTrigger `
    -Settings $watchdogSettings `
    -Principal $principal | Out-Null

Assert-TaskRegistered $WatchdogTaskName
Write-Host "Registered scheduled task: $WatchdogTaskName (every $WatchdogMinutes min)"

# --- the tunnel ------------------------------------------------------------

if (-not $SkipTunnel) {
    # Accept either a bare hostname or a full URL. The watch only ever speaks
    # HTTPS, so a plain hostname gets that scheme rather than an error.
    if ($Hostname -match '^https?://') {
        $publicUrl = $Hostname.TrimEnd('/')
    } else {
        $publicUrl = "https://$($Hostname.TrimEnd('/'))"
    }

    $setupPath = Write-TrainBudPublicUrl -Url $publicUrl -Root $RepoRoot
    Write-Host "Public URL recorded: $publicUrl"
    Write-Host "  ($setupPath)"

    $cloudflared = Get-Command cloudflared -ErrorAction SilentlyContinue
    $tunnelService = $null
    foreach ($name in @("Cloudflared", "cloudflared", "ngrok")) {
        $found = Get-Service -Name $name -ErrorAction SilentlyContinue
        if ($found) { $tunnelService = $found; break }
    }

    if ($tunnelService) {
        Write-Host "Tunnel service already installed: $($tunnelService.Name) [$($tunnelService.Status)]"
        if ($tunnelService.Status -ne "Running") {
            if (Test-Elevated) {
                Start-Service -Name $tunnelService.Name
                Write-Host "Started $($tunnelService.Name)"
            } else {
                Write-Host "Start it from an elevated prompt: Start-Service $($tunnelService.Name)" -ForegroundColor Yellow
            }
        }
    } elseif ($cloudflared) {
        Write-Host ""
        Write-Host "cloudflared is installed but not running as a service." -ForegroundColor Yellow
        Write-Host "Install it from an ELEVATED prompt, with the token from your Cloudflare dashboard:"
        Write-Host "    cloudflared service install <YOUR_TUNNEL_TOKEN>"
        Write-Host ""
        Write-Host "Full walkthrough, including creating the tunnel and the DNS record:"
        Write-Host "    docs/ALWAYS-ON.md"
    } else {
        Write-Host ""
        Write-Host "No tunnel found. Install one -- docs/ALWAYS-ON.md has both paths:" -ForegroundColor Yellow
        Write-Host "    winget install --id Cloudflare.cloudflared"
        Write-Host "    winget install --id ngrok.ngrok"
    }
}

# --- start it --------------------------------------------------------------

Write-Host ""
Write-Host "Starting the server now..."

# Re-running the installer unregisters the old task, which ORPHANS whatever it
# had running rather than stopping it -- and that orphan still holds port 3847.
# The new instance then fails to bind, exits, and the task drops back to Ready
# while an untracked process serves traffic. Everything looks healthy and
# nothing is under the scheduler's control any more. Clear the port first.
$listener = netstat -ano | Select-String ":$port\s+.*LISTENING\s+(\d+)\s*$"
foreach ($match in $listener) {
    $stale = [int]$match.Matches[0].Groups[1].Value
    Write-Host "  stopping the process already on port $port (PID $stale)"
    Stop-Process -Id $stale -Force -ErrorAction SilentlyContinue
}
Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -like "*run-server.ps1*" } |
    ForEach-Object {
        Write-Host "  stopping an orphaned run-server wrapper (PID $($_.ProcessId))"
        Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
    }
Start-Sleep -Seconds 2

Start-ScheduledTask -TaskName $ServerTaskName
Start-Sleep -Seconds 12

if (Test-TrainBudLocalHealth -Port $port) {
    Write-Host "Local health: OK" -ForegroundColor Green
} else {
    Write-Host "Local health: NOT ANSWERING" -ForegroundColor Red
    Write-Host "  Look at .trainbud\logs\server.err.log"
}

Write-Host ""
Write-Host "Next:"
Write-Host "  1. .\scripts\watchdog.ps1 -WhatIfOnly     what both halves look like right now"
Write-Host "  2. trainbud doctor                        what the WATCH would see"
Write-Host "  3. Reboot once and run doctor again       the only proof that survives a restart"
