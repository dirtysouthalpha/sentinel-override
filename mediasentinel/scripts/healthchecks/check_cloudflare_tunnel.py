"""Health check for Cloudflare Tunnel connectivity.

Verifies that the tunnel's public URL is reachable and returns a healthy status.
Also performs a basic DNS resolution check as part of the URL fetch.
"""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from check_service import check, exit_for_status

SERVICE_NAME = "cloudflare-tunnel"


def main():
    if len(sys.argv) < 2:
        print(json.dumps({"error": f"Usage: check_{SERVICE_NAME}.py <url>"}))
        sys.exit(1)

    url = sys.argv[1].rstrip("/")
    # Check the root URL -- a 200-399 response means tunnel is routing traffic
    result = check(url, SERVICE_NAME)

    print(json.dumps(result))
    sys.exit(exit_for_status(result["status"]))


if __name__ == "__main__":
    main()
