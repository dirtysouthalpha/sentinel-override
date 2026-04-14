#Requires -Version 5.1
<#
.SYNOPSIS
    OpenClaw Gateway Watchdog - Monitors and auto-restarts OpenClaw gateway

.DESCRIPTION
    Monitors the OpenClaw gateway WebSocket connection at ws://127.0.0.1:18789
    Detects frozen or crashed processes and automatically restarts them
    Sends Telegram alerts on polling conflicts and critical events
    Runs completely hidden with no desktop windows

.NOTES
    File: openclaw-watchdog.ps1
    Author: OpenClaw Team
    Version: 1.0.0
#>

# =============================================================================
# CONFIGURATION
# =============================================================================

param(
    [string]$GatewayUrl = "ws://100.100.169.48:18789",
    [int]$CheckInterval = 30,
    [int]$RestartDelay = 30,
    [int]$FrozenThreshold = 60,
    [int]$MaxRestartAttempts = 3,
    [int]$WebSocketTimeout = 10,
    [string]$TelegramBotToken = "",
    [string]$TelegramChatId = "",
    [string]$GatewayStartScript = "C:\Program Files\nodejs\node.exe",
    [string]$GatewayPidFile = "C:\Users\Administrator\.openclaw\watchdog\gateway.pid",
    [string]$LogFile = "C:\Users\Administrator\.openclaw\logs\watchdog.log",
    [switch]$InstallAsService,
    [switch]$UninstallService,
    [switch]$StartImmediately
)

# Static configuration (can be overridden by parameters or environment variables)
$Config = @{
    GatewayUrl = if ($env:OPENCLAW_GATEWAY_URL) { $env:OPENCLAW_GATEWAY_URL } else { $GatewayUrl }
    CheckInterval = $CheckInterval
    RestartDelay = $RestartDelay
    FrozenThreshold = $FrozenThreshold
    MaxRestartAttempts = $MaxRestartAttempts
    WebSocketTimeout = $WebSocketTimeout
    TelegramBotToken = if ($env:TELEGRAM_BOT_TOKEN) { $env:TELEGRAM_BOT_TOKEN } else { "8604144728:AAE4-b5w2tycqGmqv6PsgKiGhS1mfhfEFco" }
    TelegramChatId = if ($env:TELEGRAM_CHAT_ID) { $env:TELEGRAM_CHAT_ID } else { "7178939484" }
    GatewayStartScript = "C:\Users\Administrator\.openclaw\gateway.cmd"
    GatewayArgs = ""
    GatewayPidFile = $GatewayPidFile
    LogFile = $LogFile
    StartupGracePeriod = 180
    TaskName = "OpenClaw-Watchdog"
    TaskDescription = "Monitors OpenClaw gateway and auto-restarts on failure"
}

# =============================================================================
# INITIALIZATION
# =============================================================================

# Ensure required directories exist
$requiredDirs = @(
    Split-Path $Config.GatewayPidFile -Parent
    Split-Path $Config.LogFile -Parent
)

foreach ($dir in $requiredDirs) {
    if (-not (Test-Path $dir)) {
        try {
            New-Item -Path $dir -ItemType Directory -Force | Out-Null
        } catch {
            Write-Error "Failed to create directory: $dir"
            exit 1
        }
    }
}

# =============================================================================
# LOGGING FUNCTIONS
# =============================================================================

function Write-Log {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Message,

        [ValidateSet('INFO', 'WARNING', 'ERROR', 'DEBUG')]
        [string]$Level = 'INFO'
    )

    $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    $logEntry = "[$timestamp] [$Level] $Message"

    # Write to log file
    try {
        Add-Content -Path $Config.LogFile -Value $logEntry -ErrorAction SilentlyContinue
    } catch {
        # Silently fail if log file is not writable
    }

    # Only write to console if running interactively
    if ([Environment]::UserInteractive) {
        switch ($Level) {
            'INFO'    { Write-Host $logEntry -ForegroundColor Green }
            'WARNING' { Write-Host $logEntry -ForegroundColor Yellow }
            'ERROR'   { Write-Host $logEntry -ForegroundColor Red }
            'DEBUG'   { Write-Host $logEntry -ForegroundColor Gray }
        }
    }
}

