# FoodBridge local startup script.
# Starts PostgreSQL (portable build, only if down), applies migrations, then
# launches the Uvicorn backend, Vite frontend and the email-outbox worker as
# tracked background processes. Logs land in <repo>\logs\. PIDs land in
# <repo>\logs\foodbridge.pids -- stop_foodbridge.ps1 stops ONLY those PIDs.

# NOTE: PS 5.1 elevates ANY native-command stderr output to a terminating
# error when $ErrorActionPreference is "Stop". We run with "Continue" and
# check $LASTEXITCODE explicitly instead, with stderr captured to log files.
$ErrorActionPreference = "Continue"

$Root = Split-Path -Parent $PSScriptRoot
$Backend = Join-Path $Root "backend"
$Frontend = Join-Path $Root "frontend"
$Logs = Join-Path $Root "logs"
$PidFile = Join-Path $Logs "foodbridge.pids"
$Python = Join-Path $Backend ".venv\Scripts\python.exe"
$PgBin = "C:\Users\ELCOT\tools\pgsql\bin"
$PgData = "C:\Users\ELCOT\tools\pgdata"
$NodeDir = "C:\Users\ELCOT\tools\nodejs"   # portable Node used by this project

function Write-Step($message) { Write-Host "[FoodBridge] $message" -ForegroundColor Green }
function Write-WarnStep($message) { Write-Host "[FoodBridge] $message" -ForegroundColor Yellow }
function Test-Port($port) {
    $conn = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
    return $null -ne $conn
}
function Add-TrackedPid($name, $process) {
    "$name=$($process.Id)" | Add-Content -Path $PidFile
}

New-Item -ItemType Directory -Force -Path $Logs | Out-Null
if (Test-Path $PidFile) { Remove-Item $PidFile -Force }
# Portable Node + pgsql tools must be reachable for npm and pg_isready.
if (Test-Path $NodeDir) { $env:Path = "$NodeDir;$env:Path" }
if (Test-Path $PgBin) { $env:Path = "$PgBin;$env:Path" }

# --- 0. Kill stale FoodBridge instances ---------------------------------------
# Zombie uvicorns/outbox workers from previous sessions hold the ports and run
# outdated code. Anything matching this project's identifiers is ours to stop.
$staleKiller = Join-Path $PSScriptRoot "kill_stale_foodbridge.ps1"
if (Test-Path $staleKiller) {
    & $staleKiller
}

# --- 1. PostgreSQL -----------------------------------------------------------
# NOTE: use pg_isready (not a raw TCP port check) -- a half-started postmaster
# can hold the port without accepting connections, which would otherwise hang
# a second pg_ctl start.
Write-Step "Checking PostgreSQL on port 5432..."
& "$PgBin\pg_isready.exe" -h 127.0.0.1 -p 5432 2>$null | Out-Null
if ($LASTEXITCODE -eq 0) {
    Write-Step "PostgreSQL already running."
} elseif (Test-Path "$PgBin\pg_ctl.exe") {
    Write-WarnStep "PostgreSQL down -- starting portable cluster at $PgData"
    & "$PgBin\pg_ctl.exe" -D $PgData -l "$PgData\server.log" -o "-p 5432" -w start | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "PostgreSQL failed to start. See $PgData\server.log" }
    $pgListener = Get-NetTCPConnection -LocalPort 5432 -State Listen -ErrorAction SilentlyContinue |
        Select-Object -First 1
    if ($pgListener) { Add-TrackedPid "postgres" @{ Id = $pgListener.OwningProcess } }
    Write-Step "PostgreSQL started."
} else {
    throw "PostgreSQL is not running and the portable binaries were not found at $PgBin"
}
& "$PgBin\pg_isready.exe" -h 127.0.0.1 -p 5432 2>$null | Out-Null
if ($LASTEXITCODE -ne 0) { throw "PostgreSQL is not accepting connections." }
Write-Step "PostgreSQL ready."

# --- 2. Migrations ------------------------------------------------------------
Write-Step "Verifying migrations..."
Push-Location $Backend
try {
    & $Python manage.py migrate --check --no-input 2>> (Join-Path $Logs "migrate.err.log")
    if ($LASTEXITCODE -ne 0) {
        Write-WarnStep "Pending migrations -- applying..."
        & $Python manage.py migrate --no-input 2>> (Join-Path $Logs "migrate.err.log")
        if ($LASTEXITCODE -ne 0) { throw "Migration failed. See logs\migrate.err.log" }
        Write-Step "Migrations applied."
    } else {
        Write-Step "Migrations up to date."
    }
} finally { Pop-Location }

