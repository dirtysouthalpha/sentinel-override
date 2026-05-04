"""Health check wrapper base for MediaSentinel services (DEP-04).

Provides shared check logic that individual service health check scripts import.

Usage (as standalone):
    python check_service.py <service_name> <url>

Usage (as module):
    from check_service import check

Each check returns JSON with:
    - service: name of the service
    - status: healthy | degraded | unhealthy
    - response_time_ms: round-trip time in milliseconds
    - status_code: HTTP status code (or null on connection failure)
    - timestamp: ISO 8601 UTC timestamp

Exit codes: 0 = healthy, 1 = degraded, 2 = unhealthy
"""
import json
import sys
import time
from datetime import datetime, timezone

import httpx


def check(url: str, name: str = "unknown", timeout: float = 10.0) -> dict:
    """Perform a health check against the given URL.

    Args:
        url: The HTTP(S) URL to check.
        name: Service name for the output JSON.
        timeout: Request timeout in seconds.

    Returns:
        dict with service, status, response_time_ms, status_code, timestamp.
    """
    start = time.monotonic()
    timestamp = datetime.now(timezone.utc).isoformat()
    try:
        resp = httpx.get(url, timeout=timeout, follow_redirects=True)
        elapsed = round((time.monotonic() - start) * 1000, 1)
        if 200 <= resp.status_code < 400:
            status = "healthy"
        else:
            status = "degraded"
        return {
            "service": name,
            "status": status,
            "response_time_ms": elapsed,
            "status_code": resp.status_code,
            "timestamp": timestamp,
        }
    except Exception as e:
        elapsed = round((time.monotonic() - start) * 1000, 1)
        return {
            "service": name,
            "status": "unhealthy",
            "response_time_ms": elapsed,
            "status_code": None,
            "error": str(e),
            "timestamp": timestamp,
        }


def exit_for_status(status: str) -> int:
    """Map status string to exit code."""
    return {"healthy": 0, "degraded": 1}.get(status, 2)


if __name__ == "__main__":
    if len(sys.argv) < 3:
        print(json.dumps({"error": "Usage: check_service.py <name> <url>"}))
        sys.exit(1)
    result = check(sys.argv[2], sys.argv[1])
    print(json.dumps(result))
    sys.exit(exit_for_status(result["status"]))