# =============================================================================
# TELEGRAM ALERT FUNCTIONS
# =============================================================================

function Send-TelegramAlert {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Message,

        [string]$Priority = "normal"
    )

    # Skip if Telegram credentials not configured
    if ([string]::IsNullOrEmpty($Config.TelegramBotToken) -or [string]::IsNullOrEmpty($Config.TelegramChatId)) {
        Write-Log "Telegram alert skipped - credentials not configured" -Level DEBUG
        return $false
    }

    try {
        # Add emoji based on priority
        $emoji = switch ($Priority) {
            "critical" { "[ALERT]" }
            "warning"  { "[WARN]" }
            "info"     { "[INFO]" }
            default    { "" }
        }

        $fullMessage = "$emoji OpenClaw Watchdog Alert`n`n$Message`n`nTime: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') EST"

        # Prepare Telegram API request
        $uri = "https://api.telegram.org/bot$($Config.TelegramBotToken)/sendMessage"
        $body = @{
            chat_id = $Config.TelegramChatId
            text = $fullMessage
            parse_mode = "HTML"
        }

        # Send request
        $response = Invoke-RestMethod -Uri $uri -Method Post -Body $body -TimeoutSec 30 -ErrorAction Stop

        Write-Log "Telegram alert sent successfully" -Level DEBUG
        return $true
    } catch {
        Write-Log "Failed to send Telegram alert: $($_.Exception.Message)" -Level WARNING
        return $false
    }
}

# =============================================================================
# GATEWAY PROCESS MANAGEMENT
# =============================================================================

function Get-GatewayProcesses {
    <#
    .SYNOPSIS
        Gets all OpenClaw gateway processes (deduplicated by PID)
    #>

    $processes = @()
    $seenPids = @{}

    # Find node processes that might be running OpenClaw
    $nodeProcesses = Get-Process -Name "node" -ErrorAction SilentlyContinue

    foreach ($proc in $nodeProcesses) {
        try {
            # Check if process is listening on the gateway port
            $connections = Get-NetTCPConnection -OwningProcess $proc.Id -ErrorAction SilentlyContinue |
                          Where-Object { $_.LocalPort -eq 18789 -and $_.State -eq "Listen" }

            if ($connections -and -not $seenPids.ContainsKey($proc.Id)) {
                $processes += $proc
                $seenPids[$proc.Id] = $true
            }
        } catch {
            # Process may have exited
        }
    }

    # Also check by PID file (only node processes, not cmd.exe wrappers)
    if (Test-Path $Config.GatewayPidFile) {
        try {
            $pidFromFile = Get-Content $Config.GatewayPidFile -Raw
            $pidFromFile = $pidFromFile.Trim()

            if ($pidFromFile -match '^\d+$') {
                $proc = Get-Process -Id ([int]$pidFromFile) -ErrorAction SilentlyContinue
                if ($proc -and ($proc.ProcessName -eq "node" -or $proc.ProcessName -eq "cmd") -and -not $seenPids.ContainsKey($proc.Id)) {
                    $processes += $proc
                    $seenPids[$proc.Id] = $true
                }
            }
        } catch {
            Write-Log "Failed to read PID file: $($_.Exception.Message)" -Level DEBUG
        }
    }

    return $processes
}

function Stop-GatewayProcess {
    param(
        [Parameter(Mandatory = $true)]
        [System.Diagnostics.Process]$Process,

        [int]$TimeoutSeconds = 10
    )

    try {
        Write-Log "Stopping gateway process (PID: $($Process.Id))..."

        # Force kill directly - gateway.cmd doesn't have a window to close
        Stop-Process -Id $Process.Id -Force -ErrorAction SilentlyContinue

        # Wait for process to fully exit
        try {
            $Process.WaitForExit(5000) | Out-Null
        } catch {
            # Process already exited
        }

        return $true
    } catch {
        Write-Log "Error stopping process: $($_.Exception.Message)" -Level ERROR
        return $false
    }
}

