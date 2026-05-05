"""7-level escalation recovery engine (REC-01 through REC-05).

Hierarchy:
  Level 1: Self-heal wait     — wait and recheck
  Level 2: Soft restart       — graceful Docker container restart
  Level 3: Dependency recovery — restart dependencies first, then service
  Level 4: Stack reset        — restart entire dependency chain from root
  Level 5: VPN recovery       — reconnect VPN, then restart everything above
  Level 6: Network recovery   — restart Docker daemon, VPN, all services
  Level 7: Operator escalation — EMERGENCY alert, stop auto-recovery

Circuit breaker (REC-05): max 3 recovery attempts per service in 10 minutes.
"""

import asyncio
import os
import subprocess
from collections import deque
from datetime import datetime, timedelta
from pathlib import Path
from typing import Optional

from loguru import logger

from mediasentinel.agents.models import (
    RecoveryAction,
    RecoveryLevel,
    RecoveryResult,
)
from mediasentinel.config.models import AppConfig, RecoveryPolicy
from mediasentinel.db.connection import get_db

# Dependency tree (REC-03): left-to-right is start-order.
# Each service depends on everything to its left being healthy.
DEPENDENCY_TREE: list[str] = [
    "VPN",
    "Tunnels",
    "qBittorrent",
    "Jellyfin",
    "Prowlarr",
    "Radarr",
    "Sonarr",
    "Jellyseerr",
    "Shoko",
]

# Per-level configuration (REC-02): timeout in seconds, max retries, cooldown.
LEVEL_CONFIG: dict[int, dict] = {
    1: {"timeout": 30, "retries": 2, "cooldown": 30},
    2: {"timeout": 30, "retries": 1, "cooldown": 30},
    3: {"timeout": 60, "retries": 1, "cooldown": 60},
    4: {"timeout": 120, "retries": 1, "cooldown": 120},
    5: {"timeout": 60, "retries": 1, "cooldown": 120},
    6: {"timeout": 180, "retries": 0, "cooldown": 300},
    7: {"timeout": 0, "retries": 0, "cooldown": 0},
}

# Circuit breaker constants (REC-05)
CIRCUIT_BREAKER_MAX_ATTEMPTS = 3
CIRCUIT_BREAKER_WINDOW_SECONDS = 600  # 10 minutes


