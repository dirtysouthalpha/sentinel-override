"""State snapshot capture for pre-recovery rollback support (REC-04).

Captures a point-in-time view of the system state before any Level 2+
recovery action, stored as JSON in the state_snapshots table.
"""

import json
from datetime import datetime
from pathlib import Path
from typing import Any, Optional

from loguru import logger

from mediasentinel.agents.models import VPNState
from mediasentinel.config.models import AppConfig
from mediasentinel.db.connection import get_db


async def capture_snapshot(
    db_path: Path,
    config: AppConfig,
    vpn_status: Optional[dict] = None,
    qbt_controller=None,
) -> dict[str, Any]:
    """Capture current system state as a snapshot dict.

    Collects: service statuses, VPN state, active downloads, config summary.
    Accepts an optional qbt_controller to reuse its existing connection instead
    of creating a new one (IN-02).
    """
    snapshot: dict[str, Any] = {
        "captured_at": datetime.now().isoformat(),
        "services": [],
        "vpn": vpn_status or {"state": "unknown"},
        "config_summary": {
            "service_count": len(config.services),
            "service_names": [s.name for s in config.services],
            "tunnel_count": len(config.tunnels),
            "tunnel_names": [t.tunnel_name for t in config.tunnels],
        },
    }

    try:
        async with get_db(db_path) as db:
            cursor = await db.execute(
                "SELECT name, url, status, consecutive_failures, last_check_at "
                "FROM services"
            )
            rows = await cursor.fetchall()
            for row in rows:
                snapshot["services"].append({
                    "name": row["name"],
                    "url": row["url"],
                    "status": row["status"],
                    "consecutive_failures": row["consecutive_failures"],
                    "last_check_at": row["last_check_at"],
                })
    except Exception as e:
        logger.bind(component="Snapshot").error(
            "Failed to capture service states: {}", e
        )

    # Attempt to capture active downloads from qBittorrent
    try:
        if qbt_controller is not None:
            # Reuse existing controller connection
            stats = qbt_controller.get_download_stats()
            snapshot["active_download_stats"] = stats
            snapshot["active_download_count"] = stats.get("active_torrents", 0)
        else:
            # Fallback: create a temporary connection
            import os
            import qbittorrentapi

            password = os.environ.get(config.qbt.password_env, "")
            client = qbittorrentapi.Client(
                host=config.qbt.host,
                username=config.qbt.username,
                password=password,
            )
            client.auth_log_in()
            torrents = client.torrents_info()
            active = [
                {
                    "name": t.name,
                    "hash": t.hash,
                    "state": t.state,
                    "progress": round(t.progress, 4),
                }
                for t in torrents
                if t.state.lower() not in ("paused", "stopped", "queued")
            ]
            snapshot["active_downloads"] = active
            snapshot["active_download_count"] = len(active)
            try:
                client.auth_log_out()
            except Exception:
                pass
    except Exception:
        # qBittorrent may be unreachable — that is fine for a snapshot
        snapshot["active_downloads"] = []
        snapshot["active_download_count"] = 0

    return snapshot


async def save_snapshot(
    db_path: Path,
    snapshot_data: dict[str, Any],
    snapshot_type: str = "pre_recovery",
) -> int:
    """Persist a snapshot dict into the state_snapshots table.

    Returns the row id of the inserted snapshot.
    """
    json_data = json.dumps(snapshot_data, default=str)
    try:
        async with get_db(db_path) as db:
            cursor = await db.execute(
                "INSERT INTO state_snapshots (snapshot_type, snapshot_data, created_at) "
                "VALUES (?, ?, ?)",
                (snapshot_type, json_data, datetime.now().isoformat()),
            )
            await db.commit()
            row_id = cursor.lastrowid
            logger.bind(component="Snapshot").info(
                "Saved {} snapshot (id={})", snapshot_type, row_id
            )
            return row_id or 0
    except Exception as e:
        logger.bind(component="Snapshot").error(
            "Failed to save snapshot: {}", e
        )
        return 0


async def load_latest_snapshot(
    db_path: Path,
    snapshot_type: Optional[str] = None,
) -> Optional[dict[str, Any]]:
    """Load the most recent snapshot, optionally filtered by type.

    Returns None if no snapshots exist.
    """
    try:
        async with get_db(db_path) as db:
            if snapshot_type:
                cursor = await db.execute(
                    "SELECT snapshot_data FROM state_snapshots "
                    "WHERE snapshot_type = ? ORDER BY created_at DESC LIMIT 1",
                    (snapshot_type,),
                )
            else:
                cursor = await db.execute(
                    "SELECT snapshot_data FROM state_snapshots "
                    "ORDER BY created_at DESC LIMIT 1"
                )
            row = await cursor.fetchone()
            if row:
                return json.loads(row["snapshot_data"])
            return None
    except Exception as e:
        logger.bind(component="Snapshot").error(
            "Failed to load snapshot: {}", e
        )
        return None