function Start-GatewayProcess {
    param(
        [int]$Attempt = 1
    )

    Write-Log "Starting OpenClaw gateway (attempt $attempt of $($Config.MaxRestartAttempts))..."

    # Check if start script exists
    if (-not (Test-Path $Config.GatewayStartScript)) {
        Write-Log "Gateway start script not found: $($Config.GatewayStartScript)" -Level ERROR
        Send-TelegramAlert -Message "CRITICAL: Gateway start script not found!`nPath: $($Config.GatewayStartScript)" -Priority "critical"
        return $null
    }

    try {
        # Kill any existing gateway processes first
        $existingProcesses = Get-GatewayProcesses
        if ($existingProcesses.Count -gt 0) {
            Write-Log "Killing $($existingProcesses.Count) existing gateway process(es)..."

            foreach ($proc in $existingProcesses) {
                Stop-GatewayProcess -Process $proc | Out-Null
            }

            Start-Sleep -Seconds 2
        }

        # Start the gateway via gateway.cmd (includes required env vars like API keys and Discord token)
        if ($Config.GatewayArgs) {
            $process = Start-Process -FilePath $Config.GatewayStartScript -ArgumentList $Config.GatewayArgs -WindowStyle Hidden -PassThru
        } else {
            $process = Start-Process -FilePath $Config.GatewayStartScript -WindowStyle Hidden -PassThru
        }

        if ($process) {
            # Wait a moment and verify process started
            Start-Sleep -Seconds $Config.RestartDelay

            $process.Refresh()
            if ($process.HasExited) {
                Write-Log "Gateway process exited immediately after start" -Level ERROR
                return $null
            }

            # Save PID to file
            $process.Id | Out-File -FilePath $Config.GatewayPidFile -Force -Encoding ASCII

            Write-Log "Gateway started successfully with PID: $($process.Id)"

            $script:LastGatewayStart = Get-Date

            Send-TelegramAlert -Message "Gateway restarted successfully`nPID: $($process.Id)`nAttempt: $attempt" -Priority "info"

            return $process
        }
    } catch {
        Write-Log "Failed to start gateway: $($_.Exception.Message)" -Level ERROR
        Send-TelegramAlert -Message "Failed to start gateway`nError: $($_.Exception.Message)" -Priority "critical"
    }

    return $null
}

# =============================================================================
# GATEWAY HEALTH CHECK
# =============================================================================

function Test-GatewayHealth {
    <#
    .SYNOPSIS
        Tests if the gateway is healthy and responding
    #>

    $healthResult = @{
        IsHealthy = $false
        IsRunning = $false
        IsResponsive = $false
        HasPortConflict = $false
        ProcessCount = 0
        Processes = @()
        LastError = $null
    }

    # Get gateway processes
    $processes = Get-GatewayProcesses
    $healthResult.ProcessCount = $processes.Count
    $healthResult.Processes = $processes

    # Check for multiple processes (polling conflict)
    if ($processes.Count -gt 1) {
        $healthResult.HasPortConflict = $true
        $healthResult.LastError = "Multiple gateway processes detected ($($processes.Count)) - polling conflict"

        Write-Log "POLLING CONFLICT: $($processes.Count) gateway processes detected!" -Level WARNING

        Send-TelegramAlert -Message "POLLING CONFLICT DETECTED!`n`nMultiple gateway processes running: $($processes.Count)`nPIDs: $($processes.Id -join ', ')`n`nAuto-resolving by killing duplicate processes..." -Priority "critical"

        return $healthResult
    }

    # Check if any process is running
    if ($processes.Count -eq 0) {
        $healthResult.LastError = "No gateway process found"
        return $healthResult
    }

    $healthResult.IsRunning = $true

    # Test HTTP connectivity - use localhost first (avoids Tailscale dependency), fall back to Tailscale IP
    $checkUrls = @("http://127.0.0.1:18789/", "http://100.100.169.48:18789/")
    $httpOk = $false
    foreach ($url in $checkUrls) {
        try {
            $response = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec $Config.WebSocketTimeout
            if ($response.StatusCode -eq 200) {
                $httpOk = $true
                break
            }
        } catch {
            # Try next URL
        }
    }
    if ($httpOk) {
        $healthResult.IsResponsive = $true
        $healthResult.IsHealthy = $true
    } else {
        $healthResult.LastError = "HTTP check failed on all interfaces"
    }

    return $healthResult
}

