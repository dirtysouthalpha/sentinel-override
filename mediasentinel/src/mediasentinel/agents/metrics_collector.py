import time
from datetime import datetime
from pathlib import Path
from typing import Optional

from loguru import logger

from mediasentinel.config.models import AppConfig
from mediasentinel.db.connection import get_db


class MetricsCollector:
    def __init__(self, config: AppConfig, db_path: Path):
        self.config = config
        self._db_path = db_path
        self._last_vpn_state: Optional[str] = None

    async def record(
        self,
        metric_type: str,
        metric_name: str,
        value: float,
        unit: str = "",
    ) -> None:
        async with get_db(self._db_path) as db:
            await db.execute(
                "INSERT INTO metrics (metric_type, metric_name, value, unit, recorded_at) VALUES (?, ?, ?, ?, ?)",
                (metric_type, metric_name, value, unit, datetime.now().isoformat()),
            )
            await db.commit()

    async def record_service_response(self, service_name: str, response_ms: float) -> None:
        await self.record("response_time", service_name, response_ms, "ms")

    async def record_service_status(self, service_name: str, status: str) -> None:
        status_map = {"healthy": 1.0, "degraded": 0.5, "unhealthy": 0.0, "unknown": -1.0}
        await self.record("service_status", service_name, status_map.get(status, -1.0))

    async def record_vpn_state(self, state: str) -> None:
        state_map = {"connected": 1.0, "connecting": 0.5, "disconnected": 0.0, "degraded": 0.3}
        if state != self._last_vpn_state:
            await self.record("vpn_state", "vpn", state_map.get(state, 0.0))
            self._last_vpn_state = state

    async def record_recovery(self, service_name: str, success: bool) -> None:
        await self.record("recovery", service_name, 1.0 if success else 0.0)

    async def record_download_throughput(
        self,
        download_bytes_per_sec: float,
        upload_bytes_per_sec: float,
        active_torrents: int,
    ) -> None:
        """Record download throughput metrics (MET-03).

        Stores three metrics: download speed, upload speed, and active torrent count.
        All three share the same timestamp for correlation.
        """
        ts = datetime.now().isoformat()
        async with get_db(self._db_path) as db:
            await db.execute(
                "INSERT INTO metrics (metric_type, metric_name, value, unit, recorded_at) VALUES (?, ?, ?, ?, ?)",
                ("download_throughput", "download_speed", download_bytes_per_sec, "bytes/s", ts),
            )
            await db.execute(
                "INSERT INTO metrics (metric_type, metric_name, value, unit, recorded_at) VALUES (?, ?, ?, ?, ?)",
                ("download_throughput", "upload_speed", upload_bytes_per_sec, "bytes/s", ts),
            )
            await db.execute(
                "INSERT INTO metrics (metric_type, metric_name, value, unit, recorded_at) VALUES (?, ?, ?, ?, ?)",
                ("download_throughput", "active_torrents", float(active_torrents), "count", ts),
            )
            await db.commit()

    async def get_throughput_history(self, hours: int = 24) -> list[dict]:
        """Return historical download speeds for the last N hours (MET-03).

        Returns list of dicts with keys: download_speed, upload_speed, active_torrents,
        recorded_at. Only returns entries where all three metrics share the same timestamp.
        """
        from datetime import timedelta

        cutoff = (datetime.now() - timedelta(hours=hours)).isoformat()

        async with get_db(self._db_path) as db:
            cursor = await db.execute(
                "SELECT value, recorded_at FROM metrics "
                "WHERE metric_type = 'download_throughput' AND metric_name = 'download_speed' "
                "AND recorded_at > ? "
                "ORDER BY recorded_at DESC",
                (cutoff,),
            )
            dl_rows = await cursor.fetchall()

            results = []
            for row in dl_rows:
                ts = row["recorded_at"]
                entry = {
                    "download_speed": row["value"],
                    "recorded_at": ts,
                }

                # Get matching upload speed
                cursor2 = await db.execute(
                    "SELECT value FROM metrics "
                    "WHERE metric_type = 'download_throughput' AND metric_name = 'upload_speed' "
                    "AND recorded_at = ? LIMIT 1",
                    (ts,),
                )
                up_row = await cursor2.fetchone()
                entry["upload_speed"] = up_row["value"] if up_row else 0.0

                # Get matching active torrents
                cursor3 = await db.execute(
                    "SELECT value FROM metrics "
                    "WHERE metric_type = 'download_throughput' AND metric_name = 'active_torrents' "
                    "AND recorded_at = ? LIMIT 1",
                    (ts,),
                )
                at_row = await cursor3.fetchone()
                entry["active_torrents"] = int(at_row["value"]) if at_row else 0

                results.append(entry)

        return results

    async def detect_throttling(self, speed_profile_bytes: int) -> Optional[float]:
        """Detect ISP/VPN bandwidth throttling (MET-05).

        Compares the average download throughput of the last N readings against
        the configured speed profile. If average is below 50% of the profile,
        returns the throttle percentage. Otherwise returns None.

        Args:
            speed_profile_bytes: The expected download speed in bytes/sec from the speed profile.

        Returns:
            Throttle percentage (e.g. 0.35 means 35% of expected) if throttling detected,
            None if not throttled or insufficient data.
        """
        window = self.config.alerts.throttle_detection_window
        threshold_fraction = 0.50

        async with get_db(self._db_path) as db:
            cursor = await db.execute(
                "SELECT value FROM metrics "
                "WHERE metric_type = 'download_throughput' AND metric_name = 'download_speed' "
                "ORDER BY recorded_at DESC LIMIT ?",
                (window,),
            )
            rows = await cursor.fetchall()

        if len(rows) < window:
            logger.bind(component="MetricsCollector").debug(
                "Throttling detection: insufficient data ({}/{})",
                len(rows), window,
            )
            return None

        values = [row["value"] for row in rows]
        avg_throughput = sum(values) / len(values)

        if speed_profile_bytes <= 0:
            return None

        ratio = avg_throughput / speed_profile_bytes

        if ratio < threshold_fraction:
            throttle_pct = round(ratio * 100, 1)
            logger.bind(component="MetricsCollector").warning(
                "Bandwidth throttling detected: avg={:.0f} bytes/s vs profile={} bytes/s ({:.1f}% of expected)",
                avg_throughput, speed_profile_bytes, throttle_pct,
            )
            return throttle_pct

        return None

    async def get_latest(
        self,
        metric_type: str,
        metric_name: str,
        limit: int = 100,
    ) -> list[dict]:
        async with get_db(self._db_path) as db:
            cursor = await db.execute(
                "SELECT value, unit, recorded_at FROM metrics "
                "WHERE metric_type = ? AND metric_name = ? "
                "ORDER BY recorded_at DESC LIMIT ?",
                (metric_type, metric_name, limit),
            )
            rows = await cursor.fetchall()
        return [
            {"value": row["value"], "unit": row["unit"], "recorded_at": row["recorded_at"]}
            for row in rows
        ]

    async def get_service_uptime(self, service_name: str, hours: int = 24) -> float:
        cutoff = datetime.now().timestamp() - (hours * 3600)
        async with get_db(self._db_path) as db:
            cursor = await db.execute(
                "SELECT value FROM metrics "
                "WHERE metric_type = 'service_status' AND metric_name = ? "
                "AND recorded_at > datetime(?, 'unixepoch') "
                "ORDER BY recorded_at DESC",
                (service_name, cutoff),
            )
            rows = await cursor.fetchall()
        if not rows:
            return 0.0
        healthy_count = sum(1 for r in rows if r["value"] == 1.0)
        return healthy_count / len(rows) * 100.0

    async def collect_system_metrics(self) -> dict:
        import psutil

        cpu = psutil.cpu_percent(interval=0.1)
        mem = psutil.virtual_memory()
        disk = psutil.disk_usage("/")

        metrics = {
            "cpu_percent": cpu,
            "memory_percent": mem.percent,
            "memory_available_gb": round(mem.available / (1024**3), 2),
            "disk_percent": disk.percent,
            "disk_free_gb": round(disk.free / (1024**3), 2),
        }

        for name, value in metrics.items():
            unit = "%" if "percent" in name else "GB" if "gb" in name else ""
            await self.record("system", name, value, unit)

        return metrics
