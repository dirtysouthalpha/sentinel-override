import asyncio
import time
from datetime import datetime
from pathlib import Path
from typing import Optional

import httpx
from loguru import logger

from mediasentinel.agents.models import HealthResult, HealthStatus
from mediasentinel.config.models import AppConfig, ServiceConfig
from mediasentinel.db.connection import get_db


class HealthMonitor:
    def __init__(self, config: AppConfig, db_path: Path):
        self.config = config
        self.db_path = db_path
        self.client = httpx.AsyncClient(timeout=10.0)
        self._failure_counts: dict[str, int] = {}

    async def close(self):
        await self.client.aclose()

    def get_failure_count(self, service_name: str) -> int:
        return self._failure_counts.get(service_name, 0)

    async def check_service(self, service: ServiceConfig) -> HealthResult:
        log = logger.bind(component="HealthMonitor", action="check", service=service.name)
        start = time.monotonic()
        try:
            resp = await self.client.get(service.url, follow_redirects=True)
            elapsed_ms = (time.monotonic() - start) * 1000

            if 200 <= resp.status_code < 400:
                status = HealthStatus.HEALTHY
                version = self._extract_version(resp)
                self._failure_counts[service.name] = 0
                log.info("healthy", response_time_ms=round(elapsed_ms, 1), status_code=resp.status_code)
            elif 400 <= resp.status_code < 500:
                status = HealthStatus.DEGRADED
                version = self._extract_version(resp)
                # Auth errors still increment failure counter to allow recovery
                if resp.status_code in (401, 403):
                    self._failure_counts[service.name] = self._failure_counts.get(service.name, 0) + 1
                else:
                    self._failure_counts[service.name] = 0
                log.warning("degraded", status_code=resp.status_code)
            else:
                status = HealthStatus.UNHEALTHY
                version = None
                self._failure_counts[service.name] = self._failure_counts.get(service.name, 0) + 1
                log.error("unhealthy", status_code=resp.status_code)

            result = HealthResult(
                service_name=service.name,
                status=status,
                response_time_ms=round(elapsed_ms, 1),
                version=version,
                details=f"HTTP {resp.status_code}",
                checked_at=datetime.now(),
            )
        except httpx.RequestError as e:
            elapsed_ms = (time.monotonic() - start) * 1000
            self._failure_counts[service.name] = self._failure_counts.get(service.name, 0) + 1
            log.error("unhealthy", error=str(e))

            result = HealthResult(
                service_name=service.name,
                status=HealthStatus.UNHEALTHY,
                response_time_ms=round(elapsed_ms, 1),
                details=str(e),
                checked_at=datetime.now(),
            )

        await self._record_result(service, result)
        return result

    async def check_all(self) -> list[HealthResult]:
        return await asyncio.gather(*(self.check_service(s) for s in self.config.services))

    def exceeds_threshold(self, service: ServiceConfig) -> bool:
        return self._failure_counts.get(service.name, 0) >= service.failure_threshold

    async def _record_result(self, service: ServiceConfig, result: HealthResult):
        try:
            async with get_db(self.db_path) as db:
                await db.execute(
                    "INSERT INTO health_checks (service_name, status, response_time_ms, details) VALUES (?, ?, ?, ?)",
                    (result.service_name, result.status.value, result.response_time_ms, result.details),
                )
                await db.execute(
                    "UPDATE services SET status = ?, last_check_at = ?, response_time_ms = ?, version = ?, consecutive_failures = ? WHERE name = ?",
                    (
                        result.status.value,
                        result.checked_at.isoformat(),
                        result.response_time_ms,
                        result.version,
                        self._failure_counts.get(service.name, 0),
                        service.name,
                    ),
                )
                await db.commit()
        except Exception as e:
            logger.bind(component="HealthMonitor").error("Failed to record result: {}", e)

    @staticmethod
    def _extract_version(resp: httpx.Response) -> Optional[str]:
        version = resp.headers.get("X-Application-Version")
        if version:
            return version
        try:
            data = resp.json()
            if isinstance(data, dict):
                for key in ("version", "Version", "app_version"):
                    if key in data:
                        return str(data[key])
        except Exception as e:
            logger.bind(component="HealthMonitor").debug("Version extraction failed: {}", e)
        return None