function Test-ProcessFrozen {
    param(
        [Parameter(Mandatory = $true)]
        [System.Diagnostics.Process]$Process
    )

    try {
        $Process.Refresh()

        # If process has exited, definitely frozen/dead
        if ($Process.HasExited) {
            Write-Log "Process (PID: $($Process.Id)) has exited" -Level WARNING
            return $true
        }

        # Do an HTTP check - try localhost first, then Tailscale IP
        $frozenCheckUrls = @("http://127.0.0.1:18789/", "http://100.100.169.48:18789/")
        $frozenHttpOk = $false
        foreach ($url in $frozenCheckUrls) {
            try {
                $response = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 10
                if ($response.StatusCode -eq 200) {
                    $frozenHttpOk = $true
                    break
                }
            } catch {
                # Try next URL
            }
        }
        if ($frozenHttpOk) {
            Write-Log "Process (PID: $($Process.Id)) HTTP healthy" -Level DEBUG
            return $false
        } else {
            Write-Log "Process (PID: $($Process.Id)) HTTP not responding on any interface - gateway hung" -Level WARNING
            return $true
        }

        return $false
    } catch {
        Write-Log "Error checking if process is frozen: $($_.Exception.Message)" -Level DEBUG
        return $true
    }
}

# =============================================================================
# WATCHDOG MAIN LOOP
# =============================================================================

