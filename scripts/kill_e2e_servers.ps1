# Kills ONLY the Playwright e2e webServer processes (uvicorn on 8010, vite dev on 5175),
# matched by command line. The user's dev servers on 8000/5173 are never touched.
$ErrorActionPreference = "Continue"
Get-CimInstance Win32_Process | Where-Object {
    $_.CommandLine -and ($_.CommandLine -match "--port 8010" -or $_.CommandLine -match "port 8010" -or $_.CommandLine -match "--port 5175")
} | ForEach-Object {
    Write-Host ("killing " + $_.ProcessId + " : " + $_.Name)
    Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
}
Write-Host "done"
