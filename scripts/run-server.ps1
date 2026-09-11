# The Scheduled Task's action. Runs `trainbud serve` for as long as the task
# lives, with output on disk.
#
# Not meant to be run by hand -- use `.\scripts\install-always-on.ps1`, which
# registers this as a task. Running it directly works and is a fine way to see
# what the task sees; Ctrl+C stops it.
#
# TWO THINGS HERE ARE LOAD-BEARING AND BOTH LOOK LIKE STYLE CHOICES.
#
# 1. THE SERVER IS A DIRECT CHILD, NOT A Start-Process.
#
#    Start-Process detaches. The first version of this file used it, and the
#    result was that `Stop-ScheduledTask` killed this wrapper while node carried
#    on holding port 3847 -- so the restart bound nothing, the task dropped back
#    to Ready, and an untracked process from an old build kept serving. The
#    symptom was a rebuilt server whose new routes all returned 404 while
#    /health answered perfectly. Task Scheduler ends the task's whole process
#    tree, so the server has to be INSIDE that tree.
#
#    cmd.exe is the launcher only because it gives real append-mode redirection;
#    PowerShell 5.1 wraps a native command's stderr in ErrorRecords and sets $?
#    to false even on a clean exit.
#
# 2. THE PORT IS FREED FIRST.
#
#    Belt and braces for the case above, and for a machine that was hard powered
#    off with a stale listener. A server that cannot bind exits immediately and
#    the task looks like it ran.

param(
    # Trim a log bigger than this on start, rather than growing forever.
    [int]$MaxLogBytes = 5MB
)

$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "lib\trainbud-env.ps1")

$RepoRoot = Get-TrainBudRoot
Set-Location $RepoRoot

$distEntry = Join-Path $RepoRoot "dist\index.js"
if (-not (Test-Path $distEntry)) {
    throw "dist/index.js is missing. Run 'npm install; npm run build' in $RepoRoot first."
}

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    throw "node is not on PATH for this task's account. Install Node 22.12+, or run the task as a user that has it."
}

$port = Get-TrainBudPort -Root $RepoRoot

# FREE THE PORT BEFORE TOUCHING THE LOG, and in that order for a reason.
#
# The previous instance holds server.log open for append. Writing to it first
# throws a sharing violation, and with $ErrorActionPreference = "Stop" that
# ends this script before it ever reaches the part that would have cleared the
# old process -- so the task exits 1, the old build keeps serving, and the
# restart appears to have silently done nothing. That is exactly how a rebuilt
# server answered /health perfectly while every new route returned 404.
$listeners = netstat -ano | Select-String ":$port\s+.*LISTENING\s+(\d+)\s*$"
foreach ($match in $listeners) {
    $stale = [int]$match.Matches[0].Groups[1].Value
    if ($stale -eq $PID) { continue }
    Write-Host "Stopping stale listener on port $port (PID $stale)"
    Stop-Process -Id $stale -Force -ErrorAction SilentlyContinue
}
if ($listeners) { Start-Sleep -Seconds 2 }

$logDir = Join-Path $RepoRoot ".trainbud\logs"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$log = Join-Path $logDir "server.log"

# Logging must never be able to stop the server from starting. Everything from
# here to the launch is best effort.
try {
    if ((Test-Path $log) -and (Get-Item -LiteralPath $log).Length -gt $MaxLogBytes) {
        Move-Item -LiteralPath $log -Destination "$log.1" -Force
    }
    Add-Content -LiteralPath $log -Value "$(Get-Date -Format o)  === trainbud serve starting ==="
} catch {
    Write-Host "Could not write to $log ($($_.Exception.Message)); starting anyway."
}

# Blocks here for the lifetime of the server, which is the lifetime Task
# Scheduler watches and restarts.
& cmd.exe /c "node `"$distEntry`" serve >> `"$log`" 2>&1"
exit $LASTEXITCODE
