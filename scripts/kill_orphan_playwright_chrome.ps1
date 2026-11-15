# Kills ONLY Playwright-launched Chrome processes (identified by their temp
# playwright profile / remote-debugging flags). The user's own Chrome or the
# ZCode in-app browser is never touched.
Get-CimInstance Win32_Process -Filter "Name='chrome.exe'" |
    Where-Object {
        $_.CommandLine -like '*playwright_chromiumdev_profile*' -or
        $_.CommandLine -like '*ms-playwright*' -or
        $_.CommandLine -like '*--remote-debugging-pipe*'
    } | ForEach-Object {
        Write-Host ("Killing orphan Playwright chrome: " + $_.ProcessId)
        Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
    }
Write-Host "done"
