# FoodBridge stop script -- stops ONLY processes started by start_foodbridge.ps1:
# 1. Every PID recorded in logs\foodbridge.pids (name + pid verified).
# 2. Any process still LISTENING on the app ports (8000/5173) whose name is
#    python/node/npm -- other services on those ports are left untouched.
# PostgreSQL is stopped only if the start script launched it.

$ErrorActionPreference = "SilentlyContinue"

$Root = Split-Path -Parent $PSScriptRoot
$Logs = Join-Path $Root "logs"
$PidFile = Join-Path $Logs "foodbridge.pids"
$PgBin = "C:\Users\ELCOT\tools\pgsql\bin"
$PgData = "C:\Users\ELCOT\tools\pgdata"
$AppPorts = @(8000, 5173)
$AllowedNames = @("python", "node", "npm", "npm.cmd", "cmd")

function Get-ListeningPids($port) {
    return Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue |
        Select-Object -ExpandProperty OwningProcess -Unique
}

$startedPostgres = $false

# --- 1. Tracked PIDs -----------------------------------------------------------
if (Test-Path $PidFile) {
    foreach ($line in Get-Content $PidFile) {
        if ($line -match "^(?<name>\w+)=(?<procId>\d+)$") {
            $name = $Matches["name"]
            $trackedId = [int]$Matches["procId"]
            $proc = Get-Process -Id $trackedId -ErrorAction SilentlyContinue
            if ($null -eq $proc) {
                Write-Host "[FoodBridge] $name (pid $trackedId) already stopped."
                continue
            }
            if ($name -eq "postgres") { $startedPostgres = $true }
            # npm.cmd runs as cmd.exe wrapping node -- verify the name before killing.
            $procName = $proc.ProcessName.ToLower()
            if ($AllowedNames -contains $procName -or $procName -like "node*") {
                Stop-Process -Id $trackedId -Force
                Write-Host "[FoodBridge] Stopped $name (pid $trackedId, $($proc.ProcessName))."
            } else {
                Write-Host "[FoodBridge] SKIPPED $name (pid $trackedId, unexpected process '$($proc.ProcessName)')." -ForegroundColor Yellow
            }
        }
    }
} else {
    Write-Host "[FoodBridge] No PID file found ($PidFile). Will still free the app ports." -ForegroundColor Yellow
}

# --- 2. Anything still listening on the app ports -------------------------------
foreach ($port in $AppPorts) {
    foreach ($listeningId in (Get-ListeningPids $port)) {
        $proc = Get-Process -Id $listeningId -ErrorAction SilentlyContinue
        if ($null -eq $proc) { continue }
        $procName = $proc.ProcessName.ToLower()
        if ($AllowedNames -contains $procName -or $procName -like "node*") {
            Stop-Process -Id $listeningId -Force
            Write-Host "[FoodBridge] Freed port $port (stopped pid $listeningId, $($proc.ProcessName))."
        } else {
            Write-Host "[FoodBridge] Port $port held by '$($proc.ProcessName)' (pid $listeningId) -- left untouched." -ForegroundColor Yellow
        }
    }
}

# --- 3. PostgreSQL (only if we started it) ---------------------------------------
if ($startedPostgres) {
    Write-Host "[FoodBridge] Stopping PostgreSQL (started by start script)..."
    & "$PgBin\pg_ctl.exe" -D $PgData stop -m fast | Out-Null
    Write-Host "[FoodBridge] PostgreSQL stopped."
}

Remove-Item $PidFile -ErrorAction SilentlyContinue
Write-Host "[FoodBridge] Done. Logs remain in $Logs" -ForegroundColor Green
