"""MediaSentinel Windows Service Installer (DEP-02).

Registers MediaSentinel as a Windows auto-start service using NSSM
(Non-Sucking Service Manager). Falls back to Windows Task Scheduler
if NSSM is not available.

Usage:
    python install_service.py [--config path/to/config.yaml]
"""

import os
import shutil
import subprocess
import sys
import urllib.request
import zipfile
from pathlib import Path


SERVICE_NAME = "MediaSentinel"
SERVICE_DISPLAY = "MediaSentinel Media Stack Monitor"
NSSM_VERSION = "2.24"
NSSM_URL = f"https://nssm.cc/release/nssm-{NSSM_VERSION}.zip"
NSSM_DIR = Path(os.environ.get("PROGRAMDATA", r"C:\ProgramData")) / "MediaSentinel" / "nssm"


def _project_root() -> Path:
    """Return the mediasentinel project root directory."""
    return Path(__file__).resolve().parent.parent


def _python_executable() -> str:
    """Return the current Python executable path."""
    return sys.executable


def _find_nssm() -> str | None:
    """Check if nssm is already on PATH or in the local install directory."""
    found = shutil.which("nssm")
    if found:
        return found

    local_exe = NSSM_DIR / "nssm.exe"
    if local_exe.exists():
        return str(local_exe)

    return None


def _download_nssm() -> str:
    """Download and extract NSSM to PROGRAMDATA. Returns path to nssm.exe."""
    if NSSM_DIR.exists():
        exe = NSSM_DIR / "nssm.exe"
        if exe.exists():
            return str(exe)

    NSSM_DIR.mkdir(parents=True, exist_ok=True)
    zip_path = NSSM_DIR / f"nssm-{NSSM_VERSION}.zip"

    print(f"Downloading NSSM {NSSM_VERSION} from {NSSM_URL}...")
    urllib.request.urlretrieve(NSSM_URL, str(zip_path))

    print(f"Extracting to {NSSM_DIR}...")
    with zipfile.ZipFile(str(zip_path), "r") as zf:
        zf.extractall(str(NSSM_DIR))

    # The zip contains a directory like nssm-2.24/win64/nssm.exe
    exe = NSSM_DIR / f"nssm-{NSSM_VERSION}" / "win64" / "nssm.exe"
    if not exe.exists():
        # Try win32 as fallback
        exe = NSSM_DIR / f"nssm-{NSSM_VERSION}" / "win32" / "nssm.exe"

    if not exe.exists():
        print("ERROR: Could not find nssm.exe in the downloaded archive.")
        sys.exit(1)

    # Copy nssm.exe directly into NSSM_DIR for easy access
    dest = NSSM_DIR / "nssm.exe"
    shutil.copy2(str(exe), str(dest))

    # Cleanup zip
    zip_path.unlink(missing_ok=True)

    print(f"NSSM installed to {dest}")
    return str(dest)


def _nssm_service_exists(nssm_path: str) -> bool:
    """Check if the MediaSentinel service is already registered."""
    result = subprocess.run(
        [nssm_path, "status", SERVICE_NAME],
        capture_output=True, text=True,
    )
    return result.returncode == 0


def _install_nssm(nssm_path: str, config_path: str) -> None:
    """Register the service via NSSM."""
    project_root = _project_root()
    python = _python_executable()

    service_cmd = f'"{python}" -m mediasentinel start --config "{config_path}"'

    print(f"Registering service '{SERVICE_NAME}' via NSSM...")
    print(f"  Command: {service_cmd}")
    print(f"  Working dir: {project_root}")

    # Create the service
    subprocess.run(
        [nssm_path, "install", SERVICE_NAME, python, "-m", "mediasentinel", "start", "--config", config_path],
        check=True,
    )

    # Set working directory
    subprocess.run(
        [nssm_path, "set", SERVICE_NAME, "AppDirectory", str(project_root)],
        check=True,
    )

    # Set display name
    subprocess.run(
        [nssm_path, "set", SERVICE_NAME, "DisplayName", SERVICE_DISPLAY],
        check=True,
    )

    # Set description
    subprocess.run(
        [nssm_path, "set", SERVICE_NAME, "Description",
         "Monitors media stack services, enforces VPN gate on torrents, and performs auto-recovery."],
        check=True,
    )

    # Set startup type to automatic
    subprocess.run(
        [nssm_path, "set", SERVICE_NAME, "Start", "SERVICE_AUTO_START"],
        check=True,
    )

    # Set restart on failure: restart delay 30 seconds
    subprocess.run(
        [nssm_path, "set", SERVICE_NAME, "AppRestartDelay", "30000"],
        check=True,
    )

    # Set to run as current user if not SYSTEM
    username = os.environ.get("USERNAME", "")
    if username and username != "SYSTEM":
        domain = os.environ.get("USERDOMAIN", ".")
        # Only set if not already running as SYSTEM (NSSM default)
        # Users can manually configure credentials if needed

    # Configure log output
    log_dir = project_root / "data" / "mediasentinel" / "service-logs"
    log_dir.mkdir(parents=True, exist_ok=True)
    subprocess.run(
        [nssm_path, "set", SERVICE_NAME, "AppStdout", str(log_dir / "stdout.log")],
        check=True,
    )
    subprocess.run(
        [nssm_path, "set", SERVICE_NAME, "AppStderr", str(log_dir / "stderr.log")],
        check=True,
    )
    # Rotate logs at 1MB
    subprocess.run(
        [nssm_path, "set", SERVICE_NAME, "AppRotateFiles", "1"],
        check=True,
    )
    subprocess.run(
        [nssm_path, "set", SERVICE_NAME, "AppRotateBytes", "1048576"],
        check=True,
    )

    print(f"Service '{SERVICE_NAME}' registered successfully via NSSM.")
    print(f"  Use 'nssm start {SERVICE_NAME}' to start the service.")
    print(f"  Use 'nssm status {SERVICE_NAME}' to check status.")


