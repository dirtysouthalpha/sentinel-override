import asyncio
import os
from pathlib import Path

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.interval import IntervalTrigger
from loguru import logger

from mediasentinel.agents.alert_dispatcher import AlertDispatcher
from mediasentinel.agents.health_monitor import HealthMonitor
from mediasentinel.agents.metrics_collector import MetricsCollector
from mediasentinel.agents.models import VPNState
from mediasentinel.agents.qbt_controller import QBittorrentController
from mediasentinel.agents.recovery_engine import RecoveryEngine
from mediasentinel.agents.tunnel_guard import TunnelGuard
from mediasentinel.agents.vpn_guard import VPNGuard
from mediasentinel.config.models import AppConfig
from mediasentinel.db.connection import get_db, init_db
from mediasentinel.logging.setup import setup_logging


class Orchestrator:
    def __init__(self, config: AppConfig):
        self.config = config
        self._initialized = False
        self._shutdown_event = asyncio.Event()
        self.scheduler = AsyncIOScheduler(
            job_defaults={
                "coalesce": True,
                "max_instances": 1,
                "misfire_grace_time": 30,
            }
        )
        self.health_monitor: HealthMonitor | None = None
        self.vpn_guard: VPNGuard | None = None
        self.tunnel_guard: TunnelGuard | None = None
        self.recovery_engine: RecoveryEngine | None = None
        self.qbt_controller: QBittorrentController | None = None
        self.alert_dispatcher: AlertDispatcher | None = None
        self.metrics_collector: MetricsCollector | None = None
        self._vpn_state: VPNState = VPNState.DISCONNECTED
        self._db_path: Path | None = None

    async def initialize(self):
        if self._initialized:
            return
        setup_logging(self.config.logging)

        self._db_path = Path(os.path.expandvars(self.config.database.db_path))
        self._db_path.parent.mkdir(parents=True, exist_ok=True)
        await init_db(self._db_path)
        await self._seed_services()

        self.health_monitor = HealthMonitor(self.config, self._db_path)
        self.vpn_guard = VPNGuard(self.config.vpn)
        self.recovery_engine = RecoveryEngine(self.config, self._db_path)
        self.qbt_controller = QBittorrentController(self.config.qbt)
        self.alert_dispatcher = AlertDispatcher(self.config.alerts)
        self.metrics_collector = MetricsCollector(self.config, self._db_path)
        if self.config.tunnels:
            self.tunnel_guard = TunnelGuard(self.config.tunnels)

        logger.bind(component="Orchestrator").info("Orchestrator initialized")
        self._initialized = True

    async def start(self):
        await self.initialize()
        self._register_jobs()
        self._apply_initial_qbt_settings()
        self.scheduler.start()
        logger.bind(component="Orchestrator").info("Scheduler started")
        await self._shutdown_event.wait()

    async def shutdown(self):
        if self.health_monitor:
            await self.health_monitor.close()
        if self.vpn_guard:
            await self.vpn_guard.close()
        if self.tunnel_guard:
            await self.tunnel_guard.close()
        if self.qbt_controller:
            self.qbt_controller.close()
        if self.alert_dispatcher:
            await self.alert_dispatcher.close()
        self.scheduler.shutdown(wait=False)
        self._shutdown_event.set()
        logger.bind(component="Orchestrator").info("Orchestrator shut down")

    @property
    def vpn_state(self) -> VPNState:
        return self._vpn_state

    def _register_jobs(self):
        for service in self.config.services:
            self.scheduler.add_job(
                self._run_health_check,
                trigger=IntervalTrigger(seconds=service.poll_interval_seconds),
                id=f"health_{service.name}",
                name=f"Health check: {service.name}",
                args=[service.name],
                replace_existing=True,
            )

        self.scheduler.add_job(
            self._run_vpn_check,
            trigger=IntervalTrigger(seconds=self.config.vpn.poll_interval_seconds),
            id="vpn_check",
            name="VPN status check",
            replace_existing=True,
        )

        for tunnel in self.config.tunnels:
            self.scheduler.add_job(
                self._run_tunnel_check,
                trigger=IntervalTrigger(seconds=tunnel.poll_interval_seconds),
                id=f"tunnel_{tunnel.tunnel_name}",
                name=f"Tunnel check: {tunnel.tunnel_name}",
                args=[tunnel.tunnel_name],
                replace_existing=True,
            )

        self.scheduler.add_job(
            self._collect_system_metrics,
            trigger=IntervalTrigger(seconds=60),
            id="system_metrics",
            name="System metrics collection",
            replace_existing=True,
        )

        if self.config.qbt:
            self.scheduler.add_job(
                self._run_interface_binding_check,
                trigger=IntervalTrigger(seconds=self.config.qbt.verify_binding_interval),
                id="interface_binding_check",
                name="qBittorrent interface binding verification",
                replace_existing=True,
            )

    async def _run_health_check(self, service_name: str):
        service = next((s for s in self.config.services if s.name == service_name), None)
        if not service or not self.health_monitor:
            return

        result = await self.health_monitor.check_service(service)

        if self.metrics_collector and result:
            await self.metrics_collector.record_service_status(service_name, result.status)
            if result.response_time_ms is not None:
                await self.metrics_collector.record_service_response(service_name, result.response_time_ms)

        # Reset circuit breaker when service is healthy (REC-05)
        if result and result.status.value == "healthy" and self.recovery_engine:
            self.recovery_engine.reset_circuit_breaker(service_name)
            # Also reset attempt count so next failure starts at level 1
            if self.recovery_engine.get_attempt_count(service_name) > 0:
                self.recovery_engine.reset_attempts(service_name)

        if self.health_monitor.exceeds_threshold(service):
            log = logger.bind(component="Orchestrator")
            log.warning(
                "Service {} exceeded failure threshold ({}/{})",
                service_name,
                self.health_monitor.get_failure_count(service_name),
                service.failure_threshold,
            )

            # Check dependencies before recovering (REC-03)
            if self.recovery_engine:
                deps = self.recovery_engine.get_dependencies(service_name)
                unhealthy_deps = []
                for dep_name in deps:
                    dep_svc = next(
                        (s for s in self.config.services if s.name == dep_name), None
                    )
                    if dep_svc and self.health_monitor.exceeds_threshold(dep_svc):
                        unhealthy_deps.append(dep_name)

                if unhealthy_deps:
                    log.warning(
                        "Dependencies unhealthy for {}: {}. Recovering dependencies first.",
                        service_name,
                        unhealthy_deps,
                    )
                    for dep_name in unhealthy_deps:
                        dep_result = await self.recovery_engine.attempt_recovery(dep_name)
                        if dep_result and self.metrics_collector:
                            await self.metrics_collector.record_recovery(
                                dep_name, dep_result.success
                            )

            if self.alert_dispatcher:
                await self.alert_dispatcher.send_alert(
                    title=f"Service {service_name} unhealthy",
                    message=f"{service_name} has {self.health_monitor.get_failure_count(service_name)} consecutive failures (threshold: {service.failure_threshold})",
                    severity="warning",
                    service_name=service_name,
                )
            if self.recovery_engine:
                recovery_result = await self.recovery_engine.attempt_recovery(service_name)
                if recovery_result:
                    if self.metrics_collector:
                        await self.metrics_collector.record_recovery(service_name, recovery_result.success)
                    if recovery_result.success:
                        log.info("Recovery action succeeded for {}", service_name)
                        # Reset circuit breaker on successful recovery
                        self.recovery_engine.reset_circuit_breaker(service_name)
                        await asyncio.sleep(5)
                        await self.health_monitor.check_service(service)
                    elif self.alert_dispatcher:
                        await self.alert_dispatcher.send_alert(
                            title=f"Recovery failed for {service_name}",
                            message=f"Action: {recovery_result.action.value}, Details: {recovery_result.details}",
                            severity="error",
                            service_name=service_name,
                        )

    async def _run_vpn_check(self):
        if not self.vpn_guard:
            return

        status = await self.vpn_guard.check_status()
        prev_state = self._vpn_state
        self._vpn_state = status.state

        log = logger.bind(component="Orchestrator")

        if self.metrics_collector:
            await self.metrics_collector.record_vpn_state(status.state.value)

        if status.state != prev_state:
            log.info("VPN state changed: {} → {}", prev_state.value, status.state.value)
            if self.alert_dispatcher and status.state == VPNState.DISCONNECTED:
                await self.alert_dispatcher.send_alert(
                    title="VPN disconnected",
                    message=f"VPN state changed from {prev_state.value} to {status.state.value}. Torrents paused.",
                    severity="critical",
                )

        # Enforce VPN gate on qBittorrent
        if self.qbt_controller:
            action = self.qbt_controller.enforce_vpn_gate(status.state)
            if action.value != "none":
                log.info("QBT gate action: {} (vpn_state={})", action.value, status.state.value)

            # Collect download stats for MetricsCollector when connected
            if status.state == VPNState.CONNECTED and self.metrics_collector:
                try:
                    stats = self.qbt_controller.get_download_stats()
                    if stats:
                        await self.metrics_collector.record("download_speed", "qbt", stats.get("download_speed", 0), "bytes/s")
                        await self.metrics_collector.record("upload_speed", "qbt", stats.get("upload_speed", 0), "bytes/s")
                        await self.metrics_collector.record("active_torrents", "qbt", stats.get("active_torrents", 0), "count")
                except Exception as e:
                    log.debug("Failed to collect qBittorrent download stats: {}", e)

        # Attempt VPN recovery if disconnected
        if status.state == VPNState.DISCONNECTED and self.recovery_engine:
            await self.recovery_engine.attempt_vpn_recovery()

    async def _run_tunnel_check(self, tunnel_name: str):
        if not self.tunnel_guard:
            return
        tunnel = next(
            (t for t in self.config.tunnels if t.tunnel_name == tunnel_name), None
        )
        if not tunnel:
            return

        result = await self.tunnel_guard.check_tunnel(tunnel)
        if not result.url_reachable and self.recovery_engine:
            await self.recovery_engine.attempt_tunnel_recovery(tunnel_name)

    async def _collect_system_metrics(self):
        if self.metrics_collector:
            await self.metrics_collector.collect_system_metrics()

    async def _apply_initial_qbt_settings(self):
        """Apply speed profile on startup."""
        if not self.qbt_controller:
            return
        profile_name = self.config.qbt.speed_profile
        log = logger.bind(component="Orchestrator")
        try:
            success = self.qbt_controller.apply_speed_profile(profile_name)
            if success:
                log.info("Applied speed profile '{}' on startup", profile_name)
            else:
                log.warning("Failed to apply speed profile '{}' on startup", profile_name)
        except Exception as e:
            log.error("Error applying speed profile on startup: {}", e)

    async def _run_interface_binding_check(self):
        """Periodically verify qBittorrent is bound to the VPN adapter."""
        if not self.qbt_controller:
            return

        vpn_adapter = self.config.vpn.adapter_description
        log = logger.bind(component="Orchestrator")

        try:
            is_bound = self.qbt_controller.verify_interface_binding(vpn_adapter)
            if not is_bound:
                log.warning(
                    "qBittorrent not bound to VPN adapter '{}'. Attempting to set binding.",
                    vpn_adapter,
                )
                set_ok = self.qbt_controller.set_interface_binding(vpn_adapter)
                if set_ok:
                    log.info("Successfully rebound qBittorrent to VPN adapter '{}'", vpn_adapter)
                else:
                    log.error("Failed to rebind qBittorrent to VPN adapter '{}'", vpn_adapter)
                    if self.alert_dispatcher:
                        await self.alert_dispatcher.send_alert(
                            title="qBittorrent interface binding failure",
                            message=f"qBittorrent is not bound to VPN adapter '{vpn_adapter}' and auto-rebind failed. Torrents have been paused.",
                            severity="critical",
                        )
        except Exception as e:
            log.error("Interface binding check failed: {}", e)

    async def _seed_services(self):
        db_path_resolved = Path(os.path.expandvars(str(self._db_path)))
        async with get_db(db_path_resolved) as db:
            for svc in self.config.services:
                await db.execute(
                    """INSERT OR REPLACE INTO services
                    (name, url, status, critical, poll_interval_seconds, failure_threshold, consecutive_failures)
                    VALUES (?, ?, 'unknown', ?, ?, ?, 0)""",
                    (svc.name, svc.url, int(svc.critical), svc.poll_interval_seconds, svc.failure_threshold),
                )
            await db.commit()
