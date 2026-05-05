import asyncio
from datetime import datetime, timedelta
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
        try:
            async with get_db(self._db_path) as db:
                await db.execute(
                    "INSERT INTO metrics (metric_type, metric_name, value, unit, recorded_at) VALUES (?, ?, ?, ?, ?)",
                    (metric_type, metric_name, value, unit, datetime.now().isoformat()),
                )
                await db.commit()
        except Exception as e:
            logger.bind(component="MetricsCollector").error(
                "Failed to record metric {}/{}: {}", metric_type, metric_name, e
            )

    async def record_batch(self, records: list[tuple[str, str, float, str]]) -> None:
        """Insert multiple metrics in a single connection/transaction."""
        if not records:
            return
        ts = datetime.now().isoformat()
        rows = [(mt, mn, v, u, ts) for mt, mn, v, u in records]
        try:
            async with get_db(self._db_path) as db:
                await db.executemany(
                    "INSERT INTO metrics (metric_type, metric_name, value, unit, recorded_at) VALUES (?, ?, ?, ?, ?)",
                    rows,
                )
                await db.commit()
        except Exception as e:
            logger.bind(component="MetricsCollector").error(
                "Failed to record batch of {} metrics: {}", len(records), e
            )

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
        ts = datetime.now().isoformat()
        async with get_db(self._db_path) as db:
            await db.executemany(
                "INSERT INTO metrics (metric_type, metric_name, value, unit, recorded_at) VALUES (?, ?, ?, ?, ?)",
                [
                    ("download_throughput", "download_speed", download_bytes_per_sec, "bytes/s", ts),
                    ("download_throughput", "upload_speed", upload_bytes_per_sec, "bytes/s", ts),
                    ("download_throughput", "active_torrents", float(active_torrents), "count", ts),
                ],
            )
            await db.commit()

    async def get_throughput_history(self, hours: int = 24) -> list[dict]:
        """Return historical download speeds for the last N hours.

        Uses a single pivot query instead of N+1 per-row lookups.
        """
        cutoff = (datetime.now() - timedelta(hours=hours)).isoformat()

        async with get_db(self._db_path) as db:
            cursor = await db.execute(
                "SELECT recorded_at, "
                "MAX(CASE WHEN metric_name='download_speed' THEN value END) AS dl, "
                "MAX(CASE WHEN metric_name='upload_speed' THEN value END) AS ul, "
                "MAX(CASE WHEN metric_name='active_torrents' THEN value END) AS at "
                "FROM metrics "
                "WHERE metric_type = 'download_throughput' AND recorded_at > ? "
                "GROUP BY recorded_at "
                "ORDER BY recorded_at DESC",
                (cutoff,),
            )
            rows = await cursor.fetchall()

        return [
            {
                "download_speed": r["dl"] or 0.0,
                "upload_speed": r["ul"] or 0.0,
                "active_torrents": int(r["at"] or 0),
                "recorded_at": r["recorded_at"],
            }
            for r in rows
        ]

    async def detect_throttling(self, speed_profile_bytes: int) -> Optional[float]:
        """Detect ISP/VPN bandwidth throttling using SQL-side aggregation."""
        window = self.config.alerts.throttle_detection_window
        threshold_fraction = 0.50

        async with get_db(self._db_path) as db:
            cursor = await db.execute(
                "SELECT AVG(value) AS avg_val, COUNT(*) AS cnt FROM ("
                "  SELECT value FROM metrics "
                "  WHERE metric_type = 'download_throughput' AND metric_name = 'download_speed' "
                "  ORDER BY recorded_at DESC LIMIT ?"
                ")",
                (window,),
            )
            row = await cursor.fetchone()

        if not row or row["cnt"] < window:
            return None

        avg_throughput = row["avg_val"]

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
        cutoff = (datetime.now() - timedelta(hours=hours)).isoformat()
        async with get_db(self._db_path) as db:
            cursor = await db.execute(
                "SELECT "
                "SUM(CASE WHEN value = 1.0 THEN 1 ELSE 0 END) * 100.0 / COUNT(*) AS uptime_pct "
                "FROM metrics "
                "WHERE metric_type = 'service_status' AND metric_name = ? "
                "AND recorded_at > ?",
                (service_name, cutoff),
            )
            row = await cursor.fetchone()
        if not row or row["uptime_pct"] is None:
            return 0.0
        return row["uptime_pct"]

    async def collect_system_metrics(self) -> dict:
        import psutil

        cpu, mem, disk = await asyncio.to_thread(lambda: (
            psutil.cpu_percent(interval=0.1),
            psutil.virtual_memory(),
            psutil.disk_usage("/"),
        ))

        metrics = {
            "cpu_percent": cpu,
            "memory_percent": mem.percent,
            "memory_available_gb": round(mem.available / (1024**3), 2),
            "disk_percent": disk.percent,
            "disk_free_gb": round(disk.free / (1024**3), 2),
        }

        records = [
            ("system", name, value, "%" if "percent" in name else "GB" if "gb" in name else "")
            for name, value in metrics.items()
        ]
        await self.record_batch(records)

        return metrics
