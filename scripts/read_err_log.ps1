Get-Content "C:\Users\ELCOT\Documents\FoodBridge\logs\backend.err.log" -Tail 60 |
    Select-String -Pattern "Error|error|raise|Traceback|File `"C" |
    ForEach-Object { $_.Line }
