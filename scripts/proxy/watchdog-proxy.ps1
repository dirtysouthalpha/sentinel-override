# Sentinel Proxy Watchdog v1
# Monitors port 18321 and restarts the proxy if it dies
# Logs to: C:\Users\Administrator\.claude\proxy\watchdog.log

$ErrorActionPreference = "SilentlyContinue"
$ProxyScript = "C:\Users\Administrator\.claude\proxy\zai-fix-proxy.cjs"
$LogFile = "C:\Users\Administrator\.claude\proxy\watchdog.log"
$CheckInterval = 30
$ProxyPort = 18321

function Write-Log {
    param([string]$Message)
    $ts = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    $line = "[$ts] $Message"
    Add-Content -Path $LogFile -Value $line
    Write-Host $line
}

# Rotate log if > 5MB
if ((Get-Item $LogFile -ErrorAction SilentlyContinue).Length -gt 5MB) {
    Remove-Item $LogFile -Force
    Write-Log "Log rotated"
}

function Test-ProxyAlive {
    try {
        $conn = Get-NetTCPConnection -LocalPort $ProxyPort -State Listen -ErrorAction SilentlyContinue
        return ($null -ne $conn)
    } catch {
        return $false
    }
}

function Start-Proxy {
    Write-Log "Starting proxy..."
    try {
        $proc = Start-Process -FilePath "node.exe" `
            -ArgumentList $ProxyScript `
            -WindowStyle Hidden `
            -PassThru
        Start-Sleep -Seconds 3
        if (Test-ProxyAlive) {
            Write-Log "Proxy started successfully (PID: $($proc.Id))"
            return $true
        } else {
            Write-Log "ERROR: Proxy process started but port 18321 not listening"
            return $false
        }
    } catch {
        Write-Log "ERROR: Failed to start proxy: $($_.Exception.Message)"
        return $false
    }
}

Write-Log "=== Sentinel Proxy Watchdog started ==="

# Initial startup check
if (Test-ProxyAlive) {
    Write-Log "Proxy already running on port $ProxyPort"
} else {
    Start-Proxy
}

# Main watchdog loop
while ($true) {
    Start-Sleep -Seconds $CheckInterval
    if (-not (Test-ProxyAlive)) {
        Write-Log "WARN: Proxy port $ProxyPort not responding — restarting..."
        # Kill any zombie node processes running the proxy script
        Get-CimInstance Win32_Process -Filter "CommandLine LIKE '%zai-fix-proxy%'" | ForEach-Object {
            Write-Log "Killing zombie PID $($_.ProcessId)"
            Stop-Process -Id $_.ProcessId -Force
        }
        Start-Sleep -Seconds 2
        Start-Proxy
    }
}
