# Kills any FoodBridge uvicorn / outbox worker instances by command-line match.
# Safe: only processes whose command line contains this project's identifiers.
Get-CimInstance Win32_Process | Where-Object {
    $_.CommandLine -like '*config.asgi:application*' -or
    $_.CommandLine -like '*process_email_outbox*'
} | ForEach-Object {
    Write-Host ("Stopping stale FoodBridge process: " + $_.ProcessId)
    Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
}
Write-Host "cleaned"
