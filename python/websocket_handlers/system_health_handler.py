"""
System Health WebSocket Handler for Agent Zero
"""
from __future__ import annotations
import asyncio
import logging
from datetime import datetime
from typing import Any

from helpers.ws import WsHandler

logger = logging.getLogger(__name__)

class SystemHealthHandler(WsHandler):
    """Handler for /system_health WebSocket namespace."""

    @classmethod
    def requires_auth(cls) -> bool:
        return False

    @classmethod
    def requires_csrf(cls) -> bool:
        return False

    async def process(self, event: str, data: dict, sid: str) -> dict | None:
        if event == "system_health_request":
            return await self._collect_health_stats()
        return {"subscribed": True}

    async def on_connect(self, sid: str) -> None:
        logger.info(f"System health client connected: {sid}")
        stats = await self._collect_health_stats()
        await self.emit_to(sid, "system_health_push", stats)

    async def on_disconnect(self, sid: str) -> None:
        logger.info(f"System health client disconnected: {sid}")

    async def _collect_health_stats(self) -> dict[str, Any]:
        try:
            from python.helpers.vram_guard import get_vram_guard
            vram_guard = get_vram_guard()
            vram_usage = await vram_guard.check_vram_async()
            vram_percent = (vram_usage / 4096) * 100
            return {
                "vram": {"usage_mb": vram_usage, "usage_percent": vram_percent, "threshold_mb": 3200},
                "workers": {"active": 0, "max": 4},
                "cache": {"hit_rate": 0, "hits": 0, "misses": 0, "size": 0},
                "timestamp": datetime.utcnow().isoformat()
            }
        except Exception as e:
            logger.error(f"Error collecting health stats: {e}")
            return {
                "vram": {"usage_mb": 0, "usage_percent": 0, "threshold_mb": 3200},
                "workers": {"active": 0, "max": 4},
                "cache": {"hit_rate": 0, "hits": 0, "misses": 0, "size": 0},
                "timestamp": datetime.utcnow().isoformat()
            }
