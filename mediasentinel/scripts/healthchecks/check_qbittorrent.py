"""Health check for qBittorrent torrent client."""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from check_service import check, exit_for_status

SERVICE_NAME = "qbittorrent"
# qBittorrent WebUI /api/v2/app/version returns version string without auth
DEFAULT_HEALTH_PATH = "/api/v2/app/version"


def main():
    if len(sys.argv) < 2:
        print(json.dumps({"error": f"Usage: check_{SERVICE_NAME}.py <url>"}))
        sys.exit(1)

    url = sys.argv[1].rstrip("/")
    health_url = f"{url}{DEFAULT_HEALTH_PATH}"
    result = check(health_url, SERVICE_NAME)

    print(json.dumps(result))
    sys.exit(exit_for_status(result["status"]))


if __name__ == "__main__":
    main()