function Start-Watchdog {
    param(
        [int]$MaxAttempts = $Config.MaxRestartAttempts
    )

    Write-Log "========================================"
    Write-Log "OpenClaw Watchdog Started"
    Write-Log "========================================"
    Write-Log "Gateway URL: $($Config.GatewayUrl)"
    Write-Log "Check Interval: $($Config.CheckInterval) seconds"
    Write-Log "Frozen Threshold: $($Config.FrozenThreshold) seconds"
    Write-Log "Log File: $($Config.LogFile)"
    Write-Log "========================================"

    # Send startup notification
    Send-TelegramAlert -Message "Watchdog started monitoring`nGateway: $($Config.GatewayUrl)`nInterval: $($Config.CheckInterval)s" -Priority "info"

    $consecutiveFailures = 0
    $lastHealthCheck = $null
    $script:LastGatewayStart = $null

    # Config enforcement - runs every cycle to keep exec settings locked
    $enforceScript = "C:\Users\Administrator\openclaw\watchdog\enforce-exec-config.js"

    while ($true) {
        try {
            $checkStart = Get-Date
            Write-Log "Performing health check..." -Level DEBUG

            # Enforce exec config before every health check
            if (Test-Path $enforceScript) {
                try {
                    node $enforceScript 2>$null
                } catch {
                    Write-Log "Config enforcement failed: $($_.Exception.Message)" -Level WARNING
                }
            }

            # Perform health check
            $health = Test-GatewayHealth

            # Grace period: skip failure actions if gateway was just started
            if ($script:LastGatewayStart -and -not $health.IsHealthy) {
                $elapsed = ((Get-Date) - $script:LastGatewayStart).TotalSeconds
                if ($elapsed -lt $Config.StartupGracePeriod) {
                    Write-Log "Gateway in startup grace period ($([math]::Round($elapsed))s / $($Config.StartupGracePeriod)s) - skipping failure actions" -Level DEBUG
                    Start-Sleep -Seconds $Config.CheckInterval
                    continue
                }
            }

            if ($health.HasPortConflict) {
                # Handle polling conflict - kill all but the newest (highest PID)
                Write-Log "Resolving polling conflict..." -Level WARNING

                $sorted = $health.Processes | Sort-Object Id
                $newest = $sorted[-1]
                $rest = $sorted[0..($sorted.Count - 2)]

                foreach ($proc in $rest) {
                    Write-Log "Killing older gateway PID: $($proc.Id) (keeping newest PID: $($newest.Id))" -Level WARNING
                    Stop-GatewayProcess -Process $proc | Out-Null
                }

                Start-Sleep -Seconds $Config.RestartDelay

                # Check if the kept process is healthy now
                $checkHealth = Test-GatewayHealth
                if ($checkHealth.IsHealthy) {
                    Write-Log "Polling conflict resolved - newest process is healthy" -Level INFO
                    $consecutiveFailures = 0
                } else {
                    # If still not healthy, start fresh
                    $newProcess = Start-GatewayProcess -Attempt 1
                    if ($newProcess) {
                        $consecutiveFailures = 0
                    } else {
                        $consecutiveFailures++
                    }
                }

                if ($newProcess) {
                    $consecutiveFailures = 0
                } else {
                    $consecutiveFailures++
                }
            }
            elseif (-not $health.IsRunning) {
                # Gateway not running - start it
                Write-Log "Gateway not running - attempting to start..." -Level WARNING

                $consecutiveFailures++
                if ($consecutiveFailures -ge 2) {
                    Send-TelegramAlert -Message "Gateway process not found!`nAttempting restart (attempt $consecutiveFailures/$MaxAttempts)" -Priority "critical"
                } else {
                    Write-Log "Gateway down briefly (failure $consecutiveFailures) - waiting before alerting" -Level DEBUG
                }

                if ($consecutiveFailures -le $MaxAttempts) {
                    Start-GatewayProcess -Attempt $consecutiveFailures
                } else {
                    Write-Log "Max restart attempts reached. Waiting before retry..." -Level ERROR
                    Start-Sleep -Seconds 300  # Wait 5 minutes before retrying
                    $consecutiveFailures = 0
                }
            }
            elseif (-not $health.IsResponsive) {
                # Gateway running but not responsive - check if frozen
                Write-Log "Gateway running but not responsive - checking if frozen..." -Level WARNING

                # Skip frozen detection during startup grace period
                if ($script:LastGatewayStart) {
                    $graceElapsed = ((Get-Date) - $script:LastGatewayStart).TotalSeconds
                    if ($graceElapsed -lt $Config.StartupGracePeriod) {
                        Write-Log "Skipping frozen check - startup grace period ($([math]::Round($graceElapsed))s / $($Config.StartupGracePeriod)s)" -Level DEBUG
                        Start-Sleep -Seconds $Config.CheckInterval
                        continue
                    }
                }

                $isFrozen = Test-ProcessFrozen -Process $health.Processes[0]

                if ($isFrozen) {
                    Write-Log "Gateway appears frozen - restarting..." -Level ERROR
                    Send-TelegramAlert -Message "Gateway frozen detected!`nRestarting gateway..." -Priority "critical"

                    Stop-GatewayProcess -Process $health.Processes[0] | Out-Null
                    Start-Sleep -Seconds $Config.RestartDelay

                    $consecutiveFailures++
                    Start-GatewayProcess -Attempt $consecutiveFailures
                } else {
                    Write-Log "Gateway responsive but WebSocket connection failed: $($health.LastError)" -Level WARNING
                }
            }
            else {
                # Gateway is healthy
                if ($consecutiveFailures -gt 0) {
                    Write-Log "Gateway recovered after $consecutiveFailures failure(s)" -Level INFO
                    Send-TelegramAlert -Message "Gateway recovered!`nPrevious failures: $consecutiveFailures" -Priority "info"
                }
                $consecutiveFailures = 0
                Write-Log "Gateway healthy - PID: $($health.Processes[0].Id)" -Level DEBUG
            }

            $lastHealthCheck = Get-Date
            $checkDuration = ((Get-Date) - $checkStart).TotalSeconds

            Write-Log "Health check completed in $([math]::Round($checkDuration, 2))s" -Level DEBUG

            # Wait for next check
            $sleepTime = [Math]::Max(0, $Config.CheckInterval - $checkDuration)
            Start-Sleep -Seconds $sleepTime

        } catch {
            Write-Log "Error in watchdog loop: $($_.Exception.Message)" -Level ERROR
            Write-Log $_.ScriptStackTrace -Level DEBUG

            # Wait before retrying
            Start-Sleep -Seconds $Config.CheckInterval
        }
    }
}

