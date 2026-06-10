# Install Sentinel Proxy as a Scheduled Task for auto-start
# Runs at logon with auto-restart on failure

$TaskName = "SentinelProxy"
$WatchdogScript = "C:\Users\Administrator\.claude\proxy\watchdog-proxy.ps1"

# Remove existing task if present
Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue

# Create the action
$Action = New-ScheduledTaskAction `
    -Execute "powershell.exe" `
    -Argument "-WindowStyle Hidden -ExecutionPolicy Bypass -File `"$WatchdogScript`"" `
    -WorkingDirectory "C:\Users\Administrator\.claude\proxy"

# Trigger at logon
$Trigger = New-ScheduledTaskTrigger -AtLogOn -User "Administrator"

# Settings: restart on failure, don't stop on idle, run indefinitely
$Settings = New-ScheduledTaskSettingsSet `
    -RestartInterval (New-TimeSpan -Minutes 1) `
    -RestartCount 999 `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -StartWhenAvailable `
    -ExecutionTimeLimit (New-TimeSpan -Days 9999) `
    -MultipleInstances IgnoreNew

# Register
Register-ScheduledTask `
    -TaskName $TaskName `
    -Action $Action `
    -Trigger $Trigger `
    -Settings $Settings `
    -User "Administrator" `
    -RunLevel Highest `
    -Description "Sentinel Proxy Watchdog - monitors and auto-restarts zai-fix-proxy.cjs on port 18321"

Write-Host "Scheduled task '$TaskName' registered successfully."
Write-Host "The proxy watchdog will start automatically at logon."

# Also start it now if not already running
$proxyRunning = Get-NetTCPConnection -LocalPort 18321 -State Listen -ErrorAction SilentlyContinue
if (-not $proxyRunning) {
    Write-Host "Starting proxy watchdog now..."
    Start-ScheduledTask -TaskName $TaskName
    Start-Sleep -Seconds 5
    $proxyRunning = Get-NetTCPConnection -LocalPort 18321 -State Listen -ErrorAction SilentlyContinue
    if ($proxyRunning) {
        Write-Host "Proxy is running on port 18321."
    } else {
        Write-Host "WARN: Proxy may still be starting. Check watchdog.log."
    }
} else {
    Write-Host "Proxy already running on port 18321."
}
