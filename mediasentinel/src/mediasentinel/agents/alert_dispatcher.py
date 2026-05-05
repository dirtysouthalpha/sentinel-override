import asyncio
import os
from datetime import datetime
from enum import Enum
from pathlib import Path
from typing import Optional

import httpx
from loguru import logger

from mediasentinel.config.models import AlertConfig


class AlertSeverity(str, Enum):
    """4-tier alert severity with routing rules (ALT-01)."""
    INFO = "info"
    WARNING = "warning"
    CRITICAL = "critical"
    EMERGENCY = "emergency"


# Recovery suggestions keyed by common alert patterns
_RECOVERY_SUGGESTIONS = {
    "vpn": "Verify VPN adapter is active. Check VPN provider status. MediaSentinel will attempt automatic VPN recovery.",
    "service": "Check Docker container logs: docker logs <container>. MediaSentinel will attempt container restart.",
    "throttle": "ISP may be throttling traffic. Consider switching VPN server or protocol. Verify speed profile settings.",
    "default": "Investigate the affected service. Check system resources and network connectivity.",
}


class AlertDispatcher:
    def __init__(self, config: AlertConfig):
        self.config = config
        self._client = httpx.AsyncClient(timeout=10.0)
        # Track active emergencies for repeat logic (ALT-04)
        self._active_emergencies: dict[str, datetime] = {}
        self._emergency_tasks: dict[str, asyncio.Task] = {}

    async def close(self):
        # Cancel all emergency repeat tasks
        for service_name, task in list(self._emergency_tasks.items()):
            task.cancel()
            try:
                await task
            except asyncio.CancelledError:
                pass
        self._emergency_tasks.clear()
        self._active_emergencies.clear()
        await self._client.aclose()

    async def send_alert(
        self,
        title: str,
        message: str,
        severity: str = "warning",
        service_name: Optional[str] = None,
        diagnostic_context: Optional[dict] = None,
    ) -> bool:
        """Send an alert with 4-tier severity routing.

        INFO:      log only (no external notifications)
        WARNING:   log + notification (webhook/email)
        CRITICAL:  log + notification + recovery suggestion
        EMERGENCY: all channels + repeat every N seconds until cleared
        """
        sev = self._normalize_severity(severity)
        log = logger.bind(component="AlertDispatcher", severity=sev.value)

        # INFO severity: log only, no external notifications
        if sev == AlertSeverity.INFO:
            log.info("Alert (info only): {}", title)
            return True

        # Build payload with optional diagnostic context (ALT-03)
        payload_extras = {}
        if diagnostic_context:
            payload_extras["diagnostic"] = diagnostic_context

        # Add recovery suggestion for CRITICAL
        if sev == AlertSeverity.CRITICAL:
            suggestion = self._get_recovery_suggestion(title, message, service_name)
            payload_extras["recovery_suggestion"] = suggestion

        results = []
        if self.config.webhook_urls:
            tasks = [
                self._send_webhook(url, title, message, sev.value, service_name, payload_extras)
                for url in self.config.webhook_urls
            ]
            results.extend(await asyncio.gather(*tasks))

        if self.config.smtp_host and self.config.to_addresses:
            ok = await self._send_email(
                title, message, sev.value, service_name, payload_extras
            )
            results.append(ok)

        if not results:
            log.debug("No alert channels configured, skipping alert: {}", title)
            return True

        success = all(results)
        if success:
            log.info("Alert sent: {}", title)
        else:
            log.error("Some alert deliveries failed for: {}", title)

        # EMERGENCY: start repeat loop if not already active
        if sev == AlertSeverity.EMERGENCY and service_name:
            self._start_emergency_repeat(title, message, service_name, diagnostic_context)

        return success

    def clear_emergency(self, service_name: str) -> bool:
        """Stop repeating emergency alerts for a service (ALT-04)."""
        if service_name not in self._active_emergencies:
            return False

        del self._active_emergencies[service_name]
        task = self._emergency_tasks.pop(service_name, None)
        if task and not task.done():
            task.cancel()

        logger.bind(component="AlertDispatcher").info(
            "Emergency alert cleared for: {}", service_name
        )
        return True

    def is_emergency_active(self, service_name: str) -> bool:
        """Check if emergency alerts are active for a service."""
        return service_name in self._active_emergencies

    async def _emergency_repeat_loop(
        self,
        title: str,
        message: str,
        service_name: str,
        diagnostic_context: Optional[dict],
    ) -> None:
        """Repeat emergency alerts at configured interval until cleared."""
        interval = self.config.emergency_repeat_interval_seconds
        log = logger.bind(component="AlertDispatcher", action="emergency_repeat")

        try:
            while service_name in self._active_emergencies:
                await asyncio.sleep(interval)
                if service_name not in self._active_emergencies:
                    break
                log.warning("Repeating emergency alert for: {}", service_name)
                await self._send_to_all_channels(
                    title, message, "emergency", service_name, diagnostic_context
                )
        except asyncio.CancelledError:
            pass

    def _start_emergency_repeat(
        self,
        title: str,
        message: str,
        service_name: str,
        diagnostic_context: Optional[dict],
    ) -> None:
        """Start the emergency repeat task for a service."""
        if service_name in self._emergency_tasks:
            return  # Already repeating

        self._active_emergencies[service_name] = datetime.now()
        task = asyncio.create_task(
            self._emergency_repeat_loop(title, message, service_name, diagnostic_context)
        )
        self._emergency_tasks[service_name] = task

    async def _send_to_all_channels(
        self,
        title: str,
        message: str,
        severity: str,
        service_name: str,
        payload_extras: Optional[dict] = None,
    ) -> bool:
        """Send to all configured channels (used by emergency repeat)."""
        extras = payload_extras or {}
        results = []
        if self.config.webhook_urls:
            for url in self.config.webhook_urls:
                ok = await self._send_webhook(url, title, message, severity, service_name, extras)
                results.append(ok)
        if self.config.smtp_host and self.config.to_addresses:
            ok = await self._send_email(title, message, severity, service_name, extras)
            results.append(ok)
        return all(results) if results else True

    def _normalize_severity(self, severity: str) -> AlertSeverity:
        """Map string severity to AlertSeverity enum.

        Accepts legacy values like 'error' and maps them to the 4-tier system.
        """
        severity_lower = severity.lower().strip()
        mapping = {
            "info": AlertSeverity.INFO,
            "warning": AlertSeverity.WARNING,
            "warn": AlertSeverity.WARNING,
            "critical": AlertSeverity.CRITICAL,
            "error": AlertSeverity.CRITICAL,
            "emergency": AlertSeverity.EMERGENCY,
            "fatal": AlertSeverity.EMERGENCY,
        }
        return mapping.get(severity_lower, AlertSeverity.WARNING)

    def _get_recovery_suggestion(
        self,
        title: str,
        message: str,
        service_name: Optional[str],
    ) -> str:
        """Derive a recovery suggestion from the alert context."""
        text = f"{title} {message}".lower()
        if "vpn" in text:
            return _RECOVERY_SUGGESTIONS["vpn"]
        if "throttle" in text or "bandwidth" in text:
            return _RECOVERY_SUGGESTIONS["throttle"]
        if service_name or "service" in text:
            return _RECOVERY_SUGGESTIONS["service"]
        return _RECOVERY_SUGGESTIONS["default"]

    async def _send_webhook(
        self,
        url: str,
        title: str,
        message: str,
        severity: str,
        service_name: Optional[str],
        payload_extras: Optional[dict] = None,
    ) -> bool:
        payload = {
            "title": title,
            "message": message,
            "severity": severity,
            "service": service_name,
            "timestamp": datetime.now().isoformat(),
            "source": "MediaSentinel",
        }
        if payload_extras:
            payload.update(payload_extras)
        try:
            resp = await self._client.post(url, json=payload)
            if 200 <= resp.status_code < 300:
                return True
            logger.bind(component="AlertDispatcher").error(
                "Webhook {} returned {}", url, resp.status_code
            )
            return False
        except Exception as e:
            logger.bind(component="AlertDispatcher").error("Webhook {} failed: {}", url, e)
            return False

    async def _send_email(
        self,
        title: str,
        message: str,
        severity: str,
        service_name: Optional[str],
        payload_extras: Optional[dict] = None,
    ) -> bool:
        import smtplib
        from email.mime.text import MIMEText

        password = os.environ.get(self.config.smtp_password_env, "")
        if not password:
            logger.bind(component="AlertDispatcher").warning("Email password not set, skipping email alert")
            return False

        try:
            body_lines = [
                "MediaSentinel Alert",
                "",
                f"Severity: {severity.upper()}",
                f"Service: {service_name or 'N/A'}",
                f"Time: {datetime.now().isoformat()}",
                "",
                message,
            ]
            if payload_extras:
                if "recovery_suggestion" in payload_extras:
                    body_lines.append("")
                    body_lines.append(f"Recovery Suggestion: {payload_extras['recovery_suggestion']}")
                if "diagnostic" in payload_extras:
                    body_lines.append("")
                    body_lines.append("--- Diagnostic Context ---")
                    diag = payload_extras["diagnostic"]
                    if "service_states" in diag:
                        body_lines.append("Service States:")
                        for svc, status in diag["service_states"].items():
                            body_lines.append(f"  {svc}: {status}")
                    if "vpn_status" in diag:
                        body_lines.append(f"VPN Status: {diag['vpn_status']}")
                    if "recent_recoveries" in diag:
                        body_lines.append("Recent Recoveries:")
                        for rec in diag["recent_recoveries"]:
                            body_lines.append(f"  {rec}")
                    if "system_resources" in diag:
                        res = diag["system_resources"]
                        body_lines.append(f"System Resources: CPU={res.get('cpu_percent', 'N/A')}%, RAM={res.get('memory_percent', 'N/A')}%, Disk={res.get('disk_percent', 'N/A')}%")

            msg = MIMEText("\n".join(body_lines))
            msg["Subject"] = f"[MediaSentinel] {title}"
            msg["From"] = self.config.from_address
            msg["To"] = ", ".join(self.config.to_addresses)

            def _send_smtp():
                with smtplib.SMTP(self.config.smtp_host, self.config.smtp_port) as server:
                    server.starttls()
                    server.login(self.config.smtp_user, password)
                    server.send_message(msg)

            await asyncio.to_thread(_send_smtp)
            return True
        except Exception as e:
            logger.bind(component="AlertDispatcher").error("Email alert failed: {}", e)
            return False


