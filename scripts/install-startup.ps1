# Registers a Windows Task Scheduler task that starts PROJECT PULSE at logon (keeps monitoring without the browser).
# Remove with: Unregister-ScheduledTask -TaskName 'PROJECT PULSE' -Confirm:$false
$root = Split-Path -Parent $PSScriptRoot
$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$root\scripts\start.ps1`" -NoBrowser" -WorkingDirectory $root
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit ([TimeSpan]::Zero)
Register-ScheduledTask -TaskName 'PROJECT PULSE' -Action $action -Trigger $trigger -Settings $settings -Description 'Local project monitoring dashboard' -Force | Out-Null
Write-Host 'Startup task registered. PROJECT PULSE will start at logon.'
