# Checks both halves of the stack and restarts whichever one is dead.
#
# Registered by install-always-on.ps1 to run every 5 minutes. Safe to run by
# hand at any time; it does nothing when everything is healthy.
#
# This exists because of a specific failure that took two days to diagnose and
# then happened again: the server dies, the tunnel stays up, and the tunnel
# answers its OWN error page with a 200. From the outside the domain looks
# alive. The watch gets HTML where it expected JSON and reports "Error HTTP
# -400"; anyone opening the link in a browser sees a page and concludes the
# product is fine. Nothing on this machine reports a fault, because nothing on
# this machine HAS one.
#
# So the two halves are graded separately and by different evidence:
#   local  -- 127.0.0.1/health answers with JSON  -> the server process is alive
#   public -- the tunnel hostname returns TrainBud's JSON, not anybody's HTML
#
# A green local and a red public is the tunnel's fault, and only the tunnel is
# restarted. Restarting the server there would take a working half offline to
# fix a broken one.

param(
    # Report and exit without touching anything. Use this first.
    [switch]$WhatIfOnly,
    # Skip the outside-in probe. For a machine that is deliberately local-only.
    [switch]$SkipPublic
)

$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "lib\trainbud-env.ps1")

$RepoRoot = Get-TrainBudRoot
$Port = Get-TrainBudPort -Root $RepoRoot
$PublicUrl = Get-TrainBudPublicUrl -Root $RepoRoot

$ServerTaskName = "TrainBud Server"
$TunnelServiceNames = @("Cloudflared", "cloudflared", "ngrok")

$logDir = Join-Path $RepoRoot ".trainbud\logs"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$watchdogLog = Join-Path $logDir "watchdog.log"

function Write-Line([string]$Message) {
    $stamp = (Get-Date).ToUniversalTime().ToString("yyyy-MM-dd HH:mm:ssZ")
    $line = "$stamp  $Message"
    Write-Host $line
    Add-Content -LiteralPath $watchdogLog -Value $line
}

function Get-TunnelService {
    <#
        The installed tunnel service, whichever provider it came from. Returns
        $null when the tunnel is not running as a service -- which is a real
        configuration, not an error: somebody may be running cloudflared in a
        terminal on purpose, and this script will not kill it.
    #>
    foreach ($name in $TunnelServiceNames) {
        $service = Get-Service -Name $name -ErrorAction SilentlyContinue
        if ($service) { return $service }
    }
    return $null
}

# --- the server half -------------------------------------------------------

$localOk = Test-TrainBudLocalHealth -Port $Port
if ($localOk) {
    Write-Line "local  OK    127.0.0.1:$Port/health answered"
} else {
    Write-Line "local  DEAD  127.0.0.1:$Port/health did not answer"
    if ($WhatIfOnly) {
        Write-Line "local  SKIP  -WhatIfOnly, would have restarted task '$ServerTaskName'"
    } else {
        $task = Get-ScheduledTask -TaskName $ServerTaskName -ErrorAction SilentlyContinue
        if (-not $task) {
            Write-Line "local  FAIL  no scheduled task '$ServerTaskName'. Run .\scripts\install-always-on.ps1"
        } else {
            # restart-server.ps1 rather than Stop-ScheduledTask + Start-ScheduledTask.
            # The naive pair fails three ways that all look like success: the task
            # reports Ready while an orphaned node still holds the port, Start is a
            # no-op against a task Scheduler still believes is running, and neither
            # call checks that anything came back. The helper waits for the port to
            # be free and then for a /health answered by a process newer than
            # itself. A watchdog that cannot tell a restart from a no-op is worse
            # than no watchdog, because it writes "FIX" into the log either way.
            $restart = Join-Path $PSScriptRoot "restart-server.ps1"
            & powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $restart | Out-Null
            $localOk = Test-TrainBudLocalHealth -Port $Port
            Write-Line ("local  {0}  after restart" -f $(if ($localOk) { "FIX  " } else { "DEAD " }))
        }
    }
}

# --- the tunnel half -------------------------------------------------------

if ($SkipPublic) {
    Write-Line "public SKIP  -SkipPublic"
    exit 0
}

$reach = Test-TrainBudPublicHealth -Url $PublicUrl

switch ($reach) {
    "ok" {
        Write-Line "public OK    $PublicUrl/health returned TrainBud JSON"
    }
    "not_configured" {
        Write-Line "public NONE  no public URL set. The watch cannot reach this server. See docs/ALWAYS-ON.md"
    }
    default {
        # not_server means something answered and it was not TrainBud: the
        # tunnel's own interstitial, or a tunnel pointed at the wrong port.
        # unreachable means nothing answered at all. Both are the tunnel's
        # problem when local is green, and neither is when it is not -- a dead
        # server makes the tunnel serve its error page quite correctly.
        Write-Line "public $($reach.ToUpper())  $PublicUrl/health did not return TrainBud JSON"

        if (-not $localOk) {
            Write-Line "public HOLD  local is down too; fixing the server first, not restarting the tunnel"
        } elseif ($WhatIfOnly) {
            Write-Line "public SKIP  -WhatIfOnly, would have restarted the tunnel service"
        } else {
            $service = Get-TunnelService
            if (-not $service) {
                Write-Line "public FAIL  no tunnel service installed. See docs/ALWAYS-ON.md"
            } else {
                Restart-Service -Name $service.Name -Force
                Write-Line "public FIX   restarted service '$($service.Name)'"

                Start-Sleep -Seconds 10
                $reach = Test-TrainBudPublicHealth -Url $PublicUrl
                Write-Line "public $($reach.ToUpper())  after restart"
            }
        }
    }
}

# A non-zero exit is what makes this visible in Task Scheduler's Last Run
# Result column, so a watchdog that keeps failing is legible without opening
# the log.
if (-not $localOk -or ($reach -ne "ok" -and -not $SkipPublic)) { exit 1 }
exit 0