async def build_diagnostic_context(
    db_path: Path,
    service_name: Optional[str] = None,
) -> dict:
    """Build a diagnostic context dict by querying the database (ALT-03).

    Returns a JSON-serializable dict with:
    - service_states: dict of service_name -> status
    - recent_recoveries: list of last 3 recovery event descriptions
    - vpn_status: current VPN state string
    - system_resources: CPU, RAM, disk usage from latest metrics
    """
    from mediasentinel.db.connection import get_db

    context: dict = {
        "service_states": {},
        "recent_recoveries": [],
        "vpn_status": "unknown",
        "system_resources": {},
    }

    async with get_db(db_path) as db:
        # Current service states from services table
        cursor = await db.execute("SELECT name, status FROM services")
        rows = await cursor.fetchall()
        context["service_states"] = {row["name"]: row["status"] for row in rows}

        # Recent recovery events
        cursor = await db.execute(
            "SELECT service_name, action, result, started_at FROM recovery_events "
            "ORDER BY started_at DESC LIMIT 3"
        )
        recovery_rows = await cursor.fetchall()
        context["recent_recoveries"] = [
            f"{row['service_name']}: {row['action']} ({row['result']}) at {row['started_at']}"
            for row in recovery_rows
        ]

        # Latest VPN state
        cursor = await db.execute(
            "SELECT value FROM metrics WHERE metric_type = 'vpn_state' "
            "ORDER BY recorded_at DESC LIMIT 1"
        )
        vpn_row = await cursor.fetchone()
        if vpn_row is not None:
            vpn_val = vpn_row["value"]
            state_map = {1.0: "connected", 0.5: "connecting", 0.0: "disconnected", 0.3: "degraded"}
            context["vpn_status"] = state_map.get(vpn_val, "unknown")

        # Latest system resource metrics (single query instead of 3)
        cursor = await db.execute(
            "SELECT metric_name, value FROM metrics WHERE metric_type = 'system' "
            "AND metric_name IN ('cpu_percent', 'memory_percent', 'disk_percent') "
            "AND recorded_at = ("
            "  SELECT MAX(m2.recorded_at) FROM metrics m2"
            "  WHERE m2.metric_type = 'system' AND m2.metric_name = metrics.metric_name"
            ") GROUP BY metric_name"
        )
        metric_rows = await cursor.fetchall()
        for row in metric_rows:
            context["system_resources"][row["metric_name"]] = row["value"]

    return context
