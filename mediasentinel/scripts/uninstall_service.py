"""MediaSentinel Windows Service Uninstaller (DEP-02).

Removes the MediaSentinel service registered via NSSM or Task Scheduler.

Usage:
    python uninstall_service.py
"""

import shutil
import subprocess
import sys
from pathlib import Path


SERVICE_NAME = "MediaSentinel"


def _find_nssm() -> str | None:
    """Check if nssm is available."""
    found = shutil.which("nssm")
    if found:
        return found

    from install_service import NSSM_DIR
    local_exe = NSSM_DIR / "nssm.exe"
    if local_exe.exists():
        return str(local_exe)

    return None


def _stop_nssm_service(nssm_path: str) -> bool:
    """Stop the service if running."""
    result = subprocess.run(
        [nssm_path, "status", SERVICE_NAME],
        capture_output=True, text=True,
    )
    if result.returncode == 0 and "RUNNING" in (result.stdout or "").upper():
        print(f"Stopping service '{SERVICE_NAME}'...")
        subprocess.run(
            [nssm_path, "stop", SERVICE_NAME],
            capture_output=True, timeout=30,
        )
        return True
    return False


def _uninstall_nssm(nssm_path: str) -> None:
    """Remove the NSSM service."""
    _stop_nssm_service(nssm_path)

    print(f"Removing service '{SERVICE_NAME}' via NSSM...")
    result = subprocess.run(
        [nssm_path, "remove", SERVICE_NAME, "confirm"],
        capture_output=True, text=True,
    )
    if result.returncode == 0:
        print(f"Service '{SERVICE_NAME}' removed successfully.")
    else:
        print(f"Failed to remove service: {result.stderr}")
        sys.exit(1)


def _uninstall_task_scheduler() -> None:
    """Remove the scheduled task."""
    print(f"Removing scheduled task '{SERVICE_NAME}'...")
    result = subprocess.run(
        ["schtasks", "/delete", "/tn", SERVICE_NAME, "/f"],
        capture_output=True, text=True,
    )
    if result.returncode == 0:
        print(f"Scheduled task '{SERVICE_NAME}' removed successfully.")
    else:
        print(f"Failed to remove scheduled task: {result.stderr}")
        sys.exit(1)


def main():
    nssm_path = _find_nssm()

    if nssm_path:
        # Check if service exists under NSSM
        check = subprocess.run(
            [nssm_path, "status", SERVICE_NAME],
            capture_output=True, text=True,
        )
        if check.returncode == 0:
            _uninstall_nssm(nssm_path)
            return

    # Try Task Scheduler regardless (might have been installed that way)
    result = subprocess.run(
        ["schtasks", "/query", "/tn", SERVICE_NAME],
        capture_output=True, text=True,
    )
    if result.returncode == 0:
        _uninstall_task_scheduler()
        return

    print(f"No service or scheduled task named '{SERVICE_NAME}' found.")
    print("Nothing to uninstall.")


if __name__ == "__main__":
    main()