# =============================================================================
# SERVICE INSTALLATION FUNCTIONS
# =============================================================================

function Install-WatchdogService {
    <#
    .SYNOPSIS
        Installs the watchdog as a Windows scheduled task that runs at system startup
    #>

    Write-Host "Installing OpenClaw Watchdog as a Windows scheduled task..." -ForegroundColor Cyan

    # Check if running as administrator
    $isAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)

    if (-not $isAdmin) {
        Write-Host "ERROR: Must run as Administrator to install service" -ForegroundColor Red
        return $false
    }

    # Remove existing task if present
    $existingTask = Get-ScheduledTask -TaskName $Config.TaskName -ErrorAction SilentlyContinue
    if ($existingTask) {
        Write-Host "Removing existing scheduled task..." -ForegroundColor Yellow
        Unregister-ScheduledTask -TaskName $Config.TaskName -Confirm:$false
    }

    # Create action to run the script
    $action = New-ScheduledTaskAction `
        -Execute "powershell.exe" `
        -Argument "-ExecutionPolicy Bypass -NoLogo -NonInteractive -WindowStyle Hidden -File `"$($MyInvocation.MyCommand.Path)`" -StartImmediately" `
        -WorkingDirectory (Split-Path $MyInvocation.MyCommand.Path -Parent)

    # Create trigger for system startup
    $trigger = New-ScheduledTaskTrigger -AtStartup

    # Create principal to run as SYSTEM with highest privileges
    $principal = New-ScheduledTaskPrincipal `
        -UserId "SYSTEM" `
        -LogonType ServiceAccount `
        -RunLevel Highest

    # Create settings
    $settings = New-ScheduledTaskSettingsSet `
        -AllowStartIfOnBatteries `
        -DontStopIfGoingOnBatteries `
        -StartWhenAvailable `
        -RunOnlyIfNetworkAvailable:$false `
        -DontStopOnIdleEnd `
        -Hidden `
        -MultipleInstances IgnoreNew `
        -ExecutionTimeLimit 0

    # Register the task
    Register-ScheduledTask `
        -TaskName $Config.TaskName `
        -Action $action `
        -Trigger $trigger `
        -Principal $principal `
        -Settings $settings `
        -Description $Config.TaskDescription

    # Verify task was created
    $task = Get-ScheduledTask -TaskName $Config.TaskName -ErrorAction SilentlyContinue

    if ($task) {
        Write-Host "Scheduled task installed successfully!" -ForegroundColor Green
        Write-Host "Task Name: $($Config.TaskName)" -ForegroundColor White
        Write-Host "The watchdog will start automatically on system boot." -ForegroundColor White

        # Offer to start immediately
        Write-Host "`nStarting watchdog now..." -ForegroundColor Cyan
        Start-ScheduledTask -TaskName $Config.TaskName

        return $true
    } else {
        Write-Host "Failed to create scheduled task" -ForegroundColor Red
        return $false
    }
}