class RecoveryEngine:
    def __init__(self, config: AppConfig, db_path: Path):
        self.config = config
        self.policy = config.recovery
        self._db_path = db_path
        self._last_recovery: dict[str, datetime] = {}
        self._attempt_count: dict[str, int] = {}
        # Circuit breaker: service_name -> deque of timestamps
        self._circuit_breaker: dict[str, deque] = {}

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def get_dependencies(self, service_name: str) -> list[str]:
        """Return the services that must be healthy before this one (REC-03).

        Returns everything to the left of `service_name` in DEPENDENCY_TREE.
        If the service is not in the tree, returns an empty list.
        """
        try:
            idx = DEPENDENCY_TREE.index(service_name)
        except ValueError:
            return []
        return list(DEPENDENCY_TREE[:idx])

    async def attempt_recovery(self, service_name: str) -> Optional[RecoveryResult]:
        """Main entry point: escalate through levels for a failing service."""
        log = logger.bind(component="RecoveryEngine", action="attempt", service=service_name)

        if not self._can_attempt(service_name):
            log.warning("Recovery on cooldown for {}", service_name)
            return None

        if not self._circuit_breaker_ok(service_name):
            log.warning(
                "Circuit breaker tripped for {} — max {} attempts in {}s window",
                service_name,
                CIRCUIT_BREAKER_MAX_ATTEMPTS,
                CIRCUIT_BREAKER_WINDOW_SECONDS,
            )
            # Force escalation to operator level
            result = await self._execute_level(service_name, RecoveryLevel.OPERATOR_ESCALATION)
            await self._record_result(result)
            return result

        self._attempt_count[service_name] = self._attempt_count.get(service_name, 0) + 1
        self._last_recovery[service_name] = datetime.now()
        self._record_circuit_breaker_attempt(service_name)

        level = self._get_escalation_level(service_name)
        result = await self._execute_level(service_name, level)

        # If this level failed and retries remain, retry
        level_num = level.value
        level_cfg = LEVEL_CONFIG.get(level_num, {})
        retries_remaining = level_cfg.get("retries", 0)

        while not result.success and retries_remaining > 0:
            retries_remaining -= 1
            log.info(
                "Retrying level {} for {} ({} retries left)",
                level_num,
                service_name,
                retries_remaining,
            )
            await asyncio.sleep(level_cfg.get("cooldown", 30))
            result = await self._execute_level(service_name, level)

        await self._record_result(result)
        return result

    async def attempt_tunnel_recovery(self, tunnel_name: str) -> Optional[RecoveryResult]:
        """Recover a Cloudflare tunnel."""
        log = logger.bind(component="RecoveryEngine", action="tunnel_recovery", tunnel=tunnel_name)

        key = f"tunnel:{tunnel_name}"
        if not self._can_attempt(key):
            log.warning("Tunnel recovery on cooldown for {}", tunnel_name)
            return None

        if not self._circuit_breaker_ok(key):
            log.warning("Circuit breaker tripped for tunnel {}", tunnel_name)
            return None

        self._attempt_count[key] = self._attempt_count.get(key, 0) + 1
        self._last_recovery[key] = datetime.now()
        self._record_circuit_breaker_attempt(key)

        level = self._get_escalation_level(key)

        # Tunnel services use tunnel restart at lower levels, not the
        # general _execute_level which assumes Docker containers.
        if level.value <= RecoveryLevel.SOFT_RESTART.value:
            result = await self._do_tunnel_restart(tunnel_name, level.value)
        else:
            result = await self._execute_level(key, level)

        await self._record_result(result)
        return result

    async def attempt_vpn_recovery(self) -> Optional[RecoveryResult]:
        """Recover VPN connection."""
        key = "vpn:reconnect"
        if not self._can_attempt(key):
            return None

        if not self._circuit_breaker_ok(key):
            return None

        self._attempt_count[key] = self._attempt_count.get(key, 0) + 1
        self._last_recovery[key] = datetime.now()
        self._record_circuit_breaker_attempt(key)

        level = self._get_escalation_level(key)

        # VPN recovery always uses VPN reconnect at lower levels.
        if level.value <= RecoveryLevel.SOFT_RESTART.value:
            result = await self._do_vpn_reconnect(level.value)
        else:
            result = await self._execute_level(key, level)

        await self._record_result(result)
        return result

    def reset_attempts(self, service_name: str) -> None:
        """Reset attempt counters and circuit breaker for a recovered service."""
        self._attempt_count.pop(service_name, None)
        self._last_recovery.pop(service_name, None)
        self._circuit_breaker.pop(service_name, None)
        # Also reset tunnel-qualified key
        key = f"tunnel:{service_name}"
        self._attempt_count.pop(key, None)
        self._last_recovery.pop(key, None)
        self._circuit_breaker.pop(key, None)

    def reset_circuit_breaker(self, service_name: str) -> None:
        """Clear circuit breaker state for a service that has recovered."""
        self._circuit_breaker.pop(service_name, None)

    def get_attempt_count(self, service_name: str) -> int:
        return self._attempt_count.get(service_name, 0)

    # ------------------------------------------------------------------
    # Escalation level dispatch
    # ------------------------------------------------------------------

    async def _execute_level(
        self, service_name: str, level: RecoveryLevel
    ) -> RecoveryResult:
        """Execute the recovery action for the given escalation level."""
        log = logger.bind(
            component="RecoveryEngine",
            action=f"level_{level.value}",
            service=service_name,
        )
        log.info("Executing recovery level {} for {}", level.name, service_name)

        # Capture state snapshot before Level 2+ actions (REC-04)
        if level.value >= RecoveryLevel.SOFT_RESTART.value:
            try:
                from mediasentinel.core.snapshot import capture_snapshot, save_snapshot

                snapshot = await capture_snapshot(self._db_path, self.config)
                await save_snapshot(self._db_path, snapshot, "pre_recovery")
                log.info("Pre-recovery snapshot captured for level {}", level.value)
            except Exception as e:
                log.warning("Failed to capture pre-recovery snapshot: {}", e)

        if level == RecoveryLevel.SELF_HEAL_WAIT:
            return await self._do_self_heal_wait(service_name, level.value)
        elif level == RecoveryLevel.SOFT_RESTART:
            return await self._do_docker_restart(service_name, level.value)
        elif level == RecoveryLevel.DEPENDENCY_RECOVERY:
            return await self._do_dependency_recovery(service_name, level.value)
        elif level == RecoveryLevel.STACK_RESET:
            return await self._do_stack_reset(service_name, level.value)
        elif level == RecoveryLevel.VPN_RECOVERY:
            return await self._do_vpn_recovery(service_name, level.value)
        elif level == RecoveryLevel.NETWORK_RECOVERY:
            return await self._do_network_recovery(service_name, level.value)
        else:
            return await self._do_escalate(service_name, level.value)

    # ------------------------------------------------------------------
    # Level implementations
    # ------------------------------------------------------------------

    async def _do_self_heal_wait(
        self, service_name: str, level: int
    ) -> RecoveryResult:
        """Level 1: Wait and recheck — give the service time to self-heal."""
        started = datetime.now()
        log = logger.bind(component="RecoveryEngine", action="self_heal_wait", service=service_name)

        wait_seconds = LEVEL_CONFIG[1]["timeout"]
        log.info("Waiting {}s for {} to self-heal", wait_seconds, service_name)
        await asyncio.sleep(wait_seconds)

        # Recheck the service health from DB
        try:
            async with get_db(self._db_path) as db:
                cursor = await db.execute(
                    "SELECT status FROM services WHERE name = ?", (service_name,)
                )
                row = await cursor.fetchone()
                if row and row["status"] in ("healthy", "degraded"):
                    completed = datetime.now()
                    log.info("{} self-healed after wait", service_name)
                    return RecoveryResult(
                        service_name=service_name,
                        action=RecoveryAction.SELF_HEAL_WAIT,
                        success=True,
                        escalation_level=level,
                        details=f"Service recovered after {wait_seconds}s wait",
                        started_at=started,
                        completed_at=completed,
                    )
        except Exception as e:
            log.warning("Failed to recheck status after wait: {}", e)

        completed = datetime.now()
        return RecoveryResult(
            service_name=service_name,
            action=RecoveryAction.SELF_HEAL_WAIT,
            success=False,
            escalation_level=level,
            details=f"Service did not self-heal after {wait_seconds}s",
            started_at=started,
            completed_at=completed,
        )

    async def _do_docker_restart(
        self, service_name: str, level: int
    ) -> RecoveryResult:
        """Level 2: Graceful Docker container restart."""
        started = datetime.now()
        log = logger.bind(component="RecoveryEngine", action="docker_restart", service=service_name)

        try:
            import docker

            client = docker.from_env()
            container_name = service_name.lower().replace(" ", "-")

            try:
                container = client.containers.get(container_name)
                log.info("Restarting container {}", container_name)
                await asyncio.to_thread(container.restart, timeout=self.policy.docker_restart_timeout)
                completed = datetime.now()
                log.info("Container {} restarted successfully", container_name)
                return RecoveryResult(
                    service_name=service_name,
                    action=RecoveryAction.DOCKER_RESTART,
                    success=True,
                    escalation_level=level,
                    details=f"Container {container_name} restarted",
                    started_at=started,
                    completed_at=completed,
                )
            except docker.errors.NotFound:
                completed = datetime.now()
                log.warning("No Docker container found for {}", container_name)
                return RecoveryResult(
                    service_name=service_name,
                    action=RecoveryAction.DOCKER_RESTART,
                    success=False,
                    escalation_level=level,
                    details=f"Container {container_name} not found",
                    started_at=started,
                    completed_at=completed,
                )
            finally:
                client.close()
        except Exception as e:
            completed = datetime.now()
            log.error("Docker restart failed for {}: {}", service_name, e)
            return RecoveryResult(
                service_name=service_name,
                action=RecoveryAction.DOCKER_RESTART,
                success=False,
                escalation_level=level,
                details=str(e),
                started_at=started,
                completed_at=completed,
            )

    async def _do_dependency_recovery(
        self, service_name: str, level: int
    ) -> RecoveryResult:
        """Level 3: Restart the service's dependencies first, then the service."""
        started = datetime.now()
        log = logger.bind(
            component="RecoveryEngine",
            action="dependency_recovery",
            service=service_name,
        )

        dependencies = self.get_dependencies(service_name)
        log.info(
            "Dependency recovery for {}: dependencies={}",
            service_name,
            dependencies,
        )

        # Restart each dependency in order
        for dep in dependencies:
            dep_result = await self._restart_service_container(dep)
            if not dep_result:
                log.warning("Dependency {} restart failed, continuing", dep)
            await asyncio.sleep(2)

        # Finally restart the target service
        target_result = await self._restart_service_container(service_name)

        completed = datetime.now()
        success = target_result
        return RecoveryResult(
            service_name=service_name,
            action=RecoveryAction.DEPENDENCY_RECOVERY,
            success=success,
            escalation_level=level,
            details=(
                f"Dependency recovery: deps={dependencies}, target={'ok' if success else 'failed'}"
            ),
            started_at=started,
            completed_at=completed,
        )

    async def _do_stack_reset(
        self, service_name: str, level: int
    ) -> RecoveryResult:
        """Level 4: Restart entire dependency chain from root (VPN excluded)."""
        started = datetime.now()
        log = logger.bind(component="RecoveryEngine", action="stack_reset", service=service_name)

        # Get the full chain up to and including this service
        chain = self.get_dependencies(service_name) + [service_name]
        # Exclude VPN and Tunnels from stack reset (those have their own levels)
        chain = [s for s in chain if s not in ("VPN", "Tunnels")]

        log.info("Stack reset for {}: chain={}", service_name, chain)

        failures = []
        for svc in chain:
            try:
                await self._restart_service_container(svc)
            except Exception as e:
                log.error("Stack reset failed to restart {}: {}", svc, e)
                failures.append(svc)
            await asyncio.sleep(3)

        completed = datetime.now()
        success = len(failures) == 0
        details = f"Stack reset completed: chain={chain}"
        if failures:
            details += f" | FAILED: {failures}"
        return RecoveryResult(
            service_name=service_name,
            action=RecoveryAction.STACK_RESET,
            success=success,
            escalation_level=level,
            details=details,
            started_at=started,
            completed_at=completed,
        )

    async def _do_vpn_recovery(
        self, service_name: str, level: int
    ) -> RecoveryResult:
        """Level 5: Reconnect VPN, then restart everything above it in the tree."""
        started = datetime.now()
        log = logger.bind(component="RecoveryEngine", action="vpn_recovery", service=service_name)

        # Step 1: Reconnect VPN
        vpn_result = await self._do_vpn_reconnect(level)
        if not vpn_result.success:
            completed = datetime.now()
            return RecoveryResult(
                service_name=service_name,
                action=RecoveryAction.VPN_RECONNECT,
                success=False,
                escalation_level=level,
                details=f"VPN reconnect failed: {vpn_result.details}",
                started_at=started,
                completed_at=completed,
            )

        # Step 2: Restart everything from Tunnels onward in dependency order
        try:
            tunnels_idx = DEPENDENCY_TREE.index("Tunnels")
        except ValueError:
            tunnels_idx = 1

        for svc in DEPENDENCY_TREE[tunnels_idx:]:
            await self._restart_service_container(svc)
            await asyncio.sleep(3)

        completed = datetime.now()
        return RecoveryResult(
            service_name=service_name,
            action=RecoveryAction.VPN_RECONNECT,
            success=True,
            escalation_level=level,
            details="VPN recovered and all downstream services restarted",
            started_at=started,
            completed_at=completed,
        )

    async def _do_network_recovery(
        self, service_name: str, level: int
    ) -> RecoveryResult:
        """Level 6: Restart Docker daemon, VPN, all services."""
        started = datetime.now()
        log = logger.bind(component="RecoveryEngine", action="network_recovery", service=service_name)

        # Step 1: Restart Docker daemon
        try:
            result = await asyncio.to_thread(
                subprocess.run,
                ["powershell", "-Command", "Restart-Service docker -Force"],
                capture_output=True,
                text=True,
                timeout=60,
            )
            if result.returncode != 0:
                log.error("Docker daemon restart failed: {}", result.stderr)
        except Exception as e:
            log.error("Docker daemon restart exception: {}", e)

        await asyncio.sleep(10)

        # Step 2: Reconnect VPN
        await self._do_vpn_reconnect(level)
        await asyncio.sleep(5)

        # Step 3: Restart all services in dependency order
        for svc in DEPENDENCY_TREE:
            if svc not in ("VPN", "Tunnels"):
                await self._restart_service_container(svc)
                await asyncio.sleep(3)

        # Step 4: Restart tunnels
        try:
            import docker
            client = docker.from_env()
            try:
                container = client.containers.get("cloudflared")
                await asyncio.to_thread(container.restart, timeout=30)
            finally:
                client.close()
        except Exception:
            try:
                await asyncio.to_thread(
                    subprocess.run,
                    ["net", "stop", "cloudflared"] if os.name == "nt"
                    else ["systemctl", "restart", "cloudflared"],
                    capture_output=True,
                    text=True,
                    timeout=30,
                )
                if os.name == "nt":
                    await asyncio.to_thread(
                        subprocess.run,
                        ["net", "start", "cloudflared"],
                        capture_output=True,
                        text=True,
                        timeout=30,
                    )
            except Exception:
                pass

        # Verify Docker daemon came back
        docker_ok = False
        try:
            import docker
            client = docker.from_env()
            try:
                await asyncio.to_thread(client.ping)
                docker_ok = True
            finally:
                client.close()
        except Exception:
            pass

        completed = datetime.now()
        return RecoveryResult(
            service_name=service_name,
            action=RecoveryAction.NETWORK_RECOVERY,
            success=docker_ok,
            escalation_level=level,
            details=f"Network recovery: Docker daemon {'restarted successfully' if docker_ok else 'failed to respond'}",
            started_at=started,
            completed_at=completed,
        )

    async def _do_escalate(
        self, service_name: str, level: int
    ) -> RecoveryResult:
        """Level 7: Operator escalation — EMERGENCY alert, stop auto-recovery."""
        started = datetime.now()
        completed = datetime.now()
        log = logger.bind(component="RecoveryEngine", action="escalate", service=service_name)

        log.critical(
            "ESCALATION: {} has exceeded max recovery attempts (level={}). "
            "Manual intervention required.",
            service_name,
            level,
        )

        return RecoveryResult(
            service_name=service_name,
            action=RecoveryAction.ESCALATE,
            success=False,
            escalation_level=level,
            details=f"Escalated after {self._attempt_count.get(service_name, 0)} attempts. "
            "Auto-recovery halted — operator intervention required.",
            started_at=started,
            completed_at=completed,
        )

    # ------------------------------------------------------------------
    # VPN and tunnel recovery (used by multiple levels)
    # ------------------------------------------------------------------

    async def _do_vpn_reconnect(self, level: int) -> RecoveryResult:
        """Reconnect VPN via rasdial."""
        started = datetime.now()
        log = logger.bind(component="RecoveryEngine", action="vpn_reconnect")

        try:
            # Disconnect first
            await asyncio.to_thread(
                subprocess.run,
                ["rasdial", self.config.vpn.adapter_description, "/disconnect"],
                capture_output=True,
                text=True,
                timeout=15,
            )
            await asyncio.sleep(2)

            # Reconnect using stored credentials (piped via stdin to avoid argv exposure)
            import os
            vpn_user = os.environ.get("MEDIASENTINEL_VPN_USER", "")
            vpn_pass = os.environ.get("MEDIASENTINEL_VPN_PASS", "")
            if vpn_user and vpn_pass:
                result = await asyncio.to_thread(
                    subprocess.run,
                    ["rasdial", self.config.vpn.adapter_description],
                    input=f"{vpn_user}\n{vpn_pass}\n",
                    capture_output=True,
                    text=True,
                    timeout=30,
                )
                completed = datetime.now()
                if result.returncode == 0:
                    log.info("VPN reconnected for {}", self.config.vpn.adapter_description)
                    return RecoveryResult(
                        service_name=f"vpn:{self.config.vpn.adapter_description}",
                        action=RecoveryAction.VPN_RECONNECT,
                        success=True,
                        escalation_level=level,
                        details="VPN reconnected successfully",
                        started_at=started,
                        completed_at=completed,
                    )
                else:
                    log.error("VPN reconnect failed: {}", result.stderr)
                    return RecoveryResult(
                        service_name=f"vpn:{self.config.vpn.adapter_description}",
                        action=RecoveryAction.VPN_RECONNECT,
                        success=False,
                        escalation_level=level,
                        details=result.stderr[:500],
                        started_at=started,
                        completed_at=completed,
                    )
            else:
                completed = datetime.now()
                log.error("VPN credentials not configured — cannot reconnect, reporting failure")
                return RecoveryResult(
                    service_name=f"vpn:{self.config.vpn.adapter_description}",
                    action=RecoveryAction.VPN_RECONNECT,
                    success=False,
                    escalation_level=level,
                    details="VPN reconnect failed: credentials not configured",
                    started_at=started,
                    completed_at=completed,
                )
        except Exception as e:
            completed = datetime.now()
            log.error("VPN reconnect failed: {}", e)
            return RecoveryResult(
                service_name=f"vpn:{self.config.vpn.adapter_description}",
                action=RecoveryAction.VPN_RECONNECT,
                success=False,
                escalation_level=level,
                details=str(e),
                started_at=started,
                completed_at=completed,
            )

    async def _do_tunnel_restart(
        self, tunnel_name: str, level: int
    ) -> RecoveryResult:
        """Restart a Cloudflare tunnel via Docker container or Windows service."""
        started = datetime.now()
        log = logger.bind(component="RecoveryEngine", action="tunnel_restart", tunnel=tunnel_name)

        try:
            # Try Docker container restart first (most common deployment)
            try:
                import docker
                client = docker.from_env()
                container_name = "cloudflared"
                try:
                    container = client.containers.get(container_name)
                    await asyncio.to_thread(container.restart, timeout=30)
                    completed = datetime.now()
                    log.info("cloudflared container restarted for tunnel {}", tunnel_name)
                    return RecoveryResult(
                        service_name=tunnel_name,
                        action=RecoveryAction.TUNNEL_RESTART,
                        success=True,
                        escalation_level=level,
                        details="cloudflared container restarted",
                        started_at=started,
                        completed_at=completed,
                    )
                except docker.errors.NotFound:
                    pass
            except Exception:
                pass

            # Fallback: Windows service restart
            result = await asyncio.to_thread(
                subprocess.run,
                ["net", "stop", "cloudflared"] if os.name == "nt"
                else ["systemctl", "restart", "cloudflared"],
                capture_output=True,
                text=True,
                timeout=30,
            )
            if result.returncode == 0:
                await asyncio.to_thread(
                    subprocess.run,
                    ["net", "start", "cloudflared"] if os.name == "nt"
                    else ["true"],
                    capture_output=True,
                    text=True,
                    timeout=30,
                )
            completed = datetime.now()
            if result.returncode == 0:
                log.info("cloudflared service restarted for tunnel {}", tunnel_name)
                return RecoveryResult(
                    service_name=tunnel_name,
                    action=RecoveryAction.TUNNEL_RESTART,
                    success=True,
                    escalation_level=level,
                    details="cloudflared service restarted",
                    started_at=started,
                    completed_at=completed,
                )
            else:
                log.error("cloudflared restart failed: {}", result.stderr)
                return RecoveryResult(
                    service_name=tunnel_name,
                    action=RecoveryAction.TUNNEL_RESTART,
                    success=False,
                    escalation_level=level,
                    details=result.stderr[:500],
                    started_at=started,
                    completed_at=completed,
                )
        except Exception as e:
            completed = datetime.now()
            log.error("Tunnel restart failed: {}", e)
            return RecoveryResult(
                service_name=tunnel_name,
                action=RecoveryAction.TUNNEL_RESTART,
                success=False,
                escalation_level=level,
                details=str(e),
                started_at=started,
                completed_at=completed,
            )

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------

    async def _restart_service_container(self, service_name: str) -> bool:
        """Attempt to restart a single Docker container. Returns True on success."""
        try:
            import docker

            client = docker.from_env()
            container_name = service_name.lower().replace(" ", "-")
            try:
                container = client.containers.get(container_name)
                await asyncio.to_thread(container.restart, timeout=self.policy.docker_restart_timeout)
                logger.bind(component="RecoveryEngine").debug(
                    "Restarted container {}", container_name
                )
                return True
            except Exception as e:
                logger.bind(component="RecoveryEngine").warning(
                    "Container restart failed for {}: {}", container_name, e
                )
                return False
            finally:
                client.close()
        except Exception as e:
            logger.bind(component="RecoveryEngine").warning(
                "Docker unavailable for container restart of {}: {}", service_name, e
            )
            return False

    def _can_attempt(self, service_name: str) -> bool:
        """Check cooldown period has elapsed."""
        last = self._last_recovery.get(service_name)
        if last is None:
            return True
        elapsed = (datetime.now() - last).total_seconds()
        return elapsed >= self.policy.cooldown_seconds

    def _get_escalation_level(self, service_name: str) -> RecoveryLevel:
        """Map attempt count to a RecoveryLevel (1-7).

        Uses the escalation_threshold from policy: every N attempts
        increments the level by 1, capped at level 7.
        """
        attempts = self._attempt_count.get(service_name, 0)
        threshold = self.policy.escalation_threshold
        # Level = min(ceil(attempts / threshold), 7)
        # With threshold=2: attempts 1-2 -> level 1, 3-4 -> level 2, etc.
        level_num = min((attempts + threshold - 1) // threshold, 7)
        level_num = max(level_num, 1)  # Floor at level 1
        return RecoveryLevel(level_num)

    # ------------------------------------------------------------------
    # Circuit breaker (REC-05)
    # ------------------------------------------------------------------

    def _circuit_breaker_ok(self, service_name: str) -> bool:
        """Return False if 3+ recovery attempts in the last 10 minutes."""
        attempts = self._circuit_breaker.get(service_name)
        if attempts is None:
            return True
        # Prune old entries
        cutoff = datetime.now() - timedelta(seconds=CIRCUIT_BREAKER_WINDOW_SECONDS)
        while attempts and attempts[0] < cutoff:
            attempts.popleft()
        return len(attempts) < CIRCUIT_BREAKER_MAX_ATTEMPTS

    def _record_circuit_breaker_attempt(self, service_name: str) -> None:
        """Record a recovery attempt timestamp for circuit breaker tracking."""
        if service_name not in self._circuit_breaker:
            self._circuit_breaker[service_name] = deque()
        self._circuit_breaker[service_name].append(datetime.now())

    # ------------------------------------------------------------------
    # DB recording
    # ------------------------------------------------------------------

    async def _record_result(self, result: RecoveryResult) -> None:
        """Persist recovery event to the database."""
        try:
            async with get_db(self._db_path) as db:
                await db.execute(
                    """INSERT INTO recovery_events
                    (service_name, escalation_level, action, result, started_at, completed_at)
                    VALUES (?, ?, ?, ?, ?, ?)""",
                    (
                        result.service_name,
                        result.escalation_level,
                        result.action.value,
                        "success" if result.success else "failed",
                        result.started_at.isoformat(),
                        result.completed_at.isoformat() if result.completed_at else None,
                    ),
                )
                await db.commit()
        except Exception as e:
            logger.bind(component="RecoveryEngine").error(
                "Failed to record recovery event: {}", e
            )
