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

function Get-TunnelReadyConnections {
    <#
        How many connections cloudflared holds open to Cloudflare's edge, read
        from its own metrics endpoint, or $null when there is no such endpoint
        (ngrok, or cloudflared started with metrics off).

        cloudflared binds its metrics server to the first free port from 20241
        to 20245, and /ready answers {"readyConnections": N}. It is the tunnel's
        own account of whether it is connected, and -- unlike the public probe --
        it does not depend on this machine being able to resolve or reach the
        public hostname.
    #>
    foreach ($port in 20241..20245) {
        try {
            $response = Invoke-WebRequest -Uri "http://127.0.0.1:$port/ready" -UseBasicParsing -TimeoutSec 3
            $body = $response.Content | ConvertFrom-Json
            if ($null -ne $body.readyConnections) { return [int]$body.readyConnections }
        } catch {
            # A 503 from /ready means the endpoint exists and the tunnel is not
            # connected: that is an answer, zero, not an absence.
            #
            # StrictMode is on (trainbud-env.ps1), so `$_.Exception.Response` on
            # an exception type that has no such property does not return null --
            # it throws PropertyNotFoundException, out of the catch block, out of
            # this function, and into $ErrorActionPreference = "Stop", which ends
            # the watchdog before it ever checks the tunnel. Reachable whenever
            # something other than cloudflared holds one of these ports and
            # answers 200 with a body ConvertFrom-Json rejects: the parse throws
            # a RuntimeException, which carries no Response. Same defensive shape
            # as Get-LocalDnsAnswer below.
            $exception = $_.Exception
            if ($exception.PSObject.Properties.Name -contains "Response" -and $exception.Response) {
                if ([int]$exception.Response.StatusCode -eq 503) { return 0 }
            }
        }
    }
    return $null
}

function Get-LocalDnsAnswer([string]$Url) {
    <# What this machine's resolver says the public hostname is, for the log. #>
    try {
        $hostName = ([Uri]$Url).Host
        # No -Type: a sinkholing resolver answers with a CNAME to its sinkhole,
        # and the name is the useful half of that evidence. But the reply also
        # carries the authority section -- NS and SOA records for the zone --
        # and against api.trainbud.site that is eighteen entries of Cloudflare
        # nameservers wrapped around the four that answer the question. Keep the
        # address and alias records only; the rest is the zone, not the answer.
        $records = @(Resolve-DnsName -Name $hostName -ErrorAction SilentlyContinue |
            Where-Object { $_.QueryType -in @("A", "AAAA", "CNAME") })

        # Follow the CNAME chain out from the name we asked about, and keep only
        # records on it. Filtering by record TYPE is not enough: the reply's
        # additional section carries A records for the zone's own nameservers,
        # which is how this line first printed sixteen Cloudflare addresses that
        # said nothing about where api.trainbud.site resolves to.
        $chain = @($hostName)
        foreach ($pass in 1..8) {
            $grew = $false
            foreach ($record in $records) {
                $names = $record.PSObject.Properties.Name
                if ($names -contains "NameHost" -and $record.NameHost -and
                    ($chain -contains $record.Name) -and -not ($chain -contains $record.NameHost)) {
                    $chain += $record.NameHost
                    $grew = $true
                }
            }
            if (-not $grew) { break }
        }

        $answers = $records |
            Where-Object { $chain -contains $_.Name } |
            # StrictMode is on (trainbud-env.ps1): a CNAME record has no IPAddress
            # property at all, and reading one throws rather than returning null.
            ForEach-Object {
                $names = $_.PSObject.Properties.Name
                if ($names -contains "IPAddress" -and $_.IPAddress) { "$($_.Name) $($_.IPAddress)" }
                elseif ($names -contains "NameHost" -and $_.NameHost) { "$($_.Name) -> $($_.NameHost)" }
            } |
            Where-Object { $_ }
        if (-not $answers) { return "no answer" }
        # A sinkhole is one or two records; a healthy CDN name is a handful. Past
        # six the line stops being evidence and starts being a wall of addresses.
        $unique = @($answers | Select-Object -Unique)
        if ($unique.Count -gt 6) {
            return (($unique | Select-Object -First 6) -join ", ") + ", +$($unique.Count - 6) more"
        }
        return $unique -join ", "
    } catch {
        return "no answer"
    }
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

        # Unreachable FROM HERE is not the same claim as unreachable. On
        # 2026-09-14 a corporate VPN came up on this laptop and its resolver
        # answered api.trainbud.site with a Palo Alto sinkhole; the probe failed
        # every five minutes, and this script restarted a perfectly healthy
        # tunnel 243 times in 29 hours -- each restart dropping every watch
        # request for ten seconds. The tunnel's own metrics say whether it is
        # connected to Cloudflare, and they do not go through this machine's DNS.
        #
        # Both failing grades, not just "unreachable". A sinkhole that does not
        # answer grades `unreachable`; a corporate filter that SERVES a block
        # page grades `not_server`, which is the same false diagnosis from a
        # different vendor. Gating this on `unreachable` alone let the second one
        # walk straight back into the restart loop this exists to stop.
        $ready = if ($localOk -and ($reach -eq "unreachable" -or $reach -eq "not_server")) {
            Get-TunnelReadyConnections
        } else {
            $null
        }
        if ($null -ne $ready -and $ready -gt 0) {
            # Which of the two it was matters to whoever reads this line: a
            # sinkhole shows in the DNS answer, a block page does not.
            $how = if ($reach -eq "not_server") {
                "something on this network answered for it, but not with TrainBud's JSON"
            } else {
                "this machine cannot reach it"
            }
            Write-Line ("public UNVERIFIED  {0} (local DNS answers {1}), but the tunnel reports {2} ready connection(s) to Cloudflare. A local network or VPN block, not a dead tunnel. Not restarting." -f $how, (Get-LocalDnsAnswer $PublicUrl), $ready)
            $reach = "unverified"
        } elseif (-not $localOk) {
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
# "unverified" is not a failure of this stack -- the tunnel says it is connected
# and only this machine's network cannot confirm it from the outside.
if (-not $localOk -or ($reach -ne "ok" -and $reach -ne "unverified" -and -not $SkipPublic)) { exit 1 }
exit 0
