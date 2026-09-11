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

# Launch with NO CONSOLE WINDOW, as a direct child.
#
# The call operator (`& cmd.exe /c ...`) gave the server a visible, empty
# console window. `-WindowStyle Hidden` on the task's own powershell.exe does
# not reach it: cmd.exe allocates its own console, and a scheduled task running
# as a logged-on interactive user shows it. Someone then closes what looks like
# a stray blank terminal and takes the server down with it -- which is precisely
# what happened on 2026-09-11.
#
# CreateNoWindow with UseShellExecute=$false is what actually suppresses it
# (CREATE_NO_WINDOW at the Win32 layer). Two details make this the right shape:
#
#   STILL A DIRECT CHILD. Not Start-Process, which detaches and leaves an orphan
#   holding port 3847 after the task is stopped. This process stays inside the
#   task's tree, so Task Scheduler ending the task ends the server.
#
#   CMD DOES ITS OWN FILE REDIRECTION, and this script redirects NOTHING. If the
#   output were piped back here it would have to be drained continuously, and a
#   pino-chatty server would deadlock the moment the pipe buffer filled. Writing
#   straight to a file has no buffer to fill.
$startInfo = New-Object System.Diagnostics.ProcessStartInfo
$startInfo.FileName = "$env:ComSpec"
$startInfo.Arguments = "/c node `"$distEntry`" serve >> `"$log`" 2>&1"
$startInfo.WorkingDirectory = $RepoRoot
$startInfo.UseShellExecute = $false
$startInfo.CreateNoWindow = $true

$process = [System.Diagnostics.Process]::Start($startInfo)

# Blocks here for the lifetime of the server, which is the lifetime Task
# Scheduler watches and restarts.
$process.WaitForExit()
exit $process.ExitCode
