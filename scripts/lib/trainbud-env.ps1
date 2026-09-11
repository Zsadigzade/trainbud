# Shared helpers for the always-on scripts.
#
# Dot-source this, do not run it:
#     . (Join-Path $PSScriptRoot "lib\trainbud-env.ps1")
#
# Everything here reads the same three sources the server itself reads, in the
# same order, so a script and the server can never disagree about which port or
# which public URL is live. The server's own precedence is in src/config.ts:
# the environment wins, then .trainbud/watch-setup.json.

Set-StrictMode -Version Latest

function Get-TrainBudRoot {
    <#
        .SYNOPSIS
        The repository root, derived from this file's own location.
    #>
    return (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
}

function Read-TrainBudDotEnv {
    <#
        .SYNOPSIS
        Parses .env into a hashtable. Missing file is not an error.

        .DESCRIPTION
        Deliberately not a full dotenv implementation: it handles `KEY=value`,
        skips blanks and `#` comments, and strips one layer of matching quotes.
        Anything fancier belongs in the server, which already has dotenv.
    #>
    param([string]$Root = (Get-TrainBudRoot))

    $values = @{}
    $envPath = Join-Path $Root ".env"
    if (-not (Test-Path $envPath)) { return $values }

    foreach ($line in (Get-Content -LiteralPath $envPath)) {
        $trimmed = $line.Trim()
        if ($trimmed -eq "" -or $trimmed.StartsWith("#")) { continue }
        $split = $trimmed.IndexOf("=")
        if ($split -lt 1) { continue }
        $key = $trimmed.Substring(0, $split).Trim()
        $value = $trimmed.Substring($split + 1).Trim()
        if ($value.Length -ge 2) {
            if (($value.StartsWith('"') -and $value.EndsWith('"')) -or
                ($value.StartsWith("'") -and $value.EndsWith("'"))) {
                $value = $value.Substring(1, $value.Length - 2)
            }
        }
        $values[$key] = $value
    }
    return $values
}

function Get-TrainBudPort {
    <#
        .SYNOPSIS
        The port the server listens on: TRAINBUD_PORT, else .env, else 3847.
    #>
    param([string]$Root = (Get-TrainBudRoot))

    if ($env:TRAINBUD_PORT) { return [int]$env:TRAINBUD_PORT }

    $dotEnv = Read-TrainBudDotEnv -Root $Root
    # GARMIN_MCP_PORT is the pre-0.3.0 spelling. The server still honours it, so
    # a script that ignored it would probe a port nothing is listening on.
    foreach ($name in @("TRAINBUD_PORT", "GARMIN_MCP_PORT")) {
        if ($dotEnv.ContainsKey($name) -and $dotEnv[$name]) { return [int]$dotEnv[$name] }
    }
    return 3847
}

function Get-TrainBudPublicUrl {
    <#
        .SYNOPSIS
        The address the watch would call, resolved exactly as the server does.

        .DESCRIPTION
        Order is TRAINBUD_PUBLIC_URL, then .env, then .trainbud/watch-setup.json
        -- matching appConfig.publicUrl in src/config.ts. Returns "" when there
        is none, which is a real state: a server with no public URL is one the
        watch cannot reach, and the callers say so rather than guessing one.
    #>
    param([string]$Root = (Get-TrainBudRoot))

    if ($env:TRAINBUD_PUBLIC_URL) { return $env:TRAINBUD_PUBLIC_URL.TrimEnd("/") }

    $dotEnv = Read-TrainBudDotEnv -Root $Root
    foreach ($name in @("TRAINBUD_PUBLIC_URL", "GARMIN_PUBLIC_URL")) {
        if ($dotEnv.ContainsKey($name) -and $dotEnv[$name]) { return $dotEnv[$name].TrimEnd("/") }
    }

    $setupPath = Join-Path $Root ".trainbud\watch-setup.json"
    if (Test-Path $setupPath) {
        try {
            $setup = Get-Content -LiteralPath $setupPath -Raw | ConvertFrom-Json
            if ($setup.serverUrl) { return ([string]$setup.serverUrl).TrimEnd("/") }
        } catch {
            # Unreadable is not the same as absent, and the caller is told which.
            Write-Warning "watch-setup.json exists but could not be parsed: $($_.Exception.Message)"
        }
    }
    return ""
}

function Write-TrainBudPublicUrl {
    <#
        .SYNOPSIS
        Records the public URL where the server looks for it.

        .DESCRIPTION
        UTF-8 with no BOM, deliberately. Set-Content -Encoding utf8 writes a BOM
        on Windows PowerShell 5.1 and JSON.parse treats a leading U+FEFF as a
        syntax error -- this file held the correct URL for weeks while the
        server reported "No public URL is configured".
    #>
    param(
        [Parameter(Mandatory)][string]$Url,
        [string]$Root = (Get-TrainBudRoot)
    )

    $setupPath = Join-Path $Root ".trainbud\watch-setup.json"
    New-Item -ItemType Directory -Force -Path (Split-Path $setupPath) | Out-Null
    $json = @{
        serverUrl = $Url.TrimEnd("/")
        updatedAt = (Get-Date).ToUniversalTime().ToString("o")
    } | ConvertTo-Json
    [System.IO.File]::WriteAllText($setupPath, $json, (New-Object System.Text.UTF8Encoding $false))
    return $setupPath
}

function Test-TrainBudLocalHealth {
    <#
        .SYNOPSIS
        True when this machine's own server answers /health.
    #>
    param([int]$Port = (Get-TrainBudPort), [int]$TimeoutSec = 5)

    try {
        $response = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/health" -TimeoutSec $TimeoutSec
        return [bool]$response.status
    } catch {
        return $false
    }
}

function Test-TrainBudPublicHealth {
    <#
        .SYNOPSIS
        What the watch would get from outside: ok, not_server, unreachable, or
        not_configured.

        .DESCRIPTION
        A tunnel that answers is not a server that answers. ngrok's and
        Cloudflare's own error pages return 200 with HTML, so a probe that only
        checks the status code grades a dead product as healthy. This one sends
        the headers Connect IQ sends -- the watch is stuck on `Mozilla/5.0` and
        cannot override it -- and insists on JSON with a status field, the same
        taxonomy src/selfTest.ts uses.
    #>
    param([string]$Url = (Get-TrainBudPublicUrl), [int]$TimeoutSec = 10)

    if (-not $Url) { return "not_configured" }

    try {
        $response = Invoke-WebRequest -Uri "$Url/health" -TimeoutSec $TimeoutSec -UseBasicParsing -Headers @{
            "User-Agent"                 = "Mozilla/5.0"
            "ngrok-skip-browser-warning" = "1"
            "Accept"                     = "application/json"
        }
    } catch {
        return "unreachable"
    }

    if ($response.StatusCode -ne 200) { return "not_server" }

    try {
        $body = $response.Content | ConvertFrom-Json
    } catch {
        return "not_server"
    }

    if ($body.status) { return "ok" }
    return "not_server"
}
