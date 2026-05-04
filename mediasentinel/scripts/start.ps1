# MediaSentinel Startup Script
# Checks prerequisites, starts Docker Compose, waits for health, then starts MediaSentinel
# Usage: .\scripts\start.ps1 [-ConfigPath path\to\config.yaml] [-SkipDocker]

param(
    [string]$ConfigPath = ".\config.yaml",
    [switch]$SkipDocker = $false
)

$ErrorActionPreference = "Stop"
$ProjectRoot = Split-Path -Parent $PSScriptRoot

Write-Host "=== MediaSentinel Startup ===" -ForegroundColor Cyan
Write-Host "Project root: $ProjectRoot"

# -------------------------------------------------------
# 1. Check if Docker Desktop is running
# -------------------------------------------------------
if (-not $SkipDocker) {
    Write-Host "`n[1/5] Checking Docker Desktop..." -ForegroundColor Yellow

    $dockerProcess = Get-Process -Name "Docker Desktop" -ErrorAction SilentlyContinue
    if (-not $dockerProcess) {
        # Also check for the docker service / com.docker.backend
        $dockerService = Get-Process -Name "com.docker.backend" -ErrorAction SilentlyContinue
        if (-not $dockerService) {
            Write-Host "Docker Desktop is not running. Attempting to start..." -ForegroundColor Red
            $dockerExe = Get-Command "Docker Desktop.exe" -ErrorAction SilentlyContinue
            if (-not $dockerExe) {
                # Try common install paths
                $candidates = @(
                    "${env:ProgramFiles}\Docker\Docker\Docker Desktop.exe"
                    "${env:LOCALAPPDATA}\Docker\wsl\Docker Desktop.exe"
                    "C:\Program Files\Docker\Docker\Docker Desktop.exe"
                )
                foreach ($c in $candidates) {
                    if (Test-Path $c) {
                        $dockerExe = $c
                        break
                    }
                }
            }

            if ($dockerExe) {
                Start-Process $dockerExe
                Write-Host "Waiting for Docker Desktop to initialize..." -ForegroundColor Yellow
                $timeout = 120
                $elapsed = 0
                while ($elapsed -lt $timeout) {
                    Start-Sleep -Seconds 5
                    $elapsed += 5
                    try {
                        $null = docker info 2>$null
                        if ($LASTEXITCODE -eq 0) {
                            Write-Host "Docker Desktop is ready." -ForegroundColor Green
                            break
                        }
                    } catch {
                        # Still starting
                    }
                    Write-Host "  Waiting... ($elapsed/$timeout seconds)"
                }
                if ($elapsed -ge $timeout) {
                    Write-Host "ERROR: Docker Desktop failed to start within $timeout seconds." -ForegroundColor Red
                    exit 1
                }
            } else {
                Write-Host "ERROR: Docker Desktop not found. Install Docker Desktop or use -SkipDocker." -ForegroundColor Red
                exit 1
            }
        }
    } else {
        # Docker Desktop process exists, verify the daemon responds
        try {
            $null = docker info 2>$null
            if ($LASTEXITCODE -eq 0) {
                Write-Host "Docker Desktop is running." -ForegroundColor Green
            } else {
                Write-Host "WARNING: Docker Desktop process found but daemon not responding." -ForegroundColor Red
            }
        } catch {
            Write-Host "WARNING: Could not verify Docker daemon: $_" -ForegroundColor Red
        }
    }
}

# -------------------------------------------------------
# 2. Check config.yaml exists
# -------------------------------------------------------
Write-Host "`n[2/5] Checking configuration..." -ForegroundColor Yellow

$configResolved = if ([System.IO.Path]::IsPathRooted($ConfigPath)) { $ConfigPath } else { Join-Path $ProjectRoot $ConfigPath }

if (-not (Test-Path $configResolved)) {
    Write-Host "ERROR: Configuration file not found: $configResolved" -ForegroundColor Red
    Write-Host "  Create one from the example: copy config.yaml.example config.yaml"
    exit 1
}
Write-Host "Configuration file: $configResolved" -ForegroundColor Green