# --- 3. Backend (Uvicorn/ASGI) ------------------------------------------------
if (Test-Port 8000) {
    Write-WarnStep "Port 8000 already in use -- assuming the backend is already running."
} else {
    Write-Step "Starting backend (Uvicorn, port 8000)..."
    $backendProc = Start-Process -FilePath $Python `
        -ArgumentList "-u", "-m", "uvicorn", "config.asgi:application", "--host", "0.0.0.0", "--port", "8000" `
        -WorkingDirectory $Backend `
        -RedirectStandardOutput (Join-Path $Logs "backend.out.log") `
        -RedirectStandardError (Join-Path $Logs "backend.err.log") `
        -WindowStyle Hidden -PassThru
    Add-TrackedPid "backend" $backendProc
}

# --- 4. Frontend (Vite) -------------------------------------------------------
# Locate npm.cmd: prefer the portable Node used to build this project, then PATH.
$Npm = $null
foreach ($candidate in @("C:\Users\ELCOT\tools\nodejs\npm.cmd", (Join-Path $Root "frontend\nodejs\npm.cmd"))) {
    if (Test-Path $candidate) { $Npm = $candidate; break }
}
if (-not $Npm) {
    $cmd = Get-Command npm.cmd -ErrorAction SilentlyContinue
    if ($cmd) { $Npm = $cmd.Source }
}
if (-not $Npm) { throw "npm.cmd not found. Install Node or add it to PATH." }

if (Test-Port 5173) {
    Write-WarnStep "Port 5173 already in use -- assuming the frontend is already running."
} else {
    Write-Step "Starting frontend (Vite, port 5173)..."
    try {
        $frontendProc = Start-Process -FilePath $Npm `
            -ArgumentList "run", "dev" `
            -WorkingDirectory $Frontend `
            -RedirectStandardOutput (Join-Path $Logs "frontend.out.log") `
            -RedirectStandardError (Join-Path $Logs "frontend.err.log") `
            -WindowStyle Hidden -PassThru
        Add-TrackedPid "frontend" $frontendProc
    } catch {
        throw "Failed to start the Vite frontend: $($_.Exception.Message)"
    }
}

# --- 5. Email outbox worker ---------------------------------------------------
Write-Step "Starting email outbox worker (every 30s)..."
$outboxProc = Start-Process -FilePath $Python `
    -ArgumentList "-u", "manage.py", "process_email_outbox", "--loop", "--interval", "30" `
    -WorkingDirectory $Backend `
    -RedirectStandardOutput (Join-Path $Logs "outbox.out.log") `
    -RedirectStandardError (Join-Path $Logs "outbox.err.log") `
    -WindowStyle Hidden -PassThru
Add-TrackedPid "outbox" $outboxProc

# --- 6. Health verification ----------------------------------------------------
Write-Step "Verifying backend health..."
$backendOk = $false
$cityName = ""
for ($i = 0; $i -lt 30; $i++) {
    try {
        $health = Invoke-RestMethod -Uri "http://127.0.0.1:8000/api/v1/config/" -TimeoutSec 2
        if ($health.city_name) { $backendOk = $true; $cityName = $health.city_name; break }
    } catch { Start-Sleep -Seconds 1 }
}
if (-not $backendOk) { throw "Backend did not become healthy. Check $Logs\backend.err.log" }
Write-Step "Backend healthy -- serving city: $cityName"

$frontendOk = $false
for ($i = 0; $i -lt 30; $i++) {
    try {
        Invoke-WebRequest -Uri "http://localhost:5173/" -TimeoutSec 2 -UseBasicParsing | Out-Null
        $frontendOk = $true; break
    } catch { Start-Sleep -Seconds 1 }
}
if (-not $frontendOk) { throw "Frontend did not become healthy. Check $Logs\frontend.err.log" }

Write-Host ""
Write-Host "=============================================================" -ForegroundColor Green
Write-Host " FoodBridge is running:" -ForegroundColor Green
Write-Host "   Frontend : http://localhost:5173"  -ForegroundColor White
Write-Host "   Backend  : http://127.0.0.1:8000/api/v1/" -ForegroundColor White
Write-Host "   API docs : http://127.0.0.1:8000/api/docs/" -ForegroundColor White
Write-Host "   Logs     : $Logs" -ForegroundColor White
Write-Host "   Stop     : scripts\stop_foodbridge.ps1" -ForegroundColor White
Write-Host "=============================================================" -ForegroundColor Green