function Uninstall-WatchdogService {
    <#
    .SYNOPSIS
        Removes the watchdog Windows scheduled task
    #>

    Write-Host "Uninstalling OpenClaw Watchdog..." -ForegroundColor Cyan

    # Check if running as administrator
    $isAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)

    if (-not $isAdmin) {
        Write-Host "ERROR: Must run as Administrator to uninstall service" -ForegroundColor Red
        return $false
    }

    # Check if task exists
    $task = Get-ScheduledTask -TaskName $Config.TaskName -ErrorAction SilentlyContinue

    if ($task) {
        # Stop the task if running
        Stop-ScheduledTask -TaskName $Config.TaskName -ErrorAction SilentlyContinue

        # Unregister the task
        Unregister-ScheduledTask -TaskName $Config.TaskName -Confirm:$false

        Write-Host "Scheduled task uninstalled successfully!" -ForegroundColor Green
        return $true
    } else {
        Write-Host "Scheduled task not found - nothing to uninstall" -ForegroundColor Yellow
        return $false
    }
}

function Get-WatchdogStatus {
    <#
    .SYNOPSIS
        Gets the current status of the watchdog and gateway
    #>

    Write-Host "========================================" -ForegroundColor Cyan
    Write-Host "OpenClaw Watchdog Status" -ForegroundColor Cyan
    Write-Host "========================================" -ForegroundColor Cyan

    # Check scheduled task
    $task = Get-ScheduledTask -TaskName $Config.TaskName -ErrorAction SilentlyContinue
    if ($task) {
        $taskInfo = Get-ScheduledTaskInfo -TaskName $Config.TaskName
        Write-Host "Scheduled Task: INSTALLED" -ForegroundColor Green
        Write-Host "  Status: $($task.State)" -ForegroundColor White
        Write-Host "  Last Run: $($taskInfo.LastRunTime)" -ForegroundColor White
        Write-Host "  Last Result: $($taskInfo.LastTaskResult)" -ForegroundColor White
    } else {
        Write-Host "Scheduled Task: NOT INSTALLED" -ForegroundColor Yellow
    }

    Write-Host ""

    # Check gateway health
    $health = Test-GatewayHealth

    Write-Host "Gateway Health:" -ForegroundColor Cyan
    Write-Host "  Running: $($health.IsRunning)" -ForegroundColor $(if ($health.IsRunning) { "Green" } else { "Red" })
    Write-Host "  Responsive: $($health.IsResponsive)" -ForegroundColor $(if ($health.IsResponsive) { "Green" } else { "Red" })
    Write-Host "  Healthy: $($health.IsHealthy)" -ForegroundColor $(if ($health.IsHealthy) { "Green" } else { "Red" })
    Write-Host "  Port Conflict: $($health.HasPortConflict)" -ForegroundColor $(if ($health.HasPortConflict) { "Red" } else { "Green" })
    Write-Host "  Process Count: $($health.ProcessCount)" -ForegroundColor White

    if ($health.Processes) {
        Write-Host "  PIDs: $($health.Processes.Id -join ', ')" -ForegroundColor White
    }

    if ($health.LastError) {
        Write-Host "  Last Error: $($health.LastError)" -ForegroundColor Red
    }

    Write-Host ""

    # Check Telegram configuration
    $telegramConfigured = -not [string]::IsNullOrEmpty($Config.TelegramBotToken) -and -not [string]::IsNullOrEmpty($Config.TelegramChatId)
    Write-Host "Telegram Alerts: $(if ($telegramConfigured) { "CONFIGURED" } else { "NOT CONFIGURED" })" -ForegroundColor $(if ($telegramConfigured) { "Green" } else { "Yellow" })

    Write-Host "========================================" -ForegroundColor Cyan
}

# =============================================================================
# MAIN ENTRY POINT
# =============================================================================

# Handle service installation/uninstallation
if ($InstallAsService) {
    Install-WatchdogService
    exit
}

if ($UninstallService) {
    Uninstall-WatchdogService
    exit
}

# If running with -StartImmediately or just normally, start the watchdog
if ($StartImmediately -or [Environment]::UserInteractive) {
    # If interactive, check if we should show status or run watchdog
    if ($args -contains "-Status") {
        Get-WatchdogStatus
        exit
    }

    # Start the watchdog loop
    Start-Watchdog
} else {
    # Running as scheduled task - start watchdog
    Start-Watchdog
}