# -------------------------------------------------------
# 3. Start Docker Compose services
# -------------------------------------------------------
if (-not $SkipDocker) {
    $composeFile = Join-Path $ProjectRoot "docker-compose.yml"
    if (Test-Path $composeFile) {
        Write-Host "`n[3/5] Starting Docker Compose services..." -ForegroundColor Yellow
        Push-Location $ProjectRoot
        try {
            docker compose up -d 2>&1 | ForEach-Object { Write-Host "  $_" }
            if ($LASTEXITCODE -ne 0) {
                Write-Host "ERROR: docker compose up failed." -ForegroundColor Red
                Pop-Location
                exit 1
            }
            Write-Host "Docker Compose services started." -ForegroundColor Green
        } catch {
            Write-Host "ERROR: docker compose up failed: $_" -ForegroundColor Red
            Pop-Location
            exit 1
        }
        Pop-Location
    } else {
        Write-Host "`n[3/5] No docker-compose.yml found. Skipping Docker Compose." -ForegroundColor Yellow
    }
} else {
    Write-Host "`n[3/5] Skipping Docker Compose (-SkipDocker)." -ForegroundColor Yellow
}

# -------------------------------------------------------
# 4. Wait for services to be healthy
# -------------------------------------------------------
if (-not $SkipDocker -and (Test-Path (Join-Path $ProjectRoot "docker-compose.yml"))) {
    Write-Host "`n[4/5] Waiting for services to become healthy..." -ForegroundColor Yellow
    Push-Location $ProjectRoot
    try {
        $maxWaitSeconds = 300
        $checkInterval = 10
        $elapsed = 0
        $allHealthy = $false

        while ($elapsed -lt $maxWaitSeconds -and -not $allHealthy) {
            $psOutput = docker compose ps --format json 2>$null | Out-String
            if ($psOutput) {
                try {
                    # docker compose ps --format json may output one JSON object per line
                    $services = $psOutput -split "`n" | Where-Object { $_.Trim() } | ForEach-Object {
                        try { $_ | ConvertFrom-Json } catch { }
                    }

                    $total = ($services | Measure-Object).Count
                    $healthy = ($services | Where-Object { $_.Health -eq "healthy" } | Measure-Object).Count

                    Write-Host ("  [{0}/{1}] healthy ({2}s/{3}s)" -f $healthy, $total, $elapsed, $maxWaitSeconds)

                    if ($healthy -ge $total -and $total -gt 0) {
                        $allHealthy = $true
                        Write-Host "All services are healthy!" -ForegroundColor Green
                    }
                } catch {
                    Write-Host "  Could not parse docker compose output, continuing..." -ForegroundColor Yellow
                }
            }

            if (-not $allHealthy) {
                Start-Sleep -Seconds $checkInterval
                $elapsed += $checkInterval
            }
        }

        if (-not $allHealthy) {
            Write-Host "WARNING: Not all services became healthy within $maxWaitSeconds seconds." -ForegroundColor Red
            Write-Host "  Continuing with MediaSentinel startup anyway -- it will detect unhealthy services."
        }
    } catch {
        Write-Host "WARNING: Could not check service health: $_" -ForegroundColor Yellow
    }
    Pop-Location
} else {
    Write-Host "`n[4/5] Skipping health check (no Docker or -SkipDocker)." -ForegroundColor Yellow
}

# -------------------------------------------------------
# 5. Start MediaSentinel monitoring
# -------------------------------------------------------
Write-Host "`n[5/5] Starting MediaSentinel..." -ForegroundColor Yellow

$pythonExe = Get-Command python -ErrorAction SilentlyContinue
if (-not $pythonExe) {
    $pythonExe = Get-Command python3 -ErrorAction SilentlyContinue
}
if (-not $pythonExe) {
    Write-Host "ERROR: Python not found on PATH." -ForegroundColor Red
    exit 1
}

Push-Location $ProjectRoot
try {
    # Run MediaSentinel in the foreground so Ctrl+C works for graceful shutdown
    Write-Host "Running: python -m mediasentinel start --config $configResolved`n" -ForegroundColor Cyan
    & python -m mediasentinel start --config $configResolved
} finally {
    Pop-Location
}

Write-Host "`nMediaSentinel has stopped." -ForegroundColor Yellow