def _install_task_scheduler(config_path: str) -> None:
    """Register MediaSentinel as a scheduled task (NSSM fallback)."""
    python = _python_executable()
    project_root = _project_root()

    task_cmd = f'"{python}" -m mediasentinel start --config "{config_path}"'

    print(f"NSSM not available. Registering via Task Scheduler...")
    print(f"  Command: {task_cmd}")
    print(f"  Working dir: {project_root}")

    # Delete existing task if present
    subprocess.run(
        ["schtasks", "/delete", "/tn", SERVICE_NAME, "/f"],
        capture_output=True,
    )

    # Create the task: run at logon, with highest privileges, restart on failure
    subprocess.run(
        [
            "schtasks", "/create",
            "/tn", SERVICE_NAME,
            "/tr", task_cmd,
            "/sc", "onlogon",
            "/rl", "highest",
            "/f",
        ],
        check=True,
    )

    # Configure restart on failure via task XML settings
    # schtasks basic interface does not support all options, so we modify the task
    xml_path = project_root / "data" / "mediasentinel" / "task.xml"
    xml_path.parent.mkdir(parents=True, exist_ok=True)

    xml_content = f"""<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo>
    <Description>MediaSentinel Media Stack Monitor</Description>
  </RegistrationInfo>
  <Triggers>
    <LogonTrigger>
      <Enabled>true</Enabled>
    </LogonTrigger>
    <BootTrigger>
      <Enabled>true</Enabled>
    </BootTrigger>
  </Triggers>
  <Principals>
    <Principal id="Author">
      <LogonType>InteractiveToken</LogonType>
      <RunLevel>HighestAvailable</RunLevel>
    </Principal>
  </Principals>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <AllowHardTerminate>true</AllowHardTerminate>
    <StartWhenAvailable>true</StartWhenAvailable>
    <RunOnlyIfNetworkAvailable>false</RunOnlyIfNetworkAvailable>
    <AllowStartOnDemand>true</AllowStartOnDemand>
    <Enabled>true</Enabled>
    <Hidden>false</Hidden>
    <RunOnlyIfIdle>false</RunOnlyIfIdle>
    <WakeToRun>false</WakeToRun>
    <ExecutionTimeLimit>PT0S</ExecutionTimeLimit>
    <Priority>7</Priority>
    <RestartOnFailure>
      <Interval>PT30S</Interval>
      <Count>999</Count>
    </RestartOnFailure>
  </Settings>
  <Actions Context="Author">
    <Exec>
      <Command>{python}</Command>
      <Arguments>-m mediasentinel start --config "{config_path}"</Arguments>
      <WorkingDirectory>{project_root}</WorkingDirectory>
    </Exec>
  </Actions>
</Task>"""

    xml_path.write_text(xml_content, encoding="utf-16")

    # Re-create task from XML for full configuration support
    subprocess.run(
        ["schtasks", "/delete", "/tn", SERVICE_NAME, "/f"],
        capture_output=True,
    )
    subprocess.run(
        ["schtasks", "/create", "/tn", SERVICE_NAME, "/xml", str(xml_path), "/f"],
        check=True,
    )

    # Cleanup XML
    xml_path.unlink(missing_ok=True)

    print(f"Scheduled task '{SERVICE_NAME}' registered successfully.")
    print(f"  Use 'schtasks /run /tn {SERVICE_NAME}' to start.")
    print(f"  Use 'schtasks /query /tn {SERVICE_NAME}' to check status.")


def main():
    config_path = str(_project_root() / "config.yaml")

    # Override config path from CLI arg
    for i, arg in enumerate(sys.argv[1:], 1):
        if arg == "--config" and i < len(sys.argv) - 1:
            config_path = sys.argv[i + 1]

    if not Path(config_path).exists():
        print(f"WARNING: Config file not found at {config_path}")
        print("  The service will fail to start until a valid config exists.")

    nssm_path = _find_nssm()

    if nssm_path is None:
        # Try downloading NSSM
        try:
            nssm_path = _download_nssm()
        except Exception as e:
            print(f"Failed to download NSSM: {e}")
            print("Falling back to Task Scheduler...")
            nssm_path = None

    if nssm_path:
        if _nssm_service_exists(nssm_path):
            print(f"Service '{SERVICE_NAME}' already exists. Remove it first with uninstall_service.py.")
            sys.exit(1)
        _install_nssm(nssm_path, config_path)
    else:
        _install_task_scheduler(config_path)


if __name__ == "__main__":
    main()
