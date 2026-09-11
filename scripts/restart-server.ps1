# Restart the TrainBud server and prove it came back.
#
#     .\scripts\restart-server.ps1
#
# Use this after `npm run build`, after rotating a key, or any time the running
# process needs to become the code on disk.
#
# WHY THIS IS NOT JUST Stop-ScheduledTask; Start-ScheduledTask
#
# Three things go wrong with the obvious two-liner, and all three are silent:
#
#   THERE IS NO Restart-ScheduledTask. The cmdlet does not exist. A script that
#   names it fails at the prompt.
#
#   STOPPING THE TASK DOES NOT ALWAYS STOP THE SERVER. Task Scheduler ends the
#   process it launched; a node process nested under a shell can outlive it and
#   keep holding the port. The task then reads Ready while an old build is still
#   answering every request.
#
#   THE VERIFICATION IS THE POINT. `Start-ScheduledTask` returns success for a
#   task whose action exits one millisecond later. On 2026-09-11 that produced a
#   rebuilt server where /health answered perfectly and every newly added route
#   returned 404, because the process answering was the previous build. Nothing
#   here reports success without a live /health from a process that started
#   after this script did.

[CmdletBinding()]
param(
    [string]$TaskName = "TrainBud Server",
    [int]$TimeoutSeconds = 45
)

$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "lib\trainbud-env.ps1")

$RepoRoot = Get-TrainBudRoot
$port = Get-TrainBudPort -Root $RepoRoot

function Get-PortOwnerPid([int]$Port) {
    <#
        The PID currently listening, or $null.

        This is the identity check the whole script turns on, and it is done by
        PORT OWNERSHIP rather than by process start time on purpose. The obvious
        version compared Get-Process StartTime against the script's own start --
        and StartTime on a session-0 process is UNREADABLE from an unelevated
        caller, so once the task moved to S4U the comparison silently matched
        nothing and every successful restart was reported as a failure. netstat
        needs no privilege and answers the question actually being asked: is a
        DIFFERENT process serving now?
    #>
    $match = netstat -ano | Select-String ":$Port\s+.*LISTENING\s+(\d+)\s*$"
    if (-not $match) { return $null }
    return [int]$match.Matches[0].Groups[1].Value
}

$previousPid = Get-PortOwnerPid -Port $port
$startedAt = Get-Date

$task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if (-not $task) {
    Write-Host "No scheduled task '$TaskName'. Run .\scripts\install-always-on.ps1 first." -ForegroundColor Red
    exit 1
}

Write-Host "Stopping $TaskName..."
Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue

# Wait for the task itself to let go, then deal with anything it left behind.
$deadline = (Get-Date).AddSeconds(15)
while ((Get-Date) -lt $deadline -and (Get-ScheduledTask -TaskName $TaskName).State -eq "Running") {
    Start-Sleep -Milliseconds 500
}

$stale = Get-PortOwnerPid -Port $port
if ($stale) {
    # Best effort, and it OFTEN FAILS now -- by design. Under S4U the server runs
    # in session 0, and an unelevated caller cannot Stop-Process it ("Access is
    # denied"). That is a feature: the thing nobody can close by accident is also
    # the thing this script cannot casually kill.
    #
    # It does not matter, because run-server.ps1 frees the port from INSIDE the
    # task, where it has rights over its own session. Measured: a stale session-0
    # listener was replaced cleanly on the next start.
    Write-Host "  PID $stale still holds port $port; the incoming instance will clear it"
    Stop-Process -Id $stale -Force -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 2
}

Write-Host "Starting $TaskName..."
Start-ScheduledTask -TaskName $TaskName

$deadline = (Get-Date).AddSeconds($TimeoutSeconds)
while ((Get-Date) -lt $deadline) {
    Start-Sleep -Seconds 2
    if (Test-TrainBudLocalHealth -Port $port) {
        # A live /health is necessary and not sufficient: it would be equally
        # true if the old process had never died. What proves a restart is that
        # a DIFFERENT process owns the port now.
        $currentPid = Get-PortOwnerPid -Port $port

        if ($currentPid -and $currentPid -ne $previousPid) {
            $seconds = [math]::Round(((Get-Date) - $startedAt).TotalSeconds, 1)
            Write-Host "Running the current build. /health OK after $seconds s (PID $currentPid, was $previousPid)." -ForegroundColor Green
            exit 0
        }

        Write-Host "  /health answers, but PID $currentPid still owns the port. Still waiting..."
    }
}

$result = (Get-ScheduledTask -TaskName $TaskName | Get-ScheduledTaskInfo).LastTaskResult
$hex = "{0:X}" -f $result
$logPath = Join-Path $RepoRoot ".trainbud\logs\server.log"
Write-Host "Did not come back within $TimeoutSeconds s. Last task result: $result (0x$hex)." -ForegroundColor Red
Write-Host "  A result of 1 usually means the action exited immediately. Read the end of:"
Write-Host "  $logPath"
exit 1
