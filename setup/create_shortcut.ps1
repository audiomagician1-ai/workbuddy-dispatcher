$WshShell = New-Object -ComObject WScript.Shell
$Shortcut = $WshShell.CreateShortcut("A:\WorkBuddy\WorkBuddy-CDP-9222.lnk")
$Shortcut.TargetPath = "A:\WorkBuddy\WorkBuddy.exe"
$Shortcut.Arguments = "--remote-debugging-port=9222"
$Shortcut.WorkingDirectory = "A:\WorkBuddy"
$Shortcut.Description = "WorkBuddy with CDP debugging enabled on port 9222"
$Shortcut.Save()
Write-Host "Shortcut created: A:\WorkBuddy\WorkBuddy-CDP-9222.lnk"
