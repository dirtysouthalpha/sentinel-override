import asyncio
import json
import os
from datetime import datetime
from pathlib import Path

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.interval import IntervalTrigger
from loguru import logger

from mediasentinel.agents.alert_dispatcher import AlertDispatcher
from mediasentinel.agents.qbt_controller import SPEED_PROFILES
from mediasentinel.agents.health_monitor import HealthMonitor
from mediasentinel.agents.metrics_collector import MetricsCollector
from mediasentinel.agents.models import VPNState
from mediasentinel.agents.qbt_controller import QBittorrentController
from mediasentinel.agents.recovery_engine import RecoveryEngine
from mediasentinel.agents.tunnel_guard import TunnelGuard
from mediasentinel.agents.vpn_guard import VPNGuard
from mediasentinel.config.models import AppConfig
from mediasentinel.core.snapshot import capture_snapshot, save_snapshot, load_latest_snapshot
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

        # Restore state from shutdown snapshot if one exists (DEP-03)
        await self._restore_shutdown_snapshot()

        logger.bind(component="Orchestrator").info("Orchestrator initialized")
        self._initialized = True

    async def start(self):
        await self.initialize()
        self._register_jobs()
        await self._apply_initial_qbt_settings()
        self.scheduler.start()
        logger.bind(component="Orchestrator").info("Scheduler started")
        await self._shutdown_event.wait()

    async def shutdown(self):
        """Graceful shutdown sequence (DEP-03).

        1. Log shutdown initiated
        2. Pause all qBittorrent downloads
        3. Capture full state snapshot and save as 'shutdown' type
        4. Stop the scheduler
        5. Flush all pending log entries
        6. Close all agent connections
        7. Set shutdown event
        """
        log = logger.bind(component="Orchestrator")
        log.info("Graceful shutdown initiated")

        # Step 2: Pause all qBittorrent downloads if controller is available
        if self.qbt_controller:
            try:
                log.info("Pausing all qBittorrent downloads for shutdown...")
                self.qbt_controller.enforce_vpn_gate(VPNState.DISCONNECTED)
                log.info("qBittorrent downloads paused")
            except Exception as e:
                log.warning("Failed to pause qBittorrent during shutdown: {}", e)

        # Step 3: Capture full state snapshot and save as 'shutdown'
        if self._db_path:
            try:
                vpn_status = {"state": self._vpn_state.value}
                snapshot_data = await capture_snapshot(
                    self._db_path, self.config,
                    vpn_status=vpn_status,
                    qbt_controller=self.qbt_controller,
                )
                # Add shutdown-specific metadata
                snapshot_data["shutdown_reason"] = "graceful"
                snapshot_data["shutdown_at"] = datetime.now().isoformat()
                await save_snapshot(self._db_path, snapshot_data, snapshot_type="shutdown")
                log.info("Shutdown snapshot saved")
            except Exception as e:
                log.warning("Failed to save shutdown snapshot: {}", e)

        # Step 4: Stop the scheduler
        if self.scheduler.running:
            self.scheduler.shutdown(wait=False)
            log.info("Scheduler stopped")

        # Step 5: Flush pending log entries
        # Loguru file sinks auto-flush on close; the agent close calls below
        # ensure everything is written before we exit.

        # Step 6: Close all agent connections
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
        log.info("All agent connections closed")

        # Step 7: Set shutdown event
        self._shutdown_event.set()
        log.info("Orchestrator shut down gracefully")

    @property
    def vpn_state(self) -> VPNState:
        return self._vpn_state

    async def _restore_shutdown_snapshot(self):
        """On startup, check for a 'shutdown' snapshot and restore state from it (DEP-03).

        If found, logs the restore and updates the DB with the last-known service
        statuses from the snapshot. Deletes the snapshot after restoring so it is
        not re-used on subsequent starts.
        """
        if not self._db_path:
            return

        log = logger.bind(component="Orchestrator")
        try:
            snapshot = await load_latest_snapshot(self._db_path, snapshot_type="shutdown")
            if snapshot is None:
                return

            log.info(
                "Resuming from shutdown snapshot captured at {}",
                snapshot.get("captured_at", "unknown"),
            )

            # Restore service statuses from snapshot
            services = snapshot.get("services", [])
            if services:
                async with get_db(self._db_path) as db:
                    for svc in services:
                        await db.execute(
                            """UPDATE services SET status = ?, consecutive_failures = ?
                            WHERE name = ?""",
                            (
                                svc.get("status", "unknown"),
                                svc.get("consecutive_failures", 0),
                                svc["name"],
                            ),
                        )
                    await db.commit()
                log.info(
                    "Restored statuses for {} services from snapshot", len(services)
                )

            # Restore VPN state from snapshot
            vpn_info = snapshot.get("vpn", {})
            saved_vpn_state = vpn_info.get("state", "disconnected")
            try:
                self._vpn_state = VPNState(saved_vpn_state)
            except ValueError:
                self._vpn_state = VPNState.DISCONNECTED
            log.info("Restored VPN state from snapshot: {}", self._vpn_state.value)

            # Delete the shutdown snapshot so it is not reused
            async with get_db(self._db_path) as db:
                await db.execute(
                    "DELETE FROM state_snapshots WHERE snapshot_type = 'shutdown'"
                )
                await db.commit()
            log.info("Shutdown snapshot consumed and deleted")

        except Exception as e:
            log.warning("Failed to restore shutdown snapshot: {}", e)

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

            # Throttling detection (MET-05) runs every 60 seconds
            self.scheduler.add_job(
                self._detect_throttling,
                trigger=IntervalTrigger(seconds=60),
                id="throttle_detection",
                name="Bandwidth throttling detection",
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
                        severity = "emergency" if recovery_result.action.value == "escalate" else "error"
                        await self.alert_dispatcher.send_alert(
                            title=f"Recovery failed for {service_name}",
                            message=f"Action: {recovery_result.action.value}, Details: {recovery_result.details}",
                            severity=severity,
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
            action = await asyncio.to_thread(self.qbt_controller.enforce_vpn_gate, status.state)
            if action.value != "none":
                log.info("QBT gate action: {} (vpn_state={})", action.value, status.state.value)

            # Collect download stats for MetricsCollector when connected
            if status.state == VPNState.CONNECTED and self.metrics_collector:
                try:
                    stats = await asyncio.to_thread(self.qbt_controller.get_download_stats)
                    if stats:
                        await self.metrics_collector.record_download_throughput(
                            download_bytes_per_sec=stats.get("download_speed", 0),
                            upload_bytes_per_sec=stats.get("upload_speed", 0),
                            active_torrents=stats.get("active_torrents", 0),
                        )
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

        # Record download throughput stats from qBittorrent (MET-03)
        if self.qbt_controller and self.metrics_collector and self._vpn_state == VPNState.CONNECTED:
            try:
                stats = await asyncio.to_thread(self.qbt_controller.get_download_stats)
                if stats:
                    await self.metrics_collector.record_download_throughput(
                        download_bytes_per_sec=stats.get("download_speed", 0),
                        upload_bytes_per_sec=stats.get("upload_speed", 0),
                        active_torrents=stats.get("active_torrents", 0),
                    )
            except Exception as e:
                logger.bind(component="Orchestrator").debug(
                    "Failed to collect download throughput: {}", e
                )

    async def _apply_initial_qbt_settings(self):
        """Apply speed profile on startup."""
        if not self.qbt_controller:
            return
        profile_name = self.config.qbt.speed_profile
        log = logger.bind(component="Orchestrator")
        try:
            success = await asyncio.to_thread(self.qbt_controller.apply_speed_profile, profile_name)
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
            is_bound = await asyncio.to_thread(self.qbt_controller.verify_interface_binding, vpn_adapter)
            if not is_bound:
                log.warning(
                    "qBittorrent not bound to VPN adapter '{}'. Attempting to set binding.",
                    vpn_adapter,
                )
                set_ok = await asyncio.to_thread(self.qbt_controller.set_interface_binding, vpn_adapter)
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

    async def _detect_throttling(self):
        """Detect bandwidth throttling by comparing throughput against speed profile (MET-05)."""
        if not self.metrics_collector or not self.alert_dispatcher:
            return

        # Resolve the speed profile to get expected download speed in bytes/sec
        profile_name = self.config.qbt.speed_profile
        profile = SPEED_PROFILES.get(profile_name)
        if not profile:
            return

        try:
            throttle_pct = await self.metrics_collector.detect_throttling(
                profile.max_download_bytes
            )
            if throttle_pct is not None:
                await self.alert_dispatcher.send_alert(
                    title="Bandwidth throttling detected",
                    message=(
                        f"Download speed is at {throttle_pct}% of the configured profile "
                        f"'{profile_name}' (expected ~{profile.max_download_bytes} bytes/s). "
                        f"ISP or VPN may be throttling traffic."
                    ),
                    severity="warning",
                    service_name="qBittorrent",
                )
        except Exception as e:
            logger.bind(component="Orchestrator").debug(
                "Throttling detection failed: {}", e
            )

    async def _seed_services(self):
        db_path_resolved = Path(os.path.expandvars(str(self._db_path)))
        async with get_db(db_path_resolved) as db:
            for svc in self.config.services:
                await db.execute(
                    """INSERT INTO services
                    (name, url, status, critical, poll_interval_seconds, failure_threshold, consecutive_failures)
                    VALUES (?, ?, 'unknown', ?, ?, ?, 0)
                    ON CONFLICT(name) DO UPDATE SET
                        url = excluded.url,
                        critical = excluded.critical,
                        poll_interval_seconds = excluded.poll_interval_seconds,
                        failure_threshold = excluded.failure_threshold""",
                    (svc.name, svc.url, int(svc.critical), svc.poll_interval_seconds, svc.failure_threshold),
                )
            await db.commit()
